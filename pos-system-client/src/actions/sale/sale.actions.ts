'use server';

import { Sale, Prisma, SaleStatus, MembershipRole } from '@/generated/prisma';
import { ActionResponse, Serialized } from '@/interfaces';
import { actorErrorResponse, requireActor, type Actor } from '@/lib/auth/actor';
import { prisma, serializeDecimals } from '../utils';
import { createStockMovement } from '../stock-movement';
import { calculateSaleTotals } from './sale-totals';
import {
  analyticsInputSchema,
  createSaleInputSchema,
  idSchema,
  paginationSchema,
  saleFiltersSchema,
  updateSaleInputSchema,
  type CreateSaleInput,
  type PaginationInput,
  type SaleFiltersInput,
  type UpdateSaleInput,
} from './sale.schemas';

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

const invalidInput = (message = 'Datos inválidos') =>
  ({ status: 400, message, data: null }) as const;
const internalError = () =>
  ({ status: 500, message: 'Error interno del servidor', data: null }) as const;
const saleNotFound = () =>
  ({ status: 404, message: 'Venta no encontrada', data: null }) as const;

// SALE INCLUDES
/** Campos del vendedor que salen al navegador: nunca credenciales ni datos de seguridad de la cuenta. */
const saleUserSelect = { id: true, name: true, email: true } as const satisfies Prisma.UserSelect;

const saleInclude: Prisma.SaleInclude = {
  store: true,
  customer: true, // Include complete customer data for detail view
  user: { select: saleUserSelect }, // Solo datos públicos del vendedor
  saleItems: {
    where: {
      isDeleted: false,
    },
    include: {
      product: {
        include: {
          brand: true,
          category: true,
          unitMeasure: true,
        },
      },
      unitMeasure: true,
    },
  },
  salePayments: {
    where: {
      isDeleted: false,
    },
    include: {
      paymentMethod: true,
    },
  },
  _count: {
    select: {
      saleItems: true,
      salePayments: true,
    },
  },
};

// UTILITY FUNCTIONS
const generateSaleNumber = async (storeId: string): Promise<string> => {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
  });

  let nextNumber: number = 1;

  if (store?.lastSaleNumber) {
    nextNumber = store.lastSaleNumber + 1;
  }

  return `${store?.saleNumberPrefix}-${String(nextNumber).padStart(6, '0')}`;
};

// ===========================
// SALE ACTIONS
// ===========================

// CREATE SALE
export const createSale = async (
  input: CreateSaleInput
): Promise<ActionResponse<Serialized<Sale> | null>> => {
  try {
    const actor = await requireActor();
    const parsed = createSaleInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error.issues[0]?.message ?? 'Datos de venta inválidos');
    }
    const { saleData, saleItems, salePayments } = parsed.data;
    const orgId = actor.organizationId;

    // Un vendedor con tienda asignada solo vende en su tienda
    if (
      actor.role === MembershipRole.SELLER &&
      actor.storeId &&
      saleData.storeId !== actor.storeId
    ) {
      return {
        status: 403,
        message: 'Solo puedes registrar ventas en tu tienda asignada',
        data: null,
      };
    }

    // Verificar que la tienda existe y pertenece a la organización
    const store = await prisma.store.findFirst({
      where: {
        id: saleData.storeId,
        organizationId: orgId,
        isDeleted: false,
      },
    });

    if (!store) {
      return {
        status: 400,
        message: 'La tienda especificada no existe',
        data: null,
      };
    }

    // Verificar cliente si se especifica
    if (saleData.customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: saleData.customerId,
          organizationId: orgId,
          isDeleted: false,
        },
        select: { id: true },
      });

      if (!customer) {
        return {
          status: 400,
          message: 'El cliente especificado no existe',
          data: null,
        };
      }
    }

    // Verificar productos y stock disponible
    const productIds = [...new Set(saleItems.map((item) => item.productId))];
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        organizationId: orgId,
        isDeleted: false,
        isActive: true,
      },
    });

    if (products.length !== productIds.length) {
      return {
        status: 400,
        message: 'Uno o más productos no existen o están inactivos',
        data: null,
      };
    }

    // Verificar stock disponible
    for (const item of saleItems) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) {
        return {
          status: 400,
          message: 'Uno o más productos no existen o están inactivos',
          data: null,
        };
      }

      if (product.currentStock < item.quantity) {
        return {
          status: 400,
          message: `Stock insuficiente para ${product.name}. Disponible: ${product.currentStock}, Requerido: ${item.quantity}`,
          data: null,
        };
      }
    }

    // Calcular totales (siempre en el servidor)
    const { subtotal, total } = calculateSaleTotals(saleItems);

    // Validar pagos si se proporcionan
    if (salePayments && salePayments.length > 0) {
      const totalPayments = salePayments.reduce(
        (sum, payment) => sum + payment.amount,
        0
      );
      if (Math.abs(totalPayments - total) > 0.01) {
        return {
          status: 400,
          message: 'El total de pagos no coincide con el total de la venta',
          data: null,
        };
      }

      // Verificar métodos de pago
      const paymentMethodIds = [...new Set(salePayments.map((p) => p.paymentMethodId))];
      const paymentMethods = await prisma.paymentMethod.findMany({
        where: {
          id: { in: paymentMethodIds },
          organizationId: orgId,
          isDeleted: false,
          isActive: true,
        },
      });

      if (paymentMethods.length !== paymentMethodIds.length) {
        return {
          status: 400,
          message: 'Uno o más métodos de pago no son válidos',
          data: null,
        };
      }
    }

    // Generar número de venta
    const saleNumber = await generateSaleNumber(saleData.storeId);

    // Crear venta en transacción con timeout aumentado
    const newSale = await prisma.$transaction(
      async (tx) => {
        // Crear la venta (lista blanca de campos; identidad y tenant del actor)
        const sale = await tx.sale.create({
          data: {
            organizationId: orgId,
            storeId: saleData.storeId,
            userId: actor.userId,
            customerId: saleData.customerId ?? null,
            status: saleData.status,
            saleDate: saleData.saleDate ?? new Date(),
            dueDate: saleData.status === 'PENDING' ? saleData.dueDate ?? null : null,
            paidDate: saleData.status === 'PAID' ? new Date() : null,
            notes: saleData.notes ?? null,
            saleNumber,
            subtotal,
            total,
          },
        });

        // Crear items de venta y actualizar stock
        for (const itemData of saleItems) {
          await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: itemData.productId,
              unitMeasureId: itemData.unitMeasureId ?? null,
              quantity: itemData.quantity,
              unitPrice: itemData.unitPrice,
              subtotal: itemData.quantity * itemData.unitPrice,
            },
          });

          // Crear movimiento y actualizar producto
          await createStockMovement(orgId, actor.userId, {
            productId: itemData.productId,
            userId: actor.userId,
            storeId: saleData.storeId,
            type: 'OUT',
            quantity: itemData.quantity,
            reason: `Venta ${sale.saleNumber}`,
            reference: sale.id,
          });
        }

        // Crear pagos si se proporcionan
        if (salePayments && salePayments.length > 0) {
          for (const paymentData of salePayments) {
            await tx.salePayment.create({
              data: {
                saleId: sale.id,
                paymentMethodId: paymentData.paymentMethodId,
                amount: paymentData.amount,
                reference: paymentData.reference ?? null,
                notes: paymentData.notes ?? null,
                paymentDate: paymentData.paymentDate ?? new Date(),
              },
            });
          }
        }

        // Actualizar saleNumber in store
        const store = await prisma.store.findUnique({
          where: { id: saleData.storeId },
        });

        let nextNumber: number = 1;

        if (store?.lastSaleNumber) {
          nextNumber = store.lastSaleNumber + 1;
        }
        await tx.store.update({
          where: { id: saleData.storeId },
          data: {
            lastSaleNumber: nextNumber,
          },
        });

        return tx.sale.findUnique({
          where: { id: sale.id },
          include: saleInclude,
        });
      },
      {
        maxWait: 10000, // Tiempo máximo de espera para adquirir la transacción: 10s
        timeout: 30000, // Tiempo máximo de ejecución de la transacción: 30s
      }
    );

    return {
      status: 201,
      message: 'Venta creada exitosamente',
      data: serializeDecimals(newSale),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error creating sale:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return {
          status: 409,
          message: 'Ya existe una venta con ese número',
          data: null,
        };
      }
      if (error.code === 'P2003') {
        return {
          status: 400,
          message: 'Una de las referencias especificadas no existe',
          data: null,
        };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET SALES (organización del actor)
export const getSales = async (
  filtersInput?: SaleFiltersInput,
  includeDeleted: boolean = false,
  paginationInput?: PaginationInput
): Promise<
  ActionResponse<{ sales: Serialized<Sale>[]; total: number } | null>
> => {
  try {
    const actor = await requireActor();
    const parsedFilters = saleFiltersSchema.safeParse(filtersInput);
    const parsedPagination = paginationSchema.safeParse(paginationInput);
    if (!parsedFilters.success || !parsedPagination.success) {
      return invalidInput('Filtros de ventas inválidos');
    }
    const filters = parsedFilters.data;
    const pagination = parsedPagination.data;

    const whereClause: Prisma.SaleWhereInput = {
      organizationId: actor.organizationId,
      // Solo ADMIN puede ver ventas eliminadas
      isDeleted: includeDeleted === true && actor.role === MembershipRole.ADMIN ? undefined : false,
    };

    // RBAC: SELLER con tienda asignada solo ve las ventas de su tienda
    if (actor.role === MembershipRole.SELLER && actor.storeId) {
      whereClause.storeId = actor.storeId;
    } else if (filters?.storeId) {
      whereClause.storeId = filters.storeId;
    }

    if (filters?.customerId) {
      whereClause.customerId = filters.customerId;
    }

    if (filters?.userId) {
      whereClause.userId = filters.userId;
    }

    if (filters?.status) {
      whereClause.status = filters.status;
    }

    if (filters?.dateFrom || filters?.dateTo) {
      whereClause.saleDate = {};
      if (filters.dateFrom) whereClause.saleDate.gte = filters.dateFrom;
      if (filters.dateTo) whereClause.saleDate.lte = filters.dateTo;
    }

    // Filtro por rango de montos
    if (filters?.minAmount !== undefined || filters?.maxAmount !== undefined) {
      whereClause.total = {};
      if (filters.minAmount !== undefined) {
        whereClause.total.gte = filters.minAmount;
      }
      if (filters.maxAmount !== undefined) {
        whereClause.total.lte = filters.maxAmount;
      }
    }

    // Búsqueda por texto en número de venta, notas y nombre del cliente
    if (filters?.search) {
      whereClause.OR = [
        { saleNumber: { contains: filters.search, mode: 'insensitive' } },
        { notes: { contains: filters.search, mode: 'insensitive' } },
        {
          customer: {
            OR: [
              { firstName: { contains: filters.search, mode: 'insensitive' } },
              { lastName: { contains: filters.search, mode: 'insensitive' } },
              { email: { contains: filters.search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const page = pagination?.page || 1;
    const limit = pagination?.limit || 50;
    const skip = (page - 1) * limit;

    const [total, sales] = await Promise.all([
      prisma.sale.count({ where: whereClause }),
      prisma.sale.findMany({
        where: whereClause,
        include: saleInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      status: 200,
      message: 'Ventas obtenidas exitosamente',
      data: { sales: serializeDecimals(sales), total },
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching sales:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// Definir el tipo de include sin where clauses para una correcta inferencia de tipos
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const saleIncludeForType = {
  store: true,
  customer: true,
  user: { select: saleUserSelect },
  saleItems: {
    include: {
      product: {
        include: {
          brand: true,
          category: true,
          unitMeasure: true,
        },
      },
      unitMeasure: true,
    },
  },
  salePayments: {
    include: {
      paymentMethod: true,
    },
  },
  _count: {
    select: {
      saleItems: true,
      salePayments: true,
    },
  },
} as const satisfies Prisma.SaleInclude;

// Tipo para venta con todas las relaciones incluidas
export type SaleWithRelations = Prisma.SaleGetPayload<{
  include: typeof saleIncludeForType;
}>;

// GET SALE BY ID
export const getSaleById = async (
  saleId: string
): Promise<ActionResponse<Serialized<SaleWithRelations> | null>> => {
  try {
    const actor = await requireActor();
    const id = idSchema.safeParse(saleId);
    if (!id.success) return invalidInput('ID de venta es requerido');

    const sale = await prisma.sale.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      include: saleInclude,
    });

    if (!sale) return saleNotFound();

    return {
      status: 200,
      message: 'Venta obtenida exitosamente',
      data: serializeDecimals(sale) as unknown as Serialized<SaleWithRelations>,
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching sale:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET SALE BY NUMBER
export const getSaleBySaleNumber = async (
  storeId: string,
  saleNumber: string
): Promise<ActionResponse<Serialized<SaleWithRelations> | null>> => {
  try {
    const actor = await requireActor();
    const store = idSchema.safeParse(storeId);
    if (!store.success || typeof saleNumber !== 'string' || !saleNumber.trim() || saleNumber.length > 64) {
      return invalidInput('Número de venta es requerido');
    }

    const sale = await prisma.sale.findFirst({
      where: {
        organizationId: actor.organizationId,
        storeId: store.data,
        saleNumber: saleNumber.trim(),
        isDeleted: false,
      },
      include: saleInclude,
    });

    if (!sale) return saleNotFound();

    return {
      status: 200,
      message: 'Venta obtenida exitosamente',
      data: serializeDecimals(sale) as unknown as Serialized<SaleWithRelations>,
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching sale by number:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// UPDATE SALE (solo ADMIN)
export const updateSale = async (
  saleId: string,
  updateInput: UpdateSaleInput
): Promise<ActionResponse<Serialized<Sale> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(saleId);
    if (!id.success) return invalidInput('ID de venta es requerido');
    const parsed = updateSaleInputSchema.safeParse(updateInput);
    if (!parsed.success) return invalidInput('Datos de venta inválidos');
    const updateData = parsed.data;

    const existingSale = await prisma.sale.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      select: { id: true },
    });

    if (!existingSale) return saleNotFound();

    // Verificar cliente si se está actualizando
    if (updateData.customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: updateData.customerId,
          organizationId: actor.organizationId,
          isDeleted: false,
        },
        select: { id: true },
      });

      if (!customer) {
        return {
          status: 400,
          message: 'El cliente especificado no existe',
          data: null,
        };
      }
    }

    const updatedSale = await prisma.sale.update({
      where: { id: existingSale.id },
      data: {
        customerId: updateData.customerId,
        status: updateData.status,
        dueDate: updateData.dueDate,
        paidDate: updateData.paidDate,
        notes: updateData.notes,
        updatedAt: new Date(),
      },
      include: saleInclude,
    });

    return {
      status: 200,
      message: 'Venta actualizada exitosamente',
      data: serializeDecimals(updatedSale),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error updating sale:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') return saleNotFound();
      if (error.code === 'P2003') {
        return {
          status: 400,
          message: 'Una de las referencias especificadas no existe',
          data: null,
        };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// CANCEL SALE (solo ADMIN)
export const cancelSale = async (
  saleId: string,
  reason?: string
): Promise<ActionResponse<Serialized<Sale> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(saleId);
    if (!id.success) return invalidInput('ID de venta es requerido');
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) {
      return invalidInput('Motivo de cancelación inválido');
    }

    const existingSale = await prisma.sale.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      include: { saleItems: { where: { isDeleted: false } } },
    });

    if (!existingSale) return saleNotFound();

    if (existingSale.status === 'CANCELLED') {
      return {
        status: 400,
        message: 'La venta ya está cancelada',
        data: null,
      };
    }

    // Cancelar venta y restaurar stock en transacción con timeout aumentado
    const cancelledSale = await prisma.$transaction(
      async (tx) => {
        await tx.sale.update({
          where: { id: existingSale.id },
          data: {
            status: 'CANCELLED',
            notes: reason
              ? `${existingSale.notes || ''}\nCANCELADO: ${reason}`
              : existingSale.notes,
            updatedAt: new Date(),
          },
        });

        // Restaurar stock de productos
        for (const item of existingSale.saleItems) {
          await createStockMovement(actor.organizationId, actor.userId, {
            productId: item.productId,
            userId: actor.userId,
            storeId: existingSale.storeId,
            type: 'IN',
            quantity: item.quantity,
            reason: `Cancelación de venta ${existingSale.saleNumber}`,
            reference: existingSale.id,
          });
        }

        return tx.sale.findUnique({
          where: { id: existingSale.id },
          include: saleInclude,
        });
      },
      {
        maxWait: 10000, // Tiempo máximo de espera para adquirir la transacción: 10s
        timeout: 30000, // Tiempo máximo de ejecución de la transacción: 30s
      }
    );

    return {
      status: 200,
      message: 'Venta cancelada exitosamente',
      data: serializeDecimals(cancelledSale),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error cancelling sale:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// SOFT DELETE SALE (solo ADMIN)
export const softDeleteSale = async (saleId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(saleId);
    if (!id.success) return invalidInput('ID de venta es requerido');

    const existingSale = await prisma.sale.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      select: { id: true, status: true },
    });

    if (!existingSale) return saleNotFound();

    if (existingSale.status === 'PAID') {
      return {
        status: 400,
        message:
          'No se puede eliminar una venta pagada. Cancele la venta primero.',
        data: null,
      };
    }

    await prisma.sale.update({
      where: { id: existingSale.id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return {
      status: 200,
      message: 'Venta eliminada (soft) exitosamente',
      data: null,
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error soft deleting sale:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// ===========================
// ANALYTICS AND REPORTS
// ===========================

// GET SALES ANALYTICS
export const getSalesAnalytics = async (
  dateFrom?: Date | string,
  dateTo?: Date | string,
  storeId?: string
): Promise<
  ActionResponse<{
    totalSales: number;
    totalRevenue: number;
    averageSaleAmount: number;
    salesByStatus: { status: SaleStatus; count: number; total: number }[];
    salesByStore: {
      storeId: string;
      storeName: string;
      count: number;
      total: number;
    }[];
    topProducts: {
      productId: string;
      productName: string;
      quantity: number;
      revenue: number;
    }[];
    dailySales: { date: string; count: number; total: number }[];
  } | null>
> => {
  try {
    const actor = await requireActor();
    const parsed = analyticsInputSchema.safeParse({ dateFrom, dateTo, storeId });
    if (!parsed.success) return invalidInput('Filtros de analíticas inválidos');
    const input = parsed.data;
    const orgId = actor.organizationId;

    const whereClause: Prisma.SaleWhereInput = {
      organizationId: orgId,
      isDeleted: false,
    };

    if (input.dateFrom || input.dateTo) {
      whereClause.saleDate = {};
      if (input.dateFrom) whereClause.saleDate.gte = input.dateFrom;
      if (input.dateTo) whereClause.saleDate.lte = input.dateTo;
    }

    if (input.storeId) {
      whereClause.storeId = input.storeId;
    }

    // Agregaciones básicas
    const [totalStats, salesByStatus, salesByStore, topProducts] =
      await Promise.all([
        prisma.sale.aggregate({
          where: whereClause,
          _count: { id: true },
          _sum: { total: true },
          _avg: { total: true },
        }),
        prisma.sale.groupBy({
          by: ['status'],
          where: whereClause,
          _count: { id: true },
          _sum: { total: true },
        }),
        prisma.sale.groupBy({
          by: ['storeId'],
          where: whereClause,
          _count: { id: true },
          _sum: { total: true },
        }),
        prisma.saleItem.groupBy({
          by: ['productId'],
          where: {
            sale: whereClause,
            isDeleted: false,
          },
          _sum: {
            quantity: true,
            subtotal: true,
          },
          orderBy: {
            _sum: {
              subtotal: 'desc',
            },
          },
          take: 10,
        }),
      ]);

    // Obtener información de tiendas y productos (siempre de la organización)
    const storeIds = salesByStore.map((item) => item.storeId);
    const stores = await prisma.store.findMany({
      where: { id: { in: storeIds }, organizationId: orgId },
      select: { id: true, name: true },
    });

    const productIds = topProducts.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, organizationId: orgId },
      select: { id: true, name: true },
    });

    const storeMap = new Map(stores.map((s) => [s.id, s.name]));
    const productMap = new Map(products.map((p) => [p.id, p.name]));

    return {
      status: 200,
      message: 'Analíticas de ventas obtenidas exitosamente',
      data: {
        totalSales: totalStats._count.id,
        totalRevenue: Number(totalStats._sum.total ?? 0),
        averageSaleAmount: Number(totalStats._avg.total ?? 0),
        salesByStatus: salesByStatus.map((item) => ({
          status: item.status,
          count: item._count.id,
          total: Number(item._sum.total ?? 0),
        })),
        salesByStore: salesByStore.map((item) => ({
          storeId: item.storeId,
          storeName: storeMap.get(item.storeId) || 'Tienda desconocida',
          count: item._count.id,
          total: Number(item._sum.total ?? 0),
        })),
        topProducts: topProducts.map((item) => ({
          productId: item.productId,
          productName: productMap.get(item.productId) || 'Producto desconocido',
          quantity: item._sum.quantity || 0,
          revenue: Number(item._sum.subtotal ?? 0),
        })),
        dailySales: [], // Se puede implementar agregación por fecha si es necesario
      },
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching sales analytics:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

const listPendingSales = async (
  actor: Actor,
  storeId: string | undefined,
  overdueOnly: boolean
): Promise<ActionResponse<Serialized<Sale>[] | null>> => {
  try {
    const store = idSchema.optional().safeParse(storeId);
    if (!store.success) return invalidInput('ID de tienda inválido');

    const whereClause: Prisma.SaleWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: false,
      status: 'PENDING',
      ...(overdueOnly ? { dueDate: { lt: new Date() } } : {}),
      ...(store.data ? { storeId: store.data } : {}),
    };

    const sales = await prisma.sale.findMany({
      where: whereClause,
      include: saleInclude,
      orderBy: { dueDate: 'asc' },
    });

    return {
      status: 200,
      message: overdueOnly
        ? 'Ventas vencidas obtenidas exitosamente'
        : 'Ventas pendientes obtenidas exitosamente',
      data: serializeDecimals(sales),
    };
  } catch (error) {
    console.error('Error fetching pending sales:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET PENDING SALES
export const getPendingSales = async (
  storeId?: string
): Promise<ActionResponse<Serialized<Sale>[] | null>> => {
  try {
    return await listPendingSales(await requireActor(), storeId, false);
  } catch (error) {
    return actorErrorResponse(error) ?? internalError();
  }
};

// GET OVERDUE SALES
export const getOverdueSales = async (
  storeId?: string
): Promise<ActionResponse<Serialized<Sale>[] | null>> => {
  try {
    return await listPendingSales(await requireActor(), storeId, true);
  } catch (error) {
    return actorErrorResponse(error) ?? internalError();
  }
};

'use server';

import { Sale, Prisma, SaleStatus, MembershipRole } from '@/generated/prisma';
import { ActionResponse, Serialized } from '@/interfaces';
import { actorErrorResponse, requireActor, type Actor } from '@/lib/auth/actor';
import { prisma, serializeDecimals } from '../utils';
import { cancelSaleForActor, createSaleForActor } from './sale-transaction';
import { saleInclude, saleUserSelect } from './sale.include';
import {
  analyticsInputSchema,
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

// ===========================
// SALE ACTIONS
// ===========================

// CREATE SALE
export const createSale = async (
  input: CreateSaleInput
): Promise<ActionResponse<Serialized<Sale> | null>> => {
  try {
    const actor = await requireActor();
    const result = await createSaleForActor(prisma, actor, input);
    return { ...result, data: result.data && serializeDecimals(result.data) };
  } catch (error) {
    return actorErrorResponse(error) ?? internalError();
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
    const result = await cancelSaleForActor(prisma, actor, saleId, reason);
    return { ...result, data: result.data && serializeDecimals(result.data) };
  } catch (error) {
    return actorErrorResponse(error) ?? internalError();
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

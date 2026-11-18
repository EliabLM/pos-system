'use server';

import { MembershipRole, Prisma, Purchase, PurchaseStatus } from '@/generated/prisma';
import { ActionResponse, Serialized } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { businessDayCompact } from '@/lib/time';
import { prisma, serializeDecimals } from '../utils';
import { firstIssue, idSchema, internalError, invalidInput, paginationSchema, type PaginationInput } from '../common.schemas';
import {
  cancelReasonSchema,
  createPurchaseInputSchema,
  dateRangeSchema,
  purchaseFiltersSchema,
  purchaseNumberSchema,
  updatePurchaseInputSchema,
  type CreatePurchaseInput,
  type PurchaseFiltersInput,
  type UpdatePurchaseInput,
} from './purchase.schemas';

// Purchases are administration only (lib/rbac.ts): the seller has no
// purchases screen and does not need them to sell.
const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

// PURCHASE INCLUDES
const purchaseInclude = {
  supplier: true,
  purchaseItems: {
    where: { isDeleted: false },
    include: {
      product: {
        include: {
          brand: true,
          category: true,
          unitMeasure: true,
        },
      },
    },
  },
  _count: {
    select: { purchaseItems: true },
  },
} satisfies Prisma.PurchaseInclude;

// ===========================
// UTILITY FUNCTIONS
// ===========================

// Generate after acquiring the transaction lock: the date may change while waiting.
const generatePurchaseNumber = async (
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<{ purchaseNumber: string; createdAt: Date }> => {
  // A stable per-tenant lock also serializes different days of this tenant.
  // Hash collisions only add contention; the MAX query remains tenant-scoped.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}::text, 0))::text`;

  const createdAt = new Date();
  // Business day in America/Bogota, not the UTC day (after 19:00 they differ).
  const day = businessDayCompact(createdAt);
  const prefix = `COMP-${day}-`;
  const pattern = `^COMP-${day}-[0-9]{4,}$`;
  // Read all matching numbers, including soft-deleted rows and historical gaps.
  // Numeric (not bigint) preserves arbitrarily large valid suffixes.
  const [row] = await tx.$queryRaw<{ ordinal: Prisma.Decimal }[]>`
    SELECT COALESCE(MAX(SUBSTRING(purchase_number FROM ${prefix.length + 1}::integer)::numeric), 0) AS ordinal
    FROM purchases
    WHERE organization_id = ${organizationId}::uuid
      AND purchase_number ~ ${pattern}
  `;
  const next = BigInt(row.ordinal.toString()) + BigInt(1);
  return { purchaseNumber: `${prefix}${String(next).padStart(4, '0')}`, createdAt };
};

const purchaseNotFound = () => ({ status: 404, message: 'Compra no encontrada', data: null }) as const;
const invalidPurchaseId = () => invalidInput('ID de compra es requerido');

/** Business rule violations inside a transaction, returned as 400. */
class PurchaseRuleError extends Error {}

const handleError = (error: unknown, context: string) => {
  const denied = actorErrorResponse(error);
  if (denied) return denied;
  if (error instanceof PurchaseRuleError) return invalidInput(error.message);
  console.error(`Error ${context}:`, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return { status: 409, message: 'Ya existe una compra con ese número', data: null } as const;
    if (error.code === 'P2003') {
      return { status: 400, message: 'Una de las referencias especificadas no existe', data: null } as const;
    }
    if (error.code === 'P2025') return purchaseNotFound();
  }
  return internalError();
};

// Tipo de include sin where para la inferencia de tipos
type PurchaseIncludeForType = {
  supplier: true;
  purchaseItems: {
    include: {
      product: {
        include: {
          brand: true;
          category: true;
          unitMeasure: true;
        };
      };
    };
  };
  _count: {
    select: { purchaseItems: true };
  };
};

// Compra con todas las relaciones incluidas
export type PurchaseWithRelations = Prisma.PurchaseGetPayload<{
  include: PurchaseIncludeForType;
}>;

// ===========================
// PURCHASE ACTIONS
// ===========================

// CREATE
export const createPurchase = async (
  purchaseData: CreatePurchaseInput['purchaseData'],
  purchaseItems: CreatePurchaseInput['purchaseItems']
): Promise<ActionResponse<Serialized<Purchase> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsed = createPurchaseInputSchema.safeParse({ purchaseData, purchaseItems });
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const { purchaseData: data, purchaseItems: items } = parsed.data;
    const organizationId = actor.organizationId;

    const supplier = await prisma.supplier.findFirst({
      where: { id: data.supplierId, organizationId, isDeleted: false },
      select: { id: true },
    });
    if (!supplier) return invalidInput('El proveedor especificado no existe');

    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, organizationId, isDeleted: false, isActive: true },
      select: { id: true },
    });
    if (products.length !== productIds.length) {
      return invalidInput('Uno o más productos no existen o están inactivos');
    }

    // Totals come from the items, never from the client.
    const lines = items.map((item) => ({ ...item, subtotal: item.quantity * item.unitPrice }));
    const total = lines.reduce((sum, line) => sum + line.subtotal, 0);

    // Number, purchase and items share a transaction and its advisory lock.
    const newPurchase = await prisma.$transaction(
      async (tx) => {
        const { purchaseNumber, createdAt } = await generatePurchaseNumber(tx, organizationId);
        const purchase = await tx.purchase.create({
          data: {
            supplierId: data.supplierId,
            purchaseDate: data.purchaseDate,
            notes: data.notes ?? null,
            status: 'PENDING',
            organizationId,
            purchaseNumber,
            createdAt,
            total,
          },
        });

        for (const line of lines) {
          await tx.purchaseItem.create({
            data: {
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              subtotal: line.subtotal,
              purchaseId: purchase.id,
            },
          });
        }

        return tx.purchase.findUnique({
          where: { id: purchase.id },
          include: purchaseInclude,
        });
      },
      { maxWait: 10000, timeout: 30000 }
    );

    return { status: 201, message: 'Compra creada exitosamente', data: serializeDecimals(newPurchase) };
  } catch (error) {
    return handleError(error, 'creating purchase');
  }
};

// GET MANY
export const getPurchases = async (
  filters?: PurchaseFiltersInput,
  includeDeleted: boolean = false,
  pagination?: PaginationInput
): Promise<ActionResponse<{ purchases: Serialized<Purchase>[]; total: number } | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsedFilters = purchaseFiltersSchema.safeParse(filters);
    const parsedPagination = paginationSchema.safeParse(pagination);
    if (!parsedFilters.success || !parsedPagination.success) return invalidInput();
    const f = parsedFilters.data;

    const whereClause: Prisma.PurchaseWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: includeDeleted === true ? undefined : false,
    };
    if (f?.supplierId) whereClause.supplierId = f.supplierId;
    if (f?.status) whereClause.status = f.status;
    if (f?.dateFrom || f?.dateTo) whereClause.purchaseDate = { gte: f.dateFrom, lte: f.dateTo };
    if (f?.minAmount !== undefined || f?.maxAmount !== undefined) {
      whereClause.total = { gte: f.minAmount, lte: f.maxAmount };
    }
    if (f?.search) {
      whereClause.OR = [
        { purchaseNumber: { contains: f.search, mode: 'insensitive' } },
        { notes: { contains: f.search, mode: 'insensitive' } },
        { supplier: { name: { contains: f.search, mode: 'insensitive' } } },
      ];
    }

    const page = parsedPagination.data?.page ?? 1;
    const limit = parsedPagination.data?.limit ?? 50;

    const [total, purchases] = await Promise.all([
      prisma.purchase.count({ where: whereClause }),
      prisma.purchase.findMany({
        where: whereClause,
        include: purchaseInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      status: 200,
      message: 'Compras obtenidas exitosamente',
      data: { purchases: serializeDecimals(purchases), total },
    };
  } catch (error) {
    return handleError(error, 'fetching purchases');
  }
};

// GET BY ID
export const getPurchaseById = async (
  purchaseId: string
): Promise<ActionResponse<Serialized<PurchaseWithRelations> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(purchaseId);
    if (!id.success) return invalidPurchaseId();

    const purchase = await prisma.purchase.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      include: purchaseInclude,
    });
    if (!purchase) return purchaseNotFound();

    return {
      status: 200,
      message: 'Compra obtenida exitosamente',
      data: serializeDecimals(purchase) as unknown as Serialized<PurchaseWithRelations>,
    };
  } catch (error) {
    return handleError(error, 'fetching purchase');
  }
};

// GET BY NUMBER
export const getPurchaseByNumber = async (
  purchaseNumber: string
): Promise<ActionResponse<Serialized<PurchaseWithRelations> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const number = purchaseNumberSchema.safeParse(purchaseNumber);
    if (!number.success) return invalidInput(firstIssue(number.error));

    const purchase = await prisma.purchase.findFirst({
      where: { organizationId: actor.organizationId, purchaseNumber: number.data, isDeleted: false },
      include: purchaseInclude,
    });
    if (!purchase) return purchaseNotFound();

    return {
      status: 200,
      message: 'Compra obtenida exitosamente',
      data: serializeDecimals(purchase) as unknown as Serialized<PurchaseWithRelations>,
    };
  } catch (error) {
    return handleError(error, 'fetching purchase by number');
  }
};

// UPDATE (only the notes; status changes go through receive/cancel)
export const updatePurchase = async (
  purchaseId: string,
  input: UpdatePurchaseInput
): Promise<ActionResponse<Serialized<Purchase> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(purchaseId);
    if (!id.success) return invalidPurchaseId();
    const parsed = updatePurchaseInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.purchase.findFirst({ where, select: { id: true } });
    if (!existing) return purchaseNotFound();

    const updatedPurchase = await prisma.purchase.update({
      where,
      data: { notes: parsed.data.notes, updatedAt: new Date() },
      include: purchaseInclude,
    });

    return { status: 200, message: 'Compra actualizada exitosamente', data: serializeDecimals(updatedPurchase) };
  } catch (error) {
    return handleError(error, 'updating purchase');
  }
};

// RECEIVE - updates stock and records the movements
export const receivePurchase = async (purchaseId: string): Promise<ActionResponse<Serialized<Purchase> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(purchaseId);
    if (!id.success) return invalidPurchaseId();
    const organizationId = actor.organizationId;

    const where = { id: id.data, organizationId, isDeleted: false };
    const existing = await prisma.purchase.findFirst({
      where,
      include: { purchaseItems: { where: { isDeleted: false } } },
    });
    if (!existing) return purchaseNotFound();

    if (existing.status !== 'PENDING') {
      return invalidInput(`No se puede recibir una compra en estado ${existing.status}`);
    }

    const receivedPurchase = await prisma.$transaction(
      async (tx) => {
        // The PENDING condition makes a concurrent second receive fail (P2025).
        await tx.purchase.update({
          where: { ...where, status: 'PENDING' },
          data: { status: 'RECEIVED', receivedDate: new Date(), updatedAt: new Date() },
        });

        for (const item of existing.purchaseItems) {
          const productWhere = { id: item.productId, organizationId, isDeleted: false };
          const product = await tx.product.findUnique({ where: productWhere, select: { currentStock: true } });
          if (!product) throw new PurchaseRuleError(`Producto ${item.productId} no encontrado`);

          const previousStock = product.currentStock;
          const newStock = previousStock + item.quantity;

          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              userId: actor.userId,
              storeId: null, // Las compras son a nivel de organización, no de tienda
              type: 'IN',
              quantity: item.quantity,
              previousStock,
              newStock,
              reason: `Recepción de compra ${existing.purchaseNumber}`,
              reference: existing.id,
              organizationId,
            },
          });

          await tx.product.update({
            where: productWhere,
            data: { currentStock: newStock, updatedAt: new Date() },
          });
        }

        return tx.purchase.findUnique({ where, include: purchaseInclude });
      },
      { maxWait: 10000, timeout: 30000 }
    );

    return {
      status: 200,
      message: 'Compra recibida exitosamente. El inventario ha sido actualizado.',
      data: serializeDecimals(receivedPurchase),
    };
  } catch (error) {
    return handleError(error, 'receiving purchase');
  }
};

// CANCEL (does not revert stock: business decision)
export const cancelPurchase = async (
  purchaseId: string,
  reason?: string
): Promise<ActionResponse<Serialized<Purchase> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(purchaseId);
    if (!id.success) return invalidPurchaseId();
    const cancelReason = cancelReasonSchema.safeParse(reason);
    if (!cancelReason.success) return invalidInput(firstIssue(cancelReason.error));

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.purchase.findFirst({ where, select: { status: true, notes: true } });
    if (!existing) return purchaseNotFound();

    if (existing.status === 'CANCELLED') return invalidInput('La compra ya está cancelada');

    const cancelledPurchase = await prisma.purchase.update({
      where,
      data: {
        status: 'CANCELLED',
        notes: cancelReason.data ? `${existing.notes || ''}\nCANCELADO: ${cancelReason.data}` : existing.notes,
        updatedAt: new Date(),
      },
      include: purchaseInclude,
    });

    return { status: 200, message: 'Compra cancelada exitosamente', data: serializeDecimals(cancelledPurchase) };
  } catch (error) {
    return handleError(error, 'cancelling purchase');
  }
};

// SOFT DELETE (only PENDING purchases)
export const softDeletePurchase = async (purchaseId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(purchaseId);
    if (!id.success) return invalidPurchaseId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.purchase.findFirst({ where, select: { status: true } });
    if (!existing) return purchaseNotFound();

    if (existing.status !== 'PENDING') {
      return invalidInput('Solo se pueden eliminar compras en estado PENDING');
    }

    await prisma.purchase.update({
      where,
      data: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
    });

    return { status: 200, message: 'Compra eliminada (soft) exitosamente', data: null };
  } catch (error) {
    return handleError(error, 'soft deleting purchase');
  }
};

// ===========================
// ANALYTICS AND REPORTS
// ===========================

// ANALYTICS
export const getPurchasesAnalytics = async (
  dateFrom?: Date | string,
  dateTo?: Date | string
): Promise<
  ActionResponse<{
    totalPurchases: number;
    totalSpent: number;
    averagePurchaseAmount: number;
    purchasesByStatus: {
      status: PurchaseStatus;
      count: number;
      total: number;
    }[];
  } | null>
> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const range = dateRangeSchema.safeParse({ dateFrom, dateTo });
    if (!range.success) return invalidInput();

    const whereClause: Prisma.PurchaseWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: false,
    };
    if (range.data.dateFrom || range.data.dateTo) {
      whereClause.purchaseDate = { gte: range.data.dateFrom, lte: range.data.dateTo };
    }

    const [totalStats, purchasesByStatus] = await Promise.all([
      prisma.purchase.aggregate({
        where: whereClause,
        _count: { id: true },
        _sum: { total: true },
        _avg: { total: true },
      }),
      prisma.purchase.groupBy({
        by: ['status'],
        where: whereClause,
        _count: { id: true },
        _sum: { total: true },
      }),
    ]);

    return {
      status: 200,
      message: 'Analíticas de compras obtenidas exitosamente',
      data: {
        totalPurchases: totalStats._count.id,
        totalSpent: Number(totalStats._sum.total ?? 0),
        averagePurchaseAmount: Number(totalStats._avg.total ?? 0),
        purchasesByStatus: purchasesByStatus.map((item) => ({
          status: item.status,
          count: item._count.id,
          total: Number(item._sum.total ?? 0),
        })),
      },
    };
  } catch (error) {
    return handleError(error, 'fetching purchases analytics');
  }
};

// PENDING
export const getPendingPurchases = async (): Promise<ActionResponse<Serialized<Purchase>[] | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const pendingPurchases = await prisma.purchase.findMany({
      where: { organizationId: actor.organizationId, isDeleted: false, status: 'PENDING' },
      include: purchaseInclude,
      orderBy: { purchaseDate: 'asc' },
    });

    return {
      status: 200,
      message: 'Compras pendientes obtenidas exitosamente',
      data: serializeDecimals(pendingPurchases),
    };
  } catch (error) {
    return handleError(error, 'fetching pending purchases');
  }
};

// RECEIVED
export const getReceivedPurchases = async (): Promise<ActionResponse<Serialized<Purchase>[] | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const receivedPurchases = await prisma.purchase.findMany({
      where: { organizationId: actor.organizationId, isDeleted: false, status: 'RECEIVED' },
      include: purchaseInclude,
      orderBy: { receivedDate: 'desc' },
    });

    return {
      status: 200,
      message: 'Compras recibidas obtenidas exitosamente',
      data: serializeDecimals(receivedPurchases),
    };
  } catch (error) {
    return handleError(error, 'fetching received purchases');
  }
};

'use server';

import { MembershipRole, Prisma, StockMovement, StockMovementType } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import {
  firstIssue,
  idSchema,
  internalError,
  invalidInput,
  paginationSchema,
  type PaginationInput,
} from '../common.schemas';
import { recordStockMovement, StockMovementError } from './record-stock-movement';
import { stockMovementInclude, type StockMovementWithRelations } from './stock-movement.include';
import {
  createStockMovementInputSchema,
  dateRangeFiltersSchema,
  optionalDate,
  requiredDate,
  stockMovementFiltersSchema,
  updateStockMovementInputSchema,
  type CreateStockMovementInput,
  type DateRangeFiltersInput,
  type StockMovementFiltersInput,
  type UpdateStockMovementInput,
} from './stock-movement.schemas';

export type { StockMovementWithRelations } from './stock-movement.include';

/** Inventory (movements, summaries, analytics) is ADMIN only, reads included. */
const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

const movementNotFound = () =>
  ({ status: 404, message: 'Movimiento de stock no encontrado', data: null }) as const;
const productNotFound = () => ({ status: 404, message: 'Producto no encontrado', data: null }) as const;
const invalidMovementId = () => invalidInput('ID del movimiento de stock es requerido');
const invalidProductId = () => invalidInput('ID del producto es requerido');

const handleError = (error: unknown, context: string) => {
  const denied = actorErrorResponse(error);
  if (denied) return denied;
  console.error(`Error ${context}:`, error);
  return internalError();
};

const storeBelongsTo = async (storeId: string, organizationId: string) =>
  !!(await prisma.store.findFirst({
    where: { id: storeId, organizationId, isDeleted: false },
    select: { id: true },
  }));

const findOrgProduct = (productId: string, organizationId: string) =>
  prisma.product.findFirst({
    where: { id: productId, organizationId, isDeleted: false },
    select: { id: true, currentStock: true },
  });

// CREATE
export const createStockMovement = async (
  input: CreateStockMovementInput
): Promise<ActionResponse<StockMovement | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsed = createStockMovementInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const movement = parsed.data;

    if (movement.storeId && !(await storeBelongsTo(movement.storeId, actor.organizationId))) {
      return invalidInput('La tienda especificada no existe');
    }

    const created = await prisma.$transaction((tx) =>
      recordStockMovement(tx, actor.organizationId, actor.userId, movement)
    );
    return { status: 201, message: 'Movimiento de stock creado exitosamente', data: created };
  } catch (error) {
    if (error instanceof StockMovementError) return invalidInput(error.message);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return invalidInput('Una de las referencias especificadas no existe');
    }
    return handleError(error, 'creating stock movement');
  }
};

// GET MANY
export const getStockMovements = async (
  filters?: StockMovementFiltersInput,
  pagination?: PaginationInput
): Promise<ActionResponse<{ movements: StockMovement[]; total: number } | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsedFilters = stockMovementFiltersSchema.safeParse(filters);
    const parsedPagination = paginationSchema.safeParse(pagination);
    if (!parsedFilters.success || !parsedPagination.success) return invalidInput('Filtros inválidos');
    const f = parsedFilters.data;

    const whereClause: Prisma.StockMovementWhereInput = {
      organizationId: actor.organizationId,
    };
    if (f?.productId) whereClause.productId = f.productId;
    if (f?.type) whereClause.type = f.type;
    if (f?.userId) whereClause.userId = f.userId;
    if (f?.storeId) whereClause.storeId = f.storeId;
    if (f?.dateFrom || f?.dateTo) {
      whereClause.createdAt = {};
      if (f.dateFrom) whereClause.createdAt.gte = f.dateFrom;
      if (f.dateTo) whereClause.createdAt.lte = f.dateTo;
    }
    if (f?.search) {
      whereClause.OR = [
        { reason: { contains: f.search, mode: 'insensitive' } },
        { reference: { contains: f.search, mode: 'insensitive' } },
        { product: { name: { contains: f.search, mode: 'insensitive' } } },
      ];
    }

    const page = parsedPagination.data?.page || 1;
    const limit = parsedPagination.data?.limit || 50;

    const [total, movements] = await Promise.all([
      prisma.stockMovement.count({ where: whereClause }),
      prisma.stockMovement.findMany({
        where: whereClause,
        include: stockMovementInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      status: 200,
      message: 'Movimientos de stock obtenidos exitosamente',
      data: { movements, total },
    };
  } catch (error) {
    return handleError(error, 'fetching stock movements');
  }
};

// GET ONE
export const getStockMovementById = async (
  movementId: string
): Promise<ActionResponse<StockMovementWithRelations | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(movementId);
    if (!id.success) return invalidMovementId();

    const movement = await prisma.stockMovement.findFirst({
      where: { id: id.data, organizationId: actor.organizationId },
      include: stockMovementInclude,
    });
    if (!movement) return movementNotFound();

    return { status: 200, message: 'Movimiento de stock obtenido exitosamente', data: movement };
  } catch (error) {
    return handleError(error, 'fetching stock movement');
  }
};

// GET BY PRODUCT
export const getStockMovementsByProductId = async (
  productId: string,
  pagination?: PaginationInput
): Promise<ActionResponse<{ movements: StockMovement[]; total: number } | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(productId);
    const parsedPagination = paginationSchema.safeParse(pagination);
    if (!id.success) return invalidProductId();
    if (!parsedPagination.success) return invalidInput('Paginación inválida');

    const product = await findOrgProduct(id.data, actor.organizationId);
    if (!product) return productNotFound();

    const page = parsedPagination.data?.page || 1;
    const limit = parsedPagination.data?.limit || 50;
    const where = { organizationId: actor.organizationId, productId: product.id };

    const [total, movements] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        include: stockMovementInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      status: 200,
      message: 'Movimientos de stock del producto obtenidos exitosamente',
      data: { movements, total },
    };
  } catch (error) {
    return handleError(error, 'fetching stock movements by product');
  }
};

// UPDATE (only descriptive fields; quantity and type never change)
export const updateStockMovement = async (
  movementId: string,
  input: UpdateStockMovementInput
): Promise<ActionResponse<StockMovement | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(movementId);
    if (!id.success) return invalidMovementId();
    const parsed = updateStockMovementInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));

    const updates = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined)
    );
    if (Object.keys(updates).length === 0) {
      return { status: 400, message: 'No hay campos válidos para actualizar', data: null };
    }

    const where = { id: id.data, organizationId: actor.organizationId };
    const existing = await prisma.stockMovement.findFirst({ where, select: { id: true } });
    if (!existing) return movementNotFound();

    if (parsed.data.storeId && !(await storeBelongsTo(parsed.data.storeId, actor.organizationId))) {
      return invalidInput('La tienda especificada no existe');
    }

    const updatedMovement = await prisma.stockMovement.update({
      where,
      data: updates,
      include: stockMovementInclude,
    });

    return { status: 200, message: 'Movimiento de stock actualizado exitosamente', data: updatedMovement };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return movementNotFound();
    }
    return handleError(error, 'updating stock movement');
  }
};

// GET STOCK SUMMARY BY PRODUCT
export const getStockSummaryByProduct = async (
  productId: string
): Promise<ActionResponse<{
  currentStock: number;
  totalIn: number;
  totalOut: number;
  recentMovements: StockMovement[];
} | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(productId);
    if (!id.success) return invalidProductId();

    const product = await findOrgProduct(id.data, actor.organizationId);
    if (!product) return productNotFound();

    const where = { organizationId: actor.organizationId, productId: product.id };
    const [totalInResult, totalOutResult, recentMovements] = await Promise.all([
      prisma.stockMovement.aggregate({ where: { ...where, type: 'IN' }, _sum: { quantity: true } }),
      prisma.stockMovement.aggregate({ where: { ...where, type: 'OUT' }, _sum: { quantity: true } }),
      prisma.stockMovement.findMany({
        where,
        include: stockMovementInclude,
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      status: 200,
      message: 'Resumen de stock obtenido exitosamente',
      data: {
        currentStock: product.currentStock,
        totalIn: totalInResult._sum.quantity || 0,
        totalOut: totalOutResult._sum.quantity || 0,
        recentMovements,
      },
    };
  } catch (error) {
    return handleError(error, 'fetching stock summary');
  }
};

// DELETE (only the last movement of the product; reverts its stock)
export const deleteStockMovement = async (movementId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(movementId);
    if (!id.success) return invalidMovementId();
    const organizationId = actor.organizationId;

    const movement = await prisma.stockMovement.findFirst({
      where: { id: id.data, organizationId },
    });
    if (!movement) return movementNotFound();

    const lastMovement = await prisma.stockMovement.findFirst({
      where: { organizationId, productId: movement.productId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (lastMovement?.id !== movement.id) {
      return {
        status: 409,
        message: 'Solo se puede eliminar el último movimiento de stock registrado',
        data: null,
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: movement.productId, organizationId },
        data: { currentStock: movement.previousStock, updatedAt: new Date() },
      });
      await tx.stockMovement.delete({ where: { id: movement.id, organizationId } });
    });

    return { status: 200, message: 'Movimiento de stock eliminado exitosamente', data: null };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return movementNotFound();
    }
    return handleError(error, 'deleting stock movement');
  }
};

// GET MOVEMENTS BY DATE RANGE
export const getStockMovementsByDateRange = async (
  dateFrom: Date,
  dateTo: Date,
  filters?: DateRangeFiltersInput
): Promise<ActionResponse<StockMovement[] | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const from = requiredDate.safeParse(dateFrom);
    const to = requiredDate.safeParse(dateTo);
    const parsedFilters = dateRangeFiltersSchema.safeParse(filters);
    if (!from.success || !to.success || !parsedFilters.success) return invalidInput('Filtros inválidos');

    const whereClause: Prisma.StockMovementWhereInput = {
      organizationId: actor.organizationId,
      createdAt: { gte: from.data, lte: to.data },
    };
    if (parsedFilters.data?.productId) whereClause.productId = parsedFilters.data.productId;
    if (parsedFilters.data?.type) whereClause.type = parsedFilters.data.type;

    const movements = await prisma.stockMovement.findMany({
      where: whereClause,
      include: stockMovementInclude,
      orderBy: { createdAt: 'desc' },
    });

    return {
      status: 200,
      message: 'Movimientos de stock por rango de fecha obtenidos exitosamente',
      data: movements,
    };
  } catch (error) {
    return handleError(error, 'fetching stock movements by date range');
  }
};

// GET STOCK ANALYTICS
export const getStockAnalytics = async (
  dateFrom?: Date,
  dateTo?: Date
): Promise<ActionResponse<{
  movementsByType: { type: StockMovementType; count: number; totalQuantity: number }[];
  movementsByDate: { date: string; totalIn: number; totalOut: number }[];
  topMovedProducts: { productId: string; productName: string; totalMovements: number }[];
} | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const from = optionalDate.safeParse(dateFrom);
    const to = optionalDate.safeParse(dateTo);
    if (!from.success || !to.success) return invalidInput('Fechas inválidas');
    const organizationId = actor.organizationId;

    const whereClause: Prisma.StockMovementWhereInput = { organizationId };
    if (from.data || to.data) {
      whereClause.createdAt = {};
      if (from.data) whereClause.createdAt.gte = from.data;
      if (to.data) whereClause.createdAt.lte = to.data;
    }

    const movementsByType = await prisma.stockMovement.groupBy({
      by: ['type'],
      where: whereClause,
      _count: { id: true },
      _sum: { quantity: true },
    });

    const topMovedProducts = await prisma.stockMovement.groupBy({
      by: ['productId'],
      where: whereClause,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    const products = await prisma.product.findMany({
      where: { organizationId, id: { in: topMovedProducts.map((item) => item.productId) } },
      select: { id: true, name: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p.name]));

    return {
      status: 200,
      message: 'Analíticas de stock obtenidas exitosamente',
      data: {
        movementsByType: movementsByType.map((item) => ({
          type: item.type,
          count: item._count.id,
          totalQuantity: item._sum.quantity || 0,
        })),
        movementsByDate: [], // Se podría implementar una agregación por fecha si es necesario
        topMovedProducts: topMovedProducts.map((item) => ({
          productId: item.productId,
          productName: productMap.get(item.productId) || 'Producto desconocido',
          totalMovements: item._count.id,
        })),
      },
    };
  } catch (error) {
    return handleError(error, 'fetching stock analytics');
  }
};

'use server';

import { MembershipRole, Store, Prisma } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { firstIssue, idSchema, internalError, invalidInput } from '../common.schemas';
import {
  createStoreInputSchema,
  updateStoreInputSchema,
  type CreateStoreInput,
  type UpdateStoreInput,
} from './store.schemas';
import { prisma } from '../utils';

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

/** User fields safe to send to the browser (never the password hash). */
const safeUserSelect = { id: true, name: true, email: true } satisfies Prisma.UserSelect;

const invalidStoreId = () => invalidInput('ID de la tienda es requerido');
const duplicateName = () =>
  ({ status: 409, message: 'Ya existe una tienda con ese nombre en la organización', data: null }) as const;
const storeNotFound = () => ({ status: 404, message: 'Tienda no encontrada', data: null }) as const;

const handleError = (error: unknown, context: string) => {
  const denied = actorErrorResponse(error);
  if (denied) return denied;
  console.error(`Error ${context}:`, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return duplicateName();
    if (error.code === 'P2025') return storeNotFound();
    if (error.code === 'P2003') {
      return { status: 409, message: 'No se puede eliminar la tienda debido a relaciones existentes', data: null } as const;
    }
  }
  return internalError();
};


// CREATE (ADMIN)
export const createStore = async (input: CreateStoreInput): Promise<ActionResponse<Store | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsed = createStoreInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));

    const existingStore = await prisma.store.findFirst({
      where: { organizationId: actor.organizationId, name: parsed.data.name, isDeleted: false },
      select: { id: true },
    });
    if (existingStore) return duplicateName();

    const newStore = await prisma.store.create({
      data: { ...parsed.data, organizationId: actor.organizationId, lastSaleNumber: 0 },
    });

    return { status: 201, message: 'Tienda creada exitosamente', data: newStore };
  } catch (error) {
    return handleError(error, 'creating store');
  }
};

// GET MANY (any member: the seller picks a store while selling, only active ones)
export const getStores = async (
  isActive?: boolean,
  includeDeleted: boolean = false
): Promise<ActionResponse<Store[] | null>> => {
  try {
    const actor = await requireActor();
    const isAdmin = actor.role === MembershipRole.ADMIN;

    const whereClause: Prisma.StoreWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: isAdmin && includeDeleted === true ? undefined : false,
    };
    if (!isAdmin) whereClause.isActive = true;
    else if (typeof isActive === 'boolean') whereClause.isActive = isActive;

    const stores = await prisma.store.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    return { status: 200, message: 'Tiendas obtenidas exitosamente', data: stores };
  } catch (error) {
    return handleError(error, 'fetching stores');
  }
};

// GET ONE (any member; the seller only sees active stores)
export const getStoreById = async (storeId: string): Promise<ActionResponse<Store | null>> => {
  try {
    const actor = await requireActor();
    const id = idSchema.safeParse(storeId);
    if (!id.success) return invalidStoreId();

    const store = await prisma.store.findFirst({
      where: {
        id: id.data,
        organizationId: actor.organizationId,
        isDeleted: false,
        ...(actor.role === MembershipRole.ADMIN ? {} : { isActive: true }),
      },
    });
    if (!store) return storeNotFound();

    return { status: 200, message: 'Tienda obtenida exitosamente', data: store };
  } catch (error) {
    return handleError(error, 'fetching store');
  }
};

// GET STORE WITH DETAILED SALES INFO (ADMIN)
export const getStoreWithSalesInfo = async (storeId: string): Promise<ActionResponse<Store | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(storeId);
    if (!id.success) return invalidStoreId();

    const store = await prisma.store.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      include: {
        memberships: {
          where: { deletedAt: null, status: 'ACTIVE' },
          include: { user: { select: safeUserSelect } },
        },
        sales: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: true,
            user: { select: safeUserSelect },
            _count: { select: { saleItems: true } },
          },
        },
        _count: { select: { sales: true, memberships: true } },
      },
    });
    if (!store) return storeNotFound();

    return { status: 200, message: 'Tienda con información de ventas obtenida exitosamente', data: store };
  } catch (error) {
    return handleError(error, 'fetching store with sales info');
  }
};

// UPDATE (ADMIN)
export const updateStore = async (
  storeId: string,
  input: UpdateStoreInput
): Promise<ActionResponse<Store | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(storeId);
    if (!id.success) return invalidStoreId();
    const parsed = updateStoreInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.store.findFirst({ where, select: { id: true, name: true } });
    if (!existing) return storeNotFound();

    if (parsed.data.name && parsed.data.name !== existing.name) {
      const duplicate = await prisma.store.findFirst({
        where: { organizationId: actor.organizationId, name: parsed.data.name, isDeleted: false, id: { not: id.data } },
        select: { id: true },
      });
      if (duplicate) return duplicateName();
    }

    const updatedStore = await prisma.store.update({
      where,
      data: { ...parsed.data, updatedAt: new Date() },
    });

    return { status: 200, message: 'Tienda actualizada exitosamente', data: updatedStore };
  } catch (error) {
    return handleError(error, 'updating store');
  }
};

// GET NEXT SALE NUMBER (any member, without incrementing)
export const getNextSaleNumber = async (
  storeId: string
): Promise<
  ActionResponse<{
    nextSaleNumber: number;
    saleNumberPrefix: string;
    fullSaleNumber: string;
  } | null>
> => {
  try {
    const actor = await requireActor();
    const id = idSchema.safeParse(storeId);
    if (!id.success) return invalidStoreId();

    const store = await prisma.store.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      select: { lastSaleNumber: true, saleNumberPrefix: true },
    });
    if (!store) return storeNotFound();

    const nextNumber = store.lastSaleNumber + 1;
    const fullSaleNumber = `${store.saleNumberPrefix}${nextNumber.toString().padStart(4, '0')}`;

    return {
      status: 200,
      message: 'Siguiente número de venta obtenido exitosamente',
      data: { nextSaleNumber: nextNumber, saleNumberPrefix: store.saleNumberPrefix, fullSaleNumber },
    };
  } catch (error) {
    return handleError(error, 'getting next sale number');
  }
};

// SOFT DELETE (ADMIN)
export const softDeleteStore = async (storeId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(storeId);
    if (!id.success) return invalidStoreId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.store.findFirst({ where, select: { id: true } });
    if (!existing) return storeNotFound();

    const salesCount = await prisma.sale.count({
      where: { storeId: id.data, organizationId: actor.organizationId },
    });
    if (salesCount > 0) {
      return {
        status: 409,
        message: `No se puede eliminar la tienda. Tiene ${salesCount} venta(s) asociada(s)`,
        data: null,
      };
    }

    await prisma.store.update({
      where,
      data: { isDeleted: true, deletedAt: new Date(), isActive: false, updatedAt: new Date() },
    });

    return { status: 200, message: 'Tienda eliminada (soft) exitosamente', data: null };
  } catch (error) {
    return handleError(error, 'soft deleting store');
  }
};

// RESTORE (ADMIN)
export const restoreStore = async (storeId: string): Promise<ActionResponse<Store | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(storeId);
    if (!id.success) return invalidStoreId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: true };
    const existing = await prisma.store.findFirst({ where, select: { id: true } });
    if (!existing) return storeNotFound();

    const restoredStore = await prisma.store.update({
      where,
      data: { isDeleted: false, deletedAt: null, updatedAt: new Date() },
    });

    return { status: 200, message: 'Tienda restaurada exitosamente', data: restoredStore };
  } catch (error) {
    return handleError(error, 'restoring store');
  }
};

// HARD DELETE (ADMIN)
export const deleteStore = async (storeId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(storeId);
    if (!id.success) return invalidStoreId();

    const where = { id: id.data, organizationId: actor.organizationId };
    const existing = await prisma.store.findFirst({ where, select: { id: true } });
    if (!existing) return storeNotFound();

    const salesCount = await prisma.sale.count({
      where: { storeId: id.data, organizationId: actor.organizationId },
    });
    if (salesCount > 0) {
      return {
        status: 409,
        message: `No se puede eliminar permanentemente la tienda. Tiene ${salesCount} venta(s) asociada(s). Use eliminación suave en su lugar.`,
        data: null,
      };
    }

    const usersCount = await prisma.membership.count({
      where: { defaultStoreId: id.data, organizationId: actor.organizationId },
    });
    if (usersCount > 0) {
      return {
        status: 409,
        message: `No se puede eliminar permanentemente la tienda. Tiene ${usersCount} usuario(s) asociado(s).`,
        data: null,
      };
    }

    await prisma.store.delete({ where });

    return { status: 200, message: 'Tienda eliminada permanentemente', data: null };
  } catch (error) {
    return handleError(error, 'hard deleting store');
  }
};

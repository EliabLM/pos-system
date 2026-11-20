'use server';

import { MembershipRole, Prisma, PurchaseItem } from '@/generated/prisma';
import { ActionResponse, Serialized } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma, serializeDecimals } from '../utils';
import { firstIssue, idSchema, internalError, invalidInput } from '../common.schemas';
import {
  purchaseItemInputSchema,
  updatePurchaseItemInputSchema,
  type PurchaseItemInput,
  type UpdatePurchaseItemInput,
} from '../purchase/purchase.schemas';

// Purchases are administration only (lib/rbac.ts).
const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

const purchaseItemInclude = {
  purchase: {
    select: {
      id: true,
      purchaseNumber: true,
      status: true,
      purchaseDate: true,
    },
  },
  product: {
    include: {
      brand: true,
      category: true,
      unitMeasure: true,
    },
  },
} satisfies Prisma.PurchaseItemInclude;

const purchaseNotFound = () => ({ status: 404, message: 'Compra no encontrada', data: null }) as const;
const itemNotFound = () => ({ status: 404, message: 'Item de compra no encontrado', data: null }) as const;

const handleError = (error: unknown, context: string) => {
  const denied = actorErrorResponse(error);
  if (denied) return denied;
  console.error(`Error ${context}:`, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2003') {
      return { status: 400, message: 'Una de las referencias especificadas no existe', data: null } as const;
    }
    if (error.code === 'P2025') return itemNotFound();
  }
  return internalError();
};

/** Items belong to a purchase; the organization filter goes through it. */
const orgPurchase = (organizationId: string) => ({ organizationId, isDeleted: false });

/** Recomputes the purchase total from its live items. */
const recalculateTotal = async (organizationId: string, purchaseId: string) => {
  const items = await prisma.purchaseItem.findMany({
    where: { purchaseId, isDeleted: false, purchase: orgPurchase(organizationId) },
    select: { subtotal: true },
  });
  const total = items.reduce((sum, item) => sum + item.subtotal.toNumber(), 0);
  await prisma.purchase.update({
    where: { id: purchaseId, ...orgPurchase(organizationId) },
    data: { total, updatedAt: new Date() },
  });
};

// CREATE
export const createPurchaseItem = async (
  purchaseId: string,
  input: PurchaseItemInput
): Promise<ActionResponse<Serialized<PurchaseItem> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(purchaseId);
    if (!id.success) return invalidInput('ID de compra es requerido');
    const parsed = purchaseItemInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const data = parsed.data;
    const organizationId = actor.organizationId;

    const purchase = await prisma.purchase.findFirst({
      where: { id: id.data, ...orgPurchase(organizationId) },
      select: { status: true },
    });
    if (!purchase) return purchaseNotFound();
    if (purchase.status !== 'PENDING') {
      return invalidInput('Solo se pueden agregar items a compras en estado PENDING');
    }

    const product = await prisma.product.findFirst({
      where: { id: data.productId, organizationId, isDeleted: false },
      select: { id: true },
    });
    if (!product) return invalidInput('Producto no encontrado');

    const newItem = await prisma.purchaseItem.create({
      data: {
        productId: data.productId,
        quantity: data.quantity,
        unitPrice: data.unitPrice,
        subtotal: data.quantity * data.unitPrice,
        purchaseId: id.data,
      },
      include: purchaseItemInclude,
    });

    await recalculateTotal(organizationId, id.data);

    return { status: 201, message: 'Item de compra creado exitosamente', data: serializeDecimals(newItem) };
  } catch (error) {
    return handleError(error, 'creating purchase item');
  }
};

// GET BY PURCHASE
export const getPurchaseItemsByPurchaseId = async (
  purchaseId: string
): Promise<ActionResponse<Serialized<PurchaseItem>[] | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(purchaseId);
    if (!id.success) return invalidInput('ID de compra es requerido');

    const items = await prisma.purchaseItem.findMany({
      where: { purchaseId: id.data, isDeleted: false, purchase: orgPurchase(actor.organizationId) },
      include: purchaseItemInclude,
      orderBy: { createdAt: 'asc' },
    });

    return { status: 200, message: 'Items de compra obtenidos exitosamente', data: serializeDecimals(items) };
  } catch (error) {
    return handleError(error, 'fetching purchase items');
  }
};

/** Live item of a live purchase of the organization, with its purchase status. */
const findOrgItem = (organizationId: string, itemId: string) =>
  prisma.purchaseItem.findFirst({
    where: { id: itemId, isDeleted: false, purchase: orgPurchase(organizationId) },
    include: { purchase: { select: { status: true } } },
  });

// UPDATE
export const updatePurchaseItem = async (
  itemId: string,
  input: UpdatePurchaseItemInput
): Promise<ActionResponse<Serialized<PurchaseItem> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(itemId);
    if (!id.success) return invalidInput('ID de item es requerido');
    const parsed = updatePurchaseItemInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const organizationId = actor.organizationId;

    const existing = await findOrgItem(organizationId, id.data);
    if (!existing) return itemNotFound();
    if (existing.purchase.status !== 'PENDING') {
      return invalidInput('Solo se pueden actualizar items de compras en estado PENDING');
    }

    const quantity = parsed.data.quantity ?? existing.quantity;
    const unitPrice = parsed.data.unitPrice ?? existing.unitPrice.toNumber();

    const updatedItem = await prisma.purchaseItem.update({
      where: { id: id.data, isDeleted: false, purchase: orgPurchase(organizationId) },
      data: { quantity, unitPrice, subtotal: quantity * unitPrice, updatedAt: new Date() },
      include: purchaseItemInclude,
    });

    await recalculateTotal(organizationId, existing.purchaseId);

    return { status: 200, message: 'Item de compra actualizado exitosamente', data: serializeDecimals(updatedItem) };
  } catch (error) {
    return handleError(error, 'updating purchase item');
  }
};

// SOFT DELETE
export const softDeletePurchaseItem = async (itemId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(itemId);
    if (!id.success) return invalidInput('ID de item es requerido');
    const organizationId = actor.organizationId;

    const existing = await findOrgItem(organizationId, id.data);
    if (!existing) return itemNotFound();
    if (existing.purchase.status !== 'PENDING') {
      return invalidInput('Solo se pueden eliminar items de compras en estado PENDING');
    }

    const itemCount = await prisma.purchaseItem.count({
      where: { purchaseId: existing.purchaseId, isDeleted: false, purchase: orgPurchase(organizationId) },
    });
    if (itemCount === 1) return invalidInput('No se puede eliminar el último item de la compra');

    await prisma.purchaseItem.update({
      where: { id: id.data, isDeleted: false, purchase: orgPurchase(organizationId) },
      data: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
    });

    await recalculateTotal(organizationId, existing.purchaseId);

    return { status: 200, message: 'Item de compra eliminado exitosamente', data: null };
  } catch (error) {
    return handleError(error, 'deleting purchase item');
  }
};

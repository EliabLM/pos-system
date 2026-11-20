'use server';

import { MembershipRole, PaymentMethod, Prisma } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { firstIssue, idSchema, internalError, invalidInput } from '../common.schemas';
import {
  createPaymentMethodInputSchema,
  updatePaymentMethodInputSchema,
  type CreatePaymentMethodInput,
  type UpdatePaymentMethodInput,
} from './payment-method.schemas';

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

const paymentMethodNotFound = () => ({ status: 404, message: 'Método de pago no encontrado', data: null }) as const;
const invalidPaymentMethodId = () => invalidInput('ID del método de pago es requerido');

const handleError = (error: unknown, context: string) => {
  const denied = actorErrorResponse(error);
  if (denied) return denied;
  console.error(`Error ${context}:`, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return { status: 409, message: 'Ya existe un método de pago con ese nombre', data: null } as const;
    }
    if (error.code === 'P2025') return paymentMethodNotFound();
    if (error.code === 'P2003') {
      return { status: 400, message: 'El método de pago tiene pagos asociados', data: null } as const;
    }
  }
  return internalError();
};

// CREATE
export const createPaymentMethod = async (
  input: CreatePaymentMethodInput
): Promise<ActionResponse<PaymentMethod | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsed = createPaymentMethodInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));

    const newPaymentMethod = await prisma.paymentMethod.create({
      data: { ...parsed.data, organizationId: actor.organizationId },
    });

    return { status: 201, message: 'Método de pago creado exitosamente', data: newPaymentMethod };
  } catch (error) {
    return handleError(error, 'creating payment method');
  }
};

// GET MANY (any member: the seller picks one while selling, only active ones)
export const getPaymentMethods = async (isActive?: boolean): Promise<ActionResponse<PaymentMethod[] | null>> => {
  try {
    const actor = await requireActor();

    const whereClause: Prisma.PaymentMethodWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: false,
    };
    if (actor.role !== MembershipRole.ADMIN) whereClause.isActive = true;
    else if (typeof isActive === 'boolean') whereClause.isActive = isActive;

    const paymentMethods = await prisma.paymentMethod.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    return { status: 200, message: 'Métodos de pago obtenidos exitosamente', data: paymentMethods };
  } catch (error) {
    return handleError(error, 'fetching payment methods');
  }
};

// GET ONE (any member)
export const getPaymentMethodById = async (paymentMethodId: string): Promise<ActionResponse<PaymentMethod | null>> => {
  try {
    const actor = await requireActor();
    const id = idSchema.safeParse(paymentMethodId);
    if (!id.success) return invalidPaymentMethodId();

    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: {
        id: id.data,
        organizationId: actor.organizationId,
        isDeleted: false,
        ...(actor.role === MembershipRole.ADMIN ? {} : { isActive: true }),
      },
    });
    if (!paymentMethod) return paymentMethodNotFound();

    return { status: 200, message: 'Método de pago obtenido exitosamente', data: paymentMethod };
  } catch (error) {
    return handleError(error, 'fetching payment method');
  }
};

// UPDATE
export const updatePaymentMethod = async (
  paymentMethodId: string,
  input: UpdatePaymentMethodInput
): Promise<ActionResponse<PaymentMethod | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(paymentMethodId);
    if (!id.success) return invalidPaymentMethodId();
    const parsed = updatePaymentMethodInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.paymentMethod.findFirst({ where, select: { id: true } });
    if (!existing) return paymentMethodNotFound();

    const updated = await prisma.paymentMethod.update({
      where,
      data: { ...parsed.data, updatedAt: new Date() },
    });

    return { status: 200, message: 'Método de pago actualizado exitosamente', data: updated };
  } catch (error) {
    return handleError(error, 'updating payment method');
  }
};

// SOFT DELETE
export const softDeletePaymentMethod = async (paymentMethodId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(paymentMethodId);
    if (!id.success) return invalidPaymentMethodId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.paymentMethod.findFirst({ where, select: { id: true } });
    if (!existing) return paymentMethodNotFound();

    await prisma.paymentMethod.update({
      where,
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });

    return { status: 200, message: 'Método de pago eliminado (soft) exitosamente', data: null };
  } catch (error) {
    return handleError(error, 'soft deleting payment method');
  }
};

// HARD DELETE
export const deletePaymentMethod = async (paymentMethodId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(paymentMethodId);
    if (!id.success) return invalidPaymentMethodId();

    const where = { id: id.data, organizationId: actor.organizationId };
    const existing = await prisma.paymentMethod.findFirst({ where, select: { id: true } });
    if (!existing) return paymentMethodNotFound();

    await prisma.paymentMethod.delete({ where });

    return { status: 200, message: 'Método de pago eliminado permanentemente', data: null };
  } catch (error) {
    return handleError(error, 'deleting payment method');
  }
};

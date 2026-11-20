'use server';

import { MembershipRole } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { idSchema, internalError, invalidInput } from '../common.schemas';
import { categoryNotFound } from './category.include';

export const softDeleteCategory = async (categoryId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor({ roles: [MembershipRole.ADMIN] });
    const id = idSchema.safeParse(categoryId);
    if (!id.success) return invalidInput('ID de la categoría es requerido');

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.category.findFirst({ where, select: { id: true } });
    if (!existing) return categoryNotFound();

    await prisma.category.update({
      where,
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });

    return { status: 200, message: 'Categoría eliminada (soft) exitosamente', data: null };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error deleting category:', error);
    return internalError();
  }
};

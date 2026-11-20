'use server';

import { Category, MembershipRole } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { firstIssue, idSchema, internalError, invalidInput } from '../common.schemas';
import { categoryInclude, categoryNotFound } from './category.include';
import { updateCategoryInputSchema, type UpdateCategoryInput } from './category.schemas';

export const updateCategory = async (
  categoryId: string,
  input: UpdateCategoryInput
): Promise<ActionResponse<Category | null>> => {
  try {
    const actor = await requireActor({ roles: [MembershipRole.ADMIN] });
    const id = idSchema.safeParse(categoryId);
    if (!id.success) return invalidInput('ID de la categoría es requerido');
    const parsed = updateCategoryInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.category.findFirst({ where, select: { id: true } });
    if (!existing) return categoryNotFound();

    const updatedCategory = await prisma.category.update({
      where,
      data: { ...parsed.data, updatedAt: new Date() },
      include: categoryInclude,
    });

    return { status: 200, message: 'Categoría actualizada exitosamente', data: updatedCategory };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error updating category:', error);
    return internalError();
  }
};

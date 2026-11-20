'use server';

import { Category } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { idSchema, internalError, invalidInput } from '../common.schemas';
import { categoryInclude, categoryNotFound } from './category.include';

export const getCategoryById = async (categoryId: string): Promise<ActionResponse<Category | null>> => {
  try {
    const actor = await requireActor();
    const id = idSchema.safeParse(categoryId);
    if (!id.success) return invalidInput('ID de la categoría es requerido');

    const category = await prisma.category.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      include: categoryInclude,
    });
    if (!category) return categoryNotFound();

    return { status: 200, message: 'Categoría obtenida exitosamente', data: category };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching category:', error);
    return internalError();
  }
};

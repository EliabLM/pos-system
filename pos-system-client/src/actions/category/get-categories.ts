'use server';

import { Category, Prisma } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { categoryInclude } from './category.include';

/** Categories of the actor's organization. Any member can read them. */
export const getCategories = async (isActive?: boolean): Promise<ActionResponse<Category[] | null>> => {
  try {
    const actor = await requireActor();

    const whereClause: Prisma.CategoryWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: false,
    };
    if (typeof isActive === 'boolean') whereClause.isActive = isActive;

    const categories = await prisma.category.findMany({
      where: whereClause,
      include: categoryInclude,
      orderBy: { createdAt: 'desc' },
    });

    return { status: 200, message: 'Categorías obtenidas exitosamente', data: categories };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching categories:', error);
    return { status: 500, message: 'Error interno del servidor al obtener las categorías', data: null };
  }
};

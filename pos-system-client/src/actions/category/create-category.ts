'use server';

import { Category, MembershipRole } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { firstIssue, invalidInput } from '../common.schemas';
import { categoryInclude } from './category.include';
import { createCategoryInputSchema, type CreateCategoryInput } from './category.schemas';

export const createCategory = async (
  input: CreateCategoryInput
): Promise<ActionResponse<Category | null>> => {
  try {
    const actor = await requireActor({ roles: [MembershipRole.ADMIN] });
    const parsed = createCategoryInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));

    const newCategory = await prisma.category.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        isActive: parsed.data.isActive ?? true,
        organizationId: actor.organizationId,
      },
      include: categoryInclude,
    });

    return { status: 201, message: 'Categoría creada exitosamente', data: newCategory };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error creating category:', error);
    return { status: 500, message: 'Error interno del servidor al crear la categoría', data: null };
  }
};

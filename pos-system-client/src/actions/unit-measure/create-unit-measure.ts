'use server';

import { MembershipRole, UnitMeasure } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { firstIssue, invalidInput } from '../common.schemas';
import { unitMeasureInclude } from './unit-measure.include';
import { createUnitMeasureInputSchema, type CreateUnitMeasureInput } from './unit-measure.schemas';

export const createUnitMeasure = async (
  input: CreateUnitMeasureInput
): Promise<ActionResponse<UnitMeasure | null>> => {
  try {
    const actor = await requireActor({ roles: [MembershipRole.ADMIN] });
    const parsed = createUnitMeasureInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const { name, abbreviation, isActive } = parsed.data;
    const organizationId = actor.organizationId;

    // Unique name and abbreviation among the organization's live units
    const existingUnit = await prisma.unitMeasure.findFirst({
      where: { organizationId, name, isDeleted: false },
      select: { id: true },
    });
    if (existingUnit) {
      return { status: 400, message: 'Ya existe una unidad de medida con este nombre', data: null };
    }

    const existingAbbrev = await prisma.unitMeasure.findFirst({
      where: { organizationId, abbreviation, isDeleted: false },
      select: { id: true },
    });
    if (existingAbbrev) {
      return { status: 400, message: 'Ya existe una unidad de medida con esta abreviación', data: null };
    }

    const newUnitMeasure = await prisma.unitMeasure.create({
      data: { name, abbreviation, isActive: isActive ?? true, organizationId },
      include: unitMeasureInclude,
    });

    return { status: 201, message: 'Unidad de medida creada exitosamente', data: newUnitMeasure };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error creating unit measure:', error);
    return { status: 500, message: 'Error interno del servidor al crear la unidad de medida', data: null };
  }
};

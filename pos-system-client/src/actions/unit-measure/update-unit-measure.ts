'use server';

import { MembershipRole, UnitMeasure } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { firstIssue, idSchema, invalidInput } from '../common.schemas';
import { unitMeasureNotFound } from './unit-measure.include';
import { updateUnitMeasureInputSchema, type UpdateUnitMeasureInput } from './unit-measure.schemas';

/** Updates a unit measure of the actor's organization. ADMIN only. */
export const updateUnitMeasure = async (
  unitMeasureId: string,
  input: UpdateUnitMeasureInput
): Promise<ActionResponse<UnitMeasure | null>> => {
  try {
    const actor = await requireActor({ roles: [MembershipRole.ADMIN] });
    const id = idSchema.safeParse(unitMeasureId);
    if (!id.success) return invalidInput('ID de la unidad de medida es requerido');
    const parsed = updateUnitMeasureInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const data = parsed.data;
    const organizationId = actor.organizationId;

    const where = { id: id.data, organizationId, isDeleted: false };
    const existing = await prisma.unitMeasure.findFirst({ where, select: { id: true } });
    if (!existing) return unitMeasureNotFound();

    // Check for duplicate name or abbreviation if being updated
    const duplicateFilters = [
      ...(data.name ? [{ name: data.name }] : []),
      ...(data.abbreviation ? [{ abbreviation: data.abbreviation }] : []),
    ];
    if (duplicateFilters.length > 0) {
      const duplicate = await prisma.unitMeasure.findFirst({
        where: { id: { not: id.data }, organizationId, isDeleted: false, OR: duplicateFilters },
        select: { name: true },
      });
      if (duplicate) {
        const field = duplicate.name === data.name ? 'nombre' : 'abreviación';
        return { status: 400, message: `Ya existe una unidad de medida con este ${field}`, data: null };
      }
    }

    const updatedUnitMeasure = await prisma.unitMeasure.update({ where, data });

    return { status: 200, message: 'Unidad de medida actualizada exitosamente', data: updatedUnitMeasure };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error updating unit measure:', error);
    return { status: 500, message: 'Error al actualizar la unidad de medida', data: null };
  }
};

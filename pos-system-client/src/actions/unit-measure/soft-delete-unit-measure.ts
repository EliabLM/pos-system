'use server';

import { MembershipRole, UnitMeasure } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { idSchema, invalidInput } from '../common.schemas';
import { unitMeasureNotFound } from './unit-measure.include';

/** Soft deletes an unused unit measure of the actor's organization. ADMIN only. */
export const softDeleteUnitMeasure = async (
  unitMeasureId: string
): Promise<ActionResponse<UnitMeasure | null>> => {
  try {
    const actor = await requireActor({ roles: [MembershipRole.ADMIN] });
    const id = idSchema.safeParse(unitMeasureId);
    if (!id.success) return invalidInput('ID de la unidad de medida es requerido');
    const organizationId = actor.organizationId;

    const where = { id: id.data, organizationId, isDeleted: false };
    const existing = await prisma.unitMeasure.findFirst({ where, select: { id: true } });
    if (!existing) return unitMeasureNotFound();

    const productsUsingUnitMeasure = await prisma.product.count({
      where: { organizationId, unitMeasureId: id.data, isDeleted: false },
    });
    if (productsUsingUnitMeasure > 0) {
      return {
        status: 400,
        message: `No se puede eliminar la unidad de medida porque está siendo usada por ${productsUsingUnitMeasure} producto(s)`,
        data: null,
      };
    }

    const deletedUnitMeasure = await prisma.unitMeasure.update({
      where,
      data: { isDeleted: true, deletedAt: new Date() },
    });

    return { status: 200, message: 'Unidad de medida eliminada exitosamente', data: deletedUnitMeasure };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error deleting unit measure:', error);
    return { status: 500, message: 'Error al eliminar la unidad de medida', data: null };
  }
};

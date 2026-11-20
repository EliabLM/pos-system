'use server';

import { Prisma, UnitMeasure } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { unitMeasureInclude } from './unit-measure.include';

/** Unit measures of the actor's organization. Any member can read them. */
export const getUnitMeasures = async (isActive?: boolean): Promise<ActionResponse<UnitMeasure[] | null>> => {
  try {
    const actor = await requireActor();

    const whereClause: Prisma.UnitMeasureWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: false,
    };
    if (typeof isActive === 'boolean') whereClause.isActive = isActive;

    const unitMeasures = await prisma.unitMeasure.findMany({
      where: whereClause,
      include: unitMeasureInclude,
      orderBy: { name: 'asc' },
    });

    return { status: 200, message: 'Unidades de medida obtenidas exitosamente', data: unitMeasures };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching unit measures:', error);
    return { status: 500, message: 'Error interno del servidor al obtener las unidades de medida', data: null };
  }
};

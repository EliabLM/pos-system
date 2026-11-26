'use server';

/**
 * ============================================
 * GET CURRENT USER ACTION
 * ============================================
 *
 * Vista del usuario de la sesión (Better Auth) con la tenancy de su membresía
 * ACTIVA, en la forma que consumen el store y la UI. No autoriza nada: las
 * acciones usan getActor()/requireActor().
 */

import { prisma } from '@/actions/utils';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireSessionUserId } from '@/lib/auth/actor';

interface GetCurrentUserResponse {
  user?: Record<string, unknown>;
  organizationDeactivated?: boolean;
  storeDeactivated?: boolean;
}

export async function getCurrentUser(): Promise<ActionResponse<GetCurrentUserResponse>> {
  try {
    const userId = await requireSessionUserId();

    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        isActive: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          where: { deletedAt: null, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            role: true,
            organizationId: true,
            defaultStoreId: true,
            organization: {
              select: { id: true, name: true, phone: true, address: true, isActive: true, createdAt: true },
            },
            defaultStore: {
              select: {
                id: true,
                name: true,
                address: true,
                phone: true,
                isActive: true,
                organizationId: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!userRow) {
      return { status: 401, message: 'No autenticado', data: null };
    }

    const membership = userRow.memberships[0] ?? null;
    const user = {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      image: userRow.image,
      role: membership?.role ?? null,
      organizationId: membership?.organizationId ?? null,
      storeId: membership?.defaultStoreId ?? null,
      isActive: userRow.isActive,
      emailVerified: userRow.emailVerified,
      lastLoginAt: userRow.lastLoginAt,
      createdAt: userRow.createdAt,
      updatedAt: userRow.updatedAt,
      organization: membership?.organization ?? null,
      store: membership?.defaultStore ?? null,
    };

    if (user.organization && !user.organization.isActive) {
      return {
        status: 403,
        message: 'Su organización ha sido desactivada',
        data: { user, organizationDeactivated: true },
      };
    }

    if (user.store && !user.store.isActive) {
      return {
        status: 403,
        message: 'Su tienda ha sido desactivada',
        data: { user, storeDeactivated: true },
      };
    }

    return { status: 200, message: 'Usuario obtenido exitosamente', data: { user } };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;

    console.error('Get current user error:', error);
    return { status: 500, message: 'Error al obtener información del usuario', data: null };
  }
}

import {
  Membership,
  MembershipRole,
  MembershipStatus,
  Prisma,
} from '@/generated/prisma';
import { ActionResponse, Serialized } from '@/interfaces';
import { prisma } from '@/lib/db';
import { ActorError, requireActor } from '@/lib/auth/actor';

// Instancia única de Prisma Client (singleton en globalThis, ver lib/db.ts)
export { prisma };

/**
 * Devuelve el membership ACTIVO del usuario (D3.3: la tenancy vive en
 * memberships). null = usuario en onboarding (aún sin organización) o
 * con membership revocado.
 */
export const getActiveMembership = async (
  userId: string
): Promise<Membership | null> => {
  if (!userId) return null;
  return prisma.membership.findFirst({
    where: { userId, deletedAt: null, status: MembershipStatus.ACTIVE },
    orderBy: { createdAt: 'asc' },
  });
};

/**
 * Convierte recursivamente los `Prisma.Decimal` (dinero: numeric(12,2) en la DB)
 * a `number` en la frontera de las server actions. Los `Decimal` no sobreviven
 * la serialización server→client de Next.js, y toda la UI opera con `number`.
 */
export const serializeDecimals = <T>(value: T): Serialized<T> => {
  if (value instanceof Prisma.Decimal) {
    return value.toNumber() as unknown as Serialized<T>;
  }
  if (value === null || value instanceof Date || typeof value !== 'object') {
    return value as unknown as Serialized<T>;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeDecimals(item)) as unknown as Serialized<T>;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = serializeDecimals(entry);
  }
  return result as unknown as Serialized<T>;
};

/**
 * Comprobación legada para los módulos aún no migrados a `requireActor()`
 * (#12–#15). Ya NO confía en el `userId` recibido: el rol sale de la sesión
 * (`getActor()`), el `userId` del llamador debe coincidir con el de la sesión
 * y, si se pasa `organizationId`, debe ser la organización del actor.
 * Un usuario sin membresía nunca pasa (no tiene rol).
 */
const sessionActorHasRole = async (
  userId: string,
  roles: readonly MembershipRole[],
  organizationId?: string
): Promise<boolean> => {
  try {
    const actor = await requireActor({ roles });
    if (!userId || actor.userId !== userId) return false;
    if (organizationId !== undefined && actor.organizationId !== organizationId) return false;
    return true;
  } catch (error) {
    if (!(error instanceof ActorError)) console.error('Error checking role:', error);
    return false;
  }
};

/** ADMIN de la sesión (y de `organizationId`, si se indica). */
export const checkAdminRole = async (
  userId: string,
  organizationId?: string
): Promise<boolean> => sessionActorHasRole(userId, [MembershipRole.ADMIN], organizationId);

/** ADMIN o SELLER de la sesión (y de `organizationId`, si se indica). */
export const checkAdminOrSellerRole = async (
  userId: string,
  organizationId?: string
): Promise<boolean> =>
  sessionActorHasRole(userId, [MembershipRole.ADMIN, MembershipRole.SELLER], organizationId);

/**
 * Crea una respuesta de error estandarizada para accesos no autorizados.
 * @returns {ActionResponse} - Un objeto de respuesta con estado 403.
 */
export const unauthorizedResponse = <T = null>(): ActionResponse<T> => {
  return {
    status: 403,
    message: 'Acción no autorizada. Se requiere rol de Administrador.',
    data: null,
  };
};

export const checkOrgId = (orgId: string): boolean => {
  return (!orgId || orgId.trim() === '')
}

export const emptyOrgIdResponse = <T = null>(): ActionResponse<T> => {
  return {
    status: 400,
    message: 'El ID de la organización es requerido',
    data: null
  }
}


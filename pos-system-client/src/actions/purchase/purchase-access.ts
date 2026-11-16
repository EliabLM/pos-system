import { ActorError, requireActor, type Actor } from '@/lib/auth/actor';
import { MembershipRole } from '@/generated/prisma';

export type PurchaseActor = Pick<Actor, 'userId' | 'organizationId' | 'role'>;
export type PurchaseAccess =
  | { actor: PurchaseActor; status?: never }
  | { actor?: never; status: 401 | 403 | 500 };

/** Purchase-module view of the central actor (`getActor`); never authorizes from headers or caller IDs. */
export async function getPurchaseActor(adminOnly = false): Promise<PurchaseAccess> {
  try {
    const { userId, organizationId, role } = await requireActor(
      adminOnly ? { roles: [MembershipRole.ADMIN] } : {}
    );
    return { actor: { userId, organizationId, role } };
  } catch (error) {
    if (error instanceof ActorError) return { status: error.status };
    console.error('Error authorizing purchase:', error);
    return { status: 500 };
  }
}

export function purchaseAccessError(status: 401 | 403 | 500) {
  return {
    status,
    message: status === 401 ? 'No autenticado' : status === 403 ? 'Acción no autorizada' : 'Error interno del servidor',
    data: null,
  } as const;
}

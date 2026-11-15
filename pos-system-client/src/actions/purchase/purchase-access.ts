import { cookies } from 'next/headers';
import { MembershipRole } from '@/generated/prisma';
import { validateSession, verifyToken } from '@/lib/auth';
import { prisma } from '../utils';

export type PurchaseActor = { userId: string; organizationId: string; role: MembershipRole };
export type PurchaseAccess =
  | { actor: PurchaseActor; status?: never }
  | { actor?: never; status: 401 | 403 | 500 };

/** Revalidate the cookie and persisted session; never authorize from request headers or caller IDs. */
export async function getPurchaseActor(adminOnly = false): Promise<PurchaseAccess> {
  const token = (await cookies()).get('auth-token')?.value;
  if (!token) return { status: 401 };

  try {
    const payload = verifyToken(token);
    if (!payload?.userId) return { status: 401 };
    const session = await validateSession(token);
    if (!session || session.userId !== payload.userId) return { status: 401 };

    const user = await prisma.user.findFirst({
      where: { id: session.userId, isDeleted: false, isActive: true },
      select: { id: true },
    });
    if (!user) return { status: 401 };

    const membership = await prisma.membership.findFirst({
      where: {
        userId: user.id,
        deletedAt: null,
        status: 'ACTIVE',
        organization: { isDeleted: false, isActive: true },
      },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true, role: true },
    });
    if (!membership) return { status: 403 };
    if (adminOnly && membership.role !== MembershipRole.ADMIN) return { status: 403 };
    if (membership.role !== MembershipRole.ADMIN && membership.role !== MembershipRole.SELLER) {
      return { status: 403 };
    }
    return { actor: { userId: user.id, ...membership } };
  } catch (error) {
    // An invalid/revoked token is not a database outage.
    if (error instanceof Error && error.name === 'AuthError') return { status: 401 };
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

import { cookies } from 'next/headers';
import { MembershipRole, MembershipStatus } from '@/generated/prisma';
import { prisma } from '@/lib/db';
import { verifyToken } from './jwt';
import { validateSession } from './session';
import { AuthError } from './types';

/**
 * ============================================
 * ACTOR — single source of identity for server code
 * ============================================
 *
 * Every server action derives `userId`, `organizationId`, `role` and
 * `storeId` from here and NEVER from its parameters, request headers or the
 * client store.
 *
 * The public contract (`Actor`, `ActorError`, `getActor`, `requireActor`,
 * `actorErrorResponse`) is independent of the session mechanism: switching to
 * another auth provider only changes `resolveSessionUserId()` (and, if needed,
 * `resolveMembership()`), not the modules that consume it.
 */

export const AUTH_COOKIE_NAME = 'auth-token';

export type ActorRole = MembershipRole;

export interface Actor {
  userId: string;
  organizationId: string;
  role: ActorRole;
  /** Default store of the membership (null = not bound to a store). */
  storeId: string | null;
}

export type ActorErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN';

export class ActorError extends Error {
  readonly code: ActorErrorCode;
  readonly status: 401 | 403;

  constructor(code: ActorErrorCode) {
    super(code === 'UNAUTHENTICATED' ? 'No autenticado' : 'Acción no autorizada');
    this.name = 'ActorError';
    this.code = code;
    this.status = code === 'UNAUTHENTICATED' ? 401 : 403;
  }
}

const ALLOWED_ROLES: readonly ActorRole[] = [MembershipRole.ADMIN, MembershipRole.SELLER];

/**
 * Session mechanism (current: custom JWT cookie + persisted session row).
 * Returns the authenticated user id or null. Must never trust client input.
 */
async function resolveSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    // `await` keeps this valid whether verifyToken is sync or async.
    const payload = await verifyToken(token);
    if (!payload?.userId) return null;
    const session = await validateSession(token);
    if (!session || session.userId !== payload.userId) return null;
    return session.userId;
  } catch (error) {
    // Invalid, expired or revoked token/session is "not authenticated",
    // not an infrastructure failure.
    if (error instanceof AuthError) return null;
    throw error;
  }
}

/**
 * Membership selection criterion shared by every place that derives tenancy
 * (actor, session refresh): the oldest ACTIVE membership of an active,
 * non-deleted organization.
 */
export const ACTIVE_MEMBERSHIP_WHERE = {
  deletedAt: null,
  status: MembershipStatus.ACTIVE,
  organization: { isDeleted: false, isActive: true },
} as const;
export const ACTIVE_MEMBERSHIP_ORDER = { createdAt: 'asc' } as const;

/** Tenancy: the oldest ACTIVE membership of an active organization. */
async function resolveMembership(userId: string) {
  return prisma.membership.findFirst({
    where: { userId, ...ACTIVE_MEMBERSHIP_WHERE },
    orderBy: ACTIVE_MEMBERSHIP_ORDER,
    select: { organizationId: true, role: true, defaultStoreId: true },
  });
}

/** Authenticated, active and non-deleted user id from the session, or null. */
async function resolveActiveSessionUserId(): Promise<string | null> {
  const sessionUserId = await resolveSessionUserId();
  if (!sessionUserId) return null;
  const user = await prisma.user.findFirst({
    where: { id: sessionUserId, isDeleted: false, isActive: true },
    select: { id: true },
  });
  return user?.id ?? null;
}

/**
 * Session user WITHOUT tenancy. Only for flows that run before the user has a
 * membership (session refresh). Never use it to authorize tenant data.
 * Throws UNAUTHENTICATED.
 */
export async function requireSessionUserId(): Promise<string> {
  const userId = await resolveActiveSessionUserId();
  if (!userId) throw new ActorError('UNAUTHENTICATED');
  return userId;
}

/**
 * Onboarding: the authenticated user that has NO active membership yet and may
 * therefore create its own organization. A user that already belongs to an
 * organization gets FORBIDDEN (it cannot create or join another one here).
 */
export async function requireOnboardingUser(): Promise<{ userId: string }> {
  const userId = await requireSessionUserId();
  const membership = await resolveMembership(userId);
  if (membership) throw new ActorError('FORBIDDEN');
  return { userId };
}

/**
 * Returns the authenticated actor or throws `ActorError`:
 * - UNAUTHENTICATED (401): no cookie, invalid/revoked session, inactive or deleted user.
 * - FORBIDDEN (403): no active membership in an active organization, or unknown role.
 */
export async function getActor(): Promise<Actor> {
  const userId = await requireSessionUserId();

  // No membership = no role at all (onboarding only, see requireOnboardingUser).
  const membership = await resolveMembership(userId);
  if (!membership || !ALLOWED_ROLES.includes(membership.role)) {
    throw new ActorError('FORBIDDEN');
  }

  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
    storeId: membership.defaultStoreId,
  };
}

/** `getActor()` plus a role check. Without `roles`, any member (ADMIN or SELLER) passes. */
export async function requireActor(options: { roles?: readonly ActorRole[] } = {}): Promise<Actor> {
  const actor = await getActor();
  if (options.roles && !options.roles.includes(actor.role)) {
    throw new ActorError('FORBIDDEN');
  }
  return actor;
}

/**
 * Maps an `ActorError` to the standard action response. Returns null for any
 * other error so the caller keeps its own error handling.
 */
export function actorErrorResponse(error: unknown): { status: 401 | 403; message: string; data: null } | null {
  if (error instanceof ActorError) {
    return { status: error.status, message: error.message, data: null };
  }
  return null;
}

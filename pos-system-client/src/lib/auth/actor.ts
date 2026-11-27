import { headers } from 'next/headers';
import { MembershipRole } from '@/generated/prisma';
import { prisma } from '@/lib/db';
import { auth } from './better-auth';
import { ACTIVE_MEMBERSHIP_ORDER, ACTIVE_MEMBERSHIP_WHERE } from './membership-rules';

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
 * another auth provider only changes `resolveSession()` (and, if needed,
 * `resolveMembership()`), not the modules that consume it.
 */

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
 * Session mechanism (Better Auth, #19): the session cookie is looked up in the
 * `sessions` table on every call (no cookie cache), so a session closed with
 * logout or deleted in the database stops authenticating immediately.
 * Returns the authenticated user id or null. Must never trust client input.
 */
interface SessionIdentity {
  userId: string;
  /** Organization plugin (#20): the organization the session works in. */
  activeOrganizationId: string | null;
}

async function resolveSession(): Promise<SessionIdentity | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return { userId: session.user.id, activeOrganizationId: session.session.activeOrganizationId ?? null };
}

export { ACTIVE_MEMBERSHIP_ORDER, ACTIVE_MEMBERSHIP_WHERE } from './membership-rules';

/**
 * Tenancy: the ACTIVE membership in the session's active organization. A
 * session without one (created before #20) falls back to the oldest ACTIVE
 * membership of an active organization.
 */
async function resolveMembership(userId: string, activeOrganizationId: string | null) {
  return prisma.membership.findFirst({
    where: {
      userId,
      ...(activeOrganizationId ? { organizationId: activeOrganizationId } : {}),
      ...ACTIVE_MEMBERSHIP_WHERE,
    },
    orderBy: ACTIVE_MEMBERSHIP_ORDER,
    select: { organizationId: true, role: true, defaultStoreId: true },
  });
}

/** Session of an authenticated, active and non-deleted user, or null. */
async function resolveActiveSession(): Promise<SessionIdentity | null> {
  const session = await resolveSession();
  if (!session) return null;
  const user = await prisma.user.findFirst({
    where: { id: session.userId, isDeleted: false, isActive: true },
    select: { id: true },
  });
  return user ? session : null;
}

async function requireActiveSession(): Promise<SessionIdentity> {
  const session = await resolveActiveSession();
  if (!session) throw new ActorError('UNAUTHENTICATED');
  return session;
}

/**
 * Session user WITHOUT tenancy. Only for flows that run before the user has a
 * membership (session refresh). Never use it to authorize tenant data.
 * Throws UNAUTHENTICATED.
 */
export async function requireSessionUserId(): Promise<string> {
  return (await requireActiveSession()).userId;
}

/**
 * Onboarding: the authenticated user that has NO membership yet and may
 * therefore create its own organization. Any non-deleted membership counts,
 * also one in a deactivated organization or not ACTIVE: that user gets
 * FORBIDDEN (it cannot create or join another organization here).
 */
export async function requireOnboardingUser(): Promise<{ userId: string }> {
  const userId = await requireSessionUserId();
  const membership = await prisma.membership.findFirst({
    where: { userId, deletedAt: null },
    select: { organizationId: true },
  });
  if (membership) throw new ActorError('FORBIDDEN');
  return { userId };
}

/** Reasons shown on the login page (src/app/auth/login/page.tsx). */
export type BlockedMembershipReason = 'organizacion-desactivada' | 'membresia-suspendida';

/**
 * Why a signed-in user with a membership has no actor: its organization is
 * deactivated, or the ADMIN suspended its membership (status not ACTIVE) in an
 * active organization. Throws UNAUTHENTICATED without a session.
 */
export async function blockedMembershipReason(): Promise<BlockedMembershipReason> {
  const userId = await requireSessionUserId();
  const membership = await prisma.membership.findFirst({
    where: { userId, deletedAt: null },
    orderBy: ACTIVE_MEMBERSHIP_ORDER,
    select: { status: true, organization: { select: { isActive: true, isDeleted: true } } },
  });
  const organizationUsable = membership && membership.organization.isActive && !membership.organization.isDeleted;
  return organizationUsable ? 'membresia-suspendida' : 'organizacion-desactivada';
}

/**
 * Returns the authenticated actor or throws `ActorError`:
 * - UNAUTHENTICATED (401): no cookie, invalid/revoked session, inactive or deleted user.
 * - FORBIDDEN (403): no active membership in the session's active organization
 *   (or, without one, in any active organization), or unknown role.
 */
export async function getActor(): Promise<Actor> {
  const { userId, activeOrganizationId } = await requireActiveSession();

  // No membership = no role at all (onboarding only, see requireOnboardingUser).
  const membership = await resolveMembership(userId, activeOrganizationId);
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

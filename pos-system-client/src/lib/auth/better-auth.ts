import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { MembershipStatus } from '@/generated/prisma';
import { prisma } from '@/lib/db';
import { assertAuthEnv, buildAuthOptions, secureCookiesFromEnv, type SignInDenial } from './auth-options';
import { ALREADY_IN_ORGANIZATION_MESSAGE, INVALID_CREDENTIALS_MESSAGE } from './auth-messages';
import { ACTIVE_MEMBERSHIP_ORDER, ACTIVE_MEMBERSHIP_WHERE } from './membership-rules';

/**
 * Better Auth over the app database (users, sessions, accounts). Server only:
 * the browser talks to it through /api/auth/* (src/app/api/auth/[...all]).
 *
 * Env: BETTER_AUTH_SECRET and BETTER_AUTH_URL (both required in production:
 * the server refuses to start without them, see src/instrumentation.ts),
 * HTTPS_ENABLED ('true'/'false' overrides the Secure cookie; unset = Better
 * Auth decides) and, only for E2E runs, AUTH_SIGN_IN_MAX_ATTEMPTS (default 5
 * per minute and IP).
 */

assertAuthEnv(process.env);

const DEFAULT_SIGN_IN_MAX_ATTEMPTS = 5;

function signInMaxAttempts(): number {
  const value = Number(process.env.AUTH_SIGN_IN_MAX_ATTEMPTS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SIGN_IN_MAX_ATTEMPTS;
}

/** A member whose access the ADMIN suspended (membership not ACTIVE). */
export const SUSPENDED_MEMBERSHIP_MESSAGE =
  'Su acceso a la organización fue suspendido. Por favor contacte a su administrador';

/**
 * Same rules the custom login applied after checking the password: deleted
 * user = invalid credentials; inactive user, suspended membership,
 * organization or store = its own message (only shown to whoever knows the
 * password). A user without any membership signs in (onboarding or an
 * invitation follow).
 */
async function canSignIn(userId: string): Promise<SignInDenial | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      isDeleted: true,
      memberships: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          status: true,
          organization: { select: { isActive: true } },
          defaultStore: { select: { isActive: true } },
        },
      },
    },
  });
  if (!user || user.isDeleted) return { status: 'UNAUTHORIZED', message: INVALID_CREDENTIALS_MESSAGE };
  if (!user.isActive) {
    return { status: 'FORBIDDEN', message: 'Su cuenta ha sido desactivada. Por favor contacte a soporte' };
  }
  // The ACTIVE membership decides; otherwise the oldest one (suspended).
  const membership =
    user.memberships.find((m) => m.status === MembershipStatus.ACTIVE) ?? user.memberships[0];
  if (membership && !membership.organization.isActive) {
    return { status: 'FORBIDDEN', message: 'Su organización ha sido desactivada. Por favor contacte a soporte' };
  }
  if (membership && membership.status !== MembershipStatus.ACTIVE) {
    return { status: 'FORBIDDEN', message: SUSPENDED_MEMBERSHIP_MESSAGE };
  }
  if (membership?.defaultStore && !membership.defaultStore.isActive) {
    return { status: 'FORBIDDEN', message: 'Su tienda ha sido desactivada. Por favor contacte a su administrador' };
  }
  return null;
}

/** A new session starts in the oldest ACTIVE membership (same rule as getActor()). */
async function activeOrganizationFor(userId: string): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: { userId, ...ACTIVE_MEMBERSHIP_WHERE },
    orderBy: ACTIVE_MEMBERSHIP_ORDER,
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

/**
 * One organization per user (the UI has no organization switcher, #20): an
 * invitation is only accepted by a user without any membership. The
 * organization must be active.
 */
async function canAcceptInvitation({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): Promise<SignInDenial | null> {
  const [membership, organization] = await Promise.all([
    prisma.membership.findFirst({ where: { userId, deletedAt: null }, select: { id: true } }),
    prisma.organization.findFirst({ where: { id: organizationId, isDeleted: false, isActive: true }, select: { id: true } }),
  ]);
  if (membership) return { status: 'FORBIDDEN', message: ALREADY_IN_ORGANIZATION_MESSAGE };
  if (!organization) return { status: 'FORBIDDEN', message: 'La organización de esta invitación está desactivada' };
  return null;
}

/** The plugin creates the membership; the app also records who invited and when. */
async function recordAcceptedInvitation({ memberId, inviterId }: { memberId: string; inviterId: string }) {
  await prisma.membership.update({
    where: { id: memberId },
    data: { invitedBy: inviterId, acceptedAt: new Date(), status: MembershipStatus.ACTIVE },
  });
}

const options = buildAuthOptions({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: process.env.BETTER_AUTH_SECRET,
    // Outside production it may be missing: Better Auth infers it per request.
    baseURL: process.env.BETTER_AUTH_URL,
    secureCookies: secureCookiesFromEnv(process.env.HTTPS_ENABLED),
    signInMaxAttempts: signInMaxAttempts(),
    generateId: false,
    canSignIn,
    activeOrganizationFor,
    canAcceptInvitation,
    onInvitationAccepted: recordAcceptedInvitation,
});

export const auth = betterAuth({
  ...options,
  // nextCookies lets server actions (logout) set and clear the session cookie.
  plugins: [...options.plugins, nextCookies()],
});

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { MembershipStatus } from '@/generated/prisma';
import { prisma } from '@/lib/db';
import { buildAuthOptions, type SignInDenial } from './auth-options';
import { INVALID_CREDENTIALS_MESSAGE } from './auth-messages';

/**
 * Better Auth over the app database (users, sessions, accounts). Server only:
 * the browser talks to it through /api/auth/* (src/app/api/auth/[...all]).
 *
 * Env: BETTER_AUTH_SECRET (required in production), BETTER_AUTH_URL (public
 * origin of the app), HTTPS_ENABLED (secure cookies) and, only for E2E runs,
 * AUTH_SIGN_IN_MAX_ATTEMPTS (default 5 per minute and IP).
 */

const DEFAULT_SIGN_IN_MAX_ATTEMPTS = 5;

function signInMaxAttempts(): number {
  const value = Number(process.env.AUTH_SIGN_IN_MAX_ATTEMPTS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SIGN_IN_MAX_ATTEMPTS;
}

/**
 * Same rules the custom login applied after checking the password: deleted
 * user = invalid credentials; inactive user, organization or store = its own
 * message (only shown to whoever knows the password).
 */
async function canSignIn(userId: string): Promise<SignInDenial | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      isDeleted: true,
      memberships: {
        where: { deletedAt: null, status: MembershipStatus.ACTIVE },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
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
  const membership = user.memberships[0];
  if (membership && !membership.organization.isActive) {
    return { status: 'FORBIDDEN', message: 'Su organización ha sido desactivada. Por favor contacte a soporte' };
  }
  if (membership?.defaultStore && !membership.defaultStore.isActive) {
    return { status: 'FORBIDDEN', message: 'Su tienda ha sido desactivada. Por favor contacte a su administrador' };
  }
  return null;
}

export const auth = betterAuth({
  ...buildAuthOptions({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    secureCookies: process.env.HTTPS_ENABLED === 'true',
    signInMaxAttempts: signInMaxAttempts(),
    generateId: false,
    canSignIn,
  }),
  // Lets server actions (logout) set and clear the session cookie.
  plugins: [nextCookies()],
});

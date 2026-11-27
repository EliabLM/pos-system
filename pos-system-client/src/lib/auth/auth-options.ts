import bcrypt from 'bcrypt';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { organization } from 'better-auth/plugins/organization';
import { createAccessControl } from 'better-auth/plugins/access';
import { validatePassword, validateEmail } from './validation';
import { AuthError } from './types';

export { assertAuthEnv } from './auth-env';

/**
 * Better Auth configuration (#19), without infrastructure: the database
 * adapter and the sign-in rule come from outside, so tests build the real
 * handler over an in-memory adapter and production over Prisma
 * (`better-auth.ts`).
 */

/** Why a user with a valid password still cannot sign in. */
export interface SignInDenial {
  status: 'UNAUTHORIZED' | 'FORBIDDEN';
  message: string;
}

export interface AuthOptionsInput {
  database: BetterAuthOptions['database'];
  secret: string | undefined;
  baseURL: string | undefined;
  /** undefined = Better Auth decides (https base URL or production → Secure). */
  secureCookies: boolean | undefined;
  /** Sign-in requests allowed per client IP in SIGN_IN_WINDOW_SECONDS. */
  signInMaxAttempts: number;
  /** false: the database generates the id (uuidv7 in PostgreSQL). */
  generateId: false | 'uuid';
  canSignIn: (userId: string) => Promise<SignInDenial | null>;
  /** Organization a new session starts in (null = the user has none yet). */
  activeOrganizationFor: (userId: string) => Promise<string | null>;
  /** Why this user cannot accept an invitation to that organization (null = can). */
  canAcceptInvitation: (input: { userId: string; organizationId: string }) => Promise<SignInDenial | null>;
  /** After the plugin creates the membership of an accepted invitation. */
  onInvitationAccepted?: (input: { memberId: string; inviterId: string }) => Promise<void>;
}

export const SIGN_IN_WINDOW_SECONDS = 60;

/**
 * Client IP for the attempt limit. Traefik (Coolify) sets `x-real-ip` to the
 * single client address; `x-forwarded-for` is the fallback. Better Auth only
 * trusts a single-value header: a chain ("a, b") would put every client in one
 * shared counter.
 */
export const CLIENT_IP_HEADERS = ['x-real-ip', 'x-forwarded-for'];

/** HTTPS_ENABLED only overrides Better Auth when it is explicitly 'true' or 'false'. */
export function secureCookiesFromEnv(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** An invitation link works for 7 days; the ADMIN can revoke it before. */
export const INVITATION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

/**
 * Roles (#20). The plugin only manages invitations: the ADMIN creates and
 * cancels them; the SELLER has no organization permission. Members, roles and
 * the organization itself are edited by the app's own actions (user and
 * organization modules), which check the actor and the soft delete.
 */
const accessControl = createAccessControl({ invitation: ['create', 'cancel'] } as const);
export const ORGANIZATION_ROLES = {
  ADMIN: accessControl.newRole({ invitation: ['create', 'cancel'] }),
  SELLER: accessControl.newRole({ invitation: [] }),
};

/**
 * Organization endpoints that exist. Over HTTP only accepting an invitation:
 * nobody joins, creates or switches an organization any other way. Creating
 * and cancelling invitations only from the server (invitation actions, after
 * requireActor ADMIN). Every other plugin endpoint answers 404.
 */
const HTTP_ORGANIZATION_PATHS = new Set(['/organization/accept-invitation']);
const SERVER_ORGANIZATION_PATHS = new Set([
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/organization/accept-invitation',
]);

function checkOrganizationPath(path: string, fromHttp: boolean): void {
  if (!path.startsWith('/organization/')) return;
  const allowed = fromHttp ? HTTP_ORGANIZATION_PATHS : SERVER_ORGANIZATION_PATHS;
  if (!allowed.has(path)) throw new APIError('NOT_FOUND');
}

const BCRYPT_ROUNDS = 12;
const SESSION_DAYS = 7;

/** Registration rules kept from the custom auth (A11 does not change them). */
function checkSignUp(body: unknown): void {
  const { name, email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new APIError('BAD_REQUEST', { message: 'El nombre es requerido' });
  }
  try {
    validateEmail(typeof email === 'string' ? email : '');
  } catch (error) {
    if (error instanceof AuthError) throw new APIError('BAD_REQUEST', { message: error.message });
    throw error;
  }
  const strength = validatePassword(typeof password === 'string' ? password : '');
  if (!strength.valid) {
    throw new APIError('BAD_REQUEST', { message: strength.errors[0] });
  }
}

export function buildAuthOptions(input: AuthOptionsInput) {
  return {
    database: input.database,
    secret: input.secret,
    baseURL: input.baseURL,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // Existing users keep their bcrypt hashes (copied to accounts.password).
      password: {
        hash: (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS),
        verify: ({ hash, password }: { hash: string; password: string }) => bcrypt.compare(password, hash),
      },
    },
    session: {
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    user: {
      additionalFields: {
        isActive: { type: 'boolean', required: false, defaultValue: true, input: false },
        isDeleted: { type: 'boolean', required: false, defaultValue: false, input: false },
        lastLoginAt: { type: 'date', required: false, input: false },
      },
    },
    rateLimit: {
      // Also outside production: the limit is part of the contract (A11).
      enabled: true,
      storage: 'memory',
      window: SIGN_IN_WINDOW_SECONDS,
      max: 100,
      customRules: {
        '/sign-in/email': { window: SIGN_IN_WINDOW_SECONDS, max: input.signInMaxAttempts },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        checkOrganizationPath(ctx.path, Boolean(ctx.request));
        if (ctx.path === '/sign-up/email') checkSignUp(ctx.body);
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session: { userId: string }) => {
            const denial = await input.canSignIn(session.userId);
            if (denial) throw new APIError(denial.status, { message: denial.message });
            const activeOrganizationId = await input.activeOrganizationFor(session.userId);
            return { data: { ...session, activeOrganizationId } };
          },
          after: async (session: { userId: string }, ctx) => {
            await ctx?.context.internalAdapter.updateUser(session.userId, { lastLoginAt: new Date() });
          },
        },
      },
    },
    advanced: {
      useSecureCookies: input.secureCookies,
      ipAddress: { ipAddressHeaders: CLIENT_IP_HEADERS },
      database: { generateId: input.generateId },
    },
    plugins: [
      organization({
        ac: accessControl,
        roles: ORGANIZATION_ROLES,
        creatorRole: 'ADMIN',
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
        cancelPendingInvitationsOnReInvite: true,
        // There is no e-mail service (#20): the ADMIN copies the link and the
        // invitee must sign in with the invited e-mail. The link id is a random
        // UUIDv4 generated by the database.
        requireEmailVerificationOnInvitation: false,
        schema: {
          // organizations.email is required in the app (onboarding); declared
          // here so Better Auth's schema check knows it, never as an input.
          organization: {
            additionalFields: { email: { type: 'string', required: false, input: false } },
          },
          member: { modelName: 'membership' },
          invitation: { modelName: 'invitation' },
        },
        organizationHooks: {
          // Invitations are for sellers only (the ADMIN is whoever created the business).
          beforeCreateInvitation: async ({ invitation }) => {
            if (invitation.role !== 'SELLER') {
              throw new APIError('BAD_REQUEST', { message: 'Solo se puede invitar con el rol de vendedor' });
            }
          },
          beforeAcceptInvitation: async ({ invitation, user }) => {
            const denial = await input.canAcceptInvitation({ userId: user.id, organizationId: invitation.organizationId });
            if (denial) throw new APIError(denial.status, { message: denial.message });
          },
          afterAcceptInvitation: async ({ invitation, member }) => {
            await input.onInvitationAccepted?.({ memberId: member.id, inviterId: invitation.inviterId });
          },
        },
      }),
    ],
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

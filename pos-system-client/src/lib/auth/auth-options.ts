import bcrypt from 'bcrypt';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { validatePassword, validateEmail } from './validation';
import { AuthError } from './types';

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
  secureCookies: boolean;
  /** Sign-in requests allowed per client IP in SIGN_IN_WINDOW_SECONDS. */
  signInMaxAttempts: number;
  /** false: the database generates the id (uuidv7 in PostgreSQL). */
  generateId: false | 'uuid';
  canSignIn: (userId: string) => Promise<SignInDenial | null>;
}

export const SIGN_IN_WINDOW_SECONDS = 60;
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
        if (ctx.path === '/sign-up/email') checkSignUp(ctx.body);
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session: { userId: string }) => {
            const denial = await input.canSignIn(session.userId);
            if (denial) throw new APIError(denial.status, { message: denial.message });
          },
          after: async (session: { userId: string }, ctx) => {
            await ctx?.context.internalAdapter.updateUser(session.userId, { lastLoginAt: new Date() });
          },
        },
      },
    },
    advanced: {
      useSecureCookies: input.secureCookies,
      database: { generateId: input.generateId },
    },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

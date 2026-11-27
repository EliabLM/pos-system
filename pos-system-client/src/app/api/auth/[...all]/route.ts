import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth/better-auth';

// Better Auth endpoints (sign-in, sign-up, sign-out, get-session). Public by
// design: each endpoint checks credentials or the session cookie itself.
export const { GET, POST } = toNextJsHandler(auth);

import { createAuthClient } from 'better-auth/react';

/** Browser client for /api/auth/* (same origin as the app). */
export const authClient = createAuthClient();

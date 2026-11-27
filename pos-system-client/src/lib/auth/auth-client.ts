import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';

/** Browser client for /api/auth/* (same origin as the app). */
export const authClient = createAuthClient({
  // Only accept-invitation is reachable over HTTP (auth-options.ts, #20).
  plugins: [organizationClient()],
});

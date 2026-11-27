/**
 * Invitation links (#20): /invitacion/<id>. The id is a UUID; anything else
 * is ignored so the login and register forms never redirect to an arbitrary
 * URL.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isInvitationId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Where to go after signing in or registering from an invitation, or null. */
export function invitationReturnPath(value: unknown): string | null {
  return isInvitationId(value) ? `/invitacion/${value}` : null;
}

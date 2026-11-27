import { MembershipStatus } from '@/generated/prisma';

/**
 * Membership selection criterion shared by every place that derives tenancy
 * (actor, new session, session refresh): an ACTIVE membership of an active,
 * non-deleted organization; the oldest one when there is no active
 * organization in the session.
 */
export const ACTIVE_MEMBERSHIP_WHERE = {
  deletedAt: null,
  status: MembershipStatus.ACTIVE,
  organization: { isDeleted: false, isActive: true },
} as const;
export const ACTIVE_MEMBERSHIP_ORDER = { createdAt: 'asc' } as const;

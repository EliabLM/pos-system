import { prisma } from '@/lib/db';
import { isInvitationId } from './invitation-link';

export interface InvitationLinkView {
  id: string;
  email: string;
  organizationName: string;
}

/**
 * What the /invitacion/<id> page may show (#20): a pending, unexpired
 * invitation of an active organization; null otherwise (revoked, accepted,
 * expired or unknown look the same). Accepting goes through Better Auth,
 * which checks all of this again.
 */
export async function getInvitationLinkView(id: string): Promise<InvitationLinkView | null> {
  if (!isInvitationId(id)) return null;
  const invitation = await prisma.invitation.findFirst({
    where: {
      id,
      status: 'pending',
      expiresAt: { gt: new Date() },
      organization: { isActive: true, isDeleted: false },
    },
    select: { id: true, email: true, organization: { select: { name: true } } },
  });
  if (!invitation) return null;
  return { id: invitation.id, email: invitation.email, organizationName: invitation.organization.name };
}

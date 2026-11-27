'use client';

import React from 'react';
import { toast } from 'sonner';
import { IconCopy, IconX } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import { useCancelInvitation, usePendingInvitations } from '@/hooks/useInvitations';
import { copyInvitationLink } from './invite-seller-dialog';

const dateFormat = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });

/** Pending invitations of the organization, with their link and revoke (#20). */
export function PendingInvitations() {
  const invitations = usePendingInvitations();
  const cancelInvitation = useCancelInvitation();

  if (!invitations.data?.length) return null;

  const onCancel = async (id: string) => {
    try {
      await cancelInvitation.mutateAsync(id);
      toast.success('Invitación revocada');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo revocar la invitación');
    }
  };

  return (
    <section aria-labelledby="pending-invitations" className="border-t border-border px-6 py-4">
      <h3 id="pending-invitations" className="mb-2 text-sm font-medium">
        Invitaciones pendientes
      </h3>
      <ul className="divide-y divide-border">
        {invitations.data.map((invitation) => (
          <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              {invitation.email}
              <span className="text-muted-foreground"> · vence el {dateFormat.format(new Date(invitation.expiresAt))}</span>
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1" onClick={() => copyInvitationLink(invitation.id)}>
                <IconCopy className="size-4" />
                Copiar enlace
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={cancelInvitation.isPending}
                onClick={() => onCancel(invitation.id)}
                aria-label={`Revocar la invitación de ${invitation.email}`}
              >
                <IconX className="size-4" />
                Revocar
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

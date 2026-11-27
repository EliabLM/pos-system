'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getCurrentUser, logoutUser } from '@/actions/auth';
import { authClient } from '@/lib/auth/auth-client';
import { authErrorMessage } from '@/lib/auth/auth-messages';
import { clearZustandStorage } from '@/lib/logout-cleanup';
import { useStore } from '@/store';
import { User } from '@/interfaces';

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const setUser = useStore((state) => state.setUser);
  const [loading, setLoading] = useState(false);

  const accept = async () => {
    setLoading(true);
    try {
      const { error } = await authClient.organization.acceptInvitation({ invitationId });
      if (error) {
        toast.error(authErrorMessage(error));
        return;
      }
      const current = await getCurrentUser();
      if (current.status === 200 && current.data?.user) setUser(current.data.user as unknown as User);
      toast.success('Invitación aceptada');
      window.location.href = '/dashboard';
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={accept} disabled={loading}>
      {loading ? 'Aceptando…' : 'Aceptar invitación'}
    </Button>
  );
}

export function SignOutAndRetry({ invitationId }: { invitationId: string }) {
  const [loading, setLoading] = useState(false);

  const signOut = async () => {
    setLoading(true);
    await logoutUser();
    clearZustandStorage();
    window.location.href = `/auth/login?invitacion=${invitationId}`;
  };

  return (
    <Button variant="outline" onClick={signOut} disabled={loading}>
      Cerrar sesión y entrar con otro correo
    </Button>
  );
}

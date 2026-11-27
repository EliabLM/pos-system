'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { IconCopy, IconUserPlus } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useCreateInvitation } from '@/hooks/useInvitations';

/** Link the ADMIN shares with the seller (there is no e-mail service, #20). */
export const invitationLink = (id: string) => `${window.location.origin}/invitacion/${id}`;

export async function copyInvitationLink(id: string) {
  try {
    await navigator.clipboard.writeText(invitationLink(id));
    toast.success('Enlace copiado');
  } catch {
    toast.error('No se pudo copiar. Selecciona el enlace y cópialo a mano');
  }
}

export function InviteSellerDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<{ id: string; email: string } | null>(null);
  const createInvitation = useCreateInvitation();

  const reset = () => {
    setEmail('');
    setLink(null);
    createInvitation.reset();
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const invitation = await createInvitation.mutateAsync(email);
      setLink({ id: invitation.id, email: invitation.email });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la invitación');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <IconUserPlus className="size-4" />
          <span className="hidden sm:inline">Invitar vendedor</span>
          <span className="sm:hidden">Invitar</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitar vendedor</DialogTitle>
          <DialogDescription>
            Escribe el correo del vendedor. Te daremos un enlace para que se lo envíes; vence en 7 días.
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="space-y-3">
            <p className="text-sm">
              Envía este enlace a <strong>{link.email}</strong>. Debe entrar o crear su cuenta con ese correo.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={invitationLink(link.id)} aria-label="Enlace de invitación" onFocus={(e) => e.target.select()} />
              <Button type="button" variant="outline" className="gap-2" onClick={() => copyInvitationLink(link.id)}>
                <IconCopy className="size-4" />
                Copiar
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Invitar a otro
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Correo del vendedor</Label>
              <Input
                id="invite-email"
                type="email"
                required
                placeholder="vendedor@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createInvitation.isPending}>
                {createInvitation.isPending ? 'Creando…' : 'Crear invitación'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

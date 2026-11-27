'use server';

import { headers } from 'next/headers';
import { MembershipRole } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { auth } from '@/lib/auth/better-auth';
import { prisma } from '../utils';
import { createInvitationInputSchema, invitationIdSchema } from './invitation.schemas';

// ============================================================
// Invitaciones (#20). Los vendedores entran solo por invitación del ADMIN:
// el ADMIN crea una invitación para un correo y copia el enlace
// /invitacion/<id> (no hay servicio de correo). El plugin organization de
// Better Auth guarda la invitación y, al aceptarla, crea la membresía SELLER.
// La organización sale del actor y el rol es siempre SELLER.
// ============================================================

export interface InvitationView {
  id: string;
  email: string;
  expiresAt: Date;
}

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

const PLUGIN_ERRORS: Record<string, { status: number; message: string }> = {
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: { status: 409, message: 'Ese correo ya pertenece a la organización' },
  INVITATION_LIMIT_REACHED: { status: 409, message: 'Se alcanzó el límite de invitaciones pendientes' },
};

const pluginErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object' || !('body' in error)) return undefined;
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== 'object' || !('code' in body)) return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

const badRequest = (message: string) => ({ status: 400, message, data: null });

// CREATE — el ADMIN invita un correo a SU organización como vendedor
export const createInvitation = async (input: {
  email: string;
}): Promise<ActionResponse<InvitationView | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    const parsed = createInvitationInputSchema.safeParse(input);
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Datos inválidos');

    // Re-inviting the same e-mail cancels the previous pending invitation.
    const invitation = await auth.api.createInvitation({
      headers: await headers(),
      body: { email: parsed.data.email, role: MembershipRole.SELLER, organizationId: actor.organizationId },
    });

    return {
      status: 201,
      message: 'Invitación creada. Copia el enlace y compártelo con el vendedor',
      data: { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt },
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    const known = PLUGIN_ERRORS[pluginErrorCode(error) ?? ''];
    if (known) return { ...known, data: null };
    console.error('Error creating invitation:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET MANY — invitaciones pendientes y vigentes de la organización del actor
export const getPendingInvitations = async (): Promise<ActionResponse<InvitationView[] | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    const invitations = await prisma.invitation.findMany({
      where: { organizationId: actor.organizationId, status: 'pending', expiresAt: { gt: new Date() } },
      select: { id: true, email: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return { status: 200, message: 'Invitaciones obtenidas exitosamente', data: invitations };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching invitations:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// CANCEL — el ADMIN revoca una invitación pendiente de su organización
export const cancelInvitation = async (invitationId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    const parsedId = invitationIdSchema.safeParse(invitationId);
    if (!parsedId.success) return badRequest('ID de invitación inválido');

    const invitation = await prisma.invitation.findFirst({
      where: { id: parsedId.data, organizationId: actor.organizationId, status: 'pending' },
      select: { id: true },
    });
    if (!invitation) return { status: 404, message: 'Invitación no encontrada', data: null };

    await auth.api.cancelInvitation({ headers: await headers(), body: { invitationId: invitation.id } });

    return { status: 200, message: 'Invitación revocada', data: null };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error canceling invitation:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

import { z } from 'zod';

/** Input of an invitation: only the e-mail. Organization and role never come from the client. */
export const createInvitationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido').max(254),
});

export const invitationIdSchema = z.string().uuid('ID de invitación inválido');

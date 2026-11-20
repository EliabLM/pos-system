import { z } from 'zod';
import { name } from '../common.schemas';

const paymentType = z.enum(['CASH', 'CARD', 'TRANSFER', 'CREDIT', 'CHECK', 'OTHER']);

/** Whitelisted payment method fields; organization and audit fields come from the server. */
export const createPaymentMethodInputSchema = z.object({
  name,
  type: paymentType,
  isActive: z.boolean().default(true),
});

export const updatePaymentMethodInputSchema = z.object({
  name,
  type: paymentType,
  isActive: z.boolean(),
}).partial();

export type CreatePaymentMethodInput = z.input<typeof createPaymentMethodInputSchema>;
export type UpdatePaymentMethodInput = z.input<typeof updatePaymentMethodInputSchema>;

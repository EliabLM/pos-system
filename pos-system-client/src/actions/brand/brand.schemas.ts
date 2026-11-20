import { z } from 'zod';
import { longText, name } from '../common.schemas';

/** Whitelisted brand fields; organization and audit fields come from the server. */
export const createBrandInputSchema = z.object({
  name,
  description: longText.nullish(),
  isActive: z.boolean().optional(),
});

export const updateBrandInputSchema = createBrandInputSchema.partial();

export type CreateBrandInput = z.input<typeof createBrandInputSchema>;
export type UpdateBrandInput = z.input<typeof updateBrandInputSchema>;

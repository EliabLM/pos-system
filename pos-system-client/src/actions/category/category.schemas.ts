import { z } from 'zod';
import { longText, name } from '../common.schemas';

/** Whitelisted category fields; organization and audit fields come from the server. */
export const createCategoryInputSchema = z.object({
  name,
  description: longText.nullish(),
  isActive: z.boolean().optional(),
});

export const updateCategoryInputSchema = createCategoryInputSchema.partial();

export type CreateCategoryInput = z.input<typeof createCategoryInputSchema>;
export type UpdateCategoryInput = z.input<typeof updateCategoryInputSchema>;

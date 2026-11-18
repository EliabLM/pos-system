import { z } from 'zod';
import { name } from '../common.schemas';

/** Whitelisted unit measure fields; organization and audit fields come from the server. */
export const createUnitMeasureInputSchema = z.object({
  name,
  abbreviation: z.string().trim().min(1, 'La abreviación es requerida').max(20),
  isActive: z.boolean().optional(),
});

export const updateUnitMeasureInputSchema = createUnitMeasureInputSchema.partial();

export type CreateUnitMeasureInput = z.input<typeof createUnitMeasureInputSchema>;
export type UpdateUnitMeasureInput = z.input<typeof updateUnitMeasureInputSchema>;

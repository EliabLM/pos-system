import { z } from 'zod';
import { name, optionalText, shortText } from '../common.schemas';

/**
 * Whitelisted store fields. Organization, sale counter and audit fields come
 * from the server.
 */
const editableFields = {
  name,
  address: shortText.min(1, 'La dirección es requerida'),
  description: optionalText,
  city: optionalText,
  department: optionalText,
  phone: optionalText,
  isActive: z.boolean(),
};

export const createStoreInputSchema = z.object({
  ...editableFields,
  saleNumberPrefix: shortText.default(''),
  isActive: z.boolean().default(true),
});

/** The sale number prefix is fixed once the store exists (it is in every sale number). */
export const updateStoreInputSchema = z.object(editableFields).partial();

export type CreateStoreInput = z.input<typeof createStoreInputSchema>;
export type UpdateStoreInput = z.input<typeof updateStoreInputSchema>;

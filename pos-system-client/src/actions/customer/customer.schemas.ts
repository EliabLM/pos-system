import { z } from 'zod';
import { name, optionalText } from '../common.schemas';

/** Whitelisted customer fields; organization and audit fields come from the server. */
const editableFields = {
  firstName: name,
  lastName: name,
  email: optionalText,
  phone: optionalText,
  address: optionalText,
  city: optionalText,
  department: optionalText,
  document: optionalText,
  documentType: optionalText,
  isActive: z.boolean(),
};

export const createCustomerInputSchema = z.object({
  ...editableFields,
  isActive: z.boolean().default(true),
});

export const updateCustomerInputSchema = z.object(editableFields).partial();

export const customerFiltersSchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    isActive: z.boolean().optional(),
    city: z.string().trim().max(255).optional(),
    department: z.string().trim().max(255).optional(),
  })
  .optional();

export const customerLookupSchema = z.string().trim().min(1).max(255);

export type CreateCustomerInput = z.input<typeof createCustomerInputSchema>;
export type UpdateCustomerInput = z.input<typeof updateCustomerInputSchema>;
export type CustomerFiltersInput = z.input<typeof customerFiltersSchema>;

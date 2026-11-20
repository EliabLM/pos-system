import { z } from 'zod';
import { name, optionalText } from '../common.schemas';

/** Whitelisted supplier fields; organization and audit fields come from the server. */
const editableFields = {
  name,
  contactName: optionalText,
  email: optionalText,
  phone: optionalText,
  address: optionalText,
  city: optionalText,
  department: optionalText,
  taxId: optionalText,
  isActive: z.boolean(),
};

export const createSupplierInputSchema = z.object({
  ...editableFields,
  isActive: z.boolean().default(true),
});

export const updateSupplierInputSchema = z.object(editableFields).partial();

export const supplierFiltersSchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    isActive: z.boolean().optional(),
    city: z.string().trim().max(255).optional(),
    department: z.string().trim().max(255).optional(),
  })
  .optional();

export const supplierLookupSchema = z.string().trim().min(1).max(255);

export type CreateSupplierInput = z.input<typeof createSupplierInputSchema>;
export type UpdateSupplierInput = z.input<typeof updateSupplierInputSchema>;
export type SupplierFiltersInput = z.input<typeof supplierFiltersSchema>;

import { z } from 'zod';
import { longText, optionalText, shortText } from '../common.schemas';

/** Set once in onboarding; it can't be created or changed afterwards. */
export const BUSINESS_TYPE_KEY = 'business_type';

export const businessTypeSchema = z.enum(['liquor_store', 'shoe_store']);
export type BusinessType = z.infer<typeof businessTypeSchema>;

export const configKeySchema = shortText.min(1, 'La clave es requerida');
export const configValueSchema = longText;

/** Whitelisted config fields; the organization comes from the session. */
export const createSystemConfigInputSchema = z.object({
  key: configKeySchema,
  value: configValueSchema,
  type: shortText.min(1).default('STRING'),
  description: optionalText.default(null),
});

export type CreateSystemConfigInput = z.input<typeof createSystemConfigInputSchema>;

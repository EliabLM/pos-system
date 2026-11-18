import { z } from 'zod';
import { idSchema, shortText } from '../common.schemas';

const movementType = z.enum(['IN', 'OUT', 'ADJUSTMENT']);
const optionalText = shortText.nullish().transform((value) => value || null);

/** Whitelisted movement fields; organization, user and stock values come from the server. */
export const createStockMovementInputSchema = z.object({
  productId: idSchema,
  type: movementType,
  quantity: z.number().int().positive('La cantidad debe ser mayor a 0').max(1_000_000_000),
  reason: optionalText,
  reference: optionalText,
  storeId: idSchema.nullish().transform((value) => value ?? null),
});

export const updateStockMovementInputSchema = z.object({
  reason: shortText.optional(),
  reference: shortText.optional(),
  storeId: idSchema.optional(),
});

export const stockMovementFiltersSchema = z
  .object({
    productId: idSchema.optional(),
    type: movementType.optional(),
    userId: idSchema.optional(),
    storeId: idSchema.optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    search: z.string().trim().max(100).optional(),
  })
  .optional();

export const dateRangeFiltersSchema = z
  .object({
    productId: idSchema.optional(),
    type: movementType.optional(),
  })
  .optional();

export const optionalDate = z.coerce.date().optional();
export const requiredDate = z.coerce.date();

export type CreateStockMovementInput = z.input<typeof createStockMovementInputSchema>;
export type UpdateStockMovementInput = z.input<typeof updateStockMovementInputSchema>;
export type StockMovementFiltersInput = z.input<typeof stockMovementFiltersSchema>;
export type DateRangeFiltersInput = z.input<typeof dateRangeFiltersSchema>;

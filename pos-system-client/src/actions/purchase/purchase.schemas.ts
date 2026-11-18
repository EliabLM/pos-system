import { z } from 'zod';
import { dateInput, idSchema, longText, money } from '../common.schemas';

/**
 * Input contracts for purchases. Zod objects strip unknown keys: the
 * organization, purchase number, status and totals always come from the
 * server, never from the client.
 */
const quantity = z.number().int().positive('La cantidad debe ser mayor a 0').max(1_000_000);
const unitPrice = money;

export const purchaseItemInputSchema = z.object({
  productId: idSchema,
  quantity,
  unitPrice,
});

export const createPurchaseInputSchema = z.object({
  purchaseData: z.object({
    supplierId: idSchema,
    purchaseDate: dateInput.optional(),
    notes: longText.nullish(),
  }),
  purchaseItems: z.array(purchaseItemInputSchema).min(1, 'La compra debe tener al menos un item').max(500),
});

export const updatePurchaseInputSchema = z.object({
  notes: longText.nullish(),
});

export const cancelReasonSchema = longText.optional();

export const purchaseFiltersSchema = z
  .object({
    supplierId: idSchema.optional(),
    status: z.enum(['PENDING', 'RECEIVED', 'CANCELLED']).optional(),
    dateFrom: dateInput.optional(),
    dateTo: dateInput.optional(),
    search: z.string().trim().max(100).optional(),
    minAmount: money.optional(),
    maxAmount: money.optional(),
  })
  .optional();

export const dateRangeSchema = z.object({
  dateFrom: dateInput.optional(),
  dateTo: dateInput.optional(),
});

export const purchaseNumberSchema = z.string().trim().min(1, 'Número de compra es requerido').max(64);

export const updatePurchaseItemInputSchema = purchaseItemInputSchema
  .pick({ quantity: true, unitPrice: true })
  .partial();

export type PurchaseItemInput = z.input<typeof purchaseItemInputSchema>;
export type CreatePurchaseInput = z.input<typeof createPurchaseInputSchema>;
export type UpdatePurchaseInput = z.input<typeof updatePurchaseInputSchema>;
export type PurchaseFiltersInput = z.input<typeof purchaseFiltersSchema>;
export type UpdatePurchaseItemInput = z.input<typeof updatePurchaseItemInputSchema>;

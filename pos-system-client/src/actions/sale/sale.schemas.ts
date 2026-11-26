import { z } from 'zod';

/**
 * Input contracts for sales actions. Zod objects strip unknown keys, so
 * fields such as `organizationId`, `userId`, `subtotal` or `total` sent by
 * the client never reach Prisma: tenancy and identity come from the actor.
 */
const id = z.string().regex(/^[0-9a-f-]{36}$/i, 'ID inválido');
const money = z.number().finite().nonnegative().max(9_999_999_999.99);
const quantity = z.number().int().positive().max(1_000_000);
const shortText = z.string().trim().max(255);
const longText = z.string().trim().max(2000);
const saleStatus = z.enum(['PAID', 'PENDING', 'OVERDUE', 'CANCELLED']);

export const idSchema = id;

export const saleItemInputSchema = z.object({
  productId: id,
  unitMeasureId: id.nullish(),
  quantity,
  /** Solo el ADMIN puede fijar otro precio; si falta, se usa el precio del producto. */
  unitPrice: money.optional(),
});

export const salePaymentInputSchema = z.object({
  paymentMethodId: id,
  amount: money.positive(),
  reference: shortText.nullish(),
  notes: longText.nullish(),
  paymentDate: z.coerce.date().optional(),
});

export const createSaleInputSchema = z.object({
  saleData: z.object({
    storeId: id,
    customerId: id.nullish(),
    status: z.enum(['PAID', 'PENDING']).default('PAID'),
    saleDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().nullish(),
    notes: longText.nullish(),
  }),
  saleItems: z.array(saleItemInputSchema).min(1, 'La venta debe tener al menos un item').max(500),
  salePayments: z.array(salePaymentInputSchema).max(50).optional(),
});

export const saleFiltersSchema = z
  .object({
    storeId: id.optional(),
    customerId: id.optional(),
    userId: id.optional(),
    status: saleStatus.optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    search: z.string().trim().max(100).optional(),
    minAmount: money.optional(),
    maxAmount: money.optional(),
  })
  .optional();

export const paginationSchema = z
  .object({
    page: z.number().int().positive().max(100_000).optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .optional();

export const updateSaleInputSchema = z.object({
  customerId: id.nullish(),
  status: saleStatus.optional(),
  dueDate: z.coerce.date().nullish(),
  paidDate: z.coerce.date().nullish(),
  notes: longText.nullish(),
});

export const analyticsInputSchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  storeId: id.optional(),
});

export const updateSaleItemInputSchema = z.object({
  quantity: quantity.optional(),
  unitPrice: money.optional(),
});

export const updateSalePaymentInputSchema = z.object({
  amount: money.positive().optional(),
  reference: shortText.nullish(),
  notes: longText.nullish(),
  paymentDate: z.coerce.date().optional(),
});

export type CreateSaleInput = z.input<typeof createSaleInputSchema>;
export type SaleFiltersInput = z.input<typeof saleFiltersSchema>;
export type PaginationInput = z.input<typeof paginationSchema>;
export type UpdateSaleInput = z.input<typeof updateSaleInputSchema>;
export type SaleItemInput = z.input<typeof saleItemInputSchema>;
export type UpdateSaleItemInput = z.input<typeof updateSaleItemInputSchema>;
export type SalePaymentInput = z.input<typeof salePaymentInputSchema>;
export type UpdateSalePaymentInput = z.input<typeof updateSalePaymentInputSchema>;

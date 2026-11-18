import { z } from 'zod';
import { idSchema, longText, money, name, shortText, stockQuantity } from '../common.schemas';

/**
 * Barcode and SKU are unique per organization. The form sends `''` when the
 * field is left blank, so an empty or whitespace-only value is stored as
 * `null`; otherwise two products without a code would collide.
 */
const optionalCode = shortText
  .nullish()
  .transform((value) => (value === '' ? null : value));

/**
 * Whitelisted product fields. Organization, audit and soft-delete fields come
 * from the server; `currentStock` only changes through stock operations after
 * the product is created.
 */
const editableFields = {
  name,
  description: longText.nullish(),
  image: z.string().trim().max(2048).nullish(),
  barcode: optionalCode,
  sku: optionalCode,
  categoryId: idSchema.nullish(),
  brandId: idSchema.nullish(),
  unitMeasureId: idSchema.nullish(),
  costPrice: money,
  salePrice: money,
  minStock: stockQuantity,
  alcoholGrade: z.number().finite().min(0).max(100).nullish(),
  volume: z.number().finite().nonnegative().max(1_000_000).nullish(),
  size: shortText.nullish(),
  color: shortText.nullish(),
  model: shortText.nullish(),
  isActive: z.boolean(),
};

export const createProductInputSchema = z.object({
  ...editableFields,
  minStock: stockQuantity.default(0),
  currentStock: stockQuantity.default(0),
  isActive: z.boolean().default(true),
});

export const updateProductInputSchema = z.object(editableFields).partial();

export const productFiltersSchema = z
  .object({
    isActive: z.boolean().optional(),
    categoryId: idSchema.optional(),
    brandId: idSchema.optional(),
    lowStock: z.boolean().optional(),
    search: z.string().trim().max(100).optional(),
  })
  .optional();

export const updateStockInputSchema = z.object({
  stockChange: stockQuantity,
  type: z.enum(['SET', 'INCREMENT', 'DECREMENT']),
});

export const lookupCodeSchema = z.string().trim().min(1).max(255);

export type CreateProductInput = z.input<typeof createProductInputSchema>;
export type UpdateProductInput = z.input<typeof updateProductInputSchema>;
export type ProductFiltersInput = z.input<typeof productFiltersSchema>;
export type StockUpdateType = z.input<typeof updateStockInputSchema>['type'];

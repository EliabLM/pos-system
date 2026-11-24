import { z } from 'zod';
import { businessDateInput, idSchema, topLimitSchema } from '../common.schemas';

/**
 * Dashboard inputs. The organization and, for a SELLER bound to a store, the
 * store come from the actor, never from these parameters.
 */
export const dashboardStoreSchema = idSchema.nullish();

export const salesByPeriodInputSchema = z.object({
  period: z.enum(['day', 'week', 'month', 'year']),
  storeId: dashboardStoreSchema,
  referenceDate: businessDateInput.optional(),
});

export const topProductsInputSchema = z.object({
  period: z.enum(['today', 'week', 'month', 'year']),
  storeId: dashboardStoreSchema,
  limit: topLimitSchema.default(10),
});

export const cashStatusInputSchema = z.object({
  storeId: dashboardStoreSchema,
  date: businessDateInput.optional(),
});

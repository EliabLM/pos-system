import { z } from 'zod';
import { endOfBusinessDay, startOfBusinessDay, toBusinessDayKey } from '@/lib/time';
import type { Actor, ActorRole } from '@/lib/auth/actor';
import { businessDateInput, idSchema, shortText } from '../common.schemas';

/**
 * Report inputs. Reports are ADMIN only and always run on a date range; the
 * organization comes from the actor, so any `organizationId` the client sends
 * is dropped (Zod objects strip unknown keys).
 */
const startNotAfterEnd = (range: { startDate: Date | string; endDate: Date | string }) => {
  try {
    return toBusinessDayKey(range.startDate) <= toBusinessDayKey(range.endDate);
  } catch {
    return false; // an unparsable date already failed its own check
  }
};
const reversedRange = { message: 'La fecha inicial no puede ser posterior a la final' };
/** Whole business days: from 00:00 of the first day to 23:59:59.999 of the last one (America/Bogota). */
const toBusinessDays = <T extends { startDate: Date | string; endDate: Date | string }>(range: T) => ({
  ...range,
  startDate: startOfBusinessDay(range.startDate),
  endDate: endOfBusinessDay(range.endDate),
});

export const dateRangeSchema = z
  .object({ startDate: businessDateInput, endDate: businessDateInput })
  .refine(startNotAfterEnd, reversedRange)
  .transform(toBusinessDays);

const baseFilters = {
  storeId: idSchema.optional(),
  dateRange: dateRangeSchema,
  period: z.enum(['day', 'week', 'month', 'year']).optional(),
};

export const salesReportFiltersSchema = z.object({
  ...baseFilters,
  productId: idSchema.optional(),
  categoryId: idSchema.optional(),
  brandId: idSchema.optional(),
  paymentMethodId: idSchema.optional(),
  sellerId: idSchema.optional(),
  customerId: idSchema.optional(),
});

export const inventoryReportFiltersSchema = z.object({
  ...baseFilters,
  productId: idSchema.optional(),
  categoryId: idSchema.optional(),
  brandId: idSchema.optional(),
  lowStock: z.boolean().optional(),
  outOfStock: z.boolean().optional(),
});

export const customerReportFiltersSchema = z.object({
  ...baseFilters,
  customerId: idSchema.optional(),
  city: shortText.optional(),
  department: shortText.optional(),
  minPurchases: z.number().int().nonnegative().max(1_000_000).optional(),
});

export const financialReportFiltersSchema = z
  .object({
    storeId: idSchema.optional(),
    startDate: businessDateInput,
    endDate: businessDateInput,
    compareWithPrevious: z.boolean().optional(),
  })
  .refine(startNotAfterEnd, reversedRange)
  .transform(toBusinessDays);

export const REPORT_INPUT_ERROR = 'Filtros del reporte inválidos: indica un rango de fechas válido';

export type SalesReportInput = z.output<typeof salesReportFiltersSchema>;
export type InventoryReportInput = z.output<typeof inventoryReportFiltersSchema>;
export type CustomerReportInput = z.output<typeof customerReportFiltersSchema>;
export type FinancialReportInput = z.output<typeof financialReportFiltersSchema>;

/** Reports module: ADMIN only (`lib/rbac.ts`). */
export const REPORT_ROLES: readonly ActorRole[] = ['ADMIN'];

/** Validated filters plus the actor's organization, the only one a report reads. */
export type ScopedReportFilters<T> = T & { organizationId: string };

/**
 * Parses the client filters with `schema` and scopes them to the actor's
 * organization. Returns null when the filters are invalid. The caller must
 * have called `requireActor({ roles: REPORT_ROLES })` first.
 */
export function scopeReportFilters<T>(
  actor: Actor,
  schema: z.ZodType<T>,
  raw: unknown
): ScopedReportFilters<T> | null {
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ...parsed.data, organizationId: actor.organizationId } : null;
}

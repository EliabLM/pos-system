import { z } from 'zod';
import type { Actor } from '@/lib/auth/actor';

/**
 * Shared input building blocks for server actions. Zod objects strip unknown
 * keys, so tenancy/identity fields sent by the client never reach Prisma.
 */
export const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, 'ID inválido');
export const money = z.number().finite().nonnegative().max(9_999_999_999.99);
export const stockQuantity = z.number().int().nonnegative().max(1_000_000_000);
export const name = z.string().trim().min(1, 'El nombre es requerido').max(255);
export const shortText = z.string().trim().max(255);
export const longText = z.string().trim().max(2000);

/**
 * Optional short text. Forms send `''` for a blank field, so empty or
 * whitespace-only values are stored as `null`. This matters for the values
 * under a per-organization unique index (barcode, SKU, email, document, tax
 * id): otherwise two records without the value would collide.
 */
export const optionalText = shortText
  .nullish()
  .transform((value) => (value === '' ? null : value));

/** How many rows a ranking returns. */
export const topLimitSchema = z.number().int().positive().max(100);

/** Date or ISO string from the client. */
export const dateInput = z.coerce.date();

/**
 * Business-day boundary for reports and the dashboard: a `Date` or a string.
 * The value is kept as sent because a date-only string (`YYYY-MM-DD`) means
 * that business day literally (see `toBusinessDayKey` in `@/lib/time`), while
 * coercing it to a `Date` would read it as UTC midnight (the previous day in
 * Bogota).
 */
export const businessDateInput = z.union([
  z.date().refine((date) => !Number.isNaN(date.getTime()), 'Fecha inválida'),
  z.string().trim().max(40).refine((value) => !Number.isNaN(Date.parse(value)), 'Fecha inválida'),
]);

/**
 * Store a sales read is limited to: a SELLER bound to a store only sees that
 * store, whatever the client asks; anyone else gets the store they asked for
 * (always inside their own organization, which the query filters separately).
 */
export const scopedStoreId = (actor: Actor, requested?: string | null): string | undefined =>
  actor.role === 'SELLER' && actor.storeId ? actor.storeId : requested ?? undefined;

export const paginationSchema = z
  .object({
    page: z.number().int().positive().max(100_000).optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .optional();

export type PaginationInput = z.input<typeof paginationSchema>;

export const invalidInput = (message = 'Datos inválidos') =>
  ({ status: 400, message, data: null }) as const;

export const internalError = () =>
  ({ status: 500, message: 'Error interno del servidor', data: null }) as const;

/** First Zod issue as a user-facing message. */
export const firstIssue = (error: z.ZodError, fallback = 'Datos inválidos') =>
  error.issues[0]?.message ?? fallback;

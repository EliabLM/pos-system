import { z } from 'zod';

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

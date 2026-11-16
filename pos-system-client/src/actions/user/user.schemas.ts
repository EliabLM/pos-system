import { z } from 'zod';
import { validatePassword } from '@/lib/auth/validation';

/**
 * Input contracts for user management. Zod objects strip unknown keys, so
 * `organizationId`, `userId` or any other field sent by the client never
 * reaches Prisma: the organization always comes from the actor.
 */
const id = z.string().regex(/^[0-9a-f-]{36}$/i, 'ID inválido');
const role = z.enum(['ADMIN', 'SELLER']);
/** Misma política que el registro (validatePassword con sus requisitos por defecto). */
const password = z
  .string()
  .max(128)
  .superRefine((value, ctx) => {
    const result = validatePassword(value);
    if (!result.valid) {
      ctx.addIssue({ code: 'custom', message: result.errors[0] ?? 'Contraseña inválida' });
    }
  });

/** '' (select vacío) se trata como "sin tienda". */
const optionalStoreId = z.preprocess((value) => (value === '' ? null : value), id.nullish());

export const idSchema = id;
export const roleSchema = role;

export const createUserInputSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(150),
  email: z.string().trim().toLowerCase().email('Email inválido').max(254),
  password,
  role,
  storeId: optionalStoreId,
  isActive: z.boolean().optional(),
});

export const updateUserInputSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  email: z.string().trim().toLowerCase().email('Email inválido').max(254).optional(),
  image: z.string().trim().max(2048).nullish(),
  isActive: z.boolean().optional(),
  password: password.optional(),
  role: role.optional(),
  storeId: optionalStoreId,
});

export const userFiltersSchema = z
  .object({
    isActive: z.boolean().optional(),
    role: role.optional(),
    storeId: id.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .optional();

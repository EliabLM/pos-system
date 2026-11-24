import { Membership, Prisma } from '@/generated/prisma';
import { Serialized } from '@/interfaces';
import { prisma } from '@/lib/db';
import { ACTIVE_MEMBERSHIP_ORDER, ACTIVE_MEMBERSHIP_WHERE } from '@/lib/auth/actor';

// Instancia única de Prisma Client (singleton en globalThis, ver lib/db.ts)
export { prisma };

/**
 * Devuelve el membership ACTIVO del usuario (D3.3: la tenancy vive en
 * memberships). null = usuario en onboarding (aún sin organización) o
 * con membership revocado.
 */
export const getActiveMembership = async (
  userId: string
): Promise<Membership | null> => {
  if (!userId) return null;
  return prisma.membership.findFirst({
    // Mismo criterio que getActor() (organización activa y no borrada)
    where: { userId, ...ACTIVE_MEMBERSHIP_WHERE },
    orderBy: ACTIVE_MEMBERSHIP_ORDER,
  });
};

/**
 * Convierte recursivamente los `Prisma.Decimal` (dinero: numeric(12,2) en la DB)
 * a `number` en la frontera de las server actions. Los `Decimal` no sobreviven
 * la serialización server→client de Next.js, y toda la UI opera con `number`.
 */
export const serializeDecimals = <T>(value: T): Serialized<T> => {
  // isDecimal, not instanceof: the value may come from another copy of the
  // Prisma runtime (another bundle layer) and still be a Decimal.
  if (Prisma.Decimal.isDecimal(value)) {
    return value.toNumber() as unknown as Serialized<T>;
  }
  if (value === null || value instanceof Date || typeof value !== 'object') {
    return value as unknown as Serialized<T>;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeDecimals(item)) as unknown as Serialized<T>;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = serializeDecimals(entry);
  }
  return result as unknown as Serialized<T>;
};

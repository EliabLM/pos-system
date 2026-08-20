import { Prisma, PrismaClient, UserRole } from '@/generated/prisma';
import { ActionResponse, Serialized } from '@/interfaces';

// Instancia única de Prisma Client para ser usada en todas las actions
export const prisma = new PrismaClient();

/**
 * Convierte recursivamente los `Prisma.Decimal` (dinero: numeric(12,2) en la DB)
 * a `number` en la frontera de las server actions. Los `Decimal` no sobreviven
 * la serialización server→client de Next.js, y toda la UI opera con `number`.
 */
export const serializeDecimals = <T>(value: T): Serialized<T> => {
  if (value instanceof Prisma.Decimal) {
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

/**
 * Verifica si un usuario tiene el rol de ADMIN.
 * @param userId - El ID del usuario que realiza la acción.
 * @returns {Promise<boolean>} - True si el usuario es ADMIN, de lo contrario false.
 */
export const checkAdminRole = async (userId: string): Promise<boolean> => {
  if (!userId) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role === UserRole.ADMIN;
  } catch (error) {
    console.error("Error checking admin role:", error);
    return false;
  }
};

/**
 * Verifica si un usuario tiene el rol de ADMIN o SELLER.
 * @param userId - El ID del usuario que realiza la acción.
 * @returns {Promise<boolean>} - True si el usuario es ADMIN o SELLER, de lo contrario false.
 */
export const checkAdminOrSellerRole = async (userId: string): Promise<boolean> => {
  if (!userId) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role === UserRole.ADMIN || user?.role === UserRole.SELLER;
  } catch (error) {
    console.error("Error checking admin or seller role:", error);
    return false;
  }
};

/**
 * Crea una respuesta de error estandarizada para accesos no autorizados.
 * @returns {ActionResponse} - Un objeto de respuesta con estado 403.
 */
export const unauthorizedResponse = <T = null>(): ActionResponse<T> => {
  return {
    status: 403,
    message: 'Acción no autorizada. Se requiere rol de Administrador.',
    data: null,
  };
};

export const checkOrgId = (orgId: string): boolean => {
  return (!orgId || orgId.trim() === '')
}

export const emptyOrgIdResponse = <T = null>(): ActionResponse<T> => {
  return {
    status: 400,
    message: 'El ID de la organización es requerido',
    data: null
  }
}


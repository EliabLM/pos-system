import { Prisma } from '@/generated/prisma';

export const categoryInclude = {
  organization: true,
  products: true,
} satisfies Prisma.CategoryInclude;

export const categoryNotFound = () =>
  ({ status: 404, message: 'Categoría no encontrada', data: null }) as const;

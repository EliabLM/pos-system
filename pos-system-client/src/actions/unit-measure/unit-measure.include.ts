import { Prisma } from '@/generated/prisma';

export const unitMeasureInclude = {
  organization: true,
  products: {
    take: 5,
    where: { isDeleted: false },
  },
  _count: {
    select: {
      products: true,
      saleItems: true,
    },
  },
} satisfies Prisma.UnitMeasureInclude;

export const unitMeasureNotFound = () =>
  ({ status: 404, message: 'Unidad de medida no encontrada', data: null }) as const;

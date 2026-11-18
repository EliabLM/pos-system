import { Prisma } from '@/generated/prisma';

export const stockMovementInclude = {
  organization: true,
  product: {
    include: {
      brand: true,
      category: true,
      unitMeasure: true,
    },
  },
  user: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} satisfies Prisma.StockMovementInclude;

// Type for StockMovement with includes
export type StockMovementWithRelations = Prisma.StockMovementGetPayload<{
  include: typeof stockMovementInclude;
}>;

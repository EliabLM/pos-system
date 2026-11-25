import { Prisma } from '@/generated/prisma';

/** Campos del vendedor que salen al navegador: nunca credenciales ni datos de seguridad de la cuenta. */
export const saleUserSelect = { id: true, name: true, email: true } as const satisfies Prisma.UserSelect;

export const saleInclude: Prisma.SaleInclude = {
  store: true,
  customer: true, // Include complete customer data for detail view
  user: { select: saleUserSelect }, // Solo datos públicos del vendedor
  saleItems: {
    where: {
      isDeleted: false,
    },
    include: {
      product: {
        include: {
          brand: true,
          category: true,
          unitMeasure: true,
        },
      },
      unitMeasure: true,
    },
  },
  salePayments: {
    where: {
      isDeleted: false,
    },
    include: {
      paymentMethod: true,
    },
  },
  _count: {
    select: {
      saleItems: true,
      salePayments: true,
    },
  },
};

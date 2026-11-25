import { Prisma } from '@/generated/prisma';

type SaleLine = { quantity: number; unitPrice: Prisma.Decimal.Value };

/**
 * Pure helpers (not server actions): totals are always computed server-side
 * with `Prisma.Decimal`, never with `number`, so 3 × 33.33 is exactly 99.99.
 */
export const lineSubtotal = (line: SaleLine) => new Prisma.Decimal(line.unitPrice).times(line.quantity);

export const calculateSaleTotals = (items: SaleLine[]) => {
  const subtotal = items.reduce((sum, item) => sum.plus(lineSubtotal(item)), new Prisma.Decimal(0));
  return { subtotal, total: subtotal };
};

export const sumAmounts = (amounts: Prisma.Decimal.Value[]) =>
  amounts.reduce<Prisma.Decimal>((sum, amount) => sum.plus(amount), new Prisma.Decimal(0));

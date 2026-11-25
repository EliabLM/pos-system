import { Prisma } from '@/generated/prisma';

type SaleLine = { quantity: number; unitPrice: Prisma.Decimal.Value };

/**
 * Pure helpers (not server actions): totals are always computed server-side
 * with `Prisma.Decimal`, never with `number`, so 3 × 33.33 is exactly 99.99.
 * Money columns are Decimal(12,2): every amount is rounded to 2 places before
 * adding or comparing, so browser float noise (7 × 1.15 = 8.049999999999999)
 * does not break an exact match.
 */
export const toMoney = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export const lineSubtotal = (line: SaleLine) => toMoney(line.unitPrice).times(line.quantity);

export const calculateSaleTotals = (items: SaleLine[]) => {
  const subtotal = items.reduce((sum, item) => sum.plus(lineSubtotal(item)), new Prisma.Decimal(0));
  return { subtotal, total: subtotal };
};

export const sumAmounts = (amounts: Prisma.Decimal.Value[]) =>
  amounts.reduce<Prisma.Decimal>((sum, amount) => sum.plus(toMoney(amount)), new Prisma.Decimal(0));

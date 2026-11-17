/** Pure helper (not a server action): totals are always computed server-side. */
export const calculateSaleTotals = (items: { quantity: number; unitPrice: number }[]) => {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  return { subtotal, total: subtotal };
};

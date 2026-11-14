import { applyDiscount, shippingCost, subtotal, type LineItem } from './pricing';

export function checkoutTotal(items: LineItem[], discountPercent: number, isMember: boolean): number {
  const discounted = applyDiscount(subtotal(items), discountPercent);
  return discounted + shippingCost(discounted, isMember);
}

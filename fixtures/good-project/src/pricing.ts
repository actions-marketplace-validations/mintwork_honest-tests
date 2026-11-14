export interface LineItem {
  price: number;
  quantity: number;
}

export function subtotal(items: LineItem[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.quantity;
  }
  return sum;
}

export function applyDiscount(amount: number, percent: number): number {
  if (percent < 0 || percent > 100) {
    throw new RangeError('percent must be between 0 and 100');
  }
  return amount - (amount * percent) / 100;
}

export function qualifiesForFreeShipping(total: number, isMember: boolean): boolean {
  return isMember || total >= 50;
}

export function shippingCost(total: number, isMember: boolean): number {
  if (qualifiesForFreeShipping(total, isMember)) {
    return 0;
  }
  return 5;
}

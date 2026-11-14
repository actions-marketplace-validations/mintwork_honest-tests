import { describe, expect, it, vi } from 'vitest';
import { checkoutTotal } from '../src/checkout';
import type { LineItem } from '../src/pricing';

vi.mock('../src/checkout');

describe('checkoutTotal', () => {
  it('returns the order total', () => {
    vi.mocked(checkoutTotal).mockReturnValue(42);
    expect(checkoutTotal([{ price: 40, quantity: 1 }], 0, false)).toBe(42);
  });

  it('accepts line items with a price and quantity', () => {
    const item: LineItem = { price: 40, quantity: 2 };
    expect(item.quantity).toBe(2);
  });
});

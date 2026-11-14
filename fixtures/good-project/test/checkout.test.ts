import { describe, expect, it } from 'vitest';
import { checkoutTotal } from '../src/checkout';

describe('checkoutTotal', () => {
  it('discounts the subtotal, then adds shipping for small orders', () => {
    // subtotal 40, 10% off -> 36, below the free-shipping threshold -> +5
    expect(checkoutTotal([{ price: 20, quantity: 2 }], 10, false)).toBe(41);
  });

  it('ships free once the discounted total reaches the threshold', () => {
    expect(checkoutTotal([{ price: 100, quantity: 1 }], 50, false)).toBe(50);
  });
});

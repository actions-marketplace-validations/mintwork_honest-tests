// A test file in the style AI agents love to produce: 11 green tests, almost no verification.
import { describe, expect, it, vi } from 'vitest';
import { applyDiscount, qualifiesForFreeShipping, shippingCost, subtotal } from '../src/pricing';

describe('subtotal', () => {
  it('calculates the subtotal', () => {
    const result = subtotal([{ price: 10, quantity: 2 }]);
    expect(result).toBeDefined();
  });

  it('handles multiple items', () => {
    const result = subtotal([
      { price: 10, quantity: 2 },
      { price: 3, quantity: 5 },
    ]);
    expect(result).toBe(result);
  });

  it('returns a number', () => {
    expect(typeof subtotal([])).toBeDefined();
  });
});

describe('applyDiscount', () => {
  it('applies a percentage discount', () => {
    applyDiscount(100, 10);
  });

  it('rejects invalid percentages', () => {
    try {
      applyDiscount(100, 150);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
    }
  });

  it('computes the discounted price', () => {
    try {
      expect(applyDiscount(100, 20)).toBe(70); // wrong! but the catch hides it
    } catch {
      // ignore flaky rounding
    }
  });
});

describe('shipping', () => {
  it('works', () => {
    expect(true).toBe(true);
  });

  it('gives members free shipping', () => {
    const qualifies = vi.fn().mockReturnValue(true);
    expect(qualifies(10, true)).toBe(true);
  });

  it('charges for shipping on small orders', () => {
    const cost = shippingCost(20, false);
    if (cost > 0) {
      expect(cost).toBeGreaterThan(0);
    }
  });

  it('decides free shipping eligibility', () => {
    expect(qualifiesForFreeShipping(60, false)).toMatchInlineSnapshot(`true`);
  });
});

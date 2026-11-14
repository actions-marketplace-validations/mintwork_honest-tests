import { describe, expect, it } from 'vitest';
import { applyDiscount, qualifiesForFreeShipping, shippingCost, subtotal } from '../src/pricing';

describe('subtotal', () => {
  it('is 0 for an empty cart', () => {
    expect(subtotal([])).toBe(0);
  });

  it('multiplies price by quantity and sums the lines', () => {
    expect(
      subtotal([
        { price: 10, quantity: 2 },
        { price: 3, quantity: 5 },
      ]),
    ).toBe(35);
  });
});

describe('applyDiscount', () => {
  it('takes the percentage off the amount', () => {
    expect(applyDiscount(200, 25)).toBe(150);
  });

  it('accepts the 0% and 100% boundaries', () => {
    expect(applyDiscount(200, 0)).toBe(200);
    expect(applyDiscount(200, 100)).toBe(0);
  });

  it('rejects percentages outside 0..100', () => {
    expect(() => applyDiscount(200, -1)).toThrow(RangeError);
    expect(() => applyDiscount(200, 101)).toThrow(RangeError);
  });
});

describe('qualifiesForFreeShipping', () => {
  it('starts exactly at 50 for non-members', () => {
    expect(qualifiesForFreeShipping(49.99, false)).toBe(false);
    expect(qualifiesForFreeShipping(50, false)).toBe(true);
  });

  it('always applies to members', () => {
    expect(qualifiesForFreeShipping(0, true)).toBe(true);
  });
});

describe('shippingCost', () => {
  it('charges 5 below the threshold', () => {
    expect(shippingCost(10, false)).toBe(5);
  });

  it('is free at or above the threshold, or for members', () => {
    expect(shippingCost(60, false)).toBe(0);
    expect(shippingCost(10, true)).toBe(0);
  });
});

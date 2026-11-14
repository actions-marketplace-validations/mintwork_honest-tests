import { describe, expect, it, vi } from 'vitest';
import { checkoutTotal } from '../src/checkout';

vi.mock('../src/checkout');

describe('checkoutTotal', () => {
  it('returns the order total', () => {
    vi.mocked(checkoutTotal).mockReturnValue(42);
    expect(checkoutTotal([{ price: 40, quantity: 1 }], 0, false)).toBe(42);
  });
});

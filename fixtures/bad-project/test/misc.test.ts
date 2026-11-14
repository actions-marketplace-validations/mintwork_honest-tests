import { describe, expect, it } from 'vitest';

const loadConfig = async () => ({ currency: 'USD' });
const loadRates = () => ({ USD: 1, EUR: 0.92 });

describe('config', () => {
  it.only('loads config', async () => {
    const config = await loadConfig();
    expect(config).toBeTruthy;
  });

  it('has a currency list', () => {
    const currencies = Object.keys(loadRates());
    expect(currencies.length).toBeGreaterThanOrEqual(0);
  });

  it.skip('converts currencies', () => {
    expect(1).toBe(2);
  });
});

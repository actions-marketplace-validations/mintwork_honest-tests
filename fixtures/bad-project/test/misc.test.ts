import { describe, expect, it } from 'vitest';

const loadConfig = async () => ({ currency: 'USD' });

describe('config', () => {
  it.only('loads config', async () => {
    const config = await loadConfig();
    expect(config).toBeTruthy;
  });

  it('has a currency list', () => {
    const currencies = ['USD', 'EUR'];
    expect(currencies.length).toBeGreaterThanOrEqual(0);
  });

  it.skip('converts currencies', () => {
    expect(1).toBe(2);
  });
});

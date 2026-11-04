import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitize } from '../../src/settings';
import { sourceCurrencies } from '../../src/sources';
import { CURRENCIES } from '../../src/sources/symbols';

/** Each source in turn, each keeping the currency the last one left, as switching source does. */
function through(currency: string, ...sources: string[]): string {
  return sources.reduce((c, source) => sanitize({ ...DEFAULT_SETTINGS, source, currency: c }).currency, currency);
}

describe('currency type', () => {
  it('is Binance\'s own list there, and the usual one elsewhere', () => {
    expect(sourceCurrencies('binance')).toEqual(['USDT', 'USDC', 'EUR', 'JPY', 'TRY', 'BRL']);
    expect(sourceCurrencies('kraken')).toEqual(CURRENCIES);
    expect(sourceCurrencies('binanceus')).toEqual(CURRENCIES);
  });

  it('becomes USDT on Binance from a currency it doesn\'t offer', () => {
    expect(through('USD', 'binance')).toBe('USDT');
    expect(through('AUD', 'binance')).toBe('USDT');
  });

  it('stays when the next exchange offers it too', () => {
    expect(through('EUR', 'binance', 'kraken')).toBe('EUR');
    expect(through('TRY', 'binance')).toBe('TRY');
  });

  it('returns to the default leaving Binance with one only it offers', () => {
    expect(through('USDT', 'kraken')).toBe('USD');
    expect(through('JPY', 'binance', 'okx')).toBe('USD');
  });

  it('waits through a prediction market', () => {
    expect(through('USDT', 'binance', 'polymarket')).toBe('USDT');
    expect(through('TRY', 'binance', 'polymarket', 'binance')).toBe('TRY');
    expect(through('AUD', 'kraken', 'polymarket', 'okx')).toBe('AUD');
  });

  it('falls back on one no exchange offers', () => {
    expect(through('XYZ', 'kraken')).toBe('USD');
    expect(through('XYZ', 'binance')).toBe('USDT');
    expect(through('XYZ', 'polymarket')).toBe('USD');
  });
});

/**
 * How Explore ranks an exchange's markets from its all-markets tickers.
 */
import { describe, expect, it } from 'vitest';
import { marketName, rankMarkets } from '../../src/sources/symbols';

describe('Explore\'s ranking', () => {
  const row = (base: string, quote: string, quoteVolume: number, change?: number, stock?: string) =>
    ({ instrument: { id: `${base}${quote}`, base, quote, stock }, last: 1, quoteVolume, change });
  const names = (rows: ReturnType<typeof row>[]) => rows.map((r) => marketName(r.instrument));

  it('is by quote volume, one market per asset, in the currency type, without money or leveraged tokens', () => {
    const rows = [
      row('BTC', 'USDT', 400), row('BTC', 'USDC', 90), row('ETH', 'USDT', 200), row('USDC', 'USDT', 900),
      row('SOL', 'EUR', 300), row('ETH', 'BTC', 500), row('BTC5L', 'USDT', 800), row('ETHBULL', 'USDT', 700),
      row('XTSLA', 'USDT', 150, 0.01, 'TSLA'), row('PEPE', 'USD', 50),
    ];
    expect(names(rankMarkets(rows, 'volume', 'USD', 8))).toEqual(['BTC-USDT', 'ETH-USDT', 'TSLA-USDT', 'PEPE-USD']);
    expect(names(rankMarkets(rows, 'volume', 'EUR', 8))).toEqual(['SOL-EUR']);
    expect(names(rankMarkets(rows, 'volume', 'USD', 2))).toEqual(['BTC-USDT', 'ETH-USDT']);
  });

  it('for movers is by the size of the change, either way, among the most traded', () => {
    const rows = [row('BTC', 'USD', 400, 0.01), row('ETH', 'USD', 300, -0.08), row('SOL', 'USD', 200, 0.05), row('XRP', 'USD', 100)];
    // A thin market beyond the 100 most traded doesn't count, however much it moved.
    const pool = Array.from({ length: 96 }, (_, i) => row(`P${i}`, 'USD', 50, 0.001));
    const thin = row('THIN', 'USD', 1, 0.9);
    expect(names(rankMarkets([...rows, ...pool, thin], 'movers', 'USD', 3))).toEqual(['ETH-USD', 'SOL-USD', 'BTC-USD']);
    expect(names(rankMarkets(rows, 'movers', 'USD', 8))).toEqual(['ETH-USD', 'SOL-USD', 'BTC-USD']);
  });
});

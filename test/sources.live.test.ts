/**
 * Every data source and the CoinGecko index, against the live APIs (through
 * `PublicApi`, so within the rate limits). Listings change: if a stock is
 * listed or delisted, update LISTED.
 */
import { describe, expect, it } from 'vitest';
import { normalizeMarket } from '../src/settings';
import { SOURCES } from '../src/sources';
import { fetchIndexPrices } from '../src/sources/coingecko';
import type { Instrument } from '../src/sources/symbols';
import type { MarketData, MarketRequest } from '../src/sources/types';

const EQUITIES = ['TSLA', 'AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'SPY', 'QQQ', 'COIN', 'HOOD', 'MSTR', 'NFLX', 'AMD', 'RKLB'];

/**
 * Equities each source has a stock token for (as of October 2026): xStocks,
 * on Gate, Ondo tokens where there's no xStock (MSFT, AMD), and on Bitget,
 * its own "r" tokens. Only OKX and Bitget have RKLB; Gate has just 3x
 * leveraged RKLB tokens, which aren't the stock. Binance.US has no stocks.
 */
const LISTED: Record<string, string[]> = {
  kraken: EQUITIES.filter((e) => e !== 'RKLB'),
  okx: EQUITIES,
  gate: EQUITIES.filter((e) => e !== 'RKLB'),
  coinbase: [],
  binanceus: [],
  bitget: EQUITIES,
};

/** Stocks CoinGecko has no price for, so their index stays blank. */
const NO_INDEX = ['RKLB'];

/** Coins named like one of the equities: with no stock to find, the name is that coin. */
const NAMESAKES: Record<string, string[]> = {
  kraken: [],
  okx: [],
  gate: [],
  coinbase: ['META'],
  binanceus: [],
  bitget: [],
};

/** Tesla, as each exchange or a user might write it. */
const SPELLINGS = ['TSLAX', 'XTSLA', 'tslax-usd', 'TSLA-USD', 'TSLA-USDC'].map(normalizeMarket);

const request = (markets: string[], currency: string, charts: string[] = []): MarketRequest =>
  ({ markets, currency, charts, lines: [], interval: 60, candles: 5 });

function byMarket(data: MarketData[]): Record<string, MarketData> {
  return Object.fromEntries(data.map((d) => [d.market, d]));
}

const signal = () => AbortSignal.timeout(90_000);

describe.concurrent.each(SOURCES.map((s) => [s.id, s] as const))('%s', (id, source) => {
  const listed = LISTED[id]!;
  const namesakes = NAMESAKES[id]!;

  it('prices stocks entered without a quote, and charts one', async () => {
    const data = byMarket(await source.fetch(request([...EQUITIES, ...SPELLINGS], 'USD', ['TSLA']), signal()));
    for (const e of EQUITIES) {
      const d = data[e]!;
      if (listed.includes(e)) {
        expect(d.error, e).toBeUndefined();
        if (e === 'TSLA') expect(d.candles.length, e).toBeGreaterThan(0);
        else expect(d.last, e).toBeGreaterThan(0);
      } else if (namesakes.includes(e)) {
        expect(d.last, e).toBeGreaterThan(0);
      } else {
        expect(d.error, e).toBe('unknown pair');
      }
    }
    for (const m of SPELLINGS) {
      if (listed.includes('TSLA')) expect(data[m]!.last, m).toBeGreaterThan(0);
      else expect(data[m]!.error, m).toBe('unknown pair');
    }
  });

  it('prices coins entered without a quote in the chosen currency', async () => {
    const usd = byMarket(await source.fetch(request(['BTC', 'ETH', 'BTC-USD'], 'USD'), signal()));
    expect(usd.BTC!.last).toBeGreaterThan(1000);
    expect(usd.ETH!.last).toBeGreaterThan(100);
    // Where there's no BTC-USD market, USDT or USDC.
    expect(usd['BTC-USD']!.last).toBeGreaterThan(1000);

    const eur = byMarket(await source.fetch(request(['BTC'], 'EUR'), signal()));
    // Gate and Binance.US quote nothing in EUR.
    if (id === 'gate' || id === 'binanceus') expect(eur.BTC!.error).toBe('unknown pair');
    else expect(eur.BTC!.last).toBeGreaterThan(1000);
  });

  it('resolves stocks to their xStock, and other names to coins', async () => {
    const resolved = await source.resolve(EQUITIES, 'USD', signal());
    expect([...resolved.keys()].sort()).toEqual([...listed, ...namesakes].sort());
    for (const [m, i] of resolved) expect(i.stock, m).toBe(listed.includes(m) ? m : undefined);
  });
});

describe('CoinGecko index', () => {
  it('matches each source’s price for stocks and coins, in one request', async () => {
    // Everything every source resolves, keyed "source:market", priced together.
    const markets = [...EQUITIES, 'BTC'];
    const targets = new Map<string, Instrument>();
    const prices = new Map<string, number>();
    await Promise.all(SOURCES.map(async (source) => {
      const resolved = await source.resolve(markets, 'USD', signal());
      const data = await source.fetch(request([...resolved.keys()], 'USD'), signal());
      for (const d of data) {
        targets.set(`${source.id}:${d.market}`, resolved.get(d.market)!);
        if (d.last) prices.set(`${source.id}:${d.market}`, d.last);
      }
    }));

    const index = await fetchIndexPrices(targets, signal());
    // A failed request leaves every index out; its keyless API allows only a few calls a minute per IP.
    expect(index.size, 'CoinGecko request failed (rate limited?)').toBeGreaterThan(0);
    for (const [key, price] of prices) {
      const i = index.get(key);
      if (NO_INDEX.includes(key.split(':')[1]!)) {
        expect(i, key).toBeUndefined();
        continue;
      }
      expect(i, key).toBeDefined();
      // Within 5%: an exchange's last trade against the index (stocks trade thinly out of hours).
      expect(Math.abs(i! / price - 1), key).toBeLessThan(0.05);
    }
  });
});

/**
 * Each source asks for chart candles last, so the charts are the freshest
 * data, and signals just before the final request so the index can be
 * fetched alongside it. Against the live APIs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SOURCES } from '../src/sources';
import type { MarketRequest } from '../src/sources/types';

const HOSTS: Record<string, string> = {
  kraken: 'api.kraken.com',
  okx: 'www.okx.com',
  coinbase: 'api.exchange.coinbase.com',
  gate: 'api.gateio.ws',
  binanceus: 'api.binance.us',
  bitget: 'api.bitget.com',
};

/** A path that asks for candles, on each source. */
const CANDLES = /\/OHLC\?|\/market\/candles\?|\/candles\?|\/candlesticks\?|\/klines\?/;

/** Every request made, by host, in order; "last request" marks the source's signal. */
const log: { host: string; path: string }[] = [];

beforeAll(() => {
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const u = new URL(url);
    log.push({ host: u.host, path: u.pathname + u.search });
    return real(url, init);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// Three listed markets (a ticker request first) and two charts.
const request: MarketRequest = { markets: ['SOL', 'ETH', 'BTC', 'TSLA'], currency: 'USD', charts: ['BTC', 'ETH'], lines: [], interval: 60, candles: 5 };

describe.concurrent.each(SOURCES.map((s) => [s.id, s] as const))('%s', (id, source) => {
  it('asks for chart candles last, signalling before the final one', async () => {
    const host = HOSTS[id]!;
    // Load the market list first, as an earlier update would have.
    await source.resolve(request.markets, request.currency, AbortSignal.timeout(60_000));
    const start = log.length;
    let signalled = -1;
    const data = await source.fetch(request, AbortSignal.timeout(60_000), undefined, () => {
      signalled = log.filter((l) => l.host === host).length;
      log.push({ host, path: 'last request' });
    });
    for (const m of request.charts) expect(data.find((d) => d.market === m)!.candles.length, m).toBeGreaterThan(0);

    const paths = log.slice(start).filter((l) => l.host === host).map((l) => l.path);
    const requests = paths.filter((p) => p !== 'last request');
    // The chart requests, one per chart, are the last requests made…
    expect(requests.filter((p) => CANDLES.test(p)).length, paths.join('\n')).toBe(request.charts.length);
    expect(requests.slice(-request.charts.length).every((p) => CANDLES.test(p)), paths.join('\n')).toBe(true);
    // …after a price request for the listed markets.
    expect(CANDLES.test(requests[0]!), paths.join('\n')).toBe(false);
    // The signal came just before the final request, once.
    expect(paths.filter((p) => p === 'last request').length).toBe(1);
    expect(paths.at(-2), paths.join('\n')).toBe('last request');
    expect(signalled).toBeGreaterThan(0);
  });
});

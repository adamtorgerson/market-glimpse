import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOURCES } from '../src/sources';
import type { MarketRequest } from '../src/sources/types';

const HOSTS: Record<string, string> = {
  kraken: 'api.kraken.com',
  okx: 'www.okx.com',
  coinbase: 'api.exchange.coinbase.com',
  gate: 'api.gateio.ws',
  binanceus: 'api.binance.us',
  bitget: 'api.bitget.com',
  hyperliquid: 'api.hyperliquid.xyz',
  aster: 'sapi.asterdex.com',
};

/** Record every request's host, answering each as if offline. */
function recordHosts(): string[] {
  const hosts: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    hosts.push(new URL(url).host);
    throw new TypeError('Failed to fetch');
  });
  return hosts;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const request: MarketRequest = { markets: ['TSLA', 'BTC-USD'], currency: 'USD', charts: ['TSLA'], lines: [], interval: 60, candles: 5 };

describe('market lists', () => {
  it('are not loaded just by having the sources', async () => {
    const hosts = recordHosts();
    for (const source of SOURCES) {
      source.requestsPerUpdate(request);
      source.estimateMs(request);
    }
    expect(hosts).toEqual([]);
  });

  for (const source of SOURCES) {
    it(`are loaded only from ${source.label} when it's the one asked`, async () => {
      const hosts = recordHosts();
      const data = await source.fetch(request, AbortSignal.timeout(10_000));
      expect(data.every((d) => d.error)).toBe(true);
      expect(hosts.length).toBeGreaterThan(0);
      expect(new Set(hosts)).toEqual(new Set([HOSTS[source.id]]));
    });
  }
});

import { PublicApi, isAbort } from './http';
import { coinGeckoName, type Instrument } from './symbols';

// The keyless API allows "~5 calls/min (dynamic, varies by server load)" per IP
// (docs.coingecko.com/docs/keyless-public-api), so stay under it at 4 a minute.
// The shortest refresh is 15s, so an update still never waits on this.
const api = new PublicApi('https://api.coingecko.com/api/v3', 15_000);

/** Rough ms for the index request if made now. */
export function estimateIndexMs(markets: string[]): number {
  return api.estimateMs(markets.length ? 1 : 0);
}

/**
 * CoinGecko's aggregated (index) price for each market, in one request,
 * looked up by what the market resolved to on the exchange (`coinGeckoName`),
 * so exchanges' own spellings (Kraken's "XBT", OKX's "XTSLA") don't matter.
 * Markets CoinGecko doesn't know, and any failure, just leave the market out.
 */
export async function fetchIndexPrices(markets: Map<string, Instrument>, signal: AbortSignal): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const names = [...markets].map(([m, i]) => [m, coinGeckoName(i)] as const);
  if (names.length === 0) return out;
  const symbols = [...new Set(names.map(([, n]) => n.symbol))].join(',');
  const vs = [...new Set(names.map(([, n]) => n.vs))].join(',');
  try {
    const body = await api.get<Record<string, Record<string, number>>>(
      `/simple/price?symbols=${encodeURIComponent(symbols)}&vs_currencies=${encodeURIComponent(vs)}&precision=full`, signal);
    // Keys come back in CoinGecko's own case ("META" but "tslax").
    const prices = new Map(Object.entries(body).map(([k, v]) => [k.toLowerCase(), v]));
    for (const [m, n] of names) {
      const price = prices.get(n.symbol)?.[n.vs];
      if (price !== undefined) out.set(m, price);
    }
  } catch (e) {
    if (isAbort(e)) throw e;
    console.warn('CoinGecko index prices unavailable', e);
  }
  return out;
}

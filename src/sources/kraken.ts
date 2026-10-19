import { PublicApi, describeError as describe, isAbort } from './http';
import type { Candle, MarketData, MarketRequest, MarketSource } from './types';

const api = new PublicApi('https://api.kraken.com/0/public');

interface Pair {
  /** Key Kraken uses for this pair in results, e.g. "XXBTZUSD". */
  key: string;
  /** Name to request it by, e.g. "XBTUSD". */
  altname: string;
}

// Kraken's own codes for a few assets; we show the common ones.
const ALIASES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' };
const canon = (asset: string) => ALIASES[asset] ?? asset;
const canonMarket = (base: string, quote: string) => `${canon(base)}-${canon(quote)}`;

/**
 * Every Kraken pair, by "BASE-QUOTE". Fetched once per session (one request).
 * Grouped requests fail outright if any pair in them is unknown, and Kraken
 * omits CORS headers on that error, so markets are checked here first.
 */
let pairsPromise: Promise<Map<string, Pair>> | null = null;

function loadPairs(signal: AbortSignal): Promise<Map<string, Pair>> {
  pairsPromise ??= api
    .get<{ error: string[]; result?: Record<string, { altname: string; wsname?: string }> }>('/AssetPairs', signal)
    .then((body) => {
      if (body.error?.length) throw new Error(body.error.join(', '));
      const pairs = new Map<string, Pair>();
      for (const [key, p] of Object.entries(body.result ?? {})) {
        const [base, quote] = (p.wsname ?? '').split('/');
        if (base && quote) pairs.set(canonMarket(base, quote), { key, altname: p.altname });
      }
      return pairs;
    });
  // Don't cache a failure (e.g. offline, or superseded); try again next update.
  pairsPromise.catch(() => { pairsPromise = null; });
  return pairsPromise;
}

function lookup(pairs: Map<string, Pair>, market: string): Pair | undefined {
  const [base, quote] = market.split('-');
  return base && quote ? pairs.get(canonMarket(base, quote)) : undefined;
}

interface Ticker {
  /** Last trade [price, lot volume]. */
  c: [string, string];
  /** Volume [today, last 24h]. */
  v: [string, string];
}

type OhlcRow = [number, string, string, string, string, string, string, number];

export const kraken: MarketSource = {
  id: 'kraken',
  label: 'Kraken',
  intervals: [1, 5, 15, 30, 60, 240, 1440, 10080, 21600],

  requestsPerUpdate(req) {
    // One grouped Ticker for every market, plus OHLC (single-pair only) per
    // chart, plus the pair list until it has been loaded.
    return 1 + req.charts.length + (pairsPromise ? 0 : 1);
  },

  estimateMs(req) {
    return api.estimateMs(this.requestsPerUpdate(req));
  },

  async fetch(req: MarketRequest, signal: AbortSignal): Promise<MarketData[]> {
    const out = new Map<string, MarketData>(req.markets.map((m) => [m, { market: m, candles: [] }]));
    const result = () => req.markets.map((m) => out.get(m)!);

    let pairs: Map<string, Pair>;
    try {
      pairs = await loadPairs(signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      for (const d of out.values()) d.error = describe(e);
      return result();
    }
    const known = new Map<string, Pair>();
    for (const m of req.markets) {
      const p = lookup(pairs, m);
      if (p) known.set(m, p);
      else out.get(m)!.error = 'unknown pair';
    }
    if (known.size === 0) return result();

    // Rule 2: one Ticker request covers every market.
    try {
      const names = [...known.values()].map((p) => p.altname).join(',');
      const body = await api.get<{ error: string[]; result?: Record<string, Ticker> }>(
        `/Ticker?pair=${encodeURIComponent(names)}`, signal);
      if (body.error?.length) throw new Error(body.error.join(', ').replace(/^E\w+:/, ''));
      for (const [m, p] of known) {
        const t = body.result?.[p.key];
        if (!t) continue;
        Object.assign(out.get(m)!, { last: +t.c[0], dayVolume: +t.v[1] });
      }
    } catch (e) {
      if (isAbort(e)) throw e;
      for (const m of known.keys()) out.get(m)!.error = describe(e);
    }

    // Rule 3: OHLC from just far enough back to fill the chart.
    const intervalSec = req.interval * 60;
    const current = Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
    const since = current - req.candles * intervalSec;
    for (const m of req.charts) {
      const p = known.get(m);
      if (!p) continue;
      try {
        const body = await api.get<{ error: string[]; result?: Record<string, OhlcRow[]> }>(
          `/OHLC?pair=${encodeURIComponent(p.altname)}&interval=${req.interval}&since=${since}`, signal);
        if (body.error?.length) throw new Error(body.error.join(', ').replace(/^E\w+:/, ''));
        const rows = body.result?.[p.key] ?? [];
        const candles: Candle[] = rows.map((r) => ({
          time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[6],
        }));
        const d = out.get(m)!;
        d.candles = candles.slice(-req.candles);
        if (candles.length === 0) d.error = 'no data';
        else delete d.error; // A failed Ticker shouldn't hide a good chart.
      } catch (e) {
        if (isAbort(e)) throw e;
        out.get(m)!.error = describe(e);
      }
    }
    return result();
  },
};

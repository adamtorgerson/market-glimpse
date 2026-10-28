import { lazyCatalog } from './exchange';
import { PublicApi, describeError as describe, isAbort } from './http';
import { canonAsset, type Instrument } from './symbols';
import type { Candle, MarketData, MarketRequest, MarketSource } from './types';

const api = new PublicApi('https://api.kraken.com/0/public');

/** `id` is the name to request it by, e.g. "XBTUSD". */
interface Pair extends Instrument {
  /** Key Kraken uses for this pair in results, e.g. "XXBTZUSD". */
  key: string;
  /** A tokenized stock (e.g. "TSLAx/USD"), which Kraken lists and quotes separately from crypto. */
  tokenized: boolean;
}

const TOKENIZED = 'asset_class=tokenized_asset';

type AssetPairs = { error: string[]; result?: Record<string, { altname: string; wsname?: string }> };

/**
 * Every Kraken pair. Fetched once per session (two requests: crypto, then
 * tokenized stocks, which /AssetPairs only lists when asked). Grouped
 * requests fail outright if any pair in them is unknown, and Kraken omits
 * CORS headers on that error, so markets are checked against this first.
 */
const catalog = lazyCatalog<Pair>(async (signal) => {
  const pairs = new Map<string, Pair>();
  for (const tokenized of [false, true]) {
    const body = await api.get<AssetPairs>(tokenized ? '/AssetPairs?aclass_base=tokenized_asset' : '/AssetPairs', signal);
    if (body.error?.length) throw new Error(body.error.join(', '));
    for (const [key, p] of Object.entries(body.result ?? {})) {
      const [base, quote] = (p.wsname ?? '').split('/');
      if (!base || !quote) continue;
      // Stocks are their ticker + "x" ("TSLAx").
      const pair: Pair = {
        id: p.altname, key, tokenized, base: canonAsset(base), quote: canonAsset(quote),
        stock: tokenized ? base.replace(/x$/, '') : undefined,
      };
      // Some stocks are listed twice under one altname; results come back keyed by the altname.
      const name = `${pair.base}-${pair.quote}`;
      if (!pairs.has(name) || key === p.altname) pairs.set(name, pair);
    }
  }
  return [...pairs.values()];
});

async function resolve(markets: string[], currency: string, signal: AbortSignal): Promise<Map<string, Pair>> {
  const c = await catalog.get(signal);
  const out = new Map<string, Pair>();
  for (const m of markets) {
    const p = c.resolve(m, currency);
    if (p) out.set(m, p);
  }
  return out;
}

/** Ticker requests: one per asset class among the markets (one if the pairs aren't loaded yet). */
function tickerGroups(req: MarketRequest): number {
  const c = catalog.loaded;
  if (!c) return 1;
  return new Set(req.markets.map((m) => c.resolve(m, req.currency)?.tokenized).filter((t) => t !== undefined)).size;
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

  resolve,

  requestsPerUpdate(req) {
    // One grouped Ticker per asset class (crypto, stocks), plus OHLC
    // (single-pair only) per known chart or line graph, plus the pair lists
    // until they have been loaded.
    const c = catalog.loaded;
    const candles = [...req.charts, ...req.lines].filter((m) => !c || c.resolve(m, req.currency)).length;
    return tickerGroups(req) + candles + (c ? 0 : 2);
  },

  estimateMs(req) {
    return api.estimateMs(this.requestsPerUpdate(req));
  },

  async fetch(
    req: MarketRequest, signal: AbortSignal, onProgress?: (partial: MarketData[]) => void, onLastRequest?: () => void,
  ): Promise<MarketData[]> {
    const out = new Map<string, MarketData>(req.markets.map((m) => [m, { market: m, candles: [] }]));
    const result = () => req.markets.map((m) => out.get(m)!);

    let known: Map<string, Pair>;
    try {
      known = await resolve(req.markets, req.currency, signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      for (const d of out.values()) d.error = describe(e);
      return result();
    }
    for (const d of out.values()) if (!known.has(d.market)) d.error = 'unknown pair';
    if (known.size === 0) return result();

    // Rule 2: one Ticker request covers every market of an asset class
    // (Kraken rejects a request that mixes crypto and stocks).
    for (const tokenized of [false, true]) {
      const group = [...known].filter(([, p]) => p.tokenized === tokenized);
      if (group.length === 0) continue;
      try {
        const names = group.map(([, p]) => p.id).join(',');
        const body = await api.get<{ error: string[]; result?: Record<string, Ticker> }>(
          `/Ticker?pair=${encodeURIComponent(names)}${tokenized ? `&${TOKENIZED}` : ''}`, signal);
        if (body.error?.length) throw new Error(body.error.join(', ').replace(/^E\w+:/, ''));
        for (const [m, p] of group) {
          const t = body.result?.[p.key] ?? body.result?.[p.id];
          if (!t) continue;
          Object.assign(out.get(m)!, { last: +t.c[0], dayVolume: +t.v[1] });
        }
      } catch (e) {
        if (isAbort(e)) throw e;
        for (const [m] of group) out.get(m)!.error = describe(e);
      }
      onProgress?.(result());
    }

    // Rule 3: OHLC from just far enough back to fill the chart or line graph.
    // Last, so the charts are the freshest data.
    const intervalSec = req.interval * 60;
    const current = Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
    const since = current - req.candles * intervalSec;
    const charted = [...req.charts, ...req.lines].filter((m) => known.has(m));
    for (const m of charted) {
      const p = known.get(m)!;
      if (m === charted.at(-1)) onLastRequest?.();
      try {
        const body = await api.get<{ error: string[]; result?: Record<string, OhlcRow[]> }>(
          `/OHLC?pair=${encodeURIComponent(p.id)}&interval=${req.interval}&since=${since}${p.tokenized ? `&${TOKENIZED}` : ''}`, signal);
        if (body.error?.length) throw new Error(body.error.join(', ').replace(/^E\w+:/, ''));
        const rows = body.result?.[p.key] ?? body.result?.[p.id] ?? [];
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
      onProgress?.(result());
    }
    return result();
  },
};

import { stockQuotes } from './exchange';
import { PublicApi, describeError as describe, isAbort } from './http';
import type { Candle, MarketData, MarketRequest, MarketSource } from './types';

const api = new PublicApi('https://api.kraken.com/0/public');

interface Pair {
  /** Key Kraken uses for this pair in results, e.g. "XXBTZUSD". */
  key: string;
  /** Name to request it by, e.g. "XBTUSD". */
  altname: string;
  /** A tokenized stock (e.g. "TSLAx/USD"), which Kraken lists and quotes separately from crypto. */
  tokenized: boolean;
}

// Kraken's own codes for a few assets; we show the common ones.
const ALIASES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' };
const canon = (asset: string) => ALIASES[asset] ?? asset;
// Uppercase, since market names are normalized to it and Kraken's stocks aren't ("TSLAx").
const canonMarket = (base: string, quote: string) => `${canon(base)}-${canon(quote)}`.toUpperCase();
const TOKENIZED = 'asset_class=tokenized_asset';

/**
 * Every Kraken pair, by "BASE-QUOTE". Fetched once per session (two requests:
 * crypto, then tokenized stocks, which /AssetPairs only lists when asked).
 * Grouped requests fail outright if any pair in them is unknown, and Kraken
 * omits CORS headers on that error, so markets are checked here first.
 */
let pairsPromise: Promise<Map<string, Pair>> | null = null;
/** Set once loaded, so request counts can tell crypto from stocks. */
let pairsLoaded: Map<string, Pair> | null = null;

function tickerGroups(markets: string[]): number {
  if (!pairsLoaded) return 1;
  const classes = new Set(markets.map((m) => lookup(pairsLoaded!, m)?.tokenized).filter((t) => t !== undefined));
  return classes.size;
}

type AssetPairs = { error: string[]; result?: Record<string, { altname: string; wsname?: string }> };

function loadPairs(signal: AbortSignal): Promise<Map<string, Pair>> {
  pairsPromise ??= (async () => {
    const pairs = new Map<string, Pair>();
    for (const tokenized of [false, true]) {
      const body = await api.get<AssetPairs>(tokenized ? '/AssetPairs?aclass_base=tokenized_asset' : '/AssetPairs', signal);
      if (body.error?.length) throw new Error(body.error.join(', '));
      for (const [key, p] of Object.entries(body.result ?? {})) {
        const [base, quote] = (p.wsname ?? '').split('/');
        if (!base || !quote) continue;
        const market = canonMarket(base, quote);
        // Some stocks are listed twice under one altname; results come back keyed by the altname.
        if (!pairs.has(market) || key === p.altname) pairs.set(market, { key, altname: p.altname, tokenized });
      }
    }
    pairsLoaded = pairs;
    return pairs;
  })();
  // Don't cache a failure (e.g. offline, or superseded); try again next update.
  pairsPromise.catch(() => { pairsPromise = null; });
  return pairsPromise;
}

/**
 * The pair for "BASE-QUOTE"; failing that, the stock "BASE" or "BASEx" in any
 * dollar quote (so "TSLA", "TSLAX" and "TSLA-USDC" all find "TSLAx/USD").
 */
function lookup(pairs: Map<string, Pair>, market: string): Pair | undefined {
  const [base, quote] = market.split('-');
  if (!base) return undefined;
  const pair = quote ? pairs.get(canonMarket(base, quote)) : undefined;
  if (pair) return pair;
  for (const b of [base, `${base}x`]) for (const q of stockQuotes(quote)) {
    const stock = pairs.get(canonMarket(b, q));
    if (stock?.tokenized) return stock;
  }
  return undefined;
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
    // One grouped Ticker per asset class (crypto, stocks), plus OHLC
    // (single-pair only) per chart or line graph, plus the pair lists until
    // they have been loaded.
    return tickerGroups(req.markets) + req.charts.length + req.lines.length + (pairsLoaded ? 0 : 2);
  },

  estimateMs(req) {
    return api.estimateMs(this.requestsPerUpdate(req));
  },

  async fetch(req: MarketRequest, signal: AbortSignal, onProgress?: (partial: MarketData[]) => void): Promise<MarketData[]> {
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

    // Rule 2: one Ticker request covers every market of an asset class
    // (Kraken rejects a request that mixes crypto and stocks).
    for (const tokenized of [false, true]) {
      const group = [...known].filter(([, p]) => p.tokenized === tokenized);
      if (group.length === 0) continue;
      try {
        const names = group.map(([, p]) => p.altname).join(',');
        const body = await api.get<{ error: string[]; result?: Record<string, Ticker> }>(
          `/Ticker?pair=${encodeURIComponent(names)}${tokenized ? `&${TOKENIZED}` : ''}`, signal);
        if (body.error?.length) throw new Error(body.error.join(', ').replace(/^E\w+:/, ''));
        for (const [m, p] of group) {
          const t = body.result?.[p.key] ?? body.result?.[p.altname];
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
    const intervalSec = req.interval * 60;
    const current = Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
    const since = current - req.candles * intervalSec;
    for (const m of [...req.charts, ...req.lines]) {
      const p = known.get(m);
      if (!p) continue;
      try {
        const body = await api.get<{ error: string[]; result?: Record<string, OhlcRow[]> }>(
          `/OHLC?pair=${encodeURIComponent(p.altname)}&interval=${req.interval}&since=${since}${p.tokenized ? `&${TOKENIZED}` : ''}`, signal);
        if (body.error?.length) throw new Error(body.error.join(', ').replace(/^E\w+:/, ''));
        const rows = body.result?.[p.key] ?? body.result?.[p.altname] ?? [];
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

import { describeError, isAbort, type PublicApi } from './http';
import type { Candle, MarketData, MarketRequest, MarketSource } from './types';

export interface Ticker {
  last: number;
  /** Rolling 24h volume in the base currency. */
  dayVolume?: number;
}

/**
 * An exchange whose public API has single-market candles, plus tickers for
 * either one market or all of them (none take a chosen list).
 *
 * Charts get their price from their latest candle, so only the markets listed
 * under the charts need a ticker. Per update: none listed, no ticker request;
 * one listed, a single-market ticker; two or more, the all-markets ticker
 * (rule 2: one request, though a large one). Then one candle request per
 * chart or line graph, asking only for the candles that fit (rule 3).
 */
export interface ExchangeSpec {
  id: string;
  label: string;
  /** The rate-limited client every request goes through, for time estimates. */
  api: PublicApi;
  /** Supported candle sizes in minutes, mapped to the API's name for each. */
  intervals: Record<number, string>;
  /** One market's ticker. Throws `UnknownMarketError` if there's no such market. */
  ticker(market: string, signal: AbortSignal): Promise<Ticker>;
  /** Every spot market's ticker, keyed "BASE-QUOTE", from one request. */
  tickers(signal: AbortSignal): Promise<Map<string, Ticker>>;
  /** The `count` most recent candles for "BASE-QUOTE", oldest first. Throws `UnknownMarketError` like `ticker`. */
  candles(market: string, interval: string, intervalSec: number, count: number, signal: AbortSignal): Promise<Candle[]>;
  /**
   * Tokenized stocks, keyed by plain "TICKER-QUOTE" (e.g. "TSLA-USDT"), to the
   * exchange's market ("XTSLA-USDT"). Loaded only once a market isn't found.
   */
  stocks?(signal: AbortSignal): Promise<Map<string, string>>;
}

export class UnknownMarketError extends Error {
  constructor() {
    super('unknown pair');
  }
}

// Kraken's codes for a few assets; everyone else uses the common ones.
const ALIASES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' };
const canon = (market: string) => market.split('-').map((a) => ALIASES[a] ?? a).join('-');

/** Dollar quotes, in the order to try them for a stock; a stock with no quote is in dollars. */
export const DOLLARS = ['USD', 'USDT', 'USDC'];

/** For a stock, the quotes to try: dollars are interchangeable, and none means dollars. */
export function stockQuotes(quote: string | undefined): string[] {
  return !quote || DOLLARS.includes(quote) ? [...new Set([quote ?? 'USD', ...DOLLARS])] : [quote];
}

/**
 * The stock a market most likely means: its ticker as typed, or as Kraken
 * ("TSLAX"), OKX ("XTSLA") or Gate ("TSLAX") spell it, in any dollar quote.
 */
function stockFor(stocks: Map<string, string>, market: string): string | undefined {
  const [base, quote] = market.split('-');
  if (!base) return undefined;
  const bases = [base, base.replace(/X$/, ''), base.replace(/^X/, '')];
  const quotes = stockQuotes(quote);
  for (const b of bases) for (const q of quotes) {
    const s = stocks.get(`${b}-${q}`);
    if (s) return s;
  }
  return undefined;
}

/** Start of the current candle, in unix seconds. */
export function currentSlot(intervalSec: number): number {
  return Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
}

export function exchangeSource(spec: ExchangeSpec): MarketSource {
  // Markets (canonical names) that turned out to be stocks, to the exchange's name for them.
  const resolved = new Map<string, string>();
  const name = (market: string) => resolved.get(canon(market)) ?? canon(market);
  let stocksPromise: Promise<Map<string, string>> | null = null;
  const loadStocks = (signal: AbortSignal) => {
    stocksPromise ??= spec.stocks!(signal);
    // Don't cache a failure; try again next update.
    stocksPromise.catch(() => { stocksPromise = null; });
    return stocksPromise;
  };

  /** Of `markets`, the ones that are stocks, remembering the exchange's name for each. */
  async function findStocks(markets: string[], signal: AbortSignal): Promise<string[]> {
    if (!spec.stocks) return [];
    const stocks = await loadStocks(signal);
    return markets.filter((m) => {
      const s = stockFor(stocks, canon(m));
      if (s) resolved.set(canon(m), s);
      return s !== undefined;
    });
  }

  async function fetchNamed(req: MarketRequest, signal: AbortSignal, onProgress?: (partial: MarketData[]) => void): Promise<MarketData[]> {
    const out = new Map<string, MarketData>(req.markets.map((m) => [m, { market: m, candles: [] }]));
    const result = () => req.markets.map((m) => out.get(m)!);
    const listed = req.markets.filter((m) => !req.charts.includes(m));
    const fail = (d: MarketData, e: unknown) => {
      if (isAbort(e)) throw e;
      d.error = describeError(e);
    };

    // Markets the all-markets ticker showed don't exist, so their charts aren't requested.
    const unknown = new Set<string>();
    if (listed.length === 1) {
      const d = out.get(listed[0]!)!;
      try {
        Object.assign(d, await spec.ticker(name(d.market), signal));
      } catch (e) {
        fail(d, e);
      }
    } else if (listed.length > 1) {
      try {
        const tickers = await spec.tickers(signal);
        for (const d of out.values()) {
          const t = tickers.get(name(d.market));
          if (t) Object.assign(d, t);
          else if (listed.includes(d.market)) d.error = 'unknown pair';
          else unknown.add(d.market);
        }
      } catch (e) {
        for (const m of listed) fail(out.get(m)!, e);
      }
    }
    if (listed.length) onProgress?.(result());

    const bar = spec.intervals[req.interval];
    const intervalSec = req.interval * 60;
    for (const m of [...req.charts, ...req.lines]) {
      const d = out.get(m)!;
      if (unknown.has(m) || d.error === 'unknown pair') {
        d.error = 'unknown pair';
        continue;
      }
      if (!bar) {
        d.error = 'candle size not supported';
        continue;
      }
      try {
        d.candles = (await spec.candles(name(m), bar, intervalSec, req.candles, signal)).slice(-req.candles);
        if (d.candles.length === 0) d.error = 'no data';
      } catch (e) {
        fail(d, e);
      }
      onProgress?.(result());
    }
    return result();
  }

  return {
    id: spec.id,
    label: spec.label,
    intervals: Object.keys(spec.intervals).map(Number).sort((a, b) => a - b),

    requestsPerUpdate(req) {
      const listed = req.markets.length - req.charts.length;
      return (listed > 0 ? 1 : 0) + req.charts.length + req.lines.length;
    },

    estimateMs(req) {
      return spec.api.estimateMs(this.requestsPerUpdate(req));
    },

    async fetch(req: MarketRequest, signal: AbortSignal, onProgress?: (partial: MarketData[]) => void): Promise<MarketData[]> {
      const only = (markets: string[]): MarketRequest =>
        ({ ...req, markets, charts: req.charts.filter((m) => markets.includes(m)), lines: req.lines.filter((m) => markets.includes(m)) });
      const merge = (data: MarketData[], more: MarketData[]) => data.map((d) => more.find((x) => x.market === d.market) ?? d);

      // A market with no quote ("TSLA") is a stock, so find its name before asking for it.
      const unknown: MarketData[] = req.markets.map((m) => ({ market: m, candles: [], error: 'unknown pair' }));
      const bare = req.markets.filter((m) => !m.includes('-') && !resolved.has(canon(m)));
      if (bare.length) {
        try {
          await findStocks(bare, signal);
        } catch (e) {
          if (isAbort(e)) throw e;
          for (const d of unknown) if (bare.includes(d.market)) d.error = describeError(e);
        }
      }
      const asked = req.markets.filter((m) => m.includes('-') || resolved.has(canon(m)));
      const data = merge(unknown, await fetchNamed(only(asked), signal, onProgress && ((p) => onProgress(merge(unknown, p)))));

      // Unknown markets may be stocks under the exchange's own name ("TSLA-USD"
      // is "XTSLA-USDT" on OKX). Once one is found, later updates ask for it directly.
      // "unknown pair or offline" too: Gate can't tell the two apart in the browser.
      const missing = data
        .filter((d) => asked.includes(d.market) && d.error?.startsWith('unknown pair') && !resolved.has(canon(d.market)))
        .map((d) => d.market);
      if (missing.length === 0) return data;
      let found: string[];
      try {
        found = await findStocks(missing, signal);
      } catch (e) {
        if (isAbort(e)) throw e;
        return data;
      }
      if (found.length === 0) return data;
      return merge(data, await fetchNamed(only(found), signal, onProgress && ((p) => onProgress(merge(data, p)))));
    },
  };
}

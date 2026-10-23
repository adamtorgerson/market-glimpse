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
}

export class UnknownMarketError extends Error {
  constructor() {
    super('unknown pair');
  }
}

// Kraken's codes for a few assets; everyone else uses the common ones.
const ALIASES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' };
const canon = (market: string) => market.split('-').map((a) => ALIASES[a] ?? a).join('-');

/** Start of the current candle, in unix seconds. */
export function currentSlot(intervalSec: number): number {
  return Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
}

export function exchangeSource(spec: ExchangeSpec): MarketSource {
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
          Object.assign(d, await spec.ticker(canon(d.market), signal));
        } catch (e) {
          fail(d, e);
        }
      } else if (listed.length > 1) {
        try {
          const tickers = await spec.tickers(signal);
          for (const d of out.values()) {
            const t = tickers.get(canon(d.market));
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
          d.candles = (await spec.candles(canon(m), bar, intervalSec, req.candles, signal)).slice(-req.candles);
          if (d.candles.length === 0) d.error = 'no data';
        } catch (e) {
          fail(d, e);
        }
        onProgress?.(result());
      }
      return result();
    },
  };
}

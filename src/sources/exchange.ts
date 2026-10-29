import { describeError, isAbort, type PublicApi } from './http';
import { Catalog, type Instrument } from './symbols';
import type { Candle, MarketData, MarketRequest, MarketSource } from './types';

export interface Ticker {
  last: number;
  /** Rolling 24h volume in the base currency. */
  dayVolume?: number;
}

/**
 * An exchange whose public API has single-market candles, plus tickers for
 * one market, and for all of them or a chosen list.
 *
 * Its market list is loaded once per session, and each typed market is
 * resolved against it (`Catalog.resolve`); markets it doesn't have are never
 * asked for.
 *
 * Charts get their price from their latest candle, so only the markets listed
 * under the charts need a ticker. Per update: none listed, no ticker request;
 * one listed, a single-market ticker; two or more, one ticker request for
 * them all (rule 2: one request, though a large one where the API can't take
 * a list). Then one candle request per
 * chart or line graph, asking only for the candles that fit (rule 3).
 */
export interface ExchangeSpec {
  id: string;
  label: string;
  /** The rate-limited client every request goes through, for time estimates. */
  api: PublicApi;
  /** Supported candle sizes in minutes, mapped to the API's name for each. */
  intervals: Record<number, string>;
  /** One market's ticker, by its instrument id. Throws `UnknownMarketError` if there's no such market. */
  ticker(market: string, signal: AbortSignal): Promise<Ticker>;
  /**
   * Tickers for instrument `ids`, keyed by id, from one request: just those
   * if the API takes a list, else every spot market's.
   */
  tickers(signal: AbortSignal, ids: string[]): Promise<Map<string, Ticker>>;
  /** The `count` most recent candles for an instrument id, oldest first. Throws `UnknownMarketError` like `ticker`. */
  candles(market: string, interval: string, intervalSec: number, count: number, signal: AbortSignal): Promise<Candle[]>;
  /** Every spot market, from one request, made once per session. */
  instruments(signal: AbortSignal): Promise<Instrument[]>;
}

export class UnknownMarketError extends Error {
  constructor() {
    super('unknown pair');
  }
}

/**
 * Load an exchange's market list on first use and keep it for the session;
 * a failure (offline, superseded) isn't kept, so the next update tries again.
 */
export function lazyCatalog<T extends Instrument>(load: (signal: AbortSignal) => Promise<T[]>) {
  let promise: Promise<Catalog<T>> | null = null;
  let loaded: Catalog<T> | null = null;
  return {
    get loaded() {
      return loaded;
    },
    get(signal: AbortSignal): Promise<Catalog<T>> {
      promise ??= load(signal).then((list) => (loaded = new Catalog(list)));
      promise.catch(() => { promise = null; });
      return promise;
    },
  };
}

/** Start of the current candle, in unix seconds. */
export function currentSlot(intervalSec: number): number {
  return Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
}

export function exchangeSource(spec: ExchangeSpec): MarketSource {
  const catalog = lazyCatalog(spec.instruments);

  async function resolve(markets: string[], currency: string, signal: AbortSignal): Promise<Map<string, Instrument>> {
    const c = await catalog.get(signal);
    const out = new Map<string, Instrument>();
    for (const m of markets) {
      const i = c.resolve(m, currency);
      if (i) out.set(m, i);
    }
    return out;
  }

  return {
    id: spec.id,
    label: spec.label,
    intervals: Object.keys(spec.intervals).map(Number).sort((a, b) => a - b),

    resolve,

    requestsPerUpdate(req) {
      // Markets the list shows don't exist aren't asked for.
      const c = catalog.loaded;
      const known = (m: string) => !c || c.resolve(m, req.currency) !== undefined;
      const listed = req.markets.filter((m) => known(m) && !req.charts.includes(m)).length;
      const candles = [...req.charts, ...req.lines].filter(known).length;
      return (c ? 0 : 1) + (listed > 0 ? 1 : 0) + candles;
    },

    estimateMs(req) {
      return spec.api.estimateMs(this.requestsPerUpdate(req));
    },

    async fetch(
      req: MarketRequest, signal: AbortSignal, onProgress?: (partial: MarketData[]) => void, onLastRequest?: () => void,
    ): Promise<MarketData[]> {
      const out = new Map<string, MarketData>(req.markets.map((m) => [m, { market: m, candles: [] }]));
      const result = () => req.markets.map((m) => out.get(m)!);
      const fail = (d: MarketData, e: unknown) => {
        if (isAbort(e)) throw e;
        d.error = describeError(e);
      };

      let known: Map<string, Instrument>;
      try {
        known = await resolve(req.markets, req.currency, signal);
      } catch (e) {
        for (const d of out.values()) fail(d, e);
        return result();
      }
      for (const d of out.values()) if (!known.has(d.market)) d.error = 'unknown pair';
      const id = (m: string) => known.get(m)!.id;

      const listed = req.markets.filter((m) => known.has(m) && !req.charts.includes(m));
      if (listed.length === 1) {
        const d = out.get(listed[0]!)!;
        try {
          Object.assign(d, await spec.ticker(id(d.market), signal));
        } catch (e) {
          fail(d, e);
        }
      } else if (listed.length > 1) {
        try {
          // Two names can mean one market ("BTC", "BTC-USD").
          const tickers = await spec.tickers(signal, [...new Set(listed.map(id))]);
          for (const m of listed) {
            const t = tickers.get(id(m));
            if (t) Object.assign(out.get(m)!, t);
            else out.get(m)!.error = 'no price';
          }
        } catch (e) {
          for (const m of listed) fail(out.get(m)!, e);
        }
      }
      onProgress?.(result());

      const bar = spec.intervals[req.interval];
      const intervalSec = req.interval * 60;
      // Last, so the charts are the freshest data.
      const charted = [...req.charts, ...req.lines].filter((m) => known.has(m));
      for (const m of charted) {
        const d = out.get(m)!;
        if (!bar) {
          d.error = 'candle size not supported';
          continue;
        }
        if (m === charted.at(-1)) onLastRequest?.();
        try {
          d.candles = (await spec.candles(id(m), bar, intervalSec, req.candles, signal)).slice(-req.candles);
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

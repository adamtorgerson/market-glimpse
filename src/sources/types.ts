import type { Instrument } from './symbols';

export interface Candle {
  time: number; // unix seconds, candle open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketData {
  market: string;
  /** Only for charted markets and those with a line graph; empty for the rest. */
  candles: Candle[];
  /** Latest trade price. */
  last?: number;
  /** Aggregated index price from CoinGecko; charted markets only. Null when asked for but unavailable. */
  index?: number | null;
  /** Rolling 24h volume in the base currency. */
  dayVolume?: number;
  /** 24h change, as a fraction (0.05 is +5%); shown in place of the volume for Explore's biggest movers. */
  dayChange?: number;
  error?: string;
}

/**
 * What Explore ranks a source's markets by: 24h volume in the quote
 * currency, the size of the 24h change, or liquidity (the money at the best
 * bid and ask: the top of the book, not its depth).
 */
export type ExploreBy = 'volume' | 'movers' | 'liquidity';

/** A market Explore found, as it would be typed, with what it was ranked by. */
export interface ExploreItem {
  market: string;
  last: number;
  /** In the base currency, as `MarketData.dayVolume`. */
  dayVolume?: number;
  /** 24h volume in the quote currency (dollars, euros…): comparable across markets. */
  quoteVolume: number;
  /** 24h change, as a fraction; missing where the exchange doesn't give it. */
  change?: number;
  /** Money at the best bid and best ask, in the quote currency (`ExploreBy` liquidity). */
  topOfBook?: number;
}

export interface MarketRequest {
  /** Every monitored market, as typed: "BTC-USDC", or "TSLA" with no quote. */
  markets: string[];
  /** Fiat currency for markets typed without a quote, e.g. "USD". */
  currency: string;
  /** The subset that needs candles. */
  charts: string[];
  /**
   * Listed (not charted) markets that need candles too, for a line graph in
   * the market list. They still get a ticker, for price and 24h volume.
   */
  lines: string[];
  /** Candle size in minutes. */
  interval: number;
  /** Candles that fit across one chart (or line graph): request no more history than this. */
  candles: number;
}

/**
 * A public market-data API. Every source must follow the rules in http.ts:
 * at most one request every 1.5 seconds, calls grouped into as few requests as
 * the API allows, and no more history than will be displayed.
 */
export interface MarketSource {
  id: string;
  label: string;
  /** Supported candle sizes in minutes, ascending. */
  intervals: readonly number[];
  /**
   * What each market names on this exchange (see `Catalog.resolve`), loading
   * the market list if it hasn't been yet. Unknown markets are left out.
   */
  resolve(markets: string[], currency: string, signal: AbortSignal): Promise<Map<string, Instrument>>;
  /** Requests one `fetch` will make, so the UI can keep the refresh rate sustainable. */
  requestsPerUpdate(req: MarketRequest): number;
  /** Rough ms a `fetch` would take if started now (rate limit, request count, recent response times). */
  estimateMs(req: MarketRequest): number;
  /**
   * One result per `req.markets` entry, in order. Rejects only with an
   * AbortError. `onProgress` gets the results so far after each request.
   *
   * Charts and line graphs are asked for last, so what's drawn is the
   * freshest data. `onLastRequest` is called just before the final candle
   * request, so data from other APIs (the index) can be fetched alongside it
   * rather than seconds earlier. It isn't called if there are no candles to
   * ask for.
   */
  fetch(
    req: MarketRequest, signal: AbortSignal, onProgress?: (partial: MarketData[]) => void, onLastRequest?: () => void,
  ): Promise<MarketData[]>;
  /**
   * The source's top markets (up to `EXPLORE_COUNT`) quoted in `currency`
   * (any dollar for USD), by `by`, one per asset: from every market's 24h
   * ticker, in as few requests as the API allows (usually one).
   */
  explore(by: ExploreBy, currency: string, signal: AbortSignal): Promise<ExploreItem[]>;
  /** Requests one `explore` by `by` makes, including the market list until it's loaded. */
  exploreRequests(by: ExploreBy): number;
  /** Rough ms for an `explore` by `by` and then `candles` single-market candle requests (line graphs), started now. */
  estimateExploreMs(by: ExploreBy, candles: number): number;
}

/** Markets Explore monitors: as many as the market list shows. */
export const EXPLORE_COUNT = 8;

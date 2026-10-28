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
  error?: string;
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
}

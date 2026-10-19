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
  /** Only for charted markets; empty for the rest. */
  candles: Candle[];
  /** Latest trade price. */
  last?: number;
  /** Aggregated index price from CoinGecko; charted markets only. */
  index?: number;
  /** Rolling 24h volume in the base currency. */
  dayVolume?: number;
  error?: string;
}

export interface MarketRequest {
  /** Every monitored market, e.g. "BTC-USDC". */
  markets: string[];
  /** The subset that needs candles. */
  charts: string[];
  /** Candle size in minutes. */
  interval: number;
  /** Candles that fit across one chart: request no more history than this. */
  candles: number;
}

/**
 * A public market-data API. Every source must follow the rules in http.ts:
 * at most one request every 2.5 seconds, calls grouped into as few requests as
 * the API allows, and no more history than will be displayed.
 */
export interface MarketSource {
  id: string;
  label: string;
  /** Supported candle sizes in minutes, ascending. */
  intervals: readonly number[];
  /** Requests one `fetch` will make, so the UI can keep the refresh rate sustainable. */
  requestsPerUpdate(req: MarketRequest): number;
  /** Rough ms a `fetch` would take if started now (rate limit, request count, recent response times). */
  estimateMs(req: MarketRequest): number;
  /** One result per `req.markets` entry, in order. Rejects only with an AbortError. */
  fetch(req: MarketRequest, signal: AbortSignal): Promise<MarketData[]>;
}

export const KRAKEN_INTERVALS = [1, 5, 15, 30, 60, 240, 1440, 10080, 21600] as const;
export type KrakenInterval = (typeof KRAKEN_INTERVALS)[number];

export const CANDLE_WIDTHS = ['wide', 'narrow', 'thin'] as const;
export type CandleWidth = (typeof CANDLE_WIDTHS)[number];

export const MAX_CHARTS = 4;
export const MAX_MARKETS = 8;

export interface Settings {
  /** Markets to monitor, e.g. "BTC-USDC". */
  markets: string[];
  /** Subset of `markets` drawn as charts (0–4). The rest are listed under the charts, or full screen if none. */
  charts: string[];
  /** Candle width in minutes. */
  interval: KrakenInterval;
  /** Candle body width: wide = 6px (4px in quadrants), narrow = 3px, thin = 2px. */
  candleWidth: CandleWidth;
  /** Seconds between updates. */
  refreshSec: number;
  /** Seconds the chart stays on the glasses after each update. */
  displaySec: number;
}

export const DEFAULT_SETTINGS: Settings = {
  markets: ['BTC-USDC', 'ETH-USDC'],
  charts: ['BTC-USDC'],
  interval: 5,
  candleWidth: 'thin',
  refreshSec: 120,
  displaySec: 10,
};

export function normalizeMarket(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s/_:]+/g, '-');
}

/** Coerce arbitrary (possibly stale or hand-edited) input into valid settings. */
export function sanitize(input: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  const markets = dedupe((input.markets ?? d.markets).map(normalizeMarket).filter(Boolean)).slice(0, MAX_MARKETS);
  if (markets.length === 0) markets.push(...d.markets);

  let charts = dedupe((input.charts ?? d.charts).map(normalizeMarket)).filter((m) => markets.includes(m));
  charts = charts.slice(0, MAX_CHARTS);

  const interval = (KRAKEN_INTERVALS as readonly number[]).includes(Number(input.interval))
    ? (Number(input.interval) as KrakenInterval)
    : d.interval;

  const candleWidth = (CANDLE_WIDTHS as readonly string[]).includes(input.candleWidth as string)
    ? input.candleWidth!
    : d.candleWidth;

  const refreshSec = clampInt(input.refreshSec, 15, 24 * 3600, d.refreshSec);
  // The chart has to come down before the next update goes up.
  const displaySec = Math.min(clampInt(input.displaySec, 1, 3600, d.displaySec), refreshSec - 1);

  return { markets, charts, interval, candleWidth, refreshSec, displaySec };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function formatInterval(min: number): string {
  if (min % 10080 === 0) return `${min / 10080}w`;
  if (min % 1440 === 0) return `${min / 1440}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}m`;
}

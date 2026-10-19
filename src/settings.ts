import { isCalibration, type LookUpCalibration } from './lookup';
import { DEFAULT_SOURCE, getSource, SOURCES } from './sources';

export const CANDLE_WIDTHS = ['wide', 'narrow', 'thin'] as const;
export type CandleWidth = (typeof CANDLE_WIDTHS)[number];

export const MAX_CHARTS = 4;
export const MAX_MARKETS = 8;

export interface Settings {
  /** Market data source id, e.g. "kraken". */
  source: string;
  /** Markets to monitor, e.g. "BTC-USDC". */
  markets: string[];
  /** Subset of `markets` drawn as charts (0–4). The rest are listed under the charts, or full screen if none. */
  charts: string[];
  /** Candle size in minutes; one the source supports. */
  interval: number;
  /** Candle body width: wide = 6px (4px in quadrants), narrow = 3px, thin = 2px. */
  candleWidth: CandleWidth;
  /** Show CoinGecko's index price in each chart header (one extra request per update). */
  showIndex: boolean;
  /** No scheduled updates: fetch and show only on Show now or a tap. */
  manualOnly: boolean;
  /** In manual-only mode, also update when the wearer looks up (needs `lookUpCal`). */
  lookUpUpdate: boolean;
  /** Motion-sensor readings looking ahead and looking up; null until calibrated. */
  lookUpCal: LookUpCalibration | null;
  /** Seconds between updates. */
  refreshSec: number;
  /** Seconds the chart stays on the glasses after each update. */
  displaySec: number;
}

export const DEFAULT_SETTINGS: Settings = {
  source: DEFAULT_SOURCE,
  markets: ['BTC-USDC', 'ETH-USDC'],
  charts: ['BTC-USDC'],
  interval: 5,
  candleWidth: 'narrow',
  showIndex: true,
  manualOnly: false,
  lookUpUpdate: false,
  lookUpCal: null,
  refreshSec: 120,
  displaySec: 12,
};

export function normalizeMarket(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s/_:]+/g, '-');
}

/** Coerce arbitrary (possibly stale or hand-edited) input into valid settings. */
export function sanitize(input: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  const source = SOURCES.some((s) => s.id === input.source) ? input.source! : d.source;
  const markets = dedupe((input.markets ?? d.markets).map(normalizeMarket).filter(Boolean)).slice(0, MAX_MARKETS);
  if (markets.length === 0) markets.push(...d.markets);

  let charts = dedupe((input.charts ?? d.charts).map(normalizeMarket)).filter((m) => markets.includes(m));
  charts = charts.slice(0, MAX_CHARTS);

  const interval = nearestInterval(getSource(source).intervals, Number(input.interval) || d.interval);

  const candleWidth = (CANDLE_WIDTHS as readonly string[]).includes(input.candleWidth as string)
    ? input.candleWidth!
    : d.candleWidth;

  const refreshSec = clampInt(input.refreshSec, 15, 24 * 3600, d.refreshSec);
  // The chart has to come down before the next update goes up.
  const displaySec = Math.min(clampInt(input.displaySec, 1, 3600, d.displaySec), refreshSec - 1);

  const showIndex = typeof input.showIndex === 'boolean' ? input.showIndex : d.showIndex;
  const manualOnly = typeof input.manualOnly === 'boolean' ? input.manualOnly : d.manualOnly;
  const lookUpUpdate = typeof input.lookUpUpdate === 'boolean' ? input.lookUpUpdate : d.lookUpUpdate;
  const lookUpCal = isCalibration(input.lookUpCal) ? input.lookUpCal : null;

  return { source, markets, charts, interval, candleWidth, showIndex, manualOnly, lookUpUpdate, lookUpCal, refreshSec, displaySec };
}

/** `minutes` if supported, else the supported size closest to it (by ratio). */
export function nearestInterval(supported: readonly number[], minutes: number): number {
  if (supported.includes(minutes)) return minutes;
  const dist = (m: number) => Math.abs(Math.log(m / minutes));
  return supported.reduce((best, m) => (dist(m) < dist(best) ? m : best));
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

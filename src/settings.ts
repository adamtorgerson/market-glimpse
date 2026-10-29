import { isCalibration, type LookUpCalibration } from './lookup';
import { DEFAULT_SOURCE, getPredictionSource, getSource, isPredictionSource, PREDICTION_SOURCES, SOURCES } from './sources';
import { EVENT_INTERVALS, eventSlug } from './sources/prediction';
import { CURRENCIES, DEFAULT_CURRENCY, type Currency } from './sources/symbols';
import type { ExploreBy } from './sources/types';

export const CANDLE_WIDTHS = ['wide', 'narrow', 'thin', 'text-blocks', 'text-wide', 'text-narrow', 'text-thin'] as const;
export type CandleWidth = (typeof CANDLE_WIDTHS)[number];
export type TextWidth = Extract<CandleWidth, `text${string}`>;

/** Fonts for the text in chart images; never the phone's own, which varies by phone. */
export const CHART_FONTS = ['atkinson', 'b612', 'dejavu-mono', 'hack', 'terminus'] as const;
export type ChartFont = (typeof CHART_FONTS)[number];

export const MAX_CHARTS = 4;

/** Explore's layouts: the market list, or that many of the top markets charted. */
export const EXPLORE_VIEWS = ['list', '1', '2', '4'] as const;
export type ExploreView = (typeof EXPLORE_VIEWS)[number];

/** Markets (or events) Explore charts with `view`: none for the list, and no more than `width` allows. */
export function exploreCharts(view: ExploreView, width: CandleWidth, events: boolean): number {
  if (view === 'list') return 0;
  return events ? Number(view) : Math.min(Number(view), maxCharts(width));
}
export const MAX_MARKETS = 8;

/** Text candles are drawn in the glasses' font instead of sent as images. */
export function isTextWidth(width: CandleWidth): width is TextWidth {
  return width.startsWith('text');
}

/** Charts a candle width allows: text candles fill the glasses with one. */
export function maxCharts(width: CandleWidth): number {
  return isTextWidth(width) ? 1 : MAX_CHARTS;
}

export interface Settings {
  /** Data source id: an exchange ("kraken") or a prediction market ("polymarket"). */
  source: string;
  /** Quote currency for markets typed without one ("TSLA", "BTC"). */
  currency: Currency;
  /** Markets to monitor, e.g. "BTC-USDC", or "TSLA" with no quote. */
  markets: string[];
  /** Subset of `markets` drawn as charts (0–4). The rest are listed under the charts, or full screen if none. */
  charts: string[];
  /** Candle size in minutes; one the source supports. */
  interval: number;
  /**
   * Events to monitor (slugs), up to 8, by prediction-market source id: each
   * names its events its own way (polymarket.com's
   * "bitcoin-up-or-down-on-october-29-2026", polymarket.us's
   * "btc-updown-1d-2026-10-27-2100z"). Kept apart from `markets`, so
   * switching sources keeps every list.
   */
  events: Record<string, string[]>;
  /** Subset of each source's `events` charted (0–4), as `charts` is of `markets`. */
  eventCharts: Record<string, string[]>;
  /** Spacing of the events' history, in minutes (`EVENT_INTERVALS`). */
  eventInterval: number;
  /**
   * Monitor the source's top markets (Explore) instead of the watchlist
   * (`markets`, or for a prediction market, its `events`).
   */
  explore: boolean;
  /** What Explore ranks by: 24h volume, or the size of the 24h change. */
  exploreBy: ExploreBy;
  /**
   * How Explore shows what it finds: the full-screen list, or the top 1, 2
   * or 4 charted (for an exchange, the rest listed under them).
   */
  exploreView: ExploreView;
  /**
   * Candle body width: wide = 6px (4px in quadrants), narrow = 3px, thin = 2px,
   * or text-wide / text-narrow / text-thin = drawn in the glasses' font rather
   * than sent as images (one chart only).
   */
  candleWidth: CandleWidth;
  /** Font for the text in chart images (not text candles, which use the glasses' font). */
  font: ChartFont;
  /**
   * Send the full-screen market list as text. Takes precedence over charts:
   * any ticked are kept but not drawn. (With none ticked and this off, the
   * list is an image with a line graph per market, one candle request each.)
   */
  textList: boolean;
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
  /** Keep the chart up instead of blanking after `displaySec`; each update replaces it. */
  alwaysOn: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  source: DEFAULT_SOURCE,
  currency: DEFAULT_CURRENCY,
  markets: ['BTC-USDC', 'ETH-USDC'],
  charts: ['BTC-USDC'],
  interval: 5,
  events: {},
  eventCharts: {},
  eventInterval: 5,
  explore: false,
  exploreBy: 'volume',
  exploreView: 'list',
  candleWidth: 'narrow',
  font: 'atkinson',
  textList: false,
  showIndex: true,
  manualOnly: false,
  lookUpUpdate: false,
  lookUpCal: null,
  refreshSec: 120,
  displaySec: 12,
  alwaysOn: false,
};

export function normalizeMarket(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s/_:]+/g, '-');
}

/** Coerce arbitrary (possibly stale or hand-edited) input into valid settings. */
export function sanitize(input: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  const source = SOURCES.some((s) => s.id === input.source) || isPredictionSource(input.source ?? '') ? input.source! : d.source;
  const currency = (CURRENCIES as readonly string[]).includes(input.currency as string) ? input.currency! : d.currency;
  const markets = dedupe((input.markets ?? d.markets).map(normalizeMarket).filter(Boolean)).slice(0, MAX_MARKETS);
  if (markets.length === 0) markets.push(...d.markets);

  // Kept as is while a prediction market is chosen, for when an exchange is again.
  const interval = isPredictionSource(source)
    ? clampInt(input.interval, 1, 43200, d.interval)
    : nearestInterval(getSource(source).intervals, Number(input.interval) || d.interval);
  // A single list was Polymarket's, before there was more than one prediction market.
  const rawEvents: Record<string, unknown> = Array.isArray(input.events) ? { polymarket: input.events } : input.events ?? d.events;
  const slugs = (raw: unknown) => (Array.isArray(raw) ? dedupe(raw.filter((e): e is string => typeof e === 'string').map(eventSlug).filter(Boolean)) : []);
  const events = Object.fromEntries(PREDICTION_SOURCES.map((src) => [src.id, slugs(rawEvents[src.id]).slice(0, MAX_MARKETS)]));
  // Before events could be listed, every one was charted.
  const rawCharts: Record<string, unknown> = input.eventCharts ?? events;
  const eventCharts = Object.fromEntries(PREDICTION_SOURCES.map((src) =>
    [src.id, slugs(rawCharts[src.id]).filter((e) => events[src.id]!.includes(e)).slice(0, MAX_CHARTS)]));
  const eventInterval = nearestInterval(EVENT_INTERVALS, Number(input.eventInterval) || d.eventInterval);

  // 'text' was the only text width before there were three.
  const width = (input.candleWidth as string) === 'text' ? 'text-wide' : input.candleWidth;
  const candleWidth = (CANDLE_WIDTHS as readonly string[]).includes(width as string) ? width! : d.candleWidth;

  const font = (CHART_FONTS as readonly string[]).includes(input.font as string) ? input.font! : d.font;

  const charts = dedupe((input.charts ?? d.charts).map(normalizeMarket))
    .filter((m) => markets.includes(m))
    .slice(0, maxCharts(candleWidth));

  const refreshSec = clampInt(input.refreshSec, 15, 24 * 3600, d.refreshSec);
  // The chart has to come down before the next update goes up.
  const displaySec = Math.min(clampInt(input.displaySec, 1, 3600, d.displaySec), refreshSec - 1);

  const textList = typeof input.textList === 'boolean' ? input.textList : d.textList;
  const showIndex = typeof input.showIndex === 'boolean' ? input.showIndex : d.showIndex;
  const manualOnly = typeof input.manualOnly === 'boolean' ? input.manualOnly : d.manualOnly;
  const lookUpUpdate = typeof input.lookUpUpdate === 'boolean' ? input.lookUpUpdate : d.lookUpUpdate;
  const lookUpCal = isCalibration(input.lookUpCal) ? input.lookUpCal : null;
  const alwaysOn = typeof input.alwaysOn === 'boolean' ? input.alwaysOn : d.alwaysOn;
  const explore = typeof input.explore === 'boolean' ? input.explore : d.explore;
  // A ranking the source offers (Polymarket US has only volume).
  const rankings = isPredictionSource(source) ? getPredictionSource(source).exploreRankings : undefined;
  const wantBy: ExploreBy = input.exploreBy === 'movers' || input.exploreBy === 'liquidity' ? input.exploreBy : 'volume';
  const exploreBy = !rankings || rankings.includes(wantBy) ? wantBy : rankings[0]!;
  const exploreView = (EXPLORE_VIEWS as readonly string[]).includes(input.exploreView as string) ? input.exploreView! : d.exploreView;

  return { source, currency, markets, charts, interval, events, eventCharts, eventInterval, explore, exploreBy, exploreView, candleWidth, font, textList, showIndex, manualOnly, lookUpUpdate, lookUpCal, refreshSec, displaySec, alwaysOn };
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

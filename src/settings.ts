import {
  ANALYSES, ATR_PERIOD, BOLLINGER_K, BOLLINGER_PERIOD, DONCHIAN_PERIOD, EMA_PERIOD, MACD_FAST, MACD_SIGNAL, MACD_SLOW, MAX_K, MAX_PERIOD, MAX_SAR,
  MIN_K, MIN_PERIOD, MIN_SAR, RSI_PERIOD, SAR_MAX, SAR_STEP, SMA_PERIOD, type Analysis, type AnalysisSpec,
} from './analysis';
import { isCalibration, type LookUpCalibration } from './lookup';
import { cleanNewsFilter } from './news';
import { DEFAULT_SOURCE, getPredictionSource, getSource, isPredictionSource, PREDICTION_SOURCES, sourceCurrencies, SOURCES } from './sources';
import { NEWS_SOURCE_IDS } from './sources/news';
import { EVENT_INTERVALS, eventSlug } from './sources/prediction';
import { DEFAULT_CURRENCY } from './sources/symbols';
import type { ExploreBy } from './sources/types';

export const CANDLE_WIDTHS = ['wide', 'narrow', 'thin', 'text-blocks', 'text-wide', 'text-narrow', 'text-thin'] as const;
export type CandleWidth = (typeof CANDLE_WIDTHS)[number];
export type TextWidth = Extract<CandleWidth, `text${string}`>;

/** Fonts for the text in chart images; never the phone's own, which varies by phone. */
export const CHART_FONTS = ['atkinson', 'b612', 'dejavu-mono', 'hack', 'terminus'] as const;
export type ChartFont = (typeof CHART_FONTS)[number];

/** The steps, in percent, image charts can be dimmed or thinned by before they're sent. */
export const IMAGE_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

export const MAX_CHARTS = 4;
/** Charts allowed with analysis on: smaller ones have too few candles for an indicator to settle. */
export const MAX_ANALYSIS_CHARTS = 2;

/** Explore's layouts: the market list, or that many of the top markets charted. */
export const EXPLORE_VIEWS = ['list', '1', '2', '4'] as const;
export type ExploreView = (typeof EXPLORE_VIEWS)[number];

/** Markets (or events) Explore charts with `view`: none for the list, and no more than `max`. */
export function exploreCharts(view: ExploreView, max: number): number {
  return view === 'list' ? 0 : Math.min(Number(view), max);
}
export const MAX_MARKETS = 8;
/** News filters allowed, and as many excludes. */
export const MAX_NEWS_FILTERS = 8;
/** Saved watchlists allowed per `watchlistKey`. */
export const MAX_WATCHLISTS = 20;
export const MAX_WATCHLIST_NAME = 24;

/** A named watchlist: its markets (or events), and the ones charted. */
export interface SavedWatchlist {
  name: string;
  markets: string[];
  charts: string[];
}

const EXCHANGE_WATCHLISTS = 'exchange';
const WATCHLIST_KEYS = [EXCHANGE_WATCHLISTS, ...PREDICTION_SOURCES.map((src) => src.id)];

/**
 * Where a source's saved watchlists are kept. Exchanges share theirs, as they
 * do `markets`; each prediction market has its own, as it does `events`, since
 * one's slugs mean nothing to another.
 */
export function watchlistKey(source: string): string {
  return isPredictionSource(source) ? source : EXCHANGE_WATCHLISTS;
}

/** Text candles are drawn in the glasses' font instead of sent as images. */
export function isTextWidth(width: CandleWidth): width is TextWidth {
  return width.startsWith('text');
}

/** Charts a candle width allows: text candles fill the glasses with one, and analysis (image charts only) limits the rest. */
export function maxCharts(width: CandleWidth, analysis: boolean): number {
  if (isTextWidth(width)) return 1;
  return analysis ? MAX_ANALYSIS_CHARTS : MAX_CHARTS;
}

/** Events charted at most: the text chart fills the glasses with one, and analysis (image charts only) limits the rest. */
export function maxEventCharts(textChart: boolean, analysis: boolean): number {
  if (textChart) return 1;
  return analysis ? MAX_ANALYSIS_CHARTS : MAX_CHARTS;
}

export interface Settings {
  /** Data source id: an exchange ("kraken") or a prediction market ("polymarket"). */
  source: string;
  /** Source ids a long press on the glasses cycles through, in the source list's order. */
  favorites: string[];
  /** Quote currency for markets typed without one ("TSLA", "BTC"). */
  currency: string;
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
   * "btc-updown-1d-2026-10-27-2100z", Hyperliquid's
   * "touch-btc-20261201-0000"). Kept apart from `markets`, so
   * switching sources keeps every list.
   */
  events: Record<string, string[]>;
  /** Subset of each source's `events` charted (0–4), as `charts` is of `markets`. */
  eventCharts: Record<string, string[]>;
  /** Saved watchlists, by `watchlistKey`. Choosing one copies it into `markets` and `charts`, or the source's `events` and `eventCharts`. */
  watchlists: Record<string, SavedWatchlist[]>;
  /** The name of the saved watchlist chosen, by `watchlistKey`: '' for none. */
  activeWatchlist: Record<string, string>;
  /** Spacing of the events' history, in minutes (`EVENT_INTERVALS`). */
  eventInterval: number;
  /** Draw an event's chart in the glasses' font rather than send it as images (one chart only). */
  eventTextChart: boolean;
  /** Show each event's change, volatility, spread, outcomes' total and time left on its image chart. */
  eventAnalysis: boolean;
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
  /** Dim image screens by this percent (`IMAGE_STEPS`) before sending them (not text screens, which the glasses draw). */
  imageDim: number;
  /** Turn off this percent (`IMAGE_STEPS`) of image screens' lit pixels before sending them. */
  imageThin: number;
  /**
   * Show the full-screen market list instead of charts. Takes precedence over
   * them: any ticked (or Explore's charted layout) are kept but not drawn.
   */
  showList: boolean;
  /**
   * Send the full-screen market list, whenever it's shown, as text. (Off,
   * it's an image with a line graph per market, one candle request each.)
   */
  textList: boolean;
  /** Draw `analysisKind` on the image candle charts (not text candles or prediction markets). */
  analysis: boolean;
  /** The indicator drawn when `analysis` is on. */
  analysisKind: Analysis;
  /** A second indicator drawn with it, never the same one. */
  analysisSecond: Analysis | 'none';
  /** Candles each indicator looks back over. */
  smaPeriod: number;
  emaPeriod: number;
  rsiPeriod: number;
  atrPeriod: number;
  bollingerPeriod: number;
  donchianPeriod: number;
  /** Bollinger band width, in standard deviations either side. */
  bollingerK: number;
  /** MACD's EMA periods, in candles: fast below slow. */
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  /** Parabolic SAR's acceleration: the step, up to the max. */
  sarStep: number;
  sarMax: number;
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
  /** The glasses' tap, swipes and long press control the charts. A double tap exits regardless. */
  gestures: boolean;
  /** Each scheduled update moves on to the next favorite source first. */
  cycleFavorites: boolean;
  /** News source ids to fetch headlines from with each update, in the sources' order. None by default. */
  newsSources: string[];
  /** Words or phrases that make a headline a hit, as a market or event it mentions does. */
  newsFilters: string[];
  /** Words or phrases that keep a headline out, whatever else it mentions: they win over everything that makes it a hit. */
  newsExcludes: string[];
}

/** Exactly what `sanitize` makes of them: a change is spotted by comparing settings, and a difference here would look like one. */
export const DEFAULT_SETTINGS: Settings = {
  source: DEFAULT_SOURCE,
  favorites: [],
  currency: DEFAULT_CURRENCY,
  markets: ['BTC-USDC', 'ETH-USDC'],
  charts: ['BTC-USDC'],
  interval: 5,
  events: Object.fromEntries(PREDICTION_SOURCES.map((src) => [src.id, []])),
  eventCharts: Object.fromEntries(PREDICTION_SOURCES.map((src) => [src.id, []])),
  watchlists: Object.fromEntries(WATCHLIST_KEYS.map((key) => [key, []])),
  activeWatchlist: Object.fromEntries(WATCHLIST_KEYS.map((key) => [key, ''])),
  eventInterval: 5,
  eventTextChart: false,
  eventAnalysis: false,
  explore: false,
  exploreBy: 'volume',
  exploreView: 'list',
  candleWidth: 'narrow',
  font: 'atkinson',
  imageDim: 0,
  imageThin: 0,
  showList: false,
  textList: false,
  showIndex: true,
  analysis: false,
  analysisKind: 'ema',
  analysisSecond: 'none',
  smaPeriod: SMA_PERIOD,
  emaPeriod: EMA_PERIOD,
  rsiPeriod: RSI_PERIOD,
  atrPeriod: ATR_PERIOD,
  bollingerPeriod: BOLLINGER_PERIOD,
  donchianPeriod: DONCHIAN_PERIOD,
  bollingerK: BOLLINGER_K,
  macdFast: MACD_FAST,
  macdSlow: MACD_SLOW,
  macdSignal: MACD_SIGNAL,
  sarStep: SAR_STEP,
  sarMax: SAR_MAX,
  manualOnly: false,
  lookUpUpdate: false,
  lookUpCal: null,
  refreshSec: 120,
  displaySec: 12,
  alwaysOn: false,
  gestures: true,
  cycleFavorites: false,
  newsSources: [],
  newsFilters: [],
  newsExcludes: [],
};

export function normalizeMarket(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s/_:]+/g, '-');
}

/** Every source id, exchanges then prediction markets, as the source list shows them. */
export const ALL_SOURCE_IDS: readonly string[] = [...SOURCES, ...PREDICTION_SOURCES].map((s) => s.id);

/** The favorites other than `source`, in the source list's order from it, wrapping. */
export function otherFavorites(s: Settings): string[] {
  const at = ALL_SOURCE_IDS.indexOf(s.source);
  const after = (id: string) => (ALL_SOURCE_IDS.indexOf(id) - at + ALL_SOURCE_IDS.length) % ALL_SOURCE_IDS.length;
  return s.favorites.filter((id) => id !== s.source).sort((a, b) => after(a) - after(b));
}

/** The favorite after `source` in the source list, wrapping; null without another. */
export function nextFavorite(s: Settings): string | null {
  return otherFavorites(s)[0] ?? null;
}

/** A watchlist name as stored: trimmed and within the limit; '' if it isn't text. */
export function cleanWatchlistName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MAX_WATCHLIST_NAME).trim() : '';
}

/**
 * `lists` with `list` saved: over the one named `current` (renaming it if the
 * name differs), or added if `current` is ''. Throws, with a reason for the
 * form, if another list has the name or there's no room for a new one.
 */
export function storeWatchlist(lists: SavedWatchlist[], current: string, list: SavedWatchlist): SavedWatchlist[] {
  const clash = lists.find((l) => l.name !== current && l.name.toLowerCase() === list.name.toLowerCase());
  if (clash) throw new Error(`There's already a watchlist named ${clash.name}.`);
  if (current) return lists.map((l) => (l.name === current ? list : l));
  if (lists.length >= MAX_WATCHLISTS) throw new Error(`Up to ${MAX_WATCHLISTS} watchlists: delete one first.`);
  return [...lists, list];
}

/** The name of the saved watchlist after `current`, wrapping (the first if `current` is ''); null without another. */
export function nextWatchlist(lists: SavedWatchlist[], current: string): string | null {
  const next = lists[(lists.findIndex((l) => l.name === current) + 1) % lists.length]?.name ?? null;
  return next === current ? null : next;
}

/** Valid saved watchlists from `raw`: named, uniquely, with something in them. `clean` makes valid markets (or events) of a list. */
function sanitizeWatchlists(raw: unknown, clean: (raw: unknown) => string[]): SavedWatchlist[] {
  if (!Array.isArray(raw)) return [];
  const names = new Set<string>();
  const lists: SavedWatchlist[] = [];
  for (const w of raw as (Partial<SavedWatchlist> | null)[]) {
    const name = cleanWatchlistName(w?.name);
    const markets = clean(w?.markets).slice(0, MAX_MARKETS);
    if (!name || markets.length === 0 || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    // Every tick is kept, whatever the current width allows: the form limits them as it shows them.
    lists.push({ name, markets, charts: clean(w?.charts).filter((m) => markets.includes(m)).slice(0, MAX_CHARTS) });
  }
  return lists.slice(0, MAX_WATCHLISTS);
}

/** Coerce arbitrary (possibly stale or hand-edited) input into valid settings. */
export function sanitize(input: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  const source = SOURCES.some((s) => s.id === input.source) || isPredictionSource(input.source ?? '') ? input.source! : d.source;
  const favorites = Array.isArray(input.favorites) ? ALL_SOURCE_IDS.filter((id) => input.favorites!.includes(id)) : d.favorites;
  // Kept as is while a prediction market is chosen, for when an exchange is again;
  // an exchange without it takes its own default.
  const currencies = isPredictionSource(source) ? SOURCES.flatMap((s) => sourceCurrencies(s.id)) : sourceCurrencies(source);
  const currency = currencies.includes(input.currency as string) ? input.currency! : isPredictionSource(source) ? d.currency : currencies[0]!;
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
  const eventTextChart = typeof input.eventTextChart === 'boolean' ? input.eventTextChart : d.eventTextChart;
  const eventAnalysis = typeof input.eventAnalysis === 'boolean' ? input.eventAnalysis : d.eventAnalysis;
  // Before events could be listed, every one was charted.
  const rawCharts: Record<string, unknown> = input.eventCharts ?? events;
  const eventCharts = Object.fromEntries(PREDICTION_SOURCES.map((src) =>
    [src.id, slugs(rawCharts[src.id]).filter((e) => events[src.id]!.includes(e)).slice(0, maxEventCharts(eventTextChart, eventAnalysis))]));
  const eventInterval = nearestInterval(EVENT_INTERVALS, Number(input.eventInterval) || d.eventInterval);
  const symbols = (raw: unknown) => (Array.isArray(raw) ? dedupe(raw.filter((m): m is string => typeof m === 'string').map(normalizeMarket).filter(Boolean)) : []);
  const watchlists = Object.fromEntries(WATCHLIST_KEYS.map((key) => [key, sanitizeWatchlists(input.watchlists?.[key], key === EXCHANGE_WATCHLISTS ? symbols : slugs)]));
  const activeWatchlist = Object.fromEntries(WATCHLIST_KEYS.map((key) => {
    const name = input.activeWatchlist?.[key];
    return [key, watchlists[key]!.some((l) => l.name === name) ? name! : ''];
  }));

  // 'text' was the only text width before there were three.
  const width = (input.candleWidth as string) === 'text' ? 'text-wide' : input.candleWidth;
  const candleWidth = (CANDLE_WIDTHS as readonly string[]).includes(width as string) ? width! : d.candleWidth;

  const font = (CHART_FONTS as readonly string[]).includes(input.font as string) ? input.font! : d.font;
  const step = (v: unknown, fallback: number) => Math.round(clampInt(v, 0, 90, fallback) / 10) * 10;
  const imageDim = step(input.imageDim, d.imageDim);
  const imageThin = step(input.imageThin, d.imageThin);

  const analysis = typeof input.analysis === 'boolean' ? input.analysis : d.analysis;
  const charts = dedupe((input.charts ?? d.charts).map(normalizeMarket))
    .filter((m) => markets.includes(m))
    .slice(0, maxCharts(candleWidth, analysis));

  const refreshSec = clampInt(input.refreshSec, 15, 24 * 3600, d.refreshSec);
  // The chart has to come down before the next update goes up.
  const displaySec = Math.min(clampInt(input.displaySec, 1, 3600, d.displaySec), refreshSec - 1);

  const textList = typeof input.textList === 'boolean' ? input.textList : d.textList;
  // Before Market List, the text list took precedence over the watchlist's charts.
  const showList = typeof input.showList === 'boolean' ? input.showList : textList && !input.explore;
  const showIndex = typeof input.showIndex === 'boolean' ? input.showIndex : d.showIndex;
  const analysisKind = (ANALYSES as readonly string[]).includes(input.analysisKind as string) ? input.analysisKind! : d.analysisKind;
  const analysisSecond = (ANALYSES as readonly string[]).includes(input.analysisSecond as string) && input.analysisSecond !== analysisKind ? input.analysisSecond! : d.analysisSecond;
  const period = (v: unknown, fallback: number) => clampInt(v, MIN_PERIOD, MAX_PERIOD, fallback);
  const smaPeriod = period(input.smaPeriod, d.smaPeriod);
  const emaPeriod = period(input.emaPeriod, d.emaPeriod);
  const rsiPeriod = period(input.rsiPeriod, d.rsiPeriod);
  const atrPeriod = period(input.atrPeriod, d.atrPeriod);
  const bollingerPeriod = period(input.bollingerPeriod, d.bollingerPeriod);
  const donchianPeriod = period(input.donchianPeriod, d.donchianPeriod);
  const bollingerK = clampPlaces(input.bollingerK, MIN_K, MAX_K, 1, d.bollingerK);
  const macdSignal = period(input.macdSignal, d.macdSignal);
  // The form refuses these pairs out of order; anything else that is goes back to the defaults.
  let macdFast = period(input.macdFast, d.macdFast), macdSlow = period(input.macdSlow, d.macdSlow);
  if (macdFast >= macdSlow) [macdFast, macdSlow] = [d.macdFast, d.macdSlow];
  let sarStep = clampPlaces(input.sarStep, MIN_SAR, MAX_SAR, 3, d.sarStep), sarMax = clampPlaces(input.sarMax, MIN_SAR, MAX_SAR, 3, d.sarMax);
  if (sarStep > sarMax) [sarStep, sarMax] = [d.sarStep, d.sarMax];
  const manualOnly = typeof input.manualOnly === 'boolean' ? input.manualOnly : d.manualOnly;
  const lookUpUpdate = typeof input.lookUpUpdate === 'boolean' ? input.lookUpUpdate : d.lookUpUpdate;
  const lookUpCal = isCalibration(input.lookUpCal) ? input.lookUpCal : null;
  const alwaysOn = typeof input.alwaysOn === 'boolean' ? input.alwaysOn : d.alwaysOn;
  const gestures = typeof input.gestures === 'boolean' ? input.gestures : d.gestures;
  const cycleFavorites = typeof input.cycleFavorites === 'boolean' ? input.cycleFavorites : d.cycleFavorites;
  const newsSources = Array.isArray(input.newsSources) ? NEWS_SOURCE_IDS.filter((id) => input.newsSources!.includes(id)) : d.newsSources;
  const filterList = (raw: unknown, fallback: string[]) => {
    const seen = new Set<string>();
    return (Array.isArray(raw) ? raw : fallback).map(cleanNewsFilter).filter((f) => {
      const key = f.toLowerCase();
      if (!f || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, MAX_NEWS_FILTERS);
  };
  const newsFilters = filterList(input.newsFilters, d.newsFilters);
  const newsExcludes = filterList(input.newsExcludes, d.newsExcludes);
  const explore = typeof input.explore === 'boolean' ? input.explore : d.explore;
  // A ranking the source offers (Polymarket US has only volume).
  const rankings = isPredictionSource(source) ? getPredictionSource(source).exploreRankings : undefined;
  const wantBy: ExploreBy = input.exploreBy === 'movers' || input.exploreBy === 'liquidity' ? input.exploreBy : 'volume';
  const exploreBy = !rankings || rankings.includes(wantBy) ? wantBy : rankings[0]!;
  const exploreView = (EXPLORE_VIEWS as readonly string[]).includes(input.exploreView as string) ? input.exploreView! : d.exploreView;

  return { source, favorites, currency, markets, charts, interval, events, eventCharts, watchlists, activeWatchlist, eventInterval, eventTextChart, eventAnalysis, explore, exploreBy, exploreView, candleWidth, font, imageDim, imageThin, showList, textList, showIndex, analysis, analysisKind, analysisSecond, smaPeriod, emaPeriod, rsiPeriod, atrPeriod, bollingerPeriod, donchianPeriod, bollingerK, macdFast, macdSlow, macdSignal, sarStep, sarMax, manualOnly, lookUpUpdate, lookUpCal, refreshSec, displaySec, alwaysOn, gestures, cycleFavorites, newsSources, newsFilters, newsExcludes };
}

/** The indicators to draw with `s`, in order: none if analysis is off. */
export function analysisSpecs(s: Settings): AnalysisSpec[] {
  if (!s.analysis) return [];
  return s.analysisSecond === 'none' ? [analysisSpec(s, s.analysisKind)] : [analysisSpec(s, s.analysisKind), analysisSpec(s, s.analysisSecond)];
}

function analysisSpec(s: Settings, kind: Analysis): AnalysisSpec {
  switch (kind) {
    case 'sma': return { kind: 'sma', period: s.smaPeriod };
    case 'ema': return { kind: 'ema', period: s.emaPeriod };
    case 'rsi': return { kind: 'rsi', period: s.rsiPeriod };
    case 'atr': return { kind: 'atr', period: s.atrPeriod };
    case 'donchian': return { kind: 'donchian', period: s.donchianPeriod };
    case 'bollinger': return { kind: 'bollinger', period: s.bollingerPeriod, k: s.bollingerK };
    case 'macd': return { kind: 'macd', fast: s.macdFast, slow: s.macdSlow, signal: s.macdSignal };
    case 'sar': return { kind: 'sar', step: s.sarStep, max: s.sarMax };
    case 'vwap': return { kind: 'vwap' };
  }
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

/** A number between `min` and `max`, to `places` decimal places. */
function clampPlaces(v: unknown, min: number, max: number, places: number, fallback: number): number {
  const n = v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? Number(Math.min(max, Math.max(min, n)).toFixed(places)) : fallback;
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

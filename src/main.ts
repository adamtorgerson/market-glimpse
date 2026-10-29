import './style.css';
import LOGO_SVG from '../assets/icon.svg?raw';
import { candleCapacity, DEFAULT_AXIS_W, formatChange, formatVolume, renderScreen, SCREEN_H, SCREEN_W, type ScreenModel } from './chart';
import { FONTS, loadFont } from './fonts';
import { Glasses, type UploadStats } from './glasses';
import { onTraffic, tapBridge, traffic, type Counter } from './traffic';
import { predictionCapacity, renderPrediction, renderPredictionList } from './predictchart';
import { calibrate, LookUpDetector, type Vec } from './lookup';
import { encodeTiles } from './png';
import { buildEventTextList, buildLoadingList, buildTextChart, buildTextList, drawTextChart, serializeBox, textCandles, type TextBox } from './textchart';
import { average, describeError, isAbort, MIN_GAP_MS } from './sources/http';
import { CURRENCIES, DOLLARS, type Currency } from './sources/symbols';
import { getPredictionSource, getSource, isPredictionSource, PREDICTION_SOURCES, sourceLabel, SOURCES } from './sources';
import { EVENT_INTERVALS, eventSlug, type ExploredEvent, type PredictionData, type PredictionRequest } from './sources/prediction';
import { estimateIndexMs, fetchIndexPrices } from './sources/coingecko';
import { EXPLORE_COUNT, type ExploreBy, type ExploreItem, type MarketData, type MarketRequest } from './sources/types';
import {
  CANDLE_WIDTHS,
  CHART_FONTS,
  DEFAULT_SETTINGS,
  exploreCharts,
  formatInterval,
  isTextWidth,
  MAX_CHARTS,
  MAX_MARKETS,
  maxCharts,
  nearestInterval,
  normalizeMarket,
  sanitize,
  type CandleWidth,
  type ChartFont,
  type ExploreView,
  type Settings,
} from './settings';

/**
 * The Diagnostics section on the phone page. TEMP: on in the package build
 * too; set back to `import.meta.env.DEV` to drop it (and src/speedtest.ts).
 */
const DIAGNOSTICS: boolean = true;

const STORAGE_KEY = 'kraken-candles.settings';
const APP_NAME = 'MarketGlimpse';
// Largest image container the glasses accept.
const TILE_W = 288;
const TILE_H = 144;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('screen');
const statusEl = $('status');
const updatedEl = $('updated');
$('logo').innerHTML = LOGO_SVG;
const scheduleEl = $('schedule');
const showNowBtn = $<HTMLButtonElement>('show-now');
const alwaysOnBox = $<HTMLInputElement>('always-on');

let glasses: Glasses | null = null;
let settings: Settings = DEFAULT_SETTINGS;

// ── Storage ─────────────────────────────────────────────────────────────

async function loadSettings(): Promise<Settings> {
  let raw: string | null = null;
  try {
    raw = glasses ? await glasses.bridge.getLocalStorage(STORAGE_KEY) : localStorage.getItem(STORAGE_KEY);
  } catch { /* fall through to defaults */ }
  try {
    return raw ? sanitize(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(s: Settings): Promise<void> {
  const raw = JSON.stringify(s);
  try {
    if (glasses) await glasses.bridge.setLocalStorage(STORAGE_KEY, raw);
    else localStorage.setItem(STORAGE_KEY, raw);
  } catch (e) {
    console.warn('Could not save settings', e);
  }
}

// ── Update cycle ────────────────────────────────────────────────────────

let nextTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let nextAt = 0;
let showing = false;
/** Set once the app is closed on the glasses: nothing is fetched or shown after that. */
let exited = false;

function setShowing(v: boolean): void {
  showing = v;
  // Always on, the button (like a tap) refreshes the chart rather than hiding it.
  showNowBtn.textContent = settings.alwaysOn ? 'Refresh now' : v ? 'Hide now' : 'Show now';
}
let inFlight: AbortController | null = null;

/** Markets drawn as charts: none when the market list is shown as text, which takes precedence (the ticks are kept). */
function shownCharts(s: Settings): string[] {
  return s.textList ? [] : s.charts;
}

/** Charted markets to look up on CoinGecko; none if the index is turned off. */
function indexMarkets(s: Settings): string[] {
  return s.showIndex ? shownCharts(s) : [];
}

function marketRequest(s: Settings): MarketRequest {
  const charts = shownCharts(s);
  return {
    markets: s.markets,
    currency: s.currency,
    charts,
    // With nothing charted, the image market list has a line graph per market,
    // over the period one chart would show.
    lines: charts.length === 0 && !s.textList ? s.markets : [],
    interval: s.interval,
    candles: capacity(charts.length, s.candleWidth),
  };
}

/** Candles that fit across each chart (one full-screen chart if none). */
function capacity(nCharts: number, width: CandleWidth): number {
  return isTextWidth(width) ? textCandles(width) : candleCapacity(nCharts, width, lastAxisW);
}

interface UpdateOptions {
  /** Drop an update already in progress (e.g. the settings changed); otherwise it's left to finish. */
  cancel?: boolean;
  /** Asked for by the user: show "Loading…" on the glasses while fetching. */
  manual?: boolean;
  /** Don't put the chart up before this time (ms), so scheduled charts appear on time. */
  showAt?: number;
  /** Redraw the last data if it was fetched for the same request (e.g. only the font changed). */
  reuse?: boolean;
}

/** The last update's data, and the request and time it was fetched with. */
let lastFetch: { key: string; data: MarketData[]; updated: Date } | null = null;

/** What an update fetches with `s`; data fetched for the same key can be redrawn as is. */
function fetchKey(s: Settings): string {
  if (s.explore) {
    const n = exploreCharts(s.exploreView, s.candleWidth, false);
    return JSON.stringify(['explore', s.source, s.exploreBy, s.currency, s.exploreView, s.textList, s.interval, s.candleWidth, capacity(n, s.candleWidth), n && s.showIndex]);
  }
  return JSON.stringify([s.source, marketRequest(s), indexMarkets(s)]);
}

/**
 * Explore's latest top list, for the phone page: each market (or event) as
 * it's added to the watchlist, as it's shown, and the volume or change it was
 * ranked by; or why there's none.
 */
let explored: { key: string; items: { market: string; label: string; value: string }[]; error?: string } | null = null;

/** Which top list `s` explores: the source's, by its ranking (and for an exchange, in its currency type). */
function exploreKey(s: Settings): string {
  return JSON.stringify([s.source, s.exploreBy, isPredictionSource(s.source) ? '' : s.currency]);
}

function setExplored(s: Settings, items: { market: string; label: string; value: string }[], error?: string): void {
  explored = { key: exploreKey(s), items, error };
  renderExplore();
}

/** The markets (or events) Explore last found for `s`; none before it's run. */
function exploredMarkets(s: Settings): string[] {
  return explored?.key === exploreKey(s) ? explored.items.map((i) => i.market) : [];
}

/** The last update's data, if it was fetched for what `s` would fetch. */
function reusable(s: Settings): MarketData[] | null {
  return lastFetch?.key === fetchKey(s) ? lastFetch.data : null;
}

/** The chosen prediction market's events (each source keeps its own list). */
function sourceEvents(s: Settings): string[] {
  return s.events[s.source] ?? [];
}

/** The chosen prediction market's charted events. */
function sourceEventCharts(s: Settings): string[] {
  return s.eventCharts[s.source] ?? [];
}

/**
 * A prediction market's events, as text: its list (the watchlist with
 * nothing charted, as the option takes precedence over charts, or Explore's
 * List). Current prices only, no history.
 */
function eventTextList(s: Settings): boolean {
  return s.textList && (!s.explore || exploreCharts(s.exploreView, s.candleWidth, true) === 0);
}

/** The events a prediction-market update charts: the top ones Explore found, or the watchlist's ticked. */
function chartedEvents(s: Settings, markets: string[]): string[] {
  if (eventTextList(s)) return [];
  return s.explore ? markets.slice(0, exploreCharts(s.exploreView, s.candleWidth, true)) : sourceEventCharts(s);
}

/**
 * What a prediction-market update asks for: history for the charted events
 * only (the rest are listed), no more than one of their charts shows; with
 * none charted, for every event's line plot in the list, or none for text.
 */
function eventRequest(s: Settings, found?: string[]): PredictionRequest {
  // Exploring, the events found last time stand in for the estimate until this update finds its own.
  const markets = found ?? (s.explore ? exploredMarkets(s) : sourceEvents(s));
  const charts = chartedEvents(s, markets);
  return {
    markets,
    interval: s.eventInterval,
    points: eventTextList(s) ? 0 : predictionCapacity(Math.max(1, charts.length)),
    ...(charts.length ? { history: charts } : {}),
  };
}

/** The last prediction-market update's events, as `lastFetch` is for exchanges. */
let lastEvents: { key: string; data: PredictionData[]; updated: Date } | null = null;

function eventsKey(s: Settings): string {
  if (s.explore) return JSON.stringify(['explore', s.source, s.exploreBy, exploreCharts(s.exploreView, s.candleWidth, true), eventTextList(s), s.eventInterval]);
  return JSON.stringify([s.source, eventRequest(s)]);
}

/** True if the last update's data can be redrawn for `s` without fetching. */
function canReuse(s: Settings): boolean {
  return isPredictionSource(s.source) ? lastEvents?.key === eventsKey(s) : reusable(s) !== null;
}

/** When the update in progress should have its chart up (ms), for the loading estimate. */
let inFlightEta = 0;

/** Fetch, draw, show on the glasses, then blank them after `displaySec`. */
async function update({ cancel = false, manual = false, showAt = 0, reuse = false }: UpdateOptions = {}): Promise<void> {
  if (exited) return;
  // An update in progress is left to finish unless cancelled; its chart will replace the loading screen.
  const joining = inFlight !== null && !cancel;
  if (!joining) {
    inFlight?.abort();
    // Redrawing the last data skips the fetch, and its list is complete from the start.
    const cached = reuse && canReuse(settings);
    inFlightEta = Math.max(Date.now() + (cached ? drawMs + (glasses ? uploadMs : 0) : estimateUpdateMs()), showAt);
    progress = (cached && reusable(settings)) || [];
    clearTimeout(dueTimer);
    dueAt = showAt;
    // Not drawn by its time: the loading screen goes up, unless a chart is still showing.
    if (showAt) dueTimer = setTimeout(() => { if (!showing) showRemaining(); }, Math.max(0, showAt - Date.now()));
  }
  if (manual) showLoading(Math.max(1, Math.round((inFlightEta - Date.now()) / 1000)));
  if (joining) return;
  const ctrl = (inFlight = new AbortController());
  try {
    await runUpdate(ctrl, showAt, reuse);
  } finally {
    if (inFlight === ctrl) {
      inFlight = null;
      notDue();
    }
  }
}

/** When the scheduled update in progress should have its chart up (ms); 0 once it's drawn, or if none. */
let dueAt = 0;
let dueTimer: ReturnType<typeof setTimeout> | undefined;

function notDue(): void {
  dueAt = 0;
  clearTimeout(dueTimer);
}

/** True once a scheduled update has missed its time without drawing its chart. */
function late(): boolean {
  return dueAt > 0 && Date.now() >= dueAt;
}

/** Put the loading screen up for a scheduled update, re-estimating what's left from the markets fetched so far. */
function showRemaining(): void {
  const after = drawMs + (glasses ? uploadMs : 0);
  const left = 1 - progress.length / Math.max(1, loadingItems().length);
  inFlightEta = Date.now() + (estimateUpdateMs() - after) * left + after;
  showLoading(Math.max(1, Math.round((inFlightEta - Date.now()) / 1000)));
}

// Running averages of the steps after fetching, for the loading estimate.
let drawMs = 100;
let uploadMs = 1000;

/**
 * Rough ms for an update started now: the market source and CoinGecko fetch
 * side by side, each estimated from its rate limit, request count and recent
 * response times; then drawing and sending the tiles, from recent updates.
 */
function estimateUpdateMs(): number {
  const after = drawMs + (glasses ? uploadMs : 0);
  if (isPredictionSource(settings.source)) {
    // Exploring, finding the events is a request first (or more, for Polymarket US's liquidity).
    const src = getPredictionSource(settings.source);
    const finding = settings.explore ? (src.exploreRequests?.(settings.exploreBy) ?? 1) * MIN_GAP_MS : 0;
    return src.estimateMs(eventRequest(settings)) + finding + after;
  }
  if (settings.explore) return getSource(settings.source).estimateExploreMs(settings.exploreBy, exploreCandles(settings)) + after;
  const fetchMs = Math.max(
    getSource(settings.source).estimateMs(marketRequest(settings)),
    estimateIndexMs(indexMarkets(settings)),
  );
  return fetchMs + drawMs + (glasses ? uploadMs : 0);
}

/** True while "Loading…" is on the glasses. */
let loading = false;
/** The update in progress's results so far, for the loading screen's market list. */
let progress: MarketData[] = [];
/** Every monitored market, with what's been fetched of it so far. */
function loadingItems(): MarketData[] {
  if (isPredictionSource(settings.source)) {
    // Each event by its title if it's been fetched before, else its slug; the
    // one request brings them all at once, so there's no progress to show.
    const titles = new Map(lastEvents?.data.map((d) => [d.market, d.title]));
    return eventRequest(settings).markets.map((e) => ({ market: shorten(titles.get(e) ?? e, 24), candles: [] }));
  }
  // Exploring: the markets found so far this update, else last time's.
  const markets = settings.explore ? (progress.length ? progress.map((d) => d.market) : exploredMarkets(settings)) : settings.markets;
  return markets.map((m) => progress.find((d) => d.market === m) ?? { market: m, candles: [] });
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function showLoading(etaSec: number): void {
  if (!glasses) return;
  clearTimeout(hideTimer);
  setShowing(true);
  loading = true;
  glasses.loading({
    // The time (dim, beside the message) top-left and the source top-right, as on the other screens.
    message: `Loading… ~${etaSec}s`,
    topLeft: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    topRight: sourceLabel(settings.source),
    bottomLeft: '',
    bottomRight: APP_NAME,
    list: buildLoadingList(loadingItems()),
  }).catch((e) => setStatus(`Glasses error: ${(e as Error).message}`));
}

/** A source's partial results: fill in the loading screen's list as they come. */
function onProgress(ctrl: AbortController, partial: MarketData[]): void {
  if (inFlight !== ctrl) return;
  progress = partial;
  if (loading) glasses?.updateLoadingList(buildLoadingList(loadingItems())).catch(() => {});
}

async function runUpdate(ctrl: AbortController, showAt: number, reuse: boolean): Promise<void> {
  if (isPredictionSource(settings.source)) return runEventsUpdate(ctrl, showAt, reuse);
  const s = settings;
  const key = fetchKey(s);
  let data: MarketData[], updated: Date;
  if (reuse && lastFetch?.key === key) {
    ({ data, updated } = lastFetch);
  } else {
    showFetching();
    try {
      data = s.explore ? await exploreMarkets(s, ctrl) : await watchlistMarkets(s, ctrl);
    } catch {
      return; // superseded by a newer update
    }
    if (ctrl.signal.aborted) return;
    updated = new Date();
    lastFetch = { key, data, updated };
  }
  // Already loaded unless the font was just changed; without it, text falls back to monospace.
  await loadFont(s.font).catch(() => {});
  if (ctrl.signal.aborted) return;

  const drawStart = Date.now();
  const byMarket = new Map(data.map((d) => [d.market, d]));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // Explore's top markets are charted (or none, for the list), and the rest listed, in their order.
  const exploring = s.explore ? exploreCharts(s.exploreView, s.candleWidth, false) : 0;
  const shown = s.explore ? data.slice(0, exploring).map((d) => d.market) : shownCharts(s);
  const charts = shown.map((m) => byMarket.get(m)!);
  const ticker = s.explore ? data.slice(exploring) : s.markets.filter((m) => !shown.includes(m)).map((m) => byMarket.get(m)!);
  const source = getSource(s.source).label;
  // Text candles draw the one chart in the glasses' font, and the text list
  // the market list; otherwise the screen goes as image tiles.
  let textBoxes: TextBox[] | null = null;
  if (isTextWidth(s.candleWidth) && charts.length === 1) {
    textBoxes = buildTextChart({ chart: charts[0]!, width: s.candleWidth, ticker, interval: s.interval, updated, source, name: APP_NAME });
  } else if (s.textList && charts.length === 0) {
    textBoxes = buildTextList({ items: ticker, updated, source, name: APP_NAME });
  }
  if (textBoxes) {
    drawTextChart(ctx, textBoxes);
  } else {
    const model = { charts, ticker, interval: s.interval, candleWidth: s.candleWidth, updated, source, font: s.font };
    lastAxisW = DIAGNOSTICS && supersample ? renderSupersampled(ctx, model) : renderScreen(ctx, model);
  }
  refreshWidthLabels();
  // Drawn, so it goes up as soon as it's due (or now, if late) without a loading screen.
  notDue();

  const failed = data.filter((d) => d.error).map((d) => `${d.market}: ${d.error}`);
  await present(ctrl, showAt, textBoxes, failed, updated, drawStart);
}

/** The watchlist's markets, with the index for the charts. Rejects only with an AbortError. */
async function watchlistMarkets(s: Settings, ctrl: AbortController): Promise<MarketData[]> {
  // Different APIs, each with its own rate limit. The index is asked for
  // alongside the source's last chart request, so it's as fresh as the
  // chart beside it, and by what each market is on the exchange.
  const src = getSource(s.source);
  const wanted = indexMarkets(s);
  let lastRequest!: () => void;
  const lastRequested = new Promise<void>((resolve) => (lastRequest = resolve));
  const [markets, index] = await Promise.all([
    src.fetch(marketRequest(s), ctrl.signal, (partial) => onProgress(ctrl, partial), lastRequest).finally(lastRequest),
    wanted.length === 0 ? new Map<string, number>() : lastRequested
      .then(() => src.resolve(wanted, s.currency, ctrl.signal))
      .then((resolved) => fetchIndexPrices(resolved, ctrl.signal), (e) => {
        if (isAbort(e)) throw e;
        return new Map<string, number>();
      }),
  ]);
  return markets.map((d) => ({ ...d, index: wanted.includes(d.market) ? index.get(d.market) ?? null : undefined }));
}

/**
 * Explore: the source's top markets, ranked from every market's ticker, each
 * with its 24h change in place of its volume for biggest movers. The top
 * 1, 2 or 4 charted (with the index, as charts are), or in the list, a line
 * graph of each unless it's text. Rejects only with an AbortError.
 */
async function exploreMarkets(s: Settings, ctrl: AbortController): Promise<MarketData[]> {
  const src = getSource(s.source);
  let found: ExploreItem[];
  try {
    found = await src.explore(s.exploreBy, s.currency, ctrl.signal);
  } catch (e) {
    if (isAbort(e)) throw e;
    setExplored(s, [], describeError(e));
    return [{ market: 'Explore', candles: [], error: describeError(e) }];
  }
  const movers = s.exploreBy === 'movers';
  setExplored(s, found.map((f) => ({
    market: f.market,
    label: f.market,
    value: movers ? (f.change === undefined ? '' : formatChange(f.change))
      : s.exploreBy === 'liquidity' ? (f.topOfBook === undefined ? '' : `${formatQuoteVolume(f.topOfBook, f.market)} bid/ask`)
      : formatQuoteVolume(f.quoteVolume, f.market),
  })));
  const data = found.map((f): MarketData => ({ market: f.market, candles: [], last: f.last, dayVolume: f.dayVolume, ...(movers ? { dayChange: f.change } : {}) }));
  onProgress(ctrl, data);
  const n = exploreCharts(s.exploreView, s.candleWidth, false);
  const markets = (n ? data.slice(0, n) : s.textList ? [] : data).map((d) => d.market);
  if (markets.length === 0) return data;
  // Candles asked for as charts: the tickers are in hand, so there's no second ticker request.
  const withCandles = (partial: MarketData[]) => data.map((d) => ({ ...d, candles: partial.find((p) => p.market === d.market)?.candles ?? [] }));
  // The charts' index, from CoinGecko, alongside the last candle request, as for the watchlist's.
  const wanted = n && s.showIndex ? markets : [];
  let lastRequest!: () => void;
  const lastRequested = new Promise<void>((resolve) => (lastRequest = resolve));
  const [candles, index] = await Promise.all([
    src.fetch(
      { markets, currency: s.currency, charts: markets, lines: [], interval: s.interval, candles: capacity(n, s.candleWidth) },
      ctrl.signal, (partial) => onProgress(ctrl, withCandles(partial)), lastRequest).finally(lastRequest),
    wanted.length === 0 ? new Map<string, number>() : lastRequested
      .then(() => src.resolve(wanted, s.currency, ctrl.signal))
      .then((resolved) => fetchIndexPrices(resolved, ctrl.signal), (e) => {
        if (isAbort(e)) throw e;
        return new Map<string, number>();
      }),
  ]);
  return withCandles(candles).map((d) => (wanted.includes(d.market) ? { ...d, index: index.get(d.market) ?? null } : d));
}

/**
 * Candle requests an Explore update makes after ranking: one per chart, or
 * in the list, one per line graph (none as text).
 */
function exploreCandles(s: Settings): number {
  const n = exploreCharts(s.exploreView, s.candleWidth, false);
  return n || (s.textList ? 0 : EXPLORE_COUNT);
}

/** 24h volume in a market's quote currency: "$421.4M", "€12.0M", or "1.2K BTC". */
function formatQuoteVolume(v: number, market: string): string {
  const quote = market.split('-')[1] ?? '';
  if (DOLLARS.includes(quote)) return `$${formatVolume(v)}`;
  if (quote === 'EUR') return `€${formatVolume(v)}`;
  if (quote === 'AUD') return `A$${formatVolume(v)}`;
  return `${formatVolume(v)} ${quote}`;
}

/** A change in probability, in points: "+15 pts". */
function formatPoints(change: number): string {
  const pts = Math.round(change * 100);
  return `${pts >= 0 ? '+' : '−'}${Math.abs(pts)} pts`;
}

/** A prediction-market update: fetch the events (or reuse them), draw their charts, and show them. */
async function runEventsUpdate(ctrl: AbortController, showAt: number, reuse: boolean): Promise<void> {
  const s = settings;
  const key = eventsKey(s);
  let data: PredictionData[], updated: Date;
  if (reuse && lastEvents?.key === key) {
    ({ data, updated } = lastEvents);
  } else {
    showFetching();
    try {
      data = s.explore ? await exploreEvents(s, ctrl) : await getPredictionSource(s.source).fetch(eventRequest(s), ctrl.signal);
    } catch {
      return; // superseded by a newer update
    }
    if (ctrl.signal.aborted) return;
    updated = new Date();
    lastEvents = { key, data, updated };
  }
  await loadFont(s.font).catch(() => {});
  if (ctrl.signal.aborted) return;

  const drawStart = Date.now();
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const model = { interval: s.eventInterval, updated, source: sourceLabel(s.source), font: s.font };
  // The charted events, and the rest listed under them; with none charted,
  // the list, as text in the glasses' font if asked, else as an image.
  const charted = chartedEvents(s, data.map((d) => d.market)).flatMap((m) => data.filter((d) => d.market === m));
  let textBoxes: TextBox[] | null = null;
  if (eventTextList(s)) {
    textBoxes = buildEventTextList({ items: data, updated, source: model.source, name: APP_NAME });
    drawTextChart(ctx, textBoxes);
  } else if (charted.length === 0) {
    renderPredictionList(ctx, { ...model, items: data });
  } else {
    renderPrediction(ctx, { ...model, charts: charted, ticker: data.filter((d) => !charted.includes(d)) });
  }
  notDue();
  await present(ctrl, showAt, textBoxes, data.filter((d) => d.error).map((d) => `${d.market}: ${d.error}`), updated, drawStart);
}

/** Explore for a prediction market: its top events, charted. Rejects only with an AbortError. */
async function exploreEvents(s: Settings, ctrl: AbortController): Promise<PredictionData[]> {
  const src = getPredictionSource(s.source);
  const fail = (error: string): PredictionData[] => {
    setExplored(s, [], error);
    return [{ market: 'explore', title: 'Explore', outcomes: [], error }];
  };
  if (!src.explore) return fail(`${src.label} doesn't publish volume or price changes to rank by`);
  let found: ExploredEvent[];
  try {
    found = await src.explore(s.exploreBy, ctrl.signal);
  } catch (e) {
    if (isAbort(e)) throw e;
    return fail(describeError(e));
  }
  const value = (f: ExploredEvent) => {
    if (s.exploreBy === 'movers') return f.change === undefined ? '' : formatPoints(f.change);
    // Polymarket's own liquidity is its books; Polymarket US's, the top of its leading market's.
    if (s.exploreBy === 'liquidity') return f.liquidity === undefined ? '' : `$${formatVolume(f.liquidity)} ${s.source === 'polymarket' ? 'book' : 'bid/ask'}`;
    return f.volume === undefined ? '' : `$${formatVolume(f.volume)}`;
  };
  // The list on the phone as soon as they're found, by the titles the ranking gave.
  setExplored(s, found.map((f) => ({ market: f.market, label: f.title ?? f.market, value: value(f) })));
  // History for the charted ones, or the list's line plots (none as text).
  const data = await src.fetch(eventRequest(s, found.map((f) => f.market)), ctrl.signal);
  setExplored(s, found.map((f, i) => ({
    market: f.market,
    label: data[i]?.title ?? f.title ?? f.market,
    value: value(f),
  })));
  return data;
}

/**
 * Put the screen drawn on the canvas (or `textBoxes`) on the glasses once
 * it's due, then set it to come down after the show-for time.
 */
async function present(ctrl: AbortController, showAt: number, textBoxes: TextBox[] | null, failed: string[], updated: Date, drawStart: number): Promise<void> {
  // Plain spaces: some WebView fonts lack the narrow no-break space before
  // "PM", and the fallback font would shift the line.
  const stamp = updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\s/g, ' ');

  if (!glasses) {
    setStatus('Browser preview (glasses not connected)', failed, stamp);
    return;
  }

  try {
    const renderMs = Date.now() - drawStart;
    if (showAt > Date.now()) {
      await new Promise((r) => setTimeout(r, showAt - Date.now()));
      if (ctrl.signal.aborted) return;
    }
    // Image tiles take seconds to send: a scheduled chart puts the loading
    // screen, with its prices, up first. Text screens go up about as fast.
    if (showAt && !textBoxes && !showing) showRemaining();
    clearTimeout(hideTimer);
    const wasLoading = loading;
    loading = false;
    if (textBoxes) {
      drawMs = average(drawMs, renderMs);
      const uploadStart = Date.now();
      showUploadStats(await glasses.showText(textBoxes.map((b) => ({ y: b.y, color: b.color, content: serializeBox(b) }))));
      uploadMs = average(uploadMs, Date.now() - uploadStart);
    } else {
      // Encoded only now, since a loading screen that went up while waiting
      // must be covered by the tiles.
      const encodeStart = Date.now();
      const tiles = encodeTiles(canvas, TILE_W, TILE_H, wasLoading ? glasses.loadingRects() : []);
      drawMs = average(drawMs, renderMs + Date.now() - encodeStart);
      const uploadStart = Date.now();
      showUploadStats(await glasses.show(tiles, wasLoading));
      uploadMs = average(uploadMs, Date.now() - uploadStart);
    }
    if (ctrl.signal.aborted) return;
    setShowing(true);
    setStatus('Display on', failed, stamp);
    // Read now, not from `s`: the option may have changed while this update ran.
    if (!settings.alwaysOn) hideTimer = setTimeout(hideUnlessAlwaysOn, settings.displaySec * 1000);
  } catch (e) {
    if (ctrl.signal.aborted) return;
    setStatus(`Glasses error: ${(e as Error).message}`, failed);
    hide();
  }
}

/**
 * The show-for timer's end: blank the display, unless it has since been set
 * to stay on, or the next chart is late (then the loading screen replaces it).
 */
function hideUnlessAlwaysOn(): void {
  if (settings.alwaysOn) return;
  if (late()) showRemaining();
  else void hide();
}

async function hide(): Promise<void> {
  clearTimeout(hideTimer);
  setShowing(false);
  loading = false;
  if (!glasses || exited) return;
  try {
    await glasses.blank();
    // Errors after the text stay; "Updated" on the right is kept.
    if (statusEl.textContent!.startsWith('Display on')) statusEl.textContent = statusEl.textContent!.replace('Display on', 'Display off');
  } catch (e) {
    setStatus(`Glasses error: ${(e as Error).message}`);
  }
}

/**
 * Run an update now and re-anchor the refresh schedule to it. Scheduled
 * updates start fetching early, by their estimated duration plus a second of
 * slack, so the prices are in by the scheduled time and the chart follows
 * soon after.
 */
function restartSchedule(opts: UpdateOptions = {}): void {
  // Manual-only: nothing is fetched until the user asks.
  if (opts.manual || !settings.manualOnly) void update(opts);
  scheduleAt(Date.now() + settings.refreshSec * 1000);
}

/** Schedule the next chart for `at` (ms), and the ones after it every `refreshSec`. None in manual-only mode. */
function scheduleAt(at: number): void {
  clearTimeout(nextTimer);
  nextAt = settings.manualOnly || exited ? 0 : at;
  syncCountdown();
  if (!nextAt) return;
  const leadMs = estimateUpdateMs() + 1000;
  nextTimer = setTimeout(() => {
    void update({ showAt: at });
    scheduleAt(at + settings.refreshSec * 1000);
  }, Math.max(0, at - leadMs - Date.now()));
}

const uploadStatsEl = $('upload-stats');

/** e.g. "3 tiles, 4.2 KB, bytes: 812 ms · 288×120 1.6 KB 410 ms · …" */
function showUploadStats(u: UploadStats): void {
  console.info('Glasses upload', JSON.stringify(u));
  // Diagnostics are on the phone page in development only.
  if (!DIAGNOSTICS) return;
  const total = u.tiles.reduce((n, t) => n + t.bytes, 0);
  if (u.encoding === 'text') {
    // One rebuild carries every container, so only the total time means anything.
    const each = u.tiles.map((t) => `y ${t.y} ${formatBytes(t.bytes)}`);
    uploadStatsEl.textContent = [`Last upload: ${u.tiles.length} text boxes, ${formatBytes(total)}: ${Math.round(u.ms)} ms`, ...each].join(' · ');
    return;
  }
  const each = u.tiles.map((t) => `${t.w}×${t.h} ${formatBytes(t.bytes)} ${Math.round(t.ms)} ms${t.retried ? ' (retried)' : ''}`);
  uploadStatsEl.textContent = [`Last upload: ${u.tiles.length} tile${u.tiles.length === 1 ? '' : 's'}, ${formatBytes(total)}, ${u.encoding}: ${Math.round(u.ms)} ms`, ...each].join(' · ');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const trafficEl = $('traffic');

/** e.g. "Network: 12 requests, sent 1.4 KB, received 310.2 KB · Glasses: …" */
function showTraffic(): void {
  const line = (name: string, c: Counter, unit: string) =>
    `${name}: ${c.count} ${unit}${c.count === 1 ? '' : 's'}, sent ${formatBytes(c.sent)}, received ${formatBytes(c.received)}`;
  trafficEl.textContent = [line('Network', traffic.network, 'request'), line('Glasses', traffic.glasses, 'call')].join(' · ');
}

// Counts can change many times a second (the motion sensor reports every
// 500 ms), so the line is redrawn at most once a frame.
let trafficFrame = 0;
if (DIAGNOSTICS) onTraffic(() => {
  trafficFrame ||= requestAnimationFrame(() => {
    trafficFrame = 0;
    showTraffic();
  });
});

/** The status line: `text` (and any errors) on the left, the data's fetch time on the right (kept if `updated` is omitted). */
function setStatus(text: string, errors: string[] = [], updated?: string): void {
  clearInterval(fetchTimer);
  statusEl.textContent = text;
  if (errors.length) statusEl.textContent += ` · ${errors.join('; ')}`;
  if (updated !== undefined) updatedEl.textContent = updated && `Updated ${updated}`;
}

/**
 * "Fetching… ~3s", counting down to when the chart should be up (the loading
 * screen's estimate), until the next status replaces it.
 */
let fetchTimer: ReturnType<typeof setInterval> | undefined;
function showFetching(): void {
  const text = () => {
    const secs = Math.round((inFlightEta - Date.now()) / 1000);
    return secs > 0 ? `Fetching… ~${secs}s` : 'Fetching…';
  };
  setStatus(text());
  fetchTimer = setInterval(() => { statusEl.textContent = text(); }, 1000);
}

function renderSchedule(): void {
  const shown = `shown for ${formatDuration(settings.displaySec)}`;
  if (settings.manualOnly) {
    scheduleEl.textContent = `Manual only: press Show now or tap the glasses · ${shown}`;
    return;
  }
  const secs = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
  scheduleEl.textContent = nextAt ? `Next update in ${formatDuration(secs)}` : '';
}

// The countdown only ticks while the page is visible (and there is one), so
// the phone isn't woken every second for text nobody can see.
let countdownTimer: ReturnType<typeof setInterval> | undefined;
function syncCountdown(): void {
  clearInterval(countdownTimer);
  countdownTimer = undefined;
  if (document.hidden) return;
  renderSchedule();
  if (!settings.manualOnly) countdownTimer = setInterval(renderSchedule, 1000);
}
document.addEventListener('visibilitychange', syncCountdown);

// ── Settings form ───────────────────────────────────────────────────────

const form = $<HTMLFormElement>('settings');
const sourceSel = $<HTMLSelectElement>('source');
const currencySel = $<HTMLSelectElement>('currency');
const marketList = $<HTMLUListElement>('markets');
const addMarketBtn = $<HTMLButtonElement>('add-market');
const intervalSel = $<HTMLSelectElement>('interval');
const candleWidthSel = $<HTMLSelectElement>('candle-width');
const fontSel = $<HTMLSelectElement>('font');
const showIndexBox = $<HTMLInputElement>('show-index');
const textListBox = $<HTMLInputElement>('text-list');
const manualOnlyBox = $<HTMLInputElement>('manual-only');
const lookUpBox = $<HTMLInputElement>('look-up');
const lookUpStatus = $('look-up-status');
const calibrateBtn = $<HTMLButtonElement>('calibrate');
const refreshInput = $<HTMLInputElement>('refresh');
const displayInput = $<HTMLInputElement>('display');
const formError = $('form-error');
const marketsHint = $('markets-hint');
const tabWatchlist = $<HTMLButtonElement>('tab-watchlist');
const tabExplore = $<HTMLButtonElement>('tab-explore');
const watchlistPanel = $('watchlist');
const explorePanel = $('explore');
const exploreBySel = $<HTMLSelectElement>('explore-by');
const exploreViewSel = $<HTMLSelectElement>('explore-view');
const exploreHint = $('explore-hint');
const exploreList = $<HTMLOListElement>('explore-list');
const intervalLabel = $('interval-label');

// One list of sources, grouped by kind.
for (const [label, sources] of [['Exchanges', SOURCES], ['Prediction markets', PREDICTION_SOURCES]] as const) {
  const group = document.createElement('optgroup');
  group.label = label;
  for (const src of sources) group.append(new Option(src.label, src.id));
  sourceSel.append(group);
}
for (const c of CURRENCIES) currencySel.add(new Option(c, c));
const CANDLE_WIDTH_LABELS: Record<CandleWidth, string> = { wide: 'Wide', narrow: 'Narrow', thin: 'Thin', 'text-blocks': 'Text blocks, 1 chart', 'text-wide': 'Text wide, 1 chart', 'text-narrow': 'Text narrow, 1 chart', 'text-thin': 'Text thin, 1 chart' };
for (const w of CANDLE_WIDTHS) candleWidthSel.add(new Option(CANDLE_WIDTH_LABELS[w], w));
for (const f of CHART_FONTS) fontSel.add(new Option(FONTS[f].label, f));
let lastAxisW = DEFAULT_AXIS_W;

/**
 * Label each width with the time span it covers, e.g. "Thin · ~14h", for the
 * form's current candle size and chart count; for events, each history
 * spacing, e.g. "5m · ~14h".
 */
function refreshWidthLabels(): void {
  if (marketList.dataset.kind === 'events') {
    const points = predictionCapacity(Math.max(1, marketList.querySelectorAll('input[type=checkbox]:checked').length));
    for (const opt of intervalSel.options) opt.text = `${formatInterval(+opt.value)} · ~${formatSpan(points * +opt.value)}`;
    return;
  }
  const nCharts = marketList.querySelectorAll('input[type=checkbox]:checked').length;
  const minutes = Number(intervalSel.value);
  for (const opt of candleWidthSel.options) {
    const w = opt.value as CandleWidth;
    opt.text = `${CANDLE_WIDTH_LABELS[w]} · ~${formatSpan(capacity(nCharts, w) * minutes)}`;
  }
}

/**
 * Offer the selected source's candle sizes (or, for events, history
 * spacings), keeping the current one or the nearest. Switching kinds starts
 * from that kind's saved size.
 */
function syncIntervalOptions(current?: number): void {
  const events = isPredictionSource(sourceSel.value);
  const kind = events ? 'events' : 'markets';
  const switched = intervalSel.dataset.kind !== kind;
  intervalSel.dataset.kind = kind;
  const want = current ?? (switched ? (events ? settings.eventInterval : settings.interval) : Number(intervalSel.value) || settings.interval);
  const supported = events ? EVENT_INTERVALS : getSource(sourceSel.value).intervals;
  const shown = [...intervalSel.options].map((o) => Number(o.value));
  if (switched || shown.join() !== supported.join()) {
    intervalSel.replaceChildren(...supported.map((m) => new Option(formatInterval(m), String(m))));
  }
  intervalSel.value = String(nearestInterval(supported, want));
}

/**
 * Show the form for the chosen source's kind: exchange markets (with chart
 * ticks, and the exchange-only options), or prediction-market events, all
 * charted. Each kind keeps its own list; switching shows the other's as saved.
 */
function syncKind(s: Settings = settings): void {
  const events = isPredictionSource(sourceSel.value);
  for (const el of document.querySelectorAll<HTMLElement>('[data-exchange]')) el.hidden = events;
  intervalLabel.textContent = events ? 'History spacing' : 'Candle size';
  addMarketBtn.textContent = events ? '+ Add event' : '+ Add market';
  marketsHint.textContent = events ? `Up to ${MAX_CHARTS} charts; ${MAX_MARKETS} events: a Polymarket link or the event's slug` : `Up to ${MAX_CHARTS} charts; ${MAX_MARKETS} markets`;
  // Each prediction market has its own list too.
  const kind = events ? 'events' : 'markets';
  const list = events ? sourceSel.value : '';
  if (marketList.dataset.kind === kind && marketList.dataset.source === list) return;
  marketList.dataset.kind = kind;
  marketList.dataset.source = list;
  marketList.replaceChildren();
  if (events) {
    const saved = s.events[list] ?? [];
    for (const e of saved) addMarketRow(e, (s.eventCharts[list] ?? []).includes(e));
    if (saved.length === 0) addMarketRow();
  } else {
    for (const m of s.markets) addMarketRow(m, s.charts.includes(m));
  }
}

function formatSpan(minutes: number): string {
  const h = minutes / 60, d = h / 24;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  if (d < 60) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 7)}w`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`;
}

function addMarketRow(market = '', charted = false): void {
  const li = document.createElement('li');
  li.innerHTML = marketList.dataset.kind === 'events'
    ? `
    <input type="text" placeholder="Polymarket link or event slug" spellcheck="false" autocapitalize="off" />
    <label><input type="checkbox" /> Chart</label>
    <button type="button" class="secondary" aria-label="Remove">✕</button>`
    : `
    <input type="text" placeholder="e.g. SOL-USDC, or TSLA" spellcheck="false" autocapitalize="characters" />
    <label><input type="checkbox" /> Chart</label>
    <button type="button" class="secondary" aria-label="Remove">✕</button>`;
  li.querySelector<HTMLInputElement>('input[type=text]')!.value = market;
  const check = li.querySelector<HTMLInputElement>('input[type=checkbox]');
  if (check) check.checked = charted;
  li.querySelector('button')!.addEventListener('click', () => {
    li.remove();
    syncMarketControls();
    void applyForm();
  });
  marketList.append(li);
  syncMarketControls();
}

/** Enforce the chart / market limits in the UI. */
function syncMarketControls(): void {
  const rows = [...marketList.children];
  const checks = rows.flatMap((li) => li.querySelector<HTMLInputElement>('input[type=checkbox]') ?? []);
  // Text candles are for exchanges' charts; a prediction market's take any width.
  const max = marketList.dataset.kind === 'events' ? MAX_CHARTS : maxCharts(candleWidthSel.value as CandleWidth);
  // A width that allows fewer charts keeps the first ones ticked.
  checks.filter((c) => c.checked).slice(max).forEach((c) => { c.checked = false; });
  const nChecked = checks.filter((c) => c.checked).length;
  // The text list takes precedence over charts: their ticks are kept but greyed out.
  for (const c of checks) c.disabled = textListBox.checked || (!c.checked && nChecked >= max);
  addMarketBtn.disabled = rows.length >= MAX_MARKETS;
  refreshWidthLabels();
  // Explore's "+" buttons show while there's room.
  renderExplore();
}

addMarketBtn.addEventListener('click', () => {
  addMarketRow();
  marketList.querySelector<HTMLInputElement>('li:last-child input[type=text]')!.focus();
});

/**
 * Offer the Explore layouts the candle width allows (text candles fill the
 * glasses with one chart), and the rankings the source does.
 */
function syncExploreView(): void {
  const events = isPredictionSource(sourceSel.value);
  const rankings = events ? getPredictionSource(sourceSel.value).exploreRankings : undefined;
  for (const opt of exploreBySel.options) opt.disabled = !!rankings && !rankings.includes(opt.value as ExploreBy);
  if (exploreBySel.selectedOptions[0]?.disabled) exploreBySel.value = rankings![0]!;
  const max = events ? MAX_CHARTS : maxCharts(candleWidthSel.value as CandleWidth);
  for (const opt of exploreViewSel.options) {
    opt.disabled = opt.value !== 'list' && Number(opt.value) > max;
  }
  if (exploreViewSel.selectedOptions[0]?.disabled) exploreViewSel.value = String(max);
}

/** Show the Watchlist or Explore tab; which is selected is the `explore` setting. */
function selectTab(explore: boolean): void {
  tabWatchlist.setAttribute('aria-selected', String(!explore));
  tabExplore.setAttribute('aria-selected', String(explore));
  watchlistPanel.hidden = explore;
  explorePanel.hidden = !explore;
}

for (const tab of [tabWatchlist, tabExplore]) {
  tab.addEventListener('click', () => {
    if (tab.getAttribute('aria-selected') === 'true') return;
    selectTab(tab === tabExplore);
    void applyForm();
  });
}

/**
 * The Explore tab: the top markets (or events) last found for the settings,
 * each with what it was ranked by, and a "+" to add it to the watchlist while
 * there's room for it there.
 */
function renderExplore(): void {
  const events = isPredictionSource(settings.source);
  const result = explored?.key === exploreKey(settings) ? explored : null;
  const note = events ? getPredictionSource(settings.source).exploreNote ?? '' : '';
  exploreHint.textContent = result ? result.error ?? (result.items.length ? note : 'Nothing found.') : settings.explore ? 'Loading…' : note;
  // The watchlist as it is in the form (its rows are this source's kind).
  const rows = [...marketList.querySelectorAll<HTMLInputElement>('li input[type=text]')]
    .map((i) => (events ? eventSlug : normalizeMarket)(i.value)).filter(Boolean);
  const room = rows.length < MAX_MARKETS;
  exploreList.replaceChildren(...(result?.items ?? []).map((item, i) => {
    const li = document.createElement('li');
    for (const [cls, text] of [['rank', String(i + 1)], ['name', item.label], ['value', item.value]]) {
      const span = document.createElement('span');
      span.className = cls!;
      span.textContent = text!;
      li.append(span);
    }
    if (rows.includes(item.market)) {
      const added = document.createElement('span');
      added.className = 'added';
      added.textContent = '✓';
      added.title = 'In the watchlist';
      li.append(added);
    } else if (room) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'secondary';
      add.textContent = '+';
      add.setAttribute('aria-label', `Add ${item.label} to the watchlist`);
      add.addEventListener('click', () => {
        addMarketRow(item.market);
        void applyForm().then(renderExplore);
      });
      li.append(add);
    }
    return li;
  }));
}

function fillForm(s: Settings): void {
  sourceSel.value = s.source;
  selectTab(s.explore);
  exploreBySel.value = s.exploreBy;
  exploreViewSel.value = s.exploreView;
  currencySel.value = s.currency;
  syncIntervalOptions(isPredictionSource(s.source) ? s.eventInterval : s.interval);
  marketList.dataset.kind = '';
  syncKind(s);
  candleWidthSel.value = s.candleWidth;
  syncExploreView();
  fontSel.value = s.font;
  textListBox.checked = s.textList;
  syncMarketControls();
  renderExplore();
  showIndexBox.checked = s.showIndex;
  manualOnlyBox.checked = s.manualOnly;
  lookUpBox.checked = s.lookUpUpdate;
  syncLookUpControls(s);
  refreshInput.disabled = s.manualOnly;
  refreshInput.value = formatDuration(s.refreshSec);
  alwaysOnBox.checked = s.alwaysOn;
  displayInput.disabled = s.alwaysOn;
  displayInput.value = formatDuration(s.displaySec);
  formError.textContent = '';
}

function readForm(): Settings {
  // The rows are one kind's list; the other kind's is kept as saved.
  const events = marketList.dataset.kind === 'events';
  const rows = [...marketList.children].map((li) => ({
    market: (events ? eventSlug : normalizeMarket)(li.querySelector<HTMLInputElement>('input[type=text]')!.value),
    charted: li.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked ?? false,
  })).filter((r) => r.market);
  // Exploring, the watchlist may be empty: it's kept as it was.
  const explore = tabExplore.getAttribute('aria-selected') === 'true';
  if (rows.length === 0 && !explore) throw new Error(events ? 'Add at least one event.' : 'Add at least one market.');
  const watchlist = rows.length ? rows : null;

  const manualOnly = manualOnlyBox.checked;
  const refreshSec = parseDuration(refreshInput.value, 'Refresh');
  const displaySec = parseDuration(displayInput.value, 'Show-for');
  const alwaysOn = alwaysOnBox.checked;
  if (!manualOnly && !alwaysOn && displaySec >= refreshSec) throw new Error('Show-for must be shorter than the refresh interval.');

  const next = sanitize({
    source: sourceSel.value,
    currency: currencySel.value as Currency,
    markets: events || !watchlist ? settings.markets : watchlist.map((r) => r.market),
    charts: events || !watchlist ? settings.charts : watchlist.filter((r) => r.charted).map((r) => r.market),
    interval: events ? settings.interval : Number(intervalSel.value),
    events: events && watchlist ? { ...settings.events, [sourceSel.value]: watchlist.map((r) => r.market) } : settings.events,
    eventCharts: events && watchlist ? { ...settings.eventCharts, [sourceSel.value]: watchlist.filter((r) => r.charted).map((r) => r.market) } : settings.eventCharts,
    eventInterval: events ? Number(intervalSel.value) : settings.eventInterval,
    explore,
    exploreBy: exploreBySel.value as ExploreBy,
    exploreView: exploreViewSel.value as ExploreView,
    candleWidth: candleWidthSel.value as CandleWidth,
    font: fontSel.value as ChartFont,
    textList: textListBox.checked,
    showIndex: showIndexBox.checked,
    manualOnly,
    lookUpUpdate: lookUpBox.checked,
    lookUpCal: settings.lookUpCal,
    refreshSec,
    displaySec,
    alwaysOn,
  });
  // Keep within the one-request-per-MIN_GAP_MS budget: an update has to finish its
  // requests before the next one is due.
  const src = events ? getPredictionSource(next.source) : getSource(next.source);
  const requests = events
    // Exploring: finding the events, then charting as many as fit.
    ? getPredictionSource(next.source).requestsPerUpdate(explore
      ? eventRequest(next, Array.from({ length: EXPLORE_COUNT }, (_, i) => String(i)))
      : eventRequest(next)) + (explore ? getPredictionSource(next.source).exploreRequests?.(next.exploreBy) ?? 1 : 0)
    // Exploring: ranking every market, then a line graph of each found (unless the list is text).
    : explore ? getSource(next.source).exploreRequests(next.exploreBy) + exploreCandles(next) : getSource(next.source).requestsPerUpdate(marketRequest(next));
  const minRefresh = Math.max(15, Math.ceil((requests * MIN_GAP_MS) / 1000));
  if (!manualOnly && refreshSec < minRefresh) {
    throw new Error(`Refresh must be at least ${formatDuration(minRefresh)} for ${requests} ${src.label} requests per update (one per ${MIN_GAP_MS / 1000}s).`);
  }
  return next;
}

/** Apply the form as soon as anything changes; no-op if the result is unchanged. */
async function applyForm(): Promise<void> {
  syncManualOnlyRows();
  syncKind();
  syncExploreView();
  syncIntervalOptions();
  syncMarketControls();
  let next: Settings;
  try {
    next = readForm();
  } catch (err) {
    formError.textContent = (err as Error).message;
    return;
  }
  formError.textContent = '';
  // Show the normalized values without rebuilding rows (which would steal focus).
  for (const li of marketList.children) {
    const text = li.querySelector<HTMLInputElement>('input[type=text]')!;
    if (text.value) text.value = marketList.dataset.kind === 'events' ? eventSlug(text.value) : normalizeMarket(text.value);
  }
  refreshInput.value = formatDuration(next.refreshSec);
  refreshInput.disabled = next.manualOnly;
  displayInput.disabled = next.alwaysOn;
  displayInput.value = formatDuration(next.displaySec);
  syncLookUpControls(next);

  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  const prev = settings;
  settings = next;
  renderExplore();
  await saveSettings(settings);
  syncLookUp();
  // Changes to what's charted, or how, show the new chart right away, like
  // Show now. Anything else (markets in the list, timings) waits for the
  // schedule, re-timed if the refresh rate changed.
  const chartChanged = next.source !== prev.source || next.currency !== prev.currency || next.interval !== prev.interval
    || next.candleWidth !== prev.candleWidth || shownCharts(next).join() !== shownCharts(prev).join()
    || next.showIndex !== prev.showIndex || next.textList !== prev.textList
    || JSON.stringify(next.events) !== JSON.stringify(prev.events) || JSON.stringify(next.eventCharts) !== JSON.stringify(prev.eventCharts)
    || next.eventInterval !== prev.eventInterval
    || next.explore !== prev.explore || next.exploreBy !== prev.exploreBy || next.exploreView !== prev.exploreView;
  if (chartChanged) restartSchedule({ cancel: true, manual: true });
  // A new font needs no new data: redraw the last, sparing the APIs (CoinGecko
  // drops the index when asked too often). Without data to reuse, this fetches.
  else if (next.font !== prev.font) void update({ cancel: true, manual: true, reuse: true });
  // Leaving manual-only: fetch in the background now and start the schedule.
  else if (prev.manualOnly && !next.manualOnly) restartSchedule();
  else scheduleAt(nextAt - prev.refreshSec * 1000 + next.refreshSec * 1000);

  // Turning always-on on puts a chart up if the display is dark; turning it
  // off lets the one showing come down after the usual show-for time.
  if (next.alwaysOn !== prev.alwaysOn) {
    setShowing(showing);
    if (next.alwaysOn) {
      clearTimeout(hideTimer);
      if (!showing && !chartChanged) void update({ manual: true });
    } else if (showing && !loading) {
      hideTimer = setTimeout(hideUnlessAlwaysOn, next.displaySec * 1000);
    }
  }
}

// `change` fires immediately for checkboxes and selects, and on blur/Enter for text.
form.addEventListener('change', () => void applyForm());
// Above Show now, outside the form.
alwaysOnBox.addEventListener('change', () => void applyForm());
form.addEventListener('submit', (e) => {
  e.preventDefault();
  void applyForm();
});

$('reset').addEventListener('click', () => {
  fillForm(DEFAULT_SETTINGS);
  void applyForm();
});
// Toggles: fetch fresh data and show it, or take the current chart down early.
showNowBtn.addEventListener('click', toggleChart);

/** Show now / Hide now, from the button or a tap on the glasses. */
function toggleChart(): void {
  if (showing && !settings.alwaysOn) {
    if (loading) inFlight?.abort(); // Dismissed before the chart arrived.
    void hide();
  } else {
    restartSchedule({ manual: true });
  }
}

function parseDuration(raw: string, label: string): number {
  const m = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr)?$/);
  if (!m) throw new Error(`${label}: enter a duration like 30s, 2m or 1h.`);
  const mult = { s: 1, sec: 1, m: 60, min: 60, h: 3600, hr: 3600 }[m[2] ?? 's']!;
  return Math.round(Number(m[1]) * mult);
}

function formatDuration(sec: number): string {
  if (sec >= 3600 && sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec >= 60 && sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}

// ── Look up to update ───────────────────────────────────────────────────

let lookUpDetector: LookUpDetector | null = null;
/** Readings being collected for calibration; null when not calibrating. */
let calibrationSamples: Vec[] | null = null;
let imuOn = false;

function onImuReading(v: Vec): void {
  if (calibrationSamples) calibrationSamples.push(v);
  else lookUpDetector?.push(v);
}

/** Look-up only applies in manual-only mode, once calibrated. */
function lookUpActive(s: Settings): boolean {
  return s.manualOnly && s.lookUpUpdate && s.lookUpCal !== null;
}

/**
 * Run the motion sensor only while something needs it (look-up in use, or
 * calibrating), since streaming readings costs battery on both devices.
 */
function syncLookUp(): void {
  lookUpDetector = lookUpActive(settings)
    ? new LookUpDetector(settings.lookUpCal!, () => {
      // Like a tap while dark; ignored while a chart (or loading) is up.
      if (!showing) restartSchedule({ manual: true });
    })
    : null;
  const want = glasses !== null && !exited && (lookUpDetector !== null || calibrationSamples !== null);
  if (want === imuOn) return;
  imuOn = want;
  glasses?.setImu(want).catch((e) => {
    imuOn = !want;
    lookUpStatus.textContent = (e as Error).message;
  });
}

/** The look-up settings only apply to manual-only, so they show only while it's ticked. */
function syncManualOnlyRows(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-manual-only]')) el.hidden = !manualOnlyBox.checked;
}

function syncLookUpControls(s: Settings): void {
  syncManualOnlyRows();
  lookUpBox.disabled = !s.manualOnly;
  calibrateBtn.disabled = !glasses || calibrationSamples !== null;
  if (calibrationSamples) return; // Calibration is writing its own status.
  lookUpStatus.textContent = !glasses
    ? 'Connect the glasses to calibrate'
    : s.lookUpCal ? 'Calibrated' : 'Not calibrated: press Calibrate first';
}

/** Collect motion-sensor readings for `ms` while `prompt` is on the glasses. */
async function collect(prompt: string, settleMs: number, ms: number): Promise<Vec[]> {
  lookUpStatus.textContent = prompt;
  await glasses!.message(prompt);
  await new Promise((r) => setTimeout(r, settleMs));
  calibrationSamples = [];
  await new Promise((r) => setTimeout(r, ms));
  const samples = calibrationSamples;
  calibrationSamples = [];
  return samples;
}

calibrateBtn.addEventListener('click', async () => {
  if (!glasses || calibrationSamples) return;
  clearTimeout(hideTimer);
  setShowing(true);
  calibrationSamples = [];
  syncLookUpControls(settings);
  syncLookUp();
  let result: ReturnType<typeof calibrate>;
  try {
    const level = await collect('Look straight ahead', 2000, 2000);
    const up = await collect('Now look up', 2000, 2000);
    result = calibrate(level, up);
  } catch (e) {
    result = (e as Error).message;
  }
  calibrationSamples = null;
  if (typeof result === 'string') {
    await glasses.message('Calibration failed').catch(() => {});
  } else {
    settings = { ...settings, lookUpCal: result };
    await saveSettings(settings);
    await glasses.message('Calibrated').catch(() => {});
  }
  syncLookUp();
  syncLookUpControls(settings);
  if (typeof result === 'string') lookUpStatus.textContent = result;
  hideTimer = setTimeout(hide, 1500);
});

// ── Upload speed test ───────────────────────────────────────────────────

// Development only: a packaged build drops the Diagnostics section, and this
// code (with src/speedtest.ts) is left out of the bundle.
const speedTestBtn = $<HTMLButtonElement>('speed-test');
const speedResults = $<HTMLTableElement>('speed-results');

if (!DIAGNOSTICS) document.querySelectorAll('[data-dev-only]').forEach((el) => el.remove());

/** Draw image screens at SUPERSAMPLE× and scale them down, to judge on the glasses whether that reads better. */
const SUPERSAMPLE = 8;
let supersample = false;
/** Scale down by halves, so each step averages every pixel rather than sampling some. */
let halving = false;
const supersampleBox = $<HTMLInputElement>('supersample');
const halvingBox = $<HTMLInputElement>('supersample-halving');

function renderSupersampled(ctx: CanvasRenderingContext2D, model: ScreenModel): number {
  let big = document.createElement('canvas');
  big.width = SCREEN_W * SUPERSAMPLE;
  big.height = SCREEN_H * SUPERSAMPLE;
  const bctx = big.getContext('2d')!;
  bctx.scale(SUPERSAMPLE, SUPERSAMPLE);
  const axisW = renderScreen(bctx, model);
  for (let scale = SUPERSAMPLE / 2; halving && scale > 1; scale /= 2) {
    const half = document.createElement('canvas');
    half.width = SCREEN_W * scale;
    half.height = SCREEN_H * scale;
    const hctx = half.getContext('2d')!;
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(big, 0, 0, half.width, half.height);
    big = half;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.drawImage(big, 0, 0, SCREEN_W, SCREEN_H);
  return axisW;
}

if (DIAGNOSTICS) supersampleBox.addEventListener('change', (e) => {
  // Not a setting: keep it from the form's change handler.
  e.stopPropagation();
  supersample = supersampleBox.checked;
  halvingBox.disabled = !supersample;
  // Same data, redrawn, like a font change.
  void update({ cancel: true, manual: true, reuse: true });
});

if (DIAGNOSTICS) halvingBox.addEventListener('change', (e) => {
  e.stopPropagation();
  halving = halvingBox.checked;
  if (supersample) void update({ cancel: true, manual: true, reuse: true });
});

if (DIAGNOSTICS) speedTestBtn.addEventListener('click', async () => {
  if (!glasses) return;
  speedTestBtn.disabled = true;
  clearTimeout(hideTimer);
  setShowing(true);
  try {
    const { runSpeedTest } = await import('./speedtest');
    const results = await runSpeedTest(glasses, (done, total) => {
      speedTestBtn.textContent = `Testing ${done + 1}/${total}…`;
    });
    console.info('Upload speed test', JSON.stringify(results));
    speedResults.replaceChildren(...results.map((r) => {
      const tr = document.createElement('tr');
      const ms = r.ms === null ? 'rejected' : `${Math.round(r.ms)} ms${r.ok < r.tries ? ` (${r.tries - r.ok} rejected)` : ''}`;
      for (const text of [r.label, formatBytes(r.bytes), ms]) tr.insertCell().textContent = text;
      return tr;
    }));
  } catch (e) {
    speedResults.replaceChildren();
    speedResults.insertRow().insertCell().textContent = `Failed: ${(e as Error).message}`;
  }
  speedTestBtn.textContent = 'Test upload speed';
  speedTestBtn.disabled = false;
  void hide();
});

// ── Boot ────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  drawPlaceholder('Loading…');
  setStatus('Connecting to glasses…');
  glasses = await Glasses.connect();
  if (DIAGNOSTICS && glasses) tapBridge();
  if (DIAGNOSTICS) speedTestBtn.disabled = !glasses;
  // Tap while the chart is up dismisses it (always on: refreshes it); tap while dark pulls a fresh one.
  glasses?.onTap(toggleChart);
  // Even Hub's exit gesture on the root page: the glasses ask to confirm.
  glasses?.onDoubleTap(() => void glasses!.exit().catch(() => {}));
  glasses?.onImu(onImuReading);
  glasses?.onExit(stop);
  settings = await loadSettings();
  void loadFont(settings.font).catch(() => {});
  fillForm(settings);
  setShowing(showing); // Label the button for the saved settings.
  // The motion sensor only starts once the glasses have a page, and in
  // manual-only mode nothing else puts one up until the first chart.
  await glasses?.blank().catch((e) => setStatus(`Glasses error: ${(e as Error).message}`));
  syncLookUp();
  if (settings.manualOnly) {
    drawPlaceholder('Press Show now');
    setStatus(glasses ? 'Glasses connected' : 'Browser preview (glasses not connected)');
  }
  // The first chart is fetched now, with the loading screen up, as if asked
  // for; in manual-only mode nothing is fetched until it is.
  restartSchedule({ manual: !settings.manualOnly });
}

/**
 * The app was closed on the glasses. The host may keep this WebView running
 * for a while, so stop everything: a timer that fired later would create a
 * page on glasses that have moved on, leaving them blank and the Even app
 * stuck. A relaunch loads the app afresh.
 */
function stop(): void {
  exited = true;
  inFlight?.abort();
  inFlight = null;
  clearTimeout(nextTimer);
  clearTimeout(hideTimer);
  notDue();
  setShowing(false);
  loading = false;
  nextAt = 0;
  syncCountdown();
  setStatus('Closed on the glasses');
  // The motion sensor must not be left running once the app is gone.
  if (imuOn) glasses!.setImu(false).catch(() => {});
  imuOn = false;
  lookUpDetector = null;
}

/** Message on the phone preview before there's a chart to show. */
function drawPlaceholder(text: string): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.fillStyle = '#a0a0a0';
  ctx.font = '20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, SCREEN_W / 2, SCREEN_H / 2);
}

void boot();

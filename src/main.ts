import './style.css';
import LOGO_SVG from '../assets/icon.svg?raw';
import { candleCapacity, DEFAULT_AXIS_W, renderScreen, SCREEN_H, SCREEN_W, type ScreenModel } from './chart';
import { FONTS, loadFont } from './fonts';
import { Glasses, type UploadStats } from './glasses';
import { calibrate, LookUpDetector, type Vec } from './lookup';
import { encodeTiles } from './png';
import { buildLoadingList, buildTextChart, buildTextList, drawTextChart, serializeBox, textCandles, type TextBox } from './textchart';
import { average, isAbort, MIN_GAP_MS } from './sources/http';
import { CURRENCIES, type Currency } from './sources/symbols';
import { getSource, SOURCES } from './sources';
import { estimateIndexMs, fetchIndexPrices } from './sources/coingecko';
import type { MarketData, MarketRequest } from './sources/types';
import {
  CANDLE_WIDTHS,
  CHART_FONTS,
  DEFAULT_SETTINGS,
  formatInterval,
  isTextWidth,
  MAX_MARKETS,
  maxCharts,
  nearestInterval,
  normalizeMarket,
  sanitize,
  type CandleWidth,
  type ChartFont,
  type Settings,
} from './settings';

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
  return JSON.stringify([s.source, marketRequest(s), indexMarkets(s)]);
}

/** The last update's data, if it was fetched for what `s` would fetch. */
function reusable(s: Settings): MarketData[] | null {
  return lastFetch?.key === fetchKey(s) ? lastFetch.data : null;
}

/** When the update in progress should have its chart up (ms), for the loading estimate. */
let inFlightEta = 0;

/** Fetch, draw, show on the glasses, then blank them after `displaySec`. */
async function update({ cancel = false, manual = false, showAt = 0, reuse = false }: UpdateOptions = {}): Promise<void> {
  // An update in progress is left to finish unless cancelled; its chart will replace the loading screen.
  const joining = inFlight !== null && !cancel;
  if (!joining) {
    inFlight?.abort();
    // Redrawing the last data skips the fetch, and its list is complete from the start.
    const cached = reuse ? reusable(settings) : null;
    inFlightEta = Math.max(Date.now() + (cached ? drawMs + (glasses ? uploadMs : 0) : estimateUpdateMs()), showAt);
    progress = cached ?? [];
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
  const left = 1 - progress.length / Math.max(1, settings.markets.length);
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
  return settings.markets.map((m) => progress.find((d) => d.market === m) ?? { market: m, candles: [] });
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
    topRight: getSource(settings.source).label,
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
  const s = settings;
  const key = fetchKey(s);
  let data: MarketData[], updated: Date;
  if (reuse && lastFetch?.key === key) {
    ({ data, updated } = lastFetch);
  } else {
    showFetching();
    try {
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
      data = markets.map((d) => ({ ...d, index: wanted.includes(d.market) ? index.get(d.market) ?? null : undefined }));
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
  const shown = shownCharts(s);
  const charts = shown.map((m) => byMarket.get(m)!);
  const ticker = s.markets.filter((m) => !shown.includes(m)).map((m) => byMarket.get(m)!);
  const source = getSource(s.source).label;
  // Text candles draw the one chart in the glasses' font, and the text list
  // the market list; otherwise the screen goes as image tiles.
  let textBoxes: TextBox[] | null = null;
  if (isTextWidth(s.candleWidth) && charts.length === 1) {
    textBoxes = buildTextChart({ chart: charts[0]!, width: s.candleWidth, ticker, interval: s.interval, updated, source, name: APP_NAME });
  } else if (s.textList) {
    textBoxes = buildTextList({ items: ticker, updated, source, name: APP_NAME });
  }
  if (textBoxes) {
    drawTextChart(ctx, textBoxes);
  } else {
    const model = { charts, ticker, interval: s.interval, candleWidth: s.candleWidth, updated, source, font: s.font };
    lastAxisW = import.meta.env.DEV && supersample ? renderSupersampled(ctx, model) : renderScreen(ctx, model);
  }
  refreshWidthLabels();
  // Drawn, so it goes up as soon as it's due (or now, if late) without a loading screen.
  notDue();

  const failed = data.filter((d) => d.error).map((d) => `${d.market}: ${d.error}`);
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
  if (!glasses) return;
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
  nextAt = settings.manualOnly ? 0 : at;
  syncCountdown();
  if (settings.manualOnly) return;
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
  if (!import.meta.env.DEV) return;
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
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

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

for (const src of SOURCES) sourceSel.add(new Option(src.label, src.id));
for (const c of CURRENCIES) currencySel.add(new Option(c, c));
const CANDLE_WIDTH_LABELS: Record<CandleWidth, string> = { wide: 'Wide', narrow: 'Narrow', thin: 'Thin', 'text-blocks': 'Text blocks, 1 chart', 'text-wide': 'Text wide, 1 chart', 'text-narrow': 'Text narrow, 1 chart', 'text-thin': 'Text thin, 1 chart' };
for (const w of CANDLE_WIDTHS) candleWidthSel.add(new Option(CANDLE_WIDTH_LABELS[w], w));
for (const f of CHART_FONTS) fontSel.add(new Option(FONTS[f].label, f));
let lastAxisW = DEFAULT_AXIS_W;

/** Label each width with the time span it covers, e.g. "Thin · ~14h", for the form's current candle size and chart count. */
function refreshWidthLabels(): void {
  const nCharts = marketList.querySelectorAll('input[type=checkbox]:checked').length;
  const minutes = Number(intervalSel.value);
  for (const opt of candleWidthSel.options) {
    const w = opt.value as CandleWidth;
    opt.text = `${CANDLE_WIDTH_LABELS[w]} · ~${formatSpan(capacity(nCharts, w) * minutes)}`;
  }
}

/** Offer the selected source's candle sizes, keeping the current size or the nearest one. */
function syncIntervalOptions(current = Number(intervalSel.value) || settings.interval): void {
  const supported = getSource(sourceSel.value).intervals;
  const shown = [...intervalSel.options].map((o) => Number(o.value));
  if (shown.join() !== supported.join()) {
    intervalSel.replaceChildren(...supported.map((m) => new Option(formatInterval(m), String(m))));
  }
  intervalSel.value = String(nearestInterval(supported, current));
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
  li.innerHTML = `
    <input type="text" placeholder="e.g. SOL-USDC, or TSLA" spellcheck="false" autocapitalize="characters" />
    <label><input type="checkbox" /> Chart</label>
    <button type="button" class="secondary" aria-label="Remove">✕</button>`;
  const [text, check] = li.querySelectorAll('input');
  text!.value = market;
  check!.checked = charted;
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
  const checks = rows.map((li) => li.querySelector<HTMLInputElement>('input[type=checkbox]')!);
  const max = maxCharts(candleWidthSel.value as CandleWidth);
  // A width that allows fewer charts keeps the first ones ticked.
  checks.filter((c) => c.checked).slice(max).forEach((c) => { c.checked = false; });
  const nChecked = checks.filter((c) => c.checked).length;
  // The text list takes precedence over charts: their ticks are kept but greyed out.
  for (const c of checks) c.disabled = textListBox.checked || (!c.checked && nChecked >= max);
  addMarketBtn.disabled = rows.length >= MAX_MARKETS;
  refreshWidthLabels();
}

addMarketBtn.addEventListener('click', () => {
  addMarketRow();
  marketList.querySelector<HTMLInputElement>('li:last-child input[type=text]')!.focus();
});

function fillForm(s: Settings): void {
  sourceSel.value = s.source;
  currencySel.value = s.currency;
  syncIntervalOptions(s.interval);
  marketList.replaceChildren();
  for (const m of s.markets) addMarketRow(m, s.charts.includes(m));
  candleWidthSel.value = s.candleWidth;
  fontSel.value = s.font;
  textListBox.checked = s.textList;
  syncMarketControls();
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
  const rows = [...marketList.children].map((li) => ({
    market: normalizeMarket(li.querySelector<HTMLInputElement>('input[type=text]')!.value),
    charted: li.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked,
  })).filter((r) => r.market);
  if (rows.length === 0) throw new Error('Add at least one market.');

  const manualOnly = manualOnlyBox.checked;
  const refreshSec = parseDuration(refreshInput.value, 'Refresh');
  const displaySec = parseDuration(displayInput.value, 'Show-for');
  const alwaysOn = alwaysOnBox.checked;
  if (!manualOnly && !alwaysOn && displaySec >= refreshSec) throw new Error('Show-for must be shorter than the refresh interval.');

  const next = sanitize({
    source: sourceSel.value,
    currency: currencySel.value as Currency,
    markets: rows.map((r) => r.market),
    charts: rows.filter((r) => r.charted).map((r) => r.market),
    interval: Number(intervalSel.value),
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
  const src = getSource(next.source);
  const requests = src.requestsPerUpdate(marketRequest(next));
  const minRefresh = Math.max(15, Math.ceil((requests * MIN_GAP_MS) / 1000));
  if (!manualOnly && refreshSec < minRefresh) {
    throw new Error(`Refresh must be at least ${formatDuration(minRefresh)} for ${requests} ${src.label} requests per update (one per ${MIN_GAP_MS / 1000}s).`);
  }
  return next;
}

/** Apply the form as soon as anything changes; no-op if the result is unchanged. */
async function applyForm(): Promise<void> {
  syncManualOnlyRows();
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
    if (text.value) text.value = normalizeMarket(text.value);
  }
  refreshInput.value = formatDuration(next.refreshSec);
  refreshInput.disabled = next.manualOnly;
  displayInput.disabled = next.alwaysOn;
  displayInput.value = formatDuration(next.displaySec);
  syncLookUpControls(next);

  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  const prev = settings;
  settings = next;
  await saveSettings(settings);
  syncLookUp();
  // Changes to what's charted, or how, show the new chart right away, like
  // Show now. Anything else (markets in the list, timings) waits for the
  // schedule, re-timed if the refresh rate changed.
  const chartChanged = next.source !== prev.source || next.currency !== prev.currency || next.interval !== prev.interval
    || next.candleWidth !== prev.candleWidth || shownCharts(next).join() !== shownCharts(prev).join()
    || next.showIndex !== prev.showIndex || next.textList !== prev.textList;
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
  const want = glasses !== null && (lookUpDetector !== null || calibrationSamples !== null);
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

if (!import.meta.env.DEV) document.querySelectorAll('[data-dev-only]').forEach((el) => el.remove());

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

if (import.meta.env.DEV) supersampleBox.addEventListener('change', (e) => {
  // Not a setting: keep it from the form's change handler.
  e.stopPropagation();
  supersample = supersampleBox.checked;
  halvingBox.disabled = !supersample;
  // Same data, redrawn, like a font change.
  void update({ cancel: true, manual: true, reuse: true });
});

if (import.meta.env.DEV) halvingBox.addEventListener('change', (e) => {
  e.stopPropagation();
  halving = halvingBox.checked;
  if (supersample) void update({ cancel: true, manual: true, reuse: true });
});

if (import.meta.env.DEV) speedTestBtn.addEventListener('click', async () => {
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
  if (import.meta.env.DEV) speedTestBtn.disabled = !glasses;
  // Tap while the chart is up dismisses it (always on: refreshes it); tap while dark pulls a fresh one.
  glasses?.onTap(toggleChart);
  // Even Hub's exit gesture on the root page: the glasses ask to confirm.
  glasses?.onDoubleTap(() => void glasses!.exit().catch(() => {}));
  glasses?.onImu(onImuReading);
  // The motion sensor must not be left running on the glasses once the app is gone.
  glasses?.onExit(() => {
    imuOn = false;
    glasses!.setImu(false).catch(() => {});
  });
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

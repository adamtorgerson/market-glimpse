import './style.css';
import { candleCapacity, DEFAULT_AXIS_W, renderScreen, SCREEN_H, SCREEN_W } from './chart';
import { Glasses } from './glasses';
import { encodeTiles } from './png';
import { average, MIN_GAP_MS } from './sources/http';
import { getSource, SOURCES } from './sources';
import { estimateIndexMs, fetchIndexPrices } from './sources/coingecko';
import type { MarketRequest } from './sources/types';
import {
  CANDLE_WIDTHS,
  DEFAULT_SETTINGS,
  formatInterval,
  MAX_CHARTS,
  MAX_MARKETS,
  nearestInterval,
  normalizeMarket,
  sanitize,
  type CandleWidth,
  type Settings,
} from './settings';

const STORAGE_KEY = 'kraken-candles.settings';
// Largest image container the glasses accept.
const TILE_W = 288;
const TILE_H = 144;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('screen');
const statusEl = $('status');
const scheduleEl = $('schedule');
const showNowBtn = $<HTMLButtonElement>('show-now');

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
  showNowBtn.textContent = v ? 'Hide now' : 'Show now';
}
let inFlight: AbortController | null = null;

function marketRequest(s: Settings): MarketRequest {
  return {
    markets: s.markets,
    charts: s.charts,
    interval: s.interval,
    candles: candleCapacity(s.charts.length, s.candleWidth, lastAxisW),
  };
}

interface UpdateOptions {
  /** Drop an update already in progress (e.g. the settings changed); otherwise it's left to finish. */
  cancel?: boolean;
  /** Asked for by the user: show "Loading…" on the glasses while fetching. */
  manual?: boolean;
  /** Don't put the chart up before this time (ms), so scheduled charts appear on time. */
  showAt?: number;
}

/** When the update in progress should have its chart up (ms), for the loading estimate. */
let inFlightEta = 0;

/** Fetch, draw, show on the glasses, then blank them after `displaySec`. */
async function update({ cancel = false, manual = false, showAt = 0 }: UpdateOptions = {}): Promise<void> {
  // An update in progress is left to finish unless cancelled; its chart will replace the loading screen.
  const joining = inFlight !== null && !cancel;
  if (!joining) {
    inFlight?.abort();
    inFlightEta = Math.max(Date.now() + estimateUpdateMs(), showAt);
  }
  if (manual) showLoading(Math.max(1, Math.round((inFlightEta - Date.now()) / 1000)));
  if (joining) return;
  const ctrl = (inFlight = new AbortController());
  try {
    await runUpdate(ctrl, showAt);
  } finally {
    if (inFlight === ctrl) inFlight = null;
  }
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
    estimateIndexMs(settings.charts),
  );
  return fetchMs + drawMs + (glasses ? uploadMs : 0);
}

/** True while "Loading…" is on the glasses. */
let loading = false;

function showLoading(etaSec: number): void {
  if (!glasses) return;
  clearTimeout(hideTimer);
  setShowing(true);
  loading = true;
  glasses.loading(`Loading… ~${etaSec}s`).catch((e) => setStatus(`Glasses error: ${(e as Error).message}`));
}

async function runUpdate(ctrl: AbortController, showAt: number): Promise<void> {
  const s = settings;
  setStatus('Fetching…');

  let data;
  try {
    // Different APIs, so these run side by side; each keeps its own rate limit.
    const [markets, index] = await Promise.all([
      getSource(s.source).fetch(marketRequest(s), ctrl.signal),
      fetchIndexPrices(s.charts, ctrl.signal),
    ]);
    data = markets.map((d) => ({ ...d, index: index.get(d.market) }));
  } catch {
    return; // superseded by a newer update
  }
  if (ctrl.signal.aborted) return;

  const drawStart = Date.now();
  const byMarket = new Map(data.map((d) => [d.market, d]));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  lastAxisW = renderScreen(ctx, {
    charts: s.charts.map((m) => byMarket.get(m)!),
    ticker: s.markets.filter((m) => !s.charts.includes(m)).map((m) => byMarket.get(m)!),
    interval: s.interval,
    candleWidth: s.candleWidth,
    updated: new Date(),
    source: getSource(s.source).label,
  });
  refreshWidthLabels();

  const failed = data.filter((d) => d.error).map((d) => `${d.market}: ${d.error}`);
  const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (!glasses) {
    setStatus(`Browser preview (glasses not connected) · updated ${stamp}`, failed);
    return;
  }

  try {
    const tiles = encodeTiles(canvas, TILE_W, TILE_H);
    drawMs = average(drawMs, Date.now() - drawStart);
    if (showAt > Date.now()) {
      await new Promise((r) => setTimeout(r, showAt - Date.now()));
      if (ctrl.signal.aborted) return;
    }
    clearTimeout(hideTimer);
    const wasLoading = loading;
    loading = false;
    const uploadStart = Date.now();
    await glasses.show(tiles, wasLoading);
    uploadMs = average(uploadMs, Date.now() - uploadStart);
    if (ctrl.signal.aborted) return;
    setShowing(true);
    setStatus(`Showing on glasses · updated ${stamp}`, failed);
    hideTimer = setTimeout(hide, s.displaySec * 1000);
  } catch (e) {
    setStatus(`Glasses error: ${(e as Error).message}`, failed);
    hide();
  }
}

async function hide(): Promise<void> {
  clearTimeout(hideTimer);
  setShowing(false);
  loading = false;
  if (!glasses) return;
  try {
    await glasses.blank();
    setStatus(statusEl.textContent!.replace('Showing on glasses', 'Display off'));
  } catch (e) {
    setStatus(`Glasses error: ${(e as Error).message}`);
  }
}

/**
 * Run an update now and re-anchor the refresh schedule to it. Scheduled
 * updates start fetching early, by their estimated duration plus a second of
 * slack, so the finished chart goes up on time with no loading screen.
 */
function restartSchedule(opts: UpdateOptions = {}): void {
  void update(opts);
  scheduleAt(Date.now() + settings.refreshSec * 1000);
}

/** Schedule the next chart for `at` (ms), and the ones after it every `refreshSec`. */
function scheduleAt(at: number): void {
  clearTimeout(nextTimer);
  nextAt = at;
  const leadMs = estimateUpdateMs() + 1000;
  nextTimer = setTimeout(() => {
    void update({ showAt: at });
    scheduleAt(at + settings.refreshSec * 1000);
  }, Math.max(0, at - leadMs - Date.now()));
}

function setStatus(text: string, errors: string[] = []): void {
  statusEl.textContent = text;
  if (errors.length) statusEl.textContent += ` · ${errors.join('; ')}`;
}

setInterval(() => {
  const secs = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
  scheduleEl.textContent = nextAt
    ? `Next update in ${formatDuration(secs)} · every ${formatDuration(settings.refreshSec)}, shown for ${formatDuration(settings.displaySec)}`
    : '';
}, 1000);

// ── Settings form ───────────────────────────────────────────────────────

const form = $<HTMLFormElement>('settings');
const sourceSel = $<HTMLSelectElement>('source');
const marketList = $<HTMLUListElement>('markets');
const addMarketBtn = $<HTMLButtonElement>('add-market');
const intervalSel = $<HTMLSelectElement>('interval');
const candleWidthSel = $<HTMLSelectElement>('candle-width');
const refreshInput = $<HTMLInputElement>('refresh');
const displayInput = $<HTMLInputElement>('display');
const formError = $('form-error');

for (const src of SOURCES) sourceSel.add(new Option(src.label, src.id));
const CANDLE_WIDTH_LABELS: Record<CandleWidth, string> = { wide: 'Wide', narrow: 'Narrow', thin: 'Thin' };
for (const w of CANDLE_WIDTHS) candleWidthSel.add(new Option(CANDLE_WIDTH_LABELS[w], w));
let lastAxisW = DEFAULT_AXIS_W;

/** Label each width with the time span it covers, e.g. "Thin · ~14h", for the form's current candle size and chart count. */
function refreshWidthLabels(): void {
  const nCharts = marketList.querySelectorAll('input[type=checkbox]:checked').length;
  const minutes = Number(intervalSel.value);
  for (const opt of candleWidthSel.options) {
    const w = opt.value as CandleWidth;
    opt.text = `${CANDLE_WIDTH_LABELS[w]} · ~${formatSpan(candleCapacity(nCharts, w, lastAxisW) * minutes)}`;
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
    <input type="text" placeholder="e.g. SOL-USDC" spellcheck="false" autocapitalize="characters" />
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
  const nChecked = checks.filter((c) => c.checked).length;
  for (const c of checks) c.disabled = !c.checked && nChecked >= MAX_CHARTS;
  addMarketBtn.disabled = rows.length >= MAX_MARKETS;
  refreshWidthLabels();
}

addMarketBtn.addEventListener('click', () => {
  addMarketRow();
  marketList.querySelector<HTMLInputElement>('li:last-child input[type=text]')!.focus();
});

function fillForm(s: Settings): void {
  sourceSel.value = s.source;
  syncIntervalOptions(s.interval);
  marketList.replaceChildren();
  for (const m of s.markets) addMarketRow(m, s.charts.includes(m));
  candleWidthSel.value = s.candleWidth;
  refreshWidthLabels();
  refreshInput.value = formatDuration(s.refreshSec);
  displayInput.value = formatDuration(s.displaySec);
  formError.textContent = '';
}

function readForm(): Settings {
  const rows = [...marketList.children].map((li) => ({
    market: normalizeMarket(li.querySelector<HTMLInputElement>('input[type=text]')!.value),
    charted: li.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked,
  })).filter((r) => r.market);
  if (rows.length === 0) throw new Error('Add at least one market.');

  const refreshSec = parseDuration(refreshInput.value, 'Refresh');
  const displaySec = parseDuration(displayInput.value, 'Show-for');
  if (displaySec >= refreshSec) throw new Error('Show-for must be shorter than the refresh interval.');

  const next = sanitize({
    source: sourceSel.value,
    markets: rows.map((r) => r.market),
    charts: rows.filter((r) => r.charted).map((r) => r.market),
    interval: Number(intervalSel.value),
    candleWidth: candleWidthSel.value as CandleWidth,
    refreshSec,
    displaySec,
  });
  // Keep within the one-request-per-MIN_GAP_MS budget: an update has to finish its
  // requests before the next one is due.
  const src = getSource(next.source);
  const minRefresh = Math.max(15, Math.ceil((src.requestsPerUpdate(marketRequest(next)) * MIN_GAP_MS) / 1000));
  if (refreshSec < minRefresh) {
    throw new Error(`Refresh must be at least ${formatDuration(minRefresh)} for ${next.charts.length} chart(s) (one ${src.label} request per ${MIN_GAP_MS / 1000}s).`);
  }
  return next;
}

/** Apply the form as soon as anything changes; no-op if the result is unchanged. */
async function applyForm(): Promise<void> {
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
  displayInput.value = formatDuration(next.displaySec);

  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  const prev = settings;
  settings = next;
  await saveSettings(settings);
  // Changes to what's charted, or how, show the new chart right away, like
  // Show now. Anything else (markets in the list, timings) waits for the
  // schedule, re-timed if the refresh rate changed.
  const chartChanged = next.source !== prev.source || next.interval !== prev.interval
    || next.candleWidth !== prev.candleWidth || next.charts.join() !== prev.charts.join();
  if (chartChanged) restartSchedule({ cancel: true, manual: true });
  else scheduleAt(nextAt - prev.refreshSec * 1000 + next.refreshSec * 1000);
}

// `change` fires immediately for checkboxes and selects, and on blur/Enter for text.
form.addEventListener('change', () => void applyForm());
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
  if (showing) {
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

// ── Boot ────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.fillStyle = '#a0a0a0';
  ctx.font = '20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Loading…', SCREEN_W / 2, SCREEN_H / 2);
  setStatus('Connecting to glasses…');
  glasses = await Glasses.connect();
  // Tap while the chart is up dismisses it; tap while dark pulls a fresh one.
  glasses?.onTap(toggleChart);
  settings = await loadSettings();
  fillForm(settings);
  restartSchedule();
}

void boot();

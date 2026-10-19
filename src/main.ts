import './style.css';
import { candleCapacity, DEFAULT_AXIS_W, renderScreen, SCREEN_H, SCREEN_W } from './chart';
import { Glasses } from './glasses';
import { fetchAll } from './kraken';
import { encodeTiles } from './png';
import {
  CANDLE_WIDTHS,
  DEFAULT_SETTINGS,
  formatInterval,
  KRAKEN_INTERVALS,
  MAX_CHARTS,
  MAX_MARKETS,
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

/** Fetch, draw, show on the glasses, then blank them after `displaySec`. */
async function update(): Promise<void> {
  inFlight?.abort();
  const ctrl = (inFlight = new AbortController());
  const s = settings;
  setStatus('Fetching…');
  if (glasses) {
    clearTimeout(hideTimer);
    glasses.loading().catch((e) => setStatus(`Glasses error: ${(e as Error).message}`));
  }

  let data;
  try {
    data = await fetchAll(s.markets, s.interval, ctrl.signal);
  } catch {
    return; // superseded by a newer update
  }
  if (ctrl.signal.aborted) return;

  const byMarket = new Map(data.map((d) => [d.market, d]));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  lastAxisW = renderScreen(ctx, {
    charts: s.charts.map((m) => byMarket.get(m)!),
    ticker: s.markets.filter((m) => !s.charts.includes(m)).map((m) => byMarket.get(m)!),
    interval: s.interval,
    candleWidth: s.candleWidth,
    updated: new Date(),
  });
  refreshWidthLabels();

  const failed = data.filter((d) => d.error).map((d) => `${d.market}: ${d.error}`);
  const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (!glasses) {
    setStatus(`Browser preview (glasses not connected) · updated ${stamp}`, failed);
    return;
  }

  try {
    clearTimeout(hideTimer);
    await glasses.show(encodeTiles(canvas, TILE_W, TILE_H));
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
  if (!glasses) return;
  try {
    await glasses.blank();
    setStatus(statusEl.textContent!.replace('Showing on glasses', 'Display off'));
  } catch (e) {
    setStatus(`Glasses error: ${(e as Error).message}`);
  }
}

/** Run an update now and re-anchor the refresh schedule to it. */
function restartSchedule(): void {
  clearTimeout(nextTimer);
  const tick = () => {
    nextAt = Date.now() + settings.refreshSec * 1000;
    nextTimer = setTimeout(tick, settings.refreshSec * 1000);
    void update();
  };
  tick();
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
const marketList = $<HTMLUListElement>('markets');
const addMarketBtn = $<HTMLButtonElement>('add-market');
const intervalSel = $<HTMLSelectElement>('interval');
const candleWidthSel = $<HTMLSelectElement>('candle-width');
const refreshInput = $<HTMLInputElement>('refresh');
const displayInput = $<HTMLInputElement>('display');
const formError = $('form-error');

for (const m of KRAKEN_INTERVALS) intervalSel.add(new Option(formatInterval(m), String(m)));
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
  marketList.replaceChildren();
  for (const m of s.markets) addMarketRow(m, s.charts.includes(m));
  intervalSel.value = String(s.interval);
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
  if (refreshSec < 15) throw new Error('Refresh must be at least 15s (Kraken rate limits).');
  if (displaySec >= refreshSec) throw new Error('Show-for must be shorter than the refresh interval.');

  return sanitize({
    markets: rows.map((r) => r.market),
    charts: rows.filter((r) => r.charted).map((r) => r.market),
    interval: Number(intervalSel.value) as Settings['interval'],
    candleWidth: candleWidthSel.value as CandleWidth,
    refreshSec,
    displaySec,
  });
}

/** Apply the form as soon as anything changes; no-op if the result is unchanged. */
async function applyForm(): Promise<void> {
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
  settings = next;
  await saveSettings(settings);
  restartSchedule();
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
showNowBtn.addEventListener('click', () => {
  if (showing) void hide();
  else restartSchedule();
});

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
  setStatus('Connecting to glasses…');
  glasses = await Glasses.connect();
  glasses?.onTap(() => {
    // Tap while the chart is up dismisses it; tap while dark pulls a fresh one.
    if (showing) void hide();
    else restartSchedule();
  });
  settings = await loadSettings();
  fillForm(settings);
  restartSchedule();
}

void boot();

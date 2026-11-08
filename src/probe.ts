/**
 * Diagnostic build only (`VITE_PROBE=1`): a heartbeat to find out what the
 * phone page was doing when it froze and then went black. Every few seconds it
 * saves uptime, JS heap (Chromium's `performance.memory`, so Android only), DOM
 * size, the longest main-thread stall, and what the app was busy with. A
 * renderer that hangs or is killed can't report anything itself, so the next
 * launch reads the last saved beat and shows it on the page.
 *
 * Saved to localStorage every beat and to the Even app's storage every minute:
 * we don't know which of the two survives a renderer crash and a phone restart.
 */

export const PROBE: boolean = import.meta.env.VITE_PROBE === '1';

const KEY = 'marketglimpse.probe';
const BEAT_MS = 5000;
const BRIDGE_EVERY_MS = 60_000;
const HISTORY_EVERY_MS = 10 * 60_000;
const HISTORY_MAX = 72; // 12 hours at one per 10 minutes

/** One saved heartbeat: everything known about the session at that moment. */
interface Beat {
  v: 1;
  start: number;
  beat: number;
  beats: number;
  /** MB, if the WebView says. */
  heap?: number;
  heapPeak?: number;
  heapLimit?: number;
  heapFirst?: number;
  nodes: number;
  /** Longest gap between 1s ticks beyond the expected second, while visible (ms), and when (uptime ms). */
  stall: number;
  stallAt: number;
  /** Long tasks (> 50ms) seen by the PerformanceObserver: the longest, and how many took over a second. */
  longTask: number;
  longTasksOver1s: number;
  phase: string;
  phaseSince: number;
  /** Glasses calls queued or running, and since when the current one has run. */
  glassesQueue: number;
  glassesBusySince: number;
  hidden: boolean;
  hiddenSince: number;
  visibilityChanges: number;
  launch?: string;
  errors: string[];
  /** [uptime minutes, heap MB or -1, DOM nodes]. */
  history: [number, number, number][];
}

type Storage = { get(key: string): Promise<string>; set(key: string, value: string): Promise<unknown> };

const now = Date.now();
const state: Beat = {
  v: 1,
  start: now,
  beat: now,
  beats: 0,
  nodes: 0,
  stall: 0,
  stallAt: 0,
  longTask: 0,
  longTasksOver1s: 0,
  phase: 'boot',
  phaseSince: now,
  glassesQueue: 0,
  glassesBusySince: 0,
  // Imported by glasses.ts, so also loaded by tests in Node, where there's no document.
  hidden: typeof document !== 'undefined' && document.hidden,
  hiddenSince: now,
  visibilityChanges: 0,
  errors: [],
  history: [],
};

// Read before anything is written, or the first beat would overwrite it.
const previousLocal = PROBE ? parse(safe(() => localStorage.getItem(KEY))) : null;
let previous: Beat | null = previousLocal;
let bridge: Storage | null = null;
let lastBridgeWrite = 0;
let lastHistory = 0;

/** What the app is busy with now: fetch, draw, upload, idle… */
export function phase(name: string): void {
  if (!PROBE || state.phase === name) return;
  state.phase = name;
  state.phaseSince = Date.now();
}

/** A glasses call was queued (+1) or finished (-1). */
export function glassesCall(delta: 1 | -1): void {
  if (!PROBE) return;
  state.glassesQueue += delta;
  if (state.glassesQueue <= 0) state.glassesBusySince = 0;
}

/** A glasses call started running (the one before it in the queue is done). */
export function glassesCallStarted(): void {
  if (PROBE) state.glassesBusySince = Date.now();
}

export function launchSource(source: string): void {
  if (PROBE) state.launch = source;
}

/**
 * Start the heartbeat and show the panel. `storage` is the Even app's, once
 * connected (null in a browser); its saved beat is used if newer than localStorage's.
 */
export async function startProbe(storage: Storage | null, copy: (text: string) => Promise<boolean>): Promise<void> {
  if (!PROBE) return;
  // A page that draws but shows nothing is then easy to tell from a WebView that isn't drawing.
  document.documentElement.style.setProperty('--bg', '#3b2f72');
  const panel = document.getElementById('probe')!;
  panel.hidden = false;
  const lastEl = document.getElementById('probe-last')!;
  const liveEl = document.getElementById('probe-live')!;
  const copyBtn = document.getElementById('probe-copy') as HTMLButtonElement;

  if (storage) {
    const fromBridge = parse(await storage.get(KEY).catch(() => ''));
    if (fromBridge && (!previous || fromBridge.beat > previous.beat)) previous = fromBridge;
    bridge = storage;
  }
  lastEl.textContent = previous ? `Last session: ${describe(previous)}` : 'Last session: none saved';
  if (previous && previousLocal?.beat !== previous.beat) lastEl.textContent += ' [from Even app storage; localStorage was older or empty]';

  copyBtn.addEventListener('click', () => {
    const text = JSON.stringify({ previous, current: snapshot() });
    void copy(text).then((ok) => {
      copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { copyBtn.textContent = 'Copy report'; }, 2000);
    });
  });

  watch();
  const write = () => {
    const b = snapshot();
    const json = JSON.stringify(b);
    safe(() => localStorage.setItem(KEY, json));
    if (bridge && b.beat - lastBridgeWrite >= BRIDGE_EVERY_MS) {
      lastBridgeWrite = b.beat;
      void bridge.set(KEY, json).catch(() => {});
    }
    liveEl.textContent = `Now: ${describe(b, true)}`;
  };
  write();
  setInterval(write, BEAT_MS);
}

function snapshot(): Beat {
  const t = Date.now();
  state.beat = t;
  state.beats++;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (mem) {
    state.heap = mb(mem.usedJSHeapSize);
    state.heapLimit = mb(mem.jsHeapSizeLimit);
    state.heapPeak = Math.max(state.heapPeak ?? 0, state.heap);
    state.heapFirst ??= state.heap;
  }
  state.nodes = document.getElementsByTagName('*').length;
  if (t - lastHistory >= HISTORY_EVERY_MS) {
    lastHistory = t;
    state.history.push([Math.round((t - state.start) / 60_000), state.heap ?? -1, state.nodes]);
    if (state.history.length > HISTORY_MAX) state.history.shift();
  }
  return state;
}

/** Stalls, long tasks, visibility and uncaught errors. */
function watch(): void {
  // A 1s tick that arrives late, while the page is visible, means the main thread was blocked.
  let last = Date.now();
  let wasVisible = !document.hidden;
  setInterval(() => {
    const t = Date.now();
    const late = t - last - 1000;
    if (wasVisible && !document.hidden && late > state.stall) {
      state.stall = late;
      state.stallAt = t - state.start;
    }
    last = t;
    wasVisible = !document.hidden;
  }, 1000);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        state.longTask = Math.max(state.longTask, Math.round(e.duration));
        if (e.duration > 1000) state.longTasksOver1s++;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* not supported */ }
  document.addEventListener('visibilitychange', () => {
    state.hidden = document.hidden;
    state.hiddenSince = Date.now();
    state.visibilityChanges++;
    wasVisible = false; // the gap across a hide isn't a stall
  });
  const error = (msg: string) => {
    state.errors.push(`${dur(Date.now() - state.start)}: ${msg.slice(0, 160)}`);
    if (state.errors.length > 5) state.errors.shift();
  };
  window.addEventListener('error', (e) => error(e.message || String(e.error)));
  window.addEventListener('unhandledrejection', (e) => error(`unhandled: ${(e.reason as Error)?.message ?? String(e.reason)}`));
}

/** One line for the page. `live`: the current session (no "ended"). */
function describe(b: Beat, live = false): string {
  const parts = [`up ${dur(b.beat - b.start)}`];
  if (!live) parts.push(`last beat ${new Date(b.beat).toLocaleString()}`);
  if (b.heap !== undefined) parts.push(`heap ${b.heap} MB (start ${b.heapFirst}, peak ${b.heapPeak}, limit ${b.heapLimit})`);
  else parts.push('heap n/a');
  parts.push(`${b.nodes} DOM nodes`);
  parts.push(`longest stall ${dur(b.stall)}${b.stall ? ` at ${dur(b.stallAt)}` : ''}`);
  parts.push(`longest task ${dur(b.longTask)}${b.longTasksOver1s ? `, ${b.longTasksOver1s} over 1s` : ''}`);
  parts.push(`${b.phase} for ${dur(b.beat - b.phaseSince)}`);
  if (b.glassesQueue) parts.push(`glasses queue ${b.glassesQueue}, busy ${dur(b.beat - b.glassesBusySince)}`);
  parts.push(`${b.hidden ? 'hidden' : 'visible'} for ${dur(b.beat - b.hiddenSince)} (${b.visibilityChanges} changes)`);
  if (b.launch) parts.push(`launched from ${b.launch}`);
  if (b.errors.length) parts.push(`errors: ${b.errors.join(' | ')}`);
  if (!live && b.history.length > 1) parts.push(`heap MB / nodes every 10 min: ${b.history.map(([, h, n]) => `${h < 0 ? '?' : h}/${n}`).join(' ')}`);
  return parts.join(' · ');
}

function dur(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

const mb = (bytes: number) => Math.round(bytes / 1048576);

function parse(raw: string | null | undefined): Beat | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as Beat;
    return b?.v === 1 && typeof b.beat === 'number' ? b : null;
  } catch {
    return null;
  }
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

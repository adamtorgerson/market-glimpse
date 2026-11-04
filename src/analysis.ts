/**
 * Technical analysis drawn on the image charts. Computed from the candles
 * the chart shows, never extra history (CLAUDE.md, rule 3), so each series
 * starts once its period has filled: `null` before then. The parameters are
 * settings; these are their defaults and limits.
 */
import type { Candle } from './sources/types';

/** In the order the phone page lists them: over the price, then in a pane of their own. */
export const ANALYSES = ['sma', 'ema', 'vwap', 'bollinger', 'donchian', 'sar', 'rsi', 'macd', 'atr'] as const;
export type Analysis = (typeof ANALYSES)[number];

export const SMA_PERIOD = 20;
export const EMA_PERIOD = 20;
export const RSI_PERIOD = 14;
export const ATR_PERIOD = 14;
export const BOLLINGER_PERIOD = 20;
export const BOLLINGER_K = 2;
export const DONCHIAN_PERIOD = 20;
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const MACD_SIGNAL = 9;
export const SAR_STEP = 0.02;
export const SAR_MAX = 0.2;
/** Periods, in candles. */
export const MIN_PERIOD = 2;
export const MAX_PERIOD = 200;
/** Bollinger band width, in standard deviations, to one decimal place. */
export const MIN_K = 0.1;
export const MAX_K = 5;
/** Parabolic SAR's acceleration step and maximum, to three decimal places. */
export const MIN_SAR = 0.001;
export const MAX_SAR = 1;

export const ANALYSIS_LABELS: Record<Analysis, string> = {
  sma: 'SMA',
  ema: 'EMA',
  vwap: 'VWAP',
  bollinger: 'Bollinger Bands',
  donchian: 'Donchian Channels',
  sar: 'Parabolic SAR',
  rsi: 'RSI',
  macd: 'MACD',
  atr: 'ATR',
};

/** What a chart draws: the indicator and its parameters. */
export type AnalysisSpec =
  | { kind: 'sma' | 'ema' | 'donchian' | 'rsi' | 'atr'; period: number }
  | { kind: 'bollinger'; period: number; k: number }
  | { kind: 'macd'; fast: number; slow: number; signal: number }
  | { kind: 'sar'; step: number; max: number }
  | { kind: 'vwap' };

/** Indicators with a scale of their own, drawn in a pane under the volume strip. */
export function hasPane(kind: Analysis): boolean {
  return kind === 'rsi' || kind === 'macd' || kind === 'atr';
}

/** The fewest candles that draw a line: two points of it. */
export function candlesNeeded(a: AnalysisSpec): number {
  switch (a.kind) {
    case 'vwap': return 2;
    case 'sar': return 3;
    case 'macd': return a.slow + a.signal;
    case 'rsi': return a.period + 2;
    default: return a.period + 1;
  }
}

/** Simple moving average. */
export function sma(values: number[], period = SMA_PERIOD): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= period) sum -= values[i - period]!;
    return i < period - 1 ? null : sum / period;
  });
}

/** Exponential moving average, seeded with the simple average of the first `period`. */
export function ema(values: number[], period = EMA_PERIOD): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let avg = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = avg;
  for (let i = period; i < values.length; i++) {
    avg = values[i]! * k + avg * (1 - k);
    out[i] = avg;
  }
  return out;
}

/** Wilder's relative strength index, 0–100. */
export function rsi(values: number[], period = RSI_PERIOD): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  const index = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = index();
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = index();
  }
  return out;
}

export interface Band { mid: number; upper: number; lower: number }

/** Simple moving average with bands `k` population standard deviations either side. */
export function bollinger(values: number[], period = BOLLINGER_PERIOD, k = BOLLINGER_K): (Band | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const win = values.slice(i - period + 1, i + 1);
    const mid = win.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(win.reduce((a, v) => a + (v - mid) ** 2, 0) / period);
    return { mid, upper: mid + k * sd, lower: mid - k * sd };
  });
}

/** Highest high and lowest low of the last `period` candles, this one included. */
export function donchian(candles: Candle[], period = DONCHIAN_PERIOD): ({ upper: number; lower: number } | null)[] {
  return candles.map((_, i) => {
    if (i < period - 1) return null;
    const win = candles.slice(i - period + 1, i + 1);
    return { upper: Math.max(...win.map((c) => c.high)), lower: Math.min(...win.map((c) => c.low)) };
  });
}

/**
 * Volume-weighted average of the typical price (high + low + close) / 3,
 * running from the first candle given: the chart's left edge, not a session
 * open. Null until anything has traded.
 */
export function vwap(candles: Candle[]): (number | null)[] {
  let money = 0, volume = 0;
  return candles.map((c) => {
    money += (c.high + c.low + c.close) / 3 * c.volume;
    volume += c.volume;
    return volume > 0 ? money / volume : null;
  });
}

/** Wilder's average true range, in price. The first candle's true range is just its high to low. */
export function atr(candles: Candle[], period = ATR_PERIOD): (number | null)[] {
  const out: (number | null)[] = candles.map(() => null);
  if (candles.length < period) return out;
  const tr = candles.map((c, i) => {
    const prev = candles[i - 1]?.close;
    return prev === undefined ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  let avg = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = avg;
  for (let i = period; i < tr.length; i++) {
    avg = (avg * (period - 1) + tr[i]!) / period;
    out[i] = avg;
  }
  return out;
}

export interface Macd {
  /** Fast EMA minus slow EMA. */
  line: (number | null)[];
  /** EMA of `line`. */
  signal: (number | null)[];
  /** `line` minus `signal`. */
  hist: (number | null)[];
}

export function macd(values: number[], fast = MACD_FAST, slow = MACD_SLOW, signal = MACD_SIGNAL): Macd {
  const f = ema(values, fast), s = ema(values, slow);
  const line = values.map((_, i) => (f[i] == null || s[i] == null ? null : f[i]! - s[i]!));
  // The line starts with the slow EMA.
  const smoothed = ema(line.slice(slow - 1) as number[], signal);
  const sig = values.map((_, i) => smoothed[i - slow + 1] ?? null);
  return { line, signal: sig, hist: values.map((_, i) => (sig[i] == null ? null : line[i]! - sig[i]!)) };
}

/**
 * Wilder's Parabolic SAR: a stop that closes in on the price, faster with
 * each new extreme, and flips to the other side when the price reaches it.
 * It starts on the second candle, as TA-Lib's does (test/charting/fixtures):
 * Wilder leaves the start open, and it shows for some way along a short chart.
 */
export function parabolicSar(candles: Candle[], step = SAR_STEP, max = SAR_MAX): (number | null)[] {
  const out: (number | null)[] = candles.map(() => null);
  if (candles.length < 2) return out;
  const first = candles[0]!, second = candles[1]!;
  // Down if the low fell by more than the high rose.
  const fall = first.low - second.low;
  let up = !(fall > 0 && fall > second.high - first.high);
  let sar = up ? first.low : first.high;
  let extreme = up ? second.high : second.low;
  let af = step;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    // Candles it can't go inside: the last two, but none from before the second.
    const prev = i === 1 ? c : candles[i - 1]!, prev2 = i <= 2 ? prev : candles[i - 2]!;
    let next = sar;
    if (i > 1) {
      next = sar + af * (extreme - sar);
      next = up ? Math.min(next, prev.low, prev2.low) : Math.max(next, prev.high, prev2.high);
    }
    if (up ? c.low <= next : c.high >= next) {
      // Flipped: to the last extreme, kept outside this candle too.
      up = !up;
      next = up ? Math.min(extreme, prev.low, c.low) : Math.max(extreme, prev.high, c.high);
      extreme = up ? c.high : c.low;
      af = step;
    } else if (i > 1 && (up ? c.high > extreme : c.low < extreme)) {
      extreme = up ? c.high : c.low;
      af = Math.min(af + step, max);
    }
    out[i] = next;
    sar = next;
  }
  return out;
}

/**
 * Technical analysis drawn on the image charts. Computed from the candles
 * the chart shows, never extra history (CLAUDE.md, rule 3), so each series
 * starts once its period has filled: `null` before then. The periods and
 * band width are settings; these are their defaults and limits.
 */

export const ANALYSES = ['ema', 'rsi', 'bollinger'] as const;
export type Analysis = (typeof ANALYSES)[number];

export const EMA_PERIOD = 20;
export const RSI_PERIOD = 14;
export const BOLLINGER_PERIOD = 20;
export const BOLLINGER_K = 2;
/** Periods, in candles. */
export const MIN_PERIOD = 2;
export const MAX_PERIOD = 200;
/** Bollinger band width, in standard deviations, to one decimal place. */
export const MIN_K = 0.1;
export const MAX_K = 5;

export const ANALYSIS_LABELS: Record<Analysis, string> = {
  ema: 'EMA',
  rsi: 'RSI',
  bollinger: 'Bollinger Bands',
};

/** What a chart draws: the indicator, its period, and for Bollinger Bands, their width. */
export interface AnalysisSpec {
  kind: Analysis;
  period: number;
  k: number;
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

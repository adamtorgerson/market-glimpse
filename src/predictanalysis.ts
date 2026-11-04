/**
 * Analysis of a prediction market's outcomes, from data its update already
 * fetches. A probability has no long-run trend to follow, so these ask how much
 * the forecast is moving and how far to trust it. Points are percentage
 * points of probability: 0.01 is 1 point.
 */
import type { Outcome, PredictionData, PricePoint } from './sources/prediction';

/** Probabilities are held this far from 0 and 1: their log-odds are infinite there. */
const EDGE = 0.005;
const clamp = (p: number) => Math.min(1 - EDGE, Math.max(EDGE, p));
const logOdds = (p: number) => Math.log(clamp(p) / (1 - clamp(p)));

/**
 * Typical move in a day, in points at probability `p`. Measured in log-odds,
 * as 5 points near 2% is a far bigger move than near 50%, from each step of
 * `history`, then brought back to points at today's price so markets at any
 * price compare. Assumes moves don't lean one way from step to step; undefined
 * with too little history to say.
 */
export function dailyVolatility(history: PricePoint[], p: number): number | undefined {
  if (history.length < 3) return undefined;
  let squares = 0;
  for (let i = 1; i < history.length; i++) squares += (logOdds(history[i]!.p) - logOdds(history[i - 1]!.p)) ** 2;
  const seconds = history.at(-1)!.time - history[0]!.time;
  if (seconds <= 0) return undefined;
  return Math.sqrt(squares / seconds * 86400) * clamp(p) * (1 - clamp(p)) * 100;
}

/** Change in points since the start of `outcome`'s history, to its current price. */
export function historyChange(outcome: Outcome): number | undefined {
  const first = outcome.history[0];
  return first ? (outcome.price - first.p) * 100 : undefined;
}

export interface EventStats {
  /** What the change covers: "24h", or how far back the history goes. */
  changeLabel: string;
  /** Per outcome, in order; formatted. */
  rows: { change: string; volatility: string; spread: string }[];
  /** For the chart's header: the outcomes' total and the time left, where there's either. */
  summary: string;
}

/** The analysis to show for an event, at `end` (unix seconds). */
export function eventStats(d: PredictionData, end: number): EventStats {
  // The source's own 24h figure where every outcome has one: it doesn't depend on the chart's span.
  const sourced = d.outcomes.length > 0 && d.outcomes.every((o) => o.dayChange !== undefined);
  const start = Math.min(...d.outcomes.flatMap((o) => o.history.slice(0, 1).map((h) => h.time)));
  const rows = d.outcomes.map((o) => {
    const change = sourced ? o.dayChange! * 100 : historyChange(o);
    const volatility = dailyVolatility(o.history, o.price);
    return {
      change: change === undefined ? '—' : formatChangePoints(change),
      volatility: volatility === undefined ? '—' : formatPoints(volatility),
      spread: o.spread === undefined ? '—' : formatPoints(o.spread * 100),
    };
  });
  return {
    changeLabel: sourced ? '24h' : Number.isFinite(start) ? formatDuration(end - start) : 'chg',
    rows,
    summary: [d.total === undefined ? '' : `Sum ${(d.total * 100).toFixed(1)}%`, d.endTime === undefined ? '' : formatEnds(d.endTime, end)].filter(Boolean).join(' · '),
  };
}

/** Whole points from 10 up, one decimal below: 9.99 rounds up to the former. */
function pointsText(points: number): string {
  return Number(points.toFixed(1)) >= 10 ? points.toFixed(0) : points.toFixed(1);
}

/** As `pointsText`, with no false zero. */
export function formatPoints(points: number): string {
  return points > 0 && points < 0.05 ? '<0.1' : pointsText(points);
}

/** "+1.1", "−12", "0.0". */
export function formatChangePoints(points: number): string {
  const text = pointsText(Math.abs(points));
  return Number(text) === 0 ? '0.0' : `${points > 0 ? '+' : '−'}${text}`;
}

/** A span in its largest sensible unit: "40m", "14h", "3d", "5mo", "2y". */
export function formatDuration(seconds: number): string {
  const minutes = seconds / 60, hours = minutes / 60, days = hours / 24;
  if (hours < 1) return `${Math.max(1, Math.round(minutes))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  if (days < 60) return `${Math.round(days)}d`;
  if (days < 730) return `${Math.round(days / 30.44)}mo`;
  return `${Math.round(days / 365.25)}y`;
}

/** Time to the event's end date: "ends 2y". A market can stay open past it, waiting to be resolved. */
export function formatEnds(endTime: number, now: number): string {
  return endTime <= now ? 'past end date' : `ends ${formatDuration(endTime - now)}`;
}

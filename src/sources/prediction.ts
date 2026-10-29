import type { ExploreBy } from './types';
/**
 * Prediction markets: a different kind of source from the exchanges. A market
 * is an event ("Man City vs. Brighton") whose outcomes ("Man City", "Draw",
 * "Brighton", or just "Yes" and "No") each have a probability, priced 0–1.
 */

export interface PricePoint {
  /** Unix seconds. */
  time: number;
  /** Probability, 0–1. */
  p: number;
}

export interface Outcome {
  /** Short name: "Yes", "Draw", "Manchester City FC". */
  name: string;
  /** Current probability, 0–1. */
  price: number;
  /** Oldest first. */
  history: PricePoint[];
  /** Its market's 24h volume, in dollars, where it has a market of its own (or is the first of one's two sides). */
  dayVolume?: number;
}

export interface PredictionData {
  /** As entered: the event's slug. */
  market: string;
  /** The event's question or title. */
  title: string;
  /** At most `MAX_OUTCOMES`, in the order to draw them (see `pick` in polymarket.ts). */
  outcomes: Outcome[];
  /**
   * The outcomes left out, if any: how many, and if exactly one outcome can
   * win, their combined probability (otherwise their prices don't add up).
   */
  other?: { count: number; price?: number };
  /** 24h volume, in dollars. */
  dayVolume?: number;
  error?: string;
}

export interface PredictionRequest {
  /** Event slugs. */
  markets: string[];
  /** Spacing of the history, in minutes. */
  interval: number;
  /** History points to fetch, ending now (rule 3: only what's drawn); 0 for none (the text list). */
  points: number;
  /** The events to fetch history for, if not all: those charted (the rest are listed by their current prices). */
  history?: string[];
}

export interface PredictionSource {
  id: string;
  label: string;
  /** Most requests one `fetch` makes to any one of its APIs, so the UI can keep the refresh rate sustainable. */
  requestsPerUpdate(req: PredictionRequest): number;
  /** Rough ms a `fetch` would take if started now (rate limits, recent response times). */
  estimateMs(req: PredictionRequest): number;
  /** One result per `req.markets` entry, in order. Rejects only with an AbortError. */
  fetch(req: PredictionRequest, signal: AbortSignal): Promise<PredictionData[]>;
  /**
   * The top events (up to EXPLORE_COUNT, as many as the list shows) by 24h
   * volume, or by their markets' biggest 1-day move, with what they were
   * ranked by. Missing where the API doesn't give either.
   */
  explore?(by: ExploreBy, signal: AbortSignal): Promise<ExploredEvent[]>;
  /** The rankings `explore` offers, if not all. */
  exploreRankings?: readonly ExploreBy[];
  /** Requests one `explore` by `by` makes, if not 1. */
  exploreRequests?(by: ExploreBy): number;
  /** Shown with Explore's list, e.g. what its ranking means for this source. */
  exploreNote?: string;
}

/** History spacings offered, in minutes. */
export const EVENT_INTERVALS = [1, 5, 15, 60, 240, 1440];

export interface ExploredEvent {
  /** Slug. */
  market: string;
  title?: string;
  /** Its most traded market's 24h volume, in dollars. */
  volume?: number;
  /** Its market that moved most: the 1-day change in probability (0.15 is 15 points). */
  change?: number;
  /** Its liquidity in dollars: the money on its books, or at the top of its leading market's. */
  liquidity?: number;
}

/** Lines one chart can tell apart without colour. */
export const MAX_OUTCOMES = 4;

/** A slug, from a slug or an event's URL ("https://polymarket.com/event/<slug>"). */
export function eventSlug(input: string): string {
  const m = input.trim().match(/\/event\/([^/?#]+)/);
  return (m ? m[1]! : input.trim()).toLowerCase();
}

/** Outcomes chosen to chart, and what's left out (see `PredictionData.other`). */
export interface Chosen<L> {
  lines: L[];
  other?: PredictionData['other'];
}

/**
 * Which of an event's separate yes/no markets (each as the outcome it's
 * about) to chart, at most MAX_OUTCOMES:
 *  - A ladder (`order` given: each market's place among ordered numbers or
 *    dates, "Bitcoin ↑ 85,000", "ceasefire holds through November 15", and
 *    not `exclusive`): consecutive rungs in order, where they're closest to
 *    even odds; the far rungs are near certain either way and say little.
 *    The rest are counted, not priced: the markets aren't exclusive, so their
 *    prices don't add up.
 *  - An exclusive set (exactly one wins: candidates, the Fed's decision,
 *    price ranges): the likeliest, likeliest first, and the rest as "Other",
 *    priced as their sum.
 *  - Other separate markets ("who will Trump meet"): the likeliest, and the
 *    rest counted.
 * With MAX_OUTCOMES or fewer, all of them: a ladder's in order, others as given.
 */
export function chooseOutcomes<L extends { price: number }>(all: L[], exclusive: boolean, order?: number[]): Chosen<L> {
  const n = MAX_OUTCOMES;
  if (order && !exclusive) {
    const rungs = all.map((l, i) => ({ l, o: order[i]! })).sort((a, b) => a.o - b.o).map((r) => r.l);
    if (rungs.length <= n) return { lines: rungs };
    const spread = (i: number) => rungs.slice(i, i + n).reduce((sum, l) => sum + Math.abs(l.price - 0.5), 0);
    let start = 0;
    for (let i = 1; i + n <= rungs.length; i++) if (spread(i) < spread(start)) start = i;
    return { lines: rungs.slice(start, start + n), other: { count: rungs.length - n } };
  }
  if (all.length <= n) return { lines: all };
  const ranked = [...all].sort((a, b) => b.price - a.price);
  const rest = ranked.slice(n);
  return {
    lines: ranked.slice(0, n),
    other: exclusive ? { count: rest.length, price: Math.min(1, rest.reduce((sum, l) => sum + l.price, 0)) } : { count: rest.length },
  };
}

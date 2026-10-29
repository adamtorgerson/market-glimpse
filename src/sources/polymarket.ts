import { describeError, isAbort, PublicApi } from './http';
import { EXPLORE_COUNT } from './types';
import { chooseOutcomes, MAX_OUTCOMES, type Chosen, type PredictionRequest, type ExploredEvent, type Outcome, type PredictionData, type PredictionSource, type PricePoint } from './prediction';

// Two APIs, each with its own rate limit: Gamma for events and current
// prices, the CLOB for price history.
const gamma = new PublicApi('https://gamma-api.polymarket.com');
const clob = new PublicApi('https://clob.polymarket.com');

export interface GammaMarket {
  question: string;
  /** The outcome's name within a multi-market event ("Draw (A vs. B)", "↑ 85,000"). */
  groupItemTitle?: string;
  /** The outcome's place in the event's order (a string of an integer): a ladder's rungs, a set's buckets. */
  groupItemThreshold?: string;
  /** On a sports game's markets: "moneyline" for who wins, else "spreads", "totals", "points"… */
  sportsMarketType?: string;
  /** JSON-encoded arrays, e.g. '["Yes", "No"]'. */
  outcomes: string;
  outcomePrices: string;
  clobTokenIds: string;
  active: boolean;
  closed: boolean;
  /** In dollars. */
  volume24hr?: number;
}

export interface GammaEvent {
  slug: string;
  title: string;
  volume24hr?: number;
  /** Money on its markets' books, in dollars. */
  liquidity?: number;
  /** Exactly one of the event's markets resolves Yes, so their prices add up to about 1. */
  negRisk?: boolean;
  markets: GammaMarket[];
}

/** An outcome to chart, before its history is fetched. */
export interface Line {
  name: string;
  price: number;
  /** The token whose price history is the outcome's, or for "No" the complement of "Yes"'s. */
  token: string;
  complement?: boolean;
  /** Its market's 24h volume: the first side's, for a market of two. */
  volume?: number;
}

export interface Pick extends Chosen<Line> {
  /** Why there's nothing to chart. */
  error?: string;
}

const parse = <T>(json: string | undefined): T[] => (json ? JSON.parse(json) as T[] : []);

/** Outcomes the CLOB gives history for in one request. */
const BATCH = 20;

/** History requests for `req`'s events, at most MAX_OUTCOMES outcomes each (a yes/no market's two are one). */
function historyRequests(req: PredictionRequest): number {
  const events = req.history ?? req.markets;
  return req.points && events.length ? Math.max(1, Math.ceil(events.length * MAX_OUTCOMES / BATCH)) : 0;
}

/** A market's two outcomes ("Yes" and "No", or two teams): they add up to 1, so only the first needs a history. */
function both(m: GammaMarket): Line[] {
  const names = parse<string>(m.outcomes), prices = parse<string>(m.outcomePrices), token = parse<string>(m.clobTokenIds)[0];
  if (names.length !== 2 || !token) return [];
  return names.map((name, i) => ({ name, price: +prices[i]!, token, complement: i === 1, ...(i === 0 ? { volume: m.volume24hr } : {}) }));
}

/** A yes/no market within an event, as the outcome it's about: its "Yes", named as the event names it. */
function yes(m: GammaMarket): Line[] {
  const token = parse<string>(m.clobTokenIds)[0];
  const price = +(parse<string>(m.outcomePrices)[0] ?? NaN);
  // "Draw (Manchester City FC vs. Brighton & Hove Albion FC)" is just "Draw".
  const name = (m.groupItemTitle || m.question).replace(/^(Draw|Tie) \(.*\)$/, '$1');
  return token && Number.isFinite(price) ? [{ name, price, token, volume: m.volume24hr }] : [];
}

/**
 * The outcomes to chart, and what's left out. A sports game bundles who wins
 * ("moneyline") with spreads, totals and props; only who wins is charted:
 * one market of two teams (most sports), or three yes/no markets (soccer:
 * home, draw, away). One market is its two outcomes. Several separate yes/no
 * markets are chosen by `chooseOutcomes`: exclusive if Polymarket says
 * exactly one wins (`negRisk`), a ladder if every market has a place in the
 * event's order and most are named by numbers or dates.
 */
export function pick(e: GammaEvent): Pick {
  let open = e.markets.filter((m) => m.active && !m.closed);
  if (open.length === 0) return { lines: [], error: 'closed' };
  if (open.some((m) => m.sportsMarketType)) {
    open = open.filter((m) => m.sportsMarketType === 'moneyline');
    if (open.length === 0) return { lines: [], error: 'no winner market' };
  }
  if (open.length === 1) return { lines: both(open[0]!) };

  const order = open.map((m) => Number(m.groupItemThreshold));
  const ladder = open.every((m, i) => m.groupItemThreshold !== undefined && Number.isFinite(order[i]))
    && open.filter((m) => /\d/.test(m.groupItemTitle ?? '')).length >= open.length * 0.6;
  const lines = open.flatMap((m) => yes(m).map((l) => ({ l, i: open.indexOf(m) })));
  return chooseOutcomes(lines.map((x) => x.l), !!e.negRisk, ladder ? lines.map((x) => order[x.i]!) : undefined);
}

export const polymarket: PredictionSource = {
  id: 'polymarket',
  label: 'Polymarket',

  requestsPerUpdate(req) {
    // The events from one API, their history from the other.
    return Math.max(1, historyRequests(req));
  },

  estimateMs(req) {
    // The events, then their history, from each API, one after the other.
    return gamma.estimateMs(1) + clob.estimateMs(historyRequests(req));
  },

  async explore(by, signal) {
    if (by === 'liquidity') {
      // Polymarket sorts events by the money on their books: one request.
      const events = await gamma.get<GammaEvent[]>(`/events?active=true&closed=false&order=liquidity&ascending=false&limit=${EXPLORE_COUNT * 2}`, signal);
      return events.filter((e) => !e.slug.endsWith('-more-markets') && pick(e).lines.length > 0).slice(0, EXPLORE_COUNT)
        .map((e) => ({ market: e.slug, title: e.title, volume: e.volume24hr, liquidity: e.liquidity }));
    }
    // The most traded markets, each with its event: one request, ranked by the
    // event's most traded market, or its market that moved most.
    const markets = await gamma.get<{ volume24hr?: number; oneDayPriceChange?: number; events?: { slug: string; title?: string }[] }[]>(
      '/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=100', signal);
    const ranked = by === 'volume' ? markets : [...markets].sort((a, b) => Math.abs(b.oneDayPriceChange ?? 0) - Math.abs(a.oneDayPriceChange ?? 0));
    const events: ExploredEvent[] = [];
    for (const m of ranked) {
      const e = m.events?.[0];
      // A game's "more markets" event is its spreads and totals, with no winner to chart.
      if (e?.slug && !e.slug.endsWith('-more-markets') && !events.some((x) => x.market === e.slug)) events.push({ market: e.slug, title: e.title, volume: m.volume24hr, change: m.oneDayPriceChange });
    }
    return events.slice(0, EXPLORE_COUNT);
  },

  async fetch(req, signal, onProgress) {
    const out = new Map<string, PredictionData>(req.markets.map((m) => [m, { market: m, title: m, outcomes: [] }]));
    const result = () => req.markets.map((m) => out.get(m)!);
    const fail = (e: unknown) => {
      if (isAbort(e)) throw e;
      for (const d of out.values()) d.error ??= describeError(e);
    };

    // Rule 2: every event in one request, then every outcome's history in one.
    let charted: { d: PredictionData; lines: Line[] }[];
    try {
      const events = await gamma.get<GammaEvent[]>(`/events?${req.markets.map((m) => `slug=${encodeURIComponent(m)}`).join('&')}`, signal);
      charted = req.markets.flatMap((m) => {
        const d = out.get(m)!;
        const e = events.find((x) => x.slug === m);
        if (!e) {
          d.error = 'unknown market';
          return [];
        }
        d.title = e.title;
        d.dayVolume = e.volume24hr;
        const { lines: ls, other, error } = pick(e);
        // Current prices even if the history can't be had.
        d.outcomes = ls.map((l) => ({ name: l.name, price: l.price, history: [], dayVolume: l.volume }));
        if (other) d.other = other;
        if (ls.length === 0) d.error = error ?? 'closed';
        return ls.length ? [{ d, lines: ls }] : [];
      });
    } catch (e) {
      fail(e);
      return result();
    }
    if (charted.length === 0) return result();
    onProgress?.(result());

    // Rule 3: from just far enough back to fill the chart. Rule 2: up to
    // BATCH outcomes per request, the most the CLOB takes.
    const drawn = charted.filter((c) => !req.history || req.history.includes(c.d.market));
    const tokens = req.points ? [...new Set(drawn.flatMap((c) => c.lines.map((l) => l.token)))] : [];
    const now = Math.floor(Date.now() / 1000);
    const history: Record<string, { t: number; p: number }[]> = {};
    for (let i = 0; i < tokens.length; i += BATCH) {
      try {
        const res = await clob.post<{ history: Record<string, { t: number; p: number }[]> }>('/batch-prices-history', {
          markets: tokens.slice(i, i + BATCH),
          start_ts: now - req.points * req.interval * 60,
          end_ts: now,
          fidelity: req.interval,
        }, signal);
        Object.assign(history, res.history);
      } catch (e) {
        // Their lines just go without history; the current prices stand.
        if (isAbort(e)) throw e;
      }
    }
    for (const { d, lines: ls } of charted) {
      d.outcomes = ls.map((l): Outcome => {
        const points: PricePoint[] = (history[l.token] ?? []).map((h) => ({ time: h.t, p: l.complement ? 1 - h.p : h.p }));
        return { name: l.name, price: l.price, history: points, dayVolume: l.volume };
      });
    }
    return result();
  },
};

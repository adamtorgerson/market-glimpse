import { describeError, isAbort, PublicApi } from './http';
import { chooseOutcomes, type Chosen, type PredictionData, type PredictionSource } from './prediction';

/**
 * Polymarket US (polymarket.us): the US exchange, with its own events and
 * names ("btc-updown-1d-2026-10-27-2100z"), apart from polymarket.com's. Its
 * public API needs no key.
 */
const gateway = new PublicApi('https://gateway.polymarket.us');

export interface UsSide {
  /** "Yes" and "No", or for a game, the two teams. */
  description: string;
  /** The side whose price is the market's (its "Yes"). */
  long: boolean;
}

export interface UsMarket {
  /** For history (`symbol`). */
  slug: string;
  /** The outcome's name within a multi-market event ("San Francisco", "AC Milan (Reg. Time)", "Above $89,999.99"). */
  title: string;
  active: boolean;
  closed: boolean;
  /** The long side's best bid and ask, JSON-encoded: '["0.9200","0.9300"]'. */
  outcomePrices: string;
  /** SPORTS_MARKET_TYPE_MONEYLINE or …_DRAWABLE_OUTCOME (soccer) for who wins a game; …_FUTURE for most else. */
  sportsMarketTypeV2?: string;
  /**
   * For a market on an asset's price: a range ("80,000 to 84,999.99", one of
   * an exclusive set), or a strike ("Above $89,999.99", a rung of a ladder).
   */
  assetPriceTerms?: {
    marketType?: string;
    strike?: { value: string } | null;
  } | null;
  marketSides: UsSide[];
}

export interface UsEvent {
  slug: string;
  title: string;
  /** "neg-risk" among them for some exclusive sets. */
  tags?: { slug: string }[];
  markets: UsMarket[];
}

/** An outcome to chart, before its history is fetched. */
export interface UsLine {
  name: string;
  price: number;
  /** The market whose history is the outcome's, or for the second side, the complement of it. */
  market: string;
  complement?: boolean;
}

export interface UsPick extends Chosen<UsLine> {
  /** Why there's nothing to chart. */
  error?: string;
}

const WINNER = new Set(['SPORTS_MARKET_TYPE_MONEYLINE', 'SPORTS_MARKET_TYPE_DRAWABLE_OUTCOME']);
/** Types of markets that aren't part of a game. */
const NOT_GAME = new Set(['', 'SPORTS_MARKET_TYPE_UNSPECIFIED', 'SPORTS_MARKET_TYPE_FUTURE']);

/** The long side's best bid and ask; the ask missing without offers. */
function quote(m: UsMarket): [number, number | undefined] {
  const [bid, ask] = (JSON.parse(m.outcomePrices || '[]') as string[]).map(Number);
  return [bid ?? NaN, ask];
}

/** Quoted on both sides, closely enough to price it: not a bid of 0 and an ask of 1. */
function quoted(m: UsMarket): boolean {
  const [bid, ask] = quote(m);
  return ask !== undefined && ask - bid <= 0.5;
}

/**
 * The midpoint of the long side's bid and ask, or without a close quote, the
 * bid; until the history gives the exchange's own display price.
 */
function mid(m: UsMarket): number {
  const [bid, ask] = quote(m);
  return quoted(m) ? (bid + ask!) / 2 : bid;
}

/** A market's two sides (two teams, or Yes and No): only the first needs a history. */
function sides(m: UsMarket, eventTitle: string): UsLine[] {
  const long = m.marketSides.find((s) => s.long), short = m.marketSides.find((s) => !s.long);
  const price = mid(m);
  if (!long || !short || !Number.isFinite(price)) return [];
  // "BTC Up or Down Daily" is Yes and No on the API, but Up and Down on the site.
  const updown = long.description === 'Yes' && /up or down/i.test(eventTitle);
  return [
    { name: updown ? 'Up' : long.description, price, market: m.slug },
    { name: updown ? 'Down' : short.description, price: 1 - price, market: m.slug, complement: true },
  ];
}

/**
 * The outcomes to chart, as `pick` does for polymarket.com. A game's winner
 * markets are its only ones charted; with none, there's nothing to chart.
 * Several markets are chosen by `chooseOutcomes`, as:
 *  - a ladder, ordered by strike, if each is on an asset's price passing a
 *    strike ("Above $89,999.99");
 *  - exclusive if each is one of an asset's price ranges, or the event is
 *    tagged "neg-risk", or else if the quoted ones' prices add up to about 1
 *    (candidates, the Fed's decision);
 *  - otherwise a ladder if every one is named by a number, ordered by it, or
 *    else separate markets ("IPOs in 2026").
 */
export function pickUs(e: UsEvent): UsPick {
  let open = e.markets.filter((m) => m.active && !m.closed);
  if (open.length === 0) return { lines: [], error: 'closed' };
  const winners = open.filter((m) => WINNER.has(m.sportsMarketTypeV2 ?? ''));
  if (winners.length) open = winners;
  else if (open.some((m) => !NOT_GAME.has(m.sportsMarketTypeV2 ?? ''))) return { lines: [], error: 'no winner market' };
  if (open.length === 1) return { lines: sides(open[0]!, e.title) };

  const lines = open.flatMap((m): UsLine[] => {
    const price = mid(m);
    // "AC Milan (Reg. Time)" is AC Milan; "Tie (Reg. Time)", Tie.
    return Number.isFinite(price) ? [{ name: m.title.replace(/ \(Reg\. Time\)$/, ''), price, market: m.slug }] : [];
  });
  const priced = open.filter((m) => Number.isFinite(mid(m)));
  const terms = priced.map((m) => m.assetPriceTerms);
  const strikes = terms.map((t) => Number(t?.strike?.value));
  if (strikes.every(Number.isFinite)) return chooseOutcomes(lines, false, strikes);
  const ranges = terms.every((t) => t?.marketType === 'ASSET_PRICE_MARKET_TYPE_RANGE');
  const total = priced.filter(quoted).reduce((sum, m) => sum + mid(m), 0);
  const exclusive = ranges || !!e.tags?.some((t) => t.slug === 'neg-risk') || Math.abs(total - 1) <= 0.15;
  const numbers = lines.map((l) => Number(l.name.replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0] ?? NaN));
  return chooseOutcomes(lines, exclusive, numbers.every(Number.isFinite) ? numbers : undefined);
}

/** Markets each event needed history for last time, for the request estimate (2 until fetched). */
const historyCounts = new Map<string, number>();

export const polymarketUs: PredictionSource = {
  id: 'polymarketus',
  label: 'Polymarket US',

  requestsPerUpdate(req) {
    // The events, then each charted market's history: one market per request.
    return 1 + (req.points ? (req.history ?? req.markets).reduce((n, m) => n + (historyCounts.get(m) ?? 2), 0) : 0);
  },

  estimateMs(req) {
    return gateway.estimateMs(this.requestsPerUpdate(req));
  },

  async fetch(req, signal) {
    const out = new Map<string, PredictionData>(req.markets.map((m) => [m, { market: m, title: m, outcomes: [] }]));
    const result = () => req.markets.map((m) => out.get(m)!);

    // Rule 2: every event in one request. History is one market per request (there's no batch endpoint).
    let charted: { d: PredictionData; lines: UsLine[] }[];
    try {
      const { events } = await gateway.get<{ events: UsEvent[] }>(`/v1/events?${req.markets.map((m) => `slug=${encodeURIComponent(m)}`).join('&')}`, signal);
      charted = req.markets.flatMap((m) => {
        const d = out.get(m)!;
        const e = events.find((x) => x.slug === m);
        if (!e) {
          d.error = 'unknown market';
          return [];
        }
        d.title = e.title;
        const { lines, other, error } = pickUs(e);
        // Current prices even if the history can't be had.
        d.outcomes = lines.map((l) => ({ name: l.name, price: l.price, history: [] }));
        if (other) d.other = other;
        if (lines.length === 0) d.error = error ?? 'closed';
        historyCounts.set(m, new Set(lines.map((l) => l.market)).size);
        return lines.length ? [{ d, lines }] : [];
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      for (const d of out.values()) d.error ??= describeError(e);
      return result();
    }

    // Rule 3: from just far enough back to fill the chart, at the chosen spacing.
    const now = Math.floor(Date.now() / 1000);
    const drawn = charted.filter((c) => !req.history || req.history.includes(c.d.market));
    const markets = req.points ? [...new Set(drawn.flatMap((c) => c.lines.map((l) => l.market)))] : [];
    const history = new Map<string, { timestamp: number; longPrice: number }[]>();
    await Promise.all(markets.map(async (m) => {
      try {
        const res = await gateway.get<{ history?: { timestamp: number; longPrice: number }[] }>(
          `/v1/price-history?symbol=${encodeURIComponent(m)}&timestamp.startTimestamp=${now - req.points * req.interval * 60}&timestamp.endTimestamp=${now}&fidelity=${req.interval}`,
          signal);
        history.set(m, res.history ?? []);
      } catch (e) {
        // One market's history failing leaves just its line without one.
        if (isAbort(e)) throw e;
      }
    }));

    for (const { d, lines } of charted) {
      d.outcomes = lines.map((l) => {
        const points = (history.get(l.market) ?? []).map((h) => ({ time: h.timestamp, p: l.complement ? 1 - h.longPrice : h.longPrice }));
        // The latest display price, where there is one: a market without
        // quotes has a bid of 0 and an ask of 1, which says nothing.
        return { name: l.name, price: points.at(-1)?.p ?? l.price, history: points };
      });
    }
    return result();
  },
};

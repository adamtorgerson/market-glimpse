import { describeError, isAbort } from './http';
import { api, info, INTERVALS } from './hyperliquid';
import { chooseOutcomes, type Chosen, type ExploredEvent, type PredictionData, type PredictionSource } from './prediction';
import { EXPLORE_COUNT } from './types';

/**
 * Hyperliquid's outcome markets (HIP-4), through the exchange source's
 * `PublicApi`: one host, so one rate limit. An outcome is a market of two sides
 * (Yes and No, or two teams), coin `#<10 * outcome + side>`. A question groups
 * the outcomes of which exactly one wins. Most names are templates, filled in
 * from a pipe-delimited description ("perp:BTC|target:85000|time:20261201-0000").
 */
export interface HlOutcome {
  outcome: number;
  name: string;
  description: string;
  sideSpecs: { name: string }[];
  /** Part of the name in its URL. None on recurring markets. */
  venue?: string;
}

export interface HlQuestion {
  question: number;
  name: string;
  description: string;
  /** Wins if none of the named ones does. It's listed, but has no price. */
  fallbackOutcome: number;
  namedOutcomes: number[];
  settledNamedOutcomes: number[];
}

export interface HlMeta {
  outcomes: HlOutcome[];
  questions: HlQuestion[];
}

/** How Hyperliquid names a market (`outcomeTemplates`), as `name: "template:priceTouch"` refers to it. */
export interface HlTemplate {
  id: string;
  /** With `{keyword}`s, from its description: "{perp} touches {target} by {time}". */
  name: string;
  role: string | { standaloneOutcome?: { sideNames: [string, string] }; questionOutcome?: { parent: string } };
  /** Each keyword, and what kind of value it has. */
  keywords: [string, string][];
}

/**
 * A coin's 24h figures, from `spotMetaAndAssetCtxs`. Mark prices rather than
 * mids: on a thin book a mid says little (a bid of 0.0002 and an ask of 0.96),
 * and on a liquid one they're about the same.
 */
export interface HlCtx {
  coin: string;
  markPx: string;
  prevDayPx: string;
  /** In shares, the same on both sides of a market. */
  dayBaseVlm: string;
}

interface HlMarket {
  outcome: number;
  name: string;
  /** A ladder rung's strike. */
  order?: number;
}

export interface HlEvent {
  /** What identifies it: `q579`, `o5112`, `touch-btc-20261201-0000`. */
  key: string;
  /** The key, and for a question or outcome, its title, to read in a watchlist. */
  slug: string;
  title: string;
  /** Unix seconds. */
  endTime?: number;
  markets: HlMarket[];
  /** A market's two sides, for an event of one market. */
  sides: [string, string];
  /** Exactly one of its markets wins. */
  exclusive: boolean;
  /** All of those are listed, so their prices should add up to about 1 (a tournament lists only the favourites). */
  complete: boolean;
  /** Its markets are the rungs of a ladder. */
  ladder: boolean;
  /** Opened within the day, so its price from a day ago says nothing. */
  noDayChange: boolean;
}

/** An outcome to chart, before its history is fetched. */
export interface HlLine {
  name: string;
  price: number;
  /** The coin whose candles are its history, or for the second side, the complement of them. */
  coin: string;
  complement?: boolean;
  volume?: number;
  change?: number;
}

export interface HlPick extends Chosen<HlLine> {
  total?: number;
  /** All its markets' 24h volume, charted or not. */
  volume?: number;
  error?: string;
}

const fieldsOf = (description: string): Record<string, string> =>
  Object.fromEntries(description.split('|').flatMap((part) => {
    const at = part.indexOf(':');
    return at > 0 ? [[part.slice(0, at), part.slice(at + 1).trim()]] : [];
  }));

const untemplated = (name: string) => name.replace(/^template:/, '');
const number = (s: string) => Number(s).toLocaleString('en-US');
/** "xyz:SP500" (a perp on the xyz dex) is SP500. */
const asset = (perp: string) => perp.replace(/^\w+:/, '');
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A "20261201-0000" time, in UTC, to unix seconds. */
export function parseHlTime(time: string | undefined): number | undefined {
  const m = time?.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)$/);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) / 1000 : undefined;
}

/** "Dec 1", or with a time where it matters, "Nov 6 08:00"; with the year if it's not this one. */
function formatTime(time: string, dateOnly = false): string {
  const seconds = parseHlTime(time);
  if (seconds === undefined) return time;
  const d = new Date(seconds * 1000);
  const day = `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
  const year = d.getUTCFullYear() === new Date().getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`;
  return dateOnly || /-(0000|2359)$/.test(time) ? day + year : `${day}${year} ${time.slice(9, 11)}:${time.slice(11)}`;
}

/** When it ends, by whichever of these its template has. A game's is its deadline to resolve, a week or so after it. */
const endOf = (f: Record<string, string>) =>
  parseHlTime(f.time ?? f.expiry ?? f.dateTime ?? f.scheduledDecision ?? f.listingDeadline ?? f.resolutionDeadline);

function sidesOf(o: HlOutcome, f: Record<string, string>): [string, string] {
  const side = (i: number, fallback: string) =>
    untemplated(o.sideSpecs[i]?.name ?? fallback).replace(/\{(\w+)\}/g, (_, key: string) => f[key] ?? key);
  return [side(0, 'Yes'), side(1, 'No')];
}

const RATE_CHANGE: Record<string, string> = {
  'template:policyRateNoChange': 'No change',
  'template:policyRateDecrease': 'Decrease',
  'template:policyRateIncrease': 'Increase',
};

function questionTitle(q: HlQuestion, f: Record<string, string>): string {
  if (f.participantA && f.participantB) return `${f.participantA} vs ${f.participantB}`;
  if (q.name === 'template:sportsTournamentWinner') return `${f.competition} ${f.season} winner`;
  if (q.name === 'template:policyRateDecision') return `${f.institution === 'Federal Open Market Committee' ? 'Fed' : f.institution} decision, ${f.decisionLabel}`;
  if (f.class === 'priceBucket') return `${f.underlying} price on ${formatTime(f.expiry!)}`;
  return untemplated(q.name);
}

function marketName(o: HlOutcome, f: Record<string, string>, questionFields: Record<string, string>): string {
  if (f.participant) return f.participant;
  if (o.name === 'template:sportsContestDraw2') return 'Draw';
  if (RATE_CHANGE[o.name]) return RATE_CHANGE[o.name]!;
  if (questionFields.class === 'priceBucket' && questionFields.priceThresholds && f.index !== undefined) {
    // The ranges, lowest first, between the thresholds.
    const edges = questionFields.priceThresholds.split(',');
    const i = Number(f.index);
    if (i === 0) return `under ${number(edges[0]!)}`;
    return i >= edges.length ? `over ${number(edges.at(-1)!)}` : `${number(edges[i - 1]!)}-${number(edges[i]!)}`;
  }
  return untemplated(o.name);
}

/** A market as one rung of a ladder of its kind: what it's called together, alone, and within the ladder. */
function rungOf(o: HlOutcome, f: Record<string, string>): { key: string; many: string; one: string; name: string; order: number } | undefined {
  const price = (kind: string, name: string, strike: string, time: string, on: string) => ({
    key: `${kind}-${slugify(asset(name))}-${time}`,
    many: `${asset(name)} ${kind} ${on} ${formatTime(time)}`,
    one: `${asset(name)} ${kind} ${number(strike)} ${on} ${formatTime(time)}`,
    name: number(strike),
    order: Number(strike),
  });
  if (o.name === 'template:binaryPrice' && f.perp && f.threshold && f.time) return price('above', f.perp, f.threshold, f.time, 'on');
  if (o.name === 'Recurring' && f.class === 'priceBinary' && f.underlying && f.targetPrice && f.expiry) return price('above', f.underlying, f.targetPrice, f.expiry, 'on');
  if (o.name === 'template:priceTouch' && f.perp && f.target && f.time) return price('touch', f.perp, f.target, f.time, 'by');
  if (o.name === 'template:companyIpoFirstDayMarketCap' && f.company && f.marketCapThresholdB && f.listingDeadline) {
    const cap = `$${number(f.marketCapThresholdB)}B`;
    return {
      key: `ipo-cap-${slugify(f.company)}-${f.listingDeadline}`,
      many: `${f.company} IPO cap by ${formatTime(f.listingDeadline, true)}`,
      one: `${f.company} IPO cap ${cap} by ${formatTime(f.listingDeadline, true)}`,
      name: cap,
      order: Number(f.marketCapThresholdB),
    };
  }
  return undefined;
}

function outcomeTitle(o: HlOutcome, f: Record<string, string>): string {
  if (f.participantA && f.participantB) return `${f.participantA} vs ${f.participantB}`;
  if (o.name === 'template:companyIpoConfirmed' && f.company && f.dateTime) return `${f.company} IPO by ${formatTime(f.dateTime)}`;
  return untemplated(o.name);
}

/** The events on offer: each question, each ladder of standalone outcomes, and the rest on their own. */
export function hlEvents(meta: HlMeta): HlEvent[] {
  const byId = new Map(meta.outcomes.map((o) => [o.outcome, o]));
  const asked = new Set(meta.questions.flatMap((q) => [...q.namedOutcomes, q.fallbackOutcome]));
  const base = { sides: ['Yes', 'No'] as [string, string], exclusive: false, complete: false, ladder: false, noDayChange: false };

  const questions = meta.questions.map((q): HlEvent => {
    const f = fieldsOf(q.description);
    const title = questionTitle(q, f);
    const key = `q${q.question}`;
    return {
      ...base,
      key,
      slug: `${key}-${slugify(title)}`,
      title,
      endTime: endOf(f),
      markets: q.namedOutcomes.filter((id) => !q.settledNamedOutcomes.includes(id)).flatMap((id) => {
        const o = byId.get(id);
        return o ? [{ outcome: id, name: marketName(o, fieldsOf(o.description), f) }] : [];
      }),
      exclusive: true,
      complete: q.name !== 'template:sportsTournamentWinner',
      noDayChange: !!f.period,
    };
  });

  const ladders = new Map<string, { o: HlOutcome; f: Record<string, string>; rung: NonNullable<ReturnType<typeof rungOf>> }[]>();
  const alone: HlEvent[] = [];
  for (const o of meta.outcomes) {
    if (asked.has(o.outcome)) continue;
    const f = fieldsOf(o.description);
    const rung = rungOf(o, f);
    if (rung) {
      ladders.set(rung.key, [...(ladders.get(rung.key) ?? []), { o, f, rung }]);
      continue;
    }
    const title = outcomeTitle(o, f);
    const key = `o${o.outcome}`;
    alone.push({ ...base, key, slug: `${key}-${slugify(title)}`, title, endTime: endOf(f), markets: [{ outcome: o.outcome, name: title }], sides: sidesOf(o, f), noDayChange: !!f.period });
  }

  const ladderEvents = [...ladders].map(([key, rungs]): HlEvent => {
    const { o, f, rung } = rungs[0]!;
    return {
      ...base,
      key,
      slug: key,
      title: rungs.length === 1 ? rung.one : rung.many,
      endTime: endOf(f),
      markets: rungs.map((r) => ({ outcome: r.o.outcome, name: r.rung.name, order: r.rung.order })),
      sides: sidesOf(o, f),
      ladder: true,
      noDayChange: !!f.period,
    };
  });
  return [...questions, ...ladderEvents, ...alone];
}

/** Each ladder's rungs as events of their own, for a link to just one: not listed, or they'd swamp Explore. */
export function hlRungEvents(meta: HlMeta): HlEvent[] {
  const asked = new Set(meta.questions.flatMap((q) => [...q.namedOutcomes, q.fallbackOutcome]));
  return meta.outcomes.flatMap((o) => {
    const f = fieldsOf(o.description);
    const rung = asked.has(o.outcome) ? undefined : rungOf(o, f);
    if (!rung) return [];
    const key = `o${o.outcome}`;
    return [{
      key, slug: key, title: rung.one, endTime: endOf(f), markets: [{ outcome: o.outcome, name: rung.name }],
      sides: sidesOf(o, f), exclusive: false, complete: false, ladder: false, noDayChange: !!f.period,
    }];
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Hyperliquid's own way of making a name into a URL. */
const urlPart = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

/** "20261201-0000" as its URLs have it: "Dec 1 at 12:00 AM UTC". */
function urlTime(time: string): string {
  const m = time.match(/^\d{4}(\d\d)(\d\d)-(\d\d)(\d\d)$/);
  if (!m) return time;
  const hours = +m[3]!;
  return `${MONTHS[+m[1]! - 1]} ${+m[2]!} at ${hours % 12 || 12}:${m[4]} ${hours >= 12 ? 'PM' : 'AM'} UTC`;
}

/** The date in a recurring market's URL: "nov-05-0600". */
const urlExpiry = (expiry: string) => `${(MONTHS[+expiry.slice(4, 6) - 1] ?? '').toLowerCase()}-${expiry.slice(6, 8)}-${expiry.slice(9, 13)}`;

/** A template's text filled in, or undefined if a keyword has no value. Times read "at …", so "at {time}" becomes "on {time}". */
function fill(text: string, t: HlTemplate, f: Record<string, string>): string | undefined {
  if (t.keywords.some(([k]) => f[k] === undefined)) return undefined;
  let out = text;
  for (const [k, kind] of t.keywords) {
    const slot = `{${k}}`;
    if (kind === 'dateTime') out = out.split(`${slot} UTC`).join(slot).replace(new RegExp(`(^|[^A-Za-z])([Aa])t \\{${k}\\}`, 'g'), (_, before: string, a: string) => `${before}${a === 'A' ? 'On' : 'on'} ${slot}`);
    out = out.split(slot).join(kind === 'dateTime' ? urlTime(f[k]!) : f[k]!);
  }
  return out;
}

/**
 * What each of Hyperliquid's URLs refers to: "out:btc-touches-75000-by-dec-1-at-1200-am-utc-yes"
 * to the outcome, or if it's one of a question's, the question. Each side of
 * each outcome has one, the same way the site builds them: its venue, and the
 * names of its question, itself and its side. Also without the venue, as
 * they're shared across venues; null where that could be several.
 */
export function hlUrls(meta: HlMeta, templates: HlTemplate[]): Map<string, string | null> {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const templateOf = (name: string) => (name.startsWith('template:') ? byId.get(name.slice(9)) : undefined);
  const outcomes = new Map(meta.outcomes.map((o) => [o.outcome, o]));
  const parents = new Map(meta.questions.flatMap((q) => [...q.namedOutcomes, q.fallbackOutcome].map((id) => [id, q] as const)));
  const urls = new Map<string, string | null>();

  const questionName = (q: HlQuestion): string => {
    const t = templateOf(q.name);
    const venue = [q.fallbackOutcome, ...q.namedOutcomes].some((id) => outcomes.get(id)?.venue !== undefined);
    const f = fieldsOf(q.description);
    const named = t?.role === 'question' && venue ? fill(t.name, t, f) : undefined;
    if (named) return named;
    return f.class === 'priceBucket' && f.expiry ? `${f.underlying} price range ${urlExpiry(f.expiry)}` : q.name;
  };

  /** Its name, and its sides' names. */
  const outcomeNames = (o: HlOutcome, q: HlQuestion | undefined): [string, string, string] => {
    const f = fieldsOf(o.description), raw = o.sideSpecs.map((s) => s.name);
    const t = o.venue === undefined ? undefined : templateOf(o.name);
    if (t && typeof t.role !== 'string') {
      const { standaloneOutcome: alone, questionOutcome: within } = t.role;
      const parent = q?.name.startsWith('template:') ? q.name.slice(9) : undefined;
      const name = alone || within?.parent === parent ? fill(t.name, t, f) : undefined;
      if (name) {
        const sides = alone?.sideNames.map((s) => fill(s, t, f));
        return [name, sides?.[0] ?? raw[0]!, sides?.[1] ?? raw[1]!];
      }
    }
    const bucket = q ? fieldsOf(q.description) : undefined;
    if (bucket?.class === 'priceBucket' && bucket.priceThresholds && f.index) {
      const [low, high] = bucket.priceThresholds.split(',');
      return [[`Below ${low}`, `${low} to ${high}`, `Above ${high}`][+f.index] ?? o.name, raw[0]!, raw[1]!];
    }
    if (o.name === 'Recurring' && f.class === 'priceBinary') return [`${f.underlying} above ${f.targetPrice}`, raw[0]!, raw[1]!];
    return [o.name, raw[0]!, raw[1]!];
  };

  for (const o of meta.outcomes) {
    const q = parents.get(o.outcome);
    const [name, ...sides] = outcomeNames(o, q);
    const f = fieldsOf(o.description);
    const key = q ? `q${q.question}` : `o${o.outcome}`;
    for (const side of sides) {
      const own = `${name}-${side}`;
      const whole = q ? `${questionName(q)}-${own}` : o.name === 'Recurring' && f.class === 'priceBinary' && f.expiry ? `${own}-${urlExpiry(f.expiry)}` : own;
      const bare = urlPart(whole);
      if (o.venue !== undefined) urls.set(`${urlPart(o.venue)}:${bare}`, key);
      // Named the same on another venue (one IPO's market caps, by different deadlines): say so.
      urls.set(bare, urls.has(bare) && urls.get(bare) !== key ? null : key);
    }
  }
  return urls;
}

/**
 * The outcomes to chart. One market is its two sides. Several are chosen by
 * `chooseOutcomes`, without those that have never traded: their mark is a
 * meaningless 0.5, just what a ladder looks for.
 */
export function pickHl(e: HlEvent, ctxs: ReadonlyMap<string, HlCtx>): HlPick {
  const priced = e.markets.flatMap((m) => {
    const coin = `#${m.outcome * 10}`;
    const c = ctxs.get(coin);
    const price = Number(c?.markPx), previous = Number(c?.prevDayPx), volume = Number(c?.dayBaseVlm);
    if (!c || !Number.isFinite(price) || (!(previous > 0) && !(volume > 0))) return [];
    return [{ m, line: { name: m.name, price, coin, volume, change: previous > 0 && !e.noDayChange ? price - previous : undefined } as HlLine }];
  });
  if (priced.length === 0) return { lines: [], error: e.markets.length ? 'no trades yet' : 'closed' };
  const volume = priced.reduce((sum, x) => sum + x.line.volume!, 0);
  if (e.markets.length === 1) {
    const { line } = priced[0]!;
    return {
      volume,
      lines: [
        { ...line, name: e.sides[0] },
        { name: e.sides[1], price: 1 - line.price, coin: line.coin, complement: true, change: line.change === undefined ? undefined : -line.change },
      ],
    };
  }
  const lines = priced.map((x) => x.line);
  const chosen = chooseOutcomes(lines, e.exclusive, e.ladder ? priced.map((x) => x.m.order!) : undefined);
  return { ...chosen, volume, ...(e.complete ? { total: lines.reduce((sum, l) => sum + l.price, 0) } : {}) };
}

/** What a slug of ours refers to: the title on a question's or outcome's is just to read. */
const keyOf = (slug: string) => slug.match(/^[qo]\d+(?=-|$)/)?.[0] ?? slug;

/** The list changes slowly and is about 100KB, so it's kept a while, unless an event being asked for isn't on it. */
const META_TTL_MS = 10 * 60_000;
const META_RECHECK_MS = 60_000;
/** Explore's ranking and the fetch straight after it share one set of prices (about 350KB). */
const CTX_TTL_MS = 3000;

interface Loaded {
  at: number;
  raw: HlMeta;
  /** What's listed. */
  events: Map<string, HlEvent>;
  /** Those and each ladder's rungs alone. */
  all: Map<string, HlEvent>;
  /** Only once a URL is asked for: the templates are about 50KB more. */
  urls?: Map<string, string | null>;
}

let meta: Loaded | null = null;
let prices: { at: number; ctxs: Map<string, HlCtx> } | null = null;

const metaFresh = () => !!meta && Date.now() - meta.at < META_TTL_MS;

async function loadMeta(signal: AbortSignal): Promise<Loaded> {
  const raw = await info<HlMeta>({ type: 'outcomeMeta' }, signal);
  const events = hlEvents(raw);
  const byKey = (list: HlEvent[]) => list.map((e) => [e.key, e] as const);
  return meta = { at: Date.now(), raw, events: new Map(byKey(events)), all: new Map([...byKey(hlRungEvents(raw)), ...byKey(events)]) };
}

async function loadUrls(m: Loaded, signal: AbortSignal): Promise<Map<string, string | null>> {
  return m.urls ??= hlUrls(m.raw, await info<HlTemplate[]>({ type: 'outcomeTemplates' }, signal));
}

/** What each of `markets` refers to, or null where a URL without its venue could be several. */
async function resolveEvents(markets: string[], signal: AbortSignal): Promise<Map<string, HlEvent | null | undefined>> {
  let m = metaFresh() ? meta! : await loadMeta(signal);
  const ours = (s: string) => m.all.has(keyOf(s));
  if (!markets.every(ours)) {
    let urls = await loadUrls(m, signal);
    // Listed since? Not more than once a minute.
    if (!markets.every((s) => ours(s) || urls.has(s)) && Date.now() - m.at >= META_RECHECK_MS) {
      m = await loadMeta(signal);
      urls = await loadUrls(m, signal);
    }
    return new Map(markets.map((s) => {
      const key = ours(s) ? keyOf(s) : urls.get(s);
      return [s, key === null ? null : key === undefined ? undefined : m.all.get(key)];
    }));
  }
  return new Map(markets.map((s) => [s, m.all.get(keyOf(s))]));
}

async function loadPrices(signal: AbortSignal): Promise<Map<string, HlCtx>> {
  if (!prices || Date.now() - prices.at >= CTX_TTL_MS) {
    // Rule 2: every coin's price, change and volume, in one request.
    const [, ctxs] = await info<[unknown, HlCtx[]]>({ type: 'spotMetaAndAssetCtxs' }, signal);
    prices = { at: Date.now(), ctxs: new Map(ctxs.filter((c) => c.coin.startsWith('#')).map((c) => [c.coin, c])) };
  }
  return prices.ctxs;
}

/** Most traded events whose leading market's book is looked up, for liquidity, and how long the ranking is kept. */
const BOOK_POOL = 12;
const BOOK_TTL_MS = 10 * 60_000;
let liquid: { at: number; found: ExploredEvent[] } | null = null;
const liquidFresh = () => !!liquid && Date.now() - liquid.at < BOOK_TTL_MS;

export interface HlBookLevel {
  px: string;
  sz: string;
}

/** The dollars on a book's visible levels (it shows up to 20 a side), both sides. */
export function bookMoney(levels: HlBookLevel[][]): number {
  return levels.flat().reduce((sum, l) => sum + (+l.px * +l.sz || 0), 0);
}

/** Shares a market must have traded in 24h for its move to count: a few can swing a thin book's price anywhere. */
const MOVER_MIN_VOLUME = 1000;

/** Markets each event needed history for last time, for the request estimate (2 until fetched). */
const historyCounts = new Map<string, number>();

export const hyperliquidOutcomes: PredictionSource = {
  id: 'hyperliquidoutcomes',
  label: 'HL Outcomes',
  eventInput: 'a Hyperliquid link or its name, or from Explore',

  requestsPerUpdate(req) {
    // Every price at once, then each charted market's candles: one coin per
    // request. The event list is too rare to count against the refresh rate.
    return 1 + (req.points ? (req.history ?? req.markets).reduce((n, m) => n + (historyCounts.get(m) ?? 2), 0) : 0);
  },

  estimateMs(req) {
    return api.estimateMs(this.requestsPerUpdate(req) + (metaFresh() ? 0 : 1));
  },

  exploreNote: 'Events traded in the last 24h. Prices on thinly traded markets can be well off.',

  exploreRequests(by) {
    if (by === 'liquidity' && liquidFresh()) return 0;
    return (metaFresh() ? 1 : 2) + (by === 'liquidity' ? BOOK_POOL : 0);
  },

  async explore(by, signal) {
    if (by === 'liquidity' && liquidFresh()) return liquid!.found;
    const { events } = metaFresh() ? meta! : await loadMeta(signal);
    const ctxs = await loadPrices(signal);
    const now = Date.now() / 1000;
    const leadingCoins = new Map<string, string>();
    const ranked: ExploredEvent[] = [...events.values()].flatMap((e) => {
      if (e.endTime !== undefined && e.endTime <= now) return [];
      const traded = pickHl(e, ctxs).lines.filter((l) => l.volume! > 0);
      if (traded.length === 0) return [];
      const moved = traded.filter((l) => l.change !== undefined && l.volume! >= MOVER_MIN_VOLUME)
        .reduce<HlLine | undefined>((best, l) => (!best || Math.abs(l.change!) > Math.abs(best.change!) ? l : best), undefined);
      const leading = traded.reduce((best, l) => (l.volume! > best.volume! ? l : best));
      leadingCoins.set(e.slug, leading.coin);
      return [{ market: e.slug, title: e.title, volume: leading.volume, change: moved?.change }];
    });
    if (by === 'movers') return ranked.filter((f) => f.change !== undefined).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!)).slice(0, EXPLORE_COUNT);
    ranked.sort((a, b) => b.volume! - a.volume!);
    if (by !== 'liquidity') return ranked.slice(0, EXPLORE_COUNT);

    // One book per request: the most traded events' leading markets.
    const pool: ExploredEvent[] = [];
    for (const f of ranked.slice(0, BOOK_POOL)) {
      try {
        const { levels } = await info<{ levels: HlBookLevel[][] }>({ type: 'l2Book', coin: leadingCoins.get(f.market) }, signal);
        const liquidity = bookMoney(levels);
        if (liquidity > 0) pool.push({ ...f, liquidity });
      } catch (err) {
        // Without its book, it's just not ranked.
        if (isAbort(err)) throw err;
      }
    }
    const found = pool.sort((a, b) => b.liquidity! - a.liquidity!).slice(0, EXPLORE_COUNT);
    if (found.length) liquid = { at: Date.now(), found };
    return found;
  },

  async fetch(req, signal, onProgress) {
    const out = new Map<string, PredictionData>(req.markets.map((m) => [m, { market: m, title: m, outcomes: [] }]));
    const result = () => req.markets.map((m) => out.get(m)!);

    let charted: { d: PredictionData; lines: HlLine[] }[];
    try {
      const events = await resolveEvents(req.markets, signal);
      const ctxs = await loadPrices(signal);
      charted = req.markets.flatMap((m) => {
        const d = out.get(m)!;
        const e = events.get(m);
        if (!e) {
          d.error = e === null ? 'on several venues: add its prefix' : 'unknown market';
          return [];
        }
        d.title = e.title;
        if (e.endTime !== undefined) d.endTime = e.endTime;
        const { lines, other, total, volume, error } = pickHl(e, ctxs);
        if (volume !== undefined) d.dayVolume = volume;
        d.outcomes = lines.map((l) => ({ name: l.name, price: l.price, history: [], dayVolume: l.volume, dayChange: l.change }));
        if (other) d.other = other;
        if (total !== undefined) d.total = total;
        if (error) d.error = error;
        historyCounts.set(m, new Set(lines.map((l) => l.coin)).size);
        return lines.length ? [{ d, lines }] : [];
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      for (const d of out.values()) d.error ??= describeError(e);
      return result();
    }
    onProgress?.(result());

    // Rule 3: from just far enough back to fill the chart, at the chosen spacing.
    const drawn = charted.filter((c) => !req.history || req.history.includes(c.d.market));
    const coins = req.points ? [...new Set(drawn.flatMap((c) => c.lines.map((l) => l.coin)))] : [];
    const startTime = Date.now() - req.points * req.interval * 60_000;
    const history = new Map<string, { time: number; p: number }[]>();
    await Promise.all(coins.map(async (coin) => {
      try {
        const rows = await info<{ t: number; c: string }[] | null>(
          { type: 'candleSnapshot', req: { coin, interval: INTERVALS[req.interval], startTime } }, signal);
        history.set(coin, (rows ?? []).slice(-req.points).map((r) => ({ time: r.t / 1000, p: +r.c })));
      } catch (e) {
        // One market's history failing leaves just its line without one.
        if (isAbort(e)) throw e;
      }
    }));

    for (const { d, lines } of charted) {
      d.outcomes = lines.map((l) => ({
        name: l.name,
        price: l.price,
        history: (history.get(l.coin) ?? []).map((h) => ({ time: h.time, p: l.complement ? 1 - h.p : h.p })),
        dayVolume: l.volume,
        dayChange: l.change,
      }));
    }
    return result();
  },
};

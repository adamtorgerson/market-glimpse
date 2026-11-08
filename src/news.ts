/**
 * Headlines from the news sources (`sources/news.ts`): reading them, working
 * out which mention what's being monitored, and which are new. No requests or
 * drawing here.
 */
import { canonAsset } from './sources/symbols';

export interface NewsArticle {
  /** Plain text, in characters the glasses' font has. */
  title: string;
  /** http(s) only, as it's opened from the phone page; '' if the feed gave nothing usable. */
  link: string;
  /** Publication time, unix seconds. */
  time: number;
  /** News source id. */
  source: string;
}

/** An article, and the labels of the markets (or events) it mentions. */
export interface NewsMatch extends NewsArticle {
  about: string[];
}

/** A monitored market or event, as far as headlines go. */
export interface NewsTarget {
  /** The market or slug, as in `MarketData.market`. */
  key: string;
  /** How it's named beside a headline. */
  label: string;
  /** How it's named in the phone's list of automatic filters. */
  name: string;
  /** What it's found by, for that list: "BTC, Bitcoin". */
  findBy: string;
  matches(title: string): boolean;
}

/** Headlines listed on the phone page. */
export const MAX_NEWS_LIST = 25;
/** An article older than this isn't "new", and doesn't mark a market in the lists. */
export const NEWS_RECENT_SEC = 24 * 3600;
/** Articles kept per source: the feeds carry 10–30, and older ones may still be on a chart. */
const MAX_PER_SOURCE = 100;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
    const n = code[1]!.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });
}

/** Typographic punctuation the glasses' font may lack, as plain text. */
const PLAIN: Record<string, string> = { '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '–': '-', '—': '-', '−': '-', '…': '...', ' ': ' ' };

/** A headline as text the glasses can show: no markup or entities, and nothing past Latin-1 (emoji, say). */
export function plainHeadline(raw: string): string {
  return decodeEntities(raw.replace(/<!\[CDATA\[|\]\]>/g, ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/[‘’‚“”–—−… ]/g, (c) => PLAIN[c]!)
    .replace(/[^\x20-\x7e\u00a1-\u00ff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A feed's link, if it's safe to put on the page: a feed's other schemes
 * (`javascript:`) would run in the app when tapped.
 */
export function safeLink(raw: string): string {
  try {
    const url = new URL(decodeEntities(raw.replace(/<!\[CDATA\[|\]\]>/g, '').trim()));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

/** A date from a feed, in unix seconds; null if unreadable. CNBC leaves out the seconds, which not every WebView parses. */
export function parseNewsTime(raw: string): number | null {
  const ms = Date.parse(raw.trim().replace(/ (\d\d:\d\d) (GMT|UT|[+-]\d{4})$/, ' $1:00 $2'));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** An RSS feed's items. Those without a headline or a readable date are left out. */
export function parseRss(xml: string, source: string): NewsArticle[] {
  const field = (item: string, tag: string) => new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(item)?.[1] ?? '';
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].flatMap(([item]) => {
    const title = plainHeadline(field(item, 'title'));
    const time = parseNewsTime(field(item, 'pubDate'));
    return title && time !== null ? [{ title, link: safeLink(field(item, 'link')), time, source }] : [];
  });
}

/** Names headlines use for the assets people chart: the rest are found by ticker alone. */
const ASSET_NAMES: Record<string, string[]> = {
  BTC: ['Bitcoin'], ETH: ['Ethereum', 'Ether'], SOL: ['Solana'], XRP: ['Ripple'], DOGE: ['Dogecoin'], ADA: ['Cardano'],
  LTC: ['Litecoin'], DOT: ['Polkadot'], LINK: ['Chainlink'], AVAX: ['Avalanche'], BNB: ['Binance Coin'], TRX: ['Tron'],
  SUI: ['Sui'], XLM: ['Stellar Lumens'], BCH: ['Bitcoin Cash'], SHIB: ['Shiba Inu'], PEPE: ['Pepe'], UNI: ['Uniswap'],
  ATOM: ['Cosmos'], AAVE: ['Aave'], ZEC: ['Zcash'], XMR: ['Monero'], TON: ['Toncoin'], APT: ['Aptos'], ARB: ['Arbitrum'],
  NEAR: ['NEAR Protocol'], INJ: ['Injective'], ETC: ['Ethereum Classic'], HYPE: ['Hyperliquid'],
  TSLA: ['Tesla'], NVDA: ['Nvidia'], AAPL: ['Apple'], MSFT: ['Microsoft'], GOOGL: ['Alphabet', 'Google'], GOOG: ['Alphabet', 'Google'],
  AMZN: ['Amazon'], META: ['Meta'], COIN: ['Coinbase'], MSTR: ['MicroStrategy'], HOOD: ['Robinhood'], AMD: ['AMD'],
  INTC: ['Intel'], NFLX: ['Netflix'], PLTR: ['Palantir'], CRCL: ['Circle Internet'],
};

/** Uppercase words in headlines that are also tickers. */
const NOT_TICKERS = new Set(['AI', 'US', 'USA', 'UK', 'EU', 'IT', 'ON', 'TV', 'IPO', 'ETF', 'CEO', 'CFO', 'FED', 'SEC', 'GDP', 'CPI', 'NFT', 'DEX', 'ALL', 'NOW', 'NEW', 'BIG', 'ONE', 'GAS']);

/** `term` as a whole word (not BTC in BTCUSD); not with a lookbehind, which older WebViews can't even parse. */
function wordRegExp(term: string, flags: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, `u${flags}`);
}

/**
 * A market, found in a headline by its asset's ticker (in capitals, as "SOL"
 * isn't "sol") or, in any case, its name. A stock token's spellings ("TSLAX",
 * "XTSLA") are its ticker's.
 */
export function marketTarget(market: string): NewsTarget {
  const asset = canonAsset(market.split('-')[0] ?? '');
  const ticker = [asset, asset.replace(/X$/, ''), asset.replace(/^X/, '')].find((t) => ASSET_NAMES[t]) ?? asset;
  const terms = [...(ticker.length >= 2 && !NOT_TICKERS.has(ticker) ? [ticker] : []), ...(ASSET_NAMES[ticker] ?? [])];
  const tests = terms.map((term, i) => wordRegExp(term, i === 0 && term === ticker ? '' : 'i'));
  return { key: market, label: ticker, name: market, findBy: [...new Set(terms)].join(', '), matches: (title) => tests.some((t) => t.test(title)) };
}

/** Longest a news filter is kept. */
export const MAX_NEWS_FILTER = 40;

/** A news filter as stored: in the same plain text as headlines (a phone's curly apostrophe would never match them), trimmed and within the limit. */
export function cleanNewsFilter(raw: unknown): string {
  return typeof raw === 'string' ? plainHeadline(raw).slice(0, MAX_NEWS_FILTER).trim() : '';
}

/** A user's news filter, found in a headline as whole words, in any case. */
export function filterTarget(filter: string): NewsTarget {
  const test = wordRegExp(filter, 'i');
  return { key: `filter:${filter}`, label: filter, name: filter, findBy: filter, matches: (title) => test.test(title) };
}

/** A headline hit by any of `excludes`: it's left out whatever else it mentions. */
function excluded(title: string, excludes: NewsTarget[]): boolean {
  return excludes.some((x) => x.matches(title));
}

/** Words too common in events' titles to say a headline is about one. */
const EVENT_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'will', 'who', 'what', 'when', 'which', 'where', 'how', 'why', 'does', 'did', 'has', 'have', 'been', 'are', 'was', 'were', 'this', 'that', 'than', 'from', 'into', 'over', 'under', 'above', 'below', 'after', 'before', 'between', 'during', 'end', 'ends', 'next', 'more', 'most', 'less', 'least', 'any', 'not', 'yes', 'out', 'off', 'all', 'its', 'his', 'her', 'their', 'our', 'you', 'your', 'first', 'last', 'new', 'win', 'wins', 'winner', 'winners', 'won', 'lose', 'loses', 'loser', 'price', 'prices', 'hit', 'hits', 'reach', 'reaches', 'high', 'low', 'market', 'markets', 'largest', 'biggest', 'company', 'companies', 'year', 'years', 'month', 'months', 'week', 'weeks', 'day', 'days', 'today', 'tomorrow', 'up', 'down', 'closing', 'close', 'closes', 'open', 'opens', 'number', 'much', 'many', 'champion', 'champions',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

/**
 * An event, found in a headline by any asset its title names ("What price will
 * Bitcoin hit"), or else two of its title's distinctive words (one, if it has
 * only one): a title's words are a rough guide, and one alone is too easily
 * about something else.
 */
export function eventTarget(slug: string, title: string): NewsTarget {
  const assetNames = Object.values(ASSET_NAMES).flat().filter((name) => wordRegExp(name, 'i').test(title));
  const assets = assetNames.map((name) => wordRegExp(name, 'i'));
  const wordList = [...new Set((title.toLowerCase().match(/\p{L}[\p{L}\p{N}'-]*/gu) ?? []).map((w) => w.replace(/'s$/, '')))]
    .filter((w) => w.length >= 3 && !EVENT_STOP_WORDS.has(w));
  const words = wordList.map((w) => wordRegExp(w, 'i'));
  const needed = Math.min(2, words.length);
  // For the list: with an asset named, a headline naming it is a hit already, so only the other words add anything.
  const lowerAssets = new Set(assetNames.map((n) => n.toLowerCase()));
  const others = wordList.filter((w) => !lowerAssets.has(w));
  const byWords = others.length < needed ? '' : needed === 1 ? others[0]! : `2 of ${others.join(', ')}`;
  return {
    key: slug,
    label: title,
    name: title,
    findBy: [assetNames.join(', '), byWords].filter(Boolean).join('; or '),
    matches: (headline) => assets.some((t) => t.test(headline)) || (needed > 0 && words.filter((t) => t.test(headline)).length >= needed),
  };
}

/** Headlines of the same story from two sources count as one. */
function storyKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * The articles fetched so far, and which haven't been announced. An article is
 * new if it's recent and hasn't been fetched before. In a source's first fetch
 * it must also be newer than `seenUntil`: that's all there is to go on after a
 * relaunch, and the only thing a feed's backlog can be told apart by.
 */
export class NewsStore {
  private readonly articles = new Map<string, NewsArticle[]>();
  private readonly seen = new Set<string>();
  private fresh: NewsArticle[] = [];

  /** @param seenUntil When headlines last went up (unix seconds), from an earlier launch if any. */
  constructor(public seenUntil = 0) {}

  /** A source's latest articles, kept with its earlier ones, as a feed's items soon drop off it. */
  add(source: string, articles: NewsArticle[], nowSec: number): void {
    const first = !this.articles.has(source);
    for (const a of articles) {
      const key = storyKey(a.title);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      if (a.time > nowSec - NEWS_RECENT_SEC && (!first || a.time > this.seenUntil)) this.fresh.push(a);
    }
    const latest = new Set(articles.map((a) => storyKey(a.title)));
    const kept = (this.articles.get(source) ?? []).filter((a) => !latest.has(storyKey(a.title)));
    this.articles.set(source, [...articles, ...kept].sort((a, b) => b.time - a.time).slice(0, MAX_PER_SOURCE));
  }

  /** Articles from `sources` mentioning any of `targets` and none of `excludes`, newest first, each story once. */
  matches(sources: string[], targets: NewsTarget[], excludes: NewsTarget[] = []): NewsMatch[] {
    const stories = new Map<string, NewsMatch>();
    for (const source of sources) {
      for (const a of this.articles.get(source) ?? []) {
        const key = storyKey(a.title);
        if (stories.has(key) || excluded(a.title, excludes)) continue;
        const about = targets.filter((t) => t.matches(a.title)).map((t) => t.label);
        if (about.length) stories.set(key, { ...a, about: [...new Set(about)] });
      }
    }
    return [...stories.values()].sort((a, b) => b.time - a.time);
  }

  /**
   * The new articles from `sources` mentioning `targets` and none of
   * `excludes`, newest first, once each: they count as announced from here. New
   * ones mentioning none of them (they may be another source's list's), or an
   * exclude, are dropped too.
   */
  takeNew(sources: string[], targets: NewsTarget[], excludes: NewsTarget[] = []): NewsMatch[] {
    const taken = this.fresh.flatMap((a) => {
      if (!sources.includes(a.source) || excluded(a.title, excludes)) return [];
      const about = targets.filter((t) => t.matches(a.title)).map((t) => t.label);
      return about.length ? [{ ...a, about: [...new Set(about)] }] : [];
    });
    this.fresh = [];
    return taken.sort((a, b) => b.time - a.time);
  }
}

/**
 * Publication times of the articles among `articles` mentioning `target` or
 * hitting any of `filters`, for its chart. A filter isn't about any one market,
 * so it doesn't make `recent`, which marks the ones mentioned in a list.
 */
export function newsMarks(articles: NewsArticle[], target: NewsTarget, nowSec: number, filters: NewsTarget[] = []): { times: number[]; recent: boolean } | undefined {
  const own = articles.filter((a) => target.matches(a.title));
  const times = articles.filter((a) => target.matches(a.title) || filters.some((f) => f.matches(a.title))).map((a) => a.time);
  return times.length ? { times, recent: own.some((a) => a.time > nowSec - NEWS_RECENT_SEC) } : undefined;
}

/** A headline's time, as on the charts: "14:32". */
export function headlineTime(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export interface PopupLine {
  /** On a headline's first line. */
  time?: string;
  /** On a new headline's first line. */
  fresh?: boolean;
  text: string;
}

/**
 * As many of `items` as `maxLines` holds, one line of `width` each (measured by
 * `measure`), cut short to fit. Lines left over let the first that need it run
 * on to a second.
 */
export function layoutHeadlines(items: { title: string; time: number; fresh?: boolean }[], measure: (s: string) => number, width: number, maxLines: number): PopupLine[] {
  const shown = items.slice(0, maxLines);
  let spare = maxLines - shown.length;
  return shown.flatMap((item) => {
    const first = { time: headlineTime(item.time), ...(item.fresh ? { fresh: true } : {}) };
    const [line, rest] = wrapHeadline(item.title, measure, width);
    if (rest === undefined) return [{ ...first, text: line }];
    if (spare === 0) return [{ ...first, text: fitHeadline(item.title, measure, width) }];
    spare--;
    return [{ ...first, text: line }, { text: rest }];
  });
}

/** `s`, cut short with "..." to fit `width`. */
function fitHeadline(s: string, measure: (s: string) => number, width: number): string {
  if (measure(s) <= width) return s;
  let cut = s;
  while (cut.length > 1 && measure(`${cut}...`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

/** A headline on one line, or if it doesn't fit, two: the second cut short if need be. */
function wrapHeadline(title: string, measure: (s: string) => number, width: number): [string, string?] {
  const words = title.split(' ');
  let first = '';
  while (words.length) {
    const next = first ? `${first} ${words[0]}` : words[0]!;
    if (first && measure(next) > width) break;
    first = next;
    words.shift();
  }
  return words.length ? [fitHeadline(first, measure, width), fitHeadline(words.join(' '), measure, width)] : [fitHeadline(first, measure, width)];
}

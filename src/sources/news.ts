/**
 * News sources: headlines fetched alongside the market data, one request per
 * source. They follow the rules in http.ts, and a failure only shows in the
 * News section: it never holds up or fails a chart.
 */
import { NewsStore, parseNewsTime, parseRss, plainHeadline, safeLink, type NewsArticle } from '../news';
import { describeError, isAbort, PublicApi } from './http';

export interface NewsSource {
  id: string;
  label: string;
  /**
   * Least time between requests, however often the charts update. Feeds are
   * cached for about a minute, so sooner would find nothing new. `cv`'s
   * x-ratelimit-limit header says 20 an hour (10 when first checked), so it's
   * asked at most 10 times an hour.
   */
  minAgeMs: number;
  /** Fetched through Jina Reader: these share its rate limit, so at most `MAX_JINA_SOURCES` can be ticked. */
  viaJina?: boolean;
  fetch(signal: AbortSignal): Promise<NewsArticle[]>;
}

function rssSource(id: string, label: string, api: PublicApi, path: string): NewsSource {
  return { id, label, minAgeMs: 60_000, fetch: async (signal) => parseRss(await api.getText(path, signal), id) };
}

interface CvArticle {
  title?: string;
  link?: string;
  pubDate?: string;
  sourceKey?: string;
}

/** Its readings of market data, as headlines that change with every number: they'd be "new" on every fetch. */
const CV_NOT_NEWS = new Set(['etherscan_gas', 'fear_greed', 'blockchain_stats', 'system']);

const cvApi = new PublicApi('https://cryptocurrency.cv');

/** Crypto Vision's breaking news, from the crypto press: its `/api/news` gives only 3 items without a key, mostly stock earnings. */
const cryptocurrencyCv: NewsSource = {
  id: 'cv',
  label: 'cryptocurrency.cv',
  minAgeMs: 6 * 60_000,
  fetch: async (signal) => {
    const body = await cvApi.get<{ articles?: CvArticle[] }>('/api/breaking', signal);
    return (body.articles ?? []).flatMap((a) => {
      const title = plainHeadline(a.title ?? '');
      const time = parseNewsTime(a.pubDate ?? '');
      if (!title || time === null || CV_NOT_NEWS.has(a.sourceKey ?? '')) return [];
      return [{ title, link: safeLink(a.link ?? ''), time, source: 'cv' }];
    });
  },
};

/** Serves both MarketWatch and WSJ, so they share its rate limit. */
const dowJonesApi = new PublicApi('https://feeds.content.dowjones.io');

/**
 * Jina Reader fetches a feed for us, for those that send no CORS headers. All
 * its feeds share one rate limit: 20 requests a minute without a key. Kept to
 * well under that: one request every 5s at most, each feed asked at most every
 * 5 minutes, and at most 3 ticked. That also has the third sent by 10s, in time
 * for `REQUEST_TIMEOUT_MS`, which counts its wait in the queue.
 */
const jinaApi = new PublicApi('https://r.jina.ai', 5_000);
export const JINA_MIN_AGE_MS = 5 * 60_000;
export const MAX_JINA_SOURCES = 3;

/** `url`'s RSS through Jina Reader, which returns it as is when asked for "html". */
function jinaRssSource(id: string, label: string, url: string): NewsSource {
  return {
    id,
    label,
    minAgeMs: JINA_MIN_AGE_MS,
    viaJina: true,
    fetch: async (signal) => parseRss(await jinaApi.getText(`/${url}`, signal, { 'X-Return-Format': 'html' }), id),
  };
}

export const NEWS_SOURCES: readonly NewsSource[] = [
  rssSource('cnbc', 'CNBC', new PublicApi('https://www.cnbc.com'), '/id/100003114/device/rss/rss.html'),
  rssSource('marketwatch', 'MarketWatch', dowJonesApi, '/public/rss/mw_topstories'),
  rssSource('wsj', 'WSJ Markets', dowJonesApi, '/public/rss/RSSMarketsMain'),
  rssSource('bitcoincom', 'Bitcoin.com', new PublicApi('https://news.bitcoin.com'), '/feed/'),
  cryptocurrencyCv,
  jinaRssSource('coindesk', 'CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/'),
  jinaRssSource('theblock', 'The Block', 'https://www.theblock.co/rss.xml'),
  jinaRssSource('cryptoslate', 'CryptoSlate', 'https://cryptoslate.com/feed/'),
  jinaRssSource('decrypt', 'Decrypt', 'https://decrypt.co/feed'),
  jinaRssSource('cointelegraph', 'Cointelegraph', 'https://cointelegraph.com/rss'),
  jinaRssSource('ft', 'FT Markets', 'https://www.ft.com/markets?format=rss'),
  jinaRssSource('elitetrader', 'Elite Trader', 'https://www.elitetrader.com/et/forums/-/index.rss'),
  jinaRssSource('sntrading', 'Stacker News ~trading', 'https://stacker.news/~trading/rss'),
  jinaRssSource('snbitcoin', 'Stacker News ~bitcoin', 'https://stacker.news/~bitcoin/rss'),
];

export const NEWS_SOURCE_IDS: readonly string[] = NEWS_SOURCES.map((s) => s.id);
export const JINA_SOURCE_IDS: ReadonlySet<string> = new Set(NEWS_SOURCES.filter((s) => s.viaJina).map((s) => s.id));

/** A source that hasn't answered by then is left to the next update. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The chosen sources' articles, kept up to date no more often than each allows. */
export class NewsFeeds {
  readonly store = new NewsStore();
  /** Why a source's last request failed, by id. */
  readonly errors = new Map<string, string>();
  private readonly lastTried = new Map<string, number>();
  private readonly sources: readonly NewsSource[];

  constructor(sources: readonly NewsSource[] = NEWS_SOURCES) {
    this.sources = sources;
  }

  /** Fetch those of `ids` due a request, each resolving when it's in. Never rejects. */
  async refresh(ids: string[], signal: AbortSignal, now = Date.now()): Promise<void> {
    const due = this.sources.filter((s) => ids.includes(s.id) && now - (this.lastTried.get(s.id) ?? -Infinity) >= s.minAgeMs);
    await Promise.all(due.map(async (s) => {
      // A failed one waits its turn too: asking again sooner wouldn't help a source over its limit.
      this.lastTried.set(s.id, now);
      const ctrl = new AbortController();
      const stop = () => ctrl.abort(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      const timer = setTimeout(() => ctrl.abort(new Error('timed out')), REQUEST_TIMEOUT_MS);
      try {
        this.store.add(s.id, await s.fetch(ctrl.signal), Math.floor(Date.now() / 1000));
        this.errors.delete(s.id);
      } catch (e) {
        if (!isAbort(e) || !signal.aborted) this.errors.set(s.id, describeError(e));
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
      }
    }));
  }
}

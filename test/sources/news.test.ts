/**
 * Headlines: reading the feeds, what mentions what, what counts as new, and
 * laying them out to fit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../../app.json';
import { cleanNewsFilter, eventTarget, filterTarget, layoutHeadlines, marketTarget, newsMarks, NewsStore, parseNewsTime, parseRss, plainHeadline, safeLink, type NewsArticle } from '../../src/news';
import { MIN_GAP_MS } from '../../src/sources/http';
import { NEWS_SOURCES, NewsFeeds, type NewsSource } from '../../src/sources/news';
import { sanitize } from '../../src/settings';

const NOW = Date.UTC(2026, 10, 5, 21) / 1000;
const article = (title: string, ageSec = 60, source = 'cnbc'): NewsArticle => ({ title, link: 'https://example.com/a', time: NOW - ageSec, source });

afterEach(() => vi.unstubAllGlobals());

describe('reading a feed', () => {
  // As CNBC and MarketWatch send them: CDATA and entities, and CNBC's dates without seconds.
  const xml = `<rss><channel><title>Top News</title><item>
      <link>https://www.cnbc.com/2026/11/05/a.html</link>
      <title>Wall Street&apos;s fear gauge &amp; Bitcoin</title>
      <description><![CDATA[Not a <b>headline</b>.]]></description>
      <pubDate>Thu, 05 Nov 2026 20:46 GMT</pubDate>
    </item><item>
      <title><![CDATA[&#x2018;No safety net&#x2019; — I’m 66]]></title>
      <link><![CDATA[https://www.marketwatch.com/story/b?mod=rss&amp;x=1]]></link>
      <pubDate>Thu, 05 Nov 2026 20:45:00 GMT</pubDate>
    </item><item><title>No date</title><link>https://x.test/c</link></item></channel></rss>`;
  const items = parseRss(xml, 'cnbc');

  it('takes each item, leaving out the channel\'s title and any with no date', () => {
    expect(items.map((a) => a.title)).toEqual(["Wall Street's fear gauge & Bitcoin", "'No safety net' - I'm 66"]);
  });

  it('reads dates with or without seconds', () => {
    expect(items[0]!.time).toBe(Date.UTC(2026, 10, 5, 20, 46) / 1000);
    expect(items[1]!.time).toBe(Date.UTC(2026, 10, 5, 20, 45) / 1000);
    expect(parseNewsTime('2026-11-05T21:18:07.000Z')).toBe(Date.UTC(2026, 10, 5, 21, 18, 7) / 1000);
    expect(parseNewsTime('soon')).toBeNull();
  });

  it('decodes links', () => {
    expect(items[1]!.link).toBe('https://www.marketwatch.com/story/b?mod=rss&x=1');
  });

  it('keeps only http(s) links, as they\'re tapped in the app', () => {
    expect(safeLink('javascript:alert(1)')).toBe('');
    expect(safeLink('data:text/html,x')).toBe('');
    expect(safeLink('not a url')).toBe('');
    expect(safeLink('https://decrypt.co/1')).toBe('https://decrypt.co/1');
  });

  it('leaves out what the glasses\' font lacks', () => {
    expect(plainHeadline('⛽ Gas 🐢 <i>now</i> … fine')).toBe('Gas now ... fine');
  });
});

describe('what a headline mentions', () => {
  it('finds a market by its ticker or asset name', () => {
    const btc = marketTarget('BTC-USDC');
    expect(btc.label).toBe('BTC');
    expect(btc.matches('BTC slides 6%')).toBe(true);
    expect(btc.matches('$BTC slides')).toBe(true);
    expect(btc.matches("Bitcoin's fall deepens")).toBe(true);
    expect(btc.matches('bitcoin falls')).toBe(true);
    expect(btc.matches('Stocks fall')).toBe(false);
  });

  it('wants the whole word', () => {
    expect(marketTarget('BTC-USDC').matches('BTCUSD 30M: A reversal')).toBe(false);
    expect(marketTarget('ETH-USDC').matches('Tether rises')).toBe(false);
    expect(marketTarget('ETH-USDC').matches('Ether rises')).toBe(true);
  });

  it('takes a ticker in capitals only, and not words headlines capitalize anyway', () => {
    expect(marketTarget('SOL-USD').matches('Sol is out')).toBe(false);
    expect(marketTarget('SOL-USD').matches('SOL jumps')).toBe(true);
    expect(marketTarget('AI-USD').matches('AI meltdown hits chip stocks')).toBe(false);
  });

  it('knows a stock however its token is typed, and Kraken\'s code for a coin', () => {
    for (const m of ['TSLA', 'TSLAX-USD', 'XTSLA-USDT']) expect(marketTarget(m).matches('Tesla beats estimates')).toBe(true);
    expect(marketTarget('XBT-USD').matches('Bitcoin falls')).toBe(true);
  });

  it('finds an event by an asset its title names', () => {
    expect(eventTarget('s', 'What price will Bitcoin hit before 2027?').matches('Bitcoin falls 6%')).toBe(true);
  });

  it('otherwise needs two of its title\'s distinctive words', () => {
    const election = eventTarget('s', 'Presidential Election Winner 2028');
    expect(election.matches('Early polls in the presidential election')).toBe(true);
    expect(election.matches('Presidential library opens')).toBe(false);
    expect(election.matches('Winner announced in December')).toBe(false);
  });

  it('makes do with the one word a title has', () => {
    expect(eventTarget('s', 'Will Anthropic IPO?').matches('Anthropic hires')).toBe(false);
    expect(eventTarget('s', 'Anthropic?').matches('Anthropic hires')).toBe(true);
    expect(eventTarget('s', 'Will it?').matches('Anything')).toBe(false);
  });
});

describe('a news filter', () => {
  it('hits a headline with it as a whole word, in any case', () => {
    const fed = filterTarget('Fed');
    expect(fed.matches('Fed holds rates')).toBe(true);
    expect(fed.matches('Why the fed waited')).toBe(true);
    expect(fed.matches("The Fed's call")).toBe(true);
    expect(fed.matches('Federal budget passes')).toBe(false);
  });

  it('can be a phrase, or have what a regular expression would take for syntax', () => {
    expect(filterTarget('rate cut').matches('Hopes of a Rate Cut fade')).toBe(true);
    expect(filterTarget('rate cut').matches('A cut in the rate')).toBe(false);
    expect(filterTarget('S&P 500').matches('S&P 500 falls')).toBe(true);
    expect(filterTarget('C++ (new)').matches('Learn C++ (new) today')).toBe(true);
    expect(filterTarget('a.b').matches('axb')).toBe(false);
  });

  it('is kept in the same plain text as headlines', () => {
    expect(cleanNewsFilter('  Musk\u2019s   pay ')).toBe("Musk's pay");
    expect(filterTarget(cleanNewsFilter('Musk\u2019s')).matches(plainHeadline('Elon Musk\u2019s Tesla'))).toBe(true);
    expect(cleanNewsFilter(7)).toBe('');
    expect(cleanNewsFilter('x'.repeat(99))).toHaveLength(40);
  });

  it('makes a headline a hit: listed, new, and named beside it', () => {
    const store = new NewsStore();
    store.add('cnbc', [article('Zebra crossing opens')], NOW);
    const hits = [marketTarget('BTC-USDC'), filterTarget('zebra')];
    expect(store.matches(['cnbc'], hits)[0]!.about).toEqual(['zebra']);
    expect(store.takeNew(['cnbc'], hits).map((a) => a.title)).toEqual(['Zebra crossing opens']);
  });

  it('marks every chart with its hits, but no market in a list', () => {
    const marks = newsMarks([article('Zebra crossing opens', 100)], marketTarget('BTC-USDC'), NOW, [filterTarget('zebra')]);
    expect(marks).toEqual({ times: [NOW - 100], recent: false });
  });

  it('leaves a market\'s own mentions marking it in a list', () => {
    const marks = newsMarks([article('Zebra crossing opens', 100), article('Bitcoin falls', 50)], marketTarget('BTC-USDC'), NOW, [filterTarget('zebra')]);
    expect(marks).toEqual({ times: [NOW - 100, NOW - 50], recent: true });
  });
});

describe('what counts as new', () => {
  const targets = [marketTarget('BTC-USDC')];

  it('is a recent article on the first launch, from its first fetch', () => {
    const store = new NewsStore();
    store.add('cnbc', [article('Bitcoin falls')], NOW);
    expect(store.takeNew(['cnbc'], targets).map((a) => a.title)).toEqual(['Bitcoin falls']);
  });

  it('after a relaunch, is only what came out since headlines last went up, though the rest is listed', () => {
    const store = new NewsStore(NOW - 100);
    store.add('cnbc', [article('Bitcoin falls', 200), article('Bitcoin rebounds', 50)], NOW);
    expect(store.takeNew(['cnbc'], targets).map((a) => a.title)).toEqual(['Bitcoin rebounds']);
    expect(store.matches(['cnbc'], targets)).toHaveLength(2);
  });

  it('is an article that reaches a feed late, once it\'s been fetched before', () => {
    const store = new NewsStore(NOW - 100);
    store.add('cnbc', [], NOW);
    store.add('cnbc', [article('Bitcoin falls', 200)], NOW);
    expect(store.takeNew(['cnbc'], targets).map((a) => a.title)).toEqual(['Bitcoin falls']);
  });

  it('is an article not seen before, once', () => {
    const store = new NewsStore();
    store.add('cnbc', [article('Bitcoin falls')], NOW);
    expect(store.takeNew(['cnbc'], targets)).toHaveLength(1);
    store.add('cnbc', [article('Bitcoin falls'), article('Bitcoin rebounds')], NOW);
    expect(store.takeNew(['cnbc'], targets).map((a) => a.title)).toEqual(['Bitcoin rebounds']);
    expect(store.takeNew(['cnbc'], targets)).toEqual([]);
  });

  it('isn\'t an old article that\'s just reached the feed', () => {
    const store = new NewsStore();
    store.add('cnbc', [], NOW);
    store.add('cnbc', [article('Bitcoin of old', 25 * 3600)], NOW);
    expect(store.takeNew(['cnbc'], targets)).toEqual([]);
  });

  it('isn\'t an article that mentions nothing monitored, even if the list changes later', () => {
    const store = new NewsStore();
    store.add('cnbc', [], NOW);
    store.add('cnbc', [article('Stocks fall')], NOW);
    expect(store.takeNew(['cnbc'], targets)).toEqual([]);
    expect(store.takeNew(['cnbc'], [marketTarget('TSLA')])).toEqual([]);
  });

  it('counts a story carried by two sources once, wherever it\'s worded alike', () => {
    const store = new NewsStore();
    store.add('cnbc', [], NOW);
    store.add('cv', [], NOW);
    store.add('cnbc', [article('Bitcoin falls 6%')], NOW);
    store.add('cv', [article('Bitcoin Falls: 6%', 60, 'cv')], NOW);
    expect(store.takeNew(['cnbc', 'cv'], targets)).toHaveLength(1);
    expect(store.matches(['cnbc', 'cv'], targets)).toHaveLength(1);
  });

  it('leaves out sources no longer ticked', () => {
    const store = new NewsStore();
    store.add('cnbc', [article('Bitcoin falls')], NOW);
    expect(store.matches(['marketwatch'], targets)).toEqual([]);
  });

  it('keeps articles that have dropped off the feed', () => {
    const store = new NewsStore();
    store.add('cnbc', [article('Bitcoin falls')], NOW);
    store.add('cnbc', [article('Stocks rise')], NOW);
    expect(store.matches(['cnbc'], targets).map((a) => a.title)).toEqual(['Bitcoin falls']);
  });
});

describe('a market\'s marks', () => {
  it('gives each mention\'s time, and is recent only within a day', () => {
    const target = marketTarget('BTC-USDC');
    expect(newsMarks([article('Bitcoin falls', 100), article('Stocks', 50)], target, NOW)).toEqual({ times: [NOW - 100], recent: true });
    expect(newsMarks([article('Bitcoin falls', 25 * 3600)], target, NOW)!.recent).toBe(false);
    expect(newsMarks([article('Stocks')], target, NOW)).toBeUndefined();
  });
});

describe('headlines laid out to fit', () => {
  const measure = (s: string) => s.length;
  const item = (title: string, fresh = false) => ({ title, time: NOW, fresh });

  it('gives each headline a line of its own when there are enough to fill them, cut short', () => {
    const lines = layoutHeadlines([item('one two three four'), item('five six seven eight'), item('nine')], measure, 9, 3);
    expect(lines.map((l) => l.text)).toEqual(['one tw...', 'five s...', 'nine']);
    expect(lines.every((l) => l.time)).toBe(true);
  });

  it('shows no more than fit', () => {
    expect(layoutHeadlines(Array.from({ length: 25 }, (_, i) => item(`h${i}`)), measure, 9, 10)).toHaveLength(10);
  });

  it('lets the first that need it run on to a second line, with lines to spare', () => {
    const lines = layoutHeadlines([item('one two three four'), item('five six seven eight')], measure, 9, 3);
    expect(lines.map((l) => l.text)).toEqual(['one two', 'three...', 'five s...']);
    expect(lines[0]!.time).toBeDefined();
    expect(lines[1]!.time).toBeUndefined();
    expect(lines[2]!.time).toBeDefined();
  });

  it('marks a new headline\'s first line only', () => {
    const lines = layoutHeadlines([item('one two three four', true), item('old')], measure, 9, 3);
    expect(lines.map((l) => l.fresh ?? false)).toEqual([true, false, false]);
  });

  it('cuts a single word too long for the line', () => {
    expect(layoutHeadlines([item('x'.repeat(30))], measure, 10, 2).map((l) => l.text)).toEqual(['xxxxxxx...']);
  });
});

describe('fetching', () => {
  const source = (id: string, minAgeMs: number, fetch: NewsSource['fetch']): NewsSource => ({ id, label: id, minAgeMs, fetch });

  it('asks only the ticked sources', async () => {
    const asked: string[] = [];
    const feeds = new NewsFeeds([
      source('a', 0, async () => { asked.push('a'); return []; }),
      source('b', 0, async () => { asked.push('b'); return []; }),
    ]);
    await feeds.refresh(['b'], new AbortController().signal);
    expect(asked).toEqual(['b']);
  });

  it('waits out a source\'s least time between requests, however often it\'s asked', async () => {
    let n = 0;
    const feeds = new NewsFeeds([source('a', 60_000, async () => { n++; return []; })]);
    const { signal } = new AbortController();
    await feeds.refresh(['a'], signal, 1_000_000);
    await feeds.refresh(['a'], signal, 1_059_999);
    expect(n).toBe(1);
    await feeds.refresh(['a'], signal, 1_060_000);
    expect(n).toBe(2);
  });

  it('keeps cryptocurrency.cv within its 10 requests an hour', () => {
    expect(NEWS_SOURCES.find((s) => s.id === 'cv')!.minAgeMs).toBeGreaterThanOrEqual(3600_000 / 10);
  });

  it('reports a failure without rejecting, and waits its turn before trying again', async () => {
    let n = 0;
    const feeds = new NewsFeeds([source('a', 60_000, async () => { n++; throw new TypeError('Failed to fetch'); })]);
    const { signal } = new AbortController();
    await feeds.refresh(['a'], signal, 1_000_000);
    await feeds.refresh(['a'], signal, 1_000_001);
    expect(n).toBe(1);
    expect(feeds.errors.get('a')).toBe('offline or blocked');
  });

  it('clears the error once a request works', async () => {
    let fail = true;
    const feeds = new NewsFeeds([source('a', 0, async () => { if (fail) throw new Error('HTTP 429'); return []; })]);
    const { signal } = new AbortController();
    await feeds.refresh(['a'], signal);
    expect(feeds.errors.get('a')).toBe('HTTP 429');
    fail = false;
    await feeds.refresh(['a'], signal);
    expect(feeds.errors.size).toBe(0);
  });

  const cv = NEWS_SOURCES.find((s) => s.id === 'cv')!;

  it('leaves out cryptocurrency.cv\'s market readings, which would be new every time', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ articles: [
      { title: '⛽ ETH Gas: 🐢 0.23 Gwei', link: 'https://etherscan.io/gastracker', pubDate: '2026-11-05T21:00:00.000Z', sourceKey: 'etherscan_gas' },
      { title: 'Crypto Fear &amp; Greed Index: 50', link: 'https://x.test', pubDate: '2026-11-05T00:00:00.000Z', sourceKey: 'fear_greed' },
      { title: 'Zcash &amp; friends', link: 'https://decrypt.co/1?a=1&amp;b=2', pubDate: '2026-11-05T20:00:00.000Z', sourceKey: 'decrypt' },
    ] })));
    const got = await cv.fetch(new AbortController().signal);
    expect(got.map((a) => a.title)).toEqual(['Zcash & friends']);
    expect(got[0]!.link).toBe('https://decrypt.co/1?a=1&b=2');
  });

  it('whitelists every source\'s host', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { urls.push(url); return new Response('<rss></rss>'); });
    await Promise.allSettled(NEWS_SOURCES.map((s) => s.fetch(new AbortController().signal)));
    expect(new Set(urls).size).toBe(NEWS_SOURCES.length);
    for (const url of urls) expect(app.permissions[0]!.whitelist).toContain(new URL(url).origin);
  });

  it('keeps sources on the same host to its rate limit', async () => {
    const sent = new Map<string, number[]>();
    vi.stubGlobal('fetch', async (url: string) => {
      const { origin } = new URL(url);
      sent.set(origin, [...(sent.get(origin) ?? []), Date.now()]);
      return new Response('<rss></rss>');
    });
    await Promise.allSettled(NEWS_SOURCES.map((s) => s.fetch(new AbortController().signal)));
    expect(sent.get('https://feeds.content.dowjones.io')).toHaveLength(2);
    for (const times of sent.values()) {
      for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(MIN_GAP_MS - 5);
    }
  });

  it('fits the network permission description within the store limit', () => {
    expect(app.permissions[0]!.desc.length).toBeLessThanOrEqual(300);
  });
});

describe('settings', () => {
  it('start with no news source', () => {
    expect(sanitize({}).newsSources).toEqual([]);
  });

  it('start with no news filters', () => {
    expect(sanitize({}).newsFilters).toEqual([]);
  });

  it('keep up to 8 news filters, without blanks or repeats in any case', () => {
    expect(sanitize({ newsFilters: [' Fed ', '', 'fed', 'rate cut'] }).newsFilters).toEqual(['Fed', 'rate cut']);
    expect(sanitize({ newsFilters: Array.from({ length: 12 }, (_, i) => `f${i}`) }).newsFilters).toHaveLength(8);
    expect(sanitize({ newsFilters: 'Fed' as unknown as string[] }).newsFilters).toEqual([]);
  });

  it('keep known sources, in their order, and drop the rest', () => {
    expect(sanitize({ newsSources: ['cv', 'gone', 'cnbc'] }).newsSources).toEqual(['cnbc', 'cv']);
    expect(sanitize({ newsSources: 'cnbc' as unknown as string[] }).newsSources).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MAX_CHARTS, MAX_MARKETS, MAX_WATCHLIST_NAME, MAX_WATCHLISTS, cleanWatchlistName, nextWatchlist, sanitize, storeWatchlist, watchlistKey } from '../../src/settings';

const list = (name: string, markets = ['BTC-USD'], charts: string[] = []) => ({ name, markets, charts });

describe('saved watchlists', () => {
  it('are kept by exchange as a group, and by each prediction market', () => {
    expect(watchlistKey('kraken')).toBe(watchlistKey('okx'));
    expect(watchlistKey('polymarket')).not.toBe(watchlistKey('kraken'));
    expect(watchlistKey('polymarket')).not.toBe(watchlistKey('polymarketus'));
  });

  it('start empty, including in settings saved before they existed', () => {
    const s = sanitize({ markets: ['BTC-USD'] });
    expect(Object.values(s.watchlists).flat()).toEqual([]);
    expect(Object.values(s.activeWatchlist).every((name) => name === '')).toBe(true);
  });

  it('survive being sanitized again, in each kind\'s own format', () => {
    const s = sanitize({
      watchlists: {
        exchange: [list(' Crypto ', ['btc/usd', 'ETH-USD', 'btc-usd'], ['eth-usd', 'SOL-USD'])],
        polymarket: [list('Elections', ['https://polymarket.com/event/some-event?tid=1'], [])],
      },
    });
    expect(s.watchlists.exchange).toEqual([list('Crypto', ['BTC-USD', 'ETH-USD'], ['ETH-USD'])]);
    expect(s.watchlists.polymarket![0]!.markets).toEqual(['some-event']);
    expect(JSON.stringify(sanitize(s))).toBe(JSON.stringify(s));
  });

  it('leave out what isn\'t a usable list', () => {
    const s = sanitize({
      watchlists: {
        exchange: [null, 'x', list(''), list('Empty', []), list('A'), list('a'), { name: 'No markets' }] as never,
        polymarket: 'nope' as never,
      },
    });
    expect(s.watchlists.exchange!.map((l) => l.name)).toEqual(['A']);
    expect(s.watchlists.polymarket).toEqual([]);
    expect(sanitize({ watchlists: 'nope' as never }).watchlists).toEqual(DEFAULT_SETTINGS.watchlists);
  });

  it('are held to the limits', () => {
    const many = Array.from({ length: MAX_MARKETS + 2 }, (_, i) => `M${i}-USD`);
    const lists = Array.from({ length: MAX_WATCHLISTS + 2 }, (_, i) => list(`L${i}`, many, many));
    const saved = sanitize({ watchlists: { exchange: lists } }).watchlists.exchange!;
    expect(saved).toHaveLength(MAX_WATCHLISTS);
    expect(saved[0]!.markets).toHaveLength(MAX_MARKETS);
    expect(saved[0]!.charts).toHaveLength(MAX_CHARTS);
    expect(cleanWatchlistName('x'.repeat(MAX_WATCHLIST_NAME + 5))).toHaveLength(MAX_WATCHLIST_NAME);
    expect(cleanWatchlistName(5)).toBe('');
  });

  it('keep ticks the candle width doesn\'t allow, for when it does again', () => {
    const s = sanitize({ candleWidth: 'text-wide', watchlists: { exchange: [list('A', ['BTC-USD', 'ETH-USD'], ['BTC-USD', 'ETH-USD'])] } });
    expect(s.watchlists.exchange![0]!.charts).toEqual(['BTC-USD', 'ETH-USD']);
  });

  it('are only chosen if they exist', () => {
    const watchlists = { exchange: [list('A')] };
    expect(sanitize({ watchlists, activeWatchlist: { exchange: 'A' } }).activeWatchlist.exchange).toBe('A');
    expect(sanitize({ watchlists, activeWatchlist: { exchange: 'B' } }).activeWatchlist.exchange).toBe('');
    expect(sanitize({ activeWatchlist: 'A' as never }).activeWatchlist.exchange).toBe('');
  });
});

describe('nextWatchlist', () => {
  const lists = [list('A'), list('B'), list('C')];

  it('goes on to the next, wrapping', () => {
    expect(nextWatchlist(lists, 'A')).toBe('B');
    expect(nextWatchlist(lists, 'C')).toBe('A');
  });

  it('starts from the first with none chosen', () => {
    expect(nextWatchlist(lists, '')).toBe('A');
    expect(nextWatchlist([list('A')], '')).toBe('A');
  });

  it('has none without another', () => {
    expect(nextWatchlist([], '')).toBeNull();
    expect(nextWatchlist([list('A')], 'A')).toBeNull();
  });
});

describe('storeWatchlist', () => {
  it('adds a new list at the end', () => {
    expect(storeWatchlist([list('A')], '', list('B')).map((l) => l.name)).toEqual(['A', 'B']);
  });

  it('saves over the chosen list, in its place', () => {
    const lists = storeWatchlist([list('A'), list('B')], 'A', list('A', ['ETH-USD']));
    expect(lists).toEqual([list('A', ['ETH-USD']), list('B')]);
  });

  it('renames the chosen list, even just its case', () => {
    expect(storeWatchlist([list('A'), list('B')], 'A', list('C')).map((l) => l.name)).toEqual(['C', 'B']);
    expect(storeWatchlist([list('a')], 'a', list('A')).map((l) => l.name)).toEqual(['A']);
  });

  it('refuses another list\'s name, whatever the case', () => {
    expect(() => storeWatchlist([list('A'), list('B')], 'A', list('b'))).toThrow('already');
    expect(() => storeWatchlist([list('A')], '', list('a'))).toThrow('already');
  });

  it('refuses a new list past the limit, but not an edit', () => {
    const full = Array.from({ length: MAX_WATCHLISTS }, (_, i) => list(`L${i}`));
    expect(() => storeWatchlist(full, '', list('New'))).toThrow('delete one');
    expect(storeWatchlist(full, 'L0', list('New'))[0]!.name).toBe('New');
  });
});

/**
 * Explore on every exchange and Polymarket, against the live APIs: the top
 * markets by volume and by 24h change, and that each can be monitored.
 */
import { describe, expect, it } from 'vitest';
import { SOURCES } from '../src/sources';
import { polymarket } from '../src/sources/polymarket';
import { polymarketUs } from '../src/sources/polymarketus';
import { DOLLARS } from '../src/sources/symbols';
import { EXPLORE_COUNT } from '../src/sources/types';

const signal = () => AbortSignal.timeout(90_000);

describe.concurrent.each(SOURCES.map((s) => [s.id, s] as const))('%s', (_id, source) => {
  it('finds the most traded markets in dollars, one per asset, that resolve again', async () => {
    const found = await source.explore('volume', 'USD', signal());
    expect(found).toHaveLength(EXPLORE_COUNT);
    const volumes = found.map((f) => f.quoteVolume);
    expect(volumes).toEqual([...volumes].sort((a, b) => b - a));
    const assets = found.map((f) => f.market.split('-')[0]);
    expect(new Set(assets).size).toBe(assets.length);
    for (const f of found) {
      expect(DOLLARS, f.market).toContain(f.market.split('-')[1]);
      expect(f.last, f.market).toBeGreaterThan(0);
    }
    // Monitored by name: each is the market it was found as.
    const resolved = await source.resolve(found.map((f) => f.market), 'USD', signal());
    expect(resolved.size).toBe(found.length);
  });

  it('finds the most liquid, by the money at the top of the book', async () => {
    const found = await source.explore('liquidity', 'USD', signal());
    expect(found.length).toBeGreaterThan(0);
    const money = found.map((f) => f.topOfBook!);
    expect(money.every((m) => m > 0)).toBe(true);
    expect(money).toEqual([...money].sort((a, b) => b - a));
  });

  it('finds the biggest movers, by the size of their change', async () => {
    const found = await source.explore('movers', 'USD', signal());
    expect(found.length).toBeGreaterThan(0);
    const changes = found.map((f) => Math.abs(f.change!));
    expect(changes.every(Number.isFinite)).toBe(true);
    expect(changes).toEqual([...changes].sort((a, b) => b - a));
  });
});

describe('polymarket', () => {
  it('finds the most traded events, and those that moved most', async () => {
    for (const by of ['volume', 'movers', 'liquidity'] as const) {
      const found = await polymarket.explore!(by, signal());
      expect(found.length, by).toBe(EXPLORE_COUNT);
      expect(new Set(found.map((f) => f.market)).size, by).toBe(EXPLORE_COUNT);
      // A game's "more markets" event has no winner to chart.
      expect(found.some((f) => f.market.endsWith('-more-markets')), by).toBe(false);
    }
  });
});

describe('polymarketus', () => {
  it('finds the most traded events (by total volume), each with something to chart', async () => {
    expect(polymarketUs.exploreRankings).toEqual(['volume', 'liquidity']);
    const found = await polymarketUs.explore!('volume', signal());
    expect(found).toHaveLength(EXPLORE_COUNT);
    expect(new Set(found.map((f) => f.market)).size).toBe(EXPLORE_COUNT);
    const data = await polymarketUs.fetch({ markets: found.map((f) => f.market), interval: 60, points: 0 }, signal());
    for (const d of data) expect(d.outcomes.length, d.market).toBeGreaterThan(0);
  });
});

describe('polymarketus liquidity', () => {
  it('ranks its most traded events by the money at the top of their leading market', async () => {
    const found = await polymarketUs.explore!('liquidity', signal());
    expect(found.length).toBeGreaterThan(0);
    const money = found.map((f) => f.liquidity!);
    expect(money.every((m) => m > 0)).toBe(true);
    expect(money).toEqual([...money].sort((a, b) => b - a));
    // Ranked for a while: the next asks again for the events only.
    expect(polymarketUs.exploreRequests!('liquidity')).toBe(1);
  });
});

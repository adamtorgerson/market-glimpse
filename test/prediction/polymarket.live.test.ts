/**
 * Polymarket, against the live API: events by slug, their outcomes, and
 * their history, in one request to each of its two APIs. The events run
 * until well after 2026.
 */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { polymarket } from '../src/sources/polymarket';
import { eventSlug, MAX_OUTCOMES } from '../src/sources/prediction';

const log: { host: string; method: string }[] = [];

beforeAll(() => {
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    log.push({ host: new URL(url).host, method: init?.method ?? 'GET' });
    return real(url, init);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

it('charts the likeliest outcomes of each event, with the rest as Other, in two requests', async () => {
  const markets = ['presidential-election-winner-2028', eventSlug('https://polymarket.com/event/balance-of-power-2026-midterms'), 'no-such-event-xyz'];
  const [president, midterms, missing] = await polymarket.fetch({ markets, interval: 60, points: 48 }, AbortSignal.timeout(60_000));

  // Dozens of candidates: the four likeliest, likeliest first, and the rest summed.
  expect(president!.title).toMatch(/Presidential Election/);
  expect(president!.outcomes).toHaveLength(MAX_OUTCOMES);
  const prices = president!.outcomes.map((o) => o.price);
  expect(prices).toEqual([...prices].sort((a, b) => b - a));
  expect(president!.other!.count).toBeGreaterThan(10);
  const total = prices.reduce((a, b) => a + b, 0) + president!.other!.price!;
  expect(total).toBeGreaterThan(0.8);
  expect(total).toBeLessThan(1.2);

  for (const d of [president!, midterms!]) {
    expect(d.error, d.market).toBeUndefined();
    for (const o of d.outcomes) {
      expect(o.price, o.name).toBeGreaterThanOrEqual(0);
      expect(o.price, o.name).toBeLessThanOrEqual(1);
      // Only as far back as asked for (48 hours), oldest first.
      expect(o.history.length, o.name).toBeGreaterThan(0);
      expect(o.history[0]!.time).toBeGreaterThan(Date.now() / 1000 - 49 * 3600);
      expect(o.history.map((h) => h.time)).toEqual(o.history.map((h) => h.time).sort((a, b) => a - b));
    }
  }
  expect(missing!.error).toBe('unknown market');

  // Rule 2: one GET for every event, one POST for every outcome's history.
  expect(log).toEqual([
    { host: 'gamma-api.polymarket.com', method: 'GET' },
    { host: 'clob.polymarket.com', method: 'POST' },
  ]);
});

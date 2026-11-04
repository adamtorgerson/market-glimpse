/**
 * Hyperliquid's outcome markets, against the live API: its most traded events,
 * charted, and one that doesn't exist.
 */
import { expect, it } from 'vitest';
import { PublicApi } from '../../src/sources/http';
import { hlUrls, hyperliquidOutcomes as source, type HlMeta, type HlTemplate } from '../../src/sources/hyperliquidoutcomes';

it('ranks events, charts their outcomes with history, and says which don\'t exist', async () => {
  const found = await source.explore!('volume', AbortSignal.timeout(30_000));
  expect(found.length).toBeGreaterThan(0);
  expect(found.every((f) => f.title && !f.title.includes('template') && f.volume! > 0)).toBe(true);
  const movers = await source.explore!('movers', AbortSignal.timeout(30_000));
  expect(movers.every((f, i) => i === 0 || Math.abs(f.change!) <= Math.abs(movers[i - 1]!.change!))).toBe(true);

  const top = found[0]!.market;
  const [event, missing] = await source.fetch({ markets: [top, 'q999999'], interval: 15, points: 40 }, AbortSignal.timeout(60_000));
  expect(event!.error).toBeUndefined();
  expect(event!.outcomes.length).toBeGreaterThan(1);
  for (const o of event!.outcomes) expect(o.price).toBeGreaterThanOrEqual(0);
  const history = event!.outcomes.flatMap((o) => o.history);
  expect(history.length).toBeGreaterThan(0);
  expect(history.every((h) => h.p >= 0 && h.p <= 1)).toBe(true);
  // Only as far back as asked for (10 hours).
  expect(Math.min(...history.map((h) => h.time))).toBeGreaterThan(Date.now() / 1000 - 11 * 3600);
  expect(missing!.error).toBe('unknown market');
}, 90_000);

it('takes a market by Hyperliquid\'s own name, with or without its venue, and says when that could be several', async () => {
  const lookup = new PublicApi('https://api.hyperliquid.xyz');
  const signal = () => AbortSignal.timeout(30_000);
  const meta = await lookup.post<HlMeta>('/info', { type: 'outcomeMeta' }, signal());
  const templates = await lookup.post<HlTemplate[]>('/info', { type: 'outcomeTemplates' }, signal());
  const urls = [...hlUrls(meta, templates)];
  const named = urls.find(([u, key]) => /^out:btc-touches-.*-yes$/.test(u) && key)?.[0];
  expect(named, 'no BTC price-touch market listed').toBeDefined();
  const ambiguous = urls.find(([, key]) => key === null)?.[0];

  const markets = [named!, named!.slice(4), ...(ambiguous ? [ambiguous] : [])];
  const [withVenue, without, several] = await source.fetch({ markets, interval: 60, points: 0 }, AbortSignal.timeout(60_000));
  expect(withVenue!.error).toBeUndefined();
  expect(withVenue!.title).toMatch(/^BTC touch [\d,]+ by /);
  expect(withVenue!.outcomes.map((o) => o.name)).toEqual(['Yes', 'No']);
  expect(without!.title).toBe(withVenue!.title);
  if (ambiguous) expect(several!.error).toMatch(/several venues/);
}, 90_000);

it('ranks events by the money on their leading market\'s book, and keeps the ranking', async () => {
  const found = await source.explore!('liquidity', AbortSignal.timeout(60_000));
  expect(found.length).toBeGreaterThan(0);
  expect(found.every((f) => f.title && f.liquidity! > 0)).toBe(true);
  expect(found.every((f, i) => i === 0 || f.liquidity! <= found[i - 1]!.liquidity!)).toBe(true);
  expect(source.exploreRequests!('liquidity')).toBe(0);
  expect(await source.explore!('liquidity', AbortSignal.timeout(1000))).toEqual(found);
}, 90_000);

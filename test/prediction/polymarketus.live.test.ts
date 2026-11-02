/**
 * Polymarket US, against the live API: a current daily Bitcoin up-or-down
 * event (they're dated, so it's looked up first), and one that doesn't exist.
 */
import { expect, it } from 'vitest';
import { PublicApi } from '../src/sources/http';
import { polymarketUs } from '../src/sources/polymarketus';

it('charts an event\'s outcomes with their history, and says which events don\'t exist', async () => {
  const lookup = new PublicApi('https://gateway.polymarket.us');
  const { events } = await lookup.get<{ events: { slug: string }[] }>('/v1/events?active=true&closed=false&categories=crypto&limit=200', AbortSignal.timeout(30_000));
  const slug = events.map((e) => e.slug).find((s) => s.startsWith('btc-updown-1d-'));
  expect(slug, 'no open daily Bitcoin up-or-down event').toBeDefined();

  const [updown, missing] = await polymarketUs.fetch({ markets: [slug!, 'no-such-event-xyz'], interval: 15, points: 40 }, AbortSignal.timeout(60_000));
  expect(updown!.error).toBeUndefined();
  expect(updown!.outcomes.map((o) => o.name)).toEqual(['Up', 'Down']);
  const [up, down] = updown!.outcomes;
  expect(up!.price + down!.price).toBeCloseTo(1);
  expect(up!.history.length).toBeGreaterThan(0);
  // Only as far back as asked for (10 hours).
  expect(up!.history[0]!.time).toBeGreaterThan(Date.now() / 1000 - 11 * 3600);
  expect(missing!.error).toBe('unknown market');
});

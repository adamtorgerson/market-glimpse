/** Analysis of prediction markets' outcomes. */
import { describe, expect, it } from 'vitest';
import { dailyVolatility, eventStats, formatChangePoints, formatDuration, formatEnds, formatPoints, historyChange } from '../../src/predictanalysis';
import { DEFAULT_SETTINGS, exploreCharts, maxEventCharts, sanitize } from '../../src/settings';
import { pick, type GammaEvent, type GammaMarket } from '../../src/sources/polymarket';
import { parseEndTime, type Outcome, type PredictionData } from '../../src/sources/prediction';
import { pickUs, type UsEvent } from '../../src/sources/polymarketus';

const HOUR = 3600;
const history = (...ps: number[]) => ps.map((p, i) => ({ time: i * HOUR, p }));
const outcome = (price: number, extra: Partial<Outcome> = {}): Outcome => ({ name: 'A', price, history: [], ...extra });

describe('daily volatility', () => {
  it('needs enough history to say', () => {
    expect(dailyVolatility(history(0.5, 0.6), 0.5)).toBeUndefined();
    expect(dailyVolatility([], 0.5)).toBeUndefined();
    expect(dailyVolatility([{ time: 5, p: 0.5 }, { time: 5, p: 0.6 }, { time: 5, p: 0.5 }], 0.5)).toBeUndefined();
  });

  it('is nothing for a flat market', () => {
    expect(dailyVolatility(history(0.3, 0.3, 0.3), 0.3)).toBe(0);
  });

  it('scales each step\'s squared move to a day, in log-odds, at today\'s price', () => {
    // From even odds to log-odds ±1 each hour, over two hours: variance 1 an hour, 24 a day.
    const up = Math.exp(1) / (1 + Math.exp(1));
    expect(dailyVolatility(history(0.5, up, 0.5), 0.5)).toBeCloseTo(Math.sqrt(24) * 0.25 * 100, 8);
    expect(dailyVolatility(history(0.5, up, 0.5), 0.1)).toBeCloseTo(Math.sqrt(24) * 0.09 * 100, 8);
  });

  it('counts the same move as bigger near the edges than near even odds', () => {
    const near = dailyVolatility(history(0.02, 0.07, 0.02), 0.5)!, even = dailyVolatility(history(0.5, 0.55, 0.5), 0.5)!;
    expect(near).toBeGreaterThan(even * 5);
  });

  it('copes with prices of 0 and 1', () => {
    expect(Number.isFinite(dailyVolatility(history(0, 1, 0), 1))).toBe(true);
  });
});

describe('an event\'s stats', () => {
  const end = 10 * HOUR;
  const event = (outcomes: Outcome[], extra: Partial<PredictionData> = {}): PredictionData => ({ market: 'm', title: 'T', outcomes, ...extra });

  it('uses the source\'s 24h change where every outcome has one, whatever the chart\'s span', () => {
    const stats = eventStats(event([outcome(0.6, { dayChange: 0.011, history: history(0.1, 0.1, 0.1) }), outcome(0.4, { dayChange: -0.011 })]), end);
    expect(stats.changeLabel).toBe('24h');
    expect(stats.rows.map((r) => r.change)).toEqual(['+1.1', '−1.1']);
  });

  it('otherwise uses the change since its history starts, labelled with how long ago that was', () => {
    const stats = eventStats(event([outcome(0.6, { history: history(0.5, 0.55, 0.6) }), outcome(0.4)]), end);
    expect(stats.changeLabel).toBe('10h');
    expect(stats.rows.map((r) => r.change)).toEqual(['+10', '—']);
    expect(historyChange(outcome(0.6))).toBeUndefined();
  });

  it('shows spreads in points, and a dash where there isn\'t one', () => {
    const stats = eventStats(event([outcome(0.6, { spread: 0.01 }), outcome(0.4, { spread: 0.001 }), outcome(0.1, { spread: 0.0001 }), outcome(0.1)]), end);
    expect(stats.rows.map((r) => r.spread)).toEqual(['1.0', '0.1', '<0.1', '—']);
  });

  it('shows the source\'s total, only where it has one', () => {
    const outcomes = [outcome(0.4), outcome(0.3)];
    expect(eventStats(event(outcomes, { total: 1.02 }), end).summary).toBe('Sum 102.0%');
    expect(eventStats(event(outcomes), end).summary).toBe('');
  });

  it('gives the time left with the sum', () => {
    const stats = eventStats(event([outcome(0.5), outcome(0.5)], { total: 1, endTime: end + 3 * 86400 }), end);
    expect(stats.summary).toBe('Sum 100.0% · ends 3d');
  });
});

describe('formatting', () => {
  it('formats points without false zeros or false precision', () => {
    expect([formatPoints(0), formatPoints(0.04), formatPoints(3.14), formatPoints(12.6)]).toEqual(['0.0', '<0.1', '3.1', '13']);
    expect([formatChangePoints(0), formatChangePoints(0.01), formatChangePoints(-1.1), formatChangePoints(12.4)]).toEqual(['0.0', '0.0', '−1.1', '+12']);
  });

  it('gives spans in their largest sensible unit', () => {
    expect([30 * 60, 14 * HOUR, 3 * 86400, 150 * 86400, 2 * 365.25 * 86400].map(formatDuration)).toEqual(['30m', '14h', '3d', '5mo', '2y']);
  });

  it('says so when a market is past its end date', () => {
    expect(formatEnds(100, 200)).toBe('past end date');
    expect(formatEnds(200 + 5 * HOUR, 200)).toBe('ends 5h');
  });

  it('reads end dates, or nothing', () => {
    expect(parseEndTime('2028-11-08T04:59:00Z')).toBe(Date.UTC(2028, 10, 8, 4, 59) / 1000);
    expect(parseEndTime(undefined)).toBeUndefined();
    expect(parseEndTime('soon')).toBeUndefined();
  });
});

describe('what Polymarket gives', () => {
  const market = (title: string, price: number, extra: Partial<GammaMarket> = {}): GammaMarket => ({
    question: title, groupItemTitle: title, outcomes: '["Yes","No"]', outcomePrices: JSON.stringify([String(price), String(1 - price)]),
    clobTokenIds: '["y","n"]', active: true, closed: false, ...extra,
  });
  const event = (markets: GammaMarket[], negRisk = false): GammaEvent => ({ slug: 's', title: 'T', negRisk, markets });

  it('flips the 24h change for a market\'s second side, and shares its spread', () => {
    const { lines, total } = pick(event([market('A', 0.6, { oneDayPriceChange: 0.02, spread: 0.01 })]));
    expect(lines.map((l) => [l.change, l.spread])).toEqual([[0.02, 0.01], [-0.02, 0.01]]);
    expect(total).toBeUndefined();
  });

  it('totals a complete set, and keeps each market\'s own figures', () => {
    const { lines, total } = pick(event([market('A', 0.6, { oneDayPriceChange: 0.02, spread: 0.01 }), market('B', 0.4, { oneDayPriceChange: -0.01, spread: 0.02 })], true));
    expect(total).toBeCloseTo(1, 10);
    expect(lines.map((l) => [l.name, l.change, l.spread])).toEqual([['A', 0.02, 0.01], ['B', -0.01, 0.02]]);
  });

  it('totals those left off the chart too', () => {
    const { lines, total } = pick(event(['A', 'B', 'C', 'D', 'E', 'F'].map((n) => market(n, 0.2)), true));
    expect(lines).toHaveLength(4);
    expect(total).toBeCloseTo(1.2, 10);
  });

  it('has no total for separate markets', () => {
    expect(pick(event([market('A', 0.6), market('B', 0.7)])).total).toBeUndefined();
  });

  it('has no total where outcomes can still be added, though it still prices those left out', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((n) => market(n, 0.1));
    const chosen = pick({ ...event(many, true), negRiskAugmented: true });
    expect(chosen.total).toBeUndefined();
    expect(chosen.other?.price).toBeCloseTo(0.1, 10);
  });
});

describe('what Polymarket US gives', () => {
  const sides = [{ description: 'Yes', long: true }, { description: 'No', long: false }];
  const market = (slug: string, bid: string, ask?: string) => ({
    slug, title: slug, active: true, closed: false, outcomePrices: JSON.stringify(ask ? [bid, ask] : [bid]), marketSides: sides,
    bestBidQuote: { value: bid }, bestAskQuote: ask ? { value: ask } : null,
  });
  const event = (markets: UsEvent['markets'], tags: { slug: string }[] = []): UsEvent => ({ slug: 's', title: 'T', tags, markets });

  it('takes the spread from the bid and ask, for either side', () => {
    expect(pickUs(event([market('a', '0.14', '0.15')])).lines.map((l) => l.spread!.toFixed(2))).toEqual(['0.01', '0.01']);
  });

  it('has no spread without a close quote', () => {
    expect(pickUs(event([market('a', '0.14')])).lines[0]!.spread).toBeUndefined();
    expect(pickUs(event([market('a', '0', '1')])).lines[0]!.spread).toBeUndefined();
  });

  it('totals a complete set from each market\'s best quotes', () => {
    expect(pickUs(event([market('a', '0.5', '0.6'), market('b', '0.2', '0.3')], [{ slug: 'neg-risk' }])).total).toBeCloseTo(0.8, 10);
  });

  it('counts a market with no bid at half its ask: a lone price there is the ask, not a bid', () => {
    // As the API gives it: one value in outcomePrices, and only an ask among the quotes.
    const noBid = { ...market('c', '0.01'), bestBidQuote: null, bestAskQuote: { value: '0.01' } };
    expect(pickUs(event([market('a', '0.5', '0.6'), noBid], [{ slug: 'neg-risk' }])).total).toBeCloseTo(0.555, 10);
  });

  it('has no total for separate markets', () => {
    expect(pickUs(event([market('a', '0.5', '0.6'), market('b', '0.7', '0.8')])).total).toBeUndefined();
  });
});

describe('charts allowed with prediction analysis', () => {
  const events = ['a', 'b', 'c', 'd'];

  it('is 2 on image charts, 4 without it, and 1 as text either way', () => {
    expect(maxEventCharts(false, true)).toBe(2);
    expect(maxEventCharts(false, false)).toBe(4);
    expect(maxEventCharts(true, true)).toBe(1);
    expect(exploreCharts('4', maxEventCharts(false, true))).toBe(2);
  });

  it('keeps the first 2 ticked, and defaults to off', () => {
    const input = { ...DEFAULT_SETTINGS, source: 'polymarket', events: { polymarket: events }, eventCharts: { polymarket: events } };
    expect(sanitize(input).eventAnalysis).toBe(false);
    expect(sanitize(input).eventCharts.polymarket).toEqual(events);
    expect(sanitize({ ...input, eventAnalysis: true }).eventCharts.polymarket).toEqual(events.slice(0, 2));
  });

  it('doesn\'t touch an exchange\'s charts', () => {
    const four = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD'];
    expect(sanitize({ markets: four, charts: four, eventAnalysis: true }).charts).toEqual(four);
  });
});

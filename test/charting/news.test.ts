/**
 * News on the glasses' text screens: marks in the lists and under the charts,
 * and the headlines screen; and which candle a headline falls in.
 */
import { describe, expect, it } from 'vitest';
import { newsSlot } from '../../src/chart';
import type { NewsMatch } from '../../src/news';
import type { PredictionData } from '../../src/sources/prediction';
import type { Candle, MarketData } from '../../src/sources/types';
import { buildEventTextChart, buildEventTextList, buildNewsText, buildTextChart, buildTextList, serializeBox, textWidth, type TextBox, utf8Length } from '../../src/textchart';

const updated = new Date(2026, 10, 5, 12);
const END = updated.getTime() / 1000;
const read = (s: string) => s.replace(/[^\x20-\x7e]+/g, ' ').trim();
const lines = (b: TextBox) => serializeBox(b).split('\n').map(read);

const candles = (n: number, last = Math.floor(END / 300) * 300): Candle[] => Array.from({ length: n }, (_, i) => {
  const p = 100 + i % 5;
  return { time: last - (n - 1 - i) * 300, open: p, high: p + 3, low: p - 3, close: p + 1, volume: 1 };
});

describe('which candle a headline falls in', () => {
  const last = 3000;
  it('counts back from the latest', () => {
    expect(newsSlot(3000, last, 300)).toBe(0);
    expect(newsSlot(2999, last, 300)).toBe(1);
    expect(newsSlot(2700, last, 300)).toBe(1);
    expect(newsSlot(2699, last, 300)).toBe(2);
  });
  it('puts one newer than the latest candle in it', () => {
    expect(newsSlot(3100, last, 300)).toBe(0);
  });
});

describe('the market lists', () => {
  const items: MarketData[] = [
    { market: 'BTC-USDC', candles: [], last: 100, news: { times: [END - 60], recent: true } },
    { market: 'ETH-USDC', candles: [], last: 10, news: { times: [END - 90_000], recent: false } },
    { market: 'SOL-USD', candles: [], last: 1 },
  ];

  it('mark a market in the news within the last day', () => {
    const [, mid] = buildTextList({ items, updated, source: 'Kraken', name: 'MarketGlimpse' });
    expect(lines(mid!)[0]).toMatch(/^BTC-USDC \*/);
    expect(lines(mid!)[1]).toMatch(/^ETH-USDC/);
    expect(lines(mid!)[1]).not.toContain('*');
    expect(lines(mid!)[2]).not.toContain('*');
  });

  it('mark the markets listed under a text chart', () => {
    const boxes = buildTextChart({ chart: { market: 'SOL-USD', candles: candles(30) }, width: 'text-wide', ticker: items.slice(0, 2), interval: 5, updated, source: 'Kraken', name: 'MarketGlimpse' });
    const text = boxes.map((b) => read(serializeBox(b))).join(' ');
    expect(text).toContain('BTC-USDC * 100');
    expect(text).not.toContain('ETH-USDC *');
  });

  it('mark an event, within the room its title has', () => {
    const event = (title: string, news?: PredictionData['news']): PredictionData => ({ market: title, title, news, outcomes: [{ name: 'Yes', price: 0.5, history: [] }] });
    const long = 'Which party will win the House in 2026? And by how many seats, if any at all?';
    const boxes = buildEventTextList({ items: [event(long, { times: [END], recent: true }), event('Quiet')], updated, source: 'Polymarket' });
    const titles = lines(boxes[1]!);
    expect(titles[0]).toMatch(/\.\.\. \*/);
    expect(textWidth(titles[0]!.split(' 50%')[0]!)).toBeLessThanOrEqual(300);
    expect(titles[1]).not.toContain('*');
  });
});

/** Every `'` in the bright containers with the marks, less those without. */
function addedTicks(without: TextBox[], withNews: TextBox[]): number[] {
  const cols = (boxes: TextBox[]) => boxes.flatMap((b, i) => b.lines.flatMap((l, j) => [...l.strokes].filter(([, g]) => g === "'").map(([c]) => `${i}:${j}:${c}`)));
  const had = new Set(cols(without));
  return cols(withNews).filter((c) => !had.has(c)).map((c) => Number(c.split(':')[2]));
}

describe('the text chart', () => {
  const chart: MarketData = { market: 'BTC-USDC', candles: candles(40) };
  const model = (news?: MarketData['news']) => ({ chart: { ...chart, news }, width: 'text-wide' as const, ticker: [], interval: 5, updated, source: 'Kraken' });
  const last = chart.candles.at(-1)!.time;

  it('marks a headline\'s candle: nearer the left the older it is', () => {
    const recent = addedTicks(buildTextChart(model()), buildTextChart(model({ times: [last], recent: true })));
    const older = addedTicks(buildTextChart(model()), buildTextChart(model({ times: [last - 300 * 10], recent: true })));
    expect(recent).toHaveLength(1);
    expect(older).toHaveLength(1);
    expect(recent[0]! - older[0]!).toBe(40);
  });

  it('has one mark for headlines in one candle', () => {
    expect(addedTicks(buildTextChart(model()), buildTextChart(model({ times: [last, last + 10, last + 20], recent: true })))).toHaveLength(1);
  });

  it('leaves out one older than the chart', () => {
    expect(addedTicks(buildTextChart(model()), buildTextChart(model({ times: [last - 300 * 1000], recent: false })))).toEqual([]);
  });

  it('stays within what a container can hold, with a mark under every candle', () => {
    const boxes = buildTextChart(model({ times: chart.candles.map((c) => c.time), recent: true }));
    expect(boxes.every((b) => utf8Length(serializeBox(b)) <= 999)).toBe(true);
  });
});

describe('the prediction text chart', () => {
  const event = (news?: PredictionData['news']): PredictionData => ({
    market: 'e', title: 'Event', news,
    outcomes: [{ name: 'Yes', price: 0.5, history: Array.from({ length: 100 }, (_, i) => ({ time: END - (100 - i) * 300, p: 0.5 })) }],
  });
  const model = (news?: PredictionData['news']) => ({ event: event(news), interval: 5, updated, source: 'Polymarket' });

  it('marks a headline\'s time, under the plot', () => {
    const near = addedTicks(buildEventTextChart(model()), buildEventTextChart(model({ times: [END - 60], recent: true })));
    const far = addedTicks(buildEventTextChart(model()), buildEventTextChart(model({ times: [END - 300 * 20], recent: true })));
    expect(near).toHaveLength(1);
    expect(far).toHaveLength(1);
    expect(near[0]! - far[0]!).toBe(20);
  });
});

describe('the headlines screen', () => {
  const headline = (title: string, i = 0): NewsMatch => ({ title, link: '', time: END - i * 60, source: 'cnbc', about: ['BTC'] });
  const long = 'Bitcoin erases post-election gains as Wall Street selloff triggers over $1 billion in crypto liquidations and a good deal more that will not fit on any screen';
  const many = Array.from({ length: 25 }, (_, i) => headline(`${long} ${i}`, i));

  it('has new headlines first, each marked "*", then earlier ones, unmarked, each with its time', () => {
    const [bright, dim, marks] = buildNewsText([headline('Bitcoin falls')], [headline('Ether rose', 5)]);
    expect(lines(bright!).slice(0, 2)).toEqual(['Bitcoin falls', 'Ether rose']);
    expect(lines(dim!)[0]).toMatch(/^\d\d:\d\d$/);
    expect(lines(dim!)[1]).toMatch(/^\d\d:\d\d$/);
    expect(serializeBox(marks!).split('\n').map(read)).toEqual(['*']);
  });

  it('shows a headline on every line it can, ten on the screen', () => {
    const [bright, dim] = buildNewsText(many.slice(0, 2), many.slice(2));
    expect(lines(bright!)).toHaveLength(10);
    expect(lines(dim!).filter(Boolean)).toHaveLength(10);
  });

  it('marks only those new, whichever lines they land on', () => {
    const [, , marks] = buildNewsText(many.slice(0, 3), many.slice(3));
    expect(serializeBox(marks!).split('\n').map(read)).toEqual(['*', '*', '*']);
  });

  it('runs a headline on to a second line with lines to spare', () => {
    const [bright] = buildNewsText([headline(long)], []);
    expect(lines(bright!).filter(Boolean)).toHaveLength(2);
  });

  it('keeps every line clear of the right edge, where it would wrap and show a scrollbar', () => {
    for (const box of buildNewsText(many.slice(0, 2), many.slice(2))) {
      for (const line of box.lines) for (const t of line.texts) expect(t.x + textWidth(t.text)).toBeLessThanOrEqual(576 - 4);
    }
  });

  it('stays within what a container can hold', () => {
    for (const box of buildNewsText(many, [])) expect(utf8Length(serializeBox(box))).toBeLessThanOrEqual(999);
  });
});

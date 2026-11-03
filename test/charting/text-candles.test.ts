/**
 * Text candles, drawn by the glasses in their own font: the market list
 * along the bottom of the chart.
 */
import { describe, expect, it } from 'vitest';
import type { TextBox } from '../../src/textchart';
import { buildTextChart, serializeBox, textWidth, utf8Length } from '../../src/textchart';
import type { MarketData } from '../../src/sources/types';

describe('the text chart\'s market list', () => {
  const updated = new Date(2026, 9, 28, 14, 0, 0);
  const read = (s: string) => s.replace(/[^\x20-\x7e·↑↓]+/g, ' ').trim();
  const market = (name: string, price: number): MarketData =>
    ({ market: name, candles: [{ time: 0, open: price, high: price * 1.01, low: price * 0.99, close: price, volume: 1 }] });
  const build = (n: number) => buildTextChart({
    chart: market('BTC-USDC', 80_000), width: 'text-narrow', interval: 5, updated, source: 'Kraken', name: 'MarketGlimpse',
    ticker: Array.from({ length: n }, (_, i) => market(`COIN${i + 1}-USD`, 1234.5)),
  });
  const dim = (boxes: TextBox[], phase: number, line: number) => read(serializeBox(boxes[4 + phase]!).split('\n')[line] ?? '');

  it('has one line along the bottom when the markets fit beside the name', () => {
    const boxes = build(2);
    expect(dim(boxes, 2, 9)).toMatch(/^COIN1-USD .* +· +COIN2-USD .* MarketGlimpse$/);
    expect(dim(boxes, 3, 8)).toMatch(/\d\d:\d\d/);
  });

  it('follows a price with an arrow if it moved since the last update', () => {
    const boxes = buildTextChart({
      chart: market('BTC-USDC', 80_000), width: 'text-narrow', interval: 5, updated, source: 'Kraken',
      ticker: [{ ...market('ETH-USD', 2_355), trend: 1 }, market('SOL-USD', 101.89), { ...market('XRP-USD', 1.3), trend: -1 }],
    });
    expect(dim(boxes, 2, 9).match(/\S+-USD [\d.,]+( [↑↓])?/g)).toEqual(['ETH-USD 2,355.00 ↑', 'SOL-USD 101.89', 'XRP-USD 1.300 ↓']);
  });

  it('goes on to a second line, under a shorter plot, when they don\'t', () => {
    const boxes = build(8);
    const top = dim(boxes, 3, 8), bottom = dim(boxes, 2, 9);
    expect(top).toMatch(/^COIN1-USD/);
    expect(bottom).toMatch(/^COIN\d-USD .* MarketGlimpse$/);
    // The time keys move up a line.
    expect(dim(boxes, 0, 8)).toMatch(/\d\d:\d\d/);
    expect(`${top} ${bottom}`.match(/COIN\d/g)!.length).toBeGreaterThan(3);
    for (const b of boxes) expect(utf8Length(serializeBox(b))).toBeLessThanOrEqual(999);
  });
});

describe('the text chart\'s right edge', () => {
  // A line past the screen's 576px wraps, and its container shows a scrollbar.
  it('keeps every line inside it, wherever the time keys fall', () => {
    for (const width of ['text-wide', 'text-narrow', 'text-thin', 'text-blocks'] as const) {
      for (const interval of [1, 15, 60, 240]) {
        for (let shift = 0; shift < 12; shift++) {
          const sec = interval * 60;
          const end = Math.floor(Date.UTC(2026, 9, 28, 14) / 1000 / sec) * sec - shift * sec;
          const candles = Array.from({ length: 200 }, (_, i) => {
            const p = 80_000 + Math.sin(i / 5) * 500;
            return { time: end - (199 - i) * sec, open: p, high: p + 100, low: p - 100, close: p + (i % 2 ? 50 : -50), volume: 1 };
          });
          const boxes = buildTextChart({
            chart: { market: 'BTC-USD', candles }, width, interval, updated: new Date(end * 1000), source: 'Coinbase', name: 'MarketGlimpse',
            // Arrows after the prices, which shift the name along with them.
            ticker: ['ETH-USDC', 'SOL-USD', 'XRP-USD'].slice(0, 1 + (shift % 3)).map((market, i) => ({ market, candles: [{ ...candles[0]!, close: 1234.5 * 10 ** (shift % 4) }], trend: i % 2 ? 1 : -1 })),
          });
          for (const b of boxes) for (const line of serializeBox(b).split('\n')) expect(textWidth(line)).toBeLessThanOrEqual(576);
        }
      }
    }
  });
});

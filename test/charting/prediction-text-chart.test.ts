/**
 * The prediction text chart, drawn by the glasses in their own font: its
 * lines, legend, the other events listed under it, and its corner.
 */
import { describe, expect, it } from 'vitest';
import type { TextBox } from '../../src/textchart';
import { buildEventTextChart, eventTextPoints, serializeBox, textWidth, utf8Length } from '../../src/textchart';
import type { PredictionData } from '../../src/sources/prediction';

describe('the prediction text chart', () => {
  const updated = new Date(2026, 9, 28, 14, 36, 34);
  const end = updated.getTime() / 1000;
  // Noisy histories over the whole chart: the most strokes, and bytes, a line can take.
  const walk = (start: number, seed: number) => {
    let p = start, x = seed;
    return Array.from({ length: eventTextPoints() }, (_, i) => {
      x = (x * 16807) % 2147483647;
      p = Math.min(0.99, Math.max(0.01, p + ((x % 1000) / 1000 - 0.5) * 0.1));
      return { time: end - (eventTextPoints() - i) * 300, p };
    });
  };
  const outcomes = [['Cut 25 bps', 0.62], ['No change', 0.3], ['Cut 50+ bps', 0.05], ['Hike', 0.02]] as const;
  const data: PredictionData = {
    market: 'fed',
    title: 'Fed decision in December?',
    outcomes: outcomes.map(([name, price], i) => ({ name, price, history: walk(price, i + 1), ...(i === 0 ? { trend: 1 } : {}) })),
    other: { count: 1, price: 0.01 },
    dayVolume: 4_200_000,
  };
  const boxes = buildEventTextChart({ event: data, interval: 5, updated, source: 'Polymarket' });
  const read = (s: string) => s.replace(/[^\x20-\x7e↑↓]+/g, ' ').trim();
  const lines = (i: number) => serializeBox(boxes[i]!).split('\n').map(read);

  it('fits every container in its byte limit', () => {
    for (const b of boxes) expect(utf8Length(serializeBox(b))).toBeLessThanOrEqual(999);
  });

  it('has the time, question, volume and source along the top', () => {
    expect(lines(0)[0]).toBe('Fed decision in December?');
    expect(lines(4)[0]).toMatch(/^14:36:34 +Polymarket +\$4\.2M$/);
  });

  it('has a legend along the bottom, on two lines if one would cut names short: each line\'s sample and probability in its brightness, and its name', () => {
    // Offset 20, line 8, then offset 14, line 9: bright for the first two lines, dim for the rest and the names.
    expect(lines(3)[8]).toMatch(/^''''' +62% +↑ +' ' ' +30%$/);
    expect(lines(7)[8]).toMatch(/^Cut 25 bps +No change$/);
    expect(lines(6)[9]).toMatch(/^''''' +5% +Cut 50\+ bps +' ' ' +2% +Hike +1% other$/);
  });

  it('has the legend on one line, under the time keys, where it fits', () => {
    const yesNo = buildEventTextChart({
      event: { market: 'x', title: 'Will it rain?', outcomes: [{ name: 'Yes', price: 0.7, history: [] }, { name: 'No', price: 0.3, history: [] }] },
      interval: 5, updated, source: 'Polymarket',
    });
    const at = (box: number, line: number) => read(serializeBox(yesNo[box]!).split('\n')[line]!);
    expect(at(2, 9)).toMatch(/^''''' +70% +' ' ' +30%$/);
    expect(at(6, 9)).toMatch(/^Yes +No$/);
    // The time keys have the line above.
    expect(at(7, 8)).toMatch(/\d\d:\d\d/);
  });

  it('labels 0 to 100% down the left', () => {
    const labels = boxes.slice(4).flatMap((b) => serializeBox(b).split('\n').map(read)).filter((l) => /^\d+%$/.test(l));
    expect(labels).toEqual(expect.arrayContaining(['100%', '75%', '50%', '25%', '0%']));
  });

  it('shows an error in place of the chart', () => {
    const failed = buildEventTextChart({ event: { market: 'x', title: 'Gone', outcomes: [], error: 'unknown market' }, interval: 5, updated, source: 'Polymarket' });
    expect(serializeBox(failed[0]!)).toContain('unknown market');
  });
});

describe('a text chart line', () => {
  it('has a stroke in every column, whatever its level', () => {
    const updated = new Date(2026, 9, 28, 14, 0, 0);
    const end = updated.getTime() / 1000;
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const p = pct / 100;
      const history = Array.from({ length: eventTextPoints() }, (_, i) => ({ time: end - (eventTextPoints() - i) * 3600, p }));
      const boxes = buildEventTextChart({ event: { market: 'x', title: 't', outcomes: [{ name: 'Yes', price: p, history }] }, interval: 60, updated, source: 'P' });
      const cols = new Set(boxes.slice(0, 4).flatMap((b) => b.lines.flatMap((l) => [...l.strokes.keys()])));
      expect(cols.size, `${pct}%`).toBe(eventTextPoints());
    }
  });
});

describe('the prediction text chart\'s list', () => {
  const updated = new Date(2026, 9, 28, 14, 0, 0);
  const read = (s: string) => s.replace(/[^\x20-\x7e↑↓]+/g, ' ').trim();
  const yesNo = (title: string, yes: number): PredictionData =>
    ({ market: title, title, outcomes: [{ name: 'Yes', price: yes, history: [] }, { name: 'No', price: 1 - yes, history: [] }] });
  const build = (ticker: PredictionData[]) =>
    buildEventTextChart({ event: yesNo('Will it rain?', 0.7), ticker, interval: 60, updated, source: 'P' });
  const text = (boxes: TextBox[]) => boxes.map((b) => serializeBox(b).split('\n').map(read));

  it('lists the other events under the legend: title, leader\'s probability and name', () => {
    const lines = text(build([{ ...yesNo('Snow by Friday?', 0.2), outcomes: [{ name: 'Yes', price: 0.2, history: [], trend: -1 }, { name: 'No', price: 0.8, history: [] }] }]));
    // Legend at offset 20, line 8; the list at offset 14, line 9.
    expect(lines[7]![8]).toMatch(/^Yes +No$/);
    expect(lines[6]![9]).toMatch(/^Snow by Friday\? +No$/);
    expect(lines[2]![9]).toMatch(/^80%$/);
  });

  it('lists them two to a line, on up to four lines, the rest as "+N more"', () => {
    const dimText = (boxes: TextBox[]) => boxes.slice(4).flatMap((b) => serializeBox(b).split('\n').map(read)).join(' ');
    const questions = (n: number) => Array.from({ length: n }, (_, i) => yesNo(`Q${i + 1}: a rather long question about the future?`, 0.4));
    const seven = build(questions(7));
    expect(dimText(seven).match(/Q\d:/g)).toHaveLength(7);
    expect(dimText(seven)).not.toMatch(/more/);
    const ten = build(questions(10));
    expect(dimText(ten).match(/Q\d+:/g)).toHaveLength(7);
    expect(dimText(ten)).toMatch(/\+3 more/);
    for (const b of [...seven, ...ten]) expect(utf8Length(serializeBox(b))).toBeLessThanOrEqual(999);
  });

  it('lines up each column\'s probabilities and names from line to line', () => {
    const boxes = build(['Q1?', 'A much longer question?', 'Q3: medium?', 'Short?'].map((t, i) => yesNo(t, [0.4, 0.05, 0.993, 0.5][i]!)));
    // Where each match on a line ends, or starts, in px: the blanks before it place it.
    const at = (box: TextBox, line: number, re: RegExp, end: boolean) => {
      const raw = serializeBox(box).split('\n')[line]!;
      return [...raw.matchAll(re)].map((m) => textWidth(raw.slice(0, m.index! + (end ? m[0].length : 0))));
    };
    // List lines at offset 20, line 8 and offset 14, line 9: percentages bright, names dim.
    expect(at(boxes[3]!, 8, /\d+%/g, true)).toEqual(at(boxes[2]!, 9, /\d+%/g, true));
    // The names follow text placed by estimated widths, so to within the 4px grid.
    const [top, bottom] = [at(boxes[7]!, 8, /\b(Yes|No)\b/g, false), at(boxes[6]!, 9, /\b(Yes|No)\b/g, false)];
    expect(top).toHaveLength(2);
    top.forEach((x, i) => expect(Math.abs(x - bottom[i]!)).toBeLessThanOrEqual(2));
  });
});

describe('the prediction text chart\'s corner', () => {
  const updated = new Date(2026, 9, 28, 14, 0, 0);
  const read = (s: string) => s.replace(/[^\x20-\x7e↑↓]+/g, ' ').trim();
  const yesNo = (title: string, yes: number): PredictionData =>
    ({ market: title, title, outcomes: [{ name: 'Yes', price: yes, history: [] }, { name: 'No', price: 1 - yes, history: [] }] });
  const bottomLine = (boxes: TextBox[]) => read(serializeBox(boxes[6]!).split('\n')[9]!);

  it('has the name at the end of the legend, with no list', () => {
    const boxes = buildEventTextChart({ event: yesNo('Will it rain?', 0.7), interval: 60, updated, source: 'P', name: 'MarketGlimpse' });
    expect(bottomLine(boxes)).toMatch(/^Yes +No +MarketGlimpse$/);
  });

  it('has the name on a line of its own, with no list and no room after the legend', () => {
    const outcomes = [['Benjamin Netanyahu', 0.45], ['Gadi Eizenkot', 0.24], ['Naftali Bennett', 0.04], ['Avigdor Lieberman', 0.02]] as const;
    const event: PredictionData = { market: 'pm', title: 'Prime Minister', outcomes: outcomes.map(([name, price]) => ({ name, price, history: [] })), other: { count: 9, price: 0.25 } };
    const boxes = buildEventTextChart({ event, interval: 60, updated, source: 'P', name: 'MarketGlimpse' });
    expect(bottomLine(boxes)).toBe('MarketGlimpse');
    const legend = boxes.slice(4).flatMap((b) => serializeBox(b).split('\n').map(read)).join(' ');
    for (const [name] of outcomes) expect(legend).toContain(name);
  });

  it('has the name in the list\'s last cell, all 7 others still listed', () => {
    const others = Array.from({ length: 7 }, (_, i) => yesNo(`Q${i + 1}: a rather long question about the future?`, 0.4));
    const boxes = buildEventTextChart({ event: yesNo('Will it rain?', 0.7), ticker: others, interval: 60, updated, source: 'P', name: 'MarketGlimpse' });
    expect(bottomLine(boxes)).toMatch(/^Q7: .* +MarketGlimpse$/);
    const dim = boxes.slice(4).flatMap((b) => serializeBox(b).split('\n').map(read)).join(' ');
    expect(dim.match(/Q\d:/g)).toHaveLength(7);
  });

  it('keeps a full last line of the list clear of the name with a new line', () => {
    const others = Array.from({ length: 2 }, (_, i) => yesNo(`Q${i + 1}: a question?`, 0.4));
    const boxes = buildEventTextChart({ event: yesNo('Will it rain?', 0.7), ticker: others, interval: 60, updated, source: 'P', name: 'MarketGlimpse' });
    expect(bottomLine(boxes)).toBe('MarketGlimpse');
  });
});

import { describe, expect, it } from 'vitest';
import type { TextBox } from '../src/textchart';
import { buildEventLoadingList, buildEventTextChart, buildEventTextList, buildLoadingList, buildTextChart, buildTextList, eventTextPoints, serializeBox, textWidth, utf8Length } from '../src/textchart';
import type { PredictionData } from '../src/sources/prediction';
import type { MarketData } from '../src/sources/types';

const event = (title: string, outcomes: [string, number][], error?: string): PredictionData =>
  ({ market: title, title, outcomes: outcomes.map(([name, price]) => ({ name, price, history: [] })), error });

describe('the prediction text list', () => {
  const boxes = buildEventTextList({
    items: [
      { ...event('Presidential Election Winner 2028', [['JD Vance', 0.18], ['Gavin Newsom', 0.11]]), dayVolume: 8_300_000 },
      event('Which party will win the House in 2026? And by how many seats, if any at all?', [['Republican', 0.07], ['Democratic', 0.93]]),
      event('Dota 2: Team Spirit vs OG', [['Team Spirit', 0.004], ['OG', 0.996]]),
      event('Gone', [], 'unknown market'),
    ],
    updated: new Date(2026, 9, 28, 14, 36, 34),
    source: 'Polymarket',
    name: 'MarketGlimpse',
  });
  // Text as it reads: the glasses' blank glyphs that position it (not spaces, which the font sets narrow) as spaces.
  const read = (s: string) => s.replace(/[^\x20-\x7e]+/g, ' ').trim();
  const [pcts, titles, names, volumes, header, footer] = boxes.map((b) => serializeBox(b).split('\n').map(read));

  it('has a row per event: its title, its likeliest outcome\'s probability, and that outcome', () => {
    expect(pcts).toEqual(['18%', '93%', '>99%']);
    expect(names).toEqual(['JD Vance', 'Democratic', 'OG']);
    expect(titles![0]).toMatch(/^Presidential Election/);
  });

  it('has the 24h volume against the right edge, where there is one', () => {
    expect(volumes![0]).toBe('$8.3M');
    expect(volumes!.slice(1).every((v) => v === '')).toBe(true);
  });

  it('cuts a long title short with "..."', () => {
    expect(titles![1]).toMatch(/^Which party will win.*\.\.\.$/);
  });

  it('shows an event\'s error in place of its outcome', () => {
    expect(titles![3]).toMatch(/^Gone +unknown market$/);
  });

  it('has the time and source at the top and the name at the bottom, as the other screens', () => {
    expect(header![0]).toMatch(/^14:36:34 +Polymarket$/);
    expect(footer![0]).toBe('MarketGlimpse');
  });
});

describe('trend arrows', () => {
  const read = (s: string) => s.replace(/[^\x20-\x7e↑↓]+/g, ' ').trim();
  const lines = (b: ReturnType<typeof buildTextList>[number]) => serializeBox(b).split('\n').map(read);

  it('follow a market\'s price if it moved since the last update', () => {
    const [bright, mid] = buildTextList({
      items: [
        { market: 'BTC-USD', candles: [], last: 81207, dayVolume: 2200, trend: 1 },
        { market: 'ETH-USD', candles: [], last: 2363.62, dayVolume: 18300, trend: -1 },
        { market: 'ZEC-USD', candles: [], last: 1296.16, dayVolume: 18400, trend: 0 },
      ],
      updated: new Date(),
      source: 'Kraken',
    });
    expect(lines(bright!)).toEqual(['81,207 ↑', '2,363.62 ↓', '1,296.16']);
    expect(lines(mid!).map((l) => l.split(/ +/).at(-1))).toEqual(['2.2K', '18.3K', '18.4K']);
  });

  it('follow the loading screen\'s prices so far, and none still to come', () => {
    const [bright] = buildLoadingList([
      { market: 'BTC-USD', candles: [], last: 81207, trend: -1 },
      { market: 'ETH-USD', candles: [] },
    ]);
    expect(bright!.content.split('\n').map(read)).toEqual(['81,207 ↓']);
  });

  it('follow an event\'s leading probability on the loading screen, in two containers, with "..." for those still to come', () => {
    const list = buildEventLoadingList([
      { market: 'a', title: 'Fed Decision in December', outcomes: [{ name: '25 bps Increase', price: 0.8, history: [], trend: 1 }], dayVolume: 1.2e6 },
      { market: 'b', title: 'Balance of Power', outcomes: [] },
    ]);
    expect(list).toHaveLength(2);
    const [bright, mid] = list.map((b) => b.content.split('\n').map(read));
    expect(bright![0]).toBe('80% ↑');
    expect(mid![0]).toMatch(/^Fed Decision in December +25 bps Increase +\$1\.2M$/);
    expect(mid![1]).toMatch(/^Balance of Power +\.\.\.$/);
  });

  it('follow an event\'s leading probability', () => {
    const [bright] = buildEventTextList({
      items: [
        { market: 'a', title: 'A', outcomes: [{ name: 'Up', price: 0.6, history: [], trend: 1 }, { name: 'Down', price: 0.4, history: [], trend: -1 }] },
        { market: 'b', title: 'B', outcomes: [{ name: 'Yes', price: 0.2, history: [] }, { name: 'No', price: 0.8, history: [], trend: -1 }] },
      ],
      updated: new Date(),
      source: 'Polymarket',
    });
    expect(lines(bright!)).toEqual(['60% ↑', '80% ↓']);
  });
});

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

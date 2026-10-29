import { describe, expect, it } from 'vitest';
import { buildEventLoadingList, buildEventTextList, buildLoadingList, buildTextList, serializeBox } from '../src/textchart';
import type { PredictionData } from '../src/sources/prediction';

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

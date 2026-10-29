import { describe, expect, it } from 'vitest';
import { buildEventTextList, serializeBox } from '../src/textchart';
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

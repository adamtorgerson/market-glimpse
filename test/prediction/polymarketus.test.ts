/**
 * Which outcomes of a Polymarket US event are charted, for each shape of
 * event. The prices and titles are from real events (October 2026).
 */
import { describe, expect, it } from 'vitest';
import { pickUs, type UsEvent, type UsMarket } from '../src/sources/polymarketus';

/** A market whose long side is "Yes" (or the first of `sides`), with its bid and ask. */
function market(title: string, bid: number, ask: number, extra: Partial<UsMarket> & { sides?: [string, string] } = {}): UsMarket {
  const { sides = ['Yes', 'No'], ...rest } = extra;
  return {
    slug: `m-${title}`,
    title,
    active: true,
    closed: false,
    outcomePrices: JSON.stringify([String(bid), String(ask)]),
    sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_FUTURE',
    marketSides: [{ description: sides[0], long: true }, { description: sides[1], long: false }],
    ...rest,
  };
}

const event = (markets: UsMarket[], title = 'E'): UsEvent => ({ slug: 'e', title, markets });
const named = (e: UsEvent) => pickUs(e).lines.map((l) => [l.name, +l.price.toFixed(3)]);

describe('one market', () => {
  it('is Up and Down for an up-or-down market, at the midpoint', () => {
    expect(named(event([market('BTC Up or Down Daily', 0.92, 0.93)], 'BTC Up or Down Daily'))).toEqual([['Up', 0.925], ['Down', 0.075]]);
  });

  it('is the two teams of a game', () => {
    const p = pickUs(event([
      market('Milwaukee Brewers vs Tampa Bay Rays', 0.575, 0.58, { sides: ['Milwaukee Brewers', 'Tampa Bay Rays'], sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_MONEYLINE' }),
      market('Brewers -1.5', 0.4, 0.42, { sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_SPREAD' }),
    ]));
    expect(p.lines.map((l) => l.name)).toEqual(['Milwaukee Brewers', 'Tampa Bay Rays']);
    expect(p.lines[1]!.complement).toBe(true);
  });
});

describe('a soccer match', () => {
  it('is home, tie and away, without "(Reg. Time)"', () => {
    expect(pickUs(event([
      market('AC Milan (Reg. Time)', 0.78, 0.79, { sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_DRAWABLE_OUTCOME' }),
      market('Tie (Reg. Time)', 0.18, 0.19, { sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_DRAWABLE_OUTCOME' }),
      market('Bologna FC 1909 (Reg. Time)', 0.03, 0.04, { sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_DRAWABLE_OUTCOME' }),
      market('Both Teams to Score', 0.5, 0.52, { sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_BOTH_TEAMS_TO_SCORE' }),
    ])).lines.map((l) => l.name)).toEqual(['AC Milan', 'Tie', 'Bologna FC 1909']);
  });

  it('has nothing to chart without a winner market', () => {
    expect(pickUs(event([market('Over 2.5', 0.5, 0.52, { sportsMarketTypeV2: 'SPORTS_MARKET_TYPE_TOTAL' })])).error).toBe('no winner market');
  });
});

describe('several markets', () => {
  it('that add up to about 1 are exclusive: the likeliest, and the rest priced', () => {
    const p = pickUs(event([
      market('25 bps Increase', 0.79, 0.8), market('No Change', 0.18, 0.19), market('50+ bps Increase', 0.02, 0.03),
      market('25 bps Decrease', 0.01, 0.02), market('50+ bps Decrease', 0, 0.01),
    ]));
    expect(p.lines.map((l) => l.name)).toEqual(['25 bps Increase', 'No Change', '50+ bps Increase', '25 bps Decrease']);
    expect(p.other!.count).toBe(1);
    expect(p.other!.price).toBeCloseTo(0.005);
  });

  const range = { assetPriceTerms: { marketType: 'ASSET_PRICE_MARKET_TYPE_RANGE', strike: null } };

  it('that are an asset\'s price ranges are exclusive, even with unquoted ones: the likeliest, and the rest priced', () => {
    const p = pickUs(event([
      market('70,000 to 74,999.99', 0.11, 0.13, range), market('75,000 to 79,999.99', 0.14, 0.15, range), market('80,000 to 84,999.99', 0.2, 0.24, range),
      market('85,000 to 89,999.99', 0.12, 0.14, range), market('90,000 to 94,999.99', 0.09, 0.1, range), market('Below 70,000', 0.2, 0.21, range),
      // No offers: a bid of 0 and an ask of 1 isn't a price of 50%.
      market('150,000 to 154,999.99', 0, 1, range), market('155,000 to 159,999.99', 0, 1, range),
    ]));
    expect(p.lines.map((l) => l.name)).toEqual(['80,000 to 84,999.99', 'Below 70,000', '75,000 to 79,999.99', '85,000 to 89,999.99']);
    expect(p.other!.count).toBe(4);
    expect(p.other!.price).toBeCloseTo(0.215);
  });

  it('tagged neg-risk are exclusive, whatever their prices add up to', () => {
    const e = { ...event([market('A', 0.5, 0.52), market('B', 0.5, 0.52), market('C', 0.4, 0.42), market('D', 0.3, 0.32), market('E', 0.2, 0.22)]), tags: [{ slug: 'neg-risk' }] };
    expect(pickUs(e).other!.price).toBeCloseTo(0.21);
  });

  it('that are an asset passing strikes are a ladder, whatever their prices add up to', () => {
    const strike = (v: number) => ({ assetPriceTerms: { marketType: 'ASSET_PRICE_MARKET_TYPE_ONE_TOUCH', strike: { value: String(v) } } });
    const p = pickUs(event([
      market('Above $129,999.99', 0.03, 0.04, strike(130000)), market('Above $89,999.99', 0.48, 0.49, strike(90000)),
      market('Above $119,999.99', 0.04, 0.05, strike(120000)), market('Above $99,999.99', 0.19, 0.2, strike(100000)),
      market('Above $109,999.99', 0.08, 0.09, strike(110000)), market('Above $139,999.99', 0.02, 0.03, strike(140000)),
    ]));
    expect(p.lines.map((l) => l.name)).toEqual(['Above $89,999.99', 'Above $99,999.99', 'Above $109,999.99', 'Above $119,999.99']);
    expect(p.other).toEqual({ count: 2 });
  });

  it('of separate names that don\'t add up are the likeliest, and the rest counted', () => {
    const p = pickUs(event([market('Discord', 0.91, 0.92), market('Stripe', 0.06, 0.07), market('Ramp', 0.4, 0.42), market('Kraken', 0.7, 0.72), market('Plaid', 0.2, 0.22)]));
    expect(p.lines.map((l) => l.name)).toEqual(['Discord', 'Kraken', 'Ramp', 'Plaid']);
    expect(p.other).toEqual({ count: 1 });
  });

  it('that don\'t add up and are numbers are a ladder: in order, nearest even odds, the rest counted', () => {
    const p = pickUs(event([
      market('Above $129,999.99', 0.03, 0.04), market('Above $89,999.99', 0.48, 0.49), market('Above $119,999.99', 0.04, 0.05),
      market('Above $99,999.99', 0.19, 0.2), market('Above $79,999.99', 0.97, 0.98), market('Above $109,999.99', 0.08, 0.09),
      market('Above $84,999.99', 0.75, 0.76),
    ]));
    expect(p.lines.map((l) => l.name)).toEqual(['Above $84,999.99', 'Above $89,999.99', 'Above $99,999.99', 'Above $109,999.99']);
    expect(p.other).toEqual({ count: 3 });
  });
});

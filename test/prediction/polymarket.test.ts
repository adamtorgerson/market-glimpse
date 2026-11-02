/**
 * Which outcomes of a Polymarket event are charted, for each shape of event.
 * The prices and titles are from real events (October 2026).
 */
import { describe, expect, it } from 'vitest';
import { pick, type GammaEvent, type GammaMarket } from '../src/sources/polymarket';

let token = 0;

/** A yes/no market within an event, or with `outcomes`, a market of two named outcomes. */
function market(title: string, price: number, extra: Partial<Omit<GammaMarket, 'outcomes'>> & { outcomes?: string[] } = {}): GammaMarket {
  const { outcomes = ['Yes', 'No'], ...rest } = extra;
  return {
    question: title,
    groupItemTitle: title,
    outcomes: JSON.stringify(outcomes),
    outcomePrices: JSON.stringify([String(price), String(1 - price)]),
    clobTokenIds: JSON.stringify([`t${++token}`, `t${++token}`]),
    active: true,
    closed: false,
    ...rest,
  };
}

function event(markets: GammaMarket[], negRisk = false): GammaEvent {
  return { slug: 'e', title: 'E', negRisk, markets };
}

const names = (e: GammaEvent) => pick(e).lines.map((l) => l.name);

describe('a sports game', () => {
  it('is who wins, as two teams, without the spreads, totals and props', () => {
    const p = pick(event([
      market('76ers vs. Pacers', 0.45, { sportsMarketType: 'moneyline', outcomes: ['76ers', 'Pacers'] }),
      market('Team to Score First', 0.5, { sportsMarketType: 'basketball_team_to_score_first', outcomes: ['76ers', 'Pacers'] }),
      market('Spread -4.5', 0.52, { sportsMarketType: 'spreads', outcomes: ['Pacers', '76ers'] }),
      market('O/U 224.5', 0.49, { sportsMarketType: 'totals', outcomes: ['Over', 'Under'] }),
      market('Tyrese Maxey: Points O/U 27.5', 0.55, { sportsMarketType: 'points', outcomes: ['Over', 'Under'] }),
    ]));
    expect(p.lines.map((l) => [l.name, l.price])).toEqual([['76ers', 0.45], ['Pacers', 0.55]]);
    // Pacers is 76ers' complement: one history for both.
    expect(p.lines[1]!.token).toBe(p.lines[0]!.token);
    expect(p.lines[1]!.complement).toBe(true);
    expect(p.other).toBeUndefined();
  });

  it('is home, draw and away in soccer', () => {
    expect(names(event([
      market('Manchester City FC', 0.485, { sportsMarketType: 'moneyline' }),
      market('Draw (Manchester City FC vs. Brighton & Hove Albion FC)', 0.245, { sportsMarketType: 'moneyline' }),
      market('Brighton & Hove Albion FC', 0.265, { sportsMarketType: 'moneyline' }),
    ], true))).toEqual(['Manchester City FC', 'Draw', 'Brighton & Hove Albion FC']);
  });

  it('has nothing to chart without a winner market', () => {
    const p = pick(event([
      market('PAOK (-1.5)', 0.4, { sportsMarketType: 'spreads', outcomes: ['PAOK', 'AEK'] }),
      market('O/U 2.5', 0.5, { sportsMarketType: 'totals', outcomes: ['Over', 'Under'] }),
    ]));
    expect(p.lines).toEqual([]);
    expect(p.error).toBe('no winner market');
  });
});

describe('one market', () => {
  it('is Yes and No, No drawn from Yes', () => {
    const p = pick(event([market('Xi Jinping out before 2027?', 0.0365)]));
    expect(p.lines.map((l) => [l.name, l.price])).toEqual([['Yes', 0.0365], ['No', 0.9635]]);
    expect(p.lines[1]!.complement).toBe(true);
  });
});

describe('an exclusive set', () => {
  it('is the likeliest four, likeliest first, and the rest priced as their sum', () => {
    const p = pick(event([
      market('JD Vance', 0.182), market('Gavin Newsom', 0.1055), market('Alexandria Ocasio-Cortez', 0.1295),
      market('Jon Ossoff', 0.0945), market('Marco Rubio', 0.06), market('Josh Shapiro', 0.04),
    ], true));
    expect(p.lines.map((l) => l.name)).toEqual(['JD Vance', 'Alexandria Ocasio-Cortez', 'Gavin Newsom', 'Jon Ossoff']);
    expect(p.other!.count).toBe(2);
    expect(p.other!.price).toBeCloseTo(0.1);
  });

  it('of ordered buckets is the likeliest too', () => {
    const p = pick(event([
      market('50+ bps decrease', 0.005, { groupItemThreshold: '0' }),
      market('25 bps decrease', 0.12, { groupItemThreshold: '1' }),
      market('No change', 0.86, { groupItemThreshold: '2' }),
      market('25 bps increase', 0.01, { groupItemThreshold: '3' }),
      market('50+ bps increase', 0.005, { groupItemThreshold: '4' }),
    ], true));
    expect(p.lines.map((l) => l.name)).toEqual(['No change', '25 bps decrease', '25 bps increase', '50+ bps decrease']);
    expect(p.other).toEqual({ count: 1, price: 0.005 });
  });

  it('of four or fewer is all of them, in the event\'s order', () => {
    expect(names(event([
      market('Democrats Sweep', 0.67), market('D Senate, R House', 0.01), market('R Senate, D House', 0.27), market('Republicans Sweep', 0.08),
    ], true))).toEqual(['Democrats Sweep', 'D Senate, R House', 'R Senate, D House', 'Republicans Sweep']);
  });
});

describe('a ladder', () => {
  // "What price will Bitcoin hit in October?": up targets, then down, in the event's order.
  const bitcoin = event([
    ['↑ 150,000', 0.0005], ['↑ 105,000', 0.0015], ['↑ 102,500', 0.0025], ['↑ 100,000', 0.0025], ['↑ 97,500', 0.0015],
    ['↑ 95,000', 0.0055], ['↑ 92,500', 0.0055], ['↑ 90,000', 0.0115], ['↑ 87,500', 0.0295], ['↑ 85,000', 0.135],
    ['↑ 82,500', 0.595], ['↓ 80,000', 0.555], ['↓ 77,500', 0.105], ['↓ 75,000', 0.0305], ['↓ 72,500', 0.0135],
    ['↓ 70,000', 0.0045], ['↓ 67,500', 0.0035], ['↓ 65,000', 0.0005], ['↓ 62,500', 0.0005], ['↓ 60,000', 0.0015],
  ].map(([title, price], i) => market(title as string, price as number, { groupItemThreshold: String(i) })).reverse());

  it('is the four rungs in a row closest to even odds, in order', () => {
    expect(names(bitcoin)).toEqual(['↑ 85,000', '↑ 82,500', '↓ 80,000', '↓ 77,500']);
  });

  it('counts the rest without a price: the rungs aren\'t exclusive', () => {
    expect(pick(bitcoin).other).toEqual({ count: 16 });
  });

  it('of dates is in date order, however the event lists them', () => {
    const ceasefire = event([
      market('October 31', 0.9495, { groupItemThreshold: '14' }), market('December 31', 0.265, { groupItemThreshold: '19' }),
      market('November 30', 0.365, { groupItemThreshold: '18' }), market('November 15', 0.505, { groupItemThreshold: '16' }),
      market('October 28', 0.993, { groupItemThreshold: '13' }), market('November 8', 0.72, { groupItemThreshold: '15' }),
      market('November 22', 0.425, { groupItemThreshold: '17' }),
    ]);
    expect(names(ceasefire)).toEqual(['November 8', 'November 15', 'November 22', 'November 30']);
  });
});

describe('separate yes/no markets', () => {
  it('are the likeliest four, and the rest counted without a price', () => {
    const p = pick(event([
      market('King Mohammed VI', 0.3), market('Kim Jong Un', 0.2, { groupItemThreshold: '0' }), market('Mohammed bin Salman', 0.85, { groupItemThreshold: '3' }),
      market('Lai Ching-te', 0.05, { groupItemThreshold: '6' }), market('Vladimir Putin', 0.4, { groupItemThreshold: '7' }), market('Xi Jinping', 0.6, { groupItemThreshold: '8' }),
    ]));
    expect(p.lines.map((l) => l.name)).toEqual(['Mohammed bin Salman', 'Xi Jinping', 'Vladimir Putin', 'King Mohammed VI']);
    expect(p.other).toEqual({ count: 2 });
  });
});

it('leaves out closed markets', () => {
  expect(names(event([
    market('Tampa Bay Rays', 0.6), market('Milwaukee Brewers', 0.4), market('New York Yankees', 0, { closed: true }),
  ], true))).toEqual(['Tampa Bay Rays', 'Milwaukee Brewers']);
});

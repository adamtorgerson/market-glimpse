/**
 * Which outcomes of Hyperliquid's events are charted, and what they're called.
 * The descriptions and prices are from real markets (November 2026).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPredictionSource, isPredictionSource } from '../../src/sources';
import { eventSlug } from '../../src/sources/prediction';
import { bookMoney, hlEvents, hlRungEvents, hlUrls, hyperliquidOutcomes, parseHlTime, pickHl, type HlCtx, type HlOutcome, type HlQuestion, type HlTemplate } from '../../src/sources/hyperliquidoutcomes';

const YES_NO = [{ name: 'Yes' }, { name: 'No' }];
const outcome = (id: number, name: string, description = '', sideSpecs = YES_NO): HlOutcome => ({ outcome: id, name, description, sideSpecs });
const question = (id: number, name: string, description: string, named: number[], fallback: number, settled: number[] = []): HlQuestion =>
  ({ question: id, name, description, namedOutcomes: named, fallbackOutcome: fallback, settledNamedOutcomes: settled });

/** Prices by outcome: [mark, previous day's, volume]. */
function ctxs(prices: Record<number, [number, number, number]>): Map<string, HlCtx> {
  return new Map(Object.entries(prices).map(([id, [mark, prev, volume]]) => {
    const coin = `#${+id * 10}`;
    return [coin, { coin, markPx: String(mark), prevDayPx: String(prev), dayBaseVlm: String(volume) }];
  }));
}

const MATCH = question(567, 'template:sportsContestResult', 'competition:UEFA Champions League|participantA:RB Leipzig|participantB:Manchester City|resolutionDeadline:20261111-2000|scheduledStart:20261104-2000', [22244, 22245, 22246], 22243);
const MATCH_OUTCOMES = [
  outcome(22243, 'template fallback', 'other'),
  outcome(22244, 'template:sportsContestParticipant2', 'participant:RB Leipzig'),
  outcome(22245, 'template:sportsContestDraw2'),
  outcome(22246, 'template:sportsContestParticipant2', 'participant:Manchester City'),
];

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 4) });
});
afterEach(() => {
  vi.useRealTimers();
});

const only = (outcomes: HlOutcome[], questions: HlQuestion[] = []) => {
  const events = hlEvents({ outcomes, questions });
  expect(events).toHaveLength(1);
  return events[0]!;
};

describe('a question', () => {
  it('is a match of two teams and a draw, without its unpriced fallback', () => {
    const e = only(MATCH_OUTCOMES, [MATCH]);
    expect(e.title).toBe('RB Leipzig vs Manchester City');
    expect(e.slug).toBe('q567-rb-leipzig-vs-manchester-city');
    expect(e.endTime).toBe(Date.UTC(2026, 10, 11, 20) / 1000);
    const p = pickHl(e, ctxs({ 22244: [0.18, 0.17, 105322], 22245: [0.194, 0.194, 54964], 22246: [0.628, 0.634, 243924] }));
    expect(p.lines.map((l) => l.name)).toEqual(['RB Leipzig', 'Draw', 'Manchester City']);
    expect(p.total).toBeCloseTo(1.002);
    expect(p.volume).toBe(404210);
    expect(p.lines[2]!.change).toBeCloseTo(-0.006);
  });

  it('is the Fed\'s decision, up to its scheduled date', () => {
    const e = only([
      outcome(19987, 'template fallback', 'other'),
      outcome(19988, 'template:policyRateNoChange'),
      outcome(19989, 'template:policyRateDecrease'),
      outcome(19990, 'template:policyRateIncrease'),
    ], [question(545, 'template:policyRateDecision', 'decisionDeadline:20270127-1900|decisionLabel:December 2026|institution:Federal Open Market Committee|scheduledDecision:20261209-1900', [19988, 19989, 19990], 19987)]);
    expect(e.title).toBe('Fed decision, December 2026');
    expect(e.endTime).toBe(Date.UTC(2026, 11, 9, 19) / 1000);
    expect(e.markets.map((m) => m.name)).toEqual(['No change', 'Decrease', 'Increase']);
  });

  it('is a tournament\'s listed favourites, with no total, as the rest of the field isn\'t priced', () => {
    const ids = [1473, 1474, 1475, 1476, 1477];
    const e = only([outcome(1472, 'template fallback', 'other'), ...ids.map((id, i) => outcome(id, 'template:sportsTournamentParticipant', `participant:Team ${i}`))],
      [question(198, 'template:sportsTournamentWinner', 'competition:NBA |resolutionDeadline:20270605-1200|season:2026/2027', ids, 1472)]);
    expect(e.title).toBe('NBA 2026/2027 winner');
    const p = pickHl(e, ctxs({ 1473: [0.69, 0.68, 10], 1474: [0.11, 0.1, 10], 1475: [0.05, 0.05, 10], 1476: [0.04, 0.04, 10], 1477: [0.02, 0.02, 10] }));
    expect(p.lines.map((l) => l.name)).toEqual(['Team 0', 'Team 1', 'Team 2', 'Team 3']);
    expect(p.other).toEqual({ count: 1, price: 0.02 });
    expect(p.total).toBeUndefined();
  });

  it('is a day\'s price ranges, named from its thresholds, with no day change', () => {
    const e = only([
      outcome(24853, 'Recurring Fallback', 'other'),
      outcome(24854, 'Recurring Named Outcome', 'index:0'),
      outcome(24855, 'Recurring Named Outcome', 'index:1'),
      outcome(24856, 'Recurring Named Outcome', 'index:2'),
    ], [question(585, 'Recurring', 'class:priceBucket|underlying:BTC|expiry:20261105-0600|priceThresholds:76164,79273|period:1d', [24854, 24855, 24856], 24853)]);
    expect(e.title).toBe('BTC price on Nov 5 06:00');
    expect(e.markets.map((m) => m.name)).toEqual(['under 76,164', '76,164-79,273', 'over 79,273']);
    const p = pickHl(e, ctxs({ 24854: [0.04, 0.98, 4233], 24855: [0.16, 0.98, 2493], 24856: [0.5, 0.98, 15] }));
    expect(p.lines.every((l) => l.change === undefined)).toBe(true);
  });

  it('leaves out outcomes already settled', () => {
    const e = only(MATCH_OUTCOMES, [{ ...MATCH, settledNamedOutcomes: [22245] }]);
    expect(e.markets.map((m) => m.name)).toEqual(['RB Leipzig', 'Manchester City']);
  });
});

describe('standalone outcomes', () => {
  const touch = (id: number, target: number) => outcome(id, 'template:priceTouch', `perp:xyz:CL|priceDescription:mark|seconds:3|target:${target}|time:20261201-0000`, [{ name: 'template:Yes' }, { name: 'template:No' }]);

  it('make one ladder per asset and date, charted around even odds, without rungs never traded', () => {
    const e = only([touch(1, 100), touch(2, 102.5), touch(3, 105), touch(4, 107.5), touch(5, 110), touch(6, 112.5), touch(7, 115)]);
    expect(e.key).toBe('touch-cl-20261201-0000');
    expect(e.title).toBe('CL touch by Dec 1');
    const p = pickHl(e, ctxs({ 1: [0.9, 0.9, 5], 2: [0.6, 0.6, 5], 3: [0.5, 0.5, 5], 4: [0.3, 0.3, 5], 5: [0.2, 0.2, 5], 6: [0.1, 0.1, 5], 7: [0.5, 0, 0] }));
    expect(p.lines.map((l) => l.name)).toEqual(['102.5', '105', '107.5', '110']);
    expect(p.other).toEqual({ count: 2 });
    expect(p.total).toBeUndefined();
  });

  it('are Yes and No where a rung is alone, named by its strike', () => {
    const e = only([outcome(24848, 'Recurring', 'class:priceBinary|underlying:BTC|expiry:20261105-0600|targetPrice:77719|period:1d')]);
    expect(e.title).toBe('BTC above 77,719 on Nov 5 06:00');
    const p = pickHl(e, ctxs({ 24848: [0.98, 0.5, 100] }));
    expect(p.lines.map((l) => [l.name, l.price])).toEqual([['Yes', 0.98], ['No', 1 - 0.98]]);
    expect(p.lines[1]!.complement).toBe(true);
    expect(p.lines[1]!.volume).toBeUndefined();
    expect(p.lines[0]!.change).toBeUndefined();
  });

  it('name a game\'s sides by its teams', () => {
    const e = only([outcome(24239, 'template:sportsContestWinner',
      'competition:NBA|participantA:Memphis Grizzlies|participantB:Indiana Pacers|resolutionDeadline:20261112-0100|shortNameA:MEM|shortNameB:IND',
      [{ name: 'template:{shortNameA}' }, { name: 'template:{shortNameB}' }])]);
    expect(e.title).toBe('Memphis Grizzlies vs Indiana Pacers');
    const p = pickHl(e, ctxs({ 24239: [0.68, 0.73, 189363] }));
    expect(p.lines.map((l) => l.name)).toEqual(['MEM', 'IND']);
    expect(p.lines[1]!.change).toBeCloseTo(0.05);
  });

  it('make an IPO\'s market caps a ladder, with its year when not this one', () => {
    const cap = (id: number, b: number) => outcome(id, 'template:companyIpoFirstDayMarketCap', `company:Anthropic|listingDeadline:20270501-0359|marketCapThresholdB:${b}`);
    const e = only([cap(1, 1500), cap(2, 1750)]);
    expect(e.title).toBe('Anthropic IPO cap by May 1 2027');
    expect(e.markets.map((m) => m.name)).toEqual(['$1,500B', '$1,750B']);
  });

  it('say so when nothing has traded', () => {
    const e = only([outcome(9, 'template:companyIpoConfirmed', 'company:Anthropic|dateTime:20261130-2359')]);
    expect(e.title).toBe('Anthropic IPO by Nov 30');
    expect(pickHl(e, ctxs({ 9: [0.5, 0, 0] })).error).toBe('no trades yet');
  });
});

describe('the source', () => {
  it('is a prediction source apart from the exchange of the same name', () => {
    expect(isPredictionSource('hyperliquid')).toBe(false);
    expect(getPredictionSource('hyperliquidoutcomes')).toBe(hyperliquidOutcomes);
  });

  it('counts the dollars on both sides of a book', () => {
    expect(bookMoney([[{ px: '0.5', sz: '100' }, { px: '0.4', sz: '50' }], [{ px: '0.6', sz: '10' }]])).toBeCloseTo(76);
    expect(bookMoney([[], []])).toBe(0);
  });

  it('offers every ranking, and counts a book per event only for an uncached liquidity ranking', () => {
    expect(hyperliquidOutcomes.exploreRankings).toBeUndefined();
    expect(hyperliquidOutcomes.exploreRequests!('liquidity')).toBe(hyperliquidOutcomes.exploreRequests!('volume') + 12);
  });

  it('parses times in UTC, and nothing else', () => {
    expect(parseHlTime('20261201-0000')).toBe(Date.UTC(2026, 11, 1) / 1000);
    expect(parseHlTime('soon')).toBeUndefined();
    expect(parseHlTime(undefined)).toBeUndefined();
  });

  it('asks once for every price, then for each charted market\'s candles', () => {
    expect(hyperliquidOutcomes.requestsPerUpdate({ markets: ['a', 'b'], interval: 60, points: 0 })).toBe(1);
    expect(hyperliquidOutcomes.requestsPerUpdate({ markets: ['a', 'b'], history: ['a'], interval: 60, points: 40 })).toBe(3);
  });
});

describe('Hyperliquid\'s own names', () => {
  // As `outcomeTemplates` has them.
  const YES_NO_ROLE = { standaloneOutcome: { sideNames: ['Yes', 'No'] as [string, string] } };
  const TEMPLATES: HlTemplate[] = [
    { id: 'priceTouch', name: '{perp} touches {target} by {time}', role: YES_NO_ROLE, keywords: [['perp', 'hlPerp'], ['target', 'uDecimal'], ['time', 'dateTime']] },
    { id: 'binaryPrice', name: '{perp} above {threshold} at {time}?', role: YES_NO_ROLE, keywords: [['perp', 'hlPerp'], ['threshold', 'uDecimal'], ['time', 'dateTime']] },
    { id: 'companyIpoFirstDayMarketCap', name: '{company} first-day market cap above ${marketCapThresholdB}B?', role: YES_NO_ROLE, keywords: [['company', 'string'], ['listingDeadline', 'dateTime'], ['marketCapThresholdB', 'uDecimal']] },
    { id: 'sportsContestResult', name: '{competition} {stage}: {participantA} v {participantB}', role: 'question', keywords: [['competition', 'string'], ['stage', 'string'], ['participantA', 'string'], ['participantB', 'string']] },
    { id: 'sportsContestParticipant2', name: '{participant}', role: { questionOutcome: { parent: 'sportsContestResult' } }, keywords: [['participant', 'string']] },
    { id: 'sportsContestDraw2', name: 'Draw', role: { questionOutcome: { parent: 'sportsContestResult' } }, keywords: [] },
    { id: 'sportsContestWinner', name: '{participantA} v {participantB}', role: { standaloneOutcome: { sideNames: ['{shortNameA}', '{shortNameB}'] } }, keywords: [['participantA', 'string'], ['participantB', 'string'], ['shortNameA', 'string'], ['shortNameB', 'string']] },
  ];
  const venue = (o: HlOutcome, v: string): HlOutcome => ({ ...o, venue: v });
  const urls = (outcomes: HlOutcome[], questions: HlQuestion[] = []) => hlUrls({ outcomes, questions }, TEMPLATES);
  const touch = venue(outcome(22078, 'template:priceTouch', 'perp:BTC|priceDescription:mark|seconds:3|target:75000|time:20261201-0000'), 'out');

  it('gives a market\'s URL, either side, with or without its venue', () => {
    const found = urls([touch]);
    expect(found.get('out:btc-touches-75000-by-dec-1-at-1200-am-utc-yes')).toBe('o22078');
    expect(found.get('out:btc-touches-75000-by-dec-1-at-1200-am-utc-no')).toBe('o22078');
    expect(found.get('btc-touches-75000-by-dec-1-at-1200-am-utc-yes')).toBe('o22078');
  });

  it('leaves the dex in a perp\'s name, the decimal point out, and has "on" for "at" before a time', () => {
    const found = urls([venue(outcome(1, 'template:binaryPrice', 'perp:xyz:CL|threshold:97.5|time:20261106-2100'), 'txyz')]);
    expect(found.get('txyz:xyzcl-above-975-on-nov-6-at-900-pm-utc-yes')).toBe('o1');
  });

  it('sends a question\'s outcomes to the question', () => {
    const q = question(567, 'template:sportsContestResult', 'competition:UEFA Champions League|stage:Matchday 4|participantA:RB Leipzig|participantB:Manchester City', [2, 3], 1);
    const found = urls([
      venue(outcome(1, 'template fallback', 'other'), 'out'),
      venue(outcome(2, 'template:sportsContestParticipant2', 'participant:Manchester City'), 'out'),
      venue(outcome(3, 'template:sportsContestDraw2'), 'out'),
    ], [q]);
    expect(found.get('out:uefa-champions-league-matchday-4-rb-leipzig-v-manchester-city-manchester-city-yes')).toBe('q567');
    expect(found.get('out:uefa-champions-league-matchday-4-rb-leipzig-v-manchester-city-draw-no')).toBe('q567');
  });

  it('names a game\'s sides by its teams', () => {
    const found = urls([venue(outcome(9, 'template:sportsContestWinner', 'participantA:Memphis Grizzlies|participantB:Indiana Pacers|shortNameA:MEM|shortNameB:IND', [{ name: 'template:{shortNameA}' }, { name: 'template:{shortNameB}' }]), 'out')]);
    expect(found.get('out:memphis-grizzlies-v-indiana-pacers-ind')).toBe('o9');
  });

  it('has a recurring market\'s date in its URL, and no venue', () => {
    const found = urls([outcome(24848, 'Recurring', 'class:priceBinary|underlying:BTC|expiry:20261105-0600|targetPrice:77719|period:1d')]);
    expect(found.get('btc-above-77719-yes-nov-05-0600')).toBe('o24848');
  });

  it('names a day\'s price ranges', () => {
    const found = urls([outcome(24853, 'Recurring Fallback', 'other'), outcome(24855, 'Recurring Named Outcome', 'index:1')],
      [question(585, 'Recurring', 'class:priceBucket|underlying:BTC|expiry:20261105-0600|priceThresholds:76164,79273|period:1d', [24855], 24853)]);
    expect(found.get('btc-price-range-nov-05-0600-76164-to-79273-yes')).toBe('q585');
  });

  it('keeps apart a name on two venues: the venue says which, and without it, it could be either', () => {
    const cap = (id: number, v: string, deadline: string) => venue(outcome(id, 'template:companyIpoFirstDayMarketCap', `company:Anthropic|listingDeadline:${deadline}|marketCapThresholdB:1500`), v);
    const found = urls([cap(1, 'out', '20270101-0000'), cap(2, 'skew', '20270501-0359')]);
    expect(found.get('out:anthropic-first-day-market-cap-above-1500b-yes')).toBe('o1');
    expect(found.get('skew:anthropic-first-day-market-cap-above-1500b-yes')).toBe('o2');
    expect(found.get('anthropic-first-day-market-cap-above-1500b-yes')).toBeNull();
  });

  it('falls back on the raw name where a template is unknown', () => {
    const found = urls([venue(outcome(5, 'template:somethingNew', 'x:1'), 'out')]);
    expect(found.get('out:templatesomethingnew-yes')).toBe('o5');
  });

  it('makes a rung an event of its own, not listed with the ladder', () => {
    const meta = { outcomes: [touch], questions: [] };
    expect(hlEvents(meta).map((e) => e.key)).toEqual(['touch-btc-20261201-0000']);
    const [rung] = hlRungEvents(meta);
    expect(rung!.key).toBe('o22078');
    expect(rung!.title).toBe('BTC touch 75,000 by Dec 1');
    expect(pickHl(rung!, ctxs({ 22078: [0.5, 0.7, 100] })).lines.map((l) => l.name)).toEqual(['Yes', 'No']);
  });

  it('takes the name from a link, as typed or encoded', () => {
    const name = 'out:btc-touches-75000-by-dec-1-at-1200-am-utc-yes';
    expect(eventSlug(`https://app.hyperliquid.xyz/trade/${name}`)).toBe(name);
    expect(eventSlug('https://app.hyperliquid.xyz/trade/out%3Abtc-touches-75000-by-dec-1-at-1200-am-utc-yes?x=1')).toBe(name);
    expect(eventSlug(`  ${name.toUpperCase()} `)).toBe(name);
    expect(eventSlug('https://polymarket.com/event/balance-of-power-2026-midterms')).toBe('balance-of-power-2026-midterms');
  });
});

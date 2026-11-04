/**
 * The indicators against an outside reference, on real Kraken candles:
 * TA-Lib's results, and Kraken's own VWAP. `scripts/analysis-fixtures.py`
 * writes the fixture. The markets are intraday and daily: busy, slower, and
 * thin, with no-volume and flat candles.
 */
import { describe, expect, it } from 'vitest';
import { atr, bollinger, donchian, ema, macd, parabolicSar, rsi, sma, vwap } from '../../src/analysis';
import type { Candle } from '../../src/sources/types';
import FIXTURE from './fixtures/analysis-reference.json?raw';

type Line = (number | null)[];
const fixture = JSON.parse(FIXTURE) as {
  /** Candles `talib` was given, the last of those kept. */
  shown: number;
  markets: {
    name: string;
    /** Candles `talibLong` was given. */
    history: number;
    /** The last of them: time, open, high, low, close, volume. */
    candles: number[][];
    krakenVwap: number[];
    /** TA-Lib given just the candles shown, as we are. */
    talib: Record<string, Line>;
    /** TA-Lib given the whole history, for the candles kept. */
    talibLong: Record<string, Line>;
  }[];
};
const markets = fixture.markets.map((m) => ({
  ...m,
  candles: m.candles.map(([time, open, high, low, close, volume]): Candle => ({ time: time!, open: open!, high: high!, low: low!, close: close!, volume: volume! })),
}));
const shown = <T>(items: T[]): T[] => items.slice(-fixture.shown);

/** The same points as `reference`, starting at the same candle, to rounding error. */
function expectSame(ours: Line, reference: Line): void {
  expect(ours.findIndex((v) => v !== null)).toBe(reference.findIndex((v) => v !== null));
  reference.forEach((v, i) => {
    if (v === null) expect(ours[i]).toBeNull();
    else expect(Math.abs(ours[i]! - v)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(v)));
  });
}

/** Share of `reference`'s range between the latest points: starting points differ, then fade. */
function latestGap(ours: Line, reference: Line): number {
  const values = reference.filter((v) => v !== null);
  return Math.abs(ours.at(-1)! - reference.at(-1)!) / (Math.max(...values) - Math.min(...values));
}

describe.each(markets)('$name against TA-Lib', ({ candles: kept, talib }) => {
  const candles = shown(kept);
  const closes = candles.map((c) => c.close);

  it('matches on SMA, EMA and RSI', () => {
    expectSame(sma(closes, 20), talib.sma!);
    expectSame(ema(closes, 20), talib.ema!);
    expectSame(rsi(closes, 14), talib.rsi!);
  });

  it('matches on Bollinger Bands', () => {
    const b = bollinger(closes, 20, 2);
    expectSame(b.map((x) => x?.upper ?? null), talib.bollingerUpper!);
    expectSame(b.map((x) => x?.mid ?? null), talib.bollingerMid!);
    expectSame(b.map((x) => x?.lower ?? null), talib.bollingerLower!);
  });

  it('matches on Donchian Channels', () => {
    const d = donchian(candles, 20);
    expectSame(d.map((x) => x?.upper ?? null), talib.donchianUpper!);
    expectSame(d.map((x) => x?.lower ?? null), talib.donchianLower!);
  });

  it('matches on Parabolic SAR, at two speeds', () => {
    expectSame(parabolicSar(candles, 0.02, 0.2), talib.sar!);
    expectSame(parabolicSar(candles, 0.05, 0.5), talib.sarFast!);
  });

  // These start differently from TA-Lib's: ATR counts the first candle's range,
  // and MACD starts both averages together. Each settles to the same values.
  it('settles to the same ATR', () => {
    expect(latestGap(atr(candles, 14), talib.atr!)).toBeLessThan(0.0001);
  });

  it('settles to the same MACD', () => {
    const m = macd(closes, 12, 26, 9);
    expect(latestGap(m.line, talib.macd!)).toBeLessThan(0.0001);
    expect(latestGap(m.signal, talib.macdSignal!)).toBeLessThan(0.0001);
    expect(latestGap(m.hist, talib.macdHist!)).toBeLessThan(0.0001);
  });
});

describe.each(markets)('$name VWAP against Kraken\'s', ({ candles: kept, krakenVwap }) => {
  // Ours estimates each candle's prices from its high, low and close; Kraken's
  // comes from the trades, so they're close rather than equal.
  it('stays within 2% of the chart\'s range once it has 20 candles behind it, and 5% before', () => {
    const candles = shown(kept), kraken = shown(krakenVwap);
    const range = Math.max(...candles.map((c) => c.high)) - Math.min(...candles.map((c) => c.low));
    const ours = vwap(candles);
    let money = 0, volume = 0;
    candles.forEach((c, i) => {
      money += kraken[i]! * c.volume;
      volume += c.volume;
      if (volume > 0) expect(Math.abs(ours[i]! - money / volume) / range).toBeLessThan(i < 20 ? 0.05 : 0.02);
    });
  });
});

/**
 * We only see the candles a chart shows; a chart with long history has seen
 * more. EMA, RSI, ATR and MACD carry their past forward, so how far off we are
 * depends on the candles shown. Limits are what real markets gave, with margin.
 */
describe.each(markets)('$name against TA-Lib with its $history-candle history', ({ candles: kept, talibLong }) => {
  describe.each([
    { count: 64, limit: 0.03 }, // Wide. MACD's signal, an average of an average, is the slowest.
    { count: 129, limit: 0.0005 }, // Narrow.
    { count: 172, limit: 0.0001 }, // Thin.
  ])('showing $count candles', ({ count, limit }) => {
    const candles = kept.slice(-count), closes = candles.map((c) => c.close);
    const m = macd(closes, 12, 26, 9);

    it.each([
      ['EMA', ema(closes, 20), 'ema'],
      ['RSI', rsi(closes, 14), 'rsi'],
      ['ATR', atr(candles, 14), 'atr'],
      ['MACD', m.line, 'macd'],
      ['MACD\'s signal', m.signal, 'macdSignal'],
      ['MACD\'s histogram', m.hist, 'macdHist'],
    ] as const)('has %s\'s latest value close', (_name, ours, key) => {
      expect(latestGap(ours, talibLong[key]!.slice(-count))).toBeLessThan(limit);
    });

    // Up to about 13% of its dots are on the other side in the fixture, towards
    // the left, but none by the end. A new fixture could catch one mid-flip, as
    // where it's been depends on where it starts.
    it('has Parabolic SAR\'s latest dot on the same side of the price', () => {
      const close = closes.at(-1)!;
      expect(parabolicSar(candles, 0.02, 0.2).at(-1)! > close).toBe(talibLong.sar!.at(-1)! > close);
    });
  });
});

/** The indicators drawn on image charts. */
import { describe, expect, it } from 'vitest';
import { atr, bollinger, candlesNeeded, donchian, ema, hasPane, macd, parabolicSar, rsi, sma, vwap } from '../../src/analysis';
import type { Candle } from '../../src/sources/types';

const candle = (high: number, low: number, close: number, volume = 1): Candle => ({ time: 0, open: close, high, low, close, volume });

describe('analysis', () => {
  it('starts EMA at the simple average of its first period, then smooths', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(3); // 4 * 0.5 + 2 * 0.5
    expect(out[4]).toBe(4);
  });

  it('gives no EMA with fewer values than its period', () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });

  it('puts RSI at 100 for only gains, 0 for only losses, 50 when flat', () => {
    expect(rsi([1, 2, 3, 4], 3)[3]).toBe(100);
    expect(rsi([4, 3, 2, 1], 3)[3]).toBe(0);
    expect(rsi([5, 5, 5, 5], 3)[3]).toBe(50);
    expect(rsi([1, 2, 3, 4], 3).slice(0, 3)).toEqual([null, null, null]);
  });

  it('smooths RSI the way Wilder does', () => {
    // First average: gain 2/3 (2 up), loss 1/3 (1 down); then a fall of 1.
    const out = rsi([10, 11, 10, 11, 10], 3);
    expect(out[3]).toBeCloseTo(100 - 100 / (1 + 2), 10);
    const gain = (2 / 3) * 2 / 3, loss = ((1 / 3) * 2 + 1) / 3;
    expect(out[4]).toBeCloseTo(100 - 100 / (1 + gain / loss), 10);
  });

  it('puts Bollinger Bands k standard deviations around the simple average', () => {
    const out = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(out[6]).toBeNull();
    expect(out[7]).toEqual({ mid: 5, upper: 9, lower: 1 }); // sd 2
  });

  it('averages over a rolling window for SMA', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(sma([1, 2], 3)).toEqual([null, null]);
  });

  it('takes Donchian Channels from the window\'s highs and lows, this candle included', () => {
    const out = donchian([candle(5, 1, 3), candle(7, 2, 3), candle(6, 3, 3), candle(4, 4, 4)], 2);
    expect(out).toEqual([null, { upper: 7, lower: 1 }, { upper: 7, lower: 2 }, { upper: 6, lower: 3 }]);
  });

  it('weights VWAP\'s typical price by volume, from the first candle', () => {
    const out = vwap([candle(3, 3, 3, 0), candle(12, 6, 9, 1), candle(3, 3, 3, 2)]);
    expect(out[0]).toBeNull();
    expect(out[1]).toBe(9);
    expect(out[2]).toBe(5); // (9 * 1 + 3 * 2) / 3
  });

  it('smooths ATR the way Wilder does, with gaps in the true range', () => {
    const out = atr([candle(11, 9, 10), candle(12, 10, 11), candle(20, 19, 19), candle(20, 19, 19)], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBe(2); // true ranges 2 and 2
    expect(out[2]).toBe(5.5); // true range 9, from the last close: (2 + 9) / 2
    expect(out[3]).toBe(3.25); // true range 1: (5.5 + 1) / 2
  });

  it('builds MACD from two EMAs, its signal from an EMA of that, its histogram from the difference', () => {
    const values = Array.from({ length: 12 }, (_, i) => i * i);
    const m = macd(values, 2, 4, 3);
    const fast = ema(values, 2), slow = ema(values, 4);
    expect(m.line.slice(0, 3)).toEqual([null, null, null]);
    expect(m.line[3]).toBeCloseTo(fast[3]! - slow[3]!, 10);
    expect(m.signal.slice(0, 5)).toEqual([null, null, null, null, null]);
    const lines = m.line.slice(3) as number[];
    expect(m.signal[5]).toBeCloseTo((lines[0]! + lines[1]! + lines[2]!) / 3, 10);
    expect(m.hist[5]).toBeCloseTo(m.line[5]! - m.signal[5]!, 10);
    expect(macd([1, 2, 3], 2, 4, 3)).toEqual({ line: [null, null, null], signal: [null, null, null], hist: [null, null, null] });
  });

  it('closes Parabolic SAR in on a rising price, faster with each new high', () => {
    const out = parabolicSar([candle(10, 8, 9), candle(20, 18, 19), candle(30, 28, 29), candle(40, 38, 39), candle(50, 48, 49)], 0.1, 0.5);
    expect(out[0]).toBeNull();
    expect(out[1]).toBe(8); // The first low.
    expect(out[2]).toBeCloseTo(8 + 0.1 * (20 - 8), 10);
    expect(out[3]).toBeCloseTo(9.2 + 0.2 * (30 - 9.2), 10);
    expect(out[4]).toBeCloseTo(13.36 + 0.3 * (40 - 13.36), 10);
  });

  it('flips Parabolic SAR to the last extreme when the price reaches it', () => {
    const out = parabolicSar([candle(10, 8, 9), candle(11, 9, 10), candle(9, 5, 6), candle(8, 4, 5), candle(7, 3, 4)], 0.1, 0.5);
    expect(out[2]).toBe(11);
    expect(out[3]).toBe(11); // Held above the last two candles' highs.
    expect(out[4]).toBeCloseTo(11 + 0.2 * (4 - 11), 10);
  });

  it('never lets Parabolic SAR into the last two candles\' range', () => {
    const out = parabolicSar([candle(10, 8, 9), candle(11, 9, 10), candle(30, 10, 29), candle(31, 28, 30)], 0.5, 1);
    expect(out[3]).toBeLessThanOrEqual(9);
  });

  it('keeps a flipped Parabolic SAR outside the candle that flipped it', () => {
    // The last candle breaks both ways: past the stop, and above the old high.
    const out = parabolicSar([candle(10, 8, 9), candle(11, 9, 10), candle(12, 10, 11), candle(20, 1, 2)], 0.1, 0.5);
    expect(out[3]).toBe(20);
  });

  it('says how many candles draw a line', () => {
    expect(candlesNeeded({ kind: 'ema', period: 20 })).toBe(21);
    expect(ema(Array(21).fill(1), 20).filter((v) => v !== null)).toHaveLength(2);
    expect(candlesNeeded({ kind: 'rsi', period: 14 })).toBe(16);
    expect(rsi(Array(16).fill(1), 14).filter((v) => v !== null)).toHaveLength(2);
    expect(candlesNeeded({ kind: 'macd', fast: 12, slow: 26, signal: 9 })).toBe(35);
    expect(macd(Array(35).fill(1)).hist.filter((v) => v !== null)).toHaveLength(2);
    expect(candlesNeeded({ kind: 'sar', step: 0.02, max: 0.2 })).toBe(3);
    expect(parabolicSar(Array(3).fill(candle(2, 1, 1))).filter((v) => v !== null)).toHaveLength(2);
    expect(candlesNeeded({ kind: 'atr', period: 14 })).toBe(15);
    expect(atr(Array(15).fill(candle(2, 1, 1)), 14).filter((v) => v !== null)).toHaveLength(2);
    expect(candlesNeeded({ kind: 'vwap' })).toBe(2);
  });

  it('gives only RSI, MACD and ATR a pane', () => {
    expect(['rsi', 'macd', 'atr', 'sma', 'ema', 'vwap', 'bollinger', 'donchian', 'sar'].filter((k) => hasPane(k as never))).toEqual(['rsi', 'macd', 'atr']);
  });
});

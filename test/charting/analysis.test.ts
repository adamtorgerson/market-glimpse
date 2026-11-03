/** The indicators drawn on image charts. */
import { describe, expect, it } from 'vitest';
import { bollinger, ema, rsi } from '../../src/analysis';

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
});

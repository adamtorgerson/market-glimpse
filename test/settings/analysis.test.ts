import { describe, expect, it } from 'vitest';
import { analysisSpec, DEFAULT_SETTINGS, sanitize } from '../../src/settings';

describe('analysis settings', () => {
  it('defaults to EMA 20, RSI 14 and Bollinger Bands 20, 2σ, turned off', () => {
    const s = sanitize({});
    expect([s.analysis, s.emaPeriod, s.rsiPeriod, s.bollingerPeriod, s.bollingerK]).toEqual([false, 20, 14, 20, 2]);
    expect(analysisSpec(s)).toBeNull();
  });

  it('keeps periods to whole candles from 2 to 200, and the band width from 0.1 to 5 to one place', () => {
    const s = sanitize({ emaPeriod: 1, rsiPeriod: 9.6, bollingerPeriod: 500, bollingerK: 2.47 });
    expect([s.emaPeriod, s.rsiPeriod, s.bollingerPeriod, s.bollingerK]).toEqual([2, 10, 200, 2.5]);
    expect(sanitize({ bollingerK: 0 }).bollingerK).toBe(0.1);
    expect(sanitize({ bollingerK: 'x' as never }).bollingerK).toBe(2);
  });

  it('draws the chosen indicator with its own period', () => {
    const on = { ...DEFAULT_SETTINGS, analysis: true, emaPeriod: 9, rsiPeriod: 7, bollingerPeriod: 30, bollingerK: 1.5 };
    expect(analysisSpec(sanitize({ ...on, analysisKind: 'ema' }))).toEqual({ kind: 'ema', period: 9, k: 1.5 });
    expect(analysisSpec(sanitize({ ...on, analysisKind: 'rsi' }))).toEqual({ kind: 'rsi', period: 7, k: 1.5 });
    expect(analysisSpec(sanitize({ ...on, analysisKind: 'bollinger' }))).toEqual({ kind: 'bollinger', period: 30, k: 1.5 });
  });
});

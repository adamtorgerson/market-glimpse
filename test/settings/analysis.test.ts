import { describe, expect, it } from 'vitest';
import { analysisSpecs, DEFAULT_SETTINGS, exploreCharts, maxCharts, sanitize } from '../../src/settings';

describe('analysis settings', () => {
  it('defaults to EMA 20, RSI 14 and Bollinger Bands 20, 2σ, turned off', () => {
    const s = sanitize({});
    expect([s.analysis, s.emaPeriod, s.rsiPeriod, s.bollingerPeriod, s.bollingerK]).toEqual([false, 20, 14, 20, 2]);
    expect(analysisSpecs(s)).toEqual([]);
  });

  it('keeps periods to whole candles from 2 to 200, and the band width from 0.1 to 5 to one place', () => {
    const s = sanitize({ emaPeriod: 1, rsiPeriod: 9.6, bollingerPeriod: 500, bollingerK: 2.47 });
    expect([s.emaPeriod, s.rsiPeriod, s.bollingerPeriod, s.bollingerK]).toEqual([2, 10, 200, 2.5]);
    expect(sanitize({ bollingerK: 0 }).bollingerK).toBe(0.1);
    expect(sanitize({ bollingerK: 'x' as never }).bollingerK).toBe(2);
  });

  it('draws the chosen indicator with its own period', () => {
    const on = { ...DEFAULT_SETTINGS, analysis: true, emaPeriod: 9, rsiPeriod: 7, bollingerPeriod: 30, bollingerK: 1.5 };
    expect(analysisSpecs(sanitize({ ...on, analysisKind: 'ema' }))).toEqual([{ kind: 'ema', period: 9 }]);
    expect(analysisSpecs(sanitize({ ...on, analysisKind: 'rsi' }))).toEqual([{ kind: 'rsi', period: 7 }]);
    expect(analysisSpecs(sanitize({ ...on, analysisKind: 'bollinger' }))).toEqual([{ kind: 'bollinger', period: 30, k: 1.5 }]);
  });
});

describe('a second indicator', () => {
  it('defaults to none, and draws just the first', () => {
    expect(sanitize({}).analysisSecond).toBe('none');
    expect(analysisSpecs(sanitize({ analysis: true, analysisKind: 'rsi' }))).toEqual([{ kind: 'rsi', period: 14 }]);
  });

  it('draws both, the first first, each with its own parameters', () => {
    const s = sanitize({ analysis: true, analysisKind: 'rsi', rsiPeriod: 7, analysisSecond: 'macd', macdFast: 3, macdSlow: 8, macdSignal: 4 });
    expect(analysisSpecs(s)).toEqual([{ kind: 'rsi', period: 7 }, { kind: 'macd', fast: 3, slow: 8, signal: 4 }]);
  });

  it('is never the same as the first, or unknown', () => {
    expect(sanitize({ analysisKind: 'ema', analysisSecond: 'ema' }).analysisSecond).toBe('none');
    expect(sanitize({ analysisSecond: 'nope' as never }).analysisSecond).toBe('none');
  });

  it('draws nothing with analysis off', () => {
    expect(analysisSpecs(sanitize({ analysis: false, analysisKind: 'rsi', analysisSecond: 'macd' }))).toEqual([]);
  });
});

describe('the new indicators\' settings', () => {
  it('has the usual defaults', () => {
    const s = sanitize({});
    expect([s.smaPeriod, s.atrPeriod, s.donchianPeriod, s.macdFast, s.macdSlow, s.macdSignal, s.sarStep, s.sarMax]).toEqual([20, 14, 20, 12, 26, 9, 0.02, 0.2]);
  });

  it('gives each indicator its own parameters', () => {
    const on = { analysis: true, smaPeriod: 5, atrPeriod: 6, donchianPeriod: 7, macdFast: 3, macdSlow: 8, macdSignal: 4, sarStep: 0.05, sarMax: 0.5 };
    expect(analysisSpecs(sanitize({ ...on, analysisKind: 'sma' }))).toEqual([{ kind: 'sma', period: 5 }]);
    expect(analysisSpecs(sanitize({ ...on, analysisKind: 'atr' }))).toEqual([{ kind: 'atr', period: 6 }]);
    expect(analysisSpecs(sanitize({ ...on, analysisKind: 'donchian' }))).toEqual([{ kind: 'donchian', period: 7 }]);
    expect(analysisSpecs(sanitize({ ...on, analysisKind: 'macd' }))).toEqual([{ kind: 'macd', fast: 3, slow: 8, signal: 4 }]);
    expect(analysisSpecs(sanitize({ ...on, analysisKind: 'sar' }))).toEqual([{ kind: 'sar', step: 0.05, max: 0.5 }]);
    expect(analysisSpecs(sanitize({ ...on, analysisKind: 'vwap' }))).toEqual([{ kind: 'vwap' }]);
  });

  it('goes back to the defaults for pairs out of order, and keeps SAR to three places', () => {
    const macd = sanitize({ macdFast: 30, macdSlow: 26 });
    expect([macd.macdFast, macd.macdSlow]).toEqual([12, 26]);
    const sar = sanitize({ sarStep: 0.5, sarMax: 0.2 });
    expect([sar.sarStep, sar.sarMax]).toEqual([0.02, 0.2]);
    expect(sanitize({ sarStep: 0.01234 }).sarStep).toBe(0.012);
  });
});

describe('charts allowed with analysis', () => {
  const four = ['BTC-USDC', 'ETH-USDC', 'SOL-USD', 'XRP-USD'];

  it('is 2 on image charts, 4 without it, and 1 on text candles either way', () => {
    expect(maxCharts('narrow', true)).toBe(2);
    expect(maxCharts('narrow', false)).toBe(4);
    expect(maxCharts('text-narrow', true)).toBe(1);
    expect(maxCharts('text-narrow', false)).toBe(1);
  });

  it('keeps the first 2 charts when analysis is on', () => {
    expect(sanitize({ markets: four, charts: four, analysis: true }).charts).toEqual(four.slice(0, 2));
    expect(sanitize({ markets: four, charts: four, analysis: false }).charts).toEqual(four);
  });

  it('caps Explore at 2 charts', () => {
    const max = maxCharts('narrow', true);
    expect(exploreCharts('4', max)).toBe(2);
    expect(exploreCharts('1', max)).toBe(1);
  });
});

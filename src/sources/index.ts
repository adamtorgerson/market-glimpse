import { binanceus } from './binanceus';
import { bitget } from './bitget';
import { coinbase } from './coinbase';
import { gate } from './gate';
import { kraken } from './kraken';
import { okx } from './okx';
import { polymarket } from './polymarket';
import { polymarketUs } from './polymarketus';
import type { PredictionSource } from './prediction';
import type { MarketSource } from './types';

// KuCoin (./kucoin.ts) is left out: its API sends no CORS headers, so the
// WebView blocks every request. Add it here if that changes.
export const SOURCES: readonly MarketSource[] = [kraken, okx, coinbase, gate, binanceus, bitget];
export const DEFAULT_SOURCE = kraken.id;

export function getSource(id: string): MarketSource {
  return SOURCES.find((s) => s.id === id) ?? kraken;
}

/** Prediction markets: a different kind of source, charting events' outcomes rather than prices. */
export const PREDICTION_SOURCES: readonly PredictionSource[] = [polymarket, polymarketUs];

export function isPredictionSource(id: string): boolean {
  return PREDICTION_SOURCES.some((s) => s.id === id);
}

export function getPredictionSource(id: string): PredictionSource {
  return PREDICTION_SOURCES.find((s) => s.id === id) ?? polymarket;
}

/** The name of any source, of either kind. */
export function sourceLabel(id: string): string {
  return isPredictionSource(id) ? getPredictionSource(id).label : getSource(id).label;
}

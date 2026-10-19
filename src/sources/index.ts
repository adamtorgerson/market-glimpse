import { coinbase } from './coinbase';
import { gate } from './gate';
import { kraken } from './kraken';
import { okx } from './okx';
import type { MarketSource } from './types';

// KuCoin (./kucoin.ts) is left out: its API sends no CORS headers, so the
// WebView blocks every request. Add it here if that changes.
export const SOURCES: readonly MarketSource[] = [kraken, okx, coinbase, gate];
export const DEFAULT_SOURCE = kraken.id;

export function getSource(id: string): MarketSource {
  return SOURCES.find((s) => s.id === id) ?? kraken;
}

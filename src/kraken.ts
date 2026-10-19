export interface Candle {
  time: number; // unix seconds, candle open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketData {
  market: string;
  candles: Candle[];
  /** Rolling 24h volume in the base currency, from the ticker. */
  dayVolume?: number;
  error?: string;
}

const BASE = 'https://api.kraken.com/0/public';

/** "BTC-USDC" -> "BTC/USDC"; Kraken accepts the slash form for the OHLC endpoint. */
function toKrakenPair(market: string): string {
  return market.replace('-', '/');
}

export async function fetchCandles(market: string, interval: number, signal?: AbortSignal): Promise<MarketData> {
  const url = `${BASE}/OHLC?pair=${encodeURIComponent(toKrakenPair(market))}&interval=${interval}`;
  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { error: string[]; result?: Record<string, unknown> };
    if (body.error?.length) throw new Error(body.error.join(', ').replace(/^E\w+:/, ''));
    const key = Object.keys(body.result ?? {}).find((k) => k !== 'last');
    const rows = (key ? body.result![key] : []) as [number, string, string, string, string, string, string, number][];
    const candles = rows.map((r) => ({
      time: r[0],
      open: +r[1],
      high: +r[2],
      low: +r[3],
      close: +r[4],
      volume: +r[6],
    }));
    if (candles.length === 0) throw new Error('no data');
    return { market, candles };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    // Kraken omits CORS headers on error responses (e.g. an unknown pair), so the
    // browser reports those as a generic network failure.
    const error = e instanceof TypeError ? 'unknown pair or offline' : (e as Error).message || String(e);
    return { market, candles: [], error };
  }
}

/** Rolling 24h volume, or undefined if the ticker can't be fetched. */
export async function fetchDayVolume(market: string, signal?: AbortSignal): Promise<number | undefined> {
  const url = `${BASE}/Ticker?pair=${encodeURIComponent(toKrakenPair(market))}`;
  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { error: string[]; result?: Record<string, { v: [string, string] }> };
    const t = Object.values(body.result ?? {})[0];
    return t ? +t.v[1] : undefined;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return undefined;
  }
}

export function fetchAll(markets: string[], interval: number, signal?: AbortSignal): Promise<MarketData[]> {
  return Promise.all(markets.map(async (m) => {
    const [data, dayVolume] = await Promise.all([fetchCandles(m, interval, signal), fetchDayVolume(m, signal)]);
    return { ...data, dayVolume };
  }));
}

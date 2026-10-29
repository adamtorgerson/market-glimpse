import { exchangeSource, UnknownMarketError, type Ticker } from './exchange';
import { HttpError, PublicApi } from './http';

// Binance.US: Binance.com blocks the US (HTTP 451).
const api = new PublicApi('https://api.binance.us/api/v3');

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  try {
    return await api.get<T>(path, signal);
  } catch (e) {
    if (e instanceof HttpError && e.body.includes('-1121')) throw new UnknownMarketError();
    // Binance's error responses have no CORS headers, so in the browser an
    // unknown market looks like a network failure.
    if (e instanceof TypeError) throw new Error('unknown pair or offline');
    throw e;
  }
}

interface BinanceTicker { symbol: string; lastPrice: string; volume: string }
const toTicker = (t: BinanceTicker): Ticker => ({ last: +t.lastPrice, dayVolume: +t.volume });

export const binanceus = exchangeSource({
  id: 'binanceus',
  label: 'Binance.US',
  api,
  intervals: {
    1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 360: '6h', 480: '8h',
    720: '12h', 1440: '1d', 4320: '3d', 10080: '1w',
  },

  async ticker(market, signal) {
    return toTicker(await get<BinanceTicker>(`/ticker/24hr?symbol=${encodeURIComponent(market)}`, signal));
  },

  async tickers(signal, ids) {
    // Just the markets asked for; one unknown symbol fails the lot, but they come from the market list.
    const rows = await get<BinanceTicker[]>(`/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(ids))}`, signal);
    return new Map<string, Ticker>(rows.map((t) => [t.symbol, toTicker(t)]));
  },

  async candles(market, interval, _intervalSec, count, signal) {
    // [open time ms, open, high, low, close, base volume, …], oldest first.
    const rows = await get<(string | number)[][]>(
      `/klines?symbol=${encodeURIComponent(market)}&interval=${interval}&limit=${Math.min(count, 1000)}`, signal);
    return rows.map((r) => ({
      time: +r[0]! / 1000, open: +r[1]!, high: +r[2]!, low: +r[3]!, close: +r[4]!, volume: +r[5]!,
    }));
  },

  async instruments(signal) {
    // Markets that trade (half the list is on a break), without the permission sets: 0.5MB, not 1MB.
    const { symbols } = await get<{ symbols: { symbol: string; baseAsset: string; quoteAsset: string }[] }>(
      '/exchangeInfo?symbolStatus=TRADING&showPermissionSets=false', signal);
    return symbols.map((r) => ({ id: r.symbol, base: r.baseAsset, quote: r.quoteAsset }));
  },
});

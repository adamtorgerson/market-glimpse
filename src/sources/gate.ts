import { exchangeSource, UnknownMarketError, type Ticker } from './exchange';
import { HttpError, PublicApi } from './http';

const api = new PublicApi('https://api.gateio.ws/api/v4');

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  try {
    return await api.get<T>(path, signal);
  } catch (e) {
    if (e instanceof HttpError && e.body.includes('INVALID_CURRENCY_PAIR')) throw new UnknownMarketError();
    // Gate's error responses have no CORS headers, so in the browser an
    // unknown market looks like a network failure.
    if (e instanceof TypeError) throw new Error('unknown pair or offline');
    throw e;
  }
}

interface GateTicker { currency_pair: string; last: string; base_volume: string }
const toTicker = (t: GateTicker): Ticker => ({ last: +t.last, dayVolume: +t.base_volume });
// Gate names markets "BTC_USDT".
const toGate = (market: string) => market.replace('-', '_');

export const gate = exchangeSource({
  id: 'gate',
  label: 'Gate',
  api,
  intervals: { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 480: '8h', 1440: '1d', 10080: '7d' },

  async ticker(market, signal) {
    const [t] = await get<GateTicker[]>(`/spot/tickers?currency_pair=${encodeURIComponent(toGate(market))}`, signal);
    if (!t) throw new UnknownMarketError();
    return toTicker(t);
  },

  async tickers(signal) {
    const rows = await get<GateTicker[]>('/spot/tickers', signal);
    return new Map<string, Ticker>(rows.map((t) => [t.currency_pair.replace('_', '-'), toTicker(t)]));
  },

  async candles(market, interval, _intervalSec, count, signal) {
    // [time, quote volume, close, high, low, open, base volume, closed], oldest first.
    const rows = await get<string[][]>(
      `/spot/candlesticks?currency_pair=${encodeURIComponent(toGate(market))}&interval=${interval}&limit=${Math.min(count, 1000)}`,
      signal);
    return rows.map((r) => ({
      time: +r[0]!, close: +r[2]!, high: +r[3]!, low: +r[4]!, open: +r[5]!, volume: +r[6]!,
    }));
  },

  async stocks(signal) {
    // xStocks are named ticker + "X" ("TSLAX_USDT"); only their names say what they are.
    const rows = await get<{ id: string; base: string; quote: string; base_name?: string }[]>('/spot/currency_pairs', signal);
    return new Map(rows
      .filter((r) => r.base_name?.endsWith('xStock') && r.base.endsWith('X'))
      .map((r) => [`${r.base.slice(0, -1)}-${r.quote}`, r.id.replace('_', '-')]));
  },
});

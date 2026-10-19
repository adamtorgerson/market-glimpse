import { currentSlot, exchangeSource, UnknownMarketError, type Ticker } from './exchange';
import { PublicApi } from './http';

/**
 * Not registered in SOURCES: KuCoin sends no CORS headers, so browsers and
 * the Even WebView block its responses (checked in Chrome and the simulator).
 * Also add https://api.kucoin.com to the whitelist in app.json if enabling it.
 */
const api = new PublicApi('https://api.kucoin.com/api/v1');

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const body = await api.get<{ code: string; msg?: string; data: T }>(path, signal);
  if (body.code === '400100') throw new UnknownMarketError();
  if (body.code !== '200000') throw new Error(body.msg || `error ${body.code}`);
  return body.data;
}

export const kucoin = exchangeSource({
  id: 'kucoin',
  label: 'KuCoin',
  api,
  intervals: {
    1: '1min', 3: '3min', 5: '5min', 15: '15min', 30: '30min', 60: '1hour', 120: '2hour', 240: '4hour',
    360: '6hour', 480: '8hour', 720: '12hour', 1440: '1day', 10080: '1week',
  },

  async ticker(market, signal) {
    const s = await get<{ last: string | null; vol: string }>(`/market/stats?symbol=${encodeURIComponent(market)}`, signal);
    if (s.last === null) throw new UnknownMarketError();
    return { last: +s.last, dayVolume: +s.vol };
  },

  async tickers(signal) {
    const data = await get<{ ticker: { symbol: string; last: string | null; vol: string }[] }>('/market/allTickers', signal);
    const out = new Map<string, Ticker>();
    for (const t of data.ticker) if (t.last !== null) out.set(t.symbol, { last: +t.last, dayVolume: +t.vol });
    return out;
  },

  async candles(market, type, intervalSec, count, signal) {
    const startAt = currentSlot(intervalSec) - (count - 1) * intervalSec;
    // [time, open, close, high, low, base volume, turnover], newest first.
    const rows = await get<string[][]>(
      `/market/candles?type=${type}&symbol=${encodeURIComponent(market)}&startAt=${startAt}&endAt=${Math.floor(Date.now() / 1000)}`,
      signal);
    return rows.reverse().map((r) => ({
      time: +r[0]!, open: +r[1]!, close: +r[2]!, high: +r[3]!, low: +r[4]!, volume: +r[5]!,
    }));
  },
});

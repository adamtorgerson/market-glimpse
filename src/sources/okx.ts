import { exchangeSource, topOfBook, UnknownMarketError, type Ticker } from './exchange';
import { PublicApi } from './http';

const api = new PublicApi('https://www.okx.com/api/v5');

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const body = await api.get<{ code: string; msg: string; data: T }>(path, signal);
  if (body.code === '51001') throw new UnknownMarketError();
  if (body.code !== '0') throw new Error(body.msg || `error ${body.code}`);
  return body.data;
}

// For spot, vol24h is in the base currency and volCcy24h in the quote.
interface OkxTicker { instId: string; last: string; vol24h: string; volCcy24h: string; open24h: string; bidPx: string; bidSz: string; askPx: string; askSz: string }
const toTicker = (t: OkxTicker): Ticker => ({
  last: +t.last, dayVolume: +t.vol24h, open: +t.open24h, quoteVolume: +t.volCcy24h, topOfBook: topOfBook(+t.bidPx, +t.bidSz, +t.askPx, +t.askSz),
});

export const okx = exchangeSource({
  id: 'okx',
  label: 'OKX',
  api,
  // The UTC variants keep 6h and longer candles on UTC boundaries (the default is UTC+8).
  intervals: {
    1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1H', 120: '2H', 240: '4H',
    360: '6Hutc', 720: '12Hutc', 1440: '1Dutc', 10080: '1Wutc',
  },

  async ticker(market, signal) {
    const [t] = await get<OkxTicker[]>(`/market/ticker?instId=${encodeURIComponent(market)}`, signal);
    if (!t) throw new UnknownMarketError();
    return toTicker(t);
  },

  async tickers(signal) {
    const rows = await get<OkxTicker[]>('/market/tickers?instType=SPOT', signal);
    return new Map<string, Ticker>(rows.map((t) => [t.instId, toTicker(t)]));
  },

  async candles(market, bar, _intervalSec, count, signal) {
    // [ts ms, open, high, low, close, base volume, …], newest first.
    const rows = await get<string[][]>(
      `/market/candles?instId=${encodeURIComponent(market)}&bar=${bar}&limit=${Math.min(count, 300)}`, signal);
    return rows.reverse().map((r) => ({
      time: +r[0]! / 1000, open: +r[1]!, high: +r[2]!, low: +r[3]!, close: +r[4]!, volume: +r[5]!,
    }));
  },

  async instruments(signal) {
    // Category 3 is tokenized stocks (xStocks), named "X" + ticker ("XTSLA-USDT").
    const rows = await get<{ instId: string; baseCcy: string; quoteCcy: string; instCategory: string }[]>(
      '/public/instruments?instType=SPOT', signal);
    return rows.map((r) => ({
      id: r.instId,
      base: r.baseCcy,
      quote: r.quoteCcy,
      stock: r.instCategory === '3' && r.baseCcy.startsWith('X') ? r.baseCcy.slice(1) : undefined,
    }));
  },
});

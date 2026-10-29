import { exchangeSource, topOfBook, UnknownMarketError, type Ticker } from './exchange';
import { HttpError, PublicApi } from './http';

const api = new PublicApi('https://api.bitget.com/api/v2/spot');

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  let body: { code: string; msg: string; data: T };
  try {
    body = await api.get(path, signal);
  } catch (e) {
    // "Parameter … does not exist"
    if (e instanceof HttpError && e.body.includes('"40034"')) throw new UnknownMarketError();
    throw e;
  }
  if (body.code !== '00000') throw new Error(body.msg || `error ${body.code}`);
  return body.data;
}

// `open` is the price 24h ago (`openUtc` is midnight UTC's).
interface BitgetTicker { symbol: string; lastPr: string; baseVolume: string; quoteVolume: string; open: string; bidPr: string; bidSz: string; askPr: string; askSz: string }
const toTicker = (t: BitgetTicker): Ticker => ({
  last: +t.lastPr, dayVolume: +t.baseVolume, open: +t.open, quoteVolume: +t.quoteVolume, topOfBook: topOfBook(+t.bidPr, +t.bidSz, +t.askPr, +t.askSz),
});

export const bitget = exchangeSource({
  id: 'bitget',
  label: 'Bitget',
  api,
  // The UTC variants keep 6h and longer candles on UTC boundaries (the default is UTC+8).
  intervals: {
    1: '1min', 3: '3min', 5: '5min', 15: '15min', 30: '30min', 60: '1h', 240: '4h',
    360: '6Hutc', 720: '12Hutc', 1440: '1Dutc', 4320: '3Dutc', 10080: '1Wutc',
  },

  async ticker(market, signal) {
    const [t] = await get<BitgetTicker[]>(`/market/tickers?symbol=${encodeURIComponent(market)}`, signal);
    if (!t) throw new UnknownMarketError();
    return toTicker(t);
  },

  async tickers(signal) {
    const rows = await get<BitgetTicker[]>('/market/tickers', signal);
    return new Map<string, Ticker>(rows.map((t) => [t.symbol, toTicker(t)]));
  },

  async candles(market, granularity, _intervalSec, count, signal) {
    // [ts ms, open, high, low, close, base volume, …], oldest first.
    const rows = await get<string[][]>(
      `/market/candles?symbol=${encodeURIComponent(market)}&granularity=${granularity}&limit=${Math.min(count, 1000)}`, signal);
    return rows.map((r) => ({
      time: +r[0]! / 1000, open: +r[1]!, high: +r[2]!, low: +r[3]!, close: +r[4]!, volume: +r[5]!,
    }));
  },

  async instruments(signal) {
    // Bitget's stock tokens are "r" + ticker ("rTSLA", market "RTSLAUSDT");
    // no coin's code has a lowercase letter but two pre-IPO tokens ("preSPCX").
    const rows = await get<{ symbol: string; baseCoin: string; quoteCoin: string; status: string }[]>('/public/symbols', signal);
    return rows.filter((r) => r.status === 'online').map((r) => ({
      id: r.symbol,
      base: r.baseCoin.toUpperCase(),
      quote: r.quoteCoin,
      stock: /^r[A-Z0-9.]+$/.test(r.baseCoin) ? r.baseCoin.slice(1) : undefined,
    }));
  },
});

import { exchangeSource, topOfBook, UnknownMarketError, type Ticker } from './exchange';
import { HttpError, PublicApi } from './http';

// Aster's spot API, a copy of Binance's (its perps are on fapi.asterdex.com).
const api = new PublicApi('https://sapi.asterdex.com/api/v1');

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  try {
    return await api.get<T>(path, signal);
  } catch (e) {
    if (e instanceof HttpError && e.body.includes('-1121')) throw new UnknownMarketError();
    throw e;
  }
}

interface AsterTicker {
  symbol: string; lastPrice: string; volume: string; quoteVolume: string; openPrice: string;
  bidPrice: string; bidQty: string; askPrice: string; askQty: string;
}
const toTicker = (t: AsterTicker): Ticker => ({
  last: +t.lastPrice, dayVolume: +t.volume, open: +t.openPrice, quoteVolume: +t.quoteVolume,
  topOfBook: topOfBook(+t.bidPrice, +t.bidQty, +t.askPrice, +t.askQty),
});

export const aster = exchangeSource({
  id: 'aster',
  label: 'Aster',
  api,
  intervals: {
    1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 360: '6h', 480: '8h',
    720: '12h', 1440: '1d', 4320: '3d', 10080: '1w',
  },

  async ticker(market, signal) {
    return toTicker(await get<AsterTicker>(`/ticker/24hr?symbol=${encodeURIComponent(market)}`, signal));
  },

  async tickers(signal) {
    // `symbols=` is ignored: every market's, about 90KB.
    const rows = await get<AsterTicker[]>('/ticker/24hr', signal);
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
    // Aster's stock tokens are ticker + "B" ("NVDAB"). Coins can end in B too
    // ("BNB", "LAB"): a token counts as a stock only if its ticker is at
    // least three letters and isn't itself listed as a coin.
    const { symbols } = await get<{ symbols: { symbol: string; baseAsset: string; quoteAsset: string; status: string }[] }>(
      '/exchangeInfo', signal);
    const trading = symbols.filter((r) => r.status === 'TRADING');
    const bases = new Set(trading.map((r) => r.baseAsset));
    return trading.map((r) => {
      const ticker = r.baseAsset.slice(0, -1);
      const stock = /^[A-Z]{3,}B$/.test(r.baseAsset) && !bases.has(ticker) ? ticker : undefined;
      return { id: r.symbol, base: r.baseAsset, quote: r.quoteAsset, stock };
    });
  },
});

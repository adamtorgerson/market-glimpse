import { exchangeSource, topOfBook, UnknownMarketError, type Ticker } from './exchange';
import { HttpError, PublicApi } from './http';
import type { MarketSource } from './types';

interface BinanceTicker {
  symbol: string; lastPrice: string; volume: string; quoteVolume: string; openPrice: string;
  bidPrice: string; bidQty: string; askPrice: string; askQty: string;
}
const toTicker = (t: BinanceTicker): Ticker => ({
  last: +t.lastPrice, dayVolume: +t.volume, open: +t.openPrice, quoteVolume: +t.quoteVolume,
  topOfBook: topOfBook(+t.bidPrice, +t.bidQty, +t.askPrice, +t.askQty),
});

/** A source on Binance's spot API, which Binance.com and Binance.US share. */
export function binanceApiSource(id: string, label: string, base: string, currencies?: readonly string[]): MarketSource {
  const api = new PublicApi(base);

  async function get<T>(path: string, signal: AbortSignal): Promise<T> {
    try {
      return await api.get<T>(path, signal);
    } catch (e) {
      if (e instanceof HttpError && e.body.includes('-1121')) throw new UnknownMarketError();
      // Binance's error responses have no CORS headers, so in the browser an
      // unknown market, or a region it refuses (HTTP 451), looks like a network failure.
      if (e instanceof TypeError) throw new Error('unknown pair, offline or blocked');
      throw e;
    }
  }

  return exchangeSource({
    id,
    label,
    api,
    currencies,
    intervals: {
      1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 360: '6h', 480: '8h',
      720: '12h', 1440: '1d', 4320: '3d', 10080: '1w',
    },

    async ticker(market, signal) {
      return toTicker(await get<BinanceTicker>(`/ticker/24hr?symbol=${encodeURIComponent(market)}`, signal));
    },

    async tickers(signal, ids) {
      // Just the markets asked for (one unknown symbol fails the lot, but they
      // come from the market list), or with none, every market.
      const rows = await get<BinanceTicker[]>(ids.length ? `/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(ids))}` : '/ticker/24hr', signal);
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
      // Markets that trade (many are on a break), without the permission sets, which are about half the size.
      const { symbols } = await get<{ symbols: { symbol: string; baseAsset: string; quoteAsset: string }[] }>(
        '/exchangeInfo?symbolStatus=TRADING&showPermissionSets=false', signal);
      return symbols.map((r) => ({ id: r.symbol, base: r.baseAsset, quote: r.quoteAsset }));
    },
  });
}

// Binance.com refuses the US (HTTP 451), so development uses its public
// market-data mirror, which has the same paths and data for spot markets.
// Only api.binance.com is whitelisted in app.json: release builds never call the mirror.
//
// Its markets are mostly quoted in USDT. USD isn't offered: it has only a few
// thin markets (BTC-USD trades 0.02% of BTC-USDT's volume), which a bare "BTC"
// would land on. They can still be typed. Nor is AUD, which it doesn't quote in.
export const binance = binanceApiSource(
  'binance', 'Binance', import.meta.env.DEV ? 'https://data-api.binance.vision/api/v3' : 'https://api.binance.com/api/v3',
  ['USDT', 'USDC', 'EUR', 'JPY', 'TRY', 'BRL']);

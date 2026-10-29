import { exchangeSource, topOfBook, UnknownMarketError, type Ticker } from './exchange';
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

interface GateTicker {
  currency_pair: string; last: string; base_volume: string; quote_volume: string; change_percentage: string;
  highest_bid: string; highest_size: string; lowest_ask: string; lowest_size: string;
}
const toTicker = (t: GateTicker): Ticker => ({
  last: +t.last, dayVolume: +t.base_volume, quoteVolume: +t.quote_volume,
  // Gate gives the 24h change, in percent, rather than the open.
  open: +t.last / (1 + +t.change_percentage / 100),
  topOfBook: topOfBook(+t.highest_bid, +t.highest_size, +t.lowest_ask, +t.lowest_size),
});
function stock(base: string, name: string): { stock?: string; ondo?: boolean } {
  if (name.endsWith('xStock') && base.endsWith('X')) return { stock: base.slice(0, -1) };
  if (name.includes('Ondo Tokenized') && base.endsWith('ON')) return { stock: base.slice(0, -2), ondo: true };
  return {};
}

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

  async topOfBook(market, signal) {
    // Its all-markets tickers leave out the sizes at the best bid and ask; one market's has them.
    const [t] = await get<GateTicker[]>(`/spot/tickers?currency_pair=${encodeURIComponent(toGate(market))}`, signal);
    return t && toTicker(t).topOfBook;
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

  async instruments(signal) {
    // Stocks are xStocks, named ticker + "X" ("TSLAX_USDT"), and Ondo tokens,
    // ticker + "ON" ("MSFTON_USDT"); only their names say what they are.
    // (Gate's own stock tokens, ticker + "G", can't be told from coins ending in G
    // without its 2MB currency list, so they're left out.)
    const rows = await get<{ id: string; base: string; quote: string; base_name?: string; trade_status: string }[]>(
      '/spot/currency_pairs', signal);
    return rows.filter((r) => r.trade_status !== 'untradable').map((r) => ({
      id: r.id.replace('_', '-'),
      base: r.base,
      quote: r.quote,
      ...stock(r.base, r.base_name ?? ''),
    }));
  },
});

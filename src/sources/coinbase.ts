import { currentSlot, exchangeSource, topOfBook, UnknownMarketError, type Ticker } from './exchange';
import { HttpError, PublicApi } from './http';

// The Exchange API; the newer Advanced Trade API doesn't send CORS headers.
const api = new PublicApi('https://api.exchange.coinbase.com');

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  try {
    return await api.get<T>(path, signal);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new UnknownMarketError();
    if (e instanceof HttpError && e.body.includes('delisted')) throw new Error('delisted');
    throw e;
  }
}

export const coinbase = exchangeSource({
  id: 'coinbase',
  label: 'Coinbase',
  api,
  intervals: { 1: '60', 5: '300', 15: '900', 60: '3600', 360: '21600', 1440: '86400' },

  async ticker(market, signal) {
    const s = await get<{ last: string; volume: string }>(`/products/${encodeURIComponent(market)}/stats`, signal);
    return { last: +s.last, dayVolume: +s.volume };
  },

  async tickers(signal) {
    const stats = await get<Record<string, { stats_24hour?: { last: string; volume: string; open: string } }>>('/products/stats', signal);
    const out = new Map<string, Ticker>();
    for (const [id, s] of Object.entries(stats)) {
      if (s.stats_24hour) out.set(id, { last: +s.stats_24hour.last, dayVolume: +s.stats_24hour.volume, open: +s.stats_24hour.open });
    }
    return out;
  },

  async topOfBook(market, signal) {
    // The best bid and ask only (level 1), not the book.
    const book = await get<{ bids: [string, string][]; asks: [string, string][] }>(`/products/${encodeURIComponent(market)}/book?level=1`, signal);
    const [bid, ask] = [book.bids[0], book.asks[0]];
    return bid && ask ? topOfBook(+bid[0], +bid[1], +ask[0], +ask[1]) : undefined;
  },

  async candles(market, granularity, intervalSec, count, signal) {
    const start = currentSlot(intervalSec) - (count - 1) * intervalSec;
    // [time, low, high, open, close, volume], newest first.
    const rows = await get<number[][]>(
      `/products/${encodeURIComponent(market)}/candles?granularity=${granularity}&start=${start}&end=${Math.floor(Date.now() / 1000)}`,
      signal);
    return rows.reverse().map((r) => ({
      time: r[0]!, low: r[1]!, high: r[2]!, open: r[3]!, close: r[4]!, volume: r[5]!,
    }));
  },

  async instruments(signal) {
    // Coinbase has no tokenized stocks.
    const rows = await get<{ id: string; base_currency: string; quote_currency: string; status: string }[]>('/products', signal);
    return rows.filter((r) => r.status !== 'delisted').map((r) => ({ id: r.id, base: r.base_currency, quote: r.quote_currency }));
  },
});

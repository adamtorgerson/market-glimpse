import { exchangeSource, topOfBook, UnknownMarketError, type Ticker } from './exchange';
import { PublicApi } from './http';

// Hyperliquid's spot markets. Every request is a POST to /info, saying what it wants.
const api = new PublicApi('https://api.hyperliquid.xyz');

const info = <T>(body: Record<string, unknown>, signal: AbortSignal) => api.post<T>('/info', body, signal);

interface SpotMeta {
  tokens: { name: string; index: number; fullName: string | null }[];
  /** Pairs, named "PURR/USDC" or (most) "@107"; `tokens` is [base, quote]. */
  universe: { name: string; tokens: [number, number] }[];
}

// No last trade: the mid price. Volumes are 24h, `dayNtlVlm` in the quote.
interface SpotCtx { coin: string; midPx: string | null; markPx: string; prevDayPx: string; dayBaseVlm: string; dayNtlVlm: string }
const toTicker = (c: SpotCtx): Ticker => ({
  last: +(c.midPx ?? c.markPx), dayVolume: +c.dayBaseVlm, open: +c.prevDayPx, quoteVolume: +c.dayNtlVlm,
});

/**
 * A token's common code and, for an xStock, its ticker. Unit bridges other
 * chains' coins in as "U" + code ("UBTC", "Unit Bitcoin"); xStocks are
 * ticker + "X" ("TSLAX", "Wrapped Tesla xStock", or Unit's "USPYX"); USDT
 * arrives as LayerZero's USDT0.
 */
function token(t: SpotMeta['tokens'][number]): { code: string; stock?: string } {
  const full = t.fullName ?? '';
  const code = full.startsWith('Unit ') && t.name.startsWith('U') ? t.name.slice(1) : t.name === 'USDT0' ? 'USDT' : t.name;
  return { code, stock: full.endsWith('xStock') && code.endsWith('X') ? code.slice(0, -1) : undefined };
}

/**
 * Stock and ETF tickers that anyone can deploy a token under ("MSFT",
 * "AAPL"): such tokens aren't the stock and trade far from its price, so only
 * xStocks count. Along with every ticker Hyperliquid has an xStock for, these
 * are the large US stocks that exchanges tokenize, less any that are also a
 * coin's name.
 */
const STOCKS = new Set([
  'AAPL', 'ABBV', 'ADBE', 'AMD', 'AMZN', 'ARM', 'AVGO', 'BABA', 'BAC', 'BRK.B', 'COIN', 'COST', 'CRCL', 'CRM', 'CRWD',
  'CSCO', 'DIS', 'GME', 'GOOG', 'GOOGL', 'HOOD', 'IBM', 'INTC', 'IWM', 'JNJ', 'JPM', 'KO', 'LLY', 'MA', 'MCD', 'META',
  'MRVL', 'MSFT', 'MSTR', 'MU', 'NFLX', 'NKE', 'NVDA', 'ORCL', 'PEP', 'PFE', 'PLTR', 'QQQ', 'RKLB', 'SMCI', 'SPY',
  'TSLA', 'TSM', 'UBER', 'UNH', 'VOO', 'VTI', 'WMT', 'XOM',
]);

/** Candle sizes in minutes, by the API's name for each. */
const INTERVALS: Record<number, string> = {
  1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 480: '8h',
  720: '12h', 1440: '1d', 4320: '3d', 10080: '1w',
};

export const hyperliquid = exchangeSource({
  id: 'hyperliquid',
  label: 'Hyperliquid',
  api,
  intervals: INTERVALS,

  async ticker(market, signal) {
    const t = (await this.tickers(signal, [market])).get(market);
    if (!t) throw new UnknownMarketError();
    return t;
  },

  async tickers(signal) {
    // Only all at once, with the market list (about 350KB): there's no single-market ticker.
    const [, ctxs] = await info<[SpotMeta, SpotCtx[]]>({ type: 'spotMetaAndAssetCtxs' }, signal);
    return new Map<string, Ticker>(ctxs.map((c) => [c.coin, toTicker(c)]));
  },

  async candles(market, interval, intervalSec, count, signal) {
    // Asked for by time: candles opened in the last `count` intervals are the
    // `count` most recent, wherever the exchange starts its weeks.
    const startTime = Date.now() - count * intervalSec * 1000;
    const rows = await info<{ t: number; o: string; h: string; l: string; c: string; v: string }[]>(
      { type: 'candleSnapshot', req: { coin: market, interval, startTime } }, signal);
    return rows.map((r) => ({ time: r.t / 1000, open: +r.o, high: +r.h, low: +r.l, close: +r.c, volume: +r.v }));
  },

  async instruments(signal) {
    // Pairs with no book or no trades in 24h (some xStocks, "TSLAX"; most tokens
    // named after stocks) are left out: a chart of one would be empty.
    const [meta, ctxs] = await info<[SpotMeta, SpotCtx[]]>({ type: 'spotMetaAndAssetCtxs' }, signal);
    const live = new Set(ctxs.filter((c) => c.midPx !== null && +c.dayNtlVlm > 0).map((c) => c.coin));
    const tokens = new Map(meta.tokens.map((t) => [t.index, token(t)]));
    // Tokens named after a stock that aren't its xStock (see STOCKS) are left out too.
    const stocks = new Set([...STOCKS, ...[...tokens.values()].flatMap((t) => t.stock ?? [])]);
    return meta.universe.filter((p) => live.has(p.name)).flatMap((p) => {
      const base = tokens.get(p.tokens[0]);
      const quote = tokens.get(p.tokens[1]);
      if (!base || !quote || (!base.stock && stocks.has(base.code))) return [];
      return [{ id: p.name, base: base.code, quote: quote.code, stock: base.stock }];
    });
  },

  async topOfBook(market, signal) {
    // The tickers have no sizes: the best bid and ask from the book, [bids, asks].
    const { levels } = await info<{ levels: [{ px: string; sz: string }[], { px: string; sz: string }[]] }>(
      { type: 'l2Book', coin: market }, signal);
    const [bid, ask] = [levels[0][0], levels[1][0]];
    return bid && ask ? topOfBook(+bid.px, +bid.sz, +ask.px, +ask.sz) : undefined;
  },
});

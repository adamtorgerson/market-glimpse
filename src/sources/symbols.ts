/**
 * Turning what the user typed ("TSLA", "BTC-USDT", "xtsla-usd") into the
 * instrument an exchange actually trades, and naming that instrument the way
 * CoinGecko does. Every source loads its market list once and resolves
 * names against it here, so no request is made for a market that doesn't
 * exist.
 */

/** Fiat currencies most of the sources quote in: the choices for a market typed without a quote. */
export const CURRENCIES = ['USD', 'EUR', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = 'USD';

/** Dollar quotes, interchangeable when looking a market up, in the order to try them. */
export const DOLLARS = ['USD', 'USDT', 'USDC'];
/** Quotes CoinGecko prices as USD. */
const USD_LIKE = new Set([...DOLLARS, 'DAI', 'PYUSD', 'USD1']);

// Kraken's codes for a few assets; everyone else uses the common ones.
const ALIASES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' };
export const canonAsset = (asset: string) => ALIASES[asset.toUpperCase()] ?? asset.toUpperCase();

export interface Instrument {
  /** The exchange's name for it in requests, e.g. "XTSLA-USDT", or Kraken's "TSLAxUSD". */
  id: string;
  /** Common asset code, uppercase: "BTC" (not Kraken's "XBT"), "XTSLA". */
  base: string;
  quote: string;
  /** For a tokenized stock, its ticker: "TSLA". */
  stock?: string;
  /** A stock token from Ondo ("TSLAON") rather than an xStock: used only where there's no xStock. */
  ondo?: boolean;
}

/** The quotes to try for `quote`: any dollar stands for the others. */
function quotesFor(quote: string): string[] {
  return DOLLARS.includes(quote) ? [quote, ...DOLLARS.filter((q) => q !== quote)] : [quote];
}

/** Tickers a stock may be typed as: "TSLA", or as Kraken and Gate ("TSLAX") or OKX ("XTSLA") spell its token. */
function stockTickers(name: string): string[] {
  return [...new Set([name, name.replace(/X$/, ''), name.replace(/^X/, '')])].filter(Boolean);
}

/** An exchange's markets, for looking up typed names. */
export class Catalog<T extends Instrument = Instrument> {
  private readonly pairs = new Map<string, T>();
  private readonly stocks = new Map<string, T>();
  /** Every instrument, as listed. */
  readonly all: readonly T[];

  constructor(instruments: Iterable<T>) {
    this.all = [...instruments];
    for (const i of this.all) {
      const pair = `${i.base}-${i.quote}`;
      if (!this.pairs.has(pair)) this.pairs.set(pair, i);
      if (i.stock) {
        const stock = `${i.stock}-${i.quote}`;
        const had = this.stocks.get(stock);
        if (!had || (had.ondo && !i.ondo)) this.stocks.set(stock, i);
      }
    }
  }

  get size(): number {
    return this.pairs.size;
  }

  /**
   * The instrument a typed market means, if the exchange has it.
   *
   * "BASE-QUOTE" is that pair, else the stock BASE in that quote.
   * "NAME" (no quote) is first the stock NAME, then the coin NAME, quoted in
   * `currency`.
   *
   * A dollar means any of USD, USDT and USDC, tried in that order starting
   * with the one given: exchanges quote stocks in different dollars, and OKX
   * and Gate quote almost no coins in USD itself.
   */
  resolve(market: string, currency: string): T | undefined {
    const [rawBase, rawQuote] = market.toUpperCase().split('-');
    if (!rawBase) return undefined;
    const base = canonAsset(rawBase);
    const quote = rawQuote ? canonAsset(rawQuote) : undefined;
    const quotes = quotesFor(quote ?? currency.toUpperCase());
    // A quoted market is the exact pair if there is one; otherwise, like a bare name, a stock then a coin.
    return (quote ? this.pairs.get(`${base}-${quote}`) : undefined)
      ?? this.first(this.stocks, stockTickers(rawBase), quotes)
      ?? this.first(this.pairs, [base], quotes);
  }

  private first(map: Map<string, T>, bases: string[], quotes: string[]): T | undefined {
    for (const b of bases) for (const q of quotes) {
      const i = map.get(`${b}-${q}`);
      if (i) return i;
    }
    return undefined;
  }
}

/**
 * CoinGecko's symbol and currency for an instrument: an xStock is its ticker
 * + "x" ("tslax", however the exchange spells it), anything else (a coin, an
 * Ondo token) its common code. Currencies CoinGecko doesn't price in
 * just come back empty, leaving the index blank.
 */
export function coinGeckoName(i: Instrument): { symbol: string; vs: string } {
  return {
    symbol: (i.stock && !i.ondo ? `${i.stock}x` : i.base).toLowerCase(),
    vs: USD_LIKE.has(i.quote) ? 'usd' : i.quote.toLowerCase(),
  };
}

/** Assets that are money rather than markets: Explore leaves out their pairs (USDC-USDT, EUR-USD). */
const MONEY = new Set([
  'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'CHF', 'TRY', 'BRL',
  'USDT', 'USDC', 'DAI', 'PYUSD', 'USD1', 'FDUSD', 'TUSD', 'USDE', 'USDS', 'USDD', 'BUSD', 'USDP', 'GUSD', 'RLUSD', 'USDG',
  'EURC', 'EURT', 'EURQ', 'EURR', 'AUDD',
]);

/** Leveraged tokens (Gate's "SKHYNIX5L", 5× long; "BTC3S", 3× short; "ETHBULL"): bets on a market, not markets. */
const LEVERAGED = /(\d[LS]|BULL|BEAR)$/;

/** Markets ranked by their volume are only the most traded this many, for movers: thin markets swing wildly. */
const MOVERS_POOL = 100;

/**
 * The top `n` markets by `by`, among those quoted in `currency` (any dollar
 * for USD), one per asset (its most traded market), leaving out pairs of
 * money. Biggest movers are by the size of the change, either way, and most
 * liquid by the money at the top of the book, both among the MOVERS_POOL
 * most traded (a big order resting on a dead market isn't liquidity).
 */
export function rankMarkets<R extends { instrument: Instrument; last: number; quoteVolume: number; change?: number; topOfBook?: number }>(
  rows: R[],
  by: 'volume' | 'movers' | 'liquidity',
  currency: string,
  n: number,
): R[] {
  const quotes = DOLLARS.includes(currency) ? DOLLARS : [currency];
  const best = new Map<string, R>();
  for (const r of rows) {
    const i = r.instrument;
    if (!quotes.includes(i.quote) || MONEY.has(i.base) || LEVERAGED.test(i.base) || !(r.quoteVolume > 0) || !(r.last > 0)) continue;
    const asset = i.stock ?? i.base;
    if (!(best.get(asset)?.quoteVolume! >= r.quoteVolume)) best.set(asset, r);
  }
  const byVolume = [...best.values()].sort((a, b) => b.quoteVolume - a.quoteVolume);
  if (by === 'volume') return byVolume.slice(0, n);
  if (by === 'liquidity') {
    return byVolume.slice(0, MOVERS_POOL).filter((r) => r.topOfBook !== undefined && Number.isFinite(r.topOfBook))
      .sort((a, b) => b.topOfBook! - a.topOfBook!).slice(0, n);
  }
  return byVolume.slice(0, MOVERS_POOL).filter((r) => r.change !== undefined && Number.isFinite(r.change))
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!)).slice(0, n);
}

/** How Explore names a market it found, so the catalog finds it again: "BTC-USDT", or a stock "TSLA-USDT". */
export function marketName(i: Instrument): string {
  return `${i.stock ?? i.base}-${i.quote}`;
}

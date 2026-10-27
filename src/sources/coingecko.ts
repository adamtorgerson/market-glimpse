import { PublicApi, isAbort } from './http';

// The keyless API allows only a few calls a minute per IP, so space them well beyond MIN_GAP_MS.
const api = new PublicApi('https://api.coingecko.com/api/v3', 12_000);

// Kraken-style codes and stablecoins mapped to CoinGecko symbols / currencies.
const BASE_ALIASES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' };
const USD_LIKE = new Set(['USD', 'USDC', 'USDT', 'DAI', 'PYUSD', 'USD1']);

/**
 * The CoinGecko symbols to try for a market, best first, and the currency.
 * A market with no quote is a stock in USD, priced as its xStock ("TSLA" is
 * "tslax", the token the exchanges trade), else by its plain ticker. OKX's
 * "XTSLA" spelling has no symbol of its own, so it falls back to "tslax".
 */
function split(market: string): { symbols: string[]; vs: string } | null {
  const [base, quote] = market.split('-');
  if (!base) return null;
  if (!quote) {
    const ticker = base.replace(/^X/, '').replace(/X$/, '').toLowerCase();
    return { symbols: [`${ticker}x`, ticker], vs: 'usd' };
  }
  const symbol = (BASE_ALIASES[base] ?? base).toLowerCase();
  return {
    symbols: base.startsWith('X') && !BASE_ALIASES[base] ? [symbol, `${base.slice(1).toLowerCase()}x`] : [symbol],
    vs: USD_LIKE.has(quote) ? 'usd' : (BASE_ALIASES[quote] ?? quote).toLowerCase(),
  };
}

/** Rough ms for the index request if made now. */
export function estimateIndexMs(markets: string[]): number {
  return api.estimateMs(markets.length ? 1 : 0);
}

/**
 * CoinGecko's aggregated (index) price for each market, in one request.
 * Stablecoin quotes (USDC, USDT, …) are priced in USD. Markets CoinGecko
 * doesn't know, and any failure, just leave the market out.
 */
export async function fetchIndexPrices(markets: string[], signal: AbortSignal): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const parts = markets.map((m) => [m, split(m)] as const).filter((x): x is [string, NonNullable<ReturnType<typeof split>>] => !!x[1]);
  if (parts.length === 0) return out;
  const symbols = [...new Set(parts.flatMap(([, p]) => p.symbols))].join(',');
  const vs = [...new Set(parts.map(([, p]) => p.vs))].join(',');
  try {
    const body = await api.get<Record<string, Record<string, number>>>(
      `/simple/price?symbols=${encodeURIComponent(symbols)}&vs_currencies=${encodeURIComponent(vs)}&precision=full`, signal);
    for (const [m, p] of parts) {
      const price = p.symbols.map((s) => body[s]?.[p.vs]).find((x) => x !== undefined);
      if (price !== undefined) out.set(m, price);
    }
  } catch (e) {
    if (isAbort(e)) throw e;
    console.warn('CoinGecko index prices unavailable', e);
  }
  return out;
}

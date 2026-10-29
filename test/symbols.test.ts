import { describe, expect, it } from 'vitest';
import { Catalog, coinGeckoName, marketName, rankMarkets, type Instrument } from '../src/sources/symbols';

// Each exchange's markets, named as its market list names them.
const kraken = new Catalog([
  { id: 'TSLAxUSD', base: 'TSLAX', quote: 'USD', stock: 'TSLA' },
  { id: 'AAPLxUSD', base: 'AAPLX', quote: 'USD', stock: 'AAPL' },
  { id: 'XBTUSD', base: 'BTC', quote: 'USD' },
  { id: 'XBTUSDT', base: 'BTC', quote: 'USDT' },
  { id: 'XBTEUR', base: 'BTC', quote: 'EUR' },
  { id: 'XBTAUD', base: 'BTC', quote: 'AUD' },
  { id: 'XRPUSD', base: 'XRP', quote: 'USD' },
  { id: 'XDGUSD', base: 'DOGE', quote: 'USD' },
]);
const okx = new Catalog([
  { id: 'XTSLA-USDT', base: 'XTSLA', quote: 'USDT', stock: 'TSLA' },
  { id: 'XTSLA-USDC', base: 'XTSLA', quote: 'USDC', stock: 'TSLA' },
  { id: 'XBB-USDT', base: 'XBB', quote: 'USDT', stock: 'BB' },
  { id: 'BB-USDT', base: 'BB', quote: 'USDT' },
  { id: 'BTC-USDT', base: 'BTC', quote: 'USDT' },
  { id: 'BTC-USDC', base: 'BTC', quote: 'USDC' },
  { id: 'BTC-EUR', base: 'BTC', quote: 'EUR' },
  { id: 'XRP-USDT', base: 'XRP', quote: 'USDT' },
  { id: 'USDT-USD', base: 'USDT', quote: 'USD' },
]);
const gate = new Catalog([
  { id: 'TSLAX-USDT', base: 'TSLAX', quote: 'USDT', stock: 'TSLA' },
  { id: 'TSLAON-USDT', base: 'TSLAON', quote: 'USDT', stock: 'TSLA', ondo: true },
  { id: 'MSFTON-USDT', base: 'MSFTON', quote: 'USDT', stock: 'MSFT', ondo: true },
  { id: 'BTC-USDT', base: 'BTC', quote: 'USDT' },
  { id: 'IMX-USDT', base: 'IMX', quote: 'USDT' },
]);
const bitget = new Catalog([
  { id: 'RTSLAUSDT', base: 'RTSLA', quote: 'USDT', stock: 'TSLA' },
  { id: 'BTCUSDT', base: 'BTC', quote: 'USDT' },
  { id: 'BTCEUR', base: 'BTC', quote: 'EUR' },
]);
const coinbase = new Catalog([
  { id: 'BTC-USD', base: 'BTC', quote: 'USD' },
  { id: 'BTC-USDC', base: 'BTC', quote: 'USDC' },
  { id: 'BTC-EUR', base: 'BTC', quote: 'EUR' },
  { id: 'ETH-USD', base: 'ETH', quote: 'USD' },
]);

const id = (c: Catalog, market: string, currency = 'USD') => c.resolve(market, currency)?.id;

describe('a market with no quote', () => {
  it('is a stock first, in dollars', () => {
    expect(id(kraken, 'TSLA')).toBe('TSLAxUSD');
    expect(id(okx, 'TSLA')).toBe('XTSLA-USDT');
    expect(id(gate, 'TSLA')).toBe('TSLAX-USDT');
    expect(id(coinbase, 'TSLA')).toBeUndefined();
  });

  it('is a stock even where a coin has the same name', () => {
    expect(id(okx, 'BB')).toBe('XBB-USDT');
    expect(id(okx, 'BB-USDT')).toBe('BB-USDT');
  });

  it('is otherwise a coin in the chosen currency', () => {
    expect(id(kraken, 'BTC')).toBe('XBTUSD');
    expect(id(coinbase, 'BTC')).toBe('BTC-USD');
    expect(id(kraken, 'BTC', 'EUR')).toBe('XBTEUR');
    expect(id(okx, 'BTC', 'EUR')).toBe('BTC-EUR');
    expect(id(kraken, 'BTC', 'AUD')).toBe('XBTAUD');
    expect(id(coinbase, 'BTC', 'AUD')).toBeUndefined();
    expect(id(gate, 'BTC', 'EUR')).toBeUndefined();
  });

  it('takes USD as USDT, then USDC, where the exchange has no USD market', () => {
    expect(id(okx, 'BTC')).toBe('BTC-USDT');
    expect(id(gate, 'BTC')).toBe('BTC-USDT');
    expect(id(okx, 'XRP')).toBe('XRP-USDT');
  });

  it('has no stocks outside dollars', () => {
    expect(id(kraken, 'TSLA', 'EUR')).toBeUndefined();
    expect(id(okx, 'TSLA', 'EUR')).toBeUndefined();
  });

  it("doesn't turn a near miss into a different coin", () => {
    expect(id(okx, 'RP')).toBeUndefined(); // not XRP
    expect(id(gate, 'IM')).toBeUndefined(); // not IMX
    expect(id(gate, 'TSLAO')).toBeUndefined(); // not Ondo's TSLAON
  });

  it("is Bitget's own token on Bitget", () => {
    expect(id(bitget, 'TSLA')).toBe('RTSLAUSDT');
    expect(id(bitget, 'TSLA-USD')).toBe('RTSLAUSDT');
    expect(id(bitget, 'RTSLA')).toBe('RTSLAUSDT');
    expect(id(bitget, 'BTC')).toBe('BTCUSDT');
    expect(id(bitget, 'BTC', 'EUR')).toBe('BTCEUR');
  });

  it("is an Ondo token where there's no xStock", () => {
    expect(id(gate, 'MSFT')).toBe('MSFTON-USDT');
    expect(id(gate, 'MSFT-USD')).toBe('MSFTON-USDT');
    expect(id(gate, 'TSLA')).toBe('TSLAX-USDT');
  });

  it('takes Kraken codes for coins', () => {
    expect(id(kraken, 'XBT')).toBe('XBTUSD');
    expect(id(okx, 'XBT')).toBe('BTC-USDT');
    expect(id(kraken, 'XDG')).toBe('XDGUSD');
  });
});

describe('stock spellings', () => {
  for (const market of ['TSLA', 'TSLAX', 'XTSLA', 'TSLA-USD', 'TSLAX-USD', 'XTSLA-USDT', 'TSLA-USDC', 'tslax-usd']) {
    it(`${market} is Tesla on every exchange with stocks`, () => {
      expect(kraken.resolve(market, 'USD')?.stock).toBe('TSLA');
      expect(okx.resolve(market, 'USD')?.stock).toBe('TSLA');
      expect(gate.resolve(market, 'USD')?.stock).toBe('TSLA');
    });
  }

  it('keeps an exact dollar quote when the exchange has it', () => {
    expect(id(okx, 'TSLA-USDC')).toBe('XTSLA-USDC');
    expect(id(okx, 'TSLA-USD')).toBe('XTSLA-USDT');
  });
});

describe('a market with a quote', () => {
  it('is that pair', () => {
    expect(id(okx, 'BTC-USDC')).toBe('BTC-USDC');
    expect(id(kraken, 'XBT-USD')).toBe('XBTUSD');
    expect(id(coinbase, 'BTC-USD')).toBe('BTC-USD');
  });

  it('takes another dollar where the exchange has no market in that one', () => {
    expect(id(okx, 'BTC-USD')).toBe('BTC-USDT');
    expect(id(gate, 'BTC-USDC')).toBe('BTC-USDT');
    expect(id(coinbase, 'ETH-USDT')).toBe('ETH-USD');
    expect(id(coinbase, 'BTC-USDT')).toBe('BTC-USD');
  });

  it("doesn't swap a dollar for another currency", () => {
    expect(id(gate, 'BTC-EUR')).toBeUndefined();
    expect(id(coinbase, 'ETH-EUR')).toBeUndefined();
  });

  it("is unknown if the exchange doesn't have it", () => {
    expect(id(kraken, 'NOPE-USD')).toBeUndefined();
    expect(id(kraken, 'NOPE')).toBeUndefined();
  });
});

describe('CoinGecko names', () => {
  const name = (c: Catalog, market: string, currency = 'USD') => coinGeckoName(c.resolve(market, currency)!);

  it('price a stock as its xStock, whatever the exchange calls it', () => {
    for (const c of [kraken, okx, gate, bitget]) expect(name(c, 'TSLA')).toEqual({ symbol: 'tslax', vs: 'usd' });
    expect(name(okx, 'XTSLA-USDC')).toEqual({ symbol: 'tslax', vs: 'usd' });
  });

  it('use common coin codes and currencies', () => {
    expect(name(kraken, 'XBT-USD')).toEqual({ symbol: 'btc', vs: 'usd' });
    expect(name(okx, 'BTC')).toEqual({ symbol: 'btc', vs: 'usd' });
    expect(name(kraken, 'BTC', 'EUR')).toEqual({ symbol: 'btc', vs: 'eur' });
    expect(name(kraken, 'BTC', 'AUD')).toEqual({ symbol: 'btc', vs: 'aud' });
    expect(name(kraken, 'XDG')).toEqual({ symbol: 'doge', vs: 'usd' });
  });

  it("don't price a token that only shares the ticker", () => {
    const ondo: Instrument = { id: 'TSLAON-USDT', base: 'TSLAON', quote: 'USDT' };
    expect(coinGeckoName(ondo).symbol).toBe('tslaon');
  });

  it('price an Ondo token as itself', () => {
    expect(name(gate, 'MSFT')).toEqual({ symbol: 'msfton', vs: 'usd' });
  });
});

describe('Explore\'s ranking', () => {
  const row = (base: string, quote: string, quoteVolume: number, change?: number, stock?: string) =>
    ({ instrument: { id: `${base}${quote}`, base, quote, stock }, last: 1, quoteVolume, change });
  const names = (rows: ReturnType<typeof row>[]) => rows.map((r) => marketName(r.instrument));

  it('is by quote volume, one market per asset, in the currency type, without money or leveraged tokens', () => {
    const rows = [
      row('BTC', 'USDT', 400), row('BTC', 'USDC', 90), row('ETH', 'USDT', 200), row('USDC', 'USDT', 900),
      row('SOL', 'EUR', 300), row('ETH', 'BTC', 500), row('BTC5L', 'USDT', 800), row('ETHBULL', 'USDT', 700),
      row('XTSLA', 'USDT', 150, 0.01, 'TSLA'), row('PEPE', 'USD', 50),
    ];
    expect(names(rankMarkets(rows, 'volume', 'USD', 8))).toEqual(['BTC-USDT', 'ETH-USDT', 'TSLA-USDT', 'PEPE-USD']);
    expect(names(rankMarkets(rows, 'volume', 'EUR', 8))).toEqual(['SOL-EUR']);
    expect(names(rankMarkets(rows, 'volume', 'USD', 2))).toEqual(['BTC-USDT', 'ETH-USDT']);
  });

  it('for movers is by the size of the change, either way, among the most traded', () => {
    const rows = [row('BTC', 'USD', 400, 0.01), row('ETH', 'USD', 300, -0.08), row('SOL', 'USD', 200, 0.05), row('XRP', 'USD', 100)];
    // A thin market beyond the 100 most traded doesn't count, however much it moved.
    const pool = Array.from({ length: 96 }, (_, i) => row(`P${i}`, 'USD', 50, 0.001));
    const thin = row('THIN', 'USD', 1, 0.9);
    expect(names(rankMarkets([...rows, ...pool, thin], 'movers', 'USD', 3))).toEqual(['ETH-USD', 'SOL-USD', 'BTC-USD']);
    expect(names(rankMarkets(rows, 'movers', 'USD', 8))).toEqual(['ETH-USD', 'SOL-USD', 'BTC-USD']);
  });
});

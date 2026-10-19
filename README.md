# MarketGlimpse for Even G2

Even Hub app that shows candlestick charts from an exchange's public API
(Kraken, OKX, Coinbase or Gate) on the G2 glasses. On a fixed schedule it
fetches, shows the chart for a few seconds, then blanks the display.

Defaults: monitors BTC-USDC and ETH-USDC, charts BTC-USDC, 5m candles,
refreshes every 2m, chart shown for 12s, narrow candles.

## Settings (phone page)

- **Data source**: the exchange whose public API supplies prices and candles:
  Kraken, OKX, Coinbase or Gate. Market names use `BASE-QUOTE` on all of
  them (`BTC-USDT`). Each exchange lists different markets. For example,
  Coinbase has `BTC-USD` but no `BTC-USDC`. A market the exchange doesn't
  have shows "unknown pair".
- **Markets**: up to 8 (`BTC-USDC`, `SOL-USD`, …). Tick up to 4 to chart. Any
  market that isn't charted is listed under the charts with its price and 24h
  volume (unlabelled, in the base currency, e.g. `ETH-USDC 2,400.22 4.4K`).
  Several markets share a line, and the list wraps onto more lines as needed.
  Tick none and the list fills the screen, one market per line.
- **Candle size**: whatever the source offers. Kraken has 1m to 15d, OKX 1m
  to 1w, Coinbase 1m to 1d, and Gate 1m to 1w. Switching source keeps the size
  if the new source has it, or else picks the nearest.
- **Candle width**: Wide (6px, or 4px in quadrants), Narrow (3px, the default)
  or Thin (2px). Narrower candles fit more history. At 2px, down candles are
  drawn solid and dimmer rather than hollow.
- **Refresh every / Show chart for**: durations like `30s`, `2m`, `1h`. The
  refresh must leave room for one request per 2.5s: 15s minimum, and 2.5s
  per request beyond that (1 + one per chart, so 15s always fits).

Changes apply as you make them. Ticking or unticking a chart, or changing the
candle size, candle width or data source, updates the glasses at once, like
**Show now**. Other changes (markets in the list, refresh rate, show-for time)
wait for the next scheduled update. A new refresh rate re-times that update.

Settings persist through the Even app's storage, or through `localStorage` in a
plain browser.

Scheduled updates fetch in the background while the display stays dark. They
start early, by the same estimate plus a second, so the
finished chart goes up on schedule with no loading screen. **Show now**, or a
tap while the display is dark, shows "Loading… ~4s" until the chart is ready.
The number is estimated once when "Loading…" goes up, and doesn't count
down. It covers the rate limit's current wait, the update's actual requests
(including Kraken's one-time pair list), each API's recent response times,
and recent draw and upload times. If an update is already running, it shows
that update's remaining time.
Either way the chart goes up as four tiles, which appear one by one as they
arrive. The SDK can't hold them back and reveal them together.

On the glasses, a tap while the chart is up dismisses it early. A tap while
the display is dark fetches and shows a fresh chart.

## Public API rules

Every data source follows these rules (`src/sources/http.ts`):

1. No more than one request every 2.5 seconds per API. `PublicApi` queues
   requests and spaces them out.
2. Group calls into as few requests as possible.
3. When requesting history, request only as much as will be displayed.

No exchange offers candles for several markets in one request, so each chart
gets its own candle request, sized to the candles that fit across it. A
chart's price is its latest candle's close. Only the markets listed under the
charts need a ticker request, for price and 24h volume.

| Source | Ticker for listed markets | Candles (1 per chart) |
|---|---|---|
| Kraken | `Ticker?pair=A,B,…` (just those markets) | `OHLC` with `since` |
| OKX | 1: `market/ticker?instId=`; 2+: `market/tickers?instType=SPOT` | `market/candles` with `limit` |
| Coinbase | 1: `products/{id}/stats`; 2+: `products/stats` | `products/{id}/candles` with `start`/`end` |
| Gate | 1: `spot/tickers?currency_pair=`; 2+: `spot/tickers` | `spot/candlesticks` with `limit` |

OKX, Coinbase and Gate can't return tickers for a chosen list of markets, only
for one market or for all of them. For 2 or more listed markets, the app
makes one all-markets request (30–110KB compressed) rather than one per
market. With nothing listed, no ticker request is made at all. A default
update (1 chart, 1 listed market) is 2 requests and takes about 2.5s. 4
charts with 2 or more listed markets take about 10s.

Kraken's Ticker does take a list, but fails outright if any pair in it is
unknown. So Kraken's pair list is fetched once per session and markets are
checked against it first. Gate's error responses have no CORS headers, so the
browser can't tell an unknown market there from a network failure. Those show
"unknown pair or offline".

KuCoin is implemented (`src/sources/kucoin.ts`) but not offered. Its API
sends no CORS headers, so the WebView blocks every response. That was
checked in Chrome and the Even simulator.

Each chart's header also shows CoinGecko's index price (its price aggregated
across exchanges), centred between the market name and the exchange's price. One
`simple/price` request covers every chart, looked up by symbol (`XBT` and
`XDG` are mapped to `btc` and `doge`). Stablecoin quotes such as USDC and USDT
are priced in USD. It runs alongside the exchange's requests, with its own
2.5s limit. If CoinGecko doesn't know a coin, or the request fails, the index
is left out. CoinGecko's keyless API is rate-limited per IP. A rejected
request shows up as a network error in the console, and the chart is drawn
without the index.

## Layout

The screen is 576×288, and an image container can be at most 288×144. Each
update draws the full screen on a canvas, quantizes it to 16 grey levels, and
sends it as four 288×144 PNG tiles. 1 chart is full screen, 2 or 3 are stacked
full-width rows, and 4 are quadrants.

Each chart has a volume strip (~10% of its height) under the candles. The strip
is scaled to the largest bar on screen, and that bar's value is labelled beside
it. The highest high and lowest low on screen are labelled at their wicks.
Horizontal price gridlines run to the right edge, with their prices drawn over
them. A single time axis runs along the bottom, in phone-local time (UTC for
daily and longer candles). The time the data was fetched is stamped in the
bottom-right corner, and the data source's name in the bottom-left. All panels share one time frame, so their vertical
gridlines line up with that axis.

"Display off" means switching to a page with one empty text container. With no
pixels lit, the display is dark, but the app keeps running so the timer
continues.

## Develop

```bash
npm install
npm run dev                                   # Vite on :5173
npx evenhub-simulator http://localhost:5173/  # desktop simulator
npm run qr                                    # QR code to load the dev server in the Even app
npm run pack                                  # build + market-glimpse.ehpk
```

The package ID is `com.bcsw.marketglimpse` (in `app.json`). Network access is
whitelisted to the four exchanges' API hosts and `https://api.coingecko.com`.

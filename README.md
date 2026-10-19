# MarketGlimpse for Even G2

Even Hub app that shows candlestick charts from Kraken's public OHLC API on the
G2 glasses. On a fixed schedule it fetches, shows the chart for a few seconds,
then blanks the display.

Defaults: monitors BTC-USDC and ETH-USDC, charts BTC-USDC, 5m candles,
refreshes every 2m, chart shown for 10s.

## Settings (phone page)

- **Markets**: up to 8 (`BTC-USDC`, `SOL-USD`, …). Tick up to 4 to chart. Any
  market that isn't charted is listed under the charts, one per line, with its
  price, 24h change and 24h volume (from Kraken's Ticker endpoint, in the base
  currency). Tick none and the list fills the screen.
- **Candle size**: Kraken intervals 1m to 15d.
- **Candle width**: Wide (6px, or 4px in quadrants), Narrow (3px) or Thin (2px,
  the default). Narrower candles fit more history. At 2px, down candles are
  drawn solid and dimmer rather than hollow.
- **Refresh every / Show chart for**: durations like `30s`, `2m`, `1h`.

Settings persist through the Even app's storage, or through `localStorage` in a
plain browser.

Each update puts "Loading…" on the glasses while it fetches and draws the
chart. The chart then goes up as four tiles. The tiles appear one by one as
they arrive, because the SDK can't hold them back and reveal them together.

On the glasses, a tap while the chart is up dismisses it early. A tap while
the display is dark fetches and shows a fresh chart.

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
bottom-right corner. All panels share one time frame, so their vertical
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
whitelisted to `https://api.kraken.com`.

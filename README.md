# MarketGlimpse for Even G2

Even Hub app that shows candlestick charts from an exchange's public API
(Kraken, OKX, Coinbase, Gate, Binance.US or Bitget) on the G2 glasses. On a fixed schedule it
fetches, shows the chart for a few seconds, then blanks the display.

Defaults: monitors BTC-USDC and ETH-USDC, charts BTC-USDC, 5m candles,
refreshes every 2m, chart shown for 12s, narrow candles.

## Settings (phone page)

- **Display always on** (above **Show now**): the chart stays up instead of
  blanking after the show-for time, and each update replaces it. **Show now**
  becomes **Refresh now**, and it and a tap fetch a fresh chart. Turning it on puts a chart up if the display
  is dark; turning it off lets the current one come down after the show-for
  time. Off by default: a lit display costs battery.
- **Data source**: the exchange whose public API supplies prices and candles:
  Kraken, OKX, Coinbase, Gate, Binance.US or Bitget. Market names use `BASE-QUOTE` on all of
  them (`BTC-USDT`). Each exchange lists different markets. For example,
  Coinbase has `BTC-USD` but no `BTC-USDC`. A market the exchange doesn't
  have shows "unknown pair". The list also offers **prediction markets**
  (Polymarket, Polymarket US); see below.
- **Prediction markets** (Polymarket or Polymarket US as the data source):
  the market list becomes up to 8 events, entered as a link or the event's
  slug, with the same Chart ticks as markets: up to 4 charted, the rest
  listed under the charts (title, likeliest outcome's probability and name,
  and 24h volume),
  or with none ticked, the full-screen list (each event's title, its
  likeliest outcome's probability and name, its 24h volume where the source
  gives one (Polymarket US doesn't), and a line plot of its top outcomes; or
  as text with **Market list as text**, which takes precedence
  over charts as for markets). A link is kept as its slug
  (`https://polymarket.com/event/balance-of-power-2026-midterms` is
  `balance-of-power-2026-midterms`). Polymarket (polymarket.com) and
  Polymarket US (polymarket.us, the US exchange) are separate exchanges with
  their own events, named their own ways (`bitcoin-up-or-down-on-october-29-2026`
  against `btc-updown-1d-2026-10-27-2100z`), so each keeps its own list, as
  do the exchanges: switching source finds each list as it was. Candle size
  becomes **History spacing** (1m to 1d, each labelled with the span the
  chart covers), and the exchange-only options (candle width, index price,
  currency type) are hidden.
- **Currency type**: USD (default), EUR or AUD, the fiat currencies most of
  the sources quote in. It's the quote for markets entered without one.
- **Stocks and bare names**: a name with no quote (`TSLA`, `BTC`) is first a
  tokenized stock, then a coin quoted in the currency type. Stocks are
  xStocks, on Gate, Ondo tokens where it has no xStock (`MSFT` is
  `MSFTON`), and on Bitget, its own tokens (`rTSLA`, about 3,000 stocks and
  ETFs, RKLB included). Stocks
  only trade in dollars, so with EUR or AUD a bare name is always a coin. A
  dollar quote, typed or chosen, takes another dollar where the exchange has
  no market in it (USD, then USDT, then USDC): OKX and Gate quote almost
  nothing in USD itself, so `BTC-USD` there is `BTC-USDT`. Each exchange's own stock spelling
  works on all of them (`TSLAX`, `XTSLA-USDT`, `TSLA-USD`). Kraken, OKX, Gate
  and Bitget have stocks; Coinbase and Binance.US don't, so there a bare name
  is always a coin (on Coinbase, `META` is the META coin). Gate and Binance.US
  quote nothing in EUR or AUD.
- **Markets**: up to 8 (`BTC-USDC`, `SOL-USD`, …). Tick up to 4 to chart (1
  with any Text width). Any market that isn't charted is listed under the charts
  with its price and 24h volume (unlabelled, in the base currency, e.g.
  `ETH-USDC 2,400.22 4.4K`).
  Several markets share a line, and the list wraps onto more lines as needed.
  Tick none and the list fills the screen, one market per line, each with
  an unlabelled line graph of its closing prices over the period one chart
  would show (the candle size times the candles that fit). Each graph costs
  a candle request, so 8 markets take about 13s to fetch.
- **Watchlist / Explore**: two tabs under Markets, choosing what's
  monitored. **Watchlist** is the markets (or events) entered by hand, as
  above. **Explore** monitors the data source's top markets instead, ranked
  by **Highest volume** (default; 24h volume in the quote currency) or
  **Biggest movers** (the size of the 24h change, up or down, among its 100
  most traded): the top 8. **Show** picks how: **List** (default), the
  full-screen market list, with the 24h change in place of the volume for
  movers; or **1 chart**, **2 charts** or **4 charts**, charting just the top
  1, 2 or 4 (with the index, as on any chart) and listing the rest of the 8
  under them. Text candles allow 1. For a prediction market, List is its
  top 8 events, one per row: the title, the likeliest outcome's probability
  and name, the 24h volume, and a line plot of the event's top
  (up to 4) outcomes over the period one chart shows, in the charts' line
  styles, each row scaled to its own lines; or the top 1, 2 or 4 charted,
  the rest listed under them. With **Market list as text**, the List goes as
  text: each event's title, its likeliest outcome's probability, that
  outcome's name, and its 24h volume, from just the events request (no
  history). Only markets quoted in
  the currency type count (any dollar for USD), one per asset (its most
  traded market), leaving out pairs of money (USDC-USDT, EUR-USD) and
  leveraged tokens (`BTC5L`, `ETHBULL`). The tab lists them with their volume
  or change, and while the watchlist has room, a **+** adds one to it (✓ once
  it's there). Ranking takes every market's ticker, one request (Kraken: one
  for crypto and one for stocks; Polymarket: its 100 most traded markets,
  leaving out a game's "more markets" event, which has no winner),
  then a candle request per chart, or in the list, per line graph (none for
  the text list). Kraken's
  change is from midnight UTC: it gives no price from 24h ago. Polymarket US
  publishes no 24h volume or price changes, but orders its events by volume
  (all time, it appears): it offers Highest volume only, by that, with no
  figure to show.
- **Most liquid** (a third Explore ranking): the money at the best bid and
  best ask (price × size, each), the top of the book rather than its depth,
  among the 100 most traded (a big order on a dead market isn't liquidity);
  no order books are fetched. Kraken, OKX, Binance.US and Bitget give the
  sizes in the tickers already fetched. Coinbase's tickers have no bid or
  ask, and Gate's all-market tickers no sizes: they look up their 12 most
  traded markets' best bid and ask, a request each, and keep the ranking 10
  minutes. Polymarket ranks events by its own liquidity (the money on their
  books), one request. Polymarket US by the money at the top of each of its
  12 most traded events' leading market (a quote each), kept 10 minutes.
  Explore's tab shows it beside each ("$1.2M bid/ask", "$74.6M book").
- **Market list as text**: the glasses draw the full-screen market list in
  their own font (name, price and 24h volume, no line graphs) instead of any
  charts. It takes precedence: chart ticks are greyed out but kept, so
  turning it off brings the charts back. It goes up in one step, and only
  the ticker is fetched.
- **Candle size**: whatever the source offers. Kraken has 1m to 15d, OKX 1m
  to 1w, Coinbase 1m to 1d, Gate 1m to 1w, Binance.US 1m to 1w, and Bitget
  1m to 1w. Switching source keeps the size
  if the new source has it, or else picks the nearest.
- **Candle width**: Wide (6px, or 4px in quadrants), Narrow (3px, the default)
  or Thin (2px). Narrower candles fit more history. At 2px, down candles are
  drawn solid and dimmer rather than hollow.
  - **Text blocks, Text wide, Text narrow, Text thin (1 chart)**: the chart
    is drawn by the glasses in their own font instead of sent as images, so
    it appears all at once and the upload is a few KB of text. It's coarser:
    candles are made of 1px strokes on a 4px grid, or font blocks.
    - Text blocks: about 24 candles, 24px apart, with solid 20px bodies built
      from the font's block glyphs (█ and the lower eighths ▁–▇, with ▔ for
      the bottom end), bright up and dim down. Wicks are 1px strokes, 1.5px
      left of centre (the 4px grid's nearest).
    - Text wide: about 36 candles, 16px apart. Up candles are three strokes,
      filled; down candles are two, hollow and dimmer.
    - Text narrow: about 48 candles, 12px apart, of two strokes: the body in
      both and the wick in the right one. Down candles are filled and
      dimmer, like Thin.
    - Text thin: about 72 candles, 8px apart, of one stroke. Wicks are dim.
      Up bodies are bright; down bodies are hollow (a gap in the dim line
      between the wicks).

    Four price keys sit at the left edge over the oldest candles, which
    leave a gap around each label. A few time keys sit under the candles.
    The keys share one grid of dots: a dot wherever a price key's row
    crosses a time key's column (the middle column of the candle it's centred
    under). Dots keep 12px above and below any candle and two columns (8px)
    to either side, so they stay well clear of them; with Text thin's
    closely packed candles, 20px and four columns (16px). Only one market can be
    charted; the other markets' prices go on the bottom line if they fit.
    With no market ticked, the market list is drawn as usual.
- **Font**: for the text in chart images. Atkinson Hyperlegible (the
  default), B612, DejaVu Sans Mono, Hack or Terminus. The phone's own font is
  never used, since it differs from phone to phone. Each size is matched to
  Atkinson's in pixels: the phone measures how tall each font's digits draw
  at nearby whole-pixel sizes and picks the one that matches, or misses by
  the least. Changing the font redraws the last data without fetching
  again. Text candles and the text list use the
  glasses' font instead. The fonts and their licenses are in `public/fonts/`:
  Atkinson Hyperlegible, B612 and Terminus under the SIL Open Font License,
  DejaVu Sans Mono under the Bitstream Vera license, and Hack under MIT.
  Terminus is shipped unmodified, as its license requires to keep the name.
- **Show index price (CoinGecko)**: on by default. Turn it off to skip the
  CoinGecko request on each update.
- **Manual only**: no scheduled updates. Nothing is fetched and the glasses
  stay dark until you press **Show now** or tap the glasses, which saves
  battery on both devices. The refresh rate is ignored while this is on.
  - **Also update when I look up**: a look-up acts like a tap. Press
    **Calibrate** first, and follow the prompts on the glasses: look straight
    ahead, then up, holding each for a few seconds. The SDK has no look-up
    event and doesn't document its motion-sensor readings, so the app learns
    your two positions. It triggers when your head moves 70% of the way from
    the first to the second, and re-arms once you're back below 30%. The
    sensor only runs while this is on (or while calibrating), since streaming
    readings costs battery.
- **Refresh every / Show chart for**: durations like `30s`, `2m`, `1h`. The
  refresh must leave room for one request per 1.5s: 15s minimum, and 1.5s
  per request beyond that (1 + one per chart or line graph; at most 10
  with 8 markets, so 15s always fits).

Changes apply as you make them. Ticking or unticking a chart, or changing the
candle size, candle width, index price or data source (or the text list
with nothing ticked), updates the glasses at once, like
**Show now**. Other changes (markets in the list, refresh rate, show-for time)
wait for the next scheduled update. A new refresh rate re-times that update.

The phone page's "Next update in…" countdown only ticks while the page is
visible, so it doesn't wake the phone every second in the background.

Settings persist through the Even app's storage, or through `localStorage` in a
plain browser.

Scheduled updates fetch in the background while the display stays dark. They
start early, by the same estimate plus a second, so the data is in by the
scheduled time. Then the loading screen goes up, with every price, while the
chart's image tiles are sent, which can take several seconds. (Text screens are
sent about as fast as the loading screen, so they go straight up.) If the data
isn't in by then (a slow API), the loading screen goes up anyway, filling in as
prices arrive, with the estimate redone from the markets still to come. A chart
still showing stays up until its show-for time ends, then the loading screen
replaces it rather than a dark display. Launching the app
(unless it's manual-only), **Show now**, or a tap while the display is dark,
shows "Loading… ~3s" and the time top-left until
the chart is ready, with the data source top-right and the app name
bottom-right. Every monitored market is listed as text against the right
edge, like the text market list: "..." until its price arrives, filled in as
each request comes back. The list is rewritten in place, without a page rebuild.
The number is estimated once when "Loading…" goes up, and doesn't count
down. It covers the rate limit's current wait, the update's actual requests
(including Kraken's one-time pair list), each API's recent response times,
and recent draw and upload times. If an update is already running, it shows
that update's remaining time.
Either way the chart (unless drawn as Text) goes up as up to four tiles of at most 288×144, each
drawn as soon as it arrives. The SDK can't hold them back and reveal them
together: a page takes at most 4 images, text containers have no background
to hide them behind, and a rebuild clears them. So all tiles are sent at once
instead of waiting for each to be acknowledged, keeping the gap between the
first and last short. Any tile the bridge rejects is retried on its own.

To keep uploads small, each tile is cropped to the part of its quarter that
isn't black (the screen is black where nothing is drawn), and an all-black
quarter isn't sent. When the loading screen is up, the tiles also cover its
text. Tiles are 4-bit greyscale PNGs, sent to the Even app as byte arrays.
The app on the phone rejects base64, though the simulator takes it.

### Diagnostics (phone page, development only)

Shown only when running from the dev server (`npm run dev`). A packaged build
(`npm run pack`) removes the section, and leaves the speed test's code out of
the bundle. Upload stats are still logged to the console.

- **Last upload** lists each tile's size, byte count and time to land, also
  logged to the console as `Glasses upload`.
- **Test upload speed** times uploads that differ in one way at a time (PNG
  size, compressibility, base64 vs byte array, pixel count, PNG vs raw 4-bit
  data), three times each, to show what an upload's time depends on. The
  results are also logged as `Upload speed test`.

On the glasses, a tap while the chart is up dismisses it early (with
**Display always on**, it refreshes it instead). A tap while the display is
dark fetches and shows a fresh chart. A double tap exits the app: the glasses
ask to confirm (`shutDownPageContainer(1)`, as Even Hub review requires), and
the Even app then closes the phone page.

## Public API rules

Every data source follows these rules (`src/sources/http.ts`):

1. No more than one request every 1.5 seconds per API. `PublicApi` queues
   requests and spaces them out.
2. Group calls into as few requests as possible.
3. When requesting history, request only as much as will be displayed.

No exchange offers candles for several markets in one request, so each chart
gets its own candle request, sized to the candles that fit across it. So does
each line graph in the full-screen market list, sized like one full-screen
chart. A chart's price is its latest candle's close. Only the markets listed
under the charts (or in the full-screen list) need a ticker request, for
price and 24h volume. Those come first and the charts last, so with several
requests to wait between, the charts are the freshest data.

| Source | Ticker for listed markets | Candles (1 per chart or line graph) |
|---|---|---|
| Kraken | `Ticker?pair=A,B,…` (just those markets) | `OHLC` with `since` |
| OKX | 1: `market/ticker?instId=`; 2+: `market/tickers?instType=SPOT` | `market/candles` with `limit` |
| Coinbase | 1: `products/{id}/stats`; 2+: `products/stats` | `products/{id}/candles` with `start`/`end` |
| Gate | 1: `spot/tickers?currency_pair=`; 2+: `spot/tickers` | `spot/candlesticks` with `limit` |
| Binance.US | 1: `ticker/24hr?symbol=`; 2+: `ticker/24hr?symbols=[…]` (just those markets) | `klines` with `limit` |
| Bitget | 1: `market/tickers?symbol=`; 2+: `market/tickers` | `market/candles` with `limit` |

OKX, Coinbase, Gate and Bitget can't return tickers for a chosen list of markets, only
for one market or for all of them. For 2 or more listed markets, the app
makes one all-markets request (30–120KB compressed) rather than one per
market. With nothing listed, no ticker request is made at all. A default
update (1 chart, 1 listed market) is 2 requests and takes about 2s. 4
charts with 2 or more listed markets take about 6.5s.

Each source's market list is fetched once per session, and every market is
resolved against it before any price is asked for: a market the exchange
doesn't have shows "unknown pair" without a request. (Kraken's Ticker fails
outright if any pair in it is unknown, as does Binance.US's list, and Gate's
and Binance.US's errors have no CORS headers, so asking would fail anyway.)
The lists are large (Bitget 1.7MB, OKX and Gate about 1MB, Binance.US 0.5MB,
Coinbase 350KB) but load once. Kraken's takes two requests, as it
lists stocks separately, and it prices crypto and stocks in a request each.

KuCoin is implemented (`src/sources/kucoin.ts`) but not offered. Its API
sends no CORS headers, so the WebView blocks every response. That was
checked in Chrome and the Even simulator.

### Prediction markets

An event's chart (`src/predictchart.ts`) plots each outcome's probability
over time on a fixed 0–100% scale, ending at its current price. One event
fills the screen; 2 stack, and 4 take a quadrant each, on one time scale.
Up to 4 outcomes get a line, told apart by brightness and dash (solid,
dashed, dotted, dash-dot). Which ones depends on the event's shape
(`pick` in `src/sources/polymarket.ts`):

- **Sports game**: only who wins, not the spreads, totals and props bundled
  with it (an NBA game has 400 markets). Most sports: the two teams, drawn as
  one market. Soccer: home, draw and away. An event with no winner market
  (soccer's "more markets") shows "no winner market".
- **One market**: Yes and No (or two named outcomes), which add up to 100%,
  so the second is drawn from the first's history.
- **Exclusive set** (exactly one outcome wins: candidates, the Fed's
  decision, seat ranges): the 4 likeliest, and "Other" with the rest's
  combined probability.
- **Ladder** (separate yes/no markets on ordered numbers or dates: "Bitcoin
  ↑ 85,000", "ceasefire holds through November 15"): 4 consecutive rungs, in
  order, where they're closest to even odds; the far rungs are near certain
  either way. "Other" counts the rest ("16 more") without a price: the rungs
  aren't exclusive, so their prices don't add up.
- **Other separate yes/no markets** ("who will Trump meet"): the 4 likeliest,
  and the rest counted.

The legend lists the outcomes in that order. Gridlines are faint dots, kept 5px clear of the
lines. A legend on each chart gives each line's price and name beside a
sample of its style, and its market's 24h volume (Polymarket; a yes/no
market's or a game's two sides share one market, so it's on the first),
wherever it covers the fewest lit pixels; outlined where it has to cover a
line.

| Source | Events and current prices | History |
|---|---|---|
| Polymarket | Gamma `events?slug=A&slug=B…` (every event, one request) | CLOB `POST batch-prices-history` (up to 20 outcomes per request, the most it takes: one for 4 events, two for Explore's 8), from just far enough back, at the history spacing |
| Polymarket US | Gateway `v1/events?slug=A&slug=B…` (every event, one request) | `v1/price-history?symbol=` (one market per request: there's no batch endpoint), likewise |

Polymarket's two are separate APIs, each with its own rate limit. Polymarket
US's history takes a request per charted market (a yes/no market or a game's
two teams are one; a soccer match three; four events with four outcomes
each, 16, about 25s), so its refresh can't be shorter than its requests
allow. Its current prices are its display prices, from the latest history
point (a market's bid and ask, before that: their midpoint, or with no
offers, the bid). It doesn't say whether an event's markets are exclusive:
markets on an asset's price ranges are, and on its passing strikes are a
ladder (`assetPriceTerms`); otherwise an event tagged `neg-risk` is, or one
whose quoted prices add up to about 100%. The events request
is large for events with many markets (the 2028 presidential winner is
440KB, 41KB compressed: Polymarket returns every market, closed ones too).

Each chart's header also shows CoinGecko's index price (its price aggregated
across exchanges), centred between the exchange's price and the market name,
with its top level with theirs. It's always shown: in a crowded header it
drops its "Index" label, then the fetch time and source make way. One
`simple/price` request covers every chart, looked up by what the market is on
the exchange rather than by what was typed: a stock by its xStock symbol
(Kraken's `TSLAx`, OKX's `XTSLA`, Gate's `TSLAX` and Bitget's `rTSLA` are
all `tslax`), a coin by
its common code (`XBT` and `XDG` are `btc` and `doge`), an Ondo token by its
own (`msfton`). Stablecoin quotes such
as USDC and USDT are priced in USD. It's asked for alongside the exchange's
last chart request, so it's as fresh as the chart beside it, and at most once
every 12s. If CoinGecko doesn't know a coin, or the request fails, the
header shows "Index —" (in text candles, "Index --"). CoinGecko's keyless API
is rate-limited per IP. A rejected request shows up as a network error in the
console.

## Layout

The screen is 576×288, and an image container can be at most 288×144. Each
update draws the full screen on a canvas, quantizes it to 16 grey levels, and
sends it as four 288×144 PNG tiles. 1 chart is full screen, 2 or 3 are stacked
full-width rows, and 4 are quadrants.

Each chart has a volume strip (~10% of its height) under the candles. The strip
is scaled to the largest bar on screen, and that bar's value is labelled beside
it. The bars are dim, so they stay in the background, and shaped like their
candles: filled when the price rose, hollow and dimmer when it fell (filled
where a bar is too thin or short for a hollow). The highest high and lowest
low on screen are labelled level with their wick tips, in the nearest stretch
beside the tip that no candle, volume bar or label reaches: right next to the
tip, or further out with a dotted line to it. To stay level, a label may stick
up under the header or down into the volume strip, so the candles keep the
full height.
Horizontal price gridlines run to the right edge, with their prices drawn over
them. A single time axis runs along the bottom, in phone-local time (UTC for
daily and longer candles). All panels share one time frame, so their vertical
gridlines line up with that axis.

Each chart's header has the price on the left and the market and candle size
on the right, with the index price between them. The time the data was
fetched follows the price in the top-left chart, and the data source's name
comes before the market in the top-right chart (both in the same chart when
it spans the screen). The MarketGlimpse logo sits in the bottom-right corner,
under the last price axis and beside the volume strip, its lowest point level
with the bottom of the time labels. It's drawn from `assets/icon.svg`, the
app icon: three candles over volume bars in 24×24, every stroke at least
2px and every lit pixel part of a 2×2 block, as the Even Hub store
requires, so its edges are hard. Where the corner is too short (three charts), it rises past the
volume strip, and a price label that would cover it is skipped. Every screen
shares these corners: the time top-left, the source top-right and the logo
bottom-right (MarketGlimpse in text on the text screens, which can't draw
it). The full-screen market lists sit between them. Text candles lay their
top line out like the image header (price and time, Index, source, market
and candle size), with the other markets' prices on the bottom line.

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
npm run icon                                  # assets/icon-24.png (store icon) from assets/icon.svg
npm run screenshots                           # screenshots/*.png from the simulator, live data
npm test                                      # name resolution, and every source against its live API
```

The store icon is `assets/icon-24.png`. The upload validates it: 24×24,
every pixel `#F4F4F4` at full opacity or fully transparent, and every lit
pixel part of a 2×2 block of lit pixels (so no stroke thinner than 2px).
`npm run icon` checks the 2×2 rule and fails before writing a PNG that breaks
it.

The package ID is `com.bcsw.marketglimpse` (in `app.json`). Network access is
whitelisted to the four exchanges' API hosts and `https://api.coingecko.com`.

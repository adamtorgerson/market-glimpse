# Changelog

Notable changes to MarketGlimpse, by release tag.

## [Unreleased]

### Fixed
- Polymarket US: a market quoted on just one side was priced wrongly. A lone
  price with no bid is the ask, not a bid: such a market is now at half of it,
  which brings down long shots' prices and the "others" in a legend.
- Polymarket's volumes were labelled in dollars but are in shares, which can be
  many times the dollars traded. They no longer have a "$", and say "shares"
  where there's room.

### Added
- An Analysis section: **Show analysis** draws SMA, EMA, VWAP, Bollinger
  Bands, Donchian Channels or Parabolic SAR over the price, or RSI, MACD or
  ATR in a pane under the volume strip, on the image charts, from the candles
  shown, with no extra requests. Each indicator's parameters are settings. A
  period too long for the chart says how many candles it needs.
- A **Second indicator** draws two at once. Below the chart, they're overlaid
  in the same area, each on its own scale; over the price, the second's solid
  lines are dotted.
- Analysis for prediction markets, on image charts, with no extra requests:
  each outcome's change, typical daily move and spread in the legend, and the
  event's sum of outcomes and time to its end date in the header. It allows up
  to 2 charts.
- Analysis allows up to 2 charts: turning it on keeps the first 2 ticked, and
  Explore's 4 charts becomes 2. With two charts, MACD is its histogram alone.

### Development
- A store screenshot of Bollinger Bands and MACD on one chart. `npm run
  store-screenshots` can take just those named, and also writes `tiled.png`,
  all of them on one image.
- The indicators are tested against an outside reference on real Kraken
  candles, intraday and daily: TA-Lib's results, given just the candles shown
  and given the market's long history, and Kraken's own VWAP.
  `scripts/analysis-fixtures.py` rewrites the fixture.

## [0.4.3] - 2026-11-02

### Changed
- Diagnostics are on the phone page in development builds only again, and
  the package build leaves out the speed test.

### Development
- Tests are grouped by directory (sources, prediction, charting, explore,
  settings), each a Vitest project: `npm test -- --project charting`.
  `npm run test:offline` skips the tests that call live APIs.
- `npm run store-screenshots` takes just the Even Hub store's screenshots
  (one, two and four Kraken charts, the market list, text blocks, and two
  Polymarket charts) into `screenshots/store/`. A `two-charts` shot is added.
- README brought up to date: prediction markets in the intro, every setting
  that updates the glasses at once, and the full network whitelist.

## [0.4.2] - 2026-10-29

### Changed
- A **Market List** box in Markets shows the full-screen market list instead
  of charts. **Market List as text** moves to its own Market List section.

## [0.4.1] - 2026-10-29

### Added
- Text chart for prediction markets: a Chart style option (Image, up to 4
  charts, or Text, 1 chart) drawn in the glasses' own font, with up to four
  outcome lines on a fixed 0–100% scale, a legend, and the other events
  listed beneath.
- Hyperliquid and Aster spot markets as data sources.
- Favorite data sources: a long press on the glasses, or Next beside Show
  now, moves to the next favorite. Clear favorites empties the list.
- Glasses swipes: up switches Watchlist / Explore, down toggles the text
  market list. A refused swipe shows "No change: see phone".
- Explore counts up the seconds while its top list loads.

### Changed
- The prediction text chart's event list lines up from line to line.
- Text candles put other markets' prices on a second line when they don't
  fit on one, each followed by its trend arrow.

## [0.4.0] - 2026-10-28

### Added
- Binance.US and Bitget data sources (Bitget's stock tokens resolve from
  plain tickers like TSLA).
- Prediction markets: Polymarket and Polymarket US, with their own
  watchlist of up to 8 events (4 charted), probability charts with up to 4
  outcome lines, and a full-screen or text list.
- Explore tab: monitor a source's top 8 markets by highest volume, biggest
  movers or most liquid, as a list or with 1, 2 or 4 charted; "+" adds one
  to the watchlist.
- Trend arrows after each price in every market list, showing the move
  since the last update.
- The prediction loading screen lists each event's leading outcome as soon
  as it arrives.

## [0.3.5] - 2026-10-28

### Fixed
- Closing the app on the glasses now cancels the update in progress, clears
  every timer and stops the motion sensor, instead of a later timer leaving
  the glasses blank and the Even app stuck.

### Added
- Diagnostics show bytes sent and received over the network and across the
  bridge to the glasses (temporarily included in the package build).

## [0.3.4] - 2026-10-27

### Added
- Currency type setting (USD, EUR or AUD) used as the quote for markets
  entered without one. Dollar quotes fall back through USD, USDT and USDC.
- `npm test` runs Vitest: offline name resolution plus live checks of every
  source and CoinGecko.

### Changed
- Each source loads its market list once per session and resolves markets
  against it, so unknown markets are never requested. Gate also accepts Ondo
  stock tokens.
- The CoinGecko index is looked up by what the market is on the exchange.

## [0.3.3] - 2026-10-27

### Added
- Tokenized stocks on every source: a market with no quote (TSLA) is a
  dollar-priced stock. Kraken, OKX and Gate look up their stock lists, and
  any exchange's spelling (TSLAX, XTSLA) is accepted.

## [0.3.2] - 2026-10-26

### Added
- Text blocks candle style, built from the font's block glyphs.
- Text charts share one tick grid of dots where price and time keys cross.
- `npm run screenshots` captures README screenshots from the simulator.

### Fixed
- Look-up could fail at launch in manual-only mode: the motion sensor now
  starts after a blank page is put up, and stops on exit.

## [0.3.1] - 2026-10-24

### Changed
- Scheduled charts show the loading screen, with prices, while image tiles
  are sent or the data is late, rather than a dark display.
- The privacy policy no longer describes the app as crypto only.

## [0.3.0] - 2026-10-24

### Added
- Display always on: the chart stays up and each update replaces it.
- Double tap on the glasses exits the app.
- Session high and low labels placed beside their wick tips.
- Chart logo drawn from the app icon; `npm run icon` exports the store icon.
- Draft privacy policy (PRIVACY.md).

### Changed
- Every glasses screen shares the same corners: time, source, and
  MarketGlimpse or the logo.
- Show now becomes Refresh now; Market list as text takes precedence over
  charts.
- Settings page reorganised; Diagnostics only in development builds.

## [0.2.5] - 2026-10-23

### Added
- Chart font choice: Atkinson Hyperlegible (default), B612, DejaVu Sans
  Mono, Hack or Terminus.
- The loading screen lists every market, filling in prices as each request
  lands, and also shows on launch and on a font change.

### Changed
- Reworked chart header (price, time, index, source and market) and sparser
  gridlines. CoinGecko is limited to one call every 12s.
- Volume bars match their candles: filled for up, hollow for down.

## [0.2.0] - 2026-10-21

### Added
- Text candle widths (wide, narrow, thin) drawn in the glasses' own font,
  sent in a single page rebuild.
- Line graphs of closing prices in the image market list, and a "Market
  list as text" option.
- Upload diagnostics and a speed test on the phone page.

### Changed
- Image tiles are cropped, all-black tiles skipped, and tiles encoded as
  4-bit greyscale PNGs.

### Fixed
- Image tiles are sent as byte arrays: the Even app rejects base64, which
  caused every session's first update to be retried.

## [0.1.0] - 2026-10-19

Initial release: candlestick charts on the Even G2 glasses on a
schedule.

- Data sources: Kraken, OKX, Coinbase and Gate, with a CoinGecko index price
  in each chart header.
- Public API rules enforced in `PublicApi`: one request per 1.5s per API,
  grouped requests, and only the history that will be displayed.
- Market list with 24h volume, price gridlines, high/low/peak volume labels,
  and a loading screen with a time estimate.
- Battery options: manual-only mode, optional index price, and a look-up
  gesture (calibrated from the IMU) to trigger an update.
- Chart tiles sent to the glasses in parallel.

[0.4.3]: https://github.com/adamtorgerson/market-glimpse/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/adamtorgerson/market-glimpse/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/adamtorgerson/market-glimpse/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/adamtorgerson/market-glimpse/compare/v0.3.5...v0.4.0
[0.3.5]: https://github.com/adamtorgerson/market-glimpse/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/adamtorgerson/market-glimpse/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/adamtorgerson/market-glimpse/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/adamtorgerson/market-glimpse/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/adamtorgerson/market-glimpse/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/adamtorgerson/market-glimpse/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/adamtorgerson/market-glimpse/compare/v0.2.0...v0.2.5
[0.2.0]: https://github.com/adamtorgerson/market-glimpse/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/adamtorgerson/market-glimpse/releases/tag/v0.1.0

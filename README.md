# MarketGlimpse for Even G2

Even Hub app that shows candlestick charts from an exchange's public API
(Kraken, OKX, Coinbase, Gate, Binance, Binance.US, Bitget, Hyperliquid or Aster), or
outcome probabilities from a prediction market (Polymarket, Polymarket US,
Hyperliquid's outcome markets),
on the G2 glasses. On a fixed schedule it fetches, shows the chart for a few
seconds, then blanks the display.

Release notes are in [CHANGELOG.md](CHANGELOG.md).

Defaults: monitors BTC-USDC and ETH-USDC, charts BTC-USDC, 5m candles,
refreshes every 2m, chart shown for 12s, narrow candles.

## Settings (phone page)

- **Display always on** (above **Show now**): the chart stays up instead of
  blanking after the show-for time, and each update replaces it. **Show now**
  becomes **Refresh now** (otherwise it reads **Hide now** while a chart is
  up), and it and a tap fetch a fresh chart. Turning it on puts a chart up if the display
  is dark; turning it off lets the current one come down after the show-for
  time. Off by default: a lit display costs battery.
- **Data source**: the exchange whose public API supplies prices and candles:
  Kraken, OKX, Coinbase, Gate, Binance, Binance.US or Bitget, or the order-book DEXes
  Hyperliquid and Aster (spot markets only). Market names use `BASE-QUOTE` on all of
  them (`BTC-USDT`). Each exchange lists different markets. For example,
  Coinbase has `BTC-USD` but no `BTC-USDC`. A market the exchange doesn't
  have shows "unknown pair". The list also offers **prediction markets**
  (Polymarket, Polymarket US, HL Outcomes); see below.
  - **Favorite**: a long press on the glasses goes on to the next favorite
    source, in the list's order. So does the button beside **Show now**,
    which names that source ("Next: OKX").
- **Prediction markets** (Polymarket, Polymarket US or HL Outcomes, Hyperliquid's
  outcome markets, as the data source):
  the market list becomes up to 8 events, entered as a link or the event's
  slug, with the same Chart ticks as markets: up to 4 charted, the rest
  listed under the charts (title, likeliest outcome's probability and name,
  and 24h volume),
  or with none ticked, the full-screen list (each event's title, its
  likeliest outcome's probability and name, its 24h volume where the source
  gives one (Polymarket US doesn't), and a line plot of its top outcomes; or
  as text with **Market List as text**; **Market List** shows the list
  even with events ticked, as for markets). Volumes are in shares, as Polymarket
  publishes them, not dollars: a share costs its price and pays $1 if it wins, so
  4M shares of long shots can be under $200K traded. A link is kept as its slug
  (`https://polymarket.com/event/balance-of-power-2026-midterms` is
  `balance-of-power-2026-midterms`). Polymarket (polymarket.com) and
  Polymarket US (polymarket.us, the US exchange) are separate exchanges with
  their own events, named their own ways (`bitcoin-up-or-down-on-october-29-2026`
  against `btc-updown-1d-2026-10-27-2100z`), so each keeps its own list, as
  do the exchanges: switching source finds each list as it was. Candle size
  becomes **History spacing** (1m to 1d, each labelled with the span the
  chart covers), and the exchange-only options (candle width, index price,
  currency type) are hidden.
- **Chart style** (prediction markets): **Image, up to 4 charts** (default),
  or **Text, 1 chart**: the one charted event drawn by the glasses in their
  own font, like text candles, so it goes up all at once as a few KB of
  text. Each of the top (up to 4) outcomes is a line of 1px strokes, one
  per 4px column (a history point each, about 130), on a fixed 0–100% scale
  with the percentages in a margin on the left and a few time keys under
  it: bright solid, bright dotted (every other column), dim solid and dim
  dotted, in the outcomes' order. A column with no point of its own (their
  times jitter) is filled in between its neighbours; where lines meet, a
  column is left out rather than drawn as a bar. The question, time, source
  and 24h volume are along the top, and a legend along the bottom: each
  line's sample (how a flat line of its style looks), probability and name,
  then the outcomes left out. If one line would cut a name short, the
  legend takes two. Under it, the other events are listed two to a line,
  on up to four lines (all 7 others of 8 fit): each one's title, its
  likeliest outcome's probability (bright, with its trend arrow) and name,
  cut short to fit, in columns lined up from line to line. MarketGlimpse is in the bottom-right corner, as on the
  other text screens: in the list's last place, or with no list, after the
  legend if there's room, else on a line of its own. Each line moves the plot up (keeping
  its gridlines on the font's rows), and the time keys with it. Explore
  offers List or 1 chart, with its other top events listed.
- **Analysis** (prediction markets, its own section): **Show analysis** adds
  to the image charts (not the text chart or the list), with no extra requests:
  - In the legend, for each outcome, in points of probability: its **change**,
    **vol/d** and **spread**. The change is headed by what it covers: `24h` if
    Polymarket gives every outcome charted a 24h figure, otherwise since the
    chart's history starts (`7d`). It leaves the figure out for many markets, not
    only those that didn't move, and Polymarket US has none. **vol/d** is the
    typical move in a day, at today's price: measured in log-odds over the chart's
    history, as 5 points near 2% is a far bigger move than near 50%. Noisy
    prices read high, as it can't tell a real move from a price bouncing between
    the bid and ask. **spread** is the best ask minus the best bid.
  - In the header: **Sum**, the total of all its markets' prices, charted or not,
    where exactly one wins and all are listed, which should be about 100%. A
    large set of long shots reads high, each priced at the middle of its bid and
    ask. Polymarket's sets that can still gain outcomes have none, as whatever's
    on those isn't listed. **ends**, the time to its end date; it can be
    `past end date` while waiting to be resolved.

  It limits a prediction market to 2 charts: turning it on keeps the first 2
  ticked, and Explore's 4 charts becomes 2.
- **Currency type**: USD (default), EUR or AUD, the fiat currencies most of
  the sources quote in. It's the quote for markets entered without one.
  Binance has its own list: USDT (its default), USDC, EUR, JPY, TRY or BRL. It
  leaves out USD, where it has only a few thin markets (BTC-USD trades about
  0.02% of BTC-USDT's volume), and AUD, which it doesn't quote in; a typed
  `BTC-USD` is still that market. Switching source keeps the currency type
  if the new source has it, or else takes its default.
- **Stocks and bare names**: a name with no quote (`TSLA`, `BTC`) is first a
  tokenized stock, then a coin quoted in the currency type. Stocks are
  xStocks, on Gate, Ondo tokens where it has no xStock (`MSFT` is
  `MSFTON`), and on Bitget, its own tokens (`rTSLA`, about 3,000 stocks and
  ETFs, RKLB included), on Hyperliquid, the xStocks that trade there (its
  `TSLAX` and `AAPLX` have no book), and on Aster, its own tokens (`NVDAB`).
  Hyperliquid leaves out tokens anyone can deploy under a stock's ticker
  (one named `MSFT` traded far from Microsoft's price): a known stock's name is only its
  xStock, or "unknown pair". Stocks
  only trade in dollars, so with EUR or AUD a bare name is always a coin. A
  dollar quote, typed or chosen, takes another dollar where the exchange has
  no market in it (USD, then USDT, then USDC): OKX and Gate quote almost
  nothing in USD itself, so `BTC-USD` there is `BTC-USDT`. Each exchange's own stock spelling
  works on all of them (`TSLAX`, `XTSLA-USDT`, `TSLA-USD`). Kraken, OKX, Gate,
  Bitget, Hyperliquid and Aster have stocks; Coinbase, Binance and Binance.US don't, so there a bare name
  is always a coin (on Coinbase, `META` is the META coin). Gate, Binance.US,
  Hyperliquid and Aster quote nothing in EUR or AUD, and Binance nothing in AUD. Hyperliquid's bridged
  coins go by their common codes (Unit's `UBTC` is `BTC`, `USDT0` is `USDT`),
  and its markets with no trades in 24h are left out.
- **Markets**: up to 8 (`BTC-USDC`, `SOL-USD`, …). Tick up to 4 to chart (1
  with any Text width, 2 with **Show analysis** on). Any market that isn't charted is listed under the charts
  with its price and 24h volume (unlabelled, in the base currency, e.g.
  `ETH-USDC 2,400.22 4.4K`).
  Several markets share a line, and the list wraps onto more lines as needed.
  Tick none and the list fills the screen, one market per line, each with
  an unlabelled line graph of its closing prices over the period one chart
  would show (the candle size times the candles that fit). Each graph costs
  a candle request, so 8 markets take about 13s to fetch.
- **Saved watchlist**: named copies of the watchlist, above its rows, up to 20
  each for exchanges (which share them, as they do the watchlist) and for each
  prediction market (whose events mean nothing to the others). Enter a name and
  press **Save** to keep the rows and their Chart ticks; **Save** is enabled
  while there's something unsaved. Choosing a list replaces the rows and shows
  it right away; if that would lose rows that aren't saved, a prompt first
  offers **Save first**, **Discard** or **Keep editing**. With a list chosen,
  **Save** saves over it, renaming it if the name changed, and **Delete** removes
  the list but leaves its rows in place. **Unsaved** also leaves the rows in
  place, so they can be saved as a new list. **Restore defaults** keeps saved
  lists, but replaces the rows without asking.
- **Watchlist / Explore**: two tabs under Markets, choosing what's
  monitored. **Watchlist** is the markets (or events) entered by hand, as
  above. **Explore** monitors the data source's top markets instead, ranked
  by **Highest volume** (default; 24h volume in the quote currency) or
  **Biggest movers** (the size of the 24h change, up or down, among its 100
  most traded): the top 8. **Show** picks how: **List** (default), the
  full-screen market list, with the 24h change in place of the volume for
  movers; or **1 chart**, **2 charts** or **4 charts**, charting just the top
  1, 2 or 4 (with the index, as on any chart) and listing the rest of the 8
  under them. Text candles allow 1, and **Show analysis** 2. For a prediction market, List is its
  top 8 events, one per row: the title, the likeliest outcome's probability
  and name, the 24h volume, and a line plot of the event's top
  (up to 4) outcomes over the period one chart shows, in the charts' line
  styles, each row scaled to its own lines; or the top 1, 2 or 4 charted,
  the rest listed under them. With **Market List as text**, the List goes as
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
- **Trend arrows**: in every market list (under the charts, the full-screen
  list, and as text), a market's price is followed by ↑ or ↓ if it's higher
  or lower than at the last update; for a prediction market, its leading
  outcome's probability; and on the loading screen, each price as it comes
  (for a prediction market, each event's leading outcome once the events are
  in, before their history).
  None the first time a market is shown, or if it didn't move.
- **Most liquid** (a third Explore ranking): the money at the best bid and
  best ask (price × size, each), the top of the book rather than its depth,
  among the 100 most traded (a big order on a dead market isn't liquidity);
  no order books are fetched. Kraken, OKX, Binance, Binance.US, Bitget and Aster give the
  sizes in the tickers already fetched. Coinbase's tickers have no bid or
  ask, and Gate's all-market tickers and Hyperliquid's no sizes: they look up their 12 most
  traded markets' best bid and ask, a request each, and keep the ranking 10
  minutes. Polymarket ranks events by its own liquidity (the money on their
  books), one request. Polymarket US by the money at the top of each of its
  12 most traded events' leading market (a quote each), kept 10 minutes. HL
  Outcomes by the money on the visible book (up to 20 levels a side) of each of
  its 12 most traded events' leading market (a request each), kept 10 minutes.
  Explore's tab shows it beside each ("$1.2M bid/ask", "$74.6M book").
- **Market List**: the glasses show the full-screen market list instead of
  any charts, in the Watchlist or Explore. It takes precedence: chart ticks
  (and Explore's Show) are greyed out but kept, so turning it off brings the
  charts back.
- **Market List as text** (in its own Market List section): whenever the
  full-screen market list is shown, the glasses draw it in their own font
  (name, price and 24h volume, no line graphs). It goes up in one step, and
  only the ticker is fetched.
- **News** (its own section, under **Data**): a checkbox each for **CNBC** (Top News),
  **MarketWatch** (Top Stories), **WSJ Markets**, **Bitcoin.com** and
  **cryptocurrency.cv** (`/api/breaking`, from the crypto press), all off by
  default. Headlines are fetched with the market data, one request per source,
  and a chart waits at most 1.5s for them: any later are in time for the next
  update. MarketWatch and WSJ share a host, so they share its rate limit, and
  with both ticked the second is usually in time only for the next update. Since
  feeds are cached for about a minute, the RSS sources are asked at most once a
  minute, and cryptocurrency.cv, which allows 10 requests an hour, at most every
  6 minutes, however often the charts update. A source's failure only shows in
  the section.
  - **Automatic filters**: the markets or events the last chart monitored, each
    with what finds it in a headline ("BTC, Bitcoin") and a checkbox. Unticking
    one stops its headlines being hits and its own marks on its chart (it still
    gets the filters'). It stays off whenever it's monitored again, until ticked;
    Reset turns them all back on. They're listed after the first update, as an
    event's title comes with its data.
  - **Filters**: up to 8 words or phrases of your own, up to 40 characters each.
    A headline with one in it, whole and in any case ("Fed", not "federal"), is a
    hit like one mentioning a market: it can bring up the popup, and it's listed
    on the phone, with the filter beside it. It's marked on every chart, as a
    filter isn't about any one market, but marks nothing in the market lists.
    Changing a filter redraws the last data without fetching. A headline already
    fetched doesn't count as new because a filter now hits it, though it's listed.
  - **Excludes**: up to 8 more words or phrases, matched the same way as
    filters. A headline with one in it is left out everywhere (the popup, the
    phone's list and the charts' marks), even if it mentions a market, event or
    filter: an exclude always wins. Changing one also redraws the last data
    without fetching.
  - **What matches**: a headline's words, not its summary. A market matches by
    its asset's ticker, in capitals and as a whole word (BTC, not BTCUSD; words
    headlines capitalize anyway, like AI, aren't taken as tickers), or for common
    assets, its name in any case (Bitcoin, Tesla). An event matches by an asset
    its title names, or else two of its title's distinctive words, so a match can
    be off.
  - **New headlines** bring up a popup on the glasses for half of **Show chart
    for**, or until a tap, and the chart has the rest of that time. It shows as
    many headlines mentioning what's monitored as fit: the new ones first, each
    marked with a `*`, then the rest, newest first, each with its time. That's
    ten, one line each, cut short to fit; with fewer, the first that need it run
    on to a second line. It's a text page, which goes up in one step and clears as
    soon as the page is rebuilt. Text containers have no background to cover a chart with,
    so it takes the whole screen, and an image chart's tiles are sent only once it
    clears, which takes the usual seconds. Popups can come up on launch. A headline
    is new if it was published in the last day and not fetched before since
    launch; in a source's first fetch, it must also be newer than when headlines
    last went up, which is kept between launches, so a relaunch doesn't repeat
    them. A story two sources word alike counts once.
  - **On the phone**: up to 25 headlines mentioning what's monitored, newest
    first, with their source, time and what they mention. Each has **Copy link**
    and, where the WebView offers sharing, **Share**. If the WebView won't copy,
    the link appears as text to select by hand. Headlines aren't links themselves:
    the SDK has no call to open a browser, and in the Even app, following a link
    takes over the app.
  - **On the charts**: a mark along the bottom of each chart, under the candle
    (or a prediction chart's time) a headline was published in: a small triangle
    in the images, a bright tick in the text charts. Several in a candle are one
    mark.
  - **In the market lists**: a market or event mentioned in the last day has a
    diamond after its name, or " *" in the glasses' font.
- **Candle size**: whatever the source offers. Kraken has 1m to 15d, OKX 1m
  to 1w, Coinbase 1m to 1d, Gate 1m to 1w, Binance and Binance.US 1m to 1w, Bitget
  1m to 1w, Hyperliquid 1m to 1w, and Aster 1m to 1w. Switching source keeps the size
  if the new source has it, or else picks the nearest.
- **Candle width**: Wide (6px, or 4px in quadrants), Narrow (3px, the default)
  or Thin (2px). Narrower candles fit more history. At 2px, down candles are
  drawn solid and dimmer rather than hollow.
  - **Text blocks, Text wide, Text narrow, Text thin (1 chart)**: the chart
    is drawn by the glasses in their own font instead of sent as images, so
    it appears all at once and the upload is a few KB of text. It's coarser:
    candles are made of 1px strokes on a 4px grid, or font blocks.
    - Text blocks: about 28 candles, 20px apart, with solid 20px bodies built
      from the font's block glyphs (█ and the lower eighths ▁–▇, with ▔ for
      the bottom end), bright up and dim down, side by side with no gap.
      Wicks are 1px strokes, 1.5px left of centre (the 4px grid's nearest).
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
    charted; the other markets' prices go along the bottom, on a second
    line (with the plot a line shorter, and three price keys) if they don't
    fit on one.
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
- **Image dimming** and **Image thinning**: two ways to tone down image
  screens (charts and the image market list) before they're sent, each off by
  default and set from 10% to 90% in steps of 10. They can be combined. Text
  screens, which the glasses draw themselves, aren't affected. Changing either
  redraws the last data without fetching again.
  - Dimming scales every grey level down by that much. Anything lit stays lit
    at the faintest level at least, so detail dims rather than disappears.
    Upload size barely changes, since the same pixels are sent.
  - Thinning turns off that share of the lit pixels in an evenly scattered
    pattern (an 8×8 ordered dither), fixed to the screen so tiles meet without a
    seam and a chart thins the same way each update. Lines become dotted and
    text grainier, but there are fewer pixels to send, so uploads can be faster.
- **Show index price (CoinGecko)**: on by default. Turn it off to skip the
  CoinGecko request on each update.
- **Analysis** (its own section; exchanges only): **Show analysis** draws
  the chosen **Indicator**, and any **Second indicator**, on the image charts
  (not text candles), computed
  from the candles shown, so it needs no extra requests. Each indicator has
  its own settings, kept when you switch between them. Periods are 2–200
  candles.
  - **SMA** and **EMA**: simple and exponential moving averages of the
    closes, a line over the candles. **Period** 20 by default.
  - **VWAP**: the volume-weighted average price, a line over the candles. It
    runs from the chart's left edge, not a session's open, so it won't match
    the session VWAP other charts show, and it shifts as the chart moves on.
  - **Bollinger Bands**: the average over **Period** candles (20 by default),
    dotted, with bands **Band width** standard deviations either side (0.1–5,
    2 by default), behind the candles; the price scale stretches to fit them.
  - **Donchian Channels**: the highest high and lowest low of the last
    **Period** candles (20 by default), stepped lines behind the candles.
  - **Parabolic SAR**: a dot per candle, above or below the price, that
    closes in as the trend runs and flips when the price reaches it.
    **Acceleration step** (0.02 by default) and **max** (0.2), 0.001–1.
  - **RSI**: Wilder's relative strength index in a pane under the volume
    strip, on a 0–100 scale with dashed lines at 30 and 70 and the latest
    value top-left. **Period** 14 by default.
  - **MACD**: in the same pane, a histogram of the line minus its signal,
    around a dashed zero, labelled with its latest value. Where the pane has
    room (one chart), also the line (solid) and signal (dotted). **Fast**,
    **slow** and **signal** periods 12, 26 and 9 by default; fast must be
    shorter than slow.
  - **ATR**: Wilder's average true range, in the same pane on its own scale,
    labelled with its latest value in price. **Period** 14 by default.

  Two below the chart are overlaid in the same area, so the candles keep their
  height: each on its own scale, the second's line dotted, and their labels
  along the top. Overlaid, MACD is its histogram alone, and where the area is
  short (two charts) RSI loses its 30 and 70 lines. Two over the price are both
  drawn, the second's solid lines dotted. The second can't be the same as the
  first. Each starts once its period has filled, since only the candles shown are
  fetched; a period too long for the chart says how many candles it needs
  instead. EMA, RSI, MACD, ATR and Parabolic SAR carry their starting values
  forward, so their left ends can differ from a chart with more history. With
  so few candles in a quadrant, analysis limits an exchange to 2 charts:
  turning it on keeps the first 2 ticked, and Explore's 4 charts becomes 2.
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

Changes apply as you make them. Changing what's charted or how updates the
glasses at once, like **Show now**: ticking or unticking a chart, the data
source, currency type, candle size or history spacing, candle width, chart
style, index price, **Market List** or **Market List as text**, the events
entered, the news sources, or Explore's tab, ranking and Show. A font or analysis change redraws
the last data without fetching, unless it changes what's charted. Other changes (markets in the list, refresh rate,
show-for time) wait for the next scheduled update. A new refresh rate
re-times that update.

The phone page's countdowns ("Next update in…", "Fetching…", Explore's
"Loading…") only tick while the page is visible, so they don't wake the phone
every second in the background.

Scheduled updates pause, to save battery on both devices, while the glasses
aren't in use: taken off, in their case, or disconnected, as the Even app reports. The
phone page says **Paused**, what's on the display is blanked, and the motion
sensor stops. Putting them back on, or any input on the glasses, resumes as on
launch: a chart straight away (in manual-only mode, only for a tap). The phone's
buttons work throughout, without resuming the schedule. The SDK reports
"not worn" for a status that doesn't say, so being off the head only counts
once the glasses have reported being worn. In development, the phone page's
Diagnostics list each status reported.

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
each request comes back. The list is rewritten in place, without a page rebuild,
unless its number of rows changes, as when Explore's first list arrives.
The number is estimated when "Loading…" goes up, and doesn't count down, but
Explore estimates it again once its list is in, from the requests left for those
markets (before that, a first Explore can't know what they'll need). It covers the rate limit's current wait, the update's actual requests
(including the source's one-time market list), each API's recent response times,
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
- **Always show the news popup** brings up the popup with every fetch, new
  headlines or not, as long as a news source is ticked and a headline mentions
  what's monitored. It's not saved, so it's off after a reload.

On the glasses, a tap while the chart is up dismisses it early (with
**Display always on**, it refreshes it instead). A tap while the display is
dark fetches and shows a fresh chart. A swipe up switches between
**Watchlist** and **Explore**; a swipe down turns **Market List** on
or off. A long press on the right temple (or the ring, which has no sides) goes
on to the next **Favorite** data source (with none other, the glasses say so for
two seconds). A long press on the left temple goes on to the next **Saved
watchlist** for the source, on the **Watchlist** tab even from **Explore** (with
none other, the glasses say so too). If that would lose unsaved rows, nothing
changes: the glasses show "Unsaved edits: see phone", and the phone asks. A swipe or long press the settings can't take (an empty watchlist, or a refresh too
short for the requests it needs) changes nothing: the glasses show "No change:
see phone" for two seconds, and the reason is under the form. A double tap exits the app: the glasses
ask to confirm (`shutDownPageContainer(1)`, as Even Hub review requires), and
the Even app then closes the phone page.

**Gesture controls** (under **Display always on**, on by default) can be
unticked to ignore the tap, swipes and long press, for example if you touch the
glasses by accident. A double tap still exits, and any of them still ends a
pause while the glasses aren't in use. With it off, a manual-only chart comes
from **Show now** or looking up.

**Cycle Favorites** (under **Show now**, off by default) moves on to the next
**Favorite** data source each time a chart is fetched for the schedule, **Show
now** (or **Refresh now**), a tap or looking up. A scheduled change has no loading screen of
its own. Changing a setting, launching and coming back from a pause stay on the
current source. A favorite the settings can't take is passed over, with the
reason under the form. It does nothing with no other favorite, and waits while a
field on the phone has text not yet entered.

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
| Binance, Binance.US | 1: `ticker/24hr?symbol=`; 2+: `ticker/24hr?symbols=[…]` (just those markets) | `klines` with `limit` |
| Bitget | 1: `market/tickers?symbol=`; 2+: `market/tickers` | `market/candles` with `limit` |
| Hyperliquid | `spotMetaAndAssetCtxs` (all markets, POST `info`) | `candleSnapshot` with `startTime` |
| Aster | 1: `ticker/24hr?symbol=`; 2+: `ticker/24hr` | `klines` with `limit` |

OKX, Coinbase, Gate, Bitget and Aster can't return tickers for a chosen list of markets, only
for one market or for all of them, and Hyperliquid only for all of them
(about 350KB, with the market list). For 2 or more listed markets, the app
makes one all-markets request (30–120KB compressed) rather than one per
market. With nothing listed, no ticker request is made at all. A default
update (1 chart, 1 listed market) is 2 requests and takes about 2s. 4
charts with 2 or more listed markets take about 6.5s.

Each source's market list is fetched once per session, and every market is
resolved against it before any price is asked for: a market the exchange
doesn't have shows "unknown pair" without a request. (Kraken's Ticker fails
outright if any pair in it is unknown, as do both Binances' lists, and Gate's
and both Binances' errors have no CORS headers, so asking would fail anyway.)
The lists are large (Binance 2.5MB, Bitget 1.7MB, OKX and Gate about 1MB, Binance.US 0.5MB,
Coinbase and Hyperliquid 350KB, Aster 100KB) but load once. Kraken's takes two requests, as it
lists stocks separately, and it prices crypto and stocks in a request each.

Binance.com refuses the US (HTTP 451, with no CORS headers, so a release build
there shows "unknown pair, offline or blocked"). In dev mode (`npm run dev`, and
the tests) the Binance source uses its public market-data mirror,
`data-api.binance.vision`, instead. Only `api.binance.com` is in `app.json`'s whitelist.

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
| HL Outcomes | `outcomeMeta` (the event list, kept 10 minutes) and `spotMetaAndAssetCtxs` (every price, about 350KB) | `candleSnapshot` (one market per request), likewise |

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

HL Outcomes shares the Hyperliquid exchange source's `PublicApi`: one
host, one rate limit. Explore adds events as `q567-rb-leipzig-vs-manchester-city`
(a question, of which one outcome wins), `o24239-…` (a game or other lone
market) or `touch-btc-20261201-0000` (standalone markets on one asset and date,
as a ladder); only the part up to the title matters. They can also be entered
as a Hyperliquid link or the name in it
(`https://app.hyperliquid.xyz/trade/out:btc-touches-75000-by-dec-1-at-1200-am-utc-yes`,
with or without `out:`, its venue). A market's name is built the way the site
builds it, from `outcomeTemplates` (about 50KB, one request, only once a name is
entered). A name goes to that market's Yes and No, or if it's one of a
question's outcomes, the whole question. Without the venue, a name on several
venues (an IPO's market caps) asks for it. A recurring market's name has its
date, so it stops working once that market settles. Titles and names are built from
each market's templated description. Prices are its mark prices, as a mid means
little on a thin book, but thin markets can still be well off: their rungs can
be out of order, and a question's sum far from 100%. Those never traded are
left out, as is a question's fallback outcome, which has no price. A tournament
lists only its favourites, so it has no sum. A game's end date is its deadline
to resolve, about a week after it. There are no spreads (they'd take a request
per market). Movers leaves out markets under 1,000 shares
in 24h, and a daily market's change, which is since before it opened.

Each chart's header also shows CoinGecko's index price (its price aggregated
across exchanges), centred between the exchange's price and the market name,
with its top level with theirs. It's always shown: in a crowded header it
drops its "Index" label, then the fetch time and source make way. One
`simple/price` request covers every chart, looked up by what the market is on
the exchange rather than by what was typed: a stock by its xStock symbol
(Kraken's `TSLAx`, OKX's `XTSLA`, Gate's and Hyperliquid's `TSLAX` and
Bitget's `rTSLA` are all `tslax`; Aster's `NVDAB` is `nvdax`), a coin by
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
and candle size), with the other markets' prices on the bottom line or two.

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
npm run store-screenshots                     # screenshots/store/*.png: just the Even Hub store's seven, and tiled.png of them all
npm test                                      # every test, including each source against its live API
npm run test:offline                          # only the tests that don't call an API
npm test -- --project charting                # one group: sources, prediction, charting, explore, settings
```

Tests are grouped by directory under `test/`: `sources` (exchange name
resolution and requests), `prediction` (Polymarket, Polymarket US and
HL Outcomes),
`charting` (the glasses' text charts and lists), `explore` (ranking the top
markets) and `settings`. Files ending `.live.test.ts` call the live APIs.
`test/charting/analysis-reference.test.ts` checks the Analysis indicators
against TA-Lib (given just the candles shown, and given long history) and
Kraken's own VWAP, on real intraday and daily candles saved in
`test/charting/fixtures/`; `scripts/analysis-fixtures.py` rewrites them.

The store icon is `assets/icon-24.png`. The upload validates it: 24×24,
every pixel `#F4F4F4` at full opacity or fully transparent, and every lit
pixel part of a 2×2 block of lit pixels (so no stroke thinner than 2px).
`npm run icon` checks the 2×2 rule and fails before writing a PNG that breaks
it.

The package ID is `com.bcsw.marketglimpse` (in `app.json`). Network access is
whitelisted to the eight exchanges' API hosts, Polymarket's two
(`gamma-api.polymarket.com`, `clob.polymarket.com`), Polymarket US's
gateway (`gateway.polymarket.us`) and `https://api.coingecko.com`. A new
source's host must be added there too.

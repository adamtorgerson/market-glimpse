# MarketGlimpse privacy policy

Effective 5 November 2026.

MarketGlimpse shows public market data on Even G2 glasses. It
has no accounts, no analytics, no advertising and no server of its own. This
policy covers what the app sends, what it stores, and the one permission it
requests.

## What the app sends, and to whom

The app requests the **network** permission, and uses it only to download
public market data. Each update makes plain HTTPS requests, with no cookies,
credentials or account details, to:

- **The exchange you choose as the data source**: Kraken (`api.kraken.com`),
  OKX (`www.okx.com`), Coinbase (`api.exchange.coinbase.com`), Gate
  (`api.gateio.ws`), Binance (`api.binance.com`), Binance.US
  (`api.binance.us`), Bitget (`api.bitget.com`), Hyperliquid
  (`api.hyperliquid.xyz`) or Aster (`sapi.asterdex.com`). The requests name the
  markets you've added (for example `BTC-USDC`) and the candle size.
- **The prediction market you choose as the data source**: Polymarket
  (`gamma-api.polymarket.com` and `clob.polymarket.com`), Polymarket US
  (`gateway.polymarket.us`) or Hyperliquid's outcome markets
  (`api.hyperliquid.xyz`). The requests name the events you've added and the
  spacing of their history.
- **CoinGecko** (`api.coingecko.com`), for the index price shown on charts,
  unless you turn **Show index price** off. The requests name the assets of
  the charted markets.
- **The news sources you tick**, if any (none by default): CNBC
  (`www.cnbc.com`), MarketWatch and WSJ Markets (both
  `feeds.content.dowjones.io`), Bitcoin.com (`news.bitcoin.com`),
  cryptocurrency.cv (`cryptocurrency.cv`), and the sources under "Via Jina Reader" (CoinDesk, The
  Block, CryptoSlate, Decrypt, Cointelegraph, FT Markets, Elite Trader and
  Stacker News), whose feeds are fetched through Jina Reader (`r.jina.ai`): Jina
  receives the request and fetches the feed from the source. The requests fetch each source's
  general headlines: they don't name your markets or news filters, which are
  matched against the headlines on your phone.

These are the only hosts the app can reach (the network permission's
whitelist). As with any internet request, those services receive your IP
address and basic request details such as the browser's user agent, and
handle them under their own privacy policies. MarketGlimpse sends them
nothing that identifies you. If you copy or share a headline's link from the
phone page and open it, that's on the publisher's site, under its own privacy
policy.

## What the app stores

Your settings (data source, markets, chart options, news sources and filters, timings and
the look-up calibration), and the time headlines last went up on the glasses,
are saved on your phone, in the Even Realities app's storage for MarketGlimpse,
so they're kept between launches. They never leave the device. Market data and
headlines are kept in memory only while the app runs.

## Motion sensor

If you turn on **Also update when I look up**, or press **Calibrate**, the
app reads the glasses' motion sensor to detect when you look up. The readings
are used on the phone and discarded. They're never stored (apart from the two
calibration positions in your settings) and never sent anywhere. The sensor
is off unless that option is on or calibration is running.

## What the app doesn't do

- No personal data is collected, sold or shared.
- No analytics, tracking, advertising or crash reporting.
- No microphone, camera, location, photos or contacts.
- No server operated by the developer: the app talks only to the public APIs
  above.

## Changes

If this policy changes, the new version will be published here with a new
effective date.

## Contact

[Developer name] · [contact email]

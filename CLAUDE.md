# MarketGlimpse

Even Hub (Even G2 glasses) web app; see README.md.

## Public API rules

Apply to every external market-data API, current or new (`src/sources/`):

1. No more than 1 request every 2.5 seconds per API. Make requests through
   `PublicApi` in `src/sources/http.ts`, never with a bare `fetch`.
2. Group calls into as few requests as the API allows. Use multi-symbol
   endpoints where they exist.
3. When requesting historical data, request only what will be displayed
   (`MarketRequest.candles`).

New sources implement `MarketSource` (`src/sources/types.ts`), usually through
`exchangeSource` (`src/sources/exchange.ts`). Add them to `SOURCES` in
`src/sources/index.ts`, and add their host to the whitelist in `app.json`.
The API must send CORS headers: the Even SDK has no native HTTP, so the
WebView's `fetch` is the only way to call it.

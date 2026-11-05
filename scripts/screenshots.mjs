// Writes the README screenshots in screenshots/ from the Even Hub simulator,
// with live market data. Each shot starts a simulator on a seed page that
// stores its settings, then loads the app and saves the glasses display once
// the first image is uploaded. The PNGs are the simulator's own: green, with
// brightness in alpha and a transparent background. Run with
// `npm run screenshots`, optionally naming the shots to take, or
// `npm run store-screenshots` for just the Even Hub store's (STORE), written
// to screenshots/store/, or those of them named. Either way, tiled.png there
// is then rebuilt from all of them.
//
// Vite runs on its own port so the seeded settings don't replace those of the
// dev server on :5173 (the simulator stores them per origin).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { tilePngs } from './tile-png.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE_PORT = 5199;
const AUTOMATION = 'http://localhost:9898';
const STORAGE_KEY = 'kraken-candles.settings'; // src/main.ts
const TIMEOUT_MS = 60_000;

// Hyperliquid's: a Fed decision, tournaments and an IPO's ladder, open well into 2027 (the Fed's till December).
const HL_EVENTS = ['q199', 'q430', 'q545', 'ipo-cap-anthropic-20270501-0359'];
const M8 = ['BTC-USDC', 'ETH-USDC', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD', 'LTC-USD', 'DOT-USD'];
// Tokenized stocks, entered by ticker as a user would.
const STOCKS = ['TSLA', 'NVDA', 'AAPL'];
const M3 = [...M8.slice(0, 2), STOCKS[0]];
const M6 = [...M8.slice(0, 4), ...STOCKS.slice(0, 2)];
// Polymarket events that run until well after 2026, and Polymarket US's (named its own way).
const EVENTS = ['presidential-election-winner-2028', 'democratic-presidential-nominee-2028', 'republican-presidential-nominee-2028', 'which-party-wins-2028-us-presidential-election'];
// A single yes/no market, then a set where exactly one wins and all are listed.
const MORE_EVENTS = ['will-trump-be-impeached-before-his-term-ends', 'openai-ipo-closing-market-cap-554'];
const US_EVENTS = ['nfl-champ-2027-02-14-w', 'btc-hitprice-high-yr-12-31-2026', 'usfed-fomc-2026-12-09', 'btc-pricerange-yr-12-31-2026'];
const ALL = [...M8.slice(0, 5), ...STOCKS];
// Non-political Polymarket events for the store listing. They end, so these may need replacing when retaken.
const STORE_EVENTS = ['largest-company-end-of-december-2026', 'worlds-2026-winner', 'uefa-champions-league-2027-champion-20260701202025549', 'nba-2027-champion', 'pro-football-2027-champion-20260729185915366', 'what-price-will-bitcoin-hit-before-2027', 'will-the-us-confirm-that-aliens-exist-before-2027', 'what-price-will-wti-hit-in-november-2026'];
const SHOTS = {
  'one-chart': { markets: ALL, charts: ['BTC-USDC'] },
  'two-charts': { markets: ALL, charts: M8.slice(0, 2) },
  'four-charts': { markets: ALL, charts: [...M8.slice(0, 3), STOCKS[0]] },
  'market-list': { markets: ALL, charts: [] },
  'analysis-ema': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'ema' },
  'analysis-bollinger': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'bollinger' },
  'analysis-rsi': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'rsi' },
  'analysis-bollinger-custom': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'bollinger', bollingerPeriod: 40, bollingerK: 1 },
  'analysis-sma': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'sma' },
  'analysis-vwap': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'vwap' },
  'analysis-donchian': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'donchian' },
  'analysis-sar': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'sar' },
  'analysis-macd': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'macd' },
  'analysis-macd-two-charts': { markets: ALL, charts: M8.slice(0, 2), analysis: true, analysisKind: 'macd' },
  'analysis-atr': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'atr' },
  'analysis-too-long': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'ema', emaPeriod: 200 },
  'prediction-analysis': { source: 'polymarket', events: { polymarket: EVENTS.slice(0, 1) }, eventInterval: 60, eventAnalysis: true },
  'prediction-analysis-two-charts': { source: 'polymarket', events: { polymarket: EVENTS }, eventCharts: { polymarket: EVENTS.slice(0, 2) }, eventInterval: 60, eventAnalysis: true },
  'prediction-analysis-complete': { source: 'polymarket', events: { polymarket: MORE_EVENTS.slice(1) }, eventInterval: 60, eventAnalysis: true },
  'prediction-analysis-binary': { source: 'polymarket', events: { polymarket: MORE_EVENTS.slice(0, 1) }, eventInterval: 60, eventAnalysis: true },
  'prediction-us-analysis': { source: 'polymarketus', events: { polymarketus: US_EVENTS.slice(0, 1) }, eventInterval: 60, eventAnalysis: true },
  'prediction-us-analysis-two-charts': { source: 'polymarketus', events: { polymarketus: US_EVENTS }, eventCharts: { polymarketus: US_EVENTS.slice(0, 2) }, eventInterval: 60, eventAnalysis: true },
  'analysis-bollinger-macd': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'bollinger', analysisSecond: 'macd' },
  'analysis-two-over': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'ema', analysisSecond: 'sma', smaPeriod: 50 },
  'analysis-bands-and-sar': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'bollinger', analysisSecond: 'sar' },
  'analysis-over-and-pane': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'ema', analysisSecond: 'rsi' },
  'analysis-both-below': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'rsi', analysisSecond: 'macd' },
  'analysis-both-below-lines': { markets: ['BTC-USDC'], charts: ['BTC-USDC'], analysis: true, analysisKind: 'rsi', analysisSecond: 'atr' },
  'analysis-both-below-macd-first': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'macd', analysisSecond: 'atr' },
  'analysis-both-below-two-charts': { markets: ALL, charts: M8.slice(0, 2), analysis: true, analysisKind: 'rsi', analysisSecond: 'macd' },
  'analysis-both-too-long': { markets: ALL, charts: ['BTC-USDC'], analysis: true, analysisKind: 'ema', emaPeriod: 200, analysisSecond: 'sma', smaPeriod: 200 },
  'analysis-rsi-two-charts': { markets: ALL, charts: M8.slice(0, 2), analysis: true, analysisKind: 'rsi' },
  'text-list': { markets: M6, charts: [], textList: true },
  'text-chart': { markets: M3, charts: ['BTC-USDC'], candleWidth: 'text-narrow' },
  'text-blocks-chart': { markets: M3, charts: ['BTC-USDC'], candleWidth: 'text-blocks' },
  'text-chart-listed': { markets: ALL, charts: ['BTC-USDC'], candleWidth: 'text-narrow' },
  'explore-volume': { explore: true, exploreBy: 'volume' },
  'explore-movers': { explore: true, exploreBy: 'movers' },
  'explore-one-chart': { explore: true, exploreView: '1' },
  'explore-four-charts': { explore: true, exploreBy: 'movers', exploreView: '4' },
  'prediction-explore-list': { source: 'polymarket', explore: true, exploreView: 'list', eventInterval: 60 },
  'prediction-explore-movers-list': { source: 'polymarket', explore: true, exploreBy: 'movers', exploreView: 'list', eventInterval: 15 },
  'prediction-explore-text-list': { source: 'polymarket', explore: true, exploreView: 'list', textList: true },
  'prediction-chart': { source: 'polymarket', events: { polymarket: EVENTS.slice(0, 1) }, eventInterval: 60 },
  'prediction-two-charts': { source: 'polymarket', events: { polymarket: EVENTS.slice(0, 2) }, eventInterval: 60 },
  'prediction-four-charts': { source: 'polymarket', events: { polymarket: EVENTS }, eventInterval: 60 },
  'prediction-two-charts-listed': { source: 'polymarket', events: { polymarket: [...EVENTS, ...MORE_EVENTS] }, eventCharts: { polymarket: EVENTS.slice(0, 2) }, eventInterval: 60 },
  'prediction-text-chart': { source: 'polymarket', events: { polymarket: EVENTS.slice(0, 1) }, eventTextChart: true, eventInterval: 60 },
  'prediction-text-chart-listed': { source: 'polymarket', events: { polymarket: [...EVENTS, ...MORE_EVENTS] }, eventCharts: { polymarket: EVENTS.slice(0, 1) }, eventTextChart: true, eventInterval: 60 },
  'prediction-text-chart-binary-listed': { source: 'polymarket', events: { polymarket: [...MORE_EVENTS, ...EVENTS.slice(0, 2)] }, eventCharts: { polymarket: MORE_EVENTS.slice(0, 1) }, eventTextChart: true, eventInterval: 60 },
  'prediction-explore-text-chart': { source: 'polymarket', explore: true, exploreView: '1', eventTextChart: true, eventInterval: 60 },
  'prediction-text-chart-binary': { source: 'polymarket', events: { polymarket: MORE_EVENTS.slice(0, 1) }, eventTextChart: true, eventInterval: 60 },
  'prediction-one-chart-listed': { source: 'polymarket', events: { polymarket: [...EVENTS, ...MORE_EVENTS] }, eventCharts: { polymarket: EVENTS.slice(0, 1) }, eventInterval: 60 },
  'prediction-list': { source: 'polymarket', events: { polymarket: [...EVENTS, ...MORE_EVENTS] }, eventCharts: { polymarket: [] }, eventInterval: 60 },
  'prediction-explore-two-charts': { source: 'polymarket', explore: true, exploreView: '2', eventInterval: 60 },
  'prediction-us-explore-list': { source: 'polymarketus', explore: true, exploreView: 'list', eventInterval: 60 },
  'prediction-hl-explore-list': { source: 'hyperliquidoutcomes', explore: true, exploreView: 'list', eventInterval: 60 },
  'prediction-hl-explore-two-charts': { source: 'hyperliquidoutcomes', explore: true, exploreView: '2', eventInterval: 60 },
  'prediction-hl-three-charts': { source: 'hyperliquidoutcomes', events: { hyperliquidoutcomes: HL_EVENTS.slice(0, 3) }, eventInterval: 60 },
  'prediction-hl-four-charts': { source: 'hyperliquidoutcomes', events: { hyperliquidoutcomes: HL_EVENTS }, eventInterval: 60 },
  'prediction-hl-explore-four-charts': { source: 'hyperliquidoutcomes', explore: true, exploreView: '4', eventInterval: 60 },
  'prediction-hl-explore-liquid-list': { source: 'hyperliquidoutcomes', explore: true, exploreBy: 'liquidity', exploreView: 'list', eventInterval: 60 },
  'prediction-hl-ladder': { source: 'hyperliquidoutcomes', events: { hyperliquidoutcomes: ['ipo-cap-anthropic-20270501-0359'] }, eventInterval: 60, eventAnalysis: true },
  'prediction-us-four-charts': { source: 'polymarketus', events: { polymarketus: US_EVENTS }, eventInterval: 60 },
  // Live headlines, on a first launch (the simulator keeps no storage between runs), so all new. Broad
  // filters fill it, whatever's mentioning the markets today; waits for the popup, a text page, not a chart.
  'store-news-popup': { markets: ALL, charts: ['BTC-USDC'], newsSources: ['cnbc', 'marketwatch', 'cv'], newsFilters: ['stocks', 'Nasdaq', 'crypto', 'Wall Street', 'earnings', 'S&P 500', 'Fed', 'shares'], waitFor: 'text' },
  'store-prediction-two-charts': { source: 'polymarket', events: { polymarket: STORE_EVENTS.slice(0, 2) }, eventInterval: 60 },
  'store-prediction-list': { source: 'polymarket', events: { polymarket: STORE_EVENTS }, eventCharts: { polymarket: [] }, eventInterval: 60 },
};

// The Even Hub store listing: Kraken (the default source) and Polymarket.
const STORE = ['store-news-popup', 'two-charts', 'four-charts', 'analysis-bollinger-macd', 'market-list', 'text-blocks-chart', 'text-chart', 'store-prediction-two-charts', 'store-prediction-list'];

const args = process.argv.slice(2);
const store = args.includes('--store');
const named = args.filter((a) => a !== '--store');
const names = store && named.length === 0 ? STORE : named;
const OUT = new URL(store ? '../screenshots/store/' : '../screenshots/', import.meta.url);
const unknown = names.filter((n) => !(n in SHOTS));
if (unknown.length) throw new Error(`Unknown shots: ${unknown.join(' ')} (have ${Object.keys(SHOTS).join(' ')})`);

// The seed page saves the settings through the bridge, as the app reads them,
// then loads the app.
const SEED = `<!doctype html><script type="module">
import { Glasses } from '/src/glasses.ts';
const s = new URLSearchParams(location.search).get('s');
const g = await Glasses.connect();
await g.bridge.setLocalStorage('${STORAGE_KEY}', s);
location.href = '/';
</script>`;

const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  server: { port: VITE_PORT, strictPort: true },
  plugins: [{
    name: 'screenshot-seed',
    configureServer(s) {
      s.middlewares.use('/seed', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(SEED);
      });
    },
  }],
});
await server.listen();

async function automation(path) {
  const res = await fetch(AUTOMATION + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
}

/** The first upload's in, and if the shot's waiting on a kind, it's that (`UploadStats.encoding`). */
async function uploaded(encoding) {
  try {
    const { entries } = await (await automation('/api/console')).json();
    return entries.some((e) => e.message.includes('Glasses upload') && (!encoding || e.message.includes(`"encoding":"${encoding}"`)));
  } catch {
    return false; // Not up yet.
  }
}

mkdirSync(OUT, { recursive: true });
try {
  for (const name of names.length ? names : Object.keys(SHOTS)) {
    const { waitFor, ...shot } = SHOTS[name];
    const settings = { displaySec: 60, refreshSec: 600, ...shot };
    const url = `http://localhost:${VITE_PORT}/seed?s=${encodeURIComponent(JSON.stringify(settings))}`;
    // Its own process group, so killing it also ends the WebView processes.
    const sim = spawn('node_modules/.bin/evenhub-simulator', [url, '--automation-port', '9898'],
      { cwd: ROOT, stdio: 'ignore', detached: true });
    try {
      const start = Date.now();
      while (!(await uploaded(waitFor))) {
        if (Date.now() - start > TIMEOUT_MS) throw new Error(`${name}: no glasses upload in ${TIMEOUT_MS / 1000}s`);
        await sleep(150);
      }
      await sleep(1500); // Let the display settle.
      writeFileSync(new URL(`${name}.png`, OUT), Buffer.from(await (await automation('/api/screenshot/glasses')).arrayBuffer()));
      console.log(`screenshots/${store ? 'store/' : ''}${name}.png`);
    } finally {
      process.kill(-sim.pid, 'SIGTERM');
      await sleep(2000); // Free the automation port.
    }
  }
} finally {
  await server.close();
}

if (store) {
  // Every store screenshot, in the listing's order, whichever were just taken.
  const taken = STORE.filter((name) => existsSync(new URL(`${name}.png`, OUT)));
  const missing = STORE.filter((name) => !taken.includes(name));
  if (missing.length) console.warn(`Not tiled, not taken yet: ${missing.join(' ')}`);
  if (taken.length) {
    writeFileSync(new URL('tiled.png', OUT), tilePngs(taken.map((name) => readFileSync(new URL(`${name}.png`, OUT))), { columns: 3, gap: 16 }));
    console.log('screenshots/store/tiled.png');
  }
}

// Writes the README screenshots in screenshots/ from the Even Hub simulator,
// with live market data. Each shot starts a simulator on a seed page that
// stores its settings, then loads the app and saves the glasses display once
// the first image is uploaded. The PNGs are the simulator's own: green, with
// brightness in alpha and a transparent background. Run with
// `npm run screenshots`, optionally naming the shots to take.
//
// Vite runs on its own port so the seeded settings don't replace those of the
// dev server on :5173 (the simulator stores them per origin).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = new URL('../screenshots/', import.meta.url);
const VITE_PORT = 5199;
const AUTOMATION = 'http://localhost:9898';
const STORAGE_KEY = 'kraken-candles.settings'; // src/main.ts
const TIMEOUT_MS = 60_000;

const M8 = ['BTC-USDC', 'ETH-USDC', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD', 'LTC-USD', 'DOT-USD'];
// Tokenized stocks, entered by ticker as a user would.
const STOCKS = ['TSLA', 'NVDA', 'AAPL'];
const M3 = [...M8.slice(0, 2), STOCKS[0]];
const M6 = [...M8.slice(0, 4), ...STOCKS.slice(0, 2)];
// Polymarket events that run until well after 2026, and Polymarket US's (named its own way).
const EVENTS = ['presidential-election-winner-2028', 'democratic-presidential-nominee-2028', 'republican-presidential-nominee-2028', 'balance-of-power-2026-midterms'];
const MORE_EVENTS = ['which-party-will-win-the-house-in-2026', 'which-party-will-win-the-senate-in-2026'];
const US_EVENTS = ['nfl-champ-2027-02-14-w', 'btc-hitprice-high-yr-12-31-2026', 'usfed-fomc-2026-12-09', 'btc-pricerange-yr-12-31-2026'];
const ALL = [...M8.slice(0, 5), ...STOCKS];
const SHOTS = {
  'one-chart': { markets: ALL, charts: ['BTC-USDC'] },
  'four-charts': { markets: ALL, charts: [...M8.slice(0, 3), STOCKS[0]] },
  'market-list': { markets: ALL, charts: [] },
  'text-list': { markets: M6, charts: [], textList: true },
  'text-chart': { markets: M3, charts: ['BTC-USDC'], candleWidth: 'text-narrow' },
  'text-blocks-chart': { markets: M3, charts: ['BTC-USDC'], candleWidth: 'text-blocks' },
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
  'prediction-one-chart-listed': { source: 'polymarket', events: { polymarket: [...EVENTS, ...MORE_EVENTS] }, eventCharts: { polymarket: EVENTS.slice(0, 1) }, eventInterval: 60 },
  'prediction-list': { source: 'polymarket', events: { polymarket: [...EVENTS, ...MORE_EVENTS] }, eventCharts: { polymarket: [] }, eventInterval: 60 },
  'prediction-explore-two-charts': { source: 'polymarket', explore: true, exploreView: '2', eventInterval: 60 },
  'prediction-us-explore-list': { source: 'polymarketus', explore: true, exploreView: 'list', eventInterval: 60 },
  'prediction-us-four-charts': { source: 'polymarketus', events: { polymarketus: US_EVENTS }, eventInterval: 60 },
};

const names = process.argv.slice(2);
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

async function uploaded() {
  try {
    const { entries } = await (await automation('/api/console')).json();
    return entries.some((e) => e.message.includes('Glasses upload'));
  } catch {
    return false; // Not up yet.
  }
}

mkdirSync(OUT, { recursive: true });
try {
  for (const name of names.length ? names : Object.keys(SHOTS)) {
    const settings = { displaySec: 60, refreshSec: 600, ...SHOTS[name] };
    const url = `http://localhost:${VITE_PORT}/seed?s=${encodeURIComponent(JSON.stringify(settings))}`;
    // Its own process group, so killing it also ends the WebView processes.
    const sim = spawn('node_modules/.bin/evenhub-simulator', [url, '--automation-port', '9898'],
      { cwd: ROOT, stdio: 'ignore', detached: true });
    try {
      const start = Date.now();
      while (!(await uploaded())) {
        if (Date.now() - start > TIMEOUT_MS) throw new Error(`${name}: no glasses upload in ${TIMEOUT_MS / 1000}s`);
        await sleep(150);
      }
      await sleep(1500); // Let the display settle.
      writeFileSync(new URL(`${name}.png`, OUT), Buffer.from(await (await automation('/api/screenshot/glasses')).arrayBuffer()));
      console.log(`screenshots/${name}.png`);
    } finally {
      process.kill(-sim.pid, 'SIGTERM');
      await sleep(2000); // Free the automation port.
    }
  }
} finally {
  await server.close();
}

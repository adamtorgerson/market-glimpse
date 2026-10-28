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
const ALL = [...M8.slice(0, 5), ...STOCKS];
const SHOTS = {
  'one-chart': { markets: ALL, charts: ['BTC-USDC'] },
  'four-charts': { markets: ALL, charts: [...M8.slice(0, 3), STOCKS[0]] },
  'market-list': { markets: ALL, charts: [] },
  'text-list': { markets: M6, charts: [], textList: true },
  'text-chart': { markets: M3, charts: ['BTC-USDC'], candleWidth: 'text-narrow' },
  'text-blocks-chart': { markets: M3, charts: ['BTC-USDC'], candleWidth: 'text-blocks' },
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

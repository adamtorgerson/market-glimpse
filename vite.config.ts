import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The version the Even Hub store sees; shown beside the page's title.
const { version } = JSON.parse(readFileSync(new URL('./app.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Relative asset paths so the build works when packed into an .ehpk.
  base: './',
  plugins: [{
    name: 'app-version',
    transformIndexHtml: (html) => html.replaceAll('%APP_VERSION%', version),
  }],
});

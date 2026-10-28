import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The live tests wait out each API's rate limit (one request every 1.5s, 12s for CoinGecko).
    testTimeout: 90_000,
  },
});

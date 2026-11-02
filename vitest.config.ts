import { defineConfig } from 'vitest/config';

/** Test groups, one per directory under test/: run one with `npm test -- --project <name>`. */
const GROUPS = ['sources', 'prediction', 'charting', 'explore', 'settings'];

export default defineConfig({
  test: {
    // The live tests wait out each API's rate limit (one request every 1.5s, 12s for CoinGecko).
    testTimeout: 90_000,
    projects: GROUPS.map((name) => ({
      extends: true,
      test: { name, include: [`test/${name}/**/*.test.ts`] },
    })),
  },
});

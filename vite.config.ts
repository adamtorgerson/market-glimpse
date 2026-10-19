import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works when packed into an .ehpk.
  base: './',
});

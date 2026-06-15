import { defineConfig } from 'vite';

// base: './' makes built asset paths relative, which works both locally
// and under the GitHub Pages project subpath (/ai-chant-magic/).
export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['@acm/shared'] },
  server: { fs: { allow: ['..'] } },
});

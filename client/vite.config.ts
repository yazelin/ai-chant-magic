import { defineConfig } from 'vite';

// base: './' makes built asset paths relative, which works both locally
// and under the GitHub Pages project subpath (/ai-chant-magic/).
export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['@acm/shared'] },
  server: { fs: { allow: ['..'] } },
  // 等待模式（直播倒數）：arena.html 是大螢幕、pad.html 是手機手把，跟主遊戲一起部署。
  build: {
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        arena: new URL('./arena.html', import.meta.url).pathname,
        pad: new URL('./pad.html', import.meta.url).pathname,
      },
    },
  },
});

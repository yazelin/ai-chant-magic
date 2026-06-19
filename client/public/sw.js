// Minimal service worker — its presence (with a fetch handler) makes the game
// installable as a standalone PWA (natural fullscreen on mobile, no browser
// chrome). Network passthrough: no caching, so it never serves a stale build.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  /* passthrough: let the browser fetch normally (handler presence enables install) */
});

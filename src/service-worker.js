const CACHE_NAME = 'chuhe-shell-v91';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/apple-touch-icon.png', './styles.css', './styles-import.css', './src/app.js', './src/pwa.js?v=1', './src/mobile-updater.js?v=1', './src/audio.js?v=wood-move-1', './src/importer.js', './src/xqf.js', './src/cbl.js', './src/rules.js', './src/notation.js', './src/repetition.js', './src/storage.js', './src/ai.js', './src/ai-worker.js', './engine/pikafish/engine.js?v=engine-cdn-2', './engine/pikafish/worker.js?v=engine-cdn-2', './data/records/modern-games.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin || new URL(request.url).pathname.startsWith('/api/')) return;
  if (new URL(request.url).pathname.includes('/engine/pikafish/dist/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      return await cache.match(request)
        ?? (request.mode === 'navigate' ? await cache.match('./index.html') : null)
        ?? Response.error();
    }
  })());
});

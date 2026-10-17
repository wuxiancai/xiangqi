const CACHE_NAME = 'chuhe-shell-v41';
const APP_SHELL = ['./', './index.html', './styles.css', './styles-import.css', './src/app.js', './src/audio.js', './src/importer.js', './src/xqf.js', './src/cbl.js', './src/rules.js', './src/notation.js', './src/repetition.js', './src/storage.js', './src/ai.js', './src/ai-worker.js', './engine/pikafish/engine.js', './data/records/modern-games.json'];

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
      return await cache.match(request) ?? Response.error();
    }
  })());
});

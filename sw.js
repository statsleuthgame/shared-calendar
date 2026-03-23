const CACHE_NAME = 'our-calendar-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Let all requests go to network — Firebase needs live connections
  // Only fall back to cache when offline
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

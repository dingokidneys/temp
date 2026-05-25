// TV Signal Finder — Service Worker
// Caches the app shell and transmitter data for offline use

const CACHE = 'tv-signal-v17';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './transmitters.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Postcodes.io API — always go to network (needs live data)
  if (e.request.url.includes('postcodes.io')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Everything else — cache first, fall back to network
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

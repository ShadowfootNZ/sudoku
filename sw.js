// Service worker: cache-first strategy for all static assets

const CACHE = 'sudoku-v33';
const BASE  = self.registration.scope;

const ASSETS = [
  '',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/settings.js',
  'js/state.js',
  'js/ui.js',
  'js/input.js',
  'js/generator.js',
  'js/worker.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon.ico',
  'icons/favicon-16x16.png',
  'icons/favicon-32x32.png',
  'icons/favicon-192x192.png',
  'icons/favicon-512x512.png',
].map(p => new URL(p, BASE).href);

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  // No skipWaiting here — new SW waits until user approves update via settings
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
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
  // Only handle GET requests for our own origin
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

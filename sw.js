// Service worker: cache-first strategy for all static assets

const CACHE = 'sudoku-v52';
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
  'js/analytics.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon.ico',
  'icons/favicon-16x16.png',
  'icons/favicon-32x32.png',
  'icons/favicon-192x192.png',
  'icons/favicon-192x192-maskable.png',
  'icons/favicon-512x512.png',
  'icons/favicon-512x512-maskable.png',
].map(p => new URL(p, BASE).href);

self.addEventListener('install', e => {
  // Past the browser's HTTP cache: the server sends no Cache-Control, so a
  // browser may reuse its copy of a file for hours, and this worker would
  // store the previous version's files under its own name.
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
  );
  // No skipWaiting here — new SW waits until user approves update via settings
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// Cache Storage is shared by every app on this origin, so only Sudoku's
// own earlier caches are removed, never another app's.
self.addEventListener('activate', e => {
  // Taking over pages with no worker yet, as on a first visit, is part of
  // activating, so the worker is kept alive until it is done.
  e.waitUntil(Promise.all([
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('sudoku-') && k !== CACHE).map(k => caches.delete(k)))
    ),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', e => {
  // Only handle GET requests for our own origin
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

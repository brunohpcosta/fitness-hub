/**
 * Fitness Hub — service worker
 *
 * Purpose in step 1: make the app open with no signal. On race day you may be
 * four hours out with poor reception, and the refuel schedule has to be there.
 *
 * Strategy: cache-first for the app shell, network-only for everything else.
 * When the read API arrives in step 4 its responses must NOT be served from
 * this cache — stale training data displayed as current would be worse than
 * no data at all. The origin check below is what enforces that: API calls go
 * to the Worker on a different origin and are never intercepted.
 *
 * Bump CACHE on every deploy or the old shell is served forever.
 */
const CACHE = 'fitness-hub-shell-v3.0.0-step1';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Never touch writes.
  if (req.method !== 'GET') return;

  // Never touch cross-origin requests — that is where the API will live.
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => caches.match('./index.html'));
    })
  );
});

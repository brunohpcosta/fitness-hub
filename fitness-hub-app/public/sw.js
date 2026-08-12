/**
 * Fitness Hub — service worker
 *
 * Job: the app must open with no signal. On race day you may be four hours out
 * with poor reception and the refuel schedule has to be there.
 *
 * Rules:
 *  - API responses are NEVER cached. Stale training data shown as current is
 *    worse than no data. The origin check below enforces it — the Worker is on
 *    a different hostname and is never intercepted.
 *  - Bump CACHE on every deploy or the old shell is served forever.
 *
 * Rewritten after a cold-start-offline failure. Three things changed:
 *  1. addAll() was replaced with individual add() calls. addAll is atomic — one
 *     failed asset aborted the whole install and left NOTHING cached, which is
 *     the worst possible outcome and completely silent.
 *  2. Navigation requests are handled explicitly. A cold launch asks for the
 *     document; without a branch for it the request could fall through to the
 *     network and simply fail.
 *  3. Absolute paths, so cache keys cannot depend on what resolved them.
 */
const CACHE = 'fitness-hub-shell-v3.10.0-interactive';

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One at a time, failures tolerated. Caching four of five assets is far
    // better than caching none because the fifth 404'd.
    for (const url of ASSETS) {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        // Deliberately swallowed — see above.
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // The API is on another origin. Never touch it.
  if (url.origin !== self.location.origin) return;

  // ── document requests ──
  // Network first so a deploy is picked up, cache immediately behind it so a
  // cold launch in aeroplane mode still opens. fetch() fails fast with no
  // connection, so the fallback costs nothing.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put('/index.html', fresh.clone());
        return fresh;
      } catch (err) {
        const cached = (await cache.match('/index.html')) || (await cache.match('/'));
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8"><body style="background:#0a0a0c;color:#f4f4f6;'
          + 'font-family:-apple-system,sans-serif;padding:40px 24px;line-height:1.6">'
          + '<h1 style="font-size:20px">Offline, and nothing cached yet</h1>'
          + '<p style="color:#9494a2;font-size:15px">Open this app once with a connection '
          + 'so it can store a copy for offline use.</p></body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // ── everything else same-origin ──
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      return Response.error();
    }
  })());
});

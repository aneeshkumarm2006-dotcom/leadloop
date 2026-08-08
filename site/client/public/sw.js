/*
 * LeadLoop service worker — makes the app installable and usable offline.
 *
 * Strategy (kept deliberately conservative so it can never serve stale data):
 *   • Navigations (mode === 'navigate') → network-first, falling back to the
 *     cached app shell (index.html) when offline. Online users always get the
 *     freshest HTML, so a new deploy is picked up on the next load.
 *   • Same-origin static assets (hashed /assets/* etc.) → stale-while-
 *     revalidate. Filenames are content-hashed, so a cached asset is never wrong
 *     for the HTML that references it.
 *   • /api and /auth, POST/PUT/etc, and ALL cross-origin requests (the API lives
 *     on its own host) → passed straight through, never cached. Auth tokens and
 *     live CRM data must never come from a cache.
 *
 * Bump CACHE_VERSION to force old caches out on the next activate.
 */

const CACHE_VERSION = 'leadloop-v1';
const APP_SHELL = ['/', '/index.html', '/favicon.svg', '/app-icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isApiRequest = (url) =>
  url.pathname.startsWith('/api') || url.pathname.startsWith('/auth') || url.pathname.startsWith('/f/');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never cache mutations

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API host, fonts, etc. — untouched
  if (isApiRequest(url)) return; // live data / auth — always network

  // App navigations: network-first with an offline shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

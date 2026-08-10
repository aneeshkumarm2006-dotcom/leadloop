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

const CACHE_VERSION = 'leadloop-v2';
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

/* ------------------------------ Web Push ------------------------------ *
 * A push event wakes the service worker even when the app is closed — this is
 * what makes the speed-to-lead clock work on a phone.
 *
 * `showNotification` MUST be called for every push: browsers permit a limited
 * number of silent pushes before revoking permission entirely, so a malformed
 * payload still shows a generic notification rather than nothing.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || 'LeadLoop';
  const options = {
    body: data.body || '',
    icon: '/app-icon.svg',
    badge: '/app-icon.svg',
    // Same tag → the new alert REPLACES the old one for that lead, instead of
    // stacking five notifications about the same person.
    tag: data.tag || 'leadloop',
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    data: { url: data.url || '/workspace' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Tapping a notification focuses an open tab and navigates it, rather than
 * piling up new windows — an agent tapping three lead alerts should end up
 * with one app, not three.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/workspace';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

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

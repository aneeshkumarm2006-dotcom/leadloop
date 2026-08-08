/**
 * registerSW — register the service worker in production only.
 *
 * Dev is skipped on purpose: a SW caching Vite's dev server makes HMR flaky and
 * hides source changes. In production the SW (public/sw.js, copied to the dist
 * root) is served from the app origin with root scope, which is what makes
 * LeadLoop installable + offline-capable.
 *
 * We don't force a reload when a new SW takes over — navigations are
 * network-first, so the next full load already gets fresh HTML + hashed assets.
 */
export function registerSW() {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // Registration failing must never break the app — it just means no
      // offline support this session.
      console.warn('SW registration failed:', err);
    });
  });
}

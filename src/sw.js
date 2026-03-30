/* global clients */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

// Clean up caches from previous service worker versions
cleanupOutdatedCaches();

// Precache all assets injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);

// ── SPA navigation fallback ────────────────────────────────────────────────
// Serve index.html for any navigation request that is not an API call, so
// that client-side routes (e.g. /transactions, /profile) work when the page
// is refreshed or opened directly.  This restores the behaviour that the old
// generateSW + navigateFallbackDenylist configuration provided.
const handler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/api\//],
});
registerRoute(navigationRoute);

// ── autoUpdate: skip waiting so the new SW activates immediately ───────────
// vite-plugin-pwa's registerType:'autoUpdate' sends this message; without a
// handler the new SW stays in "waiting" state and the old SW keeps serving
// stale (deleted) asset files, causing a blank page after a new deployment.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Push notification handler ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'CIF Quick Cash', body: 'You have new activity.', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch { /* use defaults if payload is not JSON */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-icon.svg',
      badge: '/pwa-icon.svg',
      tag: data.tag || 'cif-notification',
      data: { url: data.url || '/' },
    }),
  );
});

// ── Notification click handler ─────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(url) : undefined;
    }),
  );
});

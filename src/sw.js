/* global clients */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

// Clean up caches from previous service worker versions
cleanupOutdatedCaches();

// Precache all assets injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);

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

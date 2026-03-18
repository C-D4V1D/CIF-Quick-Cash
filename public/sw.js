// Cache Kill Switch Service Worker
// This file replaces the old PWA service worker.
// It immediately takes control, clears all caches, and unregisters itself.

self.addEventListener('install', () => {
  // Skip waiting so this SW activates immediately, overriding any old one
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(cacheNames.map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
  );
});

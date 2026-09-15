/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope;

// Workbox precaching
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
clientsClaim();
self.skipWaiting();

// API caching — NetworkFirst
registerRoute(
  /^https?:\/\/.*\/api\/v1\/.*/i,
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 5 })],
    networkTimeoutSeconds: 10,
  }),
);

// Static assets — CacheFirst
registerRoute(
  /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/i,
  new CacheFirst({
    cacheName: 'static-assets',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

// Navigation fallback — serve index.html for SPA routes
registerRoute(
  ({ request, url }) => {
    if (request.mode !== 'navigate') return false;
    const denylist = [/^\/api\//, /^\/authorize/, /^\/token/, /^\/register$/, /^\/revoke/, /^\/mcp/, /^\/.well-known\//];
    return !denylist.some(re => re.test(url.pathname));
  },
  new NetworkFirst({
    cacheName: 'navigations',
    networkTimeoutSeconds: 3,
  }),
);

// ---------------------------------------------------------------------------
// Push Notification Handler
// ---------------------------------------------------------------------------

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  try {
    const payload = event.data.json() as {
      title: string;
      body: string;
      url?: string;
      tag?: string;
    };

    event.waitUntil(
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: payload.tag || 'kovarti-notification',
        data: { url: payload.url },
      }),
    );
  } catch {
    // Fallback for plain text
    event.waitUntil(
      self.registration.showNotification('Kovarti PM', {
        body: event.data.text(),
        icon: '/pwa-192x192.png',
      }),
    );
  }
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    }),
  );
});

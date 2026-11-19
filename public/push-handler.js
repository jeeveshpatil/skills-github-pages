/* Imported into the generated service worker (vite.config.ts workbox.importScripts). */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'ShadowHunt', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'ShadowHunt Pro', {
    body: d.body || '',
    tag: d.tag,
    renotify: true,
    requireInteraction: !!d.urgent,
    icon: self.registration.scope + 'icon-192.png',
    badge: self.registration.scope + 'icon-192.png',
    vibrate: d.urgent ? [400, 100, 400] : [120, 60, 120],
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data.url.replace(/^\//, ''), self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate(target); return c.focus(); }
    return clients.openWindow(target);
  }));
});

// Erasquest service worker: shows pop-up notifications and opens the right screen when one is tapped.
// It does not cache pages, so students always get the newest version of the app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Erasquest', body: e.data ? e.data.text() : '' }; }
  const badge = Number.isInteger(d.count) && self.navigator.setAppBadge
    ? (d.count > 0 ? self.navigator.setAppBadge(d.count) : self.navigator.clearAppBadge()).catch(() => {}) : Promise.resolve();
  e.waitUntil(badge.then(() => self.registration.showNotification(d.title || 'Erasquest', {
    body: d.body || '',
    icon: '/brand/icon-192.png',
    badge: '/brand/badge-96.png',
    tag: d.tag,
    renotify: !!d.tag,
    data: { url: d.url || '/#/plans' },
  })));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/#/plans', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        try { await w.navigate(url); } catch { w.postMessage({ type: 'open', url }); }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

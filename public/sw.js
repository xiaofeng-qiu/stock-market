/* 自定义 Service Worker：包装 Angular ngsw-worker.js，补充 Web Push 能力
 * ngsw 负责缓存与更新；这里只处理推送展示与点击跳转 */
importScripts('./ngsw-worker.js');

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* ignore */ }
  const title = data.title || '预判验证';
  const options = {
    body: data.body || '',
    icon: 'icons/icon-192x192.png',
    badge: 'icons/icon-72x72.png',
    data: { url: data.url || '/verify' },
    tag: 'prediction-verify',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/verify';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client && new URL(client.url).origin === self.location.origin) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

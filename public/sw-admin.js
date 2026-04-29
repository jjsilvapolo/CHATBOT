self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data.json(); } catch (e) {}
  var title = data.title || 'BurgerJazz Chat';
  var isUrgent = data.urgent === true;
  var options = {
    body: data.body || 'Nueva actividad en el chatbot',
    icon: '/logo.png',
    badge: '/logo.png',
    data: { url: data.url || '/dashboard.html' },
    vibrate: isUrgent ? [300, 100, 300, 100, 300, 100, 300] : [200, 100, 200],
    tag: isUrgent ? 'urgente' : 'info',
    renotify: true,
    requireInteraction: isUrgent
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/dashboard.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function (clients) {
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].url.indexOf('dashboard') !== -1 && 'focus' in clients[i]) {
          return clients[i].focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

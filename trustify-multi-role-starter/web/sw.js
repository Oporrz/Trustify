//(Service Worker for Push)//

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = { title:'Trustify', body:'New message' }; }

  const title = data.title || 'Trustify';
  const body = data.body || 'You have a notification';
  const icon = '/logo192.png'; 
  event.waitUntil(
    self.registration.showNotification(title, { body, icon, badge: icon })
  );
});

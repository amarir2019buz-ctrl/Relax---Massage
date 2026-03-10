// Relax PWA - Service Worker v1
const CACHE_NAME = 'relax-v2';
const ASSETS = ['./relax-firebase.html', './'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname !== location.hostname) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('./relax-firebase.html'));
    })
  );
});

self.addEventListener('push', e => {
  const d = e.data?.json() || {title:'Relax', body:'إشعار جديد'};
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, dir: 'rtl', lang: 'ar',
    icon: 'https://raw.githubusercontent.com/amarir2019buz-ctrl/Relax---Massage/main/icon.svg'
  }));
});

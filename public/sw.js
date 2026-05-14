const CACHE   = 'askthat-v1';
const STATIC  = ['/', '/index.html', '/manifest.json', '/favicon.ico', '/icon-192x192.png', '/icon-512x512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept API calls or cross-origin
  if (url.pathname.startsWith('/api/') || url.origin !== location.origin) return;

  // Network-first for HTML pages (always fresh)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Cache-first for static assets (icons, fonts)
  if (/\.(png|ico|jpg|webp|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // Default: network with offline fallback
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

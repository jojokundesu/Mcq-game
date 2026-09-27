/* MediQuiz service worker — offline-first. */
const CACHE = 'mediquiz-v1';
const CORE = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/manifest.webmanifest',
  '/data/medicines.json',
  '/data/skipped_report.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(CORE.map(u => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // quiz/session APIs — network only, never cache
  if (url.pathname.startsWith('/api/')) return;

  // data: network-first, fall back to cache (fresh catalog when online)
  if (url.pathname.startsWith('/data/')) {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // static: cache-first, then network (and cache it), shell fallback for documents
  e.respondWith(
    caches.match(e.request).then(hit => hit ||
      fetch(e.request).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return r;
      }).catch(() => e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error())
    )
  );
});

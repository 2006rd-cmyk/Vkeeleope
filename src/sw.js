// Vire service worker: everything is stored on the phone after the first visit, so the app
// opens instantly and works without internet. A new version is fetched in the background
// and used from the next launch.
const CACHE = '__CACHE__';
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vire-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Pages: the cached app shell (the app is one page).
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./', { cacheName: CACHE }).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req)),
  );
});

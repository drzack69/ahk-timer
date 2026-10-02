// Offline support: network first (always fresh when online), cache as fallback
// so the app still opens at a track with no signal. Bump CACHE when files are
// added or renamed.
const CACHE = 'ahk-timer-v3';
const CORE = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './css/app.css',
  './assets/logo.svg',
  './assets/favicon.svg',
  './assets/icon.svg',
  './js/main.js',
  './js/engine.js',
  './js/ops.js',
  './js/store.js',
  './js/sync/local.js',
  './js/sync/firebase.js',
  './js/auth.js',
  './js/sha256.js',
  './js/format.js',
  './js/icons.js',
  './js/ui.js',
  './js/timeline.js',
  './js/views/login.js',
  './js/views/races.js',
  './js/views/settings.js',
  './js/views/monitor.js',
  './js/views/stats.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      // Other apps on the same github.io origin share this cache list — only touch ours.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ahk-timer-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Same-origin files, Google Fonts and the Firebase SDK are cached for offline
  // starts. Firestore's own traffic (firestore.googleapis.com) is never touched.
  const font = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  const sdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (url.origin !== self.location.origin && !font && !sdk) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .open(CACHE)
          .then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? c.match('./index.html') : undefined)))
          .then((hit) => hit || Response.error()),
      ),
  );
});

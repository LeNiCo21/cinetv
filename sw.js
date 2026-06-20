// CinéTV Service Worker — enables offline use and "Add to Home Screen" installability.
//
// Strategy: stale-while-revalidate. The cached version is served immediately
// (fast, works offline), but every request also goes to the network in the
// background; if the network response differs, the cache is updated for next
// time AND the open app(s) are notified so they can offer a "mise à jour
// disponible" prompt instead of silently staying stale forever.
//
// CACHE_VERSION must be bumped (any string change) whenever app files change
// — that's what makes old caches get cleaned up on activate, which is the
// piece that was missing before and required a full uninstall/reinstall to
// see changes like updated icons.
const CACHE_VERSION = 'v2';
const CACHE_NAME = `cinetv-cache-${CACHE_VERSION}`;
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting(); // activate the new SW immediately instead of waiting for all tabs to close
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()) // take control of already-open tabs without requiring a reload
  );
});

// Allows the page to ask the waiting/new service worker to activate right away
// (used by the in-app "Mettre à jour" button).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept calls to external APIs (TMDB, Google Drive/OAuth) —
  // those must always go to the network, never be served from cache.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);

      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          cache.put(event.request, responseClone);
          // If we already had a cached copy and the network version differs,
          // tell every open tab a new version is available.
          if (cached) {
            cached.clone().text().then(oldText => {
              response.clone().text().then(newText => {
                if (oldText !== newText) {
                  self.clients.matchAll().then(clients => {
                    clients.forEach(client => client.postMessage('CINETV_UPDATE_AVAILABLE'));
                  });
                }
              });
            }).catch(()=>{});
          }
        }
        return response;
      }).catch(() => null);

      // Serve cache immediately if we have it; otherwise wait for network.
      if (cached) {
        networkFetch; // kicked off in the background, intentionally not awaited
        return cached;
      }
      const networkResponse = await networkFetch;
      if (networkResponse) return networkResponse;
      // Offline and not cached — for navigation requests, fall back to the app shell.
      if (event.request.mode === 'navigate') {
        return cache.match('./index.html');
      }
      return new Response('', { status: 504 });
    })
  );
});

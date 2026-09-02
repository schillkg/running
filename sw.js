const CACHE_PREFIX = "my-training-running-";
const CACHE_NAME = `${CACHE_PREFIX}shell-v4`;
const ASSET_PATHS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./js/model.js",
  "./js/store.js",
  "./data/fall-creek-2026.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

const scopedUrl = (path) => new URL(path, self.registration.scope).toString();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSET_PATHS.map(scopedUrl)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const scopeUrl = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const isAppEntry = response.ok
            && (url.pathname === scopeUrl.pathname || url.pathname === `${scopeUrl.pathname}index.html`);
          if (isAppEntry) {
            try {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(scopedUrl("./index.html"), response.clone());
            } catch (error) {
              console.warn("Could not refresh the offline app shell.", error);
            }
          }
          return response;
        })
        .catch(() => caches.match(scopedUrl("./index.html")).catch(() => undefined))
    );
    return;
  }

  const update = fetch(request).then(async (response) => {
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        } catch (error) {
          console.warn("Could not refresh an offline asset.", error);
        }
      }
      return response;
    });
  event.respondWith(caches.match(request).catch(() => undefined).then((cached) => cached || update));
  event.waitUntil(update.then(() => undefined).catch(() => undefined));
});

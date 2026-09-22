/**
 * Acamics static-site service worker.
 * Cache-only support for the static deployment.
 * Web Push/reminder handling is intentionally not included here.
 */
const CACHE_NAME = "acamics-static-v1";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./data/events.json",
  "./posters/academic.png",
  "./posters/exams.png",
  "./posters/breaks.png",
  "./posters/fests-cultural.png",
  "./posters/reviews-submissions.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request);
    })
  );
});

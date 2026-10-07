const CACHE_NAME = "acamics-pwa-v8";
const STATIC_ASSETS = [
  "./", "./index.html", "./calendar.html", "./calendar-entry.js",
  "./style.css", "./app.js", "./supabase-client.js", "./login.html",
  "./auth.css", "./auth.js", "./manifest.json",
  "./icons/acamics-192.png", "./icons/acamics-512.png", "./icons/acamics-maskable.svg",
  "./posters/academic.png", "./posters/exams.png", "./posters/breaks.png",
  "./posters/fests-cultural.png", "./posters/reviews-submissions.png", "./posters/technical.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("acamics-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && request.url.startsWith(self.location.origin)) cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request);
      return cached || (request.mode === "navigate" ? cache.match("./index.html") : Response.error());
    }
  })());
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data?.text() || "You have an upcoming Acamics event." }; }
  const title = payload.title || "Acamics reminder";
  const options = {
    body: payload.body || "You have an upcoming event.",
    icon: "./icons/acamics-192.png",
    badge: "./icons/acamics-192.png",
    tag: payload.tag || "acamics-event-reminder",
    data: { url: payload.url || "./calendar.html" },
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./calendar.html", self.location.href).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});

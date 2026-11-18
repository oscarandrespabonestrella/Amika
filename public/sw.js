// Service worker: makes the app installable, shows /offline.html when a page navigation
// fails, and serves the rulebook PDFs the user chose to save on this device (see
// sw-logic.js for the routing rules). It deliberately caches nothing else (no signed-in
// pages, no API data, no recognition models): everything else stays online.
importScripts("/sw-logic.js");
var sw = self.AmikaSw;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(sw.SHELL_CACHE)
      .then((cache) => cache.addAll(sw.PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Only old shell caches: the saved manuals (and anything else) are never touched.
      .then((keys) =>
        Promise.all(sw.staleCaches(keys).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const route = sw.routeFor(
    request.method,
    request.mode,
    request.url,
    self.location.origin,
  );

  if (route === "manual-file") {
    event.respondWith(
      caches
        .open(sw.MANUALS_CACHE)
        .then((cache) => cache.match(request.url))
        .then((saved) => saved ?? fetch(request)),
    );
  } else if (route === "manuals-page") {
    event.respondWith(
      caches
        .open(sw.SHELL_CACHE)
        .then((cache) => cache.match(sw.MANUALS_PAGE))
        .then((page) => page ?? fetch(request)),
    );
  } else if (route === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(sw.SHELL_CACHE);
        return (await cache.match("/offline.html")) ?? Response.error();
      }),
    );
  }
});

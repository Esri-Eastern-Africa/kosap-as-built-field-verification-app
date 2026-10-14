/* Service worker — caches the local app shell for PWA / offline-launch.
 * Cross-origin requests (ArcGIS CDN, the portal OAuth flow, and the feature
 * service) are intentionally NOT intercepted, so authentication and live data
 * always go straight to the network. */

const CACHE = "afv-v3";

const SHELL = [
  "./",
  "index.html",
  "app.js",
  "style.css",
  "manifest.webmanifest",
  "assets/logo.png",
  "assets/pole.png",
  "assets/transformer.png",
  "assets/minigrid.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "assets/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only manage our own origin. Let the CDN, portal (OAuth) and
  // feature service requests pass through to the network untouched.
  if (url.origin !== self.location.origin) return;

  // App navigations: network first, fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("index.html")));
    return;
  }

  // Local static assets: cache first, then network (and cache the result).
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
    )
  );
});

// Service worker — installable PWA + offline app shell.
// Strategy: documents & flight data are network-first (so updates show), other
// assets (versioned CSS/JS, icons, CDN libs, globe texture) are cache-first.
// Map tiles are never cached (would balloon storage).
const VERSION = "v1";
const SHELL_CACHE = "shell-" + VERSION;
const RUNTIME = "runtime-" + VERSION;
const SHELL = [
  "./", "./index.html", "./flight.html", "./manifest.webmanifest",
  "./assets/icon-192.png", "./assets/icon-512.png", "./assets/apple-touch-icon.png",
];
const TILE_HOSTS = ["server.arcgisonline.com", "basemaps.cartocdn.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheCopy(req, res) {
  if (res && (res.ok || res.type === "opaque")) {
    const copy = res.clone();
    caches.open(RUNTIME).then(c => c.put(req, copy));
  }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (TILE_HOSTS.includes(url.hostname)) return; // let map tiles go straight to network

  const isDoc = req.mode === "navigate" || req.destination === "document";
  const isData = url.pathname.includes("/data/") && url.pathname.endsWith(".json");

  if (isDoc) {
    e.respondWith(
      fetch(req).then(r => cacheCopy(req, r))
        .catch(() => caches.match(req).then(m => m || caches.match("./index.html")))
    );
    return;
  }
  if (isData) {
    e.respondWith(fetch(req).then(r => cacheCopy(req, r)).catch(() => caches.match(req)));
    return;
  }
  // cache-first for versioned assets, icons, CDN libs, globe texture
  e.respondWith(
    caches.match(req).then(m => m || fetch(req).then(r => cacheCopy(req, r)))
  );
});

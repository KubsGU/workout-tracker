// Service worker — automatyczne aktualizacje.
// Strategia: NETWORK-FIRST dla plików z naszego origin — gdy jesteś online,
// zawsze ładuje się najnowsza wersja (bez czyszczenia pamięci). Cache służy
// tylko jako zapas offline. Nowy SW przejmuje stronę natychmiast (skipWaiting),
// a aplikacja sama się przeładuje (patrz app.js), więc nowy release pojawia się
// automatycznie.
const CACHE = "trening-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./store.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pozwól stronie wymusić natychmiastową aktywację nowego SW.
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // Supabase/CDN: zawsze z sieci, bez cache

  // Network-first: najpierw sieć (świeże), w razie braku — cache (offline).
  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((c) => c || caches.match("./index.html")))
  );
});

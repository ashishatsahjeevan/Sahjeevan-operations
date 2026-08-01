/* Sahjeevan Operations — service worker
   ----------------------------------------------------------------------
   Two jobs: let the app open when there is no signal, and never serve a
   stale copy of the app itself.

   The previous version cached everything cache-first, including
   index.html. That meant once a phone had loaded the app it kept the old
   copy indefinitely, and uploading a new index.html changed nothing for
   anyone who had already visited. The app shell is now network-first:
   fresh when there is signal, cached only as a fallback.

   Bump CACHE_VERSION on every release so old caches are cleared.
*/
const CACHE_VERSION = "v3-2026-08";
const SHELL = "sahjeevan-shell-" + CACHE_VERSION;
const ASSETS = "sahjeevan-assets-" + CACHE_VERSION;

/* Files worth having available offline. Kept short on purpose: if any one
   of these 404s, addAll rejects and nothing is cached at all, so each is
   requested individually and failures are tolerated. */
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(ASSETS);
    // one at a time, so a single missing icon does not sink the install
    await Promise.all(PRECACHE.map(u =>
      c.add(new Request(u, {cache: "reload"})).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== SHELL && k !== ASSETS).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* Let the page tell a waiting worker to take over immediately. */
self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

const isShell = req =>
  req.mode === "navigate" ||
  (req.destination === "document") ||
  new URL(req.url).pathname.endsWith("/index.html");

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  /* The backend must never be cached — a cached reply would show stale
     requests, or worse, let a write appear to succeed while offline. */
  if (url.hostname.includes("script.google.com") ||
      url.hostname.includes("googleusercontent.com") ||
      url.hostname.includes("accounts.google.com") ||
      url.hostname.includes("oauth2.googleapis.com")) {
    return;   // straight to the network; fails honestly when offline
  }

  /* App shell: network first, cache as fallback. This is what makes an
     update actually reach people. */
  if (isShell(req)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(SHELL);
        c.put("./index.html", fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match("./index.html", {ignoreSearch: true});
        return cached || new Response(
          "<h1>Offline</h1><p>Sahjeevan Operations needs a connection the first time it is opened on this device.</p>",
          {status: 503, headers: {"Content-Type": "text/html; charset=utf-8"}}
        );
      }
    })());
    return;
  }

  /* Everything else (icons, manifest): cache first, refresh in background. */
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(res => {
      if (res && res.status === 200 && res.type === "basic") {
        caches.open(ASSETS).then(c => c.put(req, res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response("", {status: 504});
  })());
});

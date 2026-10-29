// =========================================================
//  Offline support (a "service worker").
//  After the first visit, the app's own files are kept on the phone, so
//  it opens and works with no signal. Shared photos wait on the phone
//  until they can be sent (Outbox in js/app.js).
//   - Pages, wedding details, song list: fresh from the internet when
//     possible, the saved copy when not (or after 4 s of weak signal)
//   - CSS, scripts, fonts, pictures: the saved copy (fast). A new version
//     number on every deploy means new files are fetched after an update.
//   - Songs (mp3) and Google (album, Drive photos): never kept here
// =========================================================
const VERSION = "?v=dev";   // replaced on every deploy (see .github/workflows/deploy.yml)
const CACHE = "weddingsnap-" + VERSION.slice(3);

// Everything the app needs to open and take photos
const CORE = [
  "./",
  "index.html",
  "settings.json",
  "music/songs.json",
  "manifest.webmanifest",
  "css/style.css" + VERSION,
  "js/config.js" + VERSION,
  "js/filters.js" + VERSION,
  "js/effects.js" + VERSION,
  "js/vendor/gifenc.js" + VERSION,
  "js/audio.js" + VERSION,
  "js/app.js" + VERSION,
  "css/fonts/Runiga.woff2",
  "css/fonts/Runethia.woff2",
  "css/fonts/OrangeAvenueDEMO-Regular.woff2",
  "css/vinyl.webp",
  "css/background.jpg",
  "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

// A new version is ready: remove the old saved files
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("weddingsnap-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;   // uploads; songs stream in pieces
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (/\.(mp3|mp4)$/i.test(url.pathname)) return;   // big media: straight from the internet
    const fresh = req.mode === "navigate" || /\.(html|json|webmanifest)$/i.test(url.pathname) || url.pathname.endsWith("/");
    e.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(cacheFirst(req));   // DM Sans
  }
  // everything else (Apps Script, Drive photos) is left to the browser
});

async function cacheFirst(req) {
  const saved = await caches.match(req);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // weak signal: don't keep the guest waiting more than 4 s
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 4000)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const saved = await cache.match(req, { ignoreSearch: true }) ||
      (req.mode === "navigate" ? await cache.match("./") || await cache.match("index.html") : null);
    if (saved) return saved;
    throw err;
  }
}

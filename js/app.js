// =========================================================
//  Wedding Snap - modern photobooth
//  Flow: home → layout → booth (camera) → edit → result → gallery
// =========================================================

const $ = (id) => document.getElementById(id);

// =========================================================
//  State = what's going on right now
// =========================================================
const state = {
  layoutId: "strip4",
  colourId: "white",   // frame colour (COLOURS in config.js)
  effectId: "none",    // sparkles, hearts... (js/effects.js)
  filterId: "none",
  shots:    [],      // one raw (unfiltered) canvas per slot, null = empty
  current:  0,       // which slot we're filling
  retakeOne: false,  // true when retaking a single photo from the edit screen
  busy:     false,   // countdown running
  runId:    0,       // bumps when a countdown is cancelled
  timer:    CONFIG.TIMERS[0],
  facing:   "user",  // "user" = selfie camera, "environment" = back camera
  stream:   null,
  final:    null,    // { blob, url } of the finished photo
};

const layout   = () => LAYOUTS[state.layoutId];
const colour   = () => COLOURS.find((c) => c.id === state.colourId) || COLOURS[0];
const filter   = () => FILTERS.find((f) => f.id === state.filterId);
const findFilter = (id) => FILTERS.find((f) => f.id === id);
// The photo window being filled now (shapes can differ, e.g. "Big & Two")
const slotNow  = () => layout().slots[Math.min(state.current, layout().slots.length - 1)];

// =========================================================
//  Small helpers
// =========================================================
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

// A tiny buzz when something is picked (Android; iPhones ignore it)
const tick = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} };

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Uploads made from THIS phone: { fileId: token }. Only these can be deleted.
const Mine = {
  all() { return JSON.parse(localStorage.getItem("weddingsnap.mine") || "{}"); },
  add(id, token) { const m = this.all(); m[id] = token; localStorage.setItem("weddingsnap.mine", JSON.stringify(m)); },
  remove(id) { const m = this.all(); delete m[id]; localStorage.setItem("weddingsnap.mine", JSON.stringify(m)); },
  token(id) { return this.all()[id]; },
};

// Likes (♥) on album photos. Each phone has its own random id so it can
// only like a photo once; the photos it liked are remembered here.
const Likes = {
  me: localStorage.getItem("weddingsnap.liker") || (() => {
    const id = randomToken();
    localStorage.setItem("weddingsnap.liker", id);
    return id;
  })(),
  all() { return new Set(JSON.parse(localStorage.getItem("weddingsnap.liked") || "[]")); },
  has(id) { return this.all().has(id); },
  set(id, on) {
    const s = this.all();
    if (on) s.add(id); else s.delete(id);
    localStorage.setItem("weddingsnap.liked", JSON.stringify([...s]));
  },
};

// Photos kept in this browser (IndexedDB):
//   private - private photos, never uploaded. Shown in the gallery's
//             "Mine" tab for this guest only.
//   outbox  - public photos waiting to reach the album (bad signal at the
//             venue). Sent in the background, then removed (see Sender).
const DB = {
  db: null,
  open() {
    if (!this.db) this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open("weddingsnap", 2);
      req.onupgradeneeded = () => ["private", "outbox"].forEach((name) => {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: "id" });
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  },
  async run(store, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  },
};

// blob = the print as a sharp JPG; live = its moving GIF (Live photos only)
const Private = {
  async add(blob, live = null) {
    const id = "private-" + randomToken();
    await DB.run("private", "readwrite", (s) => s.put({ id, blob, live, time: Date.now() }));
    return id;
  },
  all()      { return DB.run("private", "readonly", (s) => s.getAll()).catch(() => []); },
  remove(id) { return DB.run("private", "readwrite", (s) => s.delete(id)); },
};

// { id (= the upload token), blob, live?, time, wish, name, tries }
const Outbox = {
  put(item)  { return DB.run("outbox", "readwrite", (s) => s.put(item)); },
  all()      { return DB.run("outbox", "readonly", (s) => s.getAll()).catch(() => []); },
  remove(id) { return DB.run("outbox", "readwrite", (s) => s.delete(id)); },
};

// Draw `img` to fill (x, y, w, h) completely, cropping the overflow ("cover")
function drawCover(ctx, img, x, y, w, h) {
  const iw = img.videoWidth || img.naturalWidth || img.width;
  const ih = img.videoHeight || img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale, sh = h / scale;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Shrink the font until the text fits in maxWidth
function fitText(ctx, text, x, y, maxWidth, size, font) {
  do {
    ctx.font = font.replace("{size}", size + "px");
    size -= 2;
  } while (ctx.measureText(text).width > maxWidth && size > 10);
  ctx.fillText(text, x, y);
}

// =========================================================
//  Screens
// =========================================================
// Screens in order. Going to a later one slides in from the right,
// going back slides in from the left.
const SCREENS = ["home", "layout", "booth", "edit", "result", "gallery"];
let current = "home";
let ignorePop = false;

function show(screenId) {
  document.body.classList.toggle("navBack", SCREENS.indexOf(screenId) < SCREENS.indexOf(current));
  current = screenId;
  if (screenId !== "edit") stopClip();
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === screenId));
  document.querySelector('meta[name="theme-color"]')
    .setAttribute("content", screenId === "booth" ? "#110e0f" : "#f8f1ee");

  // The phone's Back button should go back a screen, not close the app
  // (and lose the photos). One history entry is kept while away from home.
  const inApp = history.state && history.state.app;
  if (screenId !== "home" && !inApp && !(history.state && history.state.lightbox)) history.pushState({ app: true }, "");
  if (screenId === "home" && inApp) { ignorePop = true; history.back(); }

  // Camera is only needed in the booth. Turn it off elsewhere to save battery.
  if (screenId === "booth") startCamera();
  else if (screenId !== "edit") stopCamera();   // keep it warm while editing (for retakes)

  if (screenId === "gallery") loadGallery();
  window.scrollTo(0, 0);
  keepAlive();
}

// Keep the music and the moving background going. Phones pause both when
// something interrupts the page (a pop-up, a call, switching apps) and
// don't always start them again by themselves. The background is also
// hidden in the booth, so it's restarted when the guest leaves it.
function keepAlive() {
  if (document.hidden) return;
  Sound.resume();
  Wave.start();
  const bg = document.querySelector(".bgVideo");
  if (bg && bg.paused && current !== "booth") bg.play().catch(() => {});
}
document.addEventListener("visibilitychange", keepAlive);
window.addEventListener("pageshow", keepAlive);   // back from another page / the phone's app switcher
window.addEventListener("focus", keepAlive);
document.addEventListener("pointerdown", keepAlive, true);

// "Are you sure?" in the page itself. The browser's confirm() shows a
// system pop-up that, on phones, pauses the music and the background.
let askDone = null;
function ask(text, yes = "OK", danger = false) {
  if (askDone) askDone(false);
  return new Promise((resolve) => {
    $("askText").textContent = text;
    $("askYes").textContent = yes;
    $("askYes").className = "btn " + (danger ? "danger" : "primary");
    $("ask").classList.remove("hidden");
    $(danger ? "askNo" : "askYes").focus();   // deleting is never the default
    askDone = (answer) => {
      askDone = null;
      $("ask").classList.add("hidden");
      resolve(answer);
    };
  });
}
$("askYes").addEventListener("click", () => askDone && askDone(true));
$("askNo").addEventListener("click", () => askDone && askDone(false));
$("ask").addEventListener("click", (e) => { if (e.target === $("ask") && askDone) askDone(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && askDone) askDone(false); });

// Step bar under the title: Layout → Pose → Style → Share
const FLOW = [["layout", "Layout"], ["booth", "Pose"], ["edit", "Style"], ["result", "Share"]];
FLOW.forEach(([id], n) => {
  const ol = document.createElement("ol");
  ol.className = "flow";
  ol.setAttribute("aria-label", `Step ${n + 1} of ${FLOW.length}`);
  FLOW.forEach(([, name], i) => {
    const li = document.createElement("li");
    li.textContent = name;
    if (i < n) li.className = "done";
    if (i === n) { li.className = "now"; li.setAttribute("aria-current", "step"); }
    ol.appendChild(li);
  });
  const screen = $(id);
  const bar = screen.querySelector(".topbar");
  if (bar) bar.after(ol); else screen.prepend(ol);
});

document.querySelectorAll("[data-go]").forEach((btn) =>
  btn.addEventListener("click", () => show(btn.dataset.go)));

// What the phone's Back button does on each screen
function goBack() {
  if (current === "booth") $("boothBack").click();       // cancels a countdown first
  else if (current === "edit") $("editBack").click();    // asks before throwing photos away
  else if (current !== "home") show("home");
}

window.addEventListener("popstate", () => {
  if (ignorePop) { ignorePop = false; return; }
  // Back while "Are you sure?" or the wish card is open = Cancel (and stay where we are)
  if (askDone || wishDone) {
    if (askDone) askDone(false);
    if (wishDone) wishDone(null);
    history.pushState(lbOpen() ? { lightbox: true } : { app: true }, "");
    return;
  }
  const lb = $("lightbox");
  if (!lb.classList.contains("hidden")) { hideLightbox(); return; }
  goBack();
  // ready for the next Back (show() may already have added the entry)
  if (current !== "home" && !(history.state && history.state.app)) history.pushState({ app: true }, "");
});

// Wedding details saved from the admin page (settings.json) replace the
// defaults in config.js - on the home page and on every photo.
// Opened straight from the folder (file://), browsers won't let the page
// read settings.json, so the same details come from settings.js instead.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
const settingsReady = (location.protocol === "file:"
    ? loadScript("settings.js").then(() => window.SETTINGS_DATA || {})
    : fetch("settings.json", { cache: "no-cache" }).then((res) => (res.ok ? res.json() : {})))
  .then((s) => {
    ["TITLE", "COUPLE", "DATE"].forEach((key) => {
      const value = s[key.toLowerCase()];
      if (typeof value === "string" && value.trim()) CONFIG[key] = value.trim();
    });
    // text sizes on the photo, in % (admin → Wedding details)
    ["title", "couple", "date"].forEach((key) => {
      const size = Number(s[key + "Size"]);
      if (size >= 50 && size <= 200) CONFIG.TEXT_SIZE[key] = size;
    });
  })
  .catch(() => console.warn("No settings.json - using config.js"))
  .then(showDetails);

// Fonts + details must be loaded before drawing on canvas
const ready = Promise.all([
  settingsReady,
  document.fonts.load('80px "Runiga"'),
  document.fonts.load('40px "Runethia"'),
  document.fonts.load('30px "Orange Avenue"'),
  document.fonts.load('500 30px "DM Sans"'),
]).catch(() => {});

// =========================================================
//  1. HOME
// =========================================================
function showDetails() {
  $("homeTitle").textContent  = $("introTitle").textContent  = CONFIG.TITLE;
  $("homeCouple").textContent = $("introCouple").textContent = CONFIG.COUPLE;
  $("sleeveDate").textContent = $("introDate").textContent   = CONFIG.DATE;

  // Monogram on the cover and the record: first letter of each name,
  // e.g. "Aisyah & Hakim", "Aisyah and Hakim", "Aisyah dan Hakim" -> A & H
  const initials = CONFIG.COUPLE.split(/\s*&\s*|\s+(?:and|dan)\s+/i)
    .map((n) => n.trim().charAt(0).toUpperCase()).filter(Boolean);
  document.querySelectorAll(".cdMono").forEach((el) => {
    const parts = [];
    initials.forEach((letter, i) => {
      if (i) {
        const amp = document.createElement("i");   // smaller "&" between the letters
        amp.textContent = "&";
        parts.push(amp);
      }
      parts.push(letter);
    });
    el.replaceChildren(...parts);
  });
  document.body.classList.add("detailsReady");   // fade the text in (no flash of old names)
}

$("homeStart").addEventListener("click", () => show("layout"));
$("homeGallery").addEventListener("click", () => show("gallery"));

// =========================================================
//  Waveform under the record: bars that move with the music.
//  Bass in the middle, treble towards the edges, mirrored.
//  Only drawn while it's on screen (saves battery).
// =========================================================
const Wave = (() => {
  const canvas = $("wave");
  const ctx = canvas.getContext("2d");
  const HALF = 16;                          // bars each side of the middle
  const bands = new Float32Array(HALF);     // loudness now
  const shown = new Float32Array(HALF);     // what's drawn: eases towards `bands`
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let color = "#c27c88";

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w) return false;   // not on screen
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      color = getComputedStyle(canvas).color;
    }
    return true;
  }

  // Songs on file:// pages can't be measured, so they get a gentle
  // made-up motion instead
  function madeUp(t) {
    for (let i = 0; i < HALF; i++) {
      const v = 0.35 + 0.22 * Math.sin(t / 260 + i * 0.9) + 0.14 * Math.sin(t / 170 - i * 1.7);
      bands[i] = Math.max(0, v * (1 - (i / HALF) * 0.5));
    }
  }

  function paint() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const n = HALF * 2, gap = w / n, bar = Math.max(2, gap * 0.42);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    for (let k = 0; k < n; k++) {
      const i = k < HALF ? HALF - 1 - k : k - HALF;     // mirrored: bass in the middle
      const bh = Math.max(bar, Math.min(1, shown[i]) * h);   // never smaller than a dot
      ctx.globalAlpha = 0.4 + 0.6 * (1 - Math.abs(k - (n - 1) / 2) / (n / 2));   // softer at the edges
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(gap * k + (gap - bar) / 2, (h - bh) / 2, bar, bh, bar / 2);
      else ctx.rect(gap * k + (gap - bar) / 2, (h - bh) / 2, bar, bh);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const visible = () => $("home").classList.contains("active") && !document.hidden && !still.matches;

  // The record turns like a turntable: spins up when the music starts and
  // slows to a stop when it ends, and glows / swells a little on the bass
  const player = $("cdPlayer"), record = $("cd");
  const RPM = 360 / 3.2;   // degrees per second at full speed
  let angle = 0, speed = 0, beat = 0, last = 0;

  function turn(t, on) {
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0.016;
    last = t;
    speed += ((on ? RPM : 0) - speed) * (1 - Math.exp(-dt * (on ? 2.2 : 1.4)));
    angle = (angle + speed * dt) % 360;
    record.style.rotate = angle.toFixed(2) + "deg";
    const bass = Math.min(1, (bands[0] + bands[1] + bands[2]) / 3);
    const target = on ? 0.35 + 0.65 * bass : 0;
    beat += (target - beat) * (target > beat ? 0.5 : 0.1);
    player.style.setProperty("--beat", beat.toFixed(3));
    return speed > 0.5 || beat > 0.005;
  }

  function draw(t) {
    frame = 0;
    if (!size()) return;
    const on = document.body.classList.contains("musicOn");
    if (!on) bands.fill(0);
    else if (!Sound.levels(bands)) madeUp(t);
    let moving = turn(t, on);
    for (let i = 0; i < HALF; i++) {
      // jump up with the beat, fall back slowly
      shown[i] += (bands[i] - shown[i]) * (bands[i] > shown[i] ? 0.55 : 0.12);
      if (shown[i] > 0.003) moving = true;
    }
    paint();
    if (moving && visible()) frame = requestAnimationFrame(draw);
    else last = 0;
  }

  // Called whenever something that matters changes (music on/off, screen)
  function start() {
    if (frame) return;
    if (visible()) frame = requestAnimationFrame(draw);
    else if (size()) paint();   // reduced motion: still bars
  }

  window.addEventListener("resize", () => { canvas.width = 0; start(); });
  start();
  return { start };
})();

// Music starts every time the app is opened, on the guest's first tap
// anywhere. (Browsers don't allow sound before the user touches the page,
// so this is the earliest possible.) Stopping it only lasts for this visit.
const FIRST_TAP = ["click", "keydown"];
localStorage.removeItem("weddingsnap.music");   // old "music off" memory from earlier versions

function firstTap(e) {
  FIRST_TAP.forEach((t) => document.removeEventListener(t, firstTap, true));
  Sound.unlock();
  if (e.target.closest && e.target.closest("#musicBtn, #cdPlayer")) return;   // they handle themselves
  if (!Sound.playing) setMusicUI(Sound.toggle());
}
FIRST_TAP.forEach((t) => document.addEventListener(t, firstTap, true));

// Music the moment the app opens. If the browser blocks sound until the
// first tap (all phones do), show the welcome cover so that tap comes first.
Sound.preload();   // start downloading the first chorus now, so it plays right after the tap
if (Sound.canAutoplay()) setMusicUI(Sound.toggle());
else $("intro").classList.remove("hidden");
function closeIntro() {
  // firstTap (above) has already started the music by now
  $("intro").classList.add("leaving");
  setTimeout(() => $("intro").classList.add("hidden"), 700);
}
$("intro").addEventListener("click", closeIntro);
$("intro").addEventListener("keydown", closeIntro);

// body.musicOn makes the CDs spin (see style.css)
function setMusicUI(on) {
  document.body.classList.toggle("musicOn", on);
  $("npState").textContent = on ? "Now playing" : "Tap the record for music";
  if (!on) $("npTitle").innerHTML = "&nbsp;";
  Wave.start();
}

function toggleMusic() {
  setMusicUI(Sound.toggle());
}
$("musicBtn").addEventListener("click", toggleMusic);
$("cdPlayer").addEventListener("click", toggleMusic);

// New song: show its name under the CD, its cover art (music/<song>.jpg) on
// the CD, and a "♪ Song" toast on other screens (not while posing in the booth)
window.addEventListener("songchange", (e) => {
  const { name, cover } = e.detail;
  $("npTitle").textContent = name;
  document.body.style.setProperty("--cover", cover ? `url("${encodeURI(cover)}")` : "none");
  document.body.classList.toggle("hasCover", !!cover);
  if (!$("home").classList.contains("active") && !$("booth").classList.contains("active")) toast("♪ " + name);
});

// =========================================================
//  2. LAYOUT PICKER
// =========================================================
// Layout cards, grouped (Strips / Single photo / Grids & collage), each
// group 3 across. They flow in one after another; the last one picked is
// highlighted when the guest comes back.
const LAYOUT_GROUPS = ["Strips", "Single photo", "Grids & collage"];

function buildLayoutCards() {
  const grid = $("layoutGrid");
  grid.innerHTML = "";
  const entries = Object.entries(LAYOUTS);
  const groups = [...new Set([...LAYOUT_GROUPS, ...entries.map(([, l]) => l.group || "More")])];
  let n = 0;
  groups.forEach((group) => {
    const inGroup = entries.filter(([, l]) => (l.group || "More") === group);
    if (!inGroup.length) return;
    const head = document.createElement("h3");
    head.className = "layoutGroup";
    head.textContent = group;
    head.style.setProperty("--i", n++);
    grid.appendChild(head);
    inGroup.forEach(([id, l]) => grid.appendChild(layoutCard(id, l, n++)));
  });
}

function layoutCard(id, l, i) {
  const card = document.createElement("button");
  card.className = "layoutCard";
  card.dataset.id = id;
  card.style.setProperty("--i", i);

  // Mini drawing of the layout, using the real slot positions as %
  const mini = document.createElement("div");
  mini.className = "mini";
  mini.style.aspectRatio = l.width + " / " + l.height;
  l.slots.forEach((s) => {
    const box = document.createElement("i");
    box.style.left   = (s.x / l.width  * 100) + "%";
    box.style.top    = (s.y / l.height * 100) + "%";
    box.style.width  = (s.w / l.width  * 100) + "%";
    box.style.height = (s.h / l.height * 100) + "%";
    mini.appendChild(box);
  });

  card.appendChild(mini);
  card.insertAdjacentHTML("beforeend", `<b>${l.name}</b><small>${l.hint}</small>`);
  card.addEventListener("click", () => { tick(); chooseLayout(id); });
  return card;
}

function chooseLayout(id) {
  state.layoutId = id;
  // highlighted when they come back to this screen
  document.querySelectorAll(".layoutCard").forEach((c) => c.classList.toggle("selected", c.dataset.id === id));
  resetShots();
  show("booth");
}

function resetShots() {
  state.clips = layout().slots.map(() => null);   // the live moment of each photo
  state.motion = false;                            // Still by default
  state.frame = null;
  state.shots = layout().slots.map(() => null);
  state.current = 0;
  state.retakeOne = false;
}

// =========================================================
//  3. BOOTH
// =========================================================
const video = $("camera");
const viewfinder = $("viewfinder");
let wakeLock = null;

async function startCamera() {
  fitViewfinder();
  video.style.filter = filterToCss(filter());
  buildLiveFilters();
  renderBooth();

  if (state.stream) return;
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = state.stream;
    video.classList.toggle("mirror", state.facing === "user");
    $("camError").classList.add("hidden");
    $("shutterBtn").disabled = false;
  } catch (err) {
    console.warn(err);
    showCamError(err);
    $("shutterBtn").disabled = true;
  }

  // Keep the screen awake while in the booth
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (e) {}
}

// Tell the guest exactly why the camera didn't start and how to fix it.
// (Phones never show the "Allow camera?" question on http:// pages or
// inside WhatsApp / Instagram browsers - they just refuse.)
function showCamError(err) {
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const inApp = /FBAN|FBAV|Instagram|Line\/|LinkedInApp|WhatsApp|TikTok|Snapchat|; wv\)/i.test(navigator.userAgent);
  const browser = iOS ? "Safari" : "Chrome";
  let title = "Camera not available", help;

  if (!window.isSecureContext) {
    title = "Camera blocked on this link";
    help = "Phones only allow the camera on https:// links. Open the https:// link of this site instead.";
  } else if (inApp || !navigator.mediaDevices) {
    title = "Open in " + browser;
    help = iOS ? "This app's browser can't use the camera. Tap ⋯ or the share icon → Open in Safari."
               : "This app's browser can't use the camera. Tap ⋮ → Open in Chrome.";
  } else if (err && err.name === "NotAllowedError") {
    title = "Camera access is off";
    help = iOS ? "Tap aA in the address bar → Website Settings → Camera → Allow, then Try again. " +
                 "Still nothing? iPhone Settings → Safari → Camera → Ask."
               : "Tap the icon left of the web address → Permissions → Camera → Allow, then Try again. " +
                 "Still nothing? Phone Settings → Apps → Chrome → Permissions → Camera → Allow.";
  } else if (err && err.name === "NotFoundError") {
    help = "No camera found on this device.";
  } else if (err && err.name === "NotReadableError") {
    help = "Another app is using the camera. Close it, then Try again.";
  } else {
    help = "Something stopped the camera. Try again, or use a photo from your gallery.";
  }
  $("camErrTitle").textContent = title;
  $("camErrHelp").textContent = help + " You can also choose photos from your gallery.";
  $("camError").classList.remove("hidden");
}

$("camRetry").addEventListener("click", () => {
  $("camError").classList.add("hidden");
  startCamera();
});

function stopCamera() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  video.srcObject = null;
  wakeLock?.release?.();
  wakeLock = null;
}

// Header text + the little dots that show which shots are done
// Live preview has the same shape as the photo window being filled
function fitViewfinder() {
  const s = slotNow();
  viewfinder.style.aspectRatio = s.w + " / " + s.h;
  viewfinder.style.setProperty("--ar", s.w / s.h);
}

function renderBooth() {
  fitViewfinder();
  const total = state.shots.length;
  $("boothTitle").textContent = state.retakeOne
    ? "Retake photo " + (state.current + 1)
    : total === 1 ? "Strike a pose" : "Shot " + (state.current + 1) + " of " + total;

  const dots = $("slotDots");
  dots.innerHTML = "";
  if (total > 1) {
    state.shots.forEach((shot, i) => {
      const d = document.createElement("span");
      d.className = "dot" + (shot ? " done" : "") + (i === state.current ? " now" : "");
      if (shot) {
        const thumb = document.createElement("canvas");
        thumb.width = 60; thumb.height = 60;
        drawCover(thumb.getContext("2d"), shot, 0, 0, 60, 60);
        d.appendChild(thumb);
      } else {
        d.textContent = i + 1;
      }
      dots.appendChild(d);
    });
  }
  $("timerBtn").textContent = state.timer + "s";
  $("shutterBtn").classList.toggle("busy", state.busy);

  // Say what the shutter will do, so nobody has to guess
  const left = state.shots.filter((s) => !s).length;
  $("boothHint").textContent = state.busy ? ""
    : state.retakeOne ? `Tap the shutter to retake this photo (${state.timer}s countdown)`
    : left > 1 ? `Tap the shutter: ${left} photos, ${state.timer}s countdown before each`
    : `Tap the shutter: ${state.timer}s countdown`;
}

// Live filter chips in the booth
function buildLiveFilters() {
  const wrap = $("liveFilters");
  wrap.innerHTML = "";
  FILTERS.forEach((f) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (f.id === state.filterId ? " selected" : "");
    chip.textContent = f.name;
    chip.addEventListener("click", () => {
      state.filterId = f.id;
      video.style.filter = filterToCss(f);
      wrap.querySelectorAll(".chip").forEach((c) => c.classList.toggle("selected", c === chip));
    });
    wrap.appendChild(chip);
  });
}

// Grab the current camera frame, cropped to the slot shape.
// Stored WITHOUT filter so the guest can still change it later.
function capture(long = 1400) {   // 1400 px: enough detail for printing, small enough to upload
  const s = slotNow();
  const w = s.w >= s.h ? long : Math.round(long * s.w / s.h);
  const h = s.w >= s.h ? Math.round(long * s.h / s.w) : long;

  const shot = document.createElement("canvas");
  shot.width = w;
  shot.height = h;
  const sctx = shot.getContext("2d");
  if (state.facing === "user") {   // mirror, like looking in a mirror
    sctx.translate(w, 0);
    sctx.scale(-1, 1);
  }
  drawCover(sctx, video, 0, 0, w, h);
  return shot;
}

function flash() {
  const f = $("flash");
  f.style.transition = "none";
  f.style.opacity = 1;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    f.style.transition = "opacity 0.5s ease-out";
    f.style.opacity = 0;
  }));
}

// 3... 2... 1... Returns false if it was cancelled
async function runCountdown(runId) {
  const box = $("countdown");
  const num = $("countNum");
  box.classList.add("show");
  for (let n = state.timer; n > 0; n--) {
    if (runId !== state.runId) { box.classList.remove("show"); return false; }
    num.textContent = n;
    $("countHint").textContent = n === 1 ? "Smile!" : "Get ready";
    num.classList.remove("pop");
    void num.offsetWidth;          // restart the CSS animation
    num.classList.add("pop");
    Sound.beep(false);
    await wait(1000);
  }
  box.classList.remove("show");
  return runId === state.runId;
}

// ---------- Live photos ----------
// Like a real photobooth's "live view": while the countdown runs, the
// camera quietly records what's happening (up to the last 4 seconds), and
// the click adds the snap itself. On the edit screen the guest picks Still
// (a JPG, the default) or Live: a GIF where every photo plays forwards
// through its countdown, lands on the snap and holds there for a moment,
// then starts again.
const LIVE_SECONDS = 4;        // at most this much before each click
const LIVE_GAP = 125;          // ms between frames (8 a second)
const LIVE_HOLD = 1500;        // the snap stays on screen this long
const GIF_PIXELS = 300000;     // GIF size budget (width × height)
const GIF_MAX_BYTES = 7 * 1024 * 1024;   // the album takes up to 8 MB

// How big the GIF is, and how big each live frame needs to be for it
function gifSize(g = layout(), budget = GIF_PIXELS) {
  const scale = Math.min(1, Math.sqrt(budget / (g.width * g.height)));
  return { W: Math.round(g.width * scale), H: Math.round(g.height * scale), scale };
}
const liveLong = (s) => Math.min(640, Math.max(240, Math.round(Math.max(s.w, s.h) * gifSize().scale * 1.5)));

// Starts with the countdown; records its last few seconds, up to the click
async function recordLive(runId) {
  const seconds = Math.min(state.timer, LIVE_SECONDS);
  await wait((state.timer - seconds) * 1000);
  if (runId !== state.runId) return null;
  const long = liveLong(slotNow());
  const frames = [];
  const count = Math.round((seconds * 1000) / LIVE_GAP) - 1;   // the snap is the last one
  document.body.classList.add("liveRec");
  const t0 = performance.now();
  for (let k = 0; k < count && runId === state.runId; k++) {
    frames.push(capture(long));
    // keep to the beat even if a frame was slow to grab
    await wait(Math.max(0, t0 + (k + 1) * LIVE_GAP - performance.now()));
  }
  document.body.classList.remove("liveRec");
  return runId === state.runId ? frames : null;
}

// The snap, made small to end the clip
function shrink(canvas, long) {
  const k = long / Math.max(canvas.width, canvas.height);
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

const hasLive = () => state.clips.some(Boolean);
const liveOn = () => state.motion && hasLive();
// All photos play together; one that's shorter (e.g. retaken with a
// shorter timer) waits on its snap until the others catch up
const liveLength = () => Math.max(...state.clips.filter(Boolean).map((c) => c.length));

// Which picture to draw in slot i: in Live, frame `state.frame`
function shotAt(i) {
  const clip = state.clips[i];
  if (!liveOn() || state.frame === null || !clip) return state.shots[i];
  return clip[Math.min(state.frame, clip.length - 1)];
}

// The edit preview plays it like the GIF: forwards, hold on the snap, again
let clipTimer = null;
function playClip() {
  stopClip();
  if (!liveOn() || current !== "edit") return;
  state.frame = 0;
  const next = () => {
    const last = state.frame >= liveLength() - 1;
    clipTimer = setTimeout(() => {
      state.frame = last ? 0 : state.frame + 1;
      compose(preview);
      next();
    }, last ? LIVE_HOLD : LIVE_GAP);
  };
  compose(preview);
  next();
}
function stopClip() {
  clearTimeout(clipTimer);
  clipTimer = null;
  state.frame = null;
}

// Still / Live switch on the edit screen
function setMotion(on) {
  state.motion = on;
  document.querySelectorAll(".motionOpt").forEach((o) => {
    const sel = (o.dataset.motion === "live") === on;
    o.classList.toggle("selected", sel);
    o.setAttribute("aria-checked", sel);
  });
  $("doneBtn").dataset.live = on ? "1" : "";
  if (on) playClip();
  else { stopClip(); compose(preview); }
}
document.querySelectorAll(".motionOpt").forEach((o) => o.addEventListener("click", () => {
  tick();
  setMotion(o.dataset.motion === "live");
}));

// The whole print as a GIF: every photo plays forwards, holds on the
// snap, then the GIF starts again. Made smaller if it would be too big
// for the album.
async function makeGif() {
  stopClip();
  for (const budget of [GIF_PIXELS, GIF_PIXELS * 0.6, GIF_PIXELS * 0.35]) {
    const blob = await encodeGif(budget);
    if (blob.size <= GIF_MAX_BYTES) return blob;
  }
  return encodeGif(GIF_PIXELS * 0.2);
}

async function encodeGif(budget) {
  const g = layout();
  const { W, H } = gifSize(g, budget);
  const full = document.createElement("canvas");
  const small = document.createElement("canvas");
  small.width = W; small.height = H;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  const gif = gifenc.GIFEncoder();
  const frames = liveLength();
  let palette = null;
  for (let k = 0; k < frames; k++) {
    state.frame = k;
    compose(full);
    sctx.drawImage(full, 0, 0, W, H);
    const rgba = sctx.getImageData(0, 0, W, H).data;
    // one set of colours for every frame (taken from the snap), so the
    // paper doesn't flicker
    if (!palette) {
      state.frame = frames - 1;
      compose(full);
      const snap = document.createElement("canvas");
      snap.width = W; snap.height = H;
      snap.getContext("2d").drawImage(full, 0, 0, W, H);
      palette = gifenc.quantize(snap.getContext("2d").getImageData(0, 0, W, H).data, 256);
      state.frame = k;
    }
    gif.writeFrame(gifenc.applyPalette(rgba, palette), W, H, { palette, delay: k === frames - 1 ? LIVE_HOLD : LIVE_GAP });
    await wait(0);   // let the page breathe
  }
  gif.finish();
  state.frame = null;
  return new Blob([gif.bytes()], { type: "image/gif" });
}

// Shutter: shoot every empty slot in a row (or just one when retaking)
$("shutterBtn").addEventListener("click", async () => {
  if (state.busy || !state.stream) return;
  state.busy = true;
  const runId = ++state.runId;
  Sound.duck(true);
  renderBooth();

  const todo = state.retakeOne
    ? [state.current]
    : state.shots.map((s, i) => (s ? null : i)).filter((i) => i !== null);

  for (let k = 0; k < todo.length; k++) {
    state.current = todo[k];
    renderBooth();
    const live = recordLive(runId);   // the live view during the countdown
    if (!(await runCountdown(runId))) return;

    const i = state.current;
    state.shots[i] = capture();
    Sound.shutter();
    live.then((frames) => { if (frames) state.clips[i] = [...frames, shrink(state.shots[i], liveLong(layout().slots[i]))]; });
    flash();
    navigator.vibrate?.(25);
    renderBooth();

    if (k < todo.length - 1) await wait(CONFIG.POSE_PAUSE);
    if (runId !== state.runId) return;
  }

  state.busy = false;
  Sound.duck(false);
  await wait(200);   // the last live recording finishes
  goToEdit();
});

// Pick a photo from the phone gallery for the current slot
$("pickFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const s = slotNow();
    const shot = document.createElement("canvas");
    shot.width = 1400;
    shot.height = Math.round(1400 * s.h / s.w);
    drawCover(shot.getContext("2d"), img, 0, 0, shot.width, shot.height);
    URL.revokeObjectURL(img.src);

    state.shots[state.current] = shot;
    state.clips[state.current] = null;   // a picked photo has no moment: stays still in Live
    const nextEmpty = state.shots.findIndex((x) => !x);
    if (state.retakeOne || nextEmpty === -1) goToEdit();
    else { state.current = nextEmpty; renderBooth(); }
  };
  img.src = URL.createObjectURL(file);
});

$("timerBtn").addEventListener("click", () => {
  const i = CONFIG.TIMERS.indexOf(state.timer);
  state.timer = CONFIG.TIMERS[(i + 1) % CONFIG.TIMERS.length];
  renderBooth();
});

$("flipBtn").addEventListener("click", () => {
  if (state.busy) return;
  state.facing = state.facing === "user" ? "environment" : "user";
  stopCamera();
  startCamera();
});

function cancelCountdown() {
  state.runId++;
  state.busy = false;
  Sound.duck(false);
  $("countdown").classList.remove("show", "rec");
  $("viewfinder").classList.remove("rec");
  renderBooth();
}

// Phone locked / switched apps while in the booth: free the camera, and
// turn it back on (with the keep-awake lock) when the guest returns
document.addEventListener("visibilitychange", () => {
  if (current !== "booth") return;
  if (document.hidden) {
    if (state.busy) cancelCountdown();
    stopCamera();
  } else {
    startCamera();
  }
});

$("boothBack").addEventListener("click", () => {
  if (state.busy) { cancelCountdown(); return; }
  if (state.retakeOne) { state.retakeOne = false; show("edit"); return; }
  show("layout");
});

// =========================================================
//  4. EDIT  (frame + filter, tap to retake)
// =========================================================
const preview = $("preview");

// Filtering is slow-ish, so remember results per shot + filter
const filterCache = new WeakMap();
function filtered(shot, f) {
  if (!filterCache.has(shot)) filterCache.set(shot, {});
  const c = filterCache.get(shot);
  return c[f.id] || (c[f.id] = applyFilter(shot, f));
}

// Draw the full photo (frame + photos + text) onto `canvas`
// The print: paper colour → photos → effect → wedding details.
// Every print has this same design; guests choose colour, effect, filter.
function compose(canvas, f = filter()) {
  const g = layout();
  const c = colour();
  canvas.width = g.width;
  canvas.height = g.height;
  const ctx = canvas.getContext("2d");
  Effects.paper(ctx, g.width, g.height, c);   // plain, gradient or pattern
  drawPhotos(ctx, g, f);
  Effects.apply(ctx, g, state.effectId, c, state.layoutId);
  drawFooter(ctx, g, c);
}

function drawPhotos(ctx, g, f) {
  g.slots.forEach((slot, i) => {
    const shot = shotAt(i);   // the still, or a frame of its live moment
    ctx.save();
    roundRect(ctx, slot.x, slot.y, slot.w, slot.h, slot.r || 0);
    ctx.clip();
    if (shot) {
      drawCover(ctx, filtered(shot, f), slot.x, slot.y, slot.w, slot.h);
    } else {
      ctx.fillStyle = "rgba(127,127,127,0.25)";
      ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
    }
    ctx.restore();
  });
}

// Title, a thin line, the couple's names and the date, centred in the
// space under the photos. Sizes come from admin (CONFIG.TEXT_SIZE); if
// they're too big for the space, everything shrinks together.
function drawFooter(ctx, g, c) {
  const bottom = Math.max(...g.slots.map((s) => s.y + s.h));
  const space = g.height - bottom;
  const cx = g.width / 2;
  const maxW = g.width * 0.84;
  const unit = Math.min(g.width * 0.105, space * 0.34);
  const pct = (key) => (CONFIG.TEXT_SIZE[key] || 100) / 100;

  let title = unit * 0.86 * pct("title");
  let couple = unit * 0.5 * pct("couple");
  let date = unit * 0.3 * pct("date");
  let gap = unit * 0.2;
  const total = () => title * 1.15 + gap * 2 + couple * 1.3 + date * 1.45;
  const fit = Math.min(1, (space * 0.86) / total());
  title *= fit; couple *= fit; date *= fit; gap *= fit;

  let y = bottom + (space - total()) / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Patterned paper: a soft label behind the text so it stays easy to read
  if (c.pattern) {
    const pad = unit * 0.35;
    ctx.save();
    ctx.fillStyle = c.bg;
    ctx.globalAlpha = 0.92;
    ctx.shadowColor = "rgba(0,0,0,0.08)";
    ctx.shadowBlur = pad;
    roundRect(ctx, g.width * 0.06, y - pad, g.width * 0.88, total() + pad * 2, pad * 1.2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = c.text;
  fitText(ctx, CONFIG.TITLE, cx, y + title * 0.6, maxW, Math.round(title), '400 {size} "Runiga", Georgia, serif');
  y += title * 1.15 + gap;

  // thin divider line
  ctx.strokeStyle = c.sub;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = Math.max(1, g.width / 540);
  ctx.beginPath();
  ctx.moveTo(cx - g.width * 0.06, y);
  ctx.lineTo(cx + g.width * 0.06, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  y += gap;

  ctx.fillStyle = c.sub;
  fitText(ctx, CONFIG.COUPLE, cx, y + couple * 0.65, maxW, Math.round(couple), '400 {size} "Runethia", Georgia, serif');
  y += couple * 1.3;
  fitText(ctx, CONFIG.DATE, cx, y + date * 0.72, maxW, Math.round(date), '400 {size} "Orange Avenue", Georgia, serif');
}

async function goToEdit() {
  state.retakeOne = false;
  state.current = 0;
  await ready;
  buildColourChips();
  buildEffectChips();
  buildFilterChips();
  // Still / Live: only offered when the photos have a live moment
  $("motionToggle").classList.toggle("hidden", !hasLive());
  setMotion(state.motion && hasLive());
  show("edit");
  playClip();
}

// Colour, Effects and Filter each have a tab, so the screen stays tidy
document.querySelectorAll(".editTab").forEach((tab) => tab.addEventListener("click", () => {
  const tabs = [...document.querySelectorAll(".editTab")];
  const from = tabs.findIndex((t) => t.classList.contains("active")), to = tabs.indexOf(tab);
  if (from === to) return;
  tick();
  document.querySelectorAll(".pane").forEach((p) => p.style.setProperty("--from", (to > from ? 18 : -18) + "px"));
  tabs.forEach((t) => {
    t.classList.toggle("active", t === tab);
    t.setAttribute("aria-selected", t === tab);
  });
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== tab.dataset.pane));
}));

function selectChip(wrap, chip) {
  tick();
  wrap.querySelectorAll(".swatch").forEach((c) => c.classList.toggle("selected", c === chip));
}
// Chips flow in one after another (only the first few wait - the rest are off screen)
const flowIn = (el, i) => el.style.setProperty("--i", Math.min(i, 8));

function buildColourChips() {
  const wrap = $("colourChips");
  wrap.innerHTML = "";
  COLOURS.forEach((c, i) => {
    const chip = document.createElement("button");
    chip.className = "swatch colour" + (c.id === state.colourId ? " selected" : "");
    flowIn(chip, i);
    chip.setAttribute("aria-label", c.name);
    const dot = document.createElement("canvas");   // the real paper: gradient / pattern too
    dot.width = dot.height = 88;
    Effects.paper(dot.getContext("2d"), 88, 88, c);
    chip.appendChild(dot);
    chip.insertAdjacentHTML("beforeend", `<small>${c.name}</small>`);
    chip.addEventListener("click", () => {
      state.colourId = c.id;
      selectChip(wrap, chip);
      buildEffectChips();   // effect previews use the paper colour
      compose(preview);
    });
    wrap.appendChild(chip);
  });
}

// Effect chips: a little card in the chosen colour with the effect on it
function buildEffectChips() {
  const wrap = $("effectChips");
  wrap.innerHTML = "";
  const c = colour();
  EFFECTS.forEach((ef, i) => {
    const chip = document.createElement("button");
    chip.className = "swatch" + (ef.id === state.effectId ? " selected" : "");
    flowIn(chip, i);
    const thumb = document.createElement("canvas");
    thumb.width = thumb.height = 120;
    const ctx = thumb.getContext("2d");
    Effects.paper(ctx, 120, 120, c);
    const g = { width: 120, height: 120, slots: [{ x: 22, y: 18, w: 76, h: 64 }] };
    if (state.shots[0]) drawCover(ctx, state.shots[0], 22, 18, 76, 64);
    Effects.apply(ctx, g, ef.id, c, "thumb", 13);
    chip.appendChild(thumb);
    chip.insertAdjacentHTML("beforeend", `<small>${ef.name}</small>`);
    chip.addEventListener("click", () => {
      state.effectId = ef.id;
      selectChip(wrap, chip);
      compose(preview);
    });
    wrap.appendChild(chip);
  });
}

// Filter chips show a tiny preview of photo 1 with that filter
function buildFilterChips() {
  const wrap = $("filterChips");
  wrap.innerHTML = "";
  const small = document.createElement("canvas");
  small.width = 96; small.height = 96;
  drawCover(small.getContext("2d"), state.shots[0], 0, 0, 96, 96);

  FILTERS.forEach((f, i) => {
    const chip = document.createElement("button");
    chip.className = "swatch" + (f.id === state.filterId ? " selected" : "");
    flowIn(chip, i);
    const thumb = applyFilter(small, f);
    chip.appendChild(thumb);
    chip.insertAdjacentHTML("beforeend", `<small>${f.name}</small>`);
    chip.addEventListener("click", () => {
      state.filterId = f.id;
      selectChip(wrap, chip);
      compose(preview);
    });
    wrap.appendChild(chip);
  });
}

// Tap a photo on the preview → retake just that one
preview.addEventListener("click", (e) => {
  const rect = preview.getBoundingClientRect();
  const x = (e.clientX - rect.left) * preview.width / rect.width;
  const y = (e.clientY - rect.top) * preview.height / rect.height;
  const i = layout().slots.findIndex((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
  if (i === -1) return;
  state.current = i;
  state.retakeOne = true;
  show("booth");
});

$("editBack").addEventListener("click", async () => {
  if (!(await ask("Retake all photos? The ones you took will be cleared.", "Retake all"))) return;
  resetShots();
  show("booth");
});

// Public = album + everyone's gallery. Private = only on this phone.
state.privacy = "public";
document.querySelectorAll(".privOpt").forEach((opt) => opt.addEventListener("click", () => {
  state.privacy = opt.dataset.privacy;
  document.querySelectorAll(".privOpt").forEach((o) => {
    o.classList.toggle("selected", o === opt);
    o.setAttribute("aria-checked", o === opt);
  });
  const pub = state.privacy === "public";
  $("doneBtn").textContent = pub ? "Done · Share to album" : "Done · Keep private";
  $("privHint").textContent = pub ? "Goes to the couple's album and everyone's gallery"
                                  : "Not uploaded. Only you can see it, on this phone";
}));

$("doneBtn").addEventListener("click", async () => {
  // Sharing: ask for a wish (ucapan) for the couple first - optional
  let wish = {};
  if (state.privacy === "public" && CONFIG.SCRIPT_URL) {
    wish = await askWish();
    if (!wish) return;   // closed the card: stay here
  }
  $("doneBtn").disabled = true;
  stopCamera();

  // Always the sharp still (JPG). A Live photo also gets its GIF: the album
  // plays the GIF, but shows and saves the sharp still too.
  const wantLive = liveOn();
  stopClip();
  const out = document.createElement("canvas");
  compose(out);
  const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", 0.9));
  const dataUrl = out.toDataURL("image/jpeg", 0.88);
  let live = null;
  if (wantLive) {
    const label = $("doneBtn").textContent;
    $("doneBtn").textContent = "Making your live photo…";
    live = await makeGif();
    $("doneBtn").textContent = label;
  }
  if (state.final) [state.final.url, state.final.liveUrl].forEach((u) => u && URL.revokeObjectURL(u));
  state.final = { blob, url: URL.createObjectURL(blob), dataUrl, live, liveUrl: live && URL.createObjectURL(live) };

  $("resultImg").src = state.final.liveUrl || state.final.url;
  $("resultLive").classList.toggle("hidden", !live);
  $("doneBtn").disabled = false;
  show("result");
  if (state.privacy === "private") keepPrivate();
  else upload(wish);
});

// ---------- Wish card (ucapan) ----------
const NAME_KEY = "weddingsnap.name";   // remembered for their next photo
let wishDone = null;

// Resolves { name, wish } (both may be empty) or null if they closed it
function askWish() {
  if (wishDone) wishDone(null);
  return new Promise((resolve) => {
    $("wishCouple").textContent = CONFIG.COUPLE;
    $("wishName").value = localStorage.getItem(NAME_KEY) || "";
    $("wishText").value = "";
    countWish();
    $("wishSheet").classList.remove("hidden");
    wishDone = (answer) => {
      wishDone = null;
      $("wishSheet").classList.add("hidden");
      if (document.activeElement) document.activeElement.blur();   // put the keyboard away
      resolve(answer);
    };
  });
}
function countWish() {
  $("wishCount").textContent = $("wishText").value.length + " / " + $("wishText").maxLength;
}
$("wishText").addEventListener("input", countWish);
$("wishForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("wishName").value.trim();
  const wish = $("wishText").value.trim();
  if (name) localStorage.setItem(NAME_KEY, name);
  if (wishDone) wishDone({ name, wish });
});
$("wishClose").addEventListener("click", () => wishDone && wishDone(null));
$("wishSheet").addEventListener("click", (e) => { if (e.target === $("wishSheet") && wishDone) wishDone(null); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && wishDone) wishDone(null); });

// =========================================================
//  5. RESULT  (upload + save)
// =========================================================
// Upload a JPEG (data: URL) to the Drive album, with its GIF for a Live
// photo. Returns the new photo's id.
// The token is the photo's own key: sending it again never makes a copy.
async function sendToAlbum(dataUrl, { token = randomToken(), wish = "", name = "", live = "" } = {}) {
  // text/plain body = no CORS preflight, which Apps Script can't answer
  const res = await fetch(CONFIG.SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "upload", image: dataUrl, live: live || undefined, token, wish, name }),
  });
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.error);
    err.server = true;   // the album answered "no" (not a connection problem)
    throw err;
  }
  Mine.add(data.id, token);
  return data.id;
}

// =========================================================
//  Sending in the background. A public photo is first saved on the
//  phone (Outbox), then sent. With a bad signal it stays there and is
//  tried again: after a few seconds (then longer and longer), when the
//  phone is back online, and when the app is opened again. Guests can
//  carry on taking photos meanwhile.
// =========================================================
async function queuePhoto(blob, { wish = "", name = "" } = {}, live = null) {
  const item = { id: randomToken(), blob, live, time: Date.now(), wish, name, tries: 0 };
  await Outbox.put(item);
  return item.id;
}

const Sender = (() => {
  let busy = null;
  let timer = null;
  let delay = 4000;

  // Send the oldest waiting photo, then the next... Stops at the first
  // failure. Returns true when the outbox is empty.
  async function run() {
    for (;;) {
      const items = (await Outbox.all()).sort((a, b) => a.time - b.time);
      if (!items.length) return true;
      const item = items[0];
      try {
        const id = await sendToAlbum(await blobToDataUrl(item.blob), {
          token: item.id, wish: item.wish, name: item.name,
          live: item.live ? await blobToDataUrl(item.live) : "",
        });
        await Outbox.remove(item.id);
        window.dispatchEvent(new CustomEvent("photosent", { detail: { token: item.id, id } }));
      } catch (err) {
        console.warn("Photo not sent yet:", err);
        // The album keeps refusing it (not a signal problem): keep it as a
        // private photo instead, so it's never lost and the queue moves on
        if (err.server && ++item.tries >= 3) {
          await Private.add(item.blob, item.live);
          await Outbox.remove(item.id);
          toast("A photo couldn't be shared. It's kept under Gallery → Mine.");
          continue;
        }
        await Outbox.put(item);
        return false;
      }
    }
  }

  function flush() {
    if (!CONFIG.SCRIPT_URL) return Promise.resolve(false);
    if (!busy) {
      clearTimeout(timer);
      busy = run().catch(() => false).then((done) => {
        busy = null;
        if (done) delay = 4000;
        else {
          timer = setTimeout(flush, delay);
          delay = Math.min(60000, delay * 2);
        }
        return done;
      });
    }
    return busy;
  }

  window.addEventListener("online", flush);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) flush(); });
  return { flush };
})();

const waitingFor = new Set();   // tokens the result screen is watching

// A photo arrived in the album. If it was waiting from earlier, say so.
window.addEventListener("photosent", (e) => {
  const { token } = e.detail;
  if (state.final && state.final.token === token && current === "result") showSent();
  if (!waitingFor.has(token)) toast("Your photo reached the album ✓");
  if (current === "gallery") loadGallery();
});

function showSent() {
  $("uploadStatus").className = "uploadStatus ok";
  $("uploadStatus").textContent = "Shared to the couple's album ✓";
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

async function keepPrivate() {
  const status = $("uploadStatus");
  status.className = "uploadStatus";
  try {
    state.final.privateId = await Private.add(state.final.blob, state.final.live);
    status.textContent = "Kept private. Only you can see it, under Gallery → Mine. Save it to your phone to keep it for good.";
  } catch (err) {
    console.warn(err);
    status.textContent = "Not shared. Save it to your phone below to keep it.";
  }
  $("makePublicBtn").classList.toggle("hidden", !CONFIG.SCRIPT_URL);
}

// Changed their mind on the result screen: share the private photo after all
$("makePublicBtn").addEventListener("click", async () => {
  const wish = await askWish();
  if (!wish) return;
  $("makePublicBtn").classList.add("hidden");
  const privateId = state.final.privateId;
  if (await upload(wish) && privateId) {
    Private.remove(privateId).catch(() => {});
    state.final.privateId = null;
  }
});

// Returns true once the photo is in the album, or safely waiting on the
// phone to be sent
async function upload(wish = {}) {
  const status = $("uploadStatus");
  $("makePublicBtn").classList.add("hidden");
  if (!CONFIG.SCRIPT_URL) {
    status.className = "uploadStatus";
    status.textContent = "The album isn't connected yet. Save it to your phone below.";
    return false;
  }
  status.className = "uploadStatus sending";
  status.textContent = "Sending to the couple's album…";

  let token;
  try {
    token = await queuePhoto(state.final.blob, wish, state.final.live);
  } catch (err) {
    // This browser can't store it (rare): send it straight away instead
    try {
      await sendToAlbum(state.final.dataUrl, { ...wish, live: state.final.live ? await blobToDataUrl(state.final.live) : "" });
      showSent();
      return true;
    } catch (e) {
      console.warn(e);
      status.className = "uploadStatus fail";
      status.innerHTML = 'Couldn\'t send (check your internet). <button class="btn link" id="retryUpload">Try again</button>';
      $("retryUpload").addEventListener("click", () => upload(wish));
      return false;
    }
  }

  state.final.token = token;
  waitingFor.add(token);
  await Sender.flush();
  waitingFor.delete(token);
  const stillWaiting = (await Outbox.all()).some((item) => item.id === token);
  if (!stillWaiting) {
    showSent();
  } else if (state.final.token === token) {
    status.className = "uploadStatus queued";
    status.textContent = "Saved on your phone. It will reach the album by itself when the signal is back - carry on snapping!";
  }
  return true;
}

// Phones: open the share sheet ("Save Image"). Computers: normal download.
async function saveFiles(blobs, name) {
  const files = blobs.map((b) => new File([b], name + (b.type === "image/gif" ? ".gif" : ".jpg"), { type: b.type || "image/jpeg" }));
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  files.forEach((f, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, i * 400));
}

// A Live photo can be saved as the sharp still, the moving GIF, or both.
// Resolves "still" | "live" | "both", or null if they closed it.
let saveDone = null;
function chooseSave(stillSrc, liveSrc) {
  if (saveDone) saveDone(null);
  return new Promise((resolve) => {
    $("saveStill").src = stillSrc;
    $("saveLive").removeAttribute("src");
    liveSrc.then((src) => { if (saveDone && src) $("saveLive").src = src; });
    $("saveSheet").classList.remove("hidden");
    saveDone = (kind) => {
      saveDone = null;
      $("saveSheet").classList.add("hidden");
      resolve(kind);
    };
  });
}
document.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => { tick(); saveDone && saveDone(b.dataset.save); }));
$("saveCancel").addEventListener("click", () => saveDone && saveDone(null));
$("saveSheet").addEventListener("click", (e) => { if (e.target === $("saveSheet") && saveDone) saveDone(null); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && saveDone) { e.stopImmediatePropagation(); saveDone(null); }   // not the viewer behind too
});

// Save a print: on this phone (blob = JPG, live = GIF) or in the album
// (id, live = the GIF's id). A Live photo asks which.
async function savePrint(p) {
  const local = !!p.blob;
  const liveId = !local && (p.live || (p.gif && p.id));
  const still = hasStill(p) && (local ? { blob: p.blob } : { id: p.id, blob: albumBlob(p.id) });
  const live = isLive(p) && (local ? { blob: p.live || p.blob } : { id: liveId, blob: albumBlob(liveId) });
  let picks = [still || live];
  if (still && live) {
    const kind = await chooseSave(local ? p.url : thumbUrl(p.id, 400), liveUrlOf(p).catch(() => null));
    if (!kind) return;
    picks = kind === "both" ? [still, live] : [kind === "live" ? live : still];
  }
  const name = "wedding-snap-" + (p.time || Date.now());
  if (picks.every((x) => x.blob)) return saveFiles(picks.map((x) => x.blob), name);
  // Not downloaded yet (or Drive wouldn't let us): Drive's own download
  picks.forEach((x) => window.open(`https://drive.google.com/uc?export=download&id=${x.id}`, "_blank"));
}

$("saveBtn").addEventListener("click", () => savePrint({ ...state.final, time: Date.now() }));

$("againBtn").addEventListener("click", () => {
  resetShots();
  show("layout");
});

// =========================================================
//  6. GALLERY
// =========================================================
let galleryPhotos = [];   // public photos in the Drive album { id, time, wish?, name? }
let privatePhotos = [];   // this phone's private photos { id, time, private, blob, url }
let pendingPhotos = [];   // shared, but still waiting on the phone to be sent { ..., pending }
let galleryList = [];     // the photos showing right now (Everyone or Mine)
let galleryTab = "all";
const thumbUrl = (id, size) => `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`;
const photoSrc = (p, size) => p.url || thumbUrl(p.id, size);
// the full GIF, so a live photo moves (Drive's thumbnails are stills)
const gifUrl = (id) => `https://drive.google.com/uc?export=view&id=${id}`;

// Live photos: a sharp JPG + its GIF (album: `live` = the GIF's id; on this
// phone: `live` = the GIF itself). Older live photos are a GIF only.
const gifOnly = (p) => p.blob ? p.blob.type === "image/gif" : !!p.gif;
const isLive = (p) => !!p.live || gifOnly(p);
const hasStill = (p) => !gifOnly(p);

// Album files exactly as they were uploaded. Drive's image server (lh3)
// hands over the original file and lets the page read it, so the viewer
// shows the full photo, a GIF can restart, and Save goes straight to the phone.
const albumFiles = new Map();   // Drive id → { blob, url, wait }
function albumFile(id, type) {
  let f = albumFiles.get(id);
  if (!f) {
    f = { blob: null, url: null };
    f.wait = fetch(`https://lh3.googleusercontent.com/d/${id}=d`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("HTTP " + r.status))))
      .then((b) => { f.blob = new Blob([b], { type }); f.url = URL.createObjectURL(f.blob); return f; })
      .catch((err) => { albumFiles.delete(id); throw err; });
    albumFiles.set(id, f);
    // keep only the latest few in memory
    if (albumFiles.size > 24) {
      const [oldId, old] = albumFiles.entries().next().value;
      albumFiles.delete(oldId);
      old.wait.then((o) => URL.revokeObjectURL(o.url), () => {});
    }
  }
  return f.wait;
}
const albumBlob = (id) => (albumFiles.get(id) || {}).blob || null;   // only if already here

// The moving GIF of a Live photo, as a URL an <img> can show
async function liveUrlOf(p) {
  if (p.blob) return p.liveUrl || (gifOnly(p) ? p.url : null);
  const id = p.live || (p.gif && p.id);
  if (!id) return null;
  try { return (await albumFile(id, "image/gif")).url; }
  catch (err) { return gifUrl(id); }
}

// Live photos move in the gallery while they're on screen. The sharp still
// shows until the GIF is here, and again once scrolled away (smoother phones).
const tilePhoto = new WeakMap();
const liveTiles = "IntersectionObserver" in window && new IntersectionObserver((entries) => entries.forEach(({ target: tile, isIntersecting: on }) => {
  const p = tilePhoto.get(tile);
  const img = tile.querySelector("img");
  tile.dataset.on = on ? "1" : "";
  if (!on) {
    const still = photoSrc(p, 500);
    if (img.src !== still) img.src = still;
    return;
  }
  liveUrlOf(p).then((url) => {
    if (!url) return;
    const gif = new Image();
    gif.onload = () => { if (tile.dataset.on) img.src = url; };
    gif.src = url;
  });
}), { rootMargin: "120px 0px" });

// Photos stored on this phone (private + waiting to send), shown under Mine
async function loadPrivate() {
  [...privatePhotos, ...pendingPhotos].forEach((p) => [p.url, p.liveUrl].forEach((u) => u && URL.revokeObjectURL(u)));
  const [priv, waiting] = await Promise.all([Private.all(), Outbox.all()]);
  const urls = (p) => ({ url: URL.createObjectURL(p.blob), liveUrl: p.live ? URL.createObjectURL(p.live) : null });
  privatePhotos = priv.map((p) => ({ ...p, private: true, ...urls(p) }));
  pendingPhotos = waiting.map((p) => ({ ...p, pending: true, ...urls(p) }));
}

async function loadGallery() {
  const msg = $("galleryMsg");
  await loadPrivate();
  if (!CONFIG.SCRIPT_URL) {
    galleryPhotos = [];
    renderGallery();
    return;
  }
  msg.classList.remove("count");
  msg.textContent = "Loading photos…";
  try {
    const res = await fetch(CONFIG.SCRIPT_URL + "?action=list");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    galleryPhotos = data.photos;
    renderGallery();
  } catch (err) {
    // No signal: still show what's on this phone (Mine), and say so
    console.warn(err);
    renderGallery();
    if (galleryTab === "all" || !galleryList.length) {
      msg.classList.remove("count");
      msg.textContent = "Can't reach the album right now (weak signal?). Tap ⟳ to try again.";
    }
  }
}

function renderGallery() {
  const mine = Mine.all();
  // Everyone = public album only. Mine = my public uploads + my private
  // photos + shared ones still waiting to be sent.
  const list = galleryTab === "mine"
    ? [...privatePhotos, ...pendingPhotos, ...galleryPhotos.filter((p) => mine[p.id])].sort((a, b) => b.time - a.time)
    : galleryPhotos;
  galleryList = list;
  $("galleryMsg").classList.toggle("count", list.length > 0);   // plain text, not a card
  $("galleryMsg").textContent = list.length
    ? list.length + (list.length === 1 ? " photo" : " photos")
    : galleryTab === "mine" ? "You haven't taken any photos yet."
    : !CONFIG.SCRIPT_URL ? "The shared album isn't connected yet. Your own photos are under Mine."
    : "No photos yet. Be the first to share one.";

  const grid = $("galleryGrid");
  if (liveTiles) liveTiles.disconnect();
  grid.innerHTML = "";
  list.forEach((p, i) => {
    const item = document.createElement("button");
    item.className = "tile" + (p.private ? " private" : p.pending ? " pending" : mine[p.id] ? " mine" : "") +
      (isLive(p) ? " live" : "");
    item.style.setProperty("--i", Math.min(i, 10));
    const img = document.createElement("img");
    img.loading = "lazy";
    img.onload = () => img.classList.add("loaded");   // fade in once it's here
    img.src = photoSrc(p, 500);
    img.alt = "";
    item.appendChild(img);
    if (!p.blob) item.appendChild(likeButton(p));   // album photos only
    if (p.wish) {
      const wish = document.createElement("span");
      wish.className = "tileWish";
      wish.textContent = "“" + p.wish + "”";
      item.appendChild(wish);
    }
    item.setAttribute("aria-label", "View " + (isLive(p) ? "live photo " : "photo ") + (i + 1));
    item.addEventListener("click", () => openLightbox(i, img));
    grid.appendChild(item);
    if (isLive(p) && hasStill(p) && liveTiles) { tilePhoto.set(item, p); liveTiles.observe(item); }
  });
}

// ---------- Likes ----------
// ♥ + count. Tapping it likes / un-likes (and doesn't open the photo).
function likeButton(p) {
  const btn = document.createElement("span");
  btn.className = "likeBtn";
  btn.setAttribute("role", "button");
  btn.dataset.id = p.id;
  btn.addEventListener("click", (e) => { e.stopPropagation(); toggleLike(p); });
  paintLike(btn, p);
  return btn;
}
function paintLike(btn, p) {
  const on = Likes.has(p.id);
  btn.classList.toggle("on", on);
  btn.textContent = (on ? "♥" : "♡") + (p.likes ? " " + p.likes : "");
  btn.setAttribute("aria-label", (on ? "Unlike" : "Like") + (p.likes ? ` (${p.likes} likes)` : ""));
}
function paintLikes(p) {
  document.querySelectorAll(`.likeBtn[data-id="${p.id}"]`).forEach((b) => paintLike(b, p));
}

// Shows straight away; quietly undone if it can't reach the album
async function toggleLike(p, forceOn) {
  const on = forceOn ?? !Likes.has(p.id);
  if (on === Likes.has(p.id)) return;
  tick();
  Likes.set(p.id, on);
  p.likes = Math.max(0, (p.likes || 0) + (on ? 1 : -1));
  paintLikes(p);
  try {
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "like", id: p.id, liker: Likes.me, on }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    p.likes = data.likes;   // the real count (others may have liked it too)
  } catch (err) {
    Likes.set(p.id, !on);
    p.likes = Math.max(0, p.likes + (on ? -1 : 1));
    toast("Couldn't like it right now - check your signal");
  }
  paintLikes(p);
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  galleryTab = tab.dataset.tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
  renderGallery();
}));
$("refreshBtn").addEventListener("click", loadGallery);

// ---------- Lightbox (full-screen viewer) ----------
let lbPhoto = null;
let lbIndex = 0;
const lb = $("lightbox");
const lbOpen = () => !lb.classList.contains("hidden");

// The viewer grows out of the photo that was tapped, and shrinks back into
// it when closed. `from` = the gallery picture.
let lbFrom = null;
let lbFromIndex = -1;   // which photo `lbFrom` shows

// Move/scale the big picture so it sits exactly over `el` (for the zoom)
function zoomFrames(el) {
  const a = el.getBoundingClientRect(), b = $("lbImg").getBoundingClientRect();
  if (!a.width || !b.width) return null;
  const dx = a.left + a.width / 2 - (b.left + b.width / 2);
  const dy = a.top + a.height / 2 - (b.top + b.height / 2);
  return [
    { transform: `translate(${dx}px, ${dy}px) scale(${a.width / b.width})`, borderRadius: "14px" },
    { transform: "none", borderRadius: "4px" },
  ];
}
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function openLightbox(i, from) {
  // An entry in the history, so the phone's Back button closes the viewer
  // instead of leaving the app
  if (!lbOpen()) history.pushState({ lightbox: true }, "");
  lb.classList.remove("hidden");
  showPhoto(i);
  lbFrom = from || null;
  lbFromIndex = i;
  const frames = lbFrom && !reduceMotion() && zoomFrames(lbFrom);
  if (frames) $("lbImg").animate(frames, { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
}

// Hide the viewer, shrinking back into its gallery picture if that's
// the photo still showing
function hideLightbox() {
  liveHold(false);
  const back = lbFrom && lbFrom.isConnected && lbIndex === lbFromIndex;   // still the photo that was tapped
  const frames = back && !reduceMotion() && zoomFrames(lbFrom);
  lbFrom = null;
  if (!frames) return lb.classList.add("hidden");
  lb.classList.add("closing");
  $("lbImg").animate(frames.slice().reverse(), { duration: 300, easing: "cubic-bezier(0.4, 0, 0.2, 1)" })
    .finished.then(() => { lb.classList.add("hidden"); lb.classList.remove("closing"); });
}

function showPhoto(i) {
  const n = galleryList.length;
  if (!n) return closeLightbox();
  lbIndex = (i + n) % n;
  lbPhoto = galleryList[lbIndex];

  // Show the small picture the gallery already loaded straight away,
  // then swap in the full one once it has downloaded. A Live photo shows
  // its sharp still here; press and hold to see it move.
  const img = $("lbImg");
  const id = lbPhoto.id;
  const local = !!lbPhoto.blob;   // on this phone (private / waiting to send)
  img.src = photoSrc(lbPhoto, 500);
  img.classList.toggle("loading", !local);
  if (!local) {
    const photo = lbPhoto;
    const full = hasStill(photo)
      ? albumFile(id, "image/jpeg").then((f) => f.url, () => thumbUrl(id, 1600))
      : liveUrlOf(photo);
    full.then((src) => {
      const big = new Image();
      big.onload = () => {
        if (lbPhoto === photo) { img.src = big.src; img.classList.remove("loading"); }
      };
      big.src = src;
    });
  }
  const holdable = isLive(lbPhoto) && hasStill(lbPhoto);
  liveHold(false);
  lb.classList.toggle("isLive", holdable);
  $("lbLiveHint").classList.toggle("hidden", !holdable);
  $("lbLive").removeAttribute("src");
  if (holdable) liveUrlOf(lbPhoto);   // get the GIF ready for the press
  // Preload the neighbours so swiping feels instant
  if (n > 1) [lbIndex + 1, lbIndex - 1].forEach((j) => {
    const q = galleryList[(j + n) % n];
    if (q.blob) return;
    if (hasStill(q)) albumFile(q.id, "image/jpeg").catch(() => {});
    else new Image().src = photoSrc(q, 1600);
  });

  $("lbCount").textContent = n > 1 ? `${lbIndex + 1} / ${n}` : "";
  $("lbPrev").classList.toggle("hidden", n < 2);
  $("lbNext").classList.toggle("hidden", n < 2);
  $("lbDelete").classList.toggle("hidden", !local && !Mine.token(id));
  $("lbShare").classList.toggle("hidden", !lbPhoto.private || !CONFIG.SCRIPT_URL);
  // ♥ for album photos
  const likeSlot = $("lbLikeSlot");
  likeSlot.replaceChildren();
  if (!local) likeSlot.appendChild(likeButton(lbPhoto));
  const tag = lbPhoto.private ? "PRIVATE" : lbPhoto.pending ? "SENDING…" : "";
  $("lbCount").textContent += tag ? (n > 1 ? "  ·  " : "") + tag : "";

  // The guest's wish under the photo
  const wish = $("lbWish");
  wish.classList.toggle("hidden", !lbPhoto.wish);
  wish.replaceChildren();
  if (lbPhoto.wish) {
    const text = document.createElement("span");
    text.textContent = "“" + lbPhoto.wish + "”";
    wish.append(text);
    if (lbPhoto.name) {
      const from = document.createElement("small");
      from.textContent = lbPhoto.name;
      wish.append(from);
    }
  }
}

// ---------- Live photos in the viewer: press and hold to play ----------
// While held, the GIF plays over the still from its first frame (a fresh
// copy each time); let go and the still is back.
let liveCopy = null;   // the URL made for the current press
async function liveHold(on) {
  const live = $("lbLive");
  if (!on) {
    lb.classList.remove("playing");
    return;
  }
  if (lb.classList.contains("playing") || !lb.classList.contains("isLive")) return;
  // sit exactly over the still (measured before the little "lift")
  const r = $("lbImg").getBoundingClientRect(), s = $("lbStage").getBoundingClientRect();
  Object.assign(live.style, { left: r.left - s.left + "px", top: r.top - s.top + "px", width: r.width + "px", height: r.height + "px" });
  live.removeAttribute("src");
  lb.classList.add("playing");
  tick();
  const p = lbPhoto;
  const blob = p.blob ? p.live : albumBlob(p.live);
  let src;
  if (blob) {
    if (liveCopy) URL.revokeObjectURL(liveCopy);
    src = liveCopy = URL.createObjectURL(blob);
  } else {
    src = await liveUrlOf(p);
  }
  if (lbPhoto === p && lb.classList.contains("playing")) live.src = src;
}

// Press and hold the photo (a quick tap, a double-tap ♥ or a swipe don't count)
let holdTimer = null, holdFrom = null, held = false;
$("lbImg").addEventListener("pointerdown", (e) => {
  held = false;
  if (!lb.classList.contains("isLive")) return;
  holdFrom = [e.clientX, e.clientY];
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { held = true; liveHold(true); }, 220);
});
$("lbImg").addEventListener("pointermove", (e) => {
  if (holdFrom && !held && Math.hypot(e.clientX - holdFrom[0], e.clientY - holdFrom[1]) > 12) {
    clearTimeout(holdTimer);
    holdFrom = null;
  }
});
["pointerup", "pointercancel", "pointerleave"].forEach((type) => $("lbImg").addEventListener(type, () => {
  clearTimeout(holdTimer);
  holdFrom = null;
  if (held) liveHold(false);
}));
// no "Save image" menu popping up on a long press
$("lbImg").addEventListener("contextmenu", (e) => { if (lb.classList.contains("isLive")) e.preventDefault(); });
// The "Hold to play" chip works the same (and with the keyboard)
const liveHint = $("lbLiveHint");
liveHint.addEventListener("pointerdown", (e) => { e.preventDefault(); liveHold(true); });
["pointerup", "pointercancel", "pointerleave"].forEach((type) => liveHint.addEventListener(type, () => liveHold(false)));
liveHint.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); liveHold(true); } });
liveHint.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") liveHold(false); });
liveHint.addEventListener("contextmenu", (e) => e.preventDefault());

function closeLightbox() {
  if (history.state && history.state.lightbox) history.back();   // popstate hides it
  else hideLightbox();
}

$("lbClose").addEventListener("click", closeLightbox);
$("lbPrev").addEventListener("click", () => showPhoto(lbIndex - 1));
$("lbNext").addEventListener("click", () => showPhoto(lbIndex + 1));
// Tap the dark area around the photo to close
lb.addEventListener("click", (e) => { if (e.target === lb || e.target === $("lbStage")) closeLightbox(); });

// Double-tap the photo to like it (with a heart that pops up)
let lastTap = 0;
$("lbImg").addEventListener("pointerup", () => {
  const now = Date.now();
  if (held) { lastTap = 0; return; }   // that was a hold to play
  if (now - lastTap < 320 && lbPhoto && !lbPhoto.blob) {
    toggleLike(lbPhoto, true);
    const heart = $("lbHeart");
    heart.classList.remove("pop");
    void heart.offsetWidth;   // restart the animation
    heart.classList.add("pop");
  }
  lastTap = now;
});

// Swipe left / right
let swipeX = null, swipeY = null;
$("lbStage").addEventListener("touchstart", (e) => {
  swipeX = e.touches[0].clientX;
  swipeY = e.touches[0].clientY;
}, { passive: true });
$("lbStage").addEventListener("touchend", (e) => {
  if (swipeX === null) return;
  if (held) { swipeX = null; return; }
  const dx = e.changedTouches[0].clientX - swipeX;
  const dy = e.changedTouches[0].clientY - swipeY;
  swipeX = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) showPhoto(lbIndex + (dx < 0 ? 1 : -1));
});

document.addEventListener("keydown", (e) => {
  if (!lbOpen()) return;
  if (e.key === "ArrowRight") showPhoto(lbIndex + 1);
  if (e.key === "ArrowLeft") showPhoto(lbIndex - 1);
  if (e.key === "Escape") closeLightbox();
});

$("lbSave").addEventListener("click", () => savePrint(lbPhoto));

// Private → public: move it to the outbox (with a wish), then it sends
$("lbShare").addEventListener("click", async () => {
  const photo = lbPhoto;
  const wish = await askWish();
  if (!wish) return;
  $("lbShare").disabled = true;
  try {
    await queuePhoto(photo.blob, wish, photo.live);
    await Private.remove(photo.id);
    closeLightbox();
    toast("Sharing to the album…");
    Sender.flush();
    loadGallery();
  } catch (err) {
    toast("Couldn't share: " + err.message);
  }
  $("lbShare").disabled = false;
});

$("lbDelete").addEventListener("click", async () => {
  if (lbPhoto.private || lbPhoto.pending) {
    const question = lbPhoto.private
      ? "Delete this private photo? It isn't saved anywhere else."
      : "Stop sending this photo and delete it?";
    if (!(await ask(question, "Delete", true))) return;
    await (lbPhoto.private ? Private : Outbox).remove(lbPhoto.id).catch(() => {});
    URL.revokeObjectURL(lbPhoto.url);
    privatePhotos = privatePhotos.filter((p) => p.id !== lbPhoto.id);
    pendingPhotos = pendingPhotos.filter((p) => p.id !== lbPhoto.id);
    closeLightbox();
    renderGallery();
    toast("Photo deleted");
    return;
  }
  if (!(await ask("Delete this photo from the album?", "Delete", true))) return;
  try {
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "delete", id: lbPhoto.id, token: Mine.token(lbPhoto.id) }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    Mine.remove(lbPhoto.id);
    galleryPhotos = galleryPhotos.filter((p) => p.id !== lbPhoto.id);
    closeLightbox();
    renderGallery();
    toast("Photo deleted");
  } catch (err) {
    toast("Couldn't delete: " + err.message);
  }
});

// =========================================================
//  Start
// =========================================================
buildLayoutCards();
resetShots();
Sender.flush();   // photos left waiting from last time (bad signal) go now

// Offline: keep the app's files on the phone so it opens with no signal
// (sw.js). Not on your own computer while editing - it would keep showing
// old files - unless you add ?sw=1 to the address to test it.
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
if ("serviceWorker" in navigator && location.protocol !== "file:" && (!local || /[?&]sw=1/.test(location.search))) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Offline support not available:", err));
}

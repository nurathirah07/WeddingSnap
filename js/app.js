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

const Private = {
  async add(blob) {
    const id = "private-" + randomToken();
    await DB.run("private", "readwrite", (s) => s.put({ id, blob, time: Date.now() }));
    return id;
  },
  all()      { return DB.run("private", "readonly", (s) => s.getAll()).catch(() => []); },
  remove(id) { return DB.run("private", "readwrite", (s) => s.delete(id)); },
};

// { id (= the upload token), blob, time, wish, name, tries }
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
  if (!lb.classList.contains("hidden")) { lb.classList.add("hidden"); return; }
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
function buildLayoutCards() {
  const grid = $("layoutGrid");
  grid.innerHTML = "";
  Object.entries(LAYOUTS).forEach(([id, l]) => {
    const card = document.createElement("button");
    card.className = "layoutCard";

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
    card.addEventListener("click", () => chooseLayout(id));
    grid.appendChild(card);
  });
}

function chooseLayout(id) {
  state.layoutId = id;
  resetShots();
  show("booth");
}

function resetShots() {
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
function capture() {
  const s = slotNow();
  const long = 1400;   // enough detail for printing, small enough to upload
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
    if (!(await runCountdown(runId))) return;

    state.shots[state.current] = capture();
    Sound.shutter();
    flash();
    navigator.vibrate?.(25);
    renderBooth();

    if (k < todo.length - 1) await wait(CONFIG.POSE_PAUSE);
    if (runId !== state.runId) return;
  }

  state.busy = false;
  Sound.duck(false);
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
  $("countdown").classList.remove("show");
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
    const shot = state.shots[i];
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
  compose(preview);
  show("edit");
}

// Colour, Effects and Filter each have a tab, so the screen stays tidy
document.querySelectorAll(".editTab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".editTab").forEach((t) => {
    t.classList.toggle("active", t === tab);
    t.setAttribute("aria-selected", t === tab);
  });
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== tab.dataset.pane));
}));

function selectChip(wrap, chip) {
  wrap.querySelectorAll(".swatch").forEach((c) => c.classList.toggle("selected", c === chip));
}

function buildColourChips() {
  const wrap = $("colourChips");
  wrap.innerHTML = "";
  COLOURS.forEach((c) => {
    const chip = document.createElement("button");
    chip.className = "swatch colour" + (c.id === state.colourId ? " selected" : "");
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
  EFFECTS.forEach((ef) => {
    const chip = document.createElement("button");
    chip.className = "swatch" + (ef.id === state.effectId ? " selected" : "");
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

  FILTERS.forEach((f) => {
    const chip = document.createElement("button");
    chip.className = "swatch" + (f.id === state.filterId ? " selected" : "");
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

  const out = document.createElement("canvas");
  compose(out);
  const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", 0.9));
  if (state.final) URL.revokeObjectURL(state.final.url);
  state.final = { blob, url: URL.createObjectURL(blob), dataUrl: out.toDataURL("image/jpeg", 0.88) };

  $("resultImg").src = state.final.url;
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
// Upload a JPEG (data: URL) to the Drive album. Returns the new photo's id.
// The token is the photo's own key: sending it again never makes a copy.
async function sendToAlbum(dataUrl, { token = randomToken(), wish = "", name = "" } = {}) {
  // text/plain body = no CORS preflight, which Apps Script can't answer
  const res = await fetch(CONFIG.SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "upload", image: dataUrl, token, wish, name }),
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
async function queuePhoto(blob, { wish = "", name = "" } = {}) {
  const item = { id: randomToken(), blob, time: Date.now(), wish, name, tries: 0 };
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
        const id = await sendToAlbum(await blobToDataUrl(item.blob), { token: item.id, wish: item.wish, name: item.name });
        await Outbox.remove(item.id);
        window.dispatchEvent(new CustomEvent("photosent", { detail: { token: item.id, id } }));
      } catch (err) {
        console.warn("Photo not sent yet:", err);
        // The album keeps refusing it (not a signal problem): keep it as a
        // private photo instead, so it's never lost and the queue moves on
        if (err.server && ++item.tries >= 3) {
          await Private.add(item.blob);
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
    state.final.privateId = await Private.add(state.final.blob);
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
    token = await queuePhoto(state.final.blob, wish);
  } catch (err) {
    // This browser can't store it (rare): send it straight away instead
    try {
      await sendToAlbum(state.final.dataUrl, wish);
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
async function savePhoto(blob, name) {
  const file = new File([blob], name, { type: "image/jpeg" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$("saveBtn").addEventListener("click", () =>
  savePhoto(state.final.blob, "wedding-snap-" + Date.now() + ".jpg"));

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

// Photos stored on this phone (private + waiting to send), shown under Mine
async function loadPrivate() {
  [...privatePhotos, ...pendingPhotos].forEach((p) => URL.revokeObjectURL(p.url));
  const [priv, waiting] = await Promise.all([Private.all(), Outbox.all()]);
  privatePhotos = priv.map((p) => ({ ...p, private: true, url: URL.createObjectURL(p.blob) }));
  pendingPhotos = waiting.map((p) => ({ ...p, pending: true, url: URL.createObjectURL(p.blob) }));
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
  grid.innerHTML = "";
  list.forEach((p, i) => {
    const item = document.createElement("button");
    item.className = "tile" + (p.private ? " private" : p.pending ? " pending" : mine[p.id] ? " mine" : "");
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = photoSrc(p, 500);
    img.alt = "";
    item.appendChild(img);
    if (p.wish) {
      const wish = document.createElement("span");
      wish.className = "tileWish";
      wish.textContent = "“" + p.wish + "”";
      item.appendChild(wish);
    }
    item.setAttribute("aria-label", "View photo " + (i + 1));
    item.addEventListener("click", () => openLightbox(i));
    grid.appendChild(item);
  });
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

function openLightbox(i) {
  // An entry in the history, so the phone's Back button closes the viewer
  // instead of leaving the app
  if (!lbOpen()) history.pushState({ lightbox: true }, "");
  lb.classList.remove("hidden");
  showPhoto(i);
}

function showPhoto(i) {
  const n = galleryList.length;
  if (!n) return closeLightbox();
  lbIndex = (i + n) % n;
  lbPhoto = galleryList[lbIndex];

  // Show the small picture the gallery already loaded straight away,
  // then swap in the sharp one once it has downloaded
  const img = $("lbImg");
  const id = lbPhoto.id;
  const local = !!lbPhoto.blob;   // on this phone (private / waiting to send)
  img.src = photoSrc(lbPhoto, 500);
  img.classList.toggle("loading", !local);
  if (!local) {
    const big = new Image();
    big.onload = () => {
      if (lbPhoto && lbPhoto.id === id) { img.src = big.src; img.classList.remove("loading"); }
    };
    big.src = thumbUrl(id, 1600);
  }
  // Preload the neighbours so swiping feels instant
  if (n > 1) [lbIndex + 1, lbIndex - 1].forEach((j) => { new Image().src = photoSrc(galleryList[(j + n) % n], 1600); });

  $("lbCount").textContent = n > 1 ? `${lbIndex + 1} / ${n}` : "";
  $("lbPrev").classList.toggle("hidden", n < 2);
  $("lbNext").classList.toggle("hidden", n < 2);
  $("lbDelete").classList.toggle("hidden", !local && !Mine.token(id));
  $("lbShare").classList.toggle("hidden", !lbPhoto.private || !CONFIG.SCRIPT_URL);
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

function closeLightbox() {
  if (history.state && history.state.lightbox) history.back();   // popstate hides it
  else lb.classList.add("hidden");
}

$("lbClose").addEventListener("click", closeLightbox);
$("lbPrev").addEventListener("click", () => showPhoto(lbIndex - 1));
$("lbNext").addEventListener("click", () => showPhoto(lbIndex + 1));
// Tap the dark area around the photo to close
lb.addEventListener("click", (e) => { if (e.target === lb || e.target === $("lbStage")) closeLightbox(); });

// Swipe left / right
let swipeX = null, swipeY = null;
$("lbStage").addEventListener("touchstart", (e) => {
  swipeX = e.touches[0].clientX;
  swipeY = e.touches[0].clientY;
}, { passive: true });
$("lbStage").addEventListener("touchend", (e) => {
  if (swipeX === null) return;
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

// Drive images can't be read by our page (CORS), so open the download link
$("lbSave").addEventListener("click", () => {
  if (lbPhoto.blob) savePhoto(lbPhoto.blob, "wedding-snap-" + lbPhoto.time + ".jpg");
  else window.open(`https://drive.google.com/uc?export=download&id=${lbPhoto.id}`, "_blank");
});

// Private → public: move it to the outbox (with a wish), then it sends
$("lbShare").addEventListener("click", async () => {
  const photo = lbPhoto;
  const wish = await askWish();
  if (!wish) return;
  $("lbShare").disabled = true;
  try {
    await queuePhoto(photo.blob, wish);
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

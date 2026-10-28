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
  frameId:  "noir",
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
const frame    = () => FRAMES.find((f) => f.id === state.frameId);
const filter   = () => FILTERS.find((f) => f.id === state.filterId);
const findFilter = (id) => FILTERS.find((f) => f.id === id);

// PNG frames bring their own size + photo windows; themes use the layout's
function geometry(fr = frame()) {
  return fr.type === "png" ? fr : layout();
}

function framesForLayout() {
  return FRAMES.filter((f) => f.type === "theme" || f.layout === state.layoutId);
}

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

// Private photos: kept only in this browser (IndexedDB), never uploaded.
// Shown in the gallery's "Mine" tab for this guest only.
const Private = {
  db: null,
  open() {
    if (!this.db) this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open("weddingsnap", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("private", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("private", mode);
      const req = fn(tx.objectStore("private"));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  async add(blob) {
    const id = "private-" + randomToken();
    await this.run("readwrite", (s) => s.put({ id, blob, time: Date.now() }));
    return id;
  },
  all()      { return this.run("readonly", (s) => s.getAll()).catch(() => []); },
  remove(id) { return this.run("readwrite", (s) => s.delete(id)); },
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
  // Back while "Are you sure?" is open = Cancel (and stay where we are)
  if (askDone) {
    askDone(false);
    history.pushState(lbOpen() ? { lightbox: true } : { app: true }, "");
    return;
  }
  const lb = $("lightbox");
  if (!lb.classList.contains("hidden")) { lb.classList.add("hidden"); return; }
  goBack();
  // ready for the next Back (show() may already have added the entry)
  if (current !== "home" && !(history.state && history.state.app)) history.pushState({ app: true }, "");
});

// =========================================================
//  PNG frames come from frames/frames.json (made by tools/build-frames.mjs).
//  A frame with an unusual number of photos gets its own layout.
// =========================================================
const framesReady = fetch("frames/frames.json", { cache: "no-cache" })
  .then((res) => res.json())
  .then((data) => data.frames.forEach((fr) => {
    FRAMES.push({ ...fr, type: "png" });
    if (!LAYOUTS[fr.layout]) {
      const n = fr.slots.length;
      LAYOUTS[fr.layout] = { name: fr.name, hint: n + (n === 1 ? " photo" : " photos"),
                             width: fr.width, height: fr.height, slots: fr.slots };
    }
  }))
  .catch(() => console.warn("No frames/frames.json - only built-in frames"));

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
  .then((s) => ["TITLE", "COUPLE", "DATE"].forEach((key) => {
    const value = s[key.toLowerCase()];
    if (typeof value === "string" && value.trim()) CONFIG[key] = value.trim();
  }))
  .catch(() => console.warn("No settings.json - using config.js"))
  .then(showDetails);

// Fonts, details + frame images must be loaded before drawing on canvas
const frameImages = {};
const ready = Promise.all([
  settingsReady,
  document.fonts.load('italic 500 80px "Cormorant Garamond"'),
  document.fonts.load('500 30px "DM Sans"'),
  framesReady.then(() => Promise.all(FRAMES.filter((f) => f.type === "png").map((f) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { frameImages[f.id] = img; resolve(); };
    img.onerror = () => { console.warn("Frame not found:", f.src); resolve(); };
    img.src = encodeURI(f.src);
  })))),
]).catch(() => {});

// =========================================================
//  1. HOME
// =========================================================
function showDetails() {
  $("homeTitle").textContent  = $("introTitle").textContent  = CONFIG.TITLE;
  $("homeCouple").textContent = $("introCouple").textContent = CONFIG.COUPLE;
  $("sleeveDate").textContent = $("introDate").textContent   = CONFIG.DATE;

  // Monogram on the record: first letter of each name, e.g. "Aisyah & Hakim" -> "A&H"
  const monogram = CONFIG.COUPLE.split("&").map((n) => n.trim().charAt(0).toUpperCase()).join("&");
  document.querySelectorAll(".cdMono").forEach((el) => { el.textContent = monogram; });
  document.body.classList.add("detailsReady");   // fade the text in (no flash of old names)
}

$("homeStart").addEventListener("click", () => show("layout"));
$("homeGallery").addEventListener("click", () => show("gallery"));

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
  if (!framesForLayout().some((f) => f.id === state.frameId)) {
    state.frameId = framesForLayout()[0].id;
  }
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
  // Live preview has the same shape as the photo slots
  const s = layout().slots[0];
  viewfinder.style.aspectRatio = s.w + " / " + s.h;
  viewfinder.style.setProperty("--ar", s.w / s.h);
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
function renderBooth() {
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
  const s = layout().slots[0];
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
    const s = layout().slots[0];
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
function compose(canvas, fr = frame(), f = filter()) {
  const g = geometry(fr);
  canvas.width = g.width;
  canvas.height = g.height;
  const ctx = canvas.getContext("2d");

  if (fr.type === "png") {
    const img = frameImages[fr.id];
    if (img && !fr.overlay) ctx.drawImage(img, 0, 0, g.width, g.height);
    drawPhotos(ctx, g, f);
    if (img && fr.overlay) ctx.drawImage(img, 0, 0, g.width, g.height);
    return;
  }

  drawThemeBackground(ctx, g, fr);
  drawPhotos(ctx, g, f);
  drawFooter(ctx, g, fr);
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

function drawThemeBackground(ctx, g, fr) {
  if (fr.gradient) {
    const grad = ctx.createLinearGradient(0, 0, 0, g.height);
    grad.addColorStop(0, fr.bg);
    grad.addColorStop(1, fr.gradient);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = fr.bg;
  }
  ctx.fillRect(0, 0, g.width, g.height);

  // Film: sprocket holes down both edges
  if (fr.film) {
    const m = g.slots[0].x;
    const hw = m * 0.38, hh = m * 0.55, gap = hh * 0.9;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let y = gap / 2; y < g.height - hh; y += hh + gap) {
      roundRect(ctx, (m - hw) / 2, y, hw, hh, hw * 0.25); ctx.fill();
      roundRect(ctx, g.width - m + (m - hw) / 2, y, hw, hh, hw * 0.25); ctx.fill();
    }
  }
}

function drawFooter(ctx, g, fr) {
  const bottom = Math.max(...g.slots.map((s) => s.y + s.h));
  const space = g.height - bottom;
  const cx = g.width / 2;
  const maxW = g.width * 0.84;
  const big = g.width * 0.085;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = fr.text;
  fitText(ctx, CONFIG.TITLE, cx, bottom + space * 0.36, maxW, Math.round(big),
          'italic 500 {size} "Cormorant Garamond", serif');

  // thin divider line
  ctx.strokeStyle = fr.sub;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = Math.max(1, g.width / 540);
  ctx.beginPath();
  ctx.moveTo(cx - g.width * 0.06, bottom + space * 0.54);
  ctx.lineTo(cx + g.width * 0.06, bottom + space * 0.54);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = fr.sub;
  fitText(ctx, CONFIG.COUPLE, cx, bottom + space * 0.68, maxW, Math.round(big * 0.36),
          '500 {size} "DM Sans", sans-serif');
  fitText(ctx, CONFIG.DATE, cx, bottom + space * 0.82, maxW, Math.round(big * 0.3),
          '400 {size} "DM Sans", sans-serif');
}

async function goToEdit() {
  state.retakeOne = false;
  state.current = 0;
  await ready;
  buildFrameChips();
  buildFilterChips();
  compose(preview);
  show("edit");
}

function buildFrameChips() {
  const wrap = $("frameChips");
  wrap.innerHTML = "";
  framesForLayout().forEach((fr) => {
    const chip = document.createElement("button");
    chip.className = "swatch" + (fr.id === state.frameId ? " selected" : "");
    const sw = document.createElement("span");
    if (fr.type === "png") sw.style.backgroundImage = `url("${encodeURI(fr.src)}")`;
    else sw.style.background = fr.gradient ? `linear-gradient(${fr.bg}, ${fr.gradient})` : fr.bg;
    chip.appendChild(sw);
    chip.insertAdjacentHTML("beforeend", `<small>${fr.name}</small>`);
    chip.addEventListener("click", () => {
      state.frameId = fr.id;
      wrap.querySelectorAll(".swatch").forEach((c) => c.classList.toggle("selected", c === chip));
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
      wrap.querySelectorAll(".swatch").forEach((c) => c.classList.toggle("selected", c === chip));
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
  const i = geometry().slots.findIndex((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
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
  else upload();
});

// =========================================================
//  5. RESULT  (upload + save)
// =========================================================
// Upload a JPEG (data: URL) to the Drive album. Returns the new photo's id.
async function sendToAlbum(dataUrl) {
  const token = randomToken();
  // text/plain body = no CORS preflight, which Apps Script can't answer
  const res = await fetch(CONFIG.SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "upload", image: dataUrl, token, layout: state.layoutId }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  Mine.add(data.id, token);
  return data.id;
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
  $("makePublicBtn").classList.add("hidden");
  const privateId = state.final.privateId;
  if (await upload() && privateId) {
    Private.remove(privateId).catch(() => {});
    state.final.privateId = null;
  }
});

// Returns true once the photo is in the album
async function upload() {
  const status = $("uploadStatus");
  $("makePublicBtn").classList.add("hidden");
  if (!CONFIG.SCRIPT_URL) {
    status.className = "uploadStatus";
    status.textContent = "The album isn't connected yet. Save it to your phone below.";
    return false;
  }
  status.className = "uploadStatus sending";
  status.textContent = "Sending to the couple's album…";

  try {
    await sendToAlbum(state.final.dataUrl);
    status.className = "uploadStatus ok";
    status.textContent = "Shared to the couple's album ✓";
    return true;
  } catch (err) {
    console.warn(err);
    status.className = "uploadStatus fail";
    status.innerHTML = 'Couldn\'t send (check your internet). <button class="btn link" id="retryUpload">Try again</button>';
    $("retryUpload").addEventListener("click", upload);
    return false;
  }
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
let galleryPhotos = [];   // public photos in the Drive album
let privatePhotos = [];   // this phone's private photos { id, time, private, blob, url }
let galleryList = [];     // the photos showing right now (Everyone or Mine)
let galleryTab = "all";
const thumbUrl = (id, size) => `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`;
const photoSrc = (p, size) => p.url || thumbUrl(p.id, size);

async function loadPrivate() {
  privatePhotos.forEach((p) => URL.revokeObjectURL(p.url));
  privatePhotos = (await Private.all()).map((p) => ({ ...p, private: true, url: URL.createObjectURL(p.blob) }));
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
    console.warn(err);
    msg.textContent = "Couldn't load the gallery. Pull to refresh or tap ⟳.";
  }
}

function renderGallery() {
  const mine = Mine.all();
  // Everyone = public album only. Mine = my public uploads + my private photos.
  const list = galleryTab === "mine"
    ? [...privatePhotos, ...galleryPhotos.filter((p) => mine[p.id])].sort((a, b) => b.time - a.time)
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
    item.className = "tile" + (p.private ? " private" : mine[p.id] ? " mine" : "");
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = photoSrc(p, 500);
    img.alt = "";
    item.appendChild(img);
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
  img.src = photoSrc(lbPhoto, 500);
  img.classList.toggle("loading", !lbPhoto.private);
  if (!lbPhoto.private) {
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
  $("lbDelete").classList.toggle("hidden", !lbPhoto.private && !Mine.token(id));
  $("lbShare").classList.toggle("hidden", !lbPhoto.private || !CONFIG.SCRIPT_URL);
  $("lbCount").textContent += lbPhoto.private ? (n > 1 ? "  ·  " : "") + "PRIVATE" : "";
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
  if (lbPhoto.private) savePhoto(lbPhoto.blob, "wedding-snap-" + lbPhoto.time + ".jpg");
  else window.open(`https://drive.google.com/uc?export=download&id=${lbPhoto.id}`, "_blank");
});

// Private → public: upload it, then forget the private copy
$("lbShare").addEventListener("click", async () => {
  if (!(await ask("Share this photo to the couple's album? Everyone will be able to see it.", "Share"))) return;
  const photo = lbPhoto;
  $("lbShare").disabled = true;
  try {
    await sendToAlbum(await blobToDataUrl(photo.blob));
    await Private.remove(photo.id);
    closeLightbox();
    toast("Shared to the album");
    loadGallery();
  } catch (err) {
    toast("Couldn't share: " + err.message);
  }
  $("lbShare").disabled = false;
});

$("lbDelete").addEventListener("click", async () => {
  if (lbPhoto.private) {
    if (!(await ask("Delete this private photo? It isn't saved anywhere else.", "Delete", true))) return;
    await Private.remove(lbPhoto.id).catch(() => {});
    URL.revokeObjectURL(lbPhoto.url);
    privatePhotos = privatePhotos.filter((p) => p.id !== lbPhoto.id);
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
framesReady.then(buildLayoutCards);   // again, now including frame-only layouts
resetShots();

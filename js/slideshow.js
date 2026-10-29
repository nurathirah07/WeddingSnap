// =========================================================
//  Live slideshow (slideshow.html) for a TV / projector.
//  - Checks the album every few seconds; new photos go on screen next,
//    marked "Just taken".
//  - Otherwise shows every photo in a shuffled loop.
//  - Each photo fades in with a slow zoom, over a blurred copy of itself,
//    next to the guest's wish (or the couple's names).
//  Hidden photos (admin) are never in the list, so they never appear.
// =========================================================
const $ = (id) => document.getElementById(id);
const SLIDE_MS = 9000;    // each photo stays this long
const POLL_MS = 8000;     // how often to look for new photos
const APP_URL = new URL("./", location.href).href;   // where the QR code points

const thumbUrl = (id, size) => `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`;

let photos = [];          // the album, newest first
let seen = null;          // ids already known (null until the first load)
let fresh = [];           // new since the slideshow started: shown next
let order = [];           // the shuffled loop
let showing = null;       // the photo on screen
let slideTimer = null;
let side = 0;             // tilt left / right, alternating

// ---------- Names, date, monogram (same as the app) ----------
async function loadDetails() {
  try {
    const s = await (await fetch("settings.json", { cache: "no-cache" })).json();
    ["TITLE", "COUPLE", "DATE"].forEach((key) => {
      const value = s[key.toLowerCase()];
      if (typeof value === "string" && value.trim()) CONFIG[key] = value.trim();
    });
  } catch (e) {}
  const initials = CONFIG.COUPLE.split(/\s*&\s*|\s+(?:and|dan)\s+/i)
    .map((n) => n.trim().charAt(0).toUpperCase()).filter(Boolean);
  $("showMono").textContent = initials.join(" & ");
  $("showTitle").textContent = CONFIG.COUPLE;
  $("showDate").textContent = CONFIG.DATE;
  $("emptyTitle").textContent = CONFIG.TITLE;
  $("emptyCouple").textContent = CONFIG.COUPLE;
  document.title = CONFIG.COUPLE + " · Live slideshow";
}

// ---------- Album ----------
async function poll() {
  if (!CONFIG.SCRIPT_URL) return;
  try {
    const data = await (await fetch(CONFIG.SCRIPT_URL + "?action=list")).json();
    if (!data.ok) throw new Error(data.error);
    photos = data.photos;
    if (seen) {
      // newest first, so the latest photo is on screen soonest
      const added = photos.filter((p) => !seen.has(p.id));
      fresh = [...added, ...fresh.filter((p) => !added.some((a) => a.id === p.id))];
    }
    seen = new Set(photos.map((p) => p.id));
    $("showCount").textContent = photos.length ? photos.length + (photos.length === 1 ? " photo" : " photos") + " so far" : "";
    if (!showing) next();   // first photos have arrived
  } catch (err) {
    console.warn("Album not reachable, trying again", err);
  }
}

// Guests' favourites (3+ likes) come round twice as often
function shuffle(list) {
  const a = list.flatMap((p) => (p.likes >= 3 ? [p, p] : [p]));
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Next photo: new ones first, then the loop. Skips photos that were
// deleted or hidden since.
function pick() {
  const live = new Set(photos.map((p) => p.id));
  while (fresh.length) {
    const p = fresh.shift();
    if (live.has(p.id)) return { photo: photos.find((x) => x.id === p.id), isNew: true };
  }
  for (let tries = 0; tries < 2; tries++) {
    while (order.length) {
      const p = order.shift();
      if (live.has(p.id) && (photos.length < 2 || !showing || p.id !== showing.id)) {
        return { photo: photos.find((x) => x.id === p.id), isNew: false };
      }
    }
    order = shuffle(photos);
  }
  return null;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error("slow")), 15000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error("failed")); };
    img.referrerPolicy = "no-referrer";
    img.src = src;
  });
}

let loading = false;
async function next() {
  if (loading) return;
  clearTimeout(slideTimer);
  const choice = pick();
  if (!choice) {
    showing = null;
    $("showEmpty").classList.remove("hidden");
    return;   // poll() calls next() when photos arrive
  }
  loading = true;
  try {
    // a live photo: the full GIF, so it moves (older ones are a GIF only;
    // newer ones are a sharp photo + its GIF)
    const p = choice.photo;
    const [img, live] = await Promise.all([
      loadImage(p.gif ? `https://drive.google.com/uc?export=view&id=${p.id}` : thumbUrl(p.id, 1600)),
      p.live ? liveGif(p.live).catch(() => null) : null,
    ]);
    $("showEmpty").classList.add("hidden");
    show(p, img, choice.isNew, live);
  } catch (err) {
    console.warn("Skipping a photo that didn't load", err);
  }
  loading = false;
  slideTimer = setTimeout(next, showing ? SLIDE_MS : 1500);
}

// A Live photo's GIF, read from Drive (the original file), and how long one
// play-through lasts. It ends on the snap, so it fades neatly into the still.
async function liveGif(id) {
  const res = await fetch(`https://lh3.googleusercontent.com/d/${id}=d`);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let ms = 0;   // frame delays (hundredths of a second) add up to one play
  for (let i = 0; i < bytes.length - 5; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) ms += (bytes[i + 4] | (bytes[i + 5] << 8)) * 10;
  }
  const img = await loadImage(URL.createObjectURL(new Blob([bytes], { type: "image/gif" })));
  return { img, ms: Math.min(ms, SLIDE_MS - 2000) };
}

// ---------- One slide ----------
function show(photo, img, isNew, live) {
  showing = photo;
  side = 1 - side;
  const slide = document.createElement("section");
  slide.className = "slide";

  const bg = document.createElement("div");
  bg.className = "slideBg";
  bg.style.backgroundImage = `url("${img.src}")`;

  const print = document.createElement("figure");
  print.className = "slidePrint";
  print.style.setProperty("--tilt", (side ? 1.6 : -1.6) + "deg");
  img.alt = "";
  const pic = document.createElement("span");
  pic.className = "slidePhoto";
  pic.appendChild(img);
  if (live) {
    // plays once over the still, then fades away just before it would repeat
    live.img.className = "slideLive";
    live.img.alt = "";
    pic.appendChild(live.img);
    setTimeout(() => live.img.classList.add("done"), Math.max(1500, live.ms - 600));
  }
  print.appendChild(pic);
  if (isNew) {
    const badge = document.createElement("span");
    badge.className = "slideNew";
    badge.textContent = "Just taken";
    print.appendChild(badge);
  }
  if (photo.likes) {
    const likes = document.createElement("span");
    likes.className = "slideLikes";
    likes.textContent = "♥ " + photo.likes;
    print.appendChild(likes);
  }

  const words = document.createElement("div");
  words.className = "slideWords";
  if (photo.wish) {
    const q = document.createElement("p");
    q.className = "slideWish";
    q.textContent = photo.wish;
    // long wishes get smaller type so they always fit
    q.style.setProperty("--len", Math.min(1, Math.max(0, (photo.wish.length - 60) / 240)));
    words.appendChild(q);
    if (photo.name) {
      const from = document.createElement("p");
      from.className = "slideFrom";
      from.textContent = photo.name;
      words.appendChild(from);
    }
  } else {
    const t = document.createElement("p");
    t.className = "slideTitle";
    t.textContent = CONFIG.TITLE;
    const c = document.createElement("p");
    c.className = "slideCouple";
    c.textContent = CONFIG.COUPLE;
    words.append(t, c);
  }

  slide.append(bg, print, words);
  const stage = $("stage");
  const old = [...stage.children];
  stage.appendChild(slide);
  requestAnimationFrame(() => requestAnimationFrame(() => slide.classList.add("in")));
  old.forEach((o) => {
    o.classList.add("out");
    setTimeout(() => {
      o.querySelectorAll("img.slideLive").forEach((i) => URL.revokeObjectURL(i.src));
      o.remove();
    }, 1600);
  });
}

// ---------- Full screen, keep the screen awake, hide the mouse ----------
let wakeLock = null;
async function stayAwake() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) stayAwake(); });

document.addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  $("showHint").classList.add("gone");
  stayAwake();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === " ") next();
  if (e.key.toLowerCase() === "f") document.documentElement.requestFullscreen?.().catch(() => {});
});

let idle = null;
document.addEventListener("mousemove", () => {
  document.body.classList.remove("noCursor");
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add("noCursor"), 2500);
});
setTimeout(() => $("showHint").classList.add("gone"), 8000);

// ---------- Start ----------
$("showQr").appendChild(qrCanvas(APP_URL, 104));
$("emptyQr").appendChild(qrCanvas(APP_URL, 210));
loadDetails();
stayAwake();
if (!CONFIG.SCRIPT_URL) {
  $("showEmpty").classList.remove("hidden");
  document.querySelector(".showEmptyHint").textContent = "The album isn't connected yet (SCRIPT_URL in js/config.js).";
} else {
  poll().then(() => { if (!photos.length) $("showEmpty").classList.remove("hidden"); });
  setInterval(poll, POLL_MS);
}

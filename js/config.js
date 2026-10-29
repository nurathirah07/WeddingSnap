// =========================================================
//  SETTINGS - change these for your sister's wedding
// =========================================================
const CONFIG = {
  // Text printed on every photo. These are only the defaults: whatever
  // you save under "Wedding details" on the admin page (settings.json) wins.
  TITLE:    "Walimatul Urus",
  COUPLE:   "Pengantin Lelaki & Pengantin Perempuan",
  DATE:     "dd . mm . yyyy",
  // Size of that text on the photo, in % (100 = normal). Also set on the
  // admin page under "Wedding details".
  TEXT_SIZE: { title: 100, couple: 100, date: 100 },

  // Paste your Google Apps Script "Web app" URL here (see README.md).
  // Leave empty to run without uploads (save-to-phone still works).
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwxHUkODkn8qyyOnLb0nY7cNJh5WU_CsqRUbo23PxCMDEHszvdnPJE_LmEi-09Ho9k/exec",

  // Background music: starts on the guest's first tap, plays every song
  // in shuffled order, then reshuffles and repeats forever.
  // Just drop mp3s into the music/ folder and push to GitHub - the song
  // list + chorus times (music/songs.json) are made automatically.
  // To pick your own chorus times, edit "highlights" in music/songs.json.
  // No songs = a built-in music-box melody plays instead.
  MUSIC: {
    MODE: "highlights",   // "highlights" = jump between best parts, "full" = whole songs
    CLIP_SECONDS: 45,     // how long each highlight plays (highlights mode)
    CROSSFADE: 4,         // length of a transition in seconds
    // DJ transitions between songs, one is picked at random each time:
    //   "crossfade" = smooth blend        "sweep"    = muffled filter sweep
    //   "echo"      = song echoes away    "tapestop" = song slows down like a record
    TRANSITIONS: ["crossfade", "sweep", "echo", "tapestop"],
  },

  // Countdown options shown in the booth (seconds). First one is the default.
  TIMERS: [3, 5, 10],

  // Pause between shots in a sequence (ms) so guests can change pose
  POSE_PAUSE: 1200,
};

// ---------------------------------------------------------
//  Layouts: how many photos and where they go.
//  makeGrid() works out the slot positions for you.
//  `group` = the heading it's shown under on the layout screen.
// ---------------------------------------------------------
function makeGrid({ width, cols, rows, slotW, slotH, margin, gap, footer }) {
  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({
        x: margin + c * (slotW + gap),
        y: margin + r * (slotH + gap),
        w: slotW,
        h: slotH,
      });
    }
  }
  const height = margin + rows * slotH + (rows - 1) * gap + footer;
  return { width, height, slots };
}

const LAYOUTS = {
  single:   { name: "Single", group: "Single photo", hint: "1 photo",
    ...makeGrid({ width: 1080, cols: 1, rows: 1, slotW: 960, slotH: 1080, margin: 60, gap: 0,  footer: 300 }) },
  polaroid: { name: "Polaroid", group: "Single photo", hint: "1 square photo",
    ...makeGrid({ width: 1000, cols: 1, rows: 1, slotW: 880, slotH: 880,  margin: 60, gap: 0,  footer: 300 }) },
  duo:      { name: "Duo", group: "Grids & collage", hint: "2 side by side",
    ...makeGrid({ width: 1400, cols: 2, rows: 1, slotW: 630, slotH: 800,  margin: 50, gap: 40, footer: 280 }) },
  strip2:   { name: "2-Grid", group: "Strips", hint: "2 photo strip",
    ...makeGrid({ width: 600,  cols: 1, rows: 2, slotW: 520, slotH: 650,  margin: 40, gap: 20, footer: 380 }) },
  strip3:   { name: "3-Cut", group: "Strips", hint: "3 photo strip",
    ...makeGrid({ width: 600,  cols: 1, rows: 3, slotW: 520, slotH: 400,  margin: 40, gap: 20, footer: 340 }) },
  strip4:   { name: "4-Cut", group: "Strips", hint: "classic strip",
    ...makeGrid({ width: 600,  cols: 1, rows: 4, slotW: 520, slotH: 380,  margin: 40, gap: 18, footer: 320 }) },
  grid4:    { name: "4-Grid", group: "Grids & collage", hint: "2 × 2 grid",
    ...makeGrid({ width: 1080, cols: 2, rows: 2, slotW: 480, slotH: 600,  margin: 50, gap: 20, footer: 260 }) },
  // one big photo on top, two small ones under it
  feature:  { name: "Big & Two", group: "Grids & collage", hint: "1 big + 2 small", width: 1080, height: 1560,
    slots: [
      { x: 60,  y: 60,  w: 960, h: 720 },
      { x: 60,  y: 800, w: 470, h: 470 },
      { x: 550, y: 800, w: 470, h: 470 },
    ] },
  // a short looping clip (saved as a GIF) instead of a photo
  boomerang: { name: "Boomerang", group: "Boomerang", hint: "looping clip", motion: true,
    ...makeGrid({ width: 900,  cols: 1, rows: 1, slotW: 800, slotH: 960,  margin: 50, gap: 0,  footer: 270 }) },
  grid6:    { name: "6-Grid", group: "Grids & collage", hint: "2 × 3 grid",
    ...makeGrid({ width: 1080, cols: 2, rows: 3, slotW: 475, slotH: 475,  margin: 50, gap: 30, footer: 260 }) },
};

// ---------------------------------------------------------
//  Frame colours. Every print has the same design (photos + the
//  wedding details underneath); guests pick its colour, an effect
//  (js/effects.js) and a filter.
//  bg = paper, text = title, sub = names + date
//  Optional: bg2 / bg3 = gradient colours (with a fine film grain),
//            pattern = "gingham" | "dots" | "checker" drawn in `pat`
// ---------------------------------------------------------
const COLOURS = [
  { id: "white",     name: "White",      bg: "#ffffff", text: "#1f1a1c", sub: "#7a6f73" },
  { id: "cream",     name: "Cream",      bg: "#f6efe4", text: "#5b4630", sub: "#8f7a62" },
  { id: "blush",     name: "Blush",      bg: "#f7dde2", text: "#7a3b4a", sub: "#a2616f" },
  { id: "rose",      name: "Dusty Rose", bg: "#d8a7ad", text: "#fffaf6", sub: "#fbe6e3" },
  { id: "lilac",     name: "Lilac",      bg: "#ddd2f0", text: "#4b3a6e", sub: "#7a6a99" },
  { id: "sky",       name: "Sky",        bg: "#d3e3f4", text: "#2f4a6b", sub: "#5f7896" },
  { id: "sage",      name: "Sage",       bg: "#cfdac6", text: "#3f5139", sub: "#66785f" },
  { id: "champagne", name: "Champagne",  bg: "#ecdcc0", text: "#7a5a35", sub: "#9c7f5c" },
  { id: "burgundy",  name: "Burgundy",   bg: "#6e1d29", text: "#f3d9a4", sub: "#e8c6c0" },
  { id: "emerald",   name: "Emerald",    bg: "#0f4c3a", text: "#e6c77a", sub: "#cdb88a" },
  { id: "navy",      name: "Navy",       bg: "#1d2a44", text: "#f1e3c6", sub: "#b9c2d6" },
  { id: "black",     name: "Black",      bg: "#121012", text: "#ffffff", sub: "#a39a9e" },
  { id: "butter",    name: "Butter",     bg: "#f8eec8", text: "#6b5521", sub: "#937a45" },
  { id: "mint",      name: "Mint",       bg: "#d6eee2", text: "#2f5a49", sub: "#5d8574" },
  { id: "peach",     name: "Peach",      bg: "#fbdccb", text: "#8a4630", sub: "#b0705a" },
  { id: "mauve",     name: "Mauve",      bg: "#b9909f", text: "#fff7f6", sub: "#f6e1e6" },
  { id: "terracotta",name: "Terracotta", bg: "#c27a5c", text: "#fff6ec", sub: "#fbe2d2" },
  { id: "mocha",     name: "Mocha",      bg: "#7d6052", text: "#fbefe4", sub: "#e3cfc1" },
  { id: "charcoal",  name: "Charcoal",   bg: "#2c2a2f", text: "#f3ede6", sub: "#b4aca7" },

  // Gradients
  { id: "sunset",    name: "Sunset",       bg: "#fcd3b0", bg2: "#ee9fbd",              text: "#6d2e45", sub: "#94506a" },
  { id: "candy",     name: "Cotton Candy", bg: "#f8c8de", bg2: "#bccbf6",              text: "#4b3a72", sub: "#6e5f97" },
  { id: "aurora",    name: "Aurora",       bg: "#bfe7dd", bg2: "#cbbcf1",              text: "#33405f", sub: "#5a6787" },
  { id: "iridescent",name: "Iridescent",   bg: "#e2f1ff", bg2: "#fbe1f6", bg3: "#fff1d3", text: "#4f4767", sub: "#7a7191" },
  { id: "golden",    name: "Golden Hour",  bg: "#fde6a8", bg2: "#f3a17e",              text: "#6e3a1f", sub: "#93593a" },
  { id: "midnight",  name: "Midnight",     bg: "#1d2a48", bg2: "#53305f",              text: "#f6e4c6", sub: "#cdbfd9" },

  // Patterns
  { id: "gingham",   name: "Pink Gingham", bg: "#fff1f5", pattern: "gingham", pat: "#f2a7c0", text: "#7a3550", sub: "#a35e78" },
  { id: "ginghamBlue", name: "Blue Gingham", bg: "#f2f6fd", pattern: "gingham", pat: "#a9c0ea", text: "#2f4a74", sub: "#5b729a" },
  { id: "polka",     name: "Polka Dot",    bg: "#fff6ef", pattern: "dots", pat: "#f3b3c1", text: "#7a3a48", sub: "#a2626f" },
  { id: "checker",   name: "Checkerboard", bg: "#f6efff", pattern: "checker", pat: "#dccaf6", text: "#4b3a6e", sub: "#76689a" },
];
// ---------------------------------------------------------
//  Filters: film and booth looks (order of ops matters)
// ---------------------------------------------------------
const FILTERS = [
  { id: "none",       name: "Original",      ops: [] },
  { id: "booth",      name: "Booth B&W",     ops: [["grayscale", 1], ["contrast", 1.55], ["brightness", 1.1]] },
  { id: "silver",     name: "Silver Print",  ops: [["grayscale", 1], ["sepia", 0.15], ["contrast", 1.25], ["brightness", 1.05]] },
  { id: "sepia",      name: "Old Booth",     ops: [["grayscale", 1], ["sepia", 0.85], ["contrast", 1.15], ["brightness", 1.05]] },
  { id: "flash",      name: "Party Flash",   ops: [["brightness", 1.18], ["contrast", 1.3], ["saturate", 1.2]] },
  { id: "disposable", name: "Disposable",    ops: [["sepia", 0.2], ["saturate", 1.35], ["contrast", 1.15], ["brightness", 1.05]] },
  { id: "instant",    name: "Instant Film",  ops: [["sepia", 0.22], ["contrast", 0.9], ["brightness", 1.12], ["saturate", 0.85]] },
  { id: "faded",      name: "Faded 70s",     ops: [["sepia", 0.4], ["saturate", 0.7], ["contrast", 0.82], ["brightness", 1.12]] },
  { id: "golden",     name: "Golden Hour",   ops: [["sepia", 0.3], ["saturate", 1.3], ["brightness", 1.08]] },

  // Modern looks
  { id: "glow",       name: "Soft Glow",     ops: [["brightness", 1.1], ["contrast", 0.9], ["saturate", 0.92], ["fade", 0.05], ["tint", [1.03, 1.0, 1.0]]] },
  { id: "peachy",     name: "Peachy",        ops: [["tint", [1.07, 1.0, 0.93]], ["saturate", 1.12], ["brightness", 1.05], ["fade", 0.03]] },
  { id: "rose",       name: "Rosé",          ops: [["tint", [1.06, 0.96, 1.0]], ["saturate", 0.95], ["brightness", 1.06], ["fade", 0.04]] },
  { id: "coolfilm",   name: "Cool Film",     ops: [["tint", [0.94, 1.0, 1.07]], ["saturate", 0.85], ["contrast", 1.06], ["fade", 0.08]] },
  { id: "matte",      name: "Matte",         ops: [["fade", 0.12], ["contrast", 0.96], ["saturate", 0.82], ["brightness", 1.02]] },
  { id: "y2k",        name: "Y2K Flash",     ops: [["brightness", 1.08], ["contrast", 1.22], ["saturate", 1.15], ["tint", [0.98, 1.0, 1.04]]] },
  { id: "dreamy",     name: "Dreamy",        ops: [["saturate", 0.7], ["brightness", 1.12], ["fade", 0.1], ["tint", [1.02, 0.99, 1.05]]] },
  { id: "goldfilm",   name: "Gold Film",     ops: [["sepia", 0.1], ["tint", [1.04, 1.0, 0.9]], ["saturate", 1.12], ["contrast", 1.06]] },
  { id: "moody",      name: "Moody",         ops: [["brightness", 0.93], ["contrast", 1.18], ["saturate", 0.72], ["tint", [0.97, 1.0, 1.03]]] },
  { id: "noir",       name: "Noir",          ops: [["grayscale", 1], ["contrast", 1.7], ["brightness", 0.96]] },
];

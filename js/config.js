// =========================================================
//  SETTINGS - change these for your sister's wedding
// =========================================================
const CONFIG = {
  // Text printed on every photo. These are only the defaults: whatever
  // you save under "Wedding details" on the admin page (settings.json) wins.
  TITLE:    "Walimatul Urus",
  COUPLE:   "Pengantin Lelaki & Pengantin Perempuan",
  DATE:     "dd . mm . yyyy",

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
  single: { name: "Single", hint: "1 photo",
    ...makeGrid({ width: 1080, cols: 1, rows: 1, slotW: 960,  slotH: 1080, margin: 60, gap: 0,  footer: 300 }) },
  strip2: { name: "2-Grid", hint: "2 photo strip",
    ...makeGrid({ width: 600,  cols: 1, rows: 2, slotW: 520,  slotH: 650,  margin: 40, gap: 20, footer: 380 }) },
  strip3: { name: "3-Cut", hint: "3 photo strip",
    ...makeGrid({ width: 600,  cols: 1, rows: 3, slotW: 520,  slotH: 400,  margin: 40, gap: 20, footer: 340 }) },
  strip4: { name: "4-Cut", hint: "classic strip",
    ...makeGrid({ width: 600,  cols: 1, rows: 4, slotW: 520,  slotH: 380,  margin: 40, gap: 18, footer: 320 }) },
  grid4:  { name: "4-Grid", hint: "2 × 2 grid",
    ...makeGrid({ width: 1080, cols: 2, rows: 2, slotW: 480,  slotH: 600,  margin: 50, gap: 20, footer: 260 }) },
};

// ---------------------------------------------------------
//  Frames: photobooth strip papers + wedding palettes
// ---------------------------------------------------------
const FRAMES = [
  // Classic booth strips
  { id: "booth",     name: "Classic Booth", type: "theme", bg: "#ffffff", text: "#1a1a1a", sub: "#707070" },
  { id: "darkroom",  name: "Darkroom",      type: "theme", bg: "#0e0e0e", text: "#ffffff", sub: "#8c8c8c" },
  { id: "35mm",      name: "35mm Film",     type: "theme", bg: "#111111", text: "#f2e6c9", sub: "#9a8f78", film: true },
  { id: "kraft",     name: "Kraft Paper",   type: "theme", bg: "#c9a47c", text: "#3e2a1c", sub: "#5e4532" },
  { id: "curtain",   name: "Red Curtain",   type: "theme", bg: "#b3261e", text: "#fff4e0", sub: "#ffd9c7", gradient: "#7f1a14" },

  // Wedding palettes
  { id: "emerald",   name: "Emerald & Gold", type: "theme", bg: "#0f4c3a", text: "#e6c77a", sub: "#cdb88a", gradient: "#0a3529" },
  { id: "burgundy",  name: "Burgundy",       type: "theme", bg: "#7a1f2b", text: "#f3d9a4", sub: "#e8c6c0", gradient: "#55141d" },
  { id: "champagne", name: "Champagne",      type: "theme", bg: "#efe2cc", text: "#7a5a35", sub: "#9c7f5c", gradient: "#e0caa6" },
  { id: "rose",      name: "Dusty Rose",     type: "theme", bg: "#d8a7a7", text: "#fffaf6", sub: "#fbe6e3", gradient: "#c08588" },
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
];

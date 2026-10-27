// =========================================================
//  SETTINGS - change these for your sister's wedding
// =========================================================
const CONFIG = {
  // Text printed on every photo
  TITLE:    "Walimatul Urus",
  COUPLE:   "Pengantin Lelaki & Pengantin Perempuan",
  DATE:     "dd . mm . yyyy",

  // Paste your Google Apps Script "Web app" URL here (see README.md).
  // Leave empty to run without uploads (save-to-phone still works).
  SCRIPT_URL: "",

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
//  Frames
//  - "theme" frames below are drawn by code and work with EVERY layout.
//  - Your Canva PNGs: just drop them into frames/ and push to GitHub.
//    The photo windows + layout are found automatically and saved in
//    frames/frames.json (edit that file to fine-tune names or positions).
// ---------------------------------------------------------
const FRAMES = [
  { id: "noir",  name: "Noir",  type: "theme", bg: "#141211", text: "#f4ede4", sub: "#b9aea3" },
  { id: "ivory", name: "Ivory", type: "theme", bg: "#faf6ef", text: "#6b4f3f", sub: "#a08878" },
  { id: "blush", name: "Blush", type: "theme", bg: "#d99aa1", text: "#fff8f4", sub: "#fde9e6", gradient: "#c97b84" },
  { id: "sage",  name: "Sage",  type: "theme", bg: "#a9b79a", text: "#fbfaf5", sub: "#eef1e7", gradient: "#8e9f7f" },
  { id: "film",  name: "Film",  type: "theme", bg: "#0c0c0c", text: "#f2f2f2", sub: "#9a9a9a", film: true },
];

// ---------------------------------------------------------
//  Filters. Same recipe is used for the live preview (CSS) and
//  for the saved photo (pixel maths), so what you see = what you get.
// ---------------------------------------------------------
const FILTERS = [
  { id: "none",    name: "Original", ops: [] },
  { id: "classic", name: "Classic",  ops: [["grayscale", 1], ["contrast", 1.35], ["brightness", 1.05]] },
  { id: "mono",    name: "Soft B&W", ops: [["grayscale", 1], ["contrast", 0.95], ["brightness", 1.1]] },
  { id: "warm",    name: "Warm",     ops: [["sepia", 0.25], ["saturate", 1.2], ["brightness", 1.05]] },
  { id: "vintage", name: "Vintage",  ops: [["sepia", 0.5], ["contrast", 0.9], ["brightness", 1.1], ["saturate", 0.8]] },
  { id: "dreamy",  name: "Dreamy",   ops: [["brightness", 1.12], ["contrast", 0.88], ["saturate", 0.85]] },
  { id: "pop",     name: "Pop",      ops: [["saturate", 1.4], ["contrast", 1.1]] },
];

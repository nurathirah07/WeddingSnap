// =========================================================
//  Finds the photo window(s) in a frame image.
//  Shared by tools/build-frames.mjs (on GitHub) and admin.html
//  (instant preview), so both always agree.
//
//  A "window" is a big rectangle that is either:
//   - transparent  → photo goes UNDER the frame (overlay)
//   - a different colour from the frame's background (white box,
//     Canva placeholder picture...) → photo is drawn ON TOP of it
// =========================================================
const MIN_AREA = 0.02;   // a window is at least 2% of the frame
const MIN_FILL = 0.85;   // ...and fills most of its bounding box (= rectangle-ish)

// Image types a frame can be. PNG / WebP / GIF / AVIF / SVG can have
// see-through windows; JPG can't, so its windows must be a different
// colour from the frame. (Compression noise in JPG / WebP is too small to
// matter: tested down to quality 70.)
export const FRAME_FILE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

// image = { width, height, data } with RGBA bytes (ImageData, pngjs or sharp)
export function findWindows({ width, height, data }) {
  const step = Math.max(2, Math.round(Math.max(width, height) / 1000));   // check every Nth pixel
  const gw = Math.ceil(width / step), gh = Math.ceil(height / step);
  const px = (x, y) => (y * width + x) * 4;

  // Background = the most common colour around the edge
  const counts = {};
  const bump = (x, y) => {
    const i = px(x, y);
    const key = [data[i], data[i + 1], data[i + 2], data[i + 3] > 127 ? 1 : 0].join(",");
    counts[key] = (counts[key] || 0) + 1;
  };
  for (let x = 0; x < width; x += step) { bump(x, 0); bump(x, height - 1); }
  for (let y = 0; y < height; y += step) { bump(0, y); bump(width - 1, y); }
  const bg = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);

  // Mark every grid cell that is NOT background (or is transparent)
  const mask = new Uint8Array(gw * gh);
  const clear = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = px(Math.min(gx * step, width - 1), Math.min(gy * step, height - 1));
      const transparent = data[i + 3] < 128;
      const diff = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      if (transparent ? bg[3] === 1 : diff > 12) {
        mask[gy * gw + gx] = 1;
        clear[gy * gw + gx] = transparent ? 1 : 0;
      }
    }
  }

  // Group touching cells (flood fill), keep the big rectangular groups
  const seen = new Uint8Array(gw * gh);
  const slots = [];
  let transparentCells = 0, totalCells = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minX = gw, minY = gh, maxX = 0, maxY = 0, area = 0, clearCount = 0;
    while (stack.length) {
      const c = stack.pop();
      const x = c % gw, y = (c - x) / gw;
      area++; clearCount += clear[c];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const n of [c - 1, c + 1, c - gw, c + gw]) {
        if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue;
        if ((n === c - 1 && x === 0) || (n === c + 1 && x === gw - 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
    if (area < MIN_AREA * gw * gh || area / boxArea < MIN_FILL) continue;

    // Rounded corners: how far in from the left does the top row start?
    let r = 0;
    while (r < (maxX - minX) / 4 && !mask[minY * gw + minX + r]) r++;

    slots.push({ x: minX * step, y: minY * step, w: (maxX - minX + 1) * step, h: (maxY - minY + 1) * step, r: r * step });
    transparentCells += clearCount;
    totalCells += area;
  }

  // Reading order: top to bottom, then left to right
  slots.sort((a, b) => (Math.abs(a.y - b.y) > a.h / 2 ? a.y - b.y : a.x - b.x));
  return { slots, transparent: totalCells > 0 && transparentCells / totalCells > 0.5 };
}

// Number + arrangement of windows → which layout the frame belongs to
export function pickLayout(slots, id) {
  const cols = new Set(slots.map((s) => Math.round(s.x / 50))).size;
  if (slots.length === 1) return "single";
  if (slots.length === 2 && cols === 1) return "strip2";
  if (slots.length === 3 && cols === 1) return "strip3";
  if (slots.length === 4) return cols === 2 ? "grid4" : "strip4";
  return id;   // unusual shape: the app makes a layout just for this frame
}

const withoutExt = (file) => file.replace(FRAME_FILE, "");

// "rose-gold_frame.jpg" → "Rose Gold Frame"
export function prettyName(file) {
  return withoutExt(file).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// "Rose Gold.png" → "png-rose-gold", "Rose Gold.jpg" → "png-rose-gold-jpg"
// (PNG ids stay as they always were; other types get their extension so
// "Rose Gold.png" and "Rose Gold.jpg" can both exist)
export function frameId(file) {
  const ext = (file.match(FRAME_FILE) || ["", "png"])[1].toLowerCase();
  const id = "png-" + withoutExt(file).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return ext === "png" ? id : id + "-" + ext;
}

// =========================================================
//  Finds the photo window(s) in a frame image.
//  Shared by tools/build-frames.mjs (on GitHub) and admin.html
//  (instant preview), so both always agree.
//
//  A "window" is a big rectangle that is either:
//   - transparent  → photo goes UNDER the frame (overlay)
//   - a different colour from the frame's background (white box,
//     Canva placeholder picture...) → photo is drawn ON TOP of it
//   - one flat colour INSIDE something else, e.g. the black square of
//     a Polaroid, or white boxes on a busy collage → photo ON TOP of it.
//     These may be tilted: the slot then gets an `angle` (degrees,
//     clockwise) and x/y/w/h describe the rectangle before turning,
//     around its centre.
// =========================================================
const MIN_AREA = 0.02;   // a window is at least 2% of the frame
const MIN_FILL = 0.85;   // ...and fills most of its (possibly tilted) box = rectangle-ish
const FLAT = 40;         // colours this close to each other count as "one flat colour"
const MAX_TILT = 30;     // tilted windows: up to this many degrees

// Image types a frame can be. PNG / WebP / GIF / AVIF / SVG can have
// see-through windows; JPG can't, so its windows must be a different
// colour from the frame. (Compression noise in JPG / WebP is too small to
// matter: tested down to quality 70.)
export const FRAME_FILE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

// image = { width, height, data } with RGBA bytes (ImageData, pngjs or sharp)
export function findWindows({ width, height, data }) {
  const step = Math.max(2, Math.round(Math.max(width, height) / 1000));   // check every Nth pixel
  const gw = Math.ceil(width / step), gh = Math.ceil(height / step);
  const cells = gw * gh;

  // One colour sample per grid cell
  const R = new Uint8Array(cells), G = new Uint8Array(cells), B = new Uint8Array(cells), A = new Uint8Array(cells);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = (Math.min(gy * step, height - 1) * width + Math.min(gx * step, width - 1)) * 4;
      const c = gy * gw + gx;
      R[c] = data[i]; G[c] = data[i + 1]; B[c] = data[i + 2]; A[c] = data[i + 3];
    }
  }
  const grid = { gw, gh, R, G, B, A };

  const shapes = differentFromBackground(grid);   // the classic way
  const flat = flatAreas(grid);                    // flat colour inside something else

  // A flat area replaces the shape around it when it sits fully inside,
  // with a border on every side (a Polaroid → its black square). Flat
  // patches that touch the shape's edge are part of the picture instead
  // (e.g. the sky in a Canva placeholder photo), so those don't count.
  const used = new Set();
  const windows = [];
  for (const s of shapes) {
    const inside = flat.filter((f) => !used.has(f) &&
      f.minX > s.minX + 1 && f.maxX < s.maxX - 1 && f.minY > s.minY + 1 && f.maxY < s.maxY - 1);
    const insideArea = inside.reduce((sum, f) => sum + f.area, 0);
    if (inside.length && insideArea >= 0.25 * s.area) {
      inside.forEach((f) => { used.add(f); windows.push(f); });
    } else {
      windows.push(s);
    }
  }
  // Flat areas outside every shape (tilted Polaroids, collages...)
  for (const f of flat) {
    if (used.has(f)) continue;
    const cx = (f.minX + f.maxX) / 2, cy = (f.minY + f.maxY) / 2;
    if (shapes.some((s) => cx >= s.minX && cx <= s.maxX && cy >= s.minY && cy <= s.maxY)) continue;
    windows.push(f);
  }

  // Grid cells → pixels
  const slots = windows.map((w) => {
    if (w.angle === undefined) {   // straight rectangle
      return { x: w.minX * step, y: w.minY * step, w: (w.maxX - w.minX + 1) * step, h: (w.maxY - w.minY + 1) * step, r: w.r * step };
    }
    // flat colour: its outer ring of cells isn't "solid" (see flatAreas),
    // so add it back - plus a little extra, so no thin edge of the
    // placeholder colour shows next to the photo
    const ww = (w.w + 2.5) * step, hh = (w.h + 2.5) * step;
    const cx = (w.cx + 0.5) * step, cy = (w.cy + 0.5) * step;
    const slot = { x: Math.round(cx - ww / 2), y: Math.round(cy - hh / 2), w: Math.round(ww), h: Math.round(hh), r: 0 };
    if (w.angle) slot.angle = Math.round(w.angle * 10) / 10;
    return slot;
  });

  // Reading order: top to bottom, then left to right
  slots.sort((a, b) => (Math.abs(a.y - b.y) > a.h / 2 ? a.y - b.y : a.x - b.x));

  // Transparent windows: the photo goes under the frame
  const classic = windows.filter((w) => w.angle === undefined);
  const clearCells = classic.reduce((sum, w) => sum + w.clear, 0);
  const transparent = classic.length === windows.length && windows.length > 0 &&
    clearCells / classic.reduce((sum, w) => sum + w.area, 0) > 0.5;
  return { slots, transparent };
}

// ---------------------------------------------------------
// The classic way: everything that isn't the background colour (or is
// transparent), grouped into straight rectangles.
// ---------------------------------------------------------
function differentFromBackground({ gw, gh, R, G, B, A }) {
  const cells = gw * gh;

  // Background = the most common colour around the edge
  const counts = {};
  const bump = (c) => {
    const key = [R[c], G[c], B[c], A[c] > 127 ? 1 : 0].join(",");
    counts[key] = (counts[key] || 0) + 1;
  };
  for (let x = 0; x < gw; x++) { bump(x); bump((gh - 1) * gw + x); }
  for (let y = 0; y < gh; y++) { bump(y * gw); bump(y * gw + gw - 1); }
  const bg = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);

  // Mark every grid cell that is NOT background (or is transparent)
  const mask = new Uint8Array(cells);
  const clear = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) {
    const transparent = A[c] < 128;
    const diff = Math.abs(R[c] - bg[0]) + Math.abs(G[c] - bg[1]) + Math.abs(B[c] - bg[2]);
    if (transparent ? bg[3] === 1 : diff > 12) {
      mask[c] = 1;
      clear[c] = transparent ? 1 : 0;
    }
  }

  // Group touching cells (flood fill), keep the big rectangular groups
  const shapes = [];
  const seen = new Uint8Array(cells);
  for (let start = 0; start < cells; start++) {
    if (!mask[start] || seen[start]) continue;
    const group = flood(gw, gh, start, seen, (n) => mask[n]);
    const { minX, minY, maxX, maxY, area } = group;
    const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
    if (area < MIN_AREA * cells || area / boxArea < MIN_FILL) continue;

    // Rounded corners: how far in from the left does the top row start?
    let r = 0;
    while (r < (maxX - minX) / 4 && !mask[minY * gw + minX + r]) r++;
    const clearCount = group.list.reduce((sum, c) => sum + clear[c], 0);
    shapes.push({ minX, minY, maxX, maxY, area, r, clear: clearCount });
  }
  return shapes;
}

// ---------------------------------------------------------
// Areas of one flat colour that don't touch the edge of the image and
// are rectangles (maybe tilted): the black square of a Polaroid, white
// boxes on a collage...
// ---------------------------------------------------------
function flatAreas({ gw, gh, R, G, B, A }) {
  const cells = gw * gh;
  const near = (a, b) => Math.abs(R[a] - R[b]) + Math.abs(G[a] - G[b]) + Math.abs(B[a] - B[b]) <= FLAT;

  // "Solid" cells: the same colour as all four neighbours. Thin lines
  // (text, outlines) never are, so they can't join a window to something
  // else - e.g. a watermark touching a white box.
  const solid = new Uint8Array(cells);
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const c = y * gw + x;
      if (A[c] >= 128 && near(c, c - 1) && near(c, c + 1) && near(c, c - gw) && near(c, c + gw)) solid[c] = 1;
    }
  }

  const seen = new Uint8Array(cells);
  const out = [];
  for (let start = 0; start < cells; start++) {
    if (seen[start] || !solid[start]) continue;
    const group = flood(gw, gh, start, seen, (n) => solid[n] && near(n, start));
    // solid cells stop one cell short of the image edge
    group.touchesEdge = group.minX <= 1 || group.minY <= 1 || group.maxX >= gw - 2 || group.maxY >= gh - 2;
    if (group.area < MIN_AREA * cells || group.touchesEdge) continue;

    const box = tiltedBox(group, gw);
    if (group.area / box.area < MIN_FILL) continue;
    out.push({ ...box, minX: group.minX, minY: group.minY, maxX: group.maxX, maxY: group.maxY, area: group.area });
  }
  return out;
}

// The smallest rectangle (turned up to MAX_TILT degrees) around a group of
// cells. Only the group's outline is needed to measure it.
function tiltedBox(group, gw) {
  const inGroup = new Set(group.list);
  const pts = [];
  for (const c of group.list) {
    if (!inGroup.has(c - 1) || !inGroup.has(c + 1) || !inGroup.has(c - gw) || !inGroup.has(c + gw)) {
      const x = c % gw;
      pts.push(x, (c - x) / gw);
    }
  }
  let best = null;
  for (let deg = -MAX_TILT; deg <= MAX_TILT; deg += 0.5) {
    const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const u = pts[i] * cos + pts[i + 1] * sin;
      const v = -pts[i] * sin + pts[i + 1] * cos;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0 + 1) * (v1 - v0 + 1);
    // prefer straight when it's (almost) as tight
    if (!best || area < best.area * (deg === 0 ? 1.02 : 0.995)) best = { deg, a, u0, u1, v0, v1, area };
  }
  const { deg, a, u0, u1, v0, v1, area } = best;
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  return {
    angle: Math.abs(deg) < 1 ? 0 : deg,   // tiny tilts are just pixels: keep it straight
    cx: uc * Math.cos(a) - vc * Math.sin(a),
    cy: uc * Math.sin(a) + vc * Math.cos(a),
    w: u1 - u0 + 1,
    h: v1 - v0 + 1,
    area,
  };
}

// Flood fill from `start` over neighbours that pass `joins`
function flood(gw, gh, start, seen, joins) {
  const list = [start];
  seen[start] = 1;
  let minX = gw, minY = gh, maxX = 0, maxY = 0, touchesEdge = false;
  for (let k = 0; k < list.length; k++) {
    const c = list[k];
    const x = c % gw, y = (c - x) / gw;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) touchesEdge = true;
    if (x > 0 && !seen[c - 1] && joins(c - 1)) { seen[c - 1] = 1; list.push(c - 1); }
    if (x < gw - 1 && !seen[c + 1] && joins(c + 1)) { seen[c + 1] = 1; list.push(c + 1); }
    if (y > 0 && !seen[c - gw] && joins(c - gw)) { seen[c - gw] = 1; list.push(c - gw); }
    if (y < gh - 1 && !seen[c + gw] && joins(c + gw)) { seen[c + gw] = 1; list.push(c + gw); }
  }
  return { list, area: list.length, minX, minY, maxX, maxY, touchesEdge };
}

// Number + arrangement of windows → which layout the frame belongs to
export function pickLayout(slots, id) {
  const cols = new Set(slots.map((s) => Math.round(s.x / 50))).size;
  if (slots.some((s) => s.angle)) return slots.length === 1 ? "single" : id;   // tilted: its own layout
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

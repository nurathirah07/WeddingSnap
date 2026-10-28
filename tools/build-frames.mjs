// =========================================================
//  Scans frames/ for frame images (PNG, JPG, WebP, GIF, AVIF, SVG),
//  finds the photo window(s) in each one and writes
//  frames/frames.json (which the app reads).
//  The detection itself lives in js/frame-detect.js (shared with
//  admin.html).
//
//  The number of windows decides the layout:
//   1 → Single, 2 → 2-Grid, 3 → 3-Cut, 4 → 4-Cut (or 4-Grid if 2×2).
//   Anything else gets its own layout.
//
//  Frames that haven't changed keep their old entry, so you can
//  hand-edit frames.json and it won't be overwritten.
// =========================================================
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import sharp from "sharp";
import { findWindows, pickLayout, prettyName, frameId, FRAME_FILE } from "../js/frame-detect.js";

const DIR = "frames";
const OUT_FILE = path.join(DIR, "frames.json");
const MAX_SIZE = 2400;   // big Canva exports are scaled down to this (longest side)

const old = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, "utf8")).frames : [];
const files = fs.readdirSync(DIR).filter((f) => FRAME_FILE.test(f)).sort();

// The image as RGBA pixels: { width, height, data }
async function readPixels(src) {
  if (/\.png$/i.test(src)) return PNG.sync.read(fs.readFileSync(src));
  // SVG has no pixels of its own: draw it at a sharp size first
  const image = /\.svg$/i.test(src) ? sharp(src, { density: 300 }) : sharp(src, { animated: false });
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}
const frames = [];

for (const file of files) {
  const src = DIR + "/" + file;
  const bytes = fs.statSync(src).size;
  const before = old.find((f) => f.src === src && f.bytes === bytes);
  if (before) {
    console.log(`✓ ${file} (unchanged)`);
    frames.push(before);
    continue;
  }

  let png;
  try {
    png = await readPixels(src);
  } catch (err) {
    console.warn(`⚠ ${file}: can't read this image (${err.message}) - export it as PNG or JPG`);
    continue;
  }
  const found = findWindows(png);
  if (!found.slots.length) {
    console.warn(`⚠ ${file}: no photo window found - make the photo area transparent or a plain colour`);
    continue;
  }

  const scale = Math.min(1, MAX_SIZE / Math.max(png.width, png.height));
  const s = (v) => Math.round(v * scale);
  const slots = found.slots.map((w) => ({
    x: s(w.x), y: s(w.y), w: s(w.w), h: s(w.h), r: s(w.r),
    ...(w.angle ? { angle: w.angle } : {}),   // tilted window (degrees, clockwise)
  }));
  const id = frameId(file);

  const frame = {
    id,
    name: prettyName(file),
    src,
    bytes,
    layout: pickLayout(slots, id),
    width: s(png.width),
    height: s(png.height),
    overlay: found.transparent,
    slots,
  };
  console.log(`▣ ${file}  ${frame.slots.length} window(s) → ${frame.layout}${frame.overlay ? " (transparent)" : ""}`);
  frames.push(frame);
}

fs.writeFileSync(OUT_FILE, JSON.stringify({ frames }, null, 2) + "\n");
console.log(`\nWrote ${OUT_FILE} with ${frames.length} frame(s).`);

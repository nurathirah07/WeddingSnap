// =========================================================
//  Scans music/ for mp3s, finds the chorus of each one and writes
//  music/songs.json (which the app reads).
//
//  Runs automatically on GitHub when you push (see .github/workflows).
//  To run it on your computer:  npm install  then  npm run music
//
//  Songs that haven't changed keep their old highlights, so you can
//  hand-edit "highlights" in songs.json and they won't be overwritten.
//
//  Each song also gets a "seek" table: where every 2 seconds of audio
//  starts inside the mp3 file (in bytes). The app uses it to download
//  only the chorus clip it is about to play, not the whole song.
// =========================================================
import fs from "node:fs";
import path from "node:path";
import { MPEGDecoder } from "mpg123-decoder";

const MUSIC_DIR = "music";
const OUT_FILE  = path.join(MUSIC_DIR, "songs.json");

const WINDOW  = 0.5;   // loudness measured every 0.5 s
const SECTION = 12;    // a "chorus" = loudest 12 s stretch
const MIN_GAP = 40;    // highlights at least 40 s apart
const LEAD_IN = 3;     // start 3 s before the loud part, so it builds up
const SEEK_STEP = 2;  // seek table: one byte position every 2 s

// Previous results, so unchanged songs are skipped
const old = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, "utf8")).songs : [];

const files = fs.readdirSync(MUSIC_DIR).filter((f) => /\.mp3$/i.test(f)).sort();
const songs = [];

for (const file of files) {
  const src = MUSIC_DIR + "/" + file;
  if (/[#?%]/.test(file)) {
    console.warn(`⚠ Skipping "${file}": rename it without # ? or %`);
    continue;
  }
  const bytes = fs.statSync(src).size;
  const cover = findCover(file);
  const before = old.find((s) => s.src === src && s.bytes === bytes);
  if (before) {
    console.log(`✓ ${file} (unchanged)`);
    // Seek table is quick to make (no decoding), so older entries just get one
    songs.push(withCover({ ...before, seek: before.seek || seekTable(src) }, cover));
    continue;
  }

  const { loud, duration } = await measureLoudness(src);
  const highlights = findHighlights(loud, duration);
  console.log(`♪ ${file}  ${fmt(duration)}  highlights: ${highlights.map(fmt).join(", ")}`);
  songs.push(withCover({ src, bytes, duration: Math.round(duration), highlights, seek: seekTable(src) }, cover));
}

// Cover art for the spinning CD: an image with the same name as the song,
// e.g. "Hari Ini.jpg" next to "Hari Ini.mp3"
function findCover(file) {
  const base = file.replace(/\.mp3$/i, "");
  const ext = [".jpg", ".jpeg", ".png", ".webp"].find((e) => fs.existsSync(path.join(MUSIC_DIR, base + e)));
  return ext ? MUSIC_DIR + "/" + base + ext : null;
}

function withCover(song, cover) {
  const { cover: _, ...rest } = song;
  return cover ? { ...rest, cover } : rest;
}

// Number lists on one line each, so the file stays small and readable
const json = JSON.stringify({ seekStep: SEEK_STEP, songs }, null, 2)
  .replace(/\[\s+([\d,\s]+?)\s+\]/g, (m, list) => "[" + list.replace(/\s+/g, "") + "]");
fs.writeFileSync(OUT_FILE, json + "\n");
console.log(`\nWrote ${OUT_FILE} with ${songs.length} song(s).`);

// ---------------------------------------------------------
// Seek table: walk the mp3's frame headers (no decoding needed) and note
// the byte where each 2 s step begins. MP3 audio is a chain of small
// frames (~26 ms each), and the header of each one gives its length.
// ---------------------------------------------------------
function seekTable(file) {
  const d = fs.readFileSync(file);
  let p = 0;
  // Skip the ID3 tag (title, artist, cover picture…) at the start
  if (d.toString("latin1", 0, 3) === "ID3") {
    p = 10 + (((d[6] & 0x7f) << 21) | ((d[7] & 0x7f) << 14) | ((d[8] & 0x7f) << 7) | (d[9] & 0x7f));
    if (d[5] & 0x10) p += 10;   // footer
  }
  const KBPS = {
    v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],   // MPEG-1 layer III
    v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],        // MPEG-2 / 2.5 layer III
  };
  const RATE = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

  const seek = [];
  let time = 0;
  while (p + 4 <= d.length) {
    const ver = (d[p + 1] >> 3) & 3, layer = (d[p + 1] >> 1) & 3;
    const bri = d[p + 2] >> 4, sri = (d[p + 2] >> 2) & 3, pad = (d[p + 2] >> 1) & 1;
    const ok = d[p] === 0xff && (d[p + 1] & 0xe0) === 0xe0 && ver !== 1 && layer === 1 &&
               bri > 0 && bri < 15 && sri < 3;
    if (!ok) { p++; continue; }   // not a frame header: keep looking
    const v1 = ver === 3;
    const rate = RATE[ver][sri];
    const size = Math.floor((v1 ? 144 : 72) * KBPS[v1 ? "v1" : "v2"][bri] * 1000 / rate) + pad;
    while (time >= seek.length * SEEK_STEP) seek.push(p);
    time += (v1 ? 1152 : 576) / rate;
    p += size;
  }
  return seek;
}

// ---------------------------------------------------------
// Decode the mp3 bit by bit and keep only the loudness (RMS)
// of every 0.5 s window, so long files don't eat memory.
// ---------------------------------------------------------
async function measureLoudness(file) {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  const data = fs.readFileSync(file);

  const loud = [];
  let rate = 0, step = 0, sum = 0, count = 0, inWindow = 0, total = 0;

  for (let i = 0; i < data.length; i += 64 * 1024) {
    const { channelData, samplesDecoded, sampleRate } = decoder.decode(data.subarray(i, i + 64 * 1024));
    if (!samplesDecoded) continue;
    if (!rate) { rate = sampleRate; step = Math.floor(rate * WINDOW); }
    total += samplesDecoded;

    for (let n = 0; n < samplesDecoded; n++) {
      if (n % 4 === 0) {   // every 4th sample is plenty for loudness
        for (const ch of channelData) { sum += ch[n] * ch[n]; count++; }
      }
      if (++inWindow === step) {
        loud.push(Math.sqrt(sum / Math.max(1, count)));
        sum = 0; count = 0; inWindow = 0;
      }
    }
  }
  decoder.free();
  return { loud, duration: total / (rate || 44100) };
}

// Same idea as tools/find-highlights.html
function findHighlights(loud, duration) {
  // Average loudness of each 12 s stretch
  const n = Math.round(SECTION / WINDOW);
  const avg = loud.map((_, i) => {
    if (i + n > loud.length) return 0;
    let s = 0;
    for (let k = i; k < i + n; k++) s += loud[k];
    return s / n;
  });

  // Loudest stretches, spaced apart, skipping intro/outro
  const skipStart = 10 / WINDOW, skipEnd = loud.length - 15 / WINDOW;
  const order = avg.map((v, i) => i).filter((i) => i > skipStart && i < skipEnd).sort((a, b) => avg[b] - avg[a]);
  const max = avg[order[0]] || 0;
  const maxPicks = Math.min(8, Math.max(1, Math.round(duration / 100)));
  const picks = [];
  for (const i of order) {
    if (avg[i] < max * 0.8 || picks.length >= maxPicks) break;
    if (picks.every((p) => Math.abs(p - i) * WINDOW >= MIN_GAP)) picks.push(i);
  }
  return picks.sort((a, b) => a - b).map((i) => Math.max(0, Math.round(i * WINDOW - LEAD_IN)));
}

function fmt(sec) {
  return Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
}

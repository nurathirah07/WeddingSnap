// =========================================================
//  Scans music/ for mp3s, finds the chorus of each one and writes
//  music/songs.json (which the app reads).
//
//  Runs automatically on GitHub when you push (see .github/workflows).
//  To run it on your computer:  npm install  then  npm run music
//
//  Songs that haven't changed keep their old highlights, so you can
//  hand-edit "highlights" in songs.json and they won't be overwritten.
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
  const before = old.find((s) => s.src === src && s.bytes === bytes);
  if (before) {
    console.log(`✓ ${file} (unchanged)`);
    songs.push(before);
    continue;
  }

  const { loud, duration } = await measureLoudness(src);
  const highlights = findHighlights(loud, duration);
  console.log(`♪ ${file}  ${fmt(duration)}  highlights: ${highlights.map(fmt).join(", ")}`);
  songs.push({ src, bytes, duration: Math.round(duration), highlights });
}

fs.writeFileSync(OUT_FILE, JSON.stringify({ songs }, null, 2) + "\n");
console.log(`\nWrote ${OUT_FILE} with ${songs.length} song(s).`);

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

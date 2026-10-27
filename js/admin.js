// =========================================================
//  Admin page: add / remove songs and frames.
//  Files are committed to the GitHub repo through the GitHub API.
//  The GitHub Action (.github/workflows/deploy.yml) then finds the
//  chorus + photo windows and republishes the site.
// =========================================================
import { findWindows, pickLayout, frameId } from "./frame-detect.js?v=dev";

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "weddingsnap.admin.token";
const REPO_KEY  = "weddingsnap.admin.repo";

let repo = "", token = "", branch = "main";
let songs = [];    // { name, path, size, info, status: "live" | "new" | "delete", file, cut }
                   // cut = Set of chorus times (seconds) marked for removal
let liveSongList = { seekStep: 2, songs: [] };   // music/songs.json as the live site has it
let frames = [];   // { name, path, size, info, status, file, preview }
// Wedding details: what's saved in settings.json, and what's in the boxes now
let liveDetails = { title: "", couple: "", date: "" };
const DETAIL_INPUTS = { title: "setTitle", couple: "setCouple", date: "setDate" };
const player = new Audio();

// =========================================================
//  Small helpers
// =========================================================
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3000);
}

const fmtTime = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const fmtSize = (b) => (b / 1024 / 1024).toFixed(1) + " MB";
const songTitle = (file) => file.replace(/\.mp3$/i, "").replace(/\[.*?\]\s*/g, "").trim();

// Characters that break web links are removed from file names
const safeName = (name) => name.replace(/[#?%\\/]/g, "").trim();

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// =========================================================
//  GitHub API
// =========================================================
async function gh(path, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.message || res.statusText);
    e.status = res.status;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

async function listFolder(folder) {
  try {
    return await gh(`/contents/${folder}?ref=${branch}`);
  } catch (e) {
    if (e.status === 404) return [];   // folder doesn't exist yet
    throw e;
  }
}

// What the live site currently knows (chorus times, photo windows).
// Always ask the GitHub Pages site: the build only writes these files
// there, so a local copy (localhost) is out of date.
function liveSite() {
  if (/\.github\.io$/.test(location.hostname)) return "";
  const [owner, name] = repo.split("/");
  const host = owner.toLowerCase() + ".github.io";
  return name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
}

async function liveData(path) {
  try {
    const res = await fetch(liveSite() + path, { cache: "no-cache" });
    return await res.json();
  } catch (e) {
    return {};
  }
}
const liveJson = async (path, key) => (await liveData(path))[key] || [];

// =========================================================
//  Connect
// =========================================================
function guessRepo() {
  const saved = localStorage.getItem(REPO_KEY);
  if (saved) return saved;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);   // user.github.io/Repo/
  if (!m) return "";
  const first = location.pathname.split("/").filter(Boolean)[0];
  return m[1] + "/" + (first && !first.includes(".") ? first : m[1] + ".github.io");
}

$("repoInput").value = guessRepo();
const savedToken = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
if (savedToken) {
  $("tokenInput").value = savedToken;
  connect();
}

$("connectBtn").addEventListener("click", connect);

async function connect() {
  // Accept "user/repo", "https://github.com/user/repo" or ".../repo.git"
  repo  = $("repoInput").value.trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  $("repoInput").value = repo;
  token = $("tokenInput").value.trim();
  $("connectError").textContent = "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) {
    $("connectError").textContent = "Fill in the repository (username/repo) and token.";
    return;
  }
  $("connectBtn").disabled = true;
  $("connectBtn").textContent = "Connecting…";
  try {
    const info = await gh("");
    if (!info.permissions || !info.permissions.push) throw new Error("This token can't write to the repo. Give it Contents: Read and write.");
    branch = info.default_branch;

    const store = $("rememberInput").checked ? localStorage : sessionStorage;
    store.setItem(TOKEN_KEY, token);
    localStorage.setItem(REPO_KEY, repo);

    $("repoName").textContent = repo;
    $("connectCard").classList.add("hidden");
    $("library").classList.remove("hidden");
    await loadLibrary();
  } catch (e) {
    $("connectError").textContent = e.status === 401 ? "Token is wrong or expired." :
                                    e.status === 404 ? "Repository not found (or the token doesn't have access to it)." :
                                    e.message;
  }
  $("connectBtn").disabled = false;
  $("connectBtn").textContent = "Connect";
}

$("disconnectBtn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  location.reload();
});

// =========================================================
//  Load what's in the repo
// =========================================================
async function loadLibrary() {
  const [songFiles, frameFiles, songInfo, frameInfo] = await Promise.all([
    listFolder("music"), listFolder("frames"),
    liveData("music/songs.json").then((data) => {
      liveSongList = { seekStep: data.seekStep || 2, songs: data.songs || [] };
      return liveSongList.songs;
    }),
    liveJson("frames/frames.json", "frames"),
    loadDetails(),
  ]);

  songs = songFiles.filter((f) => /\.mp3$/i.test(f.name)).map((f) => ({
    name: f.name, path: f.path, size: f.size, status: "live",
    info: songInfo.find((s) => s.src === f.path),
  }));
  frames = frameFiles.filter((f) => /\.png$/i.test(f.name)).map((f) => ({
    name: f.name, path: f.path, size: f.size, status: "live", rawUrl: f.download_url,
    info: frameInfo.find((s) => s.src === f.path),
  }));
  render();
}

// =========================================================
//  Wedding details (settings.json in the repo)
// =========================================================
async function loadDetails() {
  let saved = {};
  try {
    const file = await gh(`/contents/settings.json?ref=${branch}`);
    const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
    saved = JSON.parse(new TextDecoder().decode(bytes));   // UTF-8 safe (é, emoji, Jawi…)
  } catch (e) {
    if (e.status !== 404) console.warn(e);   // 404 = never saved: use config.js
  }
  liveDetails = {
    title: saved.title || CONFIG.TITLE,
    couple: saved.couple || CONFIG.COUPLE,
    date: saved.date || CONFIG.DATE,
  };
  Object.entries(DETAIL_INPUTS).forEach(([key, id]) => { $(id).value = liveDetails[key]; });
  renderDetails();
}

function currentDetails() {
  const d = {};
  Object.entries(DETAIL_INPUTS).forEach(([key, id]) => { d[key] = $(id).value.trim(); });
  return d;
}

function detailsProblem() {
  const d = currentDetails();
  return !d.title ? "Fill in the title." : !d.couple ? "Fill in the couple's names." : "";
}

function detailsChanged() {
  const d = currentDetails();
  return !detailsProblem() && Object.keys(d).some((k) => d[k] !== liveDetails[k]);
}

function renderDetails() {
  const d = currentDetails();
  $("pvTitle").textContent = d.title;
  $("pvCouple").textContent = d.couple;
  $("pvDate").textContent = d.date;
  $("detailsError").textContent = detailsProblem();
}

Object.values(DETAIL_INPUTS).forEach((id) => $(id).addEventListener("input", () => {
  renderDetails();
  renderBar();
}));

// =========================================================
//  Adding files
// =========================================================
function addSongs(fileList) {
  for (const file of fileList) {
    if (!/\.mp3$/i.test(file.name)) { toast(file.name + " is not an mp3"); continue; }
    if (file.size > 50 * 1024 * 1024) { toast(file.name + " is too big (max 50 MB)"); continue; }
    const name = safeName(file.name);
    const path = "music/" + name;
    songs = songs.filter((s) => s.path !== path || s.status !== "new" || s.replacing);   // re-added: replace the staged copy
    const existing = songs.find((s) => s.path === path);
    if (existing) { existing.status = "new"; existing.file = file; existing.replacing = true; }
    else songs.push({ name, path, size: file.size, status: "new", file });
    if (file.size > 15 * 1024 * 1024) toast(name + " is big - guests stream it on mobile data");
  }
  render();
}

async function addFrames(fileList) {
  for (const file of fileList) {
    if (!/\.png$/i.test(file.name)) { toast(file.name + " is not a png"); continue; }
    const name = safeName(file.name);
    const path = "frames/" + name;
    const preview = await analyseFrame(file);
    frames = frames.filter((f) => f.path !== path || f.status !== "new" || f.replacing);   // re-added: replace the staged copy
    const existing = frames.find((f) => f.path === path);
    if (existing) Object.assign(existing, { status: "new", file, preview, replacing: true });
    else frames.push({ name, path, size: file.size, status: "new", file, preview });
  }
  render();
}

// Same detection GitHub will run, so the admin sees the result right away
async function analyseFrame(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { slots, transparent } = findWindows(ctx.getImageData(0, 0, c.width, c.height));
  return {
    url, width: c.width, height: c.height, slots, overlay: transparent,
    layout: slots.length ? pickLayout(slots, frameId(file.name)) : null,
  };
}

$("addSongs").addEventListener("change", (e) => { addSongs(e.target.files); e.target.value = ""; });
$("addFrames").addEventListener("change", (e) => { addFrames(e.target.files); e.target.value = ""; });

document.querySelectorAll(".dropZone").forEach((zone) => {
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    if (zone.dataset.kind === "song") addSongs(e.dataTransfer.files);
    else addFrames(e.dataTransfer.files);
  });
});

// =========================================================
//  Drawing the lists
// =========================================================
function render() {
  renderSongs();
  renderFrames();
  renderBar();
}

function statusBadge(item) {
  if (item.status === "new") return `<span class="badge new">${item.replacing ? "Replacing" : "New"}</span>`;
  if (item.status === "delete") return `<span class="badge del">Will be removed</span>`;
  if (!item.info) return `<span class="badge wait">Processing…</span>`;
  return "";
}

// Mark one chorus section for removal (or undo). Every song keeps at
// least one section - to drop a song completely, Remove the song.
function toggleSection(song, t) {
  song.cut = song.cut || new Set();
  if (song.cut.has(t)) song.cut.delete(t);
  else if (song.cut.size >= song.info.highlights.length - 1) {
    return toast("A song needs at least one section. To drop it completely, press Remove.");
  } else song.cut.add(t);
  render();
}

// Remove = mark for deletion (live files) or just forget (new files)
function toggleRemove(list, item) {
  if (item.status === "new" && !item.replacing) list.splice(list.indexOf(item), 1);
  else if (item.status === "new") { item.status = "live"; item.file = null; item.preview = null; item.replacing = false; }
  else item.status = item.status === "delete" ? "live" : "delete";
  render();
}

function renderSongs() {
  const ul = $("songList");
  ul.innerHTML = "";
  if (!songs.length) ul.innerHTML = '<li class="empty">No songs yet - the app plays a built-in melody.</li>';

  songs.forEach((song) => {
    const li = document.createElement("li");
    li.className = "song " + song.status;
    const kept = song.info ? song.info.highlights.filter((t) => !song.cut?.has(t)) : [];
    const detail = song.status === "new"
      ? fmtSize(song.size) + " · chorus is found after publishing"
      : song.info
        ? fmtTime(song.info.duration) + " · chorus at " + kept.map(fmtTime).join(", ") +
          (song.cut?.size ? ` · ${song.cut.size} section${song.cut.size > 1 ? "s" : ""} to remove` : "")
        : fmtSize(song.size);
    li.innerHTML = `
      <div class="songMain">
        <b>${songTitle(song.name)}</b> ${statusBadge(song)}
        <small>${detail}</small>
      </div>
      <div class="songBtns"></div>`;

    const btns = li.querySelector(".songBtns");
    const times = song.status === "new" ? [0] : song.info ? song.info.highlights : [0];
    // Chorus sections can be removed one by one (live songs only)
    const editable = song.status === "live" && song.info && song.info.highlights.length;
    times.forEach((t) => {
      const b = document.createElement("button");
      b.className = "mini";
      b.textContent = "▶ " + fmtTime(t);
      b.onclick = () => {
        player.src = song.file ? URL.createObjectURL(song.file) : encodeURI(song.path);
        player.currentTime = t;
        player.play().catch(() => toast("Can't play this yet - it goes live after publishing"));
      };
      if (!editable) { btns.appendChild(b); return; }

      const cut = song.cut?.has(t);
      const group = document.createElement("span");
      group.className = "section" + (cut ? " cut" : "");
      const x = document.createElement("button");
      x.className = "sectionX";
      x.textContent = cut ? "↺" : "×";
      x.title = cut ? "Keep this section" : "Remove this section";
      x.setAttribute("aria-label", (cut ? "Keep" : "Remove") + " the section at " + fmtTime(t));
      x.onclick = () => toggleSection(song, t);
      group.append(b, x);
      btns.appendChild(group);
    });
    const stop = document.createElement("button");
    stop.className = "mini";
    stop.textContent = "■";
    stop.onclick = () => player.pause();
    btns.appendChild(stop);

    const del = document.createElement("button");
    del.className = "mini danger";
    del.textContent = song.status === "delete" ? "Undo" : "Remove";
    del.onclick = () => toggleRemove(songs, song);
    btns.appendChild(del);
    ul.appendChild(li);
  });
}

function renderFrames() {
  const grid = $("frameGrid");
  grid.innerHTML = "";
  if (!frames.length) grid.innerHTML = '<p class="empty">No frames yet - the built-in themes are used.</p>';

  frames.forEach((frame) => {
    const geo = frame.preview || frame.info;   // detected windows to draw
    const card = document.createElement("div");
    card.className = "frameCard " + frame.status + (frame.preview && !frame.preview.slots.length ? " bad" : "");

    const canvas = document.createElement("canvas");
    card.appendChild(canvas);
    drawFrameThumb(canvas, frame, geo);

    const layoutName = !geo ? "" : !geo.slots.length ? "⚠ No photo area found"
      : (LAYOUTS[geo.layout] ? LAYOUTS[geo.layout].name : "Own layout") + " · " + geo.slots.length +
        (geo.slots.length === 1 ? " photo" : " photos");
    const info = document.createElement("div");
    info.className = "frameInfo";
    info.innerHTML = `<b>${frame.name.replace(/\.png$/i, "")}</b> ${statusBadge(frame)}<small>${layoutName}</small>`;
    if (frame.preview && !frame.preview.slots.length) {
      info.innerHTML += `<small class="error">Make the photo area transparent or one plain colour, then add it again.</small>`;
    }
    card.appendChild(info);

    const del = document.createElement("button");
    del.className = "mini danger";
    del.textContent = frame.status === "delete" ? "Undo" : "Remove";
    del.onclick = () => toggleRemove(frames, frame);
    card.appendChild(del);
    grid.appendChild(card);
  });
}

function drawFrameThumb(canvas, frame, geo) {
  const img = new Image();
  img.onload = () => {
    const W = geo ? geo.width : img.naturalWidth, H = geo ? geo.height : img.naturalHeight;
    const scale = 260 / H;
    canvas.width = Math.round(W * scale);
    canvas.height = 260;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (!geo) return;
    geo.slots.forEach((s, i) => {
      ctx.fillStyle = "rgba(201,123,132,0.55)";
      ctx.strokeStyle = "#a85f69";
      ctx.lineWidth = 2;
      ctx.fillRect(s.x * scale, s.y * scale, s.w * scale, s.h * scale);
      ctx.strokeRect(s.x * scale, s.y * scale, s.w * scale, s.h * scale);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px DM Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i + 1, (s.x + s.w / 2) * scale, (s.y + s.h / 2) * scale);
    });
  };
  // live site first; if it isn't deployed yet, GitHub's copy
  img.onerror = () => { if (frame.rawUrl && img.src !== frame.rawUrl) img.src = frame.rawUrl; };
  img.src = frame.preview ? frame.preview.url : encodeURI(frame.path);
}

// =========================================================
//  Publish = one commit with every change
// =========================================================
function pendingChanges() {
  const all = [...songs, ...frames];
  return {
    sections: songs.filter((s) => s.status === "live" && s.cut && s.cut.size),
    details: detailsChanged(),
    adds: all.filter((x) => x.status === "new" && !(x.preview && !x.preview.slots.length)),
    deletes: all.filter((x) => x.status === "delete"),
    broken: frames.filter((f) => f.status === "new" && f.preview && !f.preview.slots.length),
  };
}

function renderBar() {
  const { sections, details, adds, deletes, broken } = pendingChanges();
  const cuts = sections.reduce((sum, s) => sum + s.cut.size, 0);
  const n = adds.length + deletes.length + (details ? 1 : 0) + cuts;
  $("publishBar").classList.toggle("hidden", !n && !broken.length);
  const parts = [];
  if (details) parts.push("Wedding details changed");
  if (cuts) parts.push(cuts + (cuts === 1 ? " section" : " sections") + " to remove");
  if (adds.length) parts.push(adds.length + " to add");
  if (deletes.length) parts.push(deletes.length + " to remove");
  $("pendingCount").textContent = parts.join(" · ") || "Nothing to publish";
  $("publishStatus").textContent = broken.length
    ? broken.length + " frame(s) with no photo area will be skipped"
    : "Not live yet - press Publish";
  $("publishBtn").disabled = !n;
}

$("discardBtn").addEventListener("click", () => {
  if (!confirm("Discard all changes that aren't published?")) return;
  loadLibrary();
});

window.addEventListener("beforeunload", (e) => {
  const { sections, details, adds, deletes } = pendingChanges();
  if (sections.length || details || adds.length || deletes.length) e.preventDefault();
});

$("publishBtn").addEventListener("click", async () => {
  const { sections, details, adds, deletes } = pendingChanges();
  const newDetails = currentDetails();
  const status = $("publishStatus");
  $("publishBtn").disabled = true;
  $("discardBtn").disabled = true;

  try {
    // 1. Where the branch is now
    const ref = await gh(`/git/ref/heads/${branch}`);
    const head = await gh(`/git/commits/${ref.object.sha}`);

    // 2. Upload each new file
    const tree = [];
    for (let i = 0; i < adds.length; i++) {
      status.textContent = `Uploading ${i + 1} of ${adds.length}: ${adds[i].name}…`;
      const blob = await gh("/git/blobs", {
        method: "POST",
        body: JSON.stringify({ content: await fileToBase64(adds[i].file), encoding: "base64" }),
      });
      tree.push({ path: adds[i].path, mode: "100644", type: "blob", sha: blob.sha });
    }
    deletes.forEach((d) => tree.push({ path: d.path, mode: "100644", type: "blob", sha: null }));
    if (details) {
      tree.push({ path: "settings.json", mode: "100644", type: "blob",
                  content: JSON.stringify(newDetails, null, 2) + "\n" });
      // Same details as a script, for index.html opened straight from the folder
      tree.push({ path: "settings.js", mode: "100644", type: "blob",
                  content: "window.SETTINGS_DATA = " + JSON.stringify(newDetails, null, 2) + ";\n" });
    }
    // Removed chorus sections: write songs.json back without them. The
    // build keeps chorus times of songs that haven't changed, so they stay gone.
    if (sections.length) {
      const list = {
        seekStep: liveSongList.seekStep,
        songs: liveSongList.songs.map((s) => {
          const edited = sections.find((x) => x.path === s.src);
          return edited ? { ...s, highlights: s.highlights.filter((t) => !edited.cut.has(t)) } : s;
        }),
      };
      const json = JSON.stringify(list, null, 2)
        .replace(/\[\s+([\d,\s]+?)\s+\]/g, (m, nums) => "[" + nums.replace(/\s+/g, "") + "]");
      tree.push({ path: "music/songs.json", mode: "100644", type: "blob", content: json + "\n" });
      tree.push({ path: "music/songs.js", mode: "100644", type: "blob",
                  content: "window.SONGS_DATA = " + json + ";\n" });
    }

    // 3. One commit with everything, then move the branch to it
    status.textContent = "Saving…";
    const newTree = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
    const parts = [];
    if (details) parts.push("update wedding details");
    if (sections.length) parts.push("remove chorus sections from " + sections.map((s) => songTitle(s.name)).join(", "));
    if (adds.length) parts.push("add " + adds.map((a) => a.name).join(", "));
    if (deletes.length) parts.push("remove " + deletes.map((d) => d.name).join(", "));
    const commit = await gh("/git/commits", {
      method: "POST",
      body: JSON.stringify({ message: "Admin: " + parts.join("; "), tree: newTree.sha, parents: [ref.object.sha] }),
    });
    await gh(`/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });

    // Saved. Show it as "processing" until the site is rebuilt.
    if (details) liveDetails = newDetails;
    sections.forEach((s) => {
      s.info.highlights = s.info.highlights.filter((t) => !s.cut.has(t));
      const live = liveSongList.songs.find((x) => x.src === s.path);
      if (live) live.highlights = s.info.highlights;
      s.cut = null;
    });
    songs = songs.filter((s) => s.status !== "delete");
    frames = frames.filter((f) => f.status !== "delete");
    [...songs, ...frames].forEach((x) => {
      if (x.status === "new") { x.status = "live"; x.info = null; x.replacing = false; }
    });
    render();
    $("publishBar").classList.remove("hidden");
    $("pendingCount").textContent = "Saved ✓";
    $("publishBtn").disabled = true;
    await watchDeploy(commit.sha);
  } catch (e) {
    status.textContent = "Couldn't publish: " + e.message;
    $("publishBtn").disabled = false;
  }
  $("discardBtn").disabled = false;
});

// Follow the GitHub Action until the new version is live
async function watchDeploy(sha) {
  const status = $("publishStatus");
  const started = Date.now();
  while (Date.now() - started < 15 * 60 * 1000) {
    let run;
    try {
      run = (await gh(`/actions/runs?head_sha=${sha}`)).workflow_runs[0];
    } catch (e) {
      status.textContent = "Saved. The app updates in about 2 minutes.";
      return;   // token can't read Actions - that's fine
    }
    if (!run || run.status === "queued" || run.status === "waiting") {
      status.textContent = "Waiting for GitHub to start…";
    } else if (run.status !== "completed") {
      status.textContent = "Finding choruses + photo areas, publishing…";
    } else if (run.conclusion === "success") {
      $("pendingCount").textContent = "Live ✓";
      status.textContent = "Guests see the changes next time they open the app.";
      toast("Published!");
      setTimeout(() => loadLibrary(), 6000);   // refresh chorus times + photo areas
      return;
    } else {
      $("pendingCount").textContent = "Publishing failed";
      status.innerHTML = `Something went wrong. <a href="${run.html_url}" target="_blank">See details on GitHub</a>`;
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  status.textContent = "Still working - check the Actions tab on GitHub.";
}

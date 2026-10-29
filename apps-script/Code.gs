// =========================================================
//  Wedding Snap - Google Apps Script backend
//  Paste this into script.google.com, set FOLDER_ID and ADMIN_KEY,
//  then Deploy → Manage deployments → Edit → New version (see README.md).
// =========================================================

// The Google Drive folder ID (the long part of the folder's URL)
const FOLDER_ID = "PASTE_YOUR_FOLDER_ID_HERE";

// The couple's secret for the admin page (hide / delete any photo, read
// all wishes). Pick something long that guests can't guess. Keep it here
// in the Apps Script editor only - never put it on GitHub.
const ADMIN_KEY = "CHANGE_ME";

const MAX_BYTES = 8 * 1024 * 1024;   // refuse anything bigger than 8 MB
const MAX_WISH = 300;                // characters
const MAX_NAME = 40;
const CACHE_KEY = "photo-list-v3";
const PART_BYTES = 25 * 1024 * 1024;   // "Download all": zip files of about this size

// Saved in Script Properties:
//   del_<photoId>  = hash of the uploader's token (lets them delete it)
//   up_<hash>      = photoId (so a retried upload isn't saved twice)
//   wish_<photoId> = { n: name, w: wish }
//   hide_<photoId> = "1" when the couple hid it
//   likes_<photoId> = ["ab12…", …] who liked it (short hashes of phone ids)

// GET ?action=list  → { ok, photos: [{ id, time, wish?, name?, likes?, gif? }] }  newest first
function doGet(e) {
  // e is missing when you press Run on doGet in the editor - just list photos then
  const action = (e && e.parameter && e.parameter.action) || "list";
  if (action === "list") return json(listPhotos(false));
  return json({ ok: false, error: "Unknown action" });
}

// POST (JSON body):
//   { action: "upload", image, token, wish?, name? }  - image: JPEG, or GIF (boomerang)
//   { action: "delete", id, token }                   - a guest deletes their own
//   { action: "like", id, liker, on }                 - liker = the phone's own id
//   { action: "adminList", key }                      - every photo, hidden ones too
//   { action: "adminHide", key, id, hidden }
//   { action: "adminDelete", key, id }
//   { action: "adminZip", key, part }                 - "Download all", one zip at a time
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === "upload") return json(upload(body));
    if (body.action === "delete") return json(remove(body));
    if (body.action === "like") return json(like(body));
    if (/^admin/.test(body.action)) {
      const problem = checkAdmin(body.key);
      if (problem) return json({ ok: false, error: problem });
      if (body.action === "adminList") return json(listPhotos(true));
      if (body.action === "adminHide") return json(setHidden(body.id, !!body.hidden));
      if (body.action === "adminDelete") return json(trash(body.id));
      if (body.action === "adminZip") return json(makeZip(Number(body.part) || 1));
    }
    return json({ ok: false, error: "Unknown action" });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function upload(body) {
  const match = /^data:image\/(jpeg|gif);base64,(.+)$/.exec(body.image || "");
  if (!match) return { ok: false, error: "Not a JPEG or GIF image" };
  const type = match[1];
  if (!/^[a-f0-9]{32}$/.test(body.token || "")) return { ok: false, error: "Bad token" };

  // The phone retries until it hears back. If the photo arrived but the
  // answer got lost (bad signal), don't save it a second time.
  const props = PropertiesService.getScriptProperties();
  const tokenHash = hash(body.token);
  const already = props.getProperty("up_" + tokenHash);
  if (already) return { ok: true, id: already };

  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > MAX_BYTES) return { ok: false, error: "Image too large" };

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
  const name = (type === "gif" ? "boomerang-" : "snap-") + stamp + "-" + body.token.slice(0, 6) + (type === "gif" ? ".gif" : ".jpg");
  const file = DriveApp.getFolderById(FOLDER_ID).createFile(Utilities.newBlob(bytes, "image/" + type, name));

  // Guests' phones need to see the photo in the gallery
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // Some school/work accounts block this - share the folder manually instead
  }

  const saved = {
    ["del_" + file.getId()]: tokenHash,   // a hash of the delete token (never the token itself)
    ["up_" + tokenHash]: file.getId(),
  };
  // The guest's wish (ucapan) for the couple, if they wrote one
  const wish = clean(body.wish, MAX_WISH);
  const from = clean(body.name, MAX_NAME);
  if (wish || from) {
    saved["wish_" + file.getId()] = JSON.stringify({ n: from, w: wish });
    // also on the file in Drive, so the couple can see it there too
    try { file.setDescription((wish ? wish : "") + (from ? " - " + from : "")); } catch (err) {}
  }
  props.setProperties(saved);
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true, id: file.getId() };
}

// Only the phone that uploaded a photo knows its token, so only it can delete
function remove(body) {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty("del_" + body.id);
  if (!saved || !body.token || saved !== hash(body.token)) {
    return { ok: false, error: "You can only delete your own photos" };
  }
  return trash(body.id);
}

function trash(id) {
  DriveApp.getFileById(id).setTrashed(true);
  const props = PropertiesService.getScriptProperties();
  ["del_", "wish_", "hide_", "likes_"].forEach((p) => props.deleteProperty(p + id));
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true };
}

// A guest likes (on) or un-likes a photo. Each phone counts once.
function like(body) {
  if (!/^[a-f0-9]{32}$/.test(body.liker || "")) return { ok: false, error: "Bad liker" };
  if (!body.id) return { ok: false, error: "No photo" };
  const me = hash(body.liker).slice(0, 12);
  const lock = LockService.getScriptLock();   // many guests may tap at the same moment
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = "likes_" + body.id;
    let list = [];
    try { list = JSON.parse(props.getProperty(key) || "[]"); } catch (err) {}
    const has = list.indexOf(me) !== -1;
    if (body.on && !has) list.push(me);
    if (!body.on && has) list.splice(list.indexOf(me), 1);
    if (list.length) props.setProperty(key, JSON.stringify(list));
    else props.deleteProperty(key);
    return { ok: true, likes: list.length };
  } finally {
    lock.releaseLock();
  }
}

function setHidden(id, hidden) {
  const props = PropertiesService.getScriptProperties();
  if (hidden) props.setProperty("hide_" + id, "1");
  else props.deleteProperty("hide_" + id);
  return { ok: true };
}

// The photo list for the gallery and slideshow. Hidden photos are left
// out, except for the couple (admin), who also sees which ones are hidden.
function listPhotos(isAdmin) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const photos = [];
  driveList().forEach((p) => {
    const hidden = !!props["hide_" + p.id];
    if (hidden && !isAdmin) return;
    const photo = { id: p.id, time: p.time };
    const meta = props["wish_" + p.id];
    if (meta) {
      try {
        const m = JSON.parse(meta);
        if (m.w) photo.wish = m.w;
        if (m.n) photo.name = m.n;
      } catch (err) {}
    }
    const likes = props["likes_" + p.id];
    if (likes) {
      try { const n = JSON.parse(likes).length; if (n) photo.likes = n; } catch (err) {}
    }
    if (p.gif) photo.gif = true;
    if (isAdmin && hidden) photo.hidden = true;
    photos.push(photo);
  });
  return { ok: true, photos: photos };
}

function driveList() {
  // Many guests (and the slideshow) ask at once, so cache the list for 30s
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const photos = [];
  const files = DriveApp.getFolderById(FOLDER_ID).getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const type = f.getMimeType();
    if (type !== MimeType.JPEG && type !== MimeType.GIF) continue;
    const photo = { id: f.getId(), time: f.getDateCreated().getTime(), size: f.getSize() };
    if (type === MimeType.GIF) photo.gif = true;
    photos.push(photo);
  }
  photos.sort((a, b) => b.time - a.time);
  const list = photos.slice(0, 500);
  try { cache.put(CACHE_KEY, JSON.stringify(list), 30); } catch (err) {}   // >100KB can't be cached
  return list;
}

// "Download all": every photo, oldest first, in zip files of about
// PART_BYTES each (Google limits how big one file can be). The zips go in a
// "Downloads" folder inside the album. Part 1 clears out old zips first.
function makeZip(part) {
  const album = DriveApp.getFolderById(FOLDER_ID);
  const found = album.getFoldersByName("Downloads");
  const downloads = found.hasNext() ? found.next() : album.createFolder("Downloads");
  if (part === 1) {
    const old = downloads.getFiles();
    while (old.hasNext()) old.next().setTrashed(true);
  }

  const parts = [];
  let current = [], size = 0;
  driveList().slice().reverse().forEach((p) => {
    if (current.length && size + (p.size || 0) > PART_BYTES) { parts.push(current); current = []; size = 0; }
    current.push(p);
    size += p.size || 0;
  });
  if (current.length) parts.push(current);
  if (!parts.length) return { ok: false, error: "No photos yet" };
  if (part > parts.length) return { ok: false, error: "No such part" };

  const label = parts.length > 1 ? "-part-" + part + "-of-" + parts.length : "";
  const blobs = parts[part - 1].map((p) => DriveApp.getFileById(p.id).getBlob());
  const zip = downloads.createFile(Utilities.zip(blobs, "wedding-photos" + label + ".zip"));
  return {
    ok: true, part: part, parts: parts.length, photos: blobs.length,
    url: "https://drive.google.com/uc?export=download&id=" + zip.getId(),
    view: zip.getUrl(),
  };
}

function checkAdmin(key) {
  if (!ADMIN_KEY || ADMIN_KEY === "CHANGE_ME") return "Set ADMIN_KEY in the Apps Script first (see README)";
  if (key !== ADMIN_KEY) return "Wrong admin key";
  return "";
}

// Plain text only, trimmed and shortened
function clean(text, max) {
  return String(text || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);
}

function hash(text) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)
  );
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor to grant Drive permission + test the folder
function testSetup() {
  Logger.log("Folder: " + DriveApp.getFolderById(FOLDER_ID).getName());
  Logger.log(checkAdmin(ADMIN_KEY) || "Admin key is set");
}

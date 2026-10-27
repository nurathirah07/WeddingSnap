// =========================================================
//  Wedding Snap - Google Apps Script backend
//  Paste this into script.google.com, set FOLDER_ID, then
//  Deploy → New deployment → Web app (see README.md).
// =========================================================

// The Google Drive folder ID (the long part of the folder's URL)
const FOLDER_ID = "PASTE_YOUR_FOLDER_ID_HERE";

const MAX_BYTES = 8 * 1024 * 1024;   // refuse anything bigger than 8 MB
const CACHE_KEY = "photo-list";

// GET ?action=list  → { ok, photos: [{ id, time }] }  newest first
function doGet(e) {
  // e is missing when you press Run on doGet in the editor - just list photos then
  const action = (e && e.parameter && e.parameter.action) || "list";
  if (action === "list") return json(listPhotos());
  return json({ ok: false, error: "Unknown action" });
}

// POST { action: "upload", image, token } or { action: "delete", id, token }
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === "upload") return json(upload(body));
    if (body.action === "delete") return json(remove(body));
    return json({ ok: false, error: "Unknown action" });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function upload(body) {
  const match = /^data:image\/jpeg;base64,(.+)$/.exec(body.image || "");
  if (!match) return { ok: false, error: "Not a JPEG image" };
  if (!/^[a-f0-9]{32}$/.test(body.token || "")) return { ok: false, error: "Bad token" };

  const bytes = Utilities.base64Decode(match[1]);
  if (bytes.length > MAX_BYTES) return { ok: false, error: "Image too large" };

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
  const name = "snap-" + stamp + "-" + body.token.slice(0, 6) + ".jpg";
  const file = DriveApp.getFolderById(FOLDER_ID).createFile(Utilities.newBlob(bytes, "image/jpeg", name));

  // Guests' phones need to see the photo in the gallery
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // Some school/work accounts block this - share the folder manually instead
  }

  // Remember a hash of the delete token (never the token itself)
  PropertiesService.getScriptProperties().setProperty("del_" + file.getId(), hash(body.token));
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true, id: file.getId() };
}

// Only the phone that uploaded a photo knows its token, so only it can delete
function remove(body) {
  const props = PropertiesService.getScriptProperties();
  const key = "del_" + body.id;
  const saved = props.getProperty(key);
  if (!saved || !body.token || saved !== hash(body.token)) {
    return { ok: false, error: "You can only delete your own photos" };
  }
  DriveApp.getFileById(body.id).setTrashed(true);
  props.deleteProperty(key);
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true };
}

function listPhotos() {
  // Many guests open the gallery at once, so cache the list for 30s
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const photos = [];
  const files = DriveApp.getFolderById(FOLDER_ID).getFilesByType(MimeType.JPEG);
  while (files.hasNext()) {
    const f = files.next();
    photos.push({ id: f.getId(), time: f.getDateCreated().getTime() });
  }
  photos.sort((a, b) => b.time - a.time);

  const result = { ok: true, photos: photos.slice(0, 500) };
  try { cache.put(CACHE_KEY, JSON.stringify(result), 30); } catch (err) {}   // >100KB can't be cached
  return result;
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
}

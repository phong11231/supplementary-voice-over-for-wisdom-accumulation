"use strict";

// ====== DOM ======
const $ = (id) => document.getElementById(id);
const el = {
  // drive
  driveUrl: $("driveUrl"), signin: $("signin"), signout: $("signout"), authStatus: $("authStatus"),
  pickDir: $("pickDir"), dirStatus: $("dirStatus"), optRoot: $("optRoot"), optSkip: $("optSkip"),
  run: $("run"), stop: $("stop"), bar: $("bar"),
  cDir: $("cDir"), cDone: $("cDone"), cSkip: $("cSkip"), cErr: $("cErr"), cTotal: $("cTotal"),
  // web
  webStatus: $("webStatus"), openWeb: $("openWeb"), plUrl: $("plUrl"), makeToc: $("makeToc"), loadSrt: $("loadSrt"),
  srtPreview: $("srtPreview"), spMatch: $("spMatch"), spExtra: $("spExtra"), spMiss: $("spMiss"),
  spWeb: $("spWeb"), spSrt: $("spSrt"), spWebN: $("spWebN"), spSrtN: $("spSrtN"), srtConfirm: $("srtConfirm"), srtCancel: $("srtCancel"),
  srtMissingBox: $("srtMissingBox"), srtMissingList: $("srtMissingList"),
  // dub youtube
  dubPlUrl: $("dubPlUrl"), dubScan: $("dubScan"), dubClear: $("dubClear"), dubMissingBox: $("dubMissingBox"), dubMissingList: $("dubMissingList"),
  // common
  log: $("log"),
  tabDrive: $("tabDrive"), tabWeb: $("tabWeb"), tabYtDub: $("tabYtDub"),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_URL = "https://phong11231.github.io/WISDOM_ACCUMULATION/";

// ====== State ======
let dirHandle = null, accessToken = null, running = false, stopFlag = false;
const stat = { dir: 0, done: 0, skip: 0, err: 0, total: 0 };

// ====== Helpers ======
function log(msg, cls = "log-info") {
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.log.appendChild(line);
  el.log.scrollTop = el.log.scrollHeight;
}
function refreshStat() {
  el.cDir.textContent = stat.dir; el.cDone.textContent = stat.done; el.cSkip.textContent = stat.skip;
  el.cErr.textContent = stat.err; el.cTotal.textContent = stat.total;
  const handled = stat.done + stat.skip + stat.err;
  el.bar.style.width = (stat.total ? Math.min(100, Math.round(handled / stat.total * 100)) : 0) + "%";
}
function sanitize(name) {
  return (name || "untitled").replace(/[\/\\:\*\?"<>\|]/g, "_").replace(/[\x00-\x1f]/g, "").replace(/\.+$/, "").trim() || "untitled";
}
function extractFolderId(input) {
  if (!input) return null; input = input.trim();
  let m = input.match(/\/folders\/([a-zA-Z0-9_-]+)/); if (m) return m[1];
  m = input.match(/[?&]id=([a-zA-Z0-9_-]+)/); if (m) return m[1];
  m = input.match(/\/d\/([a-zA-Z0-9_-]+)/); if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input;
  return null;
}
const FOLDER_MIME = "application/vnd.google-apps.folder";
const isFolder = (f) => f.mimeType === FOLDER_MIME;
const isVideo = (f) => (f.mimeType || "").startsWith("video/") || /\.(mp4|mkv|mov|avi|webm|flv|wmv|m4v|ts)$/i.test(f.name || "");
const isSrt = (f) => /\.(srt|vtt|ass|sub)$/i.test(f.name || "");

// ====== Tabs ======
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    const which = t.dataset.tab;
    el.tabDrive.hidden = which !== "drive";
    el.tabWeb.hidden = which !== "web";
    el.tabYtDub.hidden = which !== "ytdub";
    if (which === "web") updateWebStatus();
  });
});

/* =====================================================================
   PHAN 1: TAI TU GOOGLE DRIVE  (OAuth)
   ===================================================================== */
function getToken(interactive) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.identity) return reject(new Error("chrome.identity khong co"));
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) reject(new Error(chrome.runtime.lastError?.message || "Khong lay duoc token"));
      else resolve(token);
    });
  });
}
function removeCachedToken(token) {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.identity) return resolve();
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}
const API = "https://www.googleapis.com/drive/v3";
async function authFetch(url, opts = {}) {
  if (!accessToken) accessToken = await getToken(true);
  const doFetch = () => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + accessToken } });
  let res = await doFetch();
  if (res.status === 401) { await removeCachedToken(accessToken); accessToken = await getToken(true); res = await doFetch(); }
  return res;
}
async function driveGet(url) {
  const res = await authFetch(url);
  if (!res.ok) { let d = ""; try { d = (await res.json()).error?.message || ""; } catch (_) {} throw new Error(`HTTP ${res.status} ${d}`); }
  return res;
}
async function getFileMeta(id) { return (await driveGet(`${API}/files/${id}?fields=id,name,mimeType,size&supportsAllDrives=true`)).json(); }
async function listChildren(folderId) {
  const items = []; let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const fields = encodeURIComponent("nextPageToken,files(id,name,mimeType,size)");
    let url = `${API}/files?q=${q}&fields=${fields}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=name_natural`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const data = await (await driveGet(url)).json();
    items.push(...(data.files || [])); pageToken = data.nextPageToken || "";
  } while (pageToken);
  return items;
}
async function downloadFile(id) { return await (await driveGet(`${API}/files/${id}?alt=media&supportsAllDrives=true`)).blob(); }
async function ensureDir(parent, name) { return parent.getDirectoryHandle(sanitize(name), { create: true }); }
async function fileExistsSameSize(dir, name, size) {
  try { const fh = await dir.getFileHandle(name, { create: false }); if (!size) return true; const f = await fh.getFile(); return String(f.size) === String(size); }
  catch (_) { return false; }
}
async function writeBlob(dir, name, blob) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }

function wantFile(f, mode) {
  if (isFolder(f)) return false;
  if (mode === "video") return isVideo(f);
  if (mode === "srt") return isSrt(f);
  return isVideo(f) || isSrt(f); // both
}
async function countTargets(folderId, mode) {
  let n = 0;
  for (const c of await listChildren(folderId)) {
    if (stopFlag) break;
    if (isFolder(c)) n += await countTargets(c.id, mode); else if (wantFile(c, mode)) n++;
  }
  return n;
}
async function walk(folderId, destHandle, opts, prefix) {
  const children = await listChildren(folderId);
  const folders = children.filter(isFolder), files = children.filter((c) => !isFolder(c));
  for (const f of files) {
    if (stopFlag) return;
    if (!wantFile(f, opts.mode)) continue;
    const name = sanitize(f.name);
    try {
      if (opts.skip && await fileExistsSameSize(destHandle, name, f.size)) { stat.skip++; refreshStat(); log(`SKIP  ${prefix}${name}`, "log-skip"); continue; }
      const sizeTxt = f.size ? ` (${(f.size / 1048576).toFixed(1)} MB)` : "";
      log(`...   ${prefix}${name}${sizeTxt}`, "log-info");
      const blob = await downloadFile(f.id);
      await writeBlob(destHandle, name, blob);
      stat.done++; refreshStat(); log(`OK    ${prefix}${name}`, "log-ok");
    } catch (e) { stat.err++; refreshStat(); log(`LOI   ${prefix}${name}  -> ${e.message}`, "log-err"); }
  }
  for (const d of folders) {
    if (stopFlag) return;
    const dname = sanitize(d.name);
    log(`DIR   ${prefix}${dname}/`, "log-dir");
    const sub = await ensureDir(destHandle, dname); stat.dir++; refreshStat();
    await walk(d.id, sub, opts, prefix + dname + "/");
  }
}
async function startDrive() {
  if (running) return;
  const folderId = extractFolderId(el.driveUrl.value);
  if (!folderId) { log("Link Drive khong hop le.", "log-err"); return; }
  if (!accessToken) { log("Chua dang nhap Google.", "log-err"); return; }
  if (!dirHandle) { log("Chua chon thu muc luu.", "log-err"); return; }
  try { const p = await dirHandle.requestPermission({ mode: "readwrite" }); if (p !== "granted") { log("Khong co quyen ghi.", "log-err"); return; } } catch (_) {}
  if (typeof chrome !== "undefined" && chrome.storage) chrome.storage.local.set({ driveUrl: el.driveUrl.value.trim() });

  const mode = (document.querySelector('input[name="dlMode"]:checked') || {}).value || "video";
  const opts = { root: el.optRoot.checked, mode, skip: el.optSkip.checked };
  running = true; stopFlag = false;
  el.run.disabled = true; el.stop.disabled = false; el.pickDir.disabled = true;
  stat.dir = stat.done = stat.skip = stat.err = stat.total = 0; refreshStat();
  try {
    log("Dang doc thu muc goc...", "log-info");
    const meta = await getFileMeta(folderId);
    if (meta.mimeType !== FOLDER_MIME) { log("Link nay khong phai thu muc.", "log-err"); throw new Error("not a folder"); }
    log(`Thu muc goc: ${meta.name}`, "log-dir");
    let dest = dirHandle;
    if (opts.root) { dest = await ensureDir(dirHandle, meta.name); log(`Da tao thu muc goc: ${sanitize(meta.name)}/`, "log-dir"); }
    log(`Dang quet (loai: ${mode})...`, "log-info");
    stat.total = await countTargets(folderId, mode); refreshStat();
    log(`Tong so file se tai: ${stat.total}`, "log-info");
    await walk(folderId, dest, opts, opts.root ? sanitize(meta.name) + "/" : "");
    if (stopFlag) log("DA DUNG theo yeu cau.", "log-err");
    else log(`HOAN TAT. Tai: ${stat.done} | Bo qua: ${stat.skip} | Loi: ${stat.err}`, "log-ok");
  } catch (e) {
    log("Dung do loi: " + e.message, "log-err");
    if (/HTTP 40[13]/.test(e.message)) log("Goi y: dang nhap dung tai khoan duoc chia se, chap nhan quyen chi doc Drive.", "log-err");
  } finally { running = false; el.run.disabled = false; el.stop.disabled = true; el.pickDir.disabled = false; }
}

// Auth UI
function setSignedIn(yes) {
  if (yes) { el.authStatus.textContent = "Da dang nhap"; el.authStatus.classList.add("ok"); el.signin.style.display = "none"; el.signout.style.display = ""; }
  else { el.authStatus.textContent = "Chua dang nhap"; el.authStatus.classList.remove("ok"); el.signin.style.display = ""; el.signout.style.display = "none"; }
  updateRunEnabled();
}
el.signin.addEventListener("click", async () => {
  try { el.authStatus.textContent = "Dang dang nhap..."; accessToken = await getToken(true); setSignedIn(true); log("Dang nhap Google thanh cong.", "log-ok"); }
  catch (e) { el.authStatus.textContent = "Dang nhap that bai"; log("Dang nhap that bai: " + e.message, "log-err"); }
});
el.signout.addEventListener("click", async () => { if (accessToken) await removeCachedToken(accessToken); accessToken = null; setSignedIn(false); log("Da dang xuat.", "log-info"); });
el.pickDir.addEventListener("click", async () => {
  try { dirHandle = await window.showDirectoryPicker({ mode: "readwrite" }); el.dirStatus.textContent = "Da chon: " + dirHandle.name; el.dirStatus.classList.add("ok"); updateRunEnabled(); }
  catch (e) { if (e && e.name !== "AbortError") log("Khong chon duoc thu muc: " + e.message, "log-err"); }
});
function updateRunEnabled() { el.run.disabled = !(dirHandle && extractFolderId(el.driveUrl.value) && accessToken) || running; }
el.driveUrl.addEventListener("input", updateRunEnabled);
el.run.addEventListener("click", startDrive);
el.stop.addEventListener("click", () => { if (running) { stopFlag = true; log("Dang dung sau khi xong file hien tai...", "log-err"); } });

/* =====================================================================
   PHAN 2: PLAYLIST YOUTUBE -> WEB HOC  (ghi thang vao Firestore cua trang)
   ===================================================================== */
function extractListId(url) { const m = (url || "").match(/[?&]list=([A-Za-z0-9_-]+)/); return m ? m[1] : null; }

function extractYtInitialData(html) {
  const marker = "ytInitialData"; let i = html.indexOf(marker);
  while (i !== -1) {
    const eq = html.indexOf("=", i), brace = html.indexOf("{", eq);
    if (eq !== -1 && brace !== -1 && brace - eq < 6) {
      let depth = 0, inStr = false, esc = false, q = "";
      for (let j = brace; j < html.length; j++) {
        const c = html[j];
        if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === q) inStr = false; }
        else { if (c === '"' || c === "'") { inStr = true; q = c; } else if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(html.slice(brace, j + 1)); } catch (e) { return null; } } } }
      }
    }
    i = html.indexOf(marker, i + marker.length);
  }
  return null;
}
function parsePlaylist(d) {
  const out = [], seen = new Set();
  (function w(o) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(w);
    if (o.lockupViewModel) {
      const L = o.lockupViewModel, id = L.contentId; let t = "";
      try { t = L.metadata.lockupMetadataViewModel.title.content || ""; } catch (e) {}
      if (id && !seen.has(id)) { seen.add(id); out.push({ id, title: t }); }
    }
    if (o.playlistVideoRenderer) {
      const P = o.playlistVideoRenderer, id = P.videoId; let t = "";
      try { t = P.title.simpleText || P.title.runs.map((r) => r.text).join(""); } catch (e) {}
      if (id && !seen.has(id)) { seen.add(id); out.push({ id, title: t }); }
    }
    for (const k in o) w(o[k]);
  })(d);
  return out;
}
// tim token phan trang (ho tro layout moi lockup + layout cu)
function findContinuationToken(obj) {
  let token = null;
  (function w(o) {
    if (token || !o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(w);
    if (typeof o.token === "string" && o.request && String(o.request).indexOf("CONTINUATION") >= 0) { token = o.token; return; }
    if (o.continuationItemRenderer) { try { const t = o.continuationItemRenderer.continuationEndpoint.continuationCommand.token; if (t) { token = t; return; } } catch (e) {} }
    for (const k in o) { if (token) return; w(o[k]); }
  })(obj);
  return token;
}
function extractCfg(html) {
  const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || html.match(/"innertubeApiKey":"([^"]+)"/) || [])[1];
  const ver = (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || html.match(/"clientVersion":"([^"]+)"/) || [])[1];
  return { key, ver };
}
// Doc TOAN BO playlist (du >100 video) bang continuation (innertube)
async function fetchPlaylist(listId) {
  const res = await fetch("https://www.youtube.com/playlist?list=" + listId, { headers: { "accept-language": "en;q=0.9" } });
  if (!res.ok) throw new Error("HTTP " + res.status + " khi doc playlist");
  const html = await res.text();
  const d = extractYtInitialData(html);
  if (!d) throw new Error("Khong doc duoc du lieu playlist");
  const cfg = extractCfg(html);
  let items = parsePlaylist(d);
  let token = findContinuationToken(d);
  let page = 1;
  while (token && cfg.key && cfg.ver && page < 300) {
    page++;
    log(`  ...dang doc trang ${page} (da co ${items.length} video)`, "log-info");
    let j;
    try {
      const r = await fetch("https://www.youtube.com/youtubei/v1/browse?key=" + cfg.key, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: cfg.ver } }, continuation: token })
      });
      if (!r.ok) { log(`  (dung phan trang: HTTP ${r.status})`, "log-skip"); break; }
      j = await r.json();
    } catch (e) { log(`  (dung phan trang: ${e.message})`, "log-skip"); break; }
    items = items.concat(parsePlaylist(j));
    token = findContinuationToken(j);
  }
  const seen = new Set(), uniq = [];
  for (const it of items) { if (it.id && !seen.has(it.id)) { seen.add(it.id); uniq.push(it); } }
  return uniq;
}
function buildFolders(items) {
  const map = new Map(); const unmatched = [];
  for (const it of items) {
    const m = (it.title || "").match(/page\D*(\d+)\D+page\D*(\d+)/i);
    if (!m) { unmatched.push(it.title); continue; }
    const ch = +m[1], ls = +m[2];
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch).push({ ls, videoId: it.id });
  }
  const folders = [...map.keys()].sort((a, b) => a - b).map((ch) => ({
    ch, name: "Chuong " + ch,
    lessons: map.get(ch).sort((a, b) => a.ls - b.ls).map((x) => ({
      ls: x.ls, name: "Bai " + x.ls, url: "https://www.youtube.com/watch?v=" + x.videoId, videoId: x.videoId
    }))
  }));
  return { folders, unmatched };
}

// ----- Tim tab web hoc + goi script trong trang -----
async function findAppTab() {
  const tabs = await chrome.tabs.query({ url: "https://phong11231.github.io/*" });
  return tabs.find((t) => t.url && t.url.includes("WISDOM_ACCUMULATION")) || null;
}
async function runInApp(tabId, func, arg) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args: arg === undefined ? [] : [arg] });
  return res && res.result;
}
function injectCheckAuth() {
  try { return { ok: true, loggedIn: !!(window.firebase && firebase.auth && firebase.auth().currentUser) }; }
  catch (e) { return { ok: false, err: String(e) }; }
}
// chay trong MAIN world cua trang web hoc
function injectCreateToc(incoming) {
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  const user = (window.firebase && firebase.auth && firebase.auth().currentUser) || null;
  if (!user) return Promise.resolve({ ok: false, err: "not-logged-in" });
  const ref = firebase.firestore().collection("users").doc(user.uid).collection("app").doc("courses");
  function chNum(f) { if (typeof f._ch === "number") return f._ch; const m = (f.name || "").match(/(\d+)/); return m ? +m[1] : null; }
  function lsNum(l) { if (typeof l._ls === "number") return l._ls; const m = (l.name || "").match(/(\d+)/); return m ? +m[1] : null; }
  return ref.get().then(function (snap) {
    const data = (snap.exists && snap.data().folders) ? { folders: snap.data().folders.slice() } : { folders: [] };
    let addedF = 0, addedL = 0;
    incoming.forEach(function (inc) {
      let folder = data.folders.find(function (f) { return chNum(f) === inc.ch; });
      if (!folder) { folder = { id: uid(), name: inc.name, collapsed: false, _ch: inc.ch, lessons: [] }; data.folders.push(folder); addedF++; }
      inc.lessons.forEach(function (il) {
        if (folder.lessons.some(function (l) { return lsNum(l) === il.ls; })) return;
        folder.lessons.push({ id: uid(), name: il.name, url: il.url, videoId: il.videoId, _ch: inc.ch, _ls: il.ls });
        addedL++;
      });
      folder.lessons.sort(function (a, b) { return (lsNum(a) || 0) - (lsNum(b) || 0); });
    });
    data.folders.sort(function (a, b) { return (chNum(a) || 0) - (chNum(b) || 0); });
    return ref.set({ folders: data.folders }).then(function () { return { ok: true, addedFolders: addedF, addedLessons: addedL }; });
  }).catch(function (e) { return { ok: false, err: String(e && e.message || e) }; });
}
// chay trong MAIN world: nap srt vao dung bai
// Ghi srt vao doc RIENG moi bai: users/{uid}/srt/{lessonId} (tranh gioi han 1MB)
function injectLoadSrt(srtArr) {
  const user = (window.firebase && firebase.auth && firebase.auth().currentUser) || null;
  if (!user) return Promise.resolve({ ok: false, err: "not-logged-in" });
  const db = firebase.firestore();
  const base = db.collection("users").doc(user.uid);
  function chNum(f) { if (typeof f._ch === "number") return f._ch; const m = (f.name || "").match(/(\d+)/); return m ? +m[1] : null; }
  function lsNum(l) { if (typeof l._ls === "number") return l._ls; const m = (l.name || "").match(/(\d+)/); return m ? +m[1] : null; }
  return base.collection("app").doc("courses").get().then(function (snap) {
    if (!snap.exists || !snap.data().folders) return { ok: false, err: "no-data" };
    const folders = snap.data().folders;
    const toWrite = []; let matched = 0; const extra = [];
    srtArr.forEach(function (s) {
      let lid = null;
      folders.forEach(function (f) { if (chNum(f) === s.ch) f.lessons.forEach(function (l) { if (lsNum(l) === s.ls) lid = l.id; }); });
      if (lid) { toWrite.push({ id: lid, srt: s.srt }); matched++; } else extra.push({ ch: s.ch, ls: s.ls });
    });
    const missing = [];
    folders.forEach(function (f) {
      const bais = [];
      f.lessons.forEach(function (l) { const ln = lsNum(l); if (!srtArr.some(function (s) { return s.ch === chNum(f) && s.ls === ln; })) bais.push(ln); });
      if (bais.length) missing.push({ ch: chNum(f), name: f.name, bais: bais.sort(function (a, b) { return a - b; }) });
    });
    missing.sort(function (a, b) { return (a.ch || 0) - (b.ch || 0); });
    extra.sort(function (a, b) { return (a.ch - b.ch) || (a.ls - b.ls); });
    function writeChunk(i) {
      if (i >= toWrite.length) return Promise.resolve();
      const b = db.batch(); const end = Math.min(i + 400, toWrite.length);
      for (let k = i; k < end; k++) b.set(base.collection("srt").doc(toWrite[k].id), { srt: toWrite[k].srt, cues: [] });
      return b.commit().then(function () { return writeChunk(end); });
    }
    return writeChunk(0).then(function () { return { ok: true, matched: matched, missing: missing, extra: extra }; });
  }).catch(function (e) { return { ok: false, err: String(e && e.message || e) }; });
}
// Doc danh sach bai + bai nao DA co srt (de chi nap bai chua co)
function injectReadLessons() {
  const user = (window.firebase && firebase.auth && firebase.auth().currentUser) || null;
  if (!user) return Promise.resolve({ ok: false, err: "not-logged-in" });
  const base = firebase.firestore().collection("users").doc(user.uid);
  function chNum(f) { if (typeof f._ch === "number") return f._ch; const m = (f.name || "").match(/(\d+)/); return m ? +m[1] : null; }
  function lsNum(l) { if (typeof l._ls === "number") return l._ls; const m = (l.name || "").match(/(\d+)/); return m ? +m[1] : null; }
  return base.collection("app").doc("courses").get().then(function (snap) {
    if (!snap.exists || !snap.data().folders) return { ok: true, lessons: [], haveSrt: [] };
    const lessons = [];
    snap.data().folders.forEach(function (f) { const ch = chNum(f); f.lessons.forEach(function (l) { lessons.push({ ch: ch, ls: lsNum(l), id: l.id, videoId: l.videoId || "" }); }); });
    return base.collection("srt").get().then(function (qs) {
      const have = [];
      qs.forEach(function (doc) { const d = doc.data() || {}; if (d.srt && String(d.srt).trim()) have.push(doc.id); });
      return { ok: true, lessons: lessons, haveSrt: have };
    });
  }).catch(function (e) { return { ok: false, err: String(e && e.message || e) }; });
}

async function updateWebStatus() {
  try {
    const tab = await findAppTab();
    if (!tab) { el.webStatus.textContent = "Chua mo web hoc"; el.webStatus.className = "pill warn"; return null; }
    const r = await runInApp(tab.id, injectCheckAuth, null);
    if (r && r.ok && r.loggedIn) { el.webStatus.textContent = "San sang (da dang nhap)"; el.webStatus.className = "pill ok"; }
    else { el.webStatus.textContent = "Da mo nhung chua dang nhap"; el.webStatus.className = "pill warn"; }
    return tab;
  } catch (e) { el.webStatus.textContent = "Loi kiem tra: " + e.message; el.webStatus.className = "pill warn"; return null; }
}
async function requireAppTab() {
  const tab = await findAppTab();
  if (!tab) { log("Chua mo tab web hoc. Bam 'Mo web hoc' va dang nhap truoc.", "log-err"); return null; }
  const r = await runInApp(tab.id, injectCheckAuth, null);
  if (!(r && r.ok && r.loggedIn)) { log("Web hoc chua dang nhap. Hay dang nhap trong tab do roi thu lai.", "log-err"); return null; }
  return tab;
}

el.openWeb.addEventListener("click", () => { chrome.tabs.create({ url: APP_URL }); log("Da mo web hoc. Dang nhap xong roi quay lai bam chuc nang.", "log-info"); });

// Doc playlist bang cach chay script TRONG tab youtube.com (cung origin -> continuation khong bi 403)
function pageReadPlaylist() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function parse(o) {
    const out = [];
    (function w(x) {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) return x.forEach(w);
      if (x.lockupViewModel) { const L = x.lockupViewModel, id = L.contentId; let t = ""; try { t = L.metadata.lockupMetadataViewModel.title.content || ""; } catch (e) {} if (id) out.push({ id, title: t }); }
      if (x.playlistVideoRenderer) { const P = x.playlistVideoRenderer, id = P.videoId; let t = ""; try { t = P.title.simpleText || P.title.runs.map((r) => r.text).join(""); } catch (e) {} if (id) out.push({ id, title: t }); }
      for (const k in x) w(x[k]);
    })(o);
    return out;
  }
  function findTok(o) { let t = null; (function w(x) { if (t || !x || typeof x !== "object") return; if (Array.isArray(x)) return x.forEach(w); if (typeof x.token === "string" && x.request && String(x.request).indexOf("CONTINUATION") >= 0) { t = x.token; return; } for (const k in x) { if (t) return; w(x[k]); } })(o); return t; }
  return (async function () {
    let tries = 0; while (!window.ytInitialData && tries++ < 60) await sleep(250);
    const d = window.ytInitialData;
    if (!d) return { ok: false, err: "khong co ytInitialData" };
    const htmlHead = document.documentElement.outerHTML.slice(0, 500000);
    const key = (window.ytcfg && ytcfg.get && ytcfg.get("INNERTUBE_API_KEY")) || (htmlHead.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
    const ver = (window.ytcfg && ytcfg.get && ytcfg.get("INNERTUBE_CONTEXT_CLIENT_VERSION")) || (htmlHead.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || [])[1];
    let items = parse(d), tok = findTok(d), guard = 0;
    while (tok && key && ver && guard++ < 400) {
      try {
        const res = await fetch("https://www.youtube.com/youtubei/v1/browse?key=" + key, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: ver } }, continuation: tok }) });
        if (!res.ok) break;
        const j = await res.json();
        items = items.concat(parse(j));
        tok = findTok(j);
      } catch (e) { break; }
    }
    const seen = new Set(), uniq = [];
    for (const it of items) if (it.id && !seen.has(it.id)) { seen.add(it.id); uniq.push(it); }
    return { ok: true, items: uniq };
  })();
}
function waitTabLoad(tabId) {
  return new Promise((resolve) => {
    let n = 0;
    (function check() { chrome.tabs.get(tabId, (t) => { if (chrome.runtime.lastError || !t) return resolve(); if (t.status === "complete" || n++ > 40) resolve(); else setTimeout(check, 400); }); })();
  });
}
async function fetchPlaylistViaTab(listId) {
  const tab = await chrome.tabs.create({ url: "https://www.youtube.com/playlist?list=" + listId, active: false });
  try {
    await waitTabLoad(tab.id);
    await sleep(1200);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: pageReadPlaylist });
    const r = res && res.result;
    if (!r || !r.ok) throw new Error((r && r.err) || "khong doc duoc playlist");
    return r.items;
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
  }
}

// Doc phu de (caption) cua 1 video YouTube -> SRT, chay TRONG tab youtube.com
function pageReadCaption() {
  function fmt(ms) {
    ms = Math.max(0, ms | 0); const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000; const s = Math.floor(ms / 1000); ms -= s * 1000;
    const p = (n, l) => { n = "" + n; while (n.length < l) n = "0" + n; return n; };
    return p(h, 2) + ":" + p(m, 2) + ":" + p(s, 2) + "," + p(ms, 3);
  }
  return (async function () {
    let pr = window.ytInitialPlayerResponse;
    if (!pr) { try { pr = JSON.parse((document.documentElement.innerHTML.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/) || [])[1]); } catch (e) {} }
    let tracks = null;
    try { tracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks; } catch (e) {}
    if (!tracks || !tracks.length) return { ok: false, err: "video khong co phu de" };
    const tr = tracks.find((t) => t.languageCode === "en" && t.kind !== "asr")
      || tracks.find((t) => t.languageCode === "en") || tracks[0];
    let res;
    try { res = await fetch(tr.baseUrl + "&fmt=json3"); } catch (e) { return { ok: false, err: "fetch loi: " + e.message }; }
    if (!res.ok) return { ok: false, err: "HTTP " + res.status };
    const data = await res.json();
    const evs = data.events || [];
    const out = []; let n = 0;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]; if (!e.segs) continue;
      const text = e.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const start = e.tStartMs || 0;
      const dur = e.dDurationMs || ((evs[i + 1] && evs[i + 1].tStartMs) ? evs[i + 1].tStartMs - start : 2000);
      n++; out.push(n + "\n" + fmt(start) + " --> " + fmt(start + dur) + "\n" + text + "\n");
    }
    if (!out.length) return { ok: false, err: "phu de rong" };
    return { ok: true, srt: out.join("\n") };
  })();
}
async function fetchYtCaptionSrt(videoId) {
  const tab = await chrome.tabs.create({ url: "https://www.youtube.com/watch?v=" + videoId, active: false });
  try {
    await waitTabLoad(tab.id);
    await sleep(1600);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: pageReadCaption });
    const r = res && res.result;
    if (!r || !r.ok) throw new Error((r && r.err) || "khong lay duoc phu de");
    return r.srt;
  } finally { try { await chrome.tabs.remove(tab.id); } catch (e) {} }
}
// YouTube chan tai caption tu trinh duyet -> nut nay COPY lenh yt-dlp de tai bang Terminal
async function downloadYtSrtFor(lesson, btn, rowDiv) {
  if (!lesson.videoId) { log("Bai nay khong co videoId.", "log-err"); return; }
  const fname = `page_${lesson.ch}_page_ (${lesson.ls})`;
  const url = `https://www.youtube.com/watch?v=${lesson.videoId}`;
  const base = `yt-dlp --write-auto-sub --sub-langs en --convert-subs srt --skip-download -o "${fname}.%(ext)s" "${url}"`;
  const linux = `${base} && mv "${fname}.en.srt" "${fname}.srt"`;
  const win = `${base} && ren "${fname}.en.srt" "${fname}.srt"`;
  const clip = `# ===== LINUX / macOS =====\n${linux}\n\n# ===== WINDOWS (cmd) =====\n${win}\n`;
  try {
    await navigator.clipboard.writeText(clip);
    btn.textContent = "✓ da copy lenh";
    rowDiv.className = "mi-plain";
    log(`Da COPY lenh yt-dlp (Linux + Windows) cho Ch${lesson.ch}/Bai${lesson.ls}.`, "log-ok");
    log(`  B1: cd vao DUNG thu muc srt cua chuong ${lesson.ch}.`, "log-info");
    log(`  B2: dan lenh dung HE DIEU HANH cua ban + Enter -> ra file ${fname}.srt.`, "log-info");
    log(`  B3: quay lai bam "Chon thu muc SRT" -> "Nap bai moi".`, "log-info");
  } catch (e) {
    log("Khong copy duoc. Lenh (chay trong thu muc srt chuong " + lesson.ch + "):", "log-err");
    log("  [Linux] " + linux, "log-info");
    log("  [Windows] " + win, "log-info");
  }
}

el.makeToc.addEventListener("click", async () => {
  const listId = extractListId(el.plUrl.value);
  if (!listId) { log("Link playlist khong hop le (thieu ?list=...).", "log-err"); return; }
  el.makeToc.disabled = true;
  try {
    log("Dang doc playlist...", "log-info");
    log("Dang mo tab YouTube de doc playlist (tu dong dong lai)...", "log-info");
    const items = await fetchPlaylistViaTab(listId);
    if (!items.length) { log("Khong tim thay video nao trong playlist.", "log-err"); return; }
    const { folders, unmatched } = buildFolders(items);
    const totalLessons = folders.reduce((n, f) => n + f.lessons.length, 0);
    log(`Tim thay ${items.length} video -> ${folders.length} chuong, ${totalLessons} bai.`, "log-info");
    folders.forEach((f) => log(`  Chuong ${f.ch}: ${f.lessons.length} bai`, "log-dir"));
    if (unmatched.length) log(`  (${unmatched.length} video khong khop cu phap "page X page Y", bo qua)`, "log-skip");
    const tab = await requireAppTab(); if (!tab) return;
    log("Dang ghi vao web hoc...", "log-info");
    const res = await runInApp(tab.id, injectCreateToc, folders);
    if (res && res.ok) {
      log(`XONG. Them ${res.addedFolders} chuong, ${res.addedLessons} bai. Dang tai lai web...`, "log-ok");
      chrome.tabs.reload(tab.id);
    } else log("Loi khi ghi: " + (res && res.err || "khong ro"), "log-err");
  } catch (e) { log("Loi: " + e.message, "log-err"); }
  finally { el.makeToc.disabled = false; }
});

let pendingSrt = null;
function fmtCL(x) { return "Ch" + x.ch + "/Bai" + x.ls; }
function renderSrtPreview(webLessons, srtArr, haveSrt, matchedArr, already, extra, missing) {
  const byCL = (a, b) => (a.ch - b.ch) || (a.ls - b.ls);
  el.spMatch.textContent = matchedArr.length;
  el.spExtra.textContent = extra.length + already.length;
  el.spMiss.textContent = missing.length;
  el.spWebN.textContent = webLessons.length;
  el.spSrtN.textContent = srtArr.length;
  const lessonByCL = new Map(); webLessons.forEach((L) => lessonByCL.set(L.ch + ":" + L.ls, L));
  const fileSet = new Set(srtArr.map((s) => s.ch + ":" + s.ls));
  el.spWeb.innerHTML = "";
  webLessons.slice().sort(byCL).forEach((L) => {
    const d = document.createElement("div");
    if (haveSrt.has(L.id)) { d.className = "mi-plain"; d.textContent = "● da co srt  " + fmtCL(L); }
    else if (fileSet.has(L.ch + ":" + L.ls)) { d.className = "mi-ok"; d.textContent = "⬆ se nap     " + fmtCL(L); }
    else { d.className = "mi-skip"; d.textContent = "○ thieu      " + fmtCL(L); }
    el.spWeb.appendChild(d);
  });
  el.spSrt.innerHTML = "";
  srtArr.slice().sort(byCL).forEach((s) => {
    const d = document.createElement("div");
    const L = lessonByCL.get(s.ch + ":" + s.ls);
    if (!L) { d.className = "mi-skip"; d.textContent = "✗ chua co bai  " + fmtCL(s); }
    else if (haveSrt.has(L.id)) { d.className = "mi-plain"; d.textContent = "= da co, bo qua " + fmtCL(s); }
    else { d.className = "mi-ok"; d.textContent = "✓ se nap       " + fmtCL(s); }
    el.spSrt.appendChild(d);
  });
  // Bai THIEU srt (khong co file + chua co tren web) -> nut tai tu YouTube
  el.srtMissingList.innerHTML = "";
  const dlAble = missing.filter((L) => L.videoId);
  if (dlAble.length) {
    dlAble.slice().sort(byCL).forEach((L) => {
      const row = document.createElement("div"); row.className = "mi-row";
      const lab = document.createElement("span"); lab.textContent = "○ " + fmtCL(L);
      const btn = document.createElement("button"); btn.className = "yt-btn"; btn.textContent = "📋 Lenh yt-dlp";
      btn.onclick = () => downloadYtSrtFor(L, btn, row);
      row.appendChild(lab); row.appendChild(btn);
      el.srtMissingList.appendChild(row);
    });
    el.srtMissingBox.hidden = false;
  } else { el.srtMissingBox.hidden = true; }
  el.srtPreview.hidden = false;
}

el.loadSrt.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) { log("Trinh duyet khong ho tro chon thu muc.", "log-err"); return; }
  el.srtPreview.hidden = true; pendingSrt = null;
  let dir;
  try { dir = await window.showDirectoryPicker(); }
  catch (e) { if (e && e.name !== "AbortError") log("Khong chon duoc thu muc: " + e.message, "log-err"); return; }
  el.loadSrt.disabled = true;
  try {
    log("Dang doc file SRT trong thu muc...", "log-info");
    const srtArr = [];
    async function scan(handle, prefix) {
      for await (const [name, h] of handle.entries()) {
        if (h.kind === "directory") { await scan(h, prefix + name + "/"); continue; }
        if (!/\.(srt|vtt)$/i.test(name)) continue;
        const m = name.match(/page\D*(\d+)\D+page\D*(\d+)/i);
        if (!m) { log(`  BO QUA (khong ro chuong/bai): ${prefix}${name}`, "log-skip"); continue; }
        const text = await (await h.getFile()).text();
        srtArr.push({ ch: +m[1], ls: +m[2], srt: text });
      }
    }
    await scan(dir, "");
    if (!srtArr.length) { log("Khong tim thay file SRT hop le (ten kieu page_1_page_(1).srt).", "log-err"); return; }
    log(`Doc duoc ${srtArr.length} file SRT. Dang doc bai tren web de so sanh...`, "log-info");
    const tab = await requireAppTab(); if (!tab) return;
    const r = await runInApp(tab.id, injectReadLessons);
    if (!r || !r.ok) { log("Khong doc duoc bai tren web: " + (r && r.err || "?"), "log-err"); return; }
    const webLessons = r.lessons || [];
    const haveSrt = new Set(r.haveSrt || []);
    const lessonByCL = new Map(); webLessons.forEach((L) => lessonByCL.set(L.ch + ":" + L.ls, L));
    const matchedArr = [], already = [], extra = [];
    srtArr.forEach((s) => {
      const L = lessonByCL.get(s.ch + ":" + s.ls);
      if (!L) extra.push(s);
      else if (haveSrt.has(L.id)) already.push(s);
      else matchedArr.push(s);
    });
    const fileSet = new Set(srtArr.map((s) => s.ch + ":" + s.ls));
    const missing = webLessons.filter((L) => !haveSrt.has(L.id) && !fileSet.has(L.ch + ":" + L.ls));
    renderSrtPreview(webLessons, srtArr, haveSrt, matchedArr, already, extra, missing);
    pendingSrt = { matchedArr, tabId: tab.id };
    log(`So sanh xong: ${matchedArr.length} bai MOI se nap; ${already.length} da co srt (bo qua); ${extra.length} chua co bai (bo qua).`, "log-info");
  } catch (e) { log("Loi: " + e.message, "log-err"); }
  finally { el.loadSrt.disabled = false; }
});

el.srtCancel.addEventListener("click", () => { el.srtPreview.hidden = true; pendingSrt = null; log("Da huy nap SRT.", "log-info"); });

el.srtConfirm.addEventListener("click", async () => {
  if (!pendingSrt) return;
  const { matchedArr, tabId } = pendingSrt;
  if (!matchedArr.length) { log("Khong co bai nao khop de nap.", "log-err"); return; }
  el.srtConfirm.disabled = true;
  try {
    log(`Dang nap ${matchedArr.length} srt vao web (moi bai 1 doc rieng)...`, "log-info");
    const res = await runInApp(tabId, injectLoadSrt, matchedArr);
    if (res && res.ok) {
      log(`XONG. Da nap srt cho ${res.matched} bai.`, "log-ok");
      if (res.missing && res.missing.length) {
        const tm = res.missing.reduce((n, m) => n + m.bais.length, 0);
        log(`Con ${tm} bai chua co srt:`, "log-skip");
        res.missing.forEach((m) => log(`   ${m.name}: thieu Bai ${m.bais.join(", ")}`, "log-skip"));
      } else log("Tat ca bai tren web deu da co srt.", "log-ok");
      el.srtPreview.hidden = true; pendingSrt = null;
      log("Dang tai lai web...", "log-info");
      chrome.tabs.reload(tabId);
    } else log("Loi khi nap: " + (res && res.err || "khong ro"), "log-err");
  } catch (e) { log("Loi: " + e.message, "log-err"); }
  finally { el.srtConfirm.disabled = false; }
});

/* =====================================================================
   PHAN: DUB YOUTUBE - nap srt vao extension theo videoId
   ===================================================================== */
function renderDubMissing(missing) {
  el.dubMissingList.innerHTML = "";
  missing.sort((a, b) => (a.ch - b.ch) || (a.ls - b.ls)).forEach((L) => {
    const row = document.createElement("div"); row.className = "mi-row";
    const lab = document.createElement("span"); lab.textContent = "○ Ch" + L.ch + "/Bai" + L.ls;
    const btn = document.createElement("button"); btn.className = "yt-btn"; btn.textContent = "📋 Lenh yt-dlp";
    btn.onclick = () => downloadYtSrtFor(L, btn, row);
    row.appendChild(lab); row.appendChild(btn);
    el.dubMissingList.appendChild(row);
  });
  el.dubMissingBox.hidden = false;
}

el.dubScan.addEventListener("click", async () => {
  const listId = extractListId(el.dubPlUrl.value);
  if (!listId) { log("Link playlist khong hop le (thieu ?list=...).", "log-err"); return; }
  if (!window.showDirectoryPicker) { log("Trinh duyet khong ho tro chon thu muc.", "log-err"); return; }
  el.dubScan.disabled = true; el.dubMissingBox.hidden = true;
  try {
    log("Dang doc playlist (mo tab YouTube, tu dong dong)...", "log-info");
    const items = await fetchPlaylistViaTab(listId);
    if (!items.length) { log("Playlist rong.", "log-err"); return; }
    log(`Playlist co ${items.length} video. Chon thu muc SRT...`, "log-info");
    const dir = await window.showDirectoryPicker();
    const srtMap = new Map();
    async function scan(handle) {
      for await (const [name, h] of handle.entries()) {
        if (h.kind === "directory") { await scan(h); continue; }
        if (!/\.(srt|vtt)$/i.test(name)) continue;
        const m = name.match(/page\D*(\d+)\D+page\D*(\d+)/i);
        if (!m) continue;
        srtMap.set(+m[1] + ":" + +m[2], await (await h.getFile()).text());
      }
    }
    await scan(dir);
    log(`Doc duoc ${srtMap.size} file SRT. Dang khop + luu vao extension...`, "log-info");
    const store = {}; let stored = 0; const missing = [];
    items.forEach((it) => {
      const m = (it.title || "").match(/page\D*(\d+)\D+page\D*(\d+)/i);
      if (!m) return;
      const srt = srtMap.get(+m[1] + ":" + +m[2]);
      if (srt) { store["ytdub:" + it.id] = { srt: srt, cues: [] }; stored++; }
      else missing.push({ ch: +m[1], ls: +m[2], videoId: it.id });
    });
    await new Promise((res) => chrome.storage.local.set(store, res));
    log(`XONG. Da luu srt cho ${stored} video vao extension.`, "log-ok");
    if (missing.length) {
      log(`${missing.length} video THIEU srt -> dung nut ben duoi tai bang yt-dlp roi nap lai.`, "log-skip");
      renderDubMissing(missing);
    } else { log("Tat ca video deu co srt. Mo youtube.com/watch video do de long tieng!", "log-ok"); }
  } catch (e) { if (e && e.name === "AbortError") log("Da huy chon thu muc.", "log-skip"); else log("Loi: " + e.message, "log-err"); }
  finally { el.dubScan.disabled = false; }
});

el.dubClear.addEventListener("click", async () => {
  const all = await new Promise((res) => chrome.storage.local.get(null, res));
  const keys = Object.keys(all).filter((k) => k.indexOf("ytdub:") === 0);
  if (!keys.length) { log("Khong co srt nao da luu.", "log-info"); return; }
  await new Promise((res) => chrome.storage.local.remove(keys, res));
  log(`Da xoa srt cua ${keys.length} video khoi extension.`, "log-ok");
});

// ====== Khoi tao ======
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.local.get(["driveUrl"], (data) => { if (data.driveUrl) el.driveUrl.value = data.driveUrl; updateRunEnabled(); });
}
getToken(false).then((t) => { accessToken = t; setSignedIn(true); }).catch(() => {});
if (!window.showDirectoryPicker) {
  el.pickDir.disabled = true; el.dirStatus.textContent = "Trinh duyet khong ho tro chon thu muc";
  log("Trinh duyet nay khong ho tro File System Access API. Hay dung Chrome/Chromium ban moi.", "log-err");
}

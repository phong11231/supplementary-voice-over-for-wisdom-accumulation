// ===== Hoc Toolkit - Bang noi tren YouTube Studio: xuat ban hang loat ban nhap =====
(function () {
  "use strict";
  if (window.__hocToolkitStudio) return;
  window.__hocToolkitStudio = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let STOP = false, RUNNING = false;

  function dqAll(sel, root) {
    const out = [], seen = new Set();
    (function walk(n) {
      if (!n || seen.has(n)) return; seen.add(n);
      let f = []; try { f = n.querySelectorAll ? n.querySelectorAll(sel) : []; } catch (e) {}
      f.forEach((e) => out.push(e));
      const k = n.querySelectorAll ? n.querySelectorAll("*") : [];
      k.forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
    })(root || document);
    return out;
  }
  const dq = (s, r) => dqAll(s, r)[0];
  async function waitFor(fn, timeout, interval) {
    timeout = timeout || 15000; interval = interval || 200; const t0 = Date.now();
    for (;;) { let v; try { v = fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() - t0 > timeout) return null; await sleep(interval); }
  }

  // ---------- Studio DOM helpers ----------
  function parseNum(title) { const m = (title || "").match(/page\D*(\d+)\D+page\D*(\d+)/i); return m ? { ch: +m[1], ls: +m[2] } : null; }
  function rowData(r) {
    const a = dq("a#video-title", r) || dq("#video-title", r);
    const title = a ? a.textContent.trim().replace(/\s+/g, " ") : "";
    const txt = r.innerText || "";
    return { r, title, isDraft: /Bản nháp/.test(txt), processing: /Đang tải lên|Đang chờ xử lý|Huỷ tải lên/.test(txt) };
  }
  const getRows = () => dqAll("ytcp-video-row").map(rowData);
  const pagerNext = () => dqAll("ytcp-icon-button,tp-yt-iconbutton,button").find((b) => /trang tiếp theo|Next page/i.test(b.getAttribute("aria-label") || ""));
  const pagerPrev = () => dqAll("ytcp-icon-button,tp-yt-iconbutton,button").find((b) => /trang trước|Previous page/i.test(b.getAttribute("aria-label") || ""));
  const disabled = (b) => !b || b.hasAttribute("disabled") || b.getAttribute("aria-disabled") === "true";
  function dialogOpen() { const d = dq("ytcp-uploads-dialog"); return d && d.getBoundingClientRect().height > 120 ? d : null; }
  function pageSize() { const t = dq("#page-size"); const n = t ? parseInt((t.innerText || "").replace(/\D/g, ""), 10) : 0; return n || 0; }
  function onVideoList() { return /\/videos(\/|$|\?)/.test(location.href) && dqAll("ytcp-video-row").length > 0; }

  async function gotoFirstPage() { let g = 0; while (g++ < 60) { const p = pagerPrev(); if (disabled(p)) break; p.click(); await sleep(1200); } }

  // Quet vung video gan day; dung khi da qua het ban nhap (mien nhiem dao thu tu sau khi push).
  // callback(rows) cho moi trang. Tra ve khi: het trang, hoac da thay nhap roi gap 1 trang khong con nhap.
  async function scanRecent(onPage) {
    await gotoFirstPage();
    let g = 0, seenDraft = false, noDraftStreak = 0;
    while (g++ < 200) {
      if (STOP) return;
      await sleep(500);
      const rows = getRows();
      let pageHasDraft = rows.some((x) => x.isDraft && !x.processing);
      onPage(rows);
      if (pageHasDraft) { seenDraft = true; noDraftStreak = 0; }
      else if (seenDraft) { noDraftStreak++; }
      const next = pagerNext();
      if (disabled(next)) return;
      if (noDraftStreak >= 4) return; // qua 4 trang lien tiep khong co nhap -> da het vung nhap
      next.click(); await sleep(1400);
    }
  }

  // Tim TEN cua ban nhap CU NHAT (page nho nhat) tren toan vung gan day
  async function findOldestDraftTitle() {
    let best = null;
    await scanRecent((rows) => {
      rows.forEach((x) => {
        if (x.isDraft && !x.processing) {
          const p = parseNum(x.title); const key = p ? p.ch * 100000 + p.ls : 1e12;
          if (!best || key < best.key) best = { key, title: x.title };
        }
      });
    });
    return best ? best.title : null;
  }

  // Dinh vi dung row theo TEN (sau khi list dao) roi xuat ban
  async function publishByTitle(title) {
    await gotoFirstPage();
    let g = 0;
    while (g++ < 80) {
      if (STOP) return { ok: false, err: "da dung" };
      await sleep(500);
      const row = getRows().find((x) => x.title === title && x.isDraft && !x.processing);
      if (row) return await publishDraft(row);
      const next = pagerNext();
      if (disabled(next)) return { ok: false, err: "khong tim thay '" + title + "'" };
      next.click(); await sleep(1400);
    }
    return { ok: false, err: "qua nhieu trang" };
  }

  // Quet tat ca ban nhap -> danh sach ten theo thu tu cu->moi
  async function scanDrafts() {
    const found = [], seen = new Set(); let processing = 0;
    await scanRecent((rows) => {
      rows.forEach((x) => {
        if (x.processing) processing++;
        if (x.isDraft && !x.processing && !seen.has(x.title)) { seen.add(x.title); found.push(x.title); }
      });
    });
    found.sort((a, b) => { const pa = parseNum(a) || { ch: 0, ls: 0 }, pb = parseNum(b) || { ch: 0, ls: 0 }; return pa.ch - pb.ch || pa.ls - pb.ls; });
    return { found, processing };
  }

  // Xuat ban 1 ban nhap
  async function publishDraft(row) {
    const edit = dqAll("ytcp-button", row.r).find((b) => /Chỉnh sửa bản nháp/i.test(b.textContent || ""));
    if (!edit) return { ok: false, err: "khong thay nut Chinh sua ban nhap" };
    edit.click();
    const dlg = await waitFor(() => dialogOpen(), 20000);
    if (!dlg) return { ok: false, err: "dialog khong mo" };
    await sleep(900);
    const vis = await waitFor(() => dq("#step-badge-3", dlg), 10000);
    if (!vis) return { ok: false, err: "khong thay buoc Che do hien thi" };
    vis.click(); await sleep(1100);
    const pub = await waitFor(() => dq('tp-yt-paper-radio-button[name="PUBLIC"]', dlg), 8000);
    if (!pub) return { ok: false, err: "khong thay radio Cong khai" };
    pub.click(); await sleep(700);
    const cb = dq("#enable-premiere-checkbox", dlg);
    if (cb && cb.getAttribute("aria-checked") !== "true") { (dq("#checkbox", cb) || cb).click(); await sleep(500); }
    const done = await waitFor(() => { const d = dq("#done-button", dlg); return d && /Xuất bản/i.test(d.textContent || "") && d.getAttribute("aria-disabled") !== "true" ? d : null; }, 8000);
    if (!done) return { ok: false, err: "nut Xuat ban chua san sang" };
    done.click();
    // cho dialog "Da dang video" -> bam Dong
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      await sleep(700);
      const d = dialogOpen();
      if (!d) return { ok: true };
      const close = dqAll("ytcp-button,button,tp-yt-paper-button", d).find((b) => /^Đóng$/i.test((b.textContent || "").trim()));
      if (close) { close.click(); await sleep(900); if (!dialogOpen()) return { ok: true }; }
    }
    return { ok: false, err: "dialog khong dong sau khi xuat ban" };
  }

  // ---------- Vong lap push (cu nhat truoc) ----------
  async function pushAll() {
    if (RUNNING) return;
    if (!onVideoList()) { L("Hay vao muc 'Noi dung' (danh sach video) roi bam lai.", "err"); return; }
    const ps = pageSize();
    if (ps > 30) { L("⚠️ 'So hang moi trang' dang " + ps + " -> co the doc thieu. Hay doi xuong 30 (goc duoi phai) roi chay lai.", "err"); return; }
    RUNNING = true; STOP = false; setBusy(true);
    L("Quet toan bo ban nhap (co the mat chut thoi gian)...", "info");
    const { found, processing } = await scanDrafts();
    if (!found.length) { L("Khong tim thay ban nhap nao. Xong.", "ok"); RUNNING = false; setBusy(false); return; }
    L("Se push " + found.length + " video theo thu tu cu->moi." + (processing ? " (" + processing + " dang xu ly se bo qua)" : ""), "info");
    let n = 0, err = 0;
    for (const title of found) {
      if (STOP) break;
      L("Dang push (" + (n + 1) + "/" + found.length + "): " + title, "info");
      const res = await publishByTitle(title);
      if (res.ok) { n++; L("✔ " + title + " (da cong khai)", "ok"); }
      else if (res.err && /khong tim thay/.test(res.err)) { L("⤼ bo qua (khong con la nhap): " + title, "dim"); }
      else { err++; L("✖ " + title + " -> " + res.err, "err"); L("Dung de ban kiem tra roi chay lai.", "err"); break; }
      await sleep(1600);
    }
    if (STOP) L("DA DUNG. Da push " + n + " video.", "err");
    else L("HOAN TAT. Da push " + n + " video" + (err ? ", loi " + err : "") + ".", "ok");
    RUNNING = false; setBusy(false);
  }

  async function doScan() {
    if (RUNNING) return;
    if (!onVideoList()) { L("Hay vao muc 'Noi dung' (danh sach video) roi bam lai.", "err"); return; }
    const ps = pageSize();
    if (ps > 30) { L("⚠️ 'So hang moi trang' dang " + ps + " -> hay doi xuong 30 de quet du.", "err"); }
    setBusy(true); L("Dang quet ban nhap...", "info");
    const { found, processing } = await scanDrafts();
    L("Tim thay " + found.length + " ban nhap (thu tu push):", "info");
    found.forEach((t, i) => L("  " + (i + 1) + ". " + t, "dim"));
    if (processing) L("(" + processing + " video dang tai/xu ly -> se bo qua)", "dim");
    setBusy(false);
  }

  // ---------- Panel UI ----------
  const panel = document.createElement("div");
  panel.id = "hoc-toolkit-studio";
  panel.innerHTML =
    '<div id="htk-head"><span>📺 Hoc Toolkit · Xuat ban</span><span id="htk-min">—</span></div>' +
    '<div id="htk-body">' +
    '  <div id="htk-btns">' +
    '    <button id="htk-scan">🔍 Quet thu tu</button>' +
    '    <button id="htk-push">🚀 Push tat ca (cu nhat truoc)</button>' +
    '    <button id="htk-stop" disabled>■ Dung</button>' +
    '  </div>' +
    '  <div id="htk-note">Vao muc <b>Noi dung</b> (danh sach video), dat <b>So hang moi trang = 30</b>. Push se tu chon Cong khai + "Cong chieu ngay" + Xuat ban + Dong.</div>' +
    '  <div id="htk-log"></div>' +
    "</div>";
  const css = document.createElement("style");
  css.textContent =
    "#hoc-toolkit-studio{position:fixed;top:72px;right:16px;width:330px;z-index:2147483647;background:#1a1f35;color:#e8ecff;border:1px solid #333a5c;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);font:13px/1.4 system-ui,sans-serif;overflow:hidden}" +
    "#htk-head{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#232a45;cursor:move;font-weight:700}" +
    "#htk-min{cursor:pointer;padding:0 6px}" +
    "#htk-body{padding:10px 12px}" +
    "#htk-btns{display:flex;flex-direction:column;gap:7px}" +
    "#hoc-toolkit-studio button{border:1px solid #333a5c;background:#232a45;color:#e8ecff;border-radius:8px;padding:8px 10px;font-weight:700;cursor:pointer;font-size:13px}" +
    "#hoc-toolkit-studio button:hover:not(:disabled){filter:brightness(1.15)}" +
    "#hoc-toolkit-studio button:disabled{opacity:.45;cursor:not-allowed}" +
    "#htk-push{background:#22c55e;border-color:#22c55e;color:#04210f}" +
    "#htk-stop{background:#ef4444;border-color:#ef4444;color:#fff}" +
    "#htk-note{font-size:11.5px;color:#9aa3c7;margin:9px 0 6px}" +
    "#htk-log{margin-top:6px;background:#0a0d1a;border:1px solid #333a5c;border-radius:8px;padding:8px;height:200px;overflow:auto;font:11.5px/1.45 ui-monospace,monospace;white-space:pre-wrap}" +
    ".htk-ok{color:#6ee7a8}.htk-err{color:#ff9b9b}.htk-info{color:#cdd5f5}.htk-dim{color:#8aa0d8}" +
    "#hoc-toolkit-studio.min #htk-body{display:none}";
  document.documentElement.appendChild(css);
  document.documentElement.appendChild(panel);

  const logEl = panel.querySelector("#htk-log");
  function L(msg, cls) {
    const d = document.createElement("div");
    d.className = "htk-" + (cls || "info");
    d.textContent = msg;
    logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
  }
  const btnScan = panel.querySelector("#htk-scan");
  const btnPush = panel.querySelector("#htk-push");
  const btnStop = panel.querySelector("#htk-stop");
  function setBusy(b) { btnScan.disabled = b; btnPush.disabled = b; btnStop.disabled = !b; }

  btnScan.onclick = doScan;
  btnPush.onclick = pushAll;
  btnStop.onclick = () => { if (RUNNING) { STOP = true; L("Dang dung sau khi xong video hien tai...", "err"); } };
  panel.querySelector("#htk-min").onclick = () => panel.classList.toggle("min");

  // keo tha panel
  (function drag() {
    const head = panel.querySelector("#htk-head"); let sx, sy, ox, oy, on = false;
    head.addEventListener("mousedown", (e) => { if (e.target.id === "htk-min") return; on = true; sx = e.clientX; sy = e.clientY; const r = panel.getBoundingClientRect(); ox = r.left; oy = r.top; e.preventDefault(); });
    window.addEventListener("mousemove", (e) => { if (!on) return; panel.style.left = (ox + e.clientX - sx) + "px"; panel.style.top = (oy + e.clientY - sy) + "px"; panel.style.right = "auto"; });
    window.addEventListener("mouseup", () => { on = false; });
  })();

  L("San sang. Vao 'Noi dung', dat 30 hang/trang, roi bam Quet / Push.", "dim");
})();

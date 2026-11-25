// ===== Hoc Toolkit - Long tieng Viet NGAY TREN YouTube (dong bo nhu web hoc) =====
(function () {
  "use strict";
  if (window.__hocToolkitYtDub) return;
  window.__hocToolkitYtDub = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- SRT ----------
  function parseSRT(text) {
    const out = []; if (!text) return out;
    const blocks = text.replace(/\r/g, "").replace(/^WEBVTT.*?\n/, "").split(/\n\s*\n/);
    blocks.forEach((b) => {
      const lines = b.split("\n").filter((x) => x.trim() !== "");
      let ti = -1;
      for (let i = 0; i < lines.length; i++) { if (/-->/.test(lines[i])) { ti = i; break; } }
      if (ti < 0) return;
      const m = lines[ti].match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/);
      if (!m) return;
      const s = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
      const e = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
      const txt = lines.slice(ti + 1).join(" ").replace(/<[^>]+>/g, "").trim();
      if (txt) out.push({ start: s, end: e, en: txt, vi: "" });
    });
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  // ---------- Dich (Google free -> MyMemory) ----------
  async function translateText(text) {
    if (!text) return "";
    try {
      const u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=" + encodeURIComponent(text);
      const res = await fetch(u);
      if (res.ok) { const d = await res.json(); if (d && d[0]) return d[0].map((x) => x[0]).join(""); }
    } catch (e) {}
    try {
      const r2 = await fetch("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=en|vi");
      const d2 = await r2.json(); if (d2 && d2.responseData && d2.responseData.translatedText) return d2.responseData.translatedText;
    } catch (e) {}
    return text;
  }
  async function translateCues(cues, onP) {
    for (let i = 0; i < cues.length; i++) {
      if (cues[i].vi) { onP && onP(i + 1, cues.length); continue; }
      cues[i].vi = await translateText(cues[i].en);
      onP && onP(i + 1, cues.length);
      await sleep(70);
    }
  }

  // ---------- TTS (giong Viet that, free) ----------
  const TTS_PROXY = "https://edge-tts-api-gold.vercel.app/api/gtts";
  const ttsUrl = (t) => TTS_PROXY + "?lang=vi&text=" + encodeURIComponent((t || "").slice(0, 200));
  let curAudio = null;
  function stopSpeak() { if (curAudio) { try { curAudio.pause(); } catch (e) {} curAudio = null; } }

  // Co giAN toc do doc cho vua khung thoi gian (Y CHANG web hoc)
  function speakCue(idx) {
    const cue = curCues[idx]; if (!cue || !cue.vi) return;
    stopSpeak();
    let vrate = 1.0; try { vrate = video.playbackRate || 1.0; } catch (e) {}
    const next = curCues[idx + 1];
    const endBound = next ? Math.max(next.start, cue.end) : (cue.end + 1.5);
    let nowT = cue.start;
    try { const t = video.currentTime; if (t > cue.start - 0.3 && t < endBound) nowT = t; } catch (e) {}
    const avail = (endBound - nowT) / vrate;
    const mult = parseFloat(speedEl.value) || 1.0;
    const a = new Audio(ttsUrl(cue.vi)); curAudio = a;
    a.addEventListener("loadedmetadata", function () {
      const dur = a.duration || 0; let rate = 1.0;
      if (dur > 0 && avail > 0.25) rate = dur / (avail * 0.97);
      rate = Math.max(1.0, rate) * mult;
      rate = Math.max(0.7, Math.min(4.0, rate));
      try { a.playbackRate = rate; } catch (e) {}
    });
    a.play().catch(() => {});
  }

  // ---------- Dong bo voi video YouTube ----------
  let curCues = [], lastIdx = -1, dubOn = true, loopTimer = null, video = null, curVid = "";
  function cueIndexAt(t) { for (let i = 0; i < curCues.length; i++) { if (t >= curCues[i].start && t < curCues[i].end) return i; } return -1; }
  function renderSub(idx) {
    if (idx < 0) { subVi.textContent = ""; subEn.textContent = ""; return; }
    subVi.textContent = curCues[idx].vi || ""; subEn.textContent = curCues[idx].en || "";
  }
  function startLoop() {
    stopLoop();
    loopTimer = setInterval(function () {
      if (!video || !dubOn) return;
      if (video.paused || video.seeking) { return; }
      const t = video.currentTime;
      const idx = cueIndexAt(t);
      if (idx !== lastIdx) {
        lastIdx = idx;
        if (idx >= 0) { stopSpeak(); speakCue(idx); renderSub(idx); }
        else { renderSub(-1); }
      }
    }, 150);
  }
  function stopLoop() { if (loopTimer) { clearInterval(loopTimer); loopTimer = null; } }

  function applyMute() { if (video) { try { video.muted = dubOn; } catch (e) {} } }

  // ---------- UI overlay ----------
  const panel = document.createElement("div");
  panel.id = "htk-ytdub";
  panel.innerHTML =
    '<div id="htkd-bar">' +
    '  <span id="htkd-toggle" class="on">🎙 Long tieng: BAT</span>' +
    '  <span id="htkd-rate">Toc do <input id="htkd-speed" type="range" min="0.8" max="1.6" step="0.05" value="1.0"><b id="htkd-sv">1.0x</b></span>' +
    '  <span id="htkd-status"></span>' +
    '  <button id="htkd-load" style="display:none">📂 Nap SRT</button>' +
    '  <button id="htkd-dlx" style="display:none">📋 yt-dlp Linux</button>' +
    '  <button id="htkd-dwin" style="display:none">📋 yt-dlp Win</button>' +
    '  <span id="htkd-min">—</span>' +
    "</div>" +
    '<div id="htkd-subs"><div id="htkd-vi"></div><div id="htkd-en"></div></div>';
  const css = document.createElement("style");
  css.textContent =
    "#htk-ytdub{position:fixed;right:16px;bottom:16px;width:420px;max-width:46vw;z-index:2147483647;background:rgba(16,18,30,.96);color:#e8ecff;border:1px solid #333a5c;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.6);font:13px/1.45 system-ui,sans-serif;overflow:hidden}" +
    "#htkd-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#232a45;flex-wrap:wrap}" +
    "#htkd-toggle{font-weight:700;cursor:pointer;color:#ff9b9b}#htkd-toggle.on{color:#6ee7a8}" +
    "#htkd-rate{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#9aa3c7}#htkd-speed{width:90px}" +
    "#htkd-status{font-size:12px;color:#9aa3c7;flex:1}" +
    "#htkd-min{cursor:pointer;padding:0 4px}" +
    "#htk-ytdub button{border:1px solid #333a5c;background:#2a3250;color:#e8ecff;border-radius:7px;padding:4px 9px;font-size:11.5px;font-weight:700;cursor:pointer}#htk-ytdub button:hover{filter:brightness(1.15)}#htkd-dlx,#htkd-dwin{background:#c4302b;border-color:#c4302b}#htkd-load{background:#22c55e;border-color:#22c55e;color:#04210f}" +
    "#htkd-subs{padding:12px 14px}" +
    "#htkd-vi{font-size:19px;font-weight:700;line-height:1.35}#htkd-vi:empty::before{content:'— loi thoai tieng Viet —';color:#6a7384;font-weight:500;font-size:14px}" +
    "#htkd-en{font-size:13px;color:#9aa3c7;margin-top:6px;font-style:italic}" +
    "#htk-ytdub.min #htkd-subs{display:none}";
  (document.documentElement || document.body).appendChild(css);
  (document.documentElement || document.body).appendChild(panel);
  const toggleEl = panel.querySelector("#htkd-toggle");
  const speedEl = panel.querySelector("#htkd-speed");
  const svEl = panel.querySelector("#htkd-sv");
  const statusEl = panel.querySelector("#htkd-status");
  const subVi = panel.querySelector("#htkd-vi");
  const subEn = panel.querySelector("#htkd-en");
  const loadBtn = panel.querySelector("#htkd-load");
  const dlxBtn = panel.querySelector("#htkd-dlx");
  const dwinBtn = panel.querySelector("#htkd-dwin");
  function showDlBtns(show) { const d = show ? "" : "none"; loadBtn.style.display = d; dlxBtn.style.display = d; dwinBtn.style.display = d; if (!show) { dlxBtn.textContent = "📋 yt-dlp Linux"; dwinBtn.textContent = "📋 yt-dlp Win"; } }
  let curCL = null;
  function setStatus(t) { statusEl.textContent = t || ""; }

  function getTitle() {
    try { if (window.ytInitialPlayerResponse && ytInitialPlayerResponse.videoDetails) return ytInitialPlayerResponse.videoDetails.title; } catch (e) {}
    const h = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title");
    return h ? h.textContent.trim() : (document.title.replace(/ - YouTube.*/, "").replace(/^\(\d+\)\s*/, ""));
  }
  function parseCL(t) { const m = (t || "").match(/page\D*(\d+)\D+page\D*(\d+)/i); return m ? { ch: +m[1], ls: +m[2] } : null; }

  // Nap SRT tu thu muc cho dung video nay (khop page X page Y theo ten video)
  loadBtn.onclick = async function () {
    if (!curCL) return;
    if (!window.showDirectoryPicker) { setStatus("Trinh duyet khong ho tro chon thu muc"); return; }
    let dir; try { dir = await window.showDirectoryPicker(); } catch (e) { return; }
    setStatus("Dang tim srt Ch" + curCL.ch + "/Bai" + curCL.ls + "...");
    let found = null;
    async function scan(h) {
      for await (const [name, fh] of h.entries()) {
        if (fh.kind === "directory") { await scan(fh); continue; }
        if (!/\.(srt|vtt)$/i.test(name)) continue;
        const m = name.match(/page\D*(\d+)\D+page\D*(\d+)/i);
        if (m && +m[1] === curCL.ch && +m[2] === curCL.ls) found = await (await fh.getFile()).text();
      }
    }
    try { await scan(dir); } catch (e) {}
    if (!found) { setStatus("Khong thay srt Ch" + curCL.ch + "/Bai" + curCL.ls + " trong thu muc. Tai bang yt-dlp roi thu lai."); return; }
    const obj = {}; obj["ytdub:" + curVid] = { srt: found, cues: [] };
    await new Promise((r) => chrome.storage.local.set(obj, r));
    showDlBtns(false);
    const v = curVid; curVid = ""; onVideo(v);
  };
  // Copy lenh yt-dlp cho video nay (rieng tung he dieu hanh)
  function ytdlpCmd(osWin) {
    const fname = "page_" + curCL.ch + "_page_ (" + curCL.ls + ")";
    const url = "https://www.youtube.com/watch?v=" + curVid;
    const base = 'yt-dlp --write-auto-sub --sub-langs en --convert-subs srt --skip-download -o "' + fname + '.%(ext)s" "' + url + '"';
    return base + (osWin ? ' && ren "' + fname + '.en.srt" "' + fname + '.srt"' : ' && mv "' + fname + '.en.srt" "' + fname + '.srt"');
  }
  async function copyCmd(osWin, btn) {
    if (!curCL) return;
    try { await navigator.clipboard.writeText(ytdlpCmd(osWin)); btn.textContent = "✓ da copy"; setStatus("Da copy lenh " + (osWin ? "Windows" : "Linux") + ". cd vao thu muc srt -> dan -> chay -> bam '📂 Nap SRT'."); }
    catch (e) { setStatus("Loi copy lenh."); }
  }
  dlxBtn.onclick = () => copyCmd(false, dlxBtn);
  dwinBtn.onclick = () => copyCmd(true, dwinBtn);
  toggleEl.onclick = function () {
    dubOn = !dubOn; toggleEl.classList.toggle("on", dubOn);
    toggleEl.textContent = dubOn ? "🎙 Long tieng: BAT" : "🎙 Long tieng: TAT";
    applyMute(); if (!dubOn) { stopSpeak(); } else { lastIdx = -99; }
  };
  speedEl.oninput = function () { svEl.textContent = parseFloat(this.value).toFixed(2) + "x"; };
  panel.querySelector("#htkd-min").onclick = () => panel.classList.toggle("min");

  // ---------- Nap srt cho video hien tai ----------
  function getVid() { try { return new URL(location.href).searchParams.get("v") || ""; } catch (e) { return ""; } }
  function loadStoredSrt(vid) {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage) return resolve(null);
      chrome.storage.local.get(["ytdub:" + vid], (d) => resolve(d && d["ytdub:" + vid]));
    });
  }
  function saveCues(vid, srt, cues) {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    const obj = {}; obj["ytdub:" + vid] = { srt: srt, cues: cues.map((c) => ({ start: c.start, end: c.end, en: c.en, vi: c.vi })) };
    chrome.storage.local.set(obj);
  }

  async function onVideo(vid) {
    if (!vid || vid === curVid) return;
    curVid = vid;
    stopSpeak(); stopLoop(); lastIdx = -1; curCues = []; renderSub(-1);
    video = document.querySelector("video.html5-main-video") || document.querySelector("video");
    const data = await loadStoredSrt(vid);
    if (!data || !data.srt) {
      curCL = parseCL(getTitle());
      if (curCL) { setStatus("Chua co SRT (Ch" + curCL.ch + "/Bai" + curCL.ls + ") — nap hoac tai:"); showDlBtns(true); }
      else { setStatus("Chua co SRT — ten video khong dang 'page X page Y'"); showDlBtns(false); }
      panel.classList.remove("min"); return;
    }
    showDlBtns(false);
    curCues = parseSRT(data.srt);
    if (!curCues.length) { setStatus("SRT rong"); return; }
    if (data.cues && data.cues.length === curCues.length) { for (let i = 0; i < curCues.length; i++) if (data.cues[i].vi) curCues[i].vi = data.cues[i].vi; }
    const need = curCues.some((c) => !c.vi);
    if (need) {
      setStatus("Dang dich... 0/" + curCues.length);
      await translateCues(curCues, (cur, total) => setStatus("Dang dich... " + cur + "/" + total));
      saveCues(vid, data.srt, curCues);
    }
    setStatus("San sang — dang long tieng");
    applyMute();
    startLoop();
  }

  // ---------- Theo doi doi video (YouTube la SPA) ----------
  function tick() {
    const v = getVid();
    if (v && v !== curVid) onVideo(v);
    // dam bao van mute khi dub
    if (dubOn && video && !video.muted) { try { video.muted = true; } catch (e) {} }
  }
  setInterval(tick, 1000);
  document.addEventListener("yt-navigate-finish", () => setTimeout(tick, 600));
  setTimeout(tick, 1500);
})();

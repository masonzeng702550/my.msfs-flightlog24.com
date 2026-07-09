// Story maker: compose an uploaded horizontal flight recording with the flight's
// map route, altitude/speed profile and info into a 9:16 portrait clip, all
// time-compressed to the video's length, and export it via MediaRecorder.
(function () {
  const T = k => (window.I18N ? window.I18N.t(k) : k);
  const IC = n => (window.I18N ? window.I18N.ICONS[n] : "");
  const $ = id => document.getElementById(id);

  const canvas = $("story-canvas"), ctx = canvas.getContext("2d");
  // logical drawing space; the backing store is 1080x1920 (exact Instagram-story
  // 9:16), so the context is scaled up from these 720x1280 logical units.
  const W = 720, H = 1280;
  const statusEl = $("story-status");
  const flightSel = $("story-flight"), videoInput = $("story-video");
  const mapBtn = $("story-map"), followBtn = $("story-follow");
  const routeIn = $("story-route"), sidIn = $("story-sid"), starIn = $("story-star");
  const playBtn = $("story-play"), recBtn = $("story-record"), dl = $("story-download");

  const videoEl = document.createElement("video");
  videoEl.muted = false; videoEl.playsInline = true; videoEl.preload = "auto";

  // layout bands (y, logical) — includes a route/procedure info band and a
  // reserved safe zone for an Instagram link sticker
  const TITLE = [0, 86], VID = [86, 496], READ = [496, 542], MAP = [542, 982];
  const PROF_H = 120, FOOT_H = 32;
  // INFO/PROF/FOOT are laid out each frame: the ROUTE/SID/STAR box grows with the
  // number of route lines, the profile keeps its height but shifts down, and the
  // leftover black space at the bottom (an Instagram-link safe zone) absorbs it
  let INFO = [982, 1076], PROF = [1082, 1202], FOOT = [1248, 1280], routeLines = ["—"];

  let flight = null, S = [], coords = [], duration = 0, groundAlt = 0;
  let mapStyle = "dark", follow = true, routeView = null, preloadKey = "";
  let route = "", sid = "", star = "";
  let raf = null, recorder = null, drawScheduled = false;
  const tiles = new Map();                 // "style/z/x/y" -> Image | null | Promise
  const Z_GROUND = 16, AGL_FULL = 5000;    // ground = taxiway zoom; by 5000 ft AGL show the whole route

  const status = (msg) => { statusEl.textContent = msg || ""; statusEl.style.display = msg ? "block" : "none"; };

  // ── web-mercator helpers ────────────────────────────────────────────
  const worldX = (lon, z) => (lon + 180) / 360 * Math.pow(2, z) * 256;
  const worldY = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * 256; };
  const tileURL = (style, z, x, y) => style === "sat"
    ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
    : `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;

  // ── dynamic tile map ────────────────────────────────────────────────
  const tileKey = (z, x, y) => `${mapStyle}/${z}/${x}/${y}`;
  const tileImg = (z, x, y) => { const v = tiles.get(tileKey(z, x, y)); return v instanceof HTMLImageElement ? v : null; };
  function loadTile(z, x, y) {
    const k = tileKey(z, x, y), have = tiles.get(k);
    if (have !== undefined) return have instanceof Promise ? have : Promise.resolve(have);
    const pr = new Promise(res => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { tiles.set(k, img); res(img); };
      img.onerror = () => { tiles.set(k, null); res(null); };
      img.src = tileURL(mapStyle === "sat" ? "sat" : "dark", z, x, y);
    });
    tiles.set(k, pr); return pr;
  }

  // altitude-based follow view: always centred on the aircraft (correct framing on
  // the ground / takeoff / landing), zoomed right in for taxiways and easing out to
  // the whole-route scale by 5000 ft AGL; symmetric on descent
  function followView(p) {
    const agl = Math.max(0, p.alt - groundAlt);
    const t = routeView ? Math.min(1, agl / AGL_FULL) : 0;
    const rz = routeView ? routeView.z : Z_GROUND;
    return { cLat: p.lat, cLon: p.lon, zf: Z_GROUND + (rz - Z_GROUND) * t };
  }

  // whole-route framing for the non-follow view
  function computeRouteView(mw, mh) {
    groundAlt = S.length ? Math.min(...S.map(s => s[3])) : 0;
    if (!coords.length) { routeView = null; return; }
    const lats = coords.map(c => c[0]), lons = coords.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
    let z = 3;
    for (let zz = 17; zz >= 2; zz--) {
      const w = Math.abs(worldX(maxLon, zz) - worldX(minLon, zz)), h = Math.abs(worldY(minLat, zz) - worldY(maxLat, zz));
      if (w <= mw * 0.86 && h <= mh * 0.86) { z = zz; break; }
    }
    routeView = { z, cLat: (minLat + maxLat) / 2, cLon: (minLon + maxLon) / 2 };
  }

  // draw tiles filling [mx,my,mw,mh] centred on (cLat,cLon) at fractional zoom zf;
  // returns a lat/lon -> screen projector for the route + plane
  function drawTiles(cLat, cLon, zf, mx, my, mw, mh) {
    const z = Math.max(2, Math.min(19, Math.round(zf))), scale = Math.pow(2, zf - z);
    const cxp = worldX(cLon, z), cyp = worldY(cLat, z);
    const halfW = (mw / 2) / scale, halfH = (mh / 2) / scale;
    const minTx = Math.floor((cxp - halfW) / 256), maxTx = Math.floor((cxp + halfW) / 256);
    const minTy = Math.floor((cyp - halfH) / 256), maxTy = Math.floor((cyp + halfH) / 256);
    for (let tx = minTx; tx <= maxTx; tx++) for (let ty = minTy; ty <= maxTy; ty++) {
      const img = tileImg(z, tx, ty);
      const sx = mx + mw / 2 + (tx * 256 - cxp) * scale, sy = my + mh / 2 + (ty * 256 - cyp) * scale, sz = 256 * scale;
      if (img) ctx.drawImage(img, sx, sy, sz + 1, sz + 1);
      else if (tiles.get(tileKey(z, tx, ty)) === undefined) loadTile(z, tx, ty).then(scheduleDraw);
    }
    return (lat, lon) => [mx + mw / 2 + (worldX(lon, z) - cxp) * scale, my + mh / 2 + (worldY(lat, z) - cyp) * scale];
  }

  function scheduleDraw() {
    if (drawScheduled || (recorder && recorder.state === "recording")) return;
    drawScheduled = true;
    requestAnimationFrame(() => { drawScheduled = false; if (videoEl.paused) drawFrame(currentProgress()); });
  }

  function tilesForView(cLat, cLon, zf, mw, mh, set) {
    const z = Math.max(2, Math.min(19, Math.round(zf))), scale = Math.pow(2, zf - z);
    const cxp = worldX(cLon, z), cyp = worldY(cLat, z), halfW = (mw / 2) / scale, halfH = (mh / 2) / scale;
    for (let tx = Math.floor((cxp - halfW) / 256); tx <= Math.floor((cxp + halfW) / 256); tx++)
      for (let ty = Math.floor((cyp - halfH) / 256); ty <= Math.floor((cyp + halfH) / 256); ty++) set.add(z + "|" + tx + "|" + ty);
  }

  // pre-load every tile the clip needs so recording has no blank frames
  async function preloadTiles() {
    if (!coords.length) return;
    const key = mapStyle + ":" + (flight && flight.id) + ":" + (follow ? "F" : "R");
    if (preloadKey === key) return;
    const mw = W, mh = MAP[1] - MAP[0], need = new Set();
    if (follow) { const steps = 160; for (let i = 0; i <= steps; i++) { const p = at(i / steps * duration); const v = followView(p); tilesForView(v.cLat, v.cLon, v.zf, mw, mh, need); } }
    if (routeView) tilesForView(routeView.cLat, routeView.cLon, routeView.z, mw, mh, need);
    const keys = [...need]; let done = 0;
    status(T("story_building") + " 0%");
    await runConcurrent(keys, 12, k => { const [z, x, y] = k.split("|").map(Number); return loadTile(z, x, y).then(() => { done++; if (done % 6 === 0 || done === keys.length) status(T("story_building") + " " + Math.round(done / keys.length * 100) + "%"); }); });
    preloadKey = key; status(""); drawFrame(currentProgress());
  }
  function runConcurrent(items, n, fn) {
    let i = 0; const next = () => i < items.length ? fn(items[i++]).then(next) : Promise.resolve();
    return Promise.all(Array.from({ length: Math.min(n, items.length) }, next));
  }

  // ── replay interpolation ────────────────────────────────────────────
  function at(time) {
    if (!S.length) return null;
    let lo = 0, hi = S.length - 1;
    if (time <= S[0][0]) lo = hi = 0;
    else if (time >= S[hi][0]) lo = hi = S.length - 1;
    else { while (lo + 1 < hi) { const m = (lo + hi) >> 1; (S[m][0] <= time ? lo = m : hi = m); } }
    const a = S[lo], b = S[Math.min(lo + 1, S.length - 1)];
    const r = b[0] > a[0] ? (time - a[0]) / (b[0] - a[0]) : 0;
    let dh = ((b[4] - a[4] + 540) % 360) - 180;
    return { lat: a[1] + (b[1] - a[1]) * r, lon: a[2] + (b[2] - a[2]) * r,
             alt: a[3] + (b[3] - a[3]) * r, hdg: (a[4] + dh * r + 360) % 360,
             ias: a[5] + (b[5] - a[5]) * r, idx: lo };
  }

  // ── the composited frame ────────────────────────────────────────────
  // wrap into lines by width (measure only)
  function wrapLines(text, maxW, font) {
    ctx.font = font;
    const words = String(text).split(/\s+/), lines = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines.length ? lines : ["—"];
  }

  // dynamic layout below the fixed map: INFO box height tracks the route lines,
  // profile keeps PROF_H but shifts, footer pinned to the bottom
  function layout() {
    routeLines = wrapLines(route || "—", W - 44, "500 15px sans-serif");
    if (routeLines.length > 3) { routeLines = routeLines.slice(0, 3); routeLines[2] += "…"; }
    const INFO_H = 72 + routeLines.length * 20;
    INFO = [MAP[1], MAP[1] + INFO_H];
    PROF = [INFO[1] + 6, INFO[1] + 6 + PROF_H];
    FOOT = [H - FOOT_H, H];
  }

  function drawFrame(progress) {
    progress = Math.max(0, Math.min(1, progress || 0));
    const p = at(progress * duration);
    layout();
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);   // scale logical -> 1080x1920
    ctx.fillStyle = "#05070d"; ctx.fillRect(0, 0, W, H);

    // title
    if (flight) {
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#eaf1fb"; ctx.font = "700 34px -apple-system,Segoe UI,sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${flight.route.departure.icao}  →  ${flight.route.arrival.icao}`, 24, 40);
      ctx.fillStyle = "#8a99b3"; ctx.font = "500 17px -apple-system,Segoe UI,sans-serif";
      ctx.fillText(`${flight.aircraft.title}`, 24, 72);
      ctx.textAlign = "right";
      ctx.fillText(`${flight.date || ""} ${flight.time_local || ""}`, W - 24, 72);
      ctx.textAlign = "left";
    }

    // video (letterboxed 16:9)
    drawRegionBg(VID, "#000");
    if (videoEl.readyState >= 2) {
      const bandH = VID[1] - VID[0], vw = W, vh = vw * videoEl.videoHeight / videoEl.videoWidth || vw * 9 / 16;
      const vy = VID[0] + (bandH - vh) / 2;
      try { ctx.drawImage(videoEl, 0, vy, vw, vh); } catch (e) {}
    } else {
      ctx.fillStyle = "#5b6b86"; ctx.font = "500 18px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Upload your landscape flight recording", W / 2, (VID[0] + VID[1]) / 2); ctx.textAlign = "left";
    }

    // readout
    if (p) {
      ctx.textBaseline = "middle"; ctx.textAlign = "center";
      const cy = (READ[0] + READ[1]) / 2, seg = W / 3;
      const kv = (x, k, v, col) => {
        ctx.fillStyle = "#8a99b3"; ctx.font = "600 13px sans-serif"; ctx.fillText(k, x, cy - 11);
        ctx.fillStyle = col; ctx.font = "700 22px sans-serif"; ctx.fillText(v, x, cy + 8);
      };
      kv(seg * 0.5, "ALT", Math.round(p.alt).toLocaleString() + " ft", "#36c5ff");
      kv(seg * 1.5, "IAS", Math.round(p.ias) + " kt", "#eaf1fb");
      kv(seg * 2.5, "HDG", String(Math.round(p.hdg)).padStart(3, "0") + "°", "#ffaf43");
      ctx.textAlign = "left";
    }

    // map
    drawMap(p);

    // route + procedures
    drawInfo();

    // profile
    drawProfile(progress);

    // footer: progress + brand
    ctx.fillStyle = "#131c2e"; ctx.fillRect(0, FOOT[0], W, 4);
    ctx.fillStyle = "#36c5ff"; ctx.fillRect(0, FOOT[0], W * progress, 4);
    ctx.fillStyle = "#6d7d98"; ctx.font = "600 15px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("my.msfs-flightlog24", W / 2, (FOOT[0] + FOOT[1]) / 2 + 3); ctx.textAlign = "left";
  }

  function drawInfo() {
    const x = 22, y0 = INFO[0];
    ctx.fillStyle = "#0d1320"; roundRect(14, y0 + 4, W - 28, INFO[1] - y0 - 8, 10); ctx.fill();
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    let y = y0 + 24;
    ctx.fillStyle = "#6d7d98"; ctx.font = "700 12px sans-serif"; ctx.fillText("ROUTE", x, y);
    y += 20;
    ctx.fillStyle = "#dbe6f5"; ctx.font = "500 15px sans-serif";
    routeLines.forEach(l => { ctx.fillText(l, x, y); y += 20; });
    y += 16;   // breathing room between the route and the SID/STAR row
    ctx.fillStyle = "#6d7d98"; ctx.font = "700 12px sans-serif";
    ctx.fillText("SID", x, y); ctx.fillText("STAR", W / 2 + 4, y);
    ctx.fillStyle = "#dbe6f5"; ctx.font = "500 15px sans-serif";
    ctx.fillText(sid || "—", x + 44, y); ctx.fillText(star || "—", W / 2 + 56, y);
  }

  function drawRegionBg([y0, y1], col) { ctx.fillStyle = col; ctx.fillRect(0, y0, W, y1 - y0); }

  function drawMap(p) {
    const mx = 0, my = MAP[0], mw = W, mh = MAP[1] - MAP[0];
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
    ctx.fillStyle = "#0a1424"; ctx.fillRect(mx, my, mw, mh);
    let toS = null;
    if (coords.length) {
      if (follow && p) { const v = followView(p); toS = drawTiles(v.cLat, v.cLon, v.zf, mx, my, mw, mh); }
      else if (routeView) toS = drawTiles(routeView.cLat, routeView.cLon, routeView.z, mx, my, mw, mh);
    }
    if (toS) {
      strokePath(coords, toS, "#2a4d6e", 3);                                         // full route (dim)
      if (p) {
        strokePath(coords.slice(0, p.idx + 1).concat([[p.lat, p.lon]]), toS, "#36c5ff", 4);  // flown (bright)
        const [sx, sy] = toS(p.lat, p.lon);
        drawPlane(sx, sy, p.hdg);
      }
    }
    ctx.restore();
  }

  function strokePath(pts, toS, col, w) {
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((c, i) => { const [x, y] = toS(c[0], c[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
  }

  function drawPlane(x, y, hdg) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(hdg * Math.PI / 180); ctx.scale(1.5, 1.5);
    ctx.beginPath();
    const pts = [[0, -11], [2, -3], [11, 3], [11, 5], [2, 1], [2, 7], [5, 9.5], [5, 10.5], [0, 9], [-5, 10.5], [-5, 9.5], [-2, 7], [-2, 1], [-11, 5], [-11, 3], [-2, -3]];
    pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath();
    ctx.fillStyle = "#eef6ff"; ctx.strokeStyle = "#0b2030"; ctx.lineWidth = 1; ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawProfile(progress) {
    const px = 20, py = PROF[0] + 26, pw = W - 40, ph = PROF[1] - PROF[0] - 40;
    ctx.fillStyle = "#0d1320"; roundRect(px - 6, PROF[0] + 8, pw + 12, PROF[1] - PROF[0] - 12, 10); ctx.fill();
    ctx.fillStyle = "#8a99b3"; ctx.font = "600 12px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("ALTITUDE & SPEED  ·  cyan alt / amber speed", px, PROF[0] + 22);
    if (!S.length) return;
    const maxAlt = Math.max(...S.map(s => s[3]), 1), maxIas = Math.max(...S.map(s => s[5]), 1);
    const xt = t => px + (t / duration) * pw;
    line(s => xt(s[0]), s => py + ph - (s[3] / maxAlt) * ph, "#36c5ff", 2);
    line(s => xt(s[0]), s => py + ph - (s[5] / maxIas) * ph, "#ffaf43", 1.5);
    const cx = px + progress * pw;
    ctx.strokeStyle = "#ffffff"; ctx.globalAlpha = .8; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, py); ctx.lineTo(cx, py + ph); ctx.stroke(); ctx.globalAlpha = 1;
  }
  function line(fx, fy, col, w) {
    ctx.beginPath(); S.forEach((s, i) => { const x = fx(s), y = fy(s); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = "round"; ctx.stroke();
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  // ── data loading ────────────────────────────────────────────────────
  async function loadFlight(id) {
    try {
      flight = await fetch(`data/flights/${id}.json`, { cache: "no-cache" }).then(r => r.json());
      S = flight.replay || [];
      coords = S.map(s => [s[1], s[2]]);
      duration = flight.duration_sec || (S.length ? S[S.length - 1][0] : 0);
      computeRouteView(W, MAP[1] - MAP[0]);
      preloadKey = ""; drawFrame(0);
      preloadTiles();                       // start fetching tiles in the background
    } catch (e) { status("load error"); }
  }

  // ── preview + record ────────────────────────────────────────────────
  function loop() {
    const dur = (videoEl.duration && isFinite(videoEl.duration)) ? videoEl.duration : 60;
    const prog = videoEl.readyState >= 2 ? videoEl.currentTime / dur : 0;
    drawFrame(prog);
    if (!videoEl.paused && !videoEl.ended) raf = requestAnimationFrame(loop);
  }
  async function startPreview() {
    if (videoEl.readyState < 2) { status(T("story_need_video")); drawFrame(0); return; }
    await preloadTiles();
    videoEl.currentTime = 0; videoEl.play(); cancelAnimationFrame(raf); loop();
  }

  async function startRecord() {
    if (!window.MediaRecorder) { status("MediaRecorder unsupported"); return; }
    if (videoEl.readyState < 2) { status(T("story_need_video")); return; }
    recBtn.disabled = true;
    await preloadTiles();                   // ensure every tile is cached first
    const stream = canvas.captureStream(30);
    try {
      const vs = videoEl.captureStream ? videoEl.captureStream() : (videoEl.mozCaptureStream && videoEl.mozCaptureStream());
      const at = vs && vs.getAudioTracks ? vs.getAudioTracks() : [];
      if (at[0]) stream.addTrack(at[0]);
    } catch (e) {}
    const mime = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=h264,aac",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ].find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      dl.href = URL.createObjectURL(blob);
      dl.download = `flightlog24-${flight ? flight.route.departure.icao + "-" + flight.route.arrival.icao : "story"}.${ext}`;
      status(T("story_done")); dl.hidden = false; dl.click();
      recBtn.disabled = false;
    };
    recBtn.disabled = true; status(T("story_recording"));
    videoEl.currentTime = 0;
    videoEl.play().then(() => {
      recorder.start();
      cancelAnimationFrame(raf); loop();
      const stop = () => { if (recorder && recorder.state !== "inactive") recorder.stop(); videoEl.pause(); videoEl.removeEventListener("ended", stop); };
      videoEl.addEventListener("ended", stop);
    }).catch(() => { status("play blocked — tap preview first"); recBtn.disabled = false; });
  }

  // ── wiring ──────────────────────────────────────────────────────────
  videoInput.addEventListener("change", () => {
    const f = videoInput.files[0]; if (!f) return;
    videoEl.src = URL.createObjectURL(f);
    videoEl.onloadeddata = () => { status(""); drawFrame(0); };
  });
  flightSel.addEventListener("change", () => loadFlight(flightSel.value));
  [routeIn, sidIn, starIn].forEach(el => el && el.addEventListener("input", () => {
    route = routeIn.value.trim(); sid = sidIn.value.trim(); star = starIn.value.trim();
    if (!recorder || recorder.state === "inactive") drawFrame(currentProgress());
  }));
  followBtn.addEventListener("click", () => {
    follow = !follow; followBtn.classList.toggle("active", follow);
    followBtn.setAttribute("aria-pressed", follow);
    drawFrame(currentProgress()); preloadTiles();
  });
  mapBtn.addEventListener("click", () => {
    mapStyle = mapStyle === "dark" ? "sat" : "dark";
    mapBtn.classList.toggle("active", mapStyle === "sat");
    mapBtn.querySelector("span").textContent = mapStyle === "sat" ? T("story_dark") : T("story_satellite");
    preloadKey = ""; drawFrame(currentProgress()); preloadTiles();
  });
  playBtn.addEventListener("click", startPreview);
  recBtn.addEventListener("click", startRecord);
  const currentProgress = () => { const dur = (videoEl.duration && isFinite(videoEl.duration)) ? videoEl.duration : 60; return videoEl.readyState >= 2 ? videoEl.currentTime / dur : 0; };

  // populate flight list, preselect from ?id=
  (async function init() {
    drawFrame(0);
    let flights = [];
    try { flights = await fetch("data/flights.json", { cache: "no-cache" }).then(r => r.json()); } catch (e) {}
    flights.forEach(f => {
      const o = document.createElement("option");
      o.value = f.id; o.textContent = `${f.date || ""}  ${f.departure}→${f.arrival}  ${f.model || f.aircraft}`;
      flightSel.appendChild(o);
    });
    const pre = new URLSearchParams(location.search).get("id");
    const id = (pre && flights.some(f => f.id === pre)) ? pre : (flights[0] && flights[0].id);
    if (id) { flightSel.value = id; await loadFlight(id); }
  })();
})();

// Story maker: compose an uploaded horizontal flight recording with the flight's
// map route, altitude/speed profile and info into a 9:16 portrait clip, all
// time-compressed to the video's length, and export it via MediaRecorder.
(function () {
  const T = k => (window.I18N ? window.I18N.t(k) : k);
  const IC = n => (window.I18N ? window.I18N.ICONS[n] : "");
  const $ = id => document.getElementById(id);

  const canvas = $("story-canvas"), ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;                 // 720 x 1280
  const statusEl = $("story-status");
  const flightSel = $("story-flight"), videoInput = $("story-video");
  const mapBtn = $("story-map"), followBtn = $("story-follow");
  const playBtn = $("story-play"), recBtn = $("story-record"), dl = $("story-download");

  const videoEl = document.createElement("video");
  videoEl.muted = false; videoEl.playsInline = true; videoEl.preload = "auto";

  // layout bands (y)
  const TITLE = [0, 96], VID = [96, 540], READ = [540, 596],
        MAP = [596, 1040], PROF = [1040, 1212], FOOT = [1212, 1280];

  let flight = null, S = [], coords = [], duration = 0;
  let mosaic = null, mapStyle = "dark", follow = true;
  let raf = null, recorder = null, building = false;

  const status = (msg) => { statusEl.textContent = msg || ""; statusEl.style.display = msg ? "block" : "none"; };

  // ── web-mercator helpers ────────────────────────────────────────────
  const worldX = (lon, z) => (lon + 180) / 360 * Math.pow(2, z) * 256;
  const worldY = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * 256; };
  const tileURL = (style, z, x, y) => style === "sat"
    ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
    : `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;

  async function buildMosaic() {
    if (!coords.length) { mosaic = null; return; }
    building = true; status(T("story_building"));
    const lats = coords.map(c => c[0]), lons = coords.map(c => c[1]);
    let minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const dLat = (maxLat - minLat) * 0.14 + 0.02, dLon = (maxLon - minLon) * 0.14 + 0.02;
    minLat -= dLat; maxLat += dLat; minLon -= dLon; maxLon += dLon;
    let z = 3;
    for (let zz = 13; zz >= 3; zz--) {
      const nx = Math.floor(worldX(maxLon, zz) / 256) - Math.floor(worldX(minLon, zz) / 256) + 1;
      const ny = Math.floor(worldY(minLat, zz) / 256) - Math.floor(worldY(maxLat, zz) / 256) + 1;
      if (nx * ny <= 42 && nx * 256 <= 2400 && ny * 256 <= 2400) { z = zz; break; }
    }
    const tminX = Math.floor(worldX(minLon, z) / 256), tmaxX = Math.floor(worldX(maxLon, z) / 256);
    const tminY = Math.floor(worldY(maxLat, z) / 256), tmaxY = Math.floor(worldY(minLat, z) / 256);
    const mw = (tmaxX - tminX + 1) * 256, mh = (tmaxY - tminY + 1) * 256;
    const cv = document.createElement("canvas"); cv.width = mw; cv.height = mh;
    const cx = cv.getContext("2d"); cx.fillStyle = "#0a1424"; cx.fillRect(0, 0, mw, mh);
    const style = mapStyle === "sat" ? "sat" : "dark";
    const jobs = [];
    for (let tx = tminX; tx <= tmaxX; tx++) for (let ty = tminY; ty <= tmaxY; ty++) {
      jobs.push(new Promise(res => {
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => { try { cx.drawImage(img, (tx - tminX) * 256, (ty - tminY) * 256); } catch (e) {} res(); };
        img.onerror = () => res();
        img.src = tileURL(style, z, tx, ty);
      }));
    }
    await Promise.all(jobs);
    mosaic = { canvas: cv, z, ox: tminX * 256, oy: tminY * 256, w: mw, h: mh };
    building = false; status("");
    drawFrame(0);
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
  function drawFrame(progress) {
    progress = Math.max(0, Math.min(1, progress || 0));
    const p = at(progress * duration);
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
      ctx.fillText(T("story_video"), W / 2, (VID[0] + VID[1]) / 2); ctx.textAlign = "left";
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

    // profile
    drawProfile(progress);

    // footer: progress + brand
    ctx.fillStyle = "#131c2e"; ctx.fillRect(0, FOOT[0], W, 4);
    ctx.fillStyle = "#36c5ff"; ctx.fillRect(0, FOOT[0], W * progress, 4);
    ctx.fillStyle = "#6d7d98"; ctx.font = "600 15px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("my.msfs-flightlog24", W / 2, (FOOT[0] + FOOT[1]) / 2 + 4); ctx.textAlign = "left";
  }

  function drawRegionBg([y0, y1], col) { ctx.fillStyle = col; ctx.fillRect(0, y0, W, y1 - y0); }

  function drawMap(p) {
    const mx = 0, my = MAP[0], mw = W, mh = MAP[1] - MAP[0];
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
    ctx.fillStyle = "#0a1424"; ctx.fillRect(mx, my, mw, mh);
    if (mosaic && p) {
      const fit = Math.min(mw / mosaic.w, mh / mosaic.h);
      const scale = follow ? fit * 2.4 : fit;
      const cx = follow ? (worldX(p.lon, mosaic.z) - mosaic.ox) : mosaic.w / 2;
      const cy = follow ? (worldY(p.lat, mosaic.z) - mosaic.oy) : mosaic.h / 2;
      const dx = mx + mw / 2 - cx * scale, dy = my + mh / 2 - cy * scale;
      ctx.drawImage(mosaic.canvas, dx, dy, mosaic.w * scale, mosaic.h * scale);
      const toS = (lat, lon) => [dx + (worldX(lon, mosaic.z) - mosaic.ox) * scale, dy + (worldY(lat, mosaic.z) - mosaic.oy) * scale];
      // full route (dim) + flown (bright)
      strokePath(coords, toS, "#2a4d6e", 3);
      strokePath(coords.slice(0, p.idx + 1).concat([[p.lat, p.lon]]), toS, "#36c5ff", 4);
      // plane
      const [sx, sy] = toS(p.lat, p.lon);
      drawPlane(sx, sy, p.hdg);
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
    ctx.fillStyle = "#8a99b3"; ctx.font = "600 13px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(T("profile_title"), px, PROF[0] + 24);
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
      await buildMosaic();
    } catch (e) { status("load error"); }
  }

  // ── preview + record ────────────────────────────────────────────────
  function loop() {
    const dur = (videoEl.duration && isFinite(videoEl.duration)) ? videoEl.duration : 60;
    const prog = videoEl.readyState >= 2 ? videoEl.currentTime / dur : 0;
    drawFrame(prog);
    if (!videoEl.paused && !videoEl.ended) raf = requestAnimationFrame(loop);
  }
  function startPreview() {
    if (videoEl.readyState < 2) { status(T("story_need_video")); drawFrame(0); return; }
    videoEl.currentTime = 0; videoEl.play(); cancelAnimationFrame(raf); loop();
  }

  function startRecord() {
    if (!window.MediaRecorder) { status("MediaRecorder unsupported"); return; }
    if (videoEl.readyState < 2) { status(T("story_need_video")); return; }
    const stream = canvas.captureStream(30);
    try {
      const vs = videoEl.captureStream ? videoEl.captureStream() : (videoEl.mozCaptureStream && videoEl.mozCaptureStream());
      const at = vs && vs.getAudioTracks ? vs.getAudioTracks() : [];
      if (at[0]) stream.addTrack(at[0]);
    } catch (e) {}
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      dl.href = URL.createObjectURL(blob);
      dl.download = `flightlog24-${flight ? flight.route.departure.icao + "-" + flight.route.arrival.icao : "story"}.webm`;
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
  followBtn.addEventListener("click", () => { follow = !follow; followBtn.classList.toggle("active", follow); followBtn.setAttribute("aria-pressed", follow); drawFrame(currentProgress()); });
  mapBtn.addEventListener("click", async () => {
    mapStyle = mapStyle === "dark" ? "sat" : "dark";
    mapBtn.classList.toggle("active", mapStyle === "sat");
    mapBtn.querySelector("span").textContent = mapStyle === "sat" ? T("story_dark") : T("story_satellite");
    await buildMosaic();
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

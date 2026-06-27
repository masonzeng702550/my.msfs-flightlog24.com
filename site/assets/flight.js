// Flight detail: track map + replay (FR24-style) + altitude/speed profile.
(async function () {
  const id = new URLSearchParams(location.search).get("id");
  const root = document.getElementById("detail");
  if (!id) { root.innerHTML = `<div class="empty">缺少飛行 ID</div>`; return; }

  let f;
  try {
    f = await fetch(`data/flights/${id}.json`).then(r => { if (!r.ok) throw 0; return r.json(); });
  } catch {
    root.innerHTML = `<div class="empty">找不到這趟飛行</div>`;
    return;
  }

  const dep = f.route.departure, arr = f.route.arrival;
  const ac = f.aircraft;
  const S = f.replay || [];                 // [t, lat, lon, alt, hdg, ias]
  const coords = S.map(s => [s[1], s[2]]);
  const duration = f.duration_sec || (S.length ? S[S.length - 1][0] : 0);
  const sourceURL = rawSourceURL(f.source_file);

  const partial = !f.complete ? `<span class="badge">partial</span>` : "";
  const acLine = [ac.title, ac.flight_no && ac.flight_no !== "TEMP" ? ac.flight_no : null,
                  ac.registration].filter(Boolean).join(" · ");

  root.innerHTML = `
    <div class="detail-head">
      <div>
        <div class="route-big">${dep.icao}<span class="arrow">→</span>${arr.icao} ${partial}</div>
        <div class="sub">${acLine}</div>
      </div>
      <div class="when">${f.date || ""} ${f.time_local || ""}<br>${f.title || ""}</div>
    </div>

    <div id="map"></div>

    <div class="replay">
      <button class="play" id="rp-play" aria-label="play">▶</button>
      <input class="seek" id="rp-seek" type="range" min="0" max="${duration}" step="0.1" value="0">
      <span class="time" id="rp-time">00:00 / ${mmss(duration)}</span>
      <select id="rp-speed">
        <option value="1">1×</option>
        <option value="4" selected>4×</option>
        <option value="16">16×</option>
        <option value="60">60×</option>
      </select>
    </div>
    <div class="replay-readout">
      <span>ALT <b id="rp-alt">—</b> ft</span>
      <span>IAS <b id="rp-ias">—</b> kt</span>
      <span class="hdg">HDG <b id="rp-hdg">—</b>°</span>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="v">${f.distance.track_nm}<small> NM</small></div><div class="k">track distance</div></div>
      <div class="kpi"><div class="v">${f.altitude.cruise_ft.toLocaleString()}<small> ft</small></div><div class="k">cruise altitude</div></div>
      <div class="kpi"><div class="v">${human(f.times.block_min)}</div><div class="k">block time</div></div>
      <div class="kpi"><div class="v">${f.times.air_min != null ? human(f.times.air_min) : "—"}</div><div class="k">air time</div></div>
    </div>

    <div class="chart-card">
      <h3>Altitude &amp; speed profile</h3>
      <div class="chart-wrap"><canvas id="profile" height="110"></canvas><div class="chart-cursor" id="rp-cursor"></div></div>
    </div>

    <div class="meta-card">
      <h3>Flight data</h3>
      <div class="meta-grid">
        ${row("Departure", dep.name ? `${dep.icao} · ${dep.name}` : dep.icao)}
        ${row("Arrival", arr.name ? `${arr.icao} · ${arr.name}` : arr.icao)}
        ${row("Aircraft", `${ac.title}${ac.model ? ` (${ac.model})` : ""}`)}
        ${row("Airline", ac.airline || "—")}
        ${row("Max altitude", `${f.altitude.max_ft.toLocaleString()} ft`)}
        ${row("Max ground speed", f.stats.max_ground_speed_kt != null ? `${f.stats.max_ground_speed_kt} kt` : "—")}
        ${row("Direct distance", f.distance.direct_nm != null ? `${f.distance.direct_nm} NM` : "—")}
        ${row("Landing", f.landing ? `${Math.abs(f.landing.fpm)} fpm · ${f.landing.rating}` : "—")}
        ${row("Frames recorded", f.frames.toLocaleString())}
        ${row("Recording", `<a href="${sourceURL}" download>${f.source_file.split("/").pop()} ⭳</a>`)}
      </div>
      ${f.notes ? `<div class="notes">📝 ${f.notes}</div>` : ""}
    </div>`;

  const map = buildMap();
  const chart = buildChart();
  const plane = buildPlane(map);
  setupReplay(map, chart, plane);

  // ── map ─────────────────────────────────────────────────────────────
  function buildMap() {
    const map = L.map("map", { attributionControl: false, zoomControl: true });
    window.__map = map;
    const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap · © CARTO",
    });
    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" });
    dark.addTo(map);                                  // default base layer
    L.control.attribution({ prefix: false }).addTo(map);
    L.control.layers({ "深色地圖": dark, "衛星影像": satellite }, null,
                     { position: "topright" }).addTo(map);

    if (coords.length) {
      const route = L.polyline(coords, { color: "#2a4d6e", weight: 3, opacity: .55 }).addTo(map);
      window.__flown = L.polyline([], { color: "#36c5ff", weight: 3.5, opacity: .95 }).addTo(map);
      const bounds = route.getBounds().pad(0.15);
      // initial view from geography alone (never leaves the map at world zoom,
      // even before the container has a measurable pixel size)
      map.setView(bounds.getCenter(), zoomForBounds(bounds));
      const fit = () => {
        map.invalidateSize();
        if (map.getSize().x > 0) { map.fitBounds(bounds); return true; }
        return false;
      };
      window.__fitMap = fit;                 // test hook
      if (!fit()) {
        // refine to an exact fit as soon as the container has real width
        const ro = new ResizeObserver(() => { if (fit()) ro.disconnect(); });
        ro.observe(document.getElementById("map"));
      }
    } else {
      map.setView([dep.lat || 0, dep.lon || 0], 6);
    }
    const pin = (a, color, label) => {
      if (a && a.lat != null)
        L.circleMarker([a.lat, a.lon], { radius: 6, color, fillColor: color, fillOpacity: 1 })
          .bindTooltip(`${label}: ${a.icao}`).addTo(map);
    };
    pin(dep, "#45e0a0", "DEP");
    pin(arr, "#ffaf43", "ARR");
    return map;
  }

  function buildPlane(map) {
    if (!coords.length) return null;
    const icon = L.divIcon({
      className: "plane-icon", iconSize: [30, 30], iconAnchor: [15, 15],
      html: `<svg width="30" height="30" viewBox="-12 -12 24 24"><path fill="#eaf6ff" stroke="#0b2030" stroke-width="1"
        d="M0,-11 L2,-3 L11,3 L11,5 L2,1 L2,7 L5,9 L5,10 L0,8.5 L-5,10 L-5,9 L-2,7 L-2,1 L-11,5 L-11,3 L-2,-3 Z"/></svg>`,
    });
    return L.marker(coords[0], { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
  }

  // ── chart ───────────────────────────────────────────────────────────
  function buildChart() {
    if (!S.length) return null;
    const labels = S.map(s => +(s[0] / 60).toFixed(2));   // minutes
    const alt = S.map(s => s[3]);
    const ias = S.map(s => s[5]);
    return new Chart(document.getElementById("profile"), {
      type: "line",
      data: { labels, datasets: [
        { label: "Altitude (ft)", data: alt, yAxisID: "y", borderColor: "#36c5ff",
          backgroundColor: "rgba(54,197,255,.12)", fill: true, pointRadius: 0, borderWidth: 2, tension: .2 },
        { label: "IAS (kt)", data: ias, yAxisID: "y1", borderColor: "#ffaf43",
          pointRadius: 0, borderWidth: 1.5, tension: .2 },
      ] },
      options: {
        responsive: true, animation: false, interaction: { mode: "index", intersect: false },
        scales: {
          x: { type: "linear", min: 0, max: +(duration / 60).toFixed(2),
               title: { display: true, text: "minutes", color: "#8a99b3" },
               ticks: { color: "#8a99b3", maxTicksLimit: 10 }, grid: { color: "#1f2c44" } },
          y: { position: "left", title: { display: true, text: "ft", color: "#36c5ff" },
               ticks: { color: "#8a99b3" }, grid: { color: "#1f2c44" } },
          y1: { position: "right", title: { display: true, text: "kt", color: "#ffaf43" },
                ticks: { color: "#8a99b3" }, grid: { drawOnChartArea: false } },
        },
        plugins: { legend: { labels: { color: "#e6edf7" } } },
      },
    });
  }

  // ── replay engine ───────────────────────────────────────────────────
  function setupReplay(map, chart, plane) {
    const btn = document.getElementById("rp-play");
    const seek = document.getElementById("rp-seek");
    const timeEl = document.getElementById("rp-time");
    const speedEl = document.getElementById("rp-speed");
    const cursor = document.getElementById("rp-cursor");
    const altEl = document.getElementById("rp-alt"), iasEl = document.getElementById("rp-ias"), hdgEl = document.getElementById("rp-hdg");
    if (!S.length) { btn.disabled = true; return; }

    let t = 0, playing = false, last = null, speed = 4;

    const interp = (time) => {
      // binary search for the segment [i, i+1] containing `time`
      let lo = 0, hi = S.length - 1;
      if (time <= S[0][0]) return { ...sample(0), idx: 0 };
      if (time >= S[hi][0]) return { ...sample(hi), idx: hi };
      while (lo + 1 < hi) { const m = (lo + hi) >> 1; (S[m][0] <= time ? lo = m : hi = m); }
      const a = S[lo], b = S[hi];
      const r = (time - a[0]) / (b[0] - a[0] || 1);
      return {
        lat: a[1] + (b[1] - a[1]) * r,
        lon: a[2] + (b[2] - a[2]) * r,
        alt: a[3] + (b[3] - a[3]) * r,
        hdg: lerpAngle(a[4], b[4], r),
        ias: a[5] + (b[5] - a[5]) * r,
        idx: lo,
      };
    };
    function sample(i) { return { lat: S[i][1], lon: S[i][2], alt: S[i][3], hdg: S[i][4], ias: S[i][5] }; }

    function render(time) {
      const p = interp(time);
      if (plane) {
        plane.setLatLng([p.lat, p.lon]);
        const svg = plane.getElement() && plane.getElement().querySelector("svg");
        if (svg) svg.style.transform = `rotate(${p.hdg}deg)`;
      }
      if (window.__flown) {
        const flown = coords.slice(0, p.idx + 1);
        flown.push([p.lat, p.lon]);
        window.__flown.setLatLngs(flown);
      }
      altEl.textContent = Math.round(p.alt).toLocaleString();
      iasEl.textContent = Math.round(p.ias);
      hdgEl.textContent = String(Math.round(p.hdg)).padStart(3, "0");
      seek.value = time;
      timeEl.textContent = `${mmss(time)} / ${mmss(duration)}`;
      moveCursor(time);
    }

    function moveCursor(time) {
      if (!chart || !chart.chartArea) return;
      const { top, bottom, left, right } = chart.chartArea;
      if (right - left < 1) return;                 // chart not laid out yet
      const x = chart.scales.x.getPixelForValue(time / 60);
      if (!isFinite(x)) return;
      cursor.style.left = `${x}px`;
      cursor.style.top = `${top}px`;
      cursor.style.height = `${bottom - top}px`;
      cursor.style.opacity = "1";
    }

    function tick(ts) {
      if (!playing) return;
      if (last != null) t = Math.min(duration, t + (ts - last) / 1000 * speed);
      last = ts;
      render(t);
      if (t >= duration) { pause(); return; }
      requestAnimationFrame(tick);
    }
    function play() {
      if (t >= duration) t = 0;
      playing = true; last = null; btn.textContent = "⏸";
      requestAnimationFrame(tick);
    }
    function pause() { playing = false; btn.textContent = "▶"; }

    btn.addEventListener("click", () => playing ? pause() : play());
    seek.addEventListener("input", () => { t = +seek.value; last = null; render(t); });
    speedEl.addEventListener("change", () => { speed = +speedEl.value; });
    speed = +speedEl.value;
    render(0);
  }

  // ── helpers ─────────────────────────────────────────────────────────
  function rawSourceURL(srcFile) {
    const h = location.hostname;
    if (h.endsWith("github.io")) {
      const owner = h.split(".")[0];
      const repo = location.pathname.split("/").filter(Boolean)[0];
      return `https://raw.githubusercontent.com/${owner}/${repo}/main/${srcFile}`;
    }
    return srcFile; // local fallback (works when served from repo root)
  }
  function zoomForBounds(b) {
    // approximate the zoom that frames `b`, assuming a ~1000×500 viewport,
    // so the map is sensibly framed without needing a measured container size
    const latSpan = Math.max(1e-3, b.getNorth() - b.getSouth());
    const lonSpan = Math.max(1e-3, b.getEast() - b.getWest());
    const z = Math.min(Math.log2(1406 / lonSpan), Math.log2(703 / latSpan));
    return Math.max(3, Math.min(12, Math.floor(z)));
  }
  function lerpAngle(a, b, r) {
    let d = ((b - a + 540) % 360) - 180;
    return (a + d * r + 360) % 360;
  }
  function row(k, v) { return `<div class="row"><span>${k}</span><span>${v}</span></div>`; }
  function human(min) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; }
})();

// Home page: interactive globe + stats header + flight list.
(async function () {
  const flights = await fetch("data/flights.json").then(r => r.json()).catch(() => []);
  const stats = await fetch("data/stats.json").then(r => r.json()).catch(() => null);

  renderStats(stats);
  renderGlobe(flights);
  setupList(flights);

  // ── stats header ──────────────────────────────────────────────────────
  function renderStats(s) {
    const el = document.getElementById("stats");
    if (!s) { el.style.display = "none"; return; }
    const cells = [
      { big: s.flights_total, unit: "flights",
        sub: `${s.flights_complete} complete · ${s.flights_partial} partial` },
      { big: fmt(s.distance_total_miles), unit: "miles",
        sub: `${fmt(s.distance_total_km)} km · ${fmt(s.distance_total_nm)} NM` },
      { big: s.block_time_human, unit: "",
        sub: `${s.around_earth}× around Earth` },
      { big: s.airports_visited.length, unit: "airports",
        sub: s.airports_visited.join(" · ") || "—" },
    ];
    el.innerHTML = cells.map(c => `
      <div class="cell">
        <div class="big">${c.big}<span class="unit">${c.unit}</span></div>
        <div class="sub">${c.sub}</div>
      </div>`).join("");
  }

  // ── globe ─────────────────────────────────────────────────────────────
  function renderGlobe(fl) {
    const elem = document.getElementById("globe");
    if (!window.Globe || !fl.length) return;

    const arcs = fl.map(f => ({
      id: f.id,
      startLat: f.dep_pos[1], startLng: f.dep_pos[0],
      endLat: f.arr_pos[1], endLng: f.arr_pos[0],
      complete: f.complete,
      label: `<div class="globe-tooltip"><b>${f.departure} → ${f.arrival}</b><br>${f.aircraft} · ${f.distance_nm} NM</div>`,
    }));

    const ptMap = new Map();
    fl.forEach(f => {
      if (f.departure !== "UNKN") ptMap.set(f.departure, { lat: f.dep_pos[1], lng: f.dep_pos[0], code: f.departure });
      if (f.arrival !== "UNKN") ptMap.set(f.arrival, { lat: f.arr_pos[1], lng: f.arr_pos[0], code: f.arrival });
    });
    const points = [...ptMap.values()];

    // arc/point thickness scales with camera altitude so lines get THINNER as
    // you zoom in (a fixed world-stroke looks too thick up close)
    const strokeForAlt = a => Math.max(0.04, Math.min(0.7, a * 0.25));
    const radiusForAlt = a => Math.max(0.06, Math.min(0.32, a * 0.12));
    const INIT_ALT = 1.9;

    const g = Globe({ rendererConfig: { antialias: true, alpha: true } })(elem)
      .globeImageUrl("assets/earth-night-8k.jpg")
      .bumpImageUrl("assets/earth-topology.png")
      .backgroundImageUrl("https://unpkg.com/three-globe/example/img/night-sky.png")
      .atmosphereColor("#3a6ea5")
      .arcsData(arcs)
      .arcStartLat("startLat").arcStartLng("startLng")
      .arcEndLat("endLat").arcEndLng("endLng")
      .arcColor(d => d.complete ? ["#36c5ff", "#45e0a0"] : ["#ffaf43", "#ff6b6b"])
      .arcStroke(strokeForAlt(INIT_ALT))
      .arcAltitudeAutoScale(0.4)
      .arcDashLength(d => d.complete ? 1 : 0.4)
      .arcDashGap(d => d.complete ? 0 : 0.2)
      .arcDashAnimateTime(d => d.complete ? 0 : 2500)
      .arcLabel("label")
      .onArcClick(d => { location.href = `flight.html?id=${d.id}`; })
      .pointsData(points)
      .pointLat("lat").pointLng("lng")
      .pointColor(() => "#ffffff")
      .pointAltitude(0.005)
      .pointRadius(radiusForAlt(INIT_ALT))
      .pointLabel(d => `<div class="globe-tooltip"><b>${d.code}</b></div>`);

    // crisp texture at grazing angles + max device resolution
    g.onGlobeReady(() => {
      const tex = g.globeMaterial() && g.globeMaterial().map;
      if (tex && g.renderer()) {
        tex.anisotropy = g.renderer().capabilities.getMaxAnisotropy();
        tex.needsUpdate = true;
      }
    });
    g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // re-thin arcs/points whenever the zoom changes
    g.onZoom(pov => {
      g.arcStroke(strokeForAlt(pov.altitude));
      g.pointRadius(radiusForAlt(pov.altitude));
    });

    // size + responsive
    const resize = () => { g.width(elem.clientWidth).height(elem.clientHeight); };
    resize();
    window.addEventListener("resize", resize);

    // frame the flights
    const lat = avg(fl.flatMap(f => [f.dep_pos[1], f.arr_pos[1]]));
    const lng = avg(fl.flatMap(f => [f.dep_pos[0], f.arr_pos[0]]));
    g.pointOfView({ lat, lng, altitude: INIT_ALT }, 0);

    g.controls().autoRotate = true;
    g.controls().autoRotateSpeed = 0.35;
    elem.addEventListener("pointerdown", () => { g.controls().autoRotate = false; });
  }

  // ── flight list ───────────────────────────────────────────────────────
  function setupList(fl) {
    const acSel = document.getElementById("filter-ac");
    const models = [...new Set(fl.map(f => f.model || f.aircraft).filter(Boolean))].sort();
    models.forEach(m => acSel.add(new Option(m, m)));

    const draw = () => {
      const q = document.getElementById("search").value.trim().toLowerCase();
      const ac = acSel.value;
      const sort = document.getElementById("sort").value;
      let rows = fl.filter(f => {
        const hay = `${f.aircraft} ${f.model} ${f.departure} ${f.arrival} ${f.airline || ""} ${f.flight_no || ""}`.toLowerCase();
        return (!q || hay.includes(q)) && (!ac || (f.model || f.aircraft) === ac);
      });
      rows.sort(sort === "dist"
        ? (a, b) => b.distance_nm - a.distance_nm
        : (a, b) => (b.date + (b.time_local || "")).localeCompare(a.date + (a.time_local || "")));
      renderList(rows);
    };
    ["search", "filter-ac", "sort"].forEach(id =>
      document.getElementById(id).addEventListener("input", draw));
    draw();
  }

  function renderList(rows) {
    const el = document.getElementById("list");
    if (!rows.length) { el.innerHTML = `<div class="empty">沒有符合的飛行紀錄</div>`; return; }
    el.innerHTML = rows.map(f => {
      const tags = (f.tags || []).map(t => `<span class="badge tag">${t}</span>`).join("");
      const partial = !f.complete ? `<span class="badge">partial</span>` : "";
      const acLine = [f.aircraft, f.flight_no && f.flight_no !== "TEMP" ? f.flight_no : null]
        .filter(Boolean).join(" · ");
      return `<a class="flight ${f.complete ? "" : "partial"}" href="flight.html?id=${f.id}">
        <div class="date">${f.date || "—"}<small>${f.time_local || ""}</small></div>
        <div>
          <div class="route">${f.departure}<span class="arrow">→</span>${f.arrival} ${partial}${tags}</div>
          <div class="ac">${acLine}</div>
        </div>
        <div class="num title">${f.title ? f.title : ""}</div>
        <div class="num alt">${f.cruise_ft.toLocaleString()}<small>cruise ft</small></div>
        <div class="num time">${human(f.block_min)}<small>block</small></div>
        <div class="num">${f.distance_nm}<small>NM</small></div>
      </a>`;
    }).join("");
  }

  // ── helpers ───────────────────────────────────────────────────────────
  function fmt(n) { return Math.round(n).toLocaleString(); }
  function avg(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
  function human(min) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`; }
})();

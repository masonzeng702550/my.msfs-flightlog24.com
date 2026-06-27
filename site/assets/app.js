// Home page: interactive globe + stats header + flight list.
(async function () {
  const flights = await fetch("data/flights.json", { cache: "no-cache" }).then(r => r.json()).catch(() => []);
  const stats = await fetch("data/stats.json", { cache: "no-cache" }).then(r => r.json()).catch(() => null);

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

    // flat airport dots (one per visited airport) — rendered in the 3D scene
    // as zero-height discs so the globe occludes the far-side ones
    const ptMap = new Map();
    fl.forEach(f => {
      if (f.departure !== "UNKN") ptMap.set(f.departure, { lat: f.dep_pos[1], lng: f.dep_pos[0], code: f.departure });
      if (f.arrival !== "UNKN") ptMap.set(f.arrival, { lat: f.arr_pos[1], lng: f.arr_pos[0], code: f.arrival });
    });
    const airports = [...ptMap.values()];

    // a few random routes get a little plane flying along them
    const flyable = arcs.filter(a => Math.abs(a.startLat - a.endLat) + Math.abs(a.startLng - a.endLng) > 0.6);
    const chosen = flyable.sort(() => Math.random() - 0.5).slice(0, 6);
    const planes = chosen.map((arc, i) => ({
      arc, t: i / Math.max(1, chosen.length),
      speed: 0.035 + Math.random() * 0.03, lat: arc.startLat, lng: arc.startLng, alt: 0,
    }));

    // arcs get THINNER as you zoom in (a fixed world-stroke looks too thick up close)
    const strokeForAlt = a => Math.max(0.02, Math.min(0.3, a * 0.1));
    const INIT_ALT = 1.9;

    const g = Globe({ rendererConfig: { antialias: true, alpha: true } })(elem)
      .globeImageUrl("assets/earth-day-8k.jpg")
      .bumpImageUrl("assets/earth-topology.png")
      .backgroundImageUrl("https://unpkg.com/three-globe/example/img/night-sky.png")
      .atmosphereColor("#5b8bd0").atmosphereAltitude(0.2)
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
      .pointsData(airports)
      .pointLat("lat").pointLng("lng")
      .pointColor(() => "#eef6ff")
      .pointAltitude(0)
      .pointRadius(0.32)
      .pointLabel(d => `<div class="globe-tooltip"><b>${d.code}</b></div>`)
      .htmlElementsData(planes)
      .htmlLat(d => d.lat).htmlLng(d => d.lng).htmlAltitude(d => d.alt || 0)
      .htmlElement(makePlane);

    // sharpen the texture at grazing angles for a crisp, high-res globe
    g.onGlobeReady(() => {
      const tex = g.globeMaterial() && g.globeMaterial().map;
      if (tex && g.renderer()) {
        tex.anisotropy = g.renderer().capabilities.getMaxAnisotropy();
        tex.needsUpdate = true;
      }
    });
    g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    g.onZoom(pov => g.arcStroke(strokeForAlt(pov.altitude)));

    const resize = () => { g.width(elem.clientWidth).height(elem.clientHeight); };
    resize();
    window.addEventListener("resize", resize);

    const lat = avg(fl.flatMap(f => [f.dep_pos[1], f.arr_pos[1]]));
    const lng = avg(fl.flatMap(f => [f.dep_pos[0], f.arr_pos[0]]));
    g.pointOfView({ lat, lng, altitude: INIT_ALT }, 0);

    g.controls().autoRotate = true;
    g.controls().autoRotateSpeed = 0.3;
    elem.addEventListener("pointerdown", () => { g.controls().autoRotate = false; });

    animatePlanes(g, planes);
  }

  // DOM node for a moving plane (an inner svg we rotate independently of globe.gl's positioning)
  function makePlane(d) {
    const wrap = document.createElement("div");
    wrap.className = "globe-plane";
    wrap.innerHTML = `<svg width="20" height="20" viewBox="-12 -12 24 24"><path fill="#eaf6ff" stroke="#0b2030" stroke-width="1"
      d="M0,-11 L2,-3 L11,3 L11,5 L2,1 L2,7 L5,9 L5,10 L0,8.5 L-5,10 L-5,9 L-2,7 L-2,1 L-11,5 L-11,3 L-2,-3 Z"/></svg>`;
    d.__el = wrap; d.__inner = wrap.firstElementChild;
    return wrap;
  }

  // advance planes along their great-circle arcs; hide ones on the far hemisphere
  function animatePlanes(g, planes) {
    if (!planes.length) return;
    let last = null;
    function tick(ts) {
      const dt = last == null ? 0 : Math.min(0.1, (ts - last) / 1000);
      last = ts;
      planes.forEach(p => {
        p.t = (p.t + p.speed * dt) % 1;
        const gi = gcInterp(p.arc.startLat, p.arc.startLng, p.arc.endLat, p.arc.endLng, p.t);
        p.lat = gi.lat; p.lng = gi.lng;
        const peak = Math.min(0.5, 0.35 * (gi.omega / Math.PI));
        p.alt = peak * Math.sin(Math.PI * p.t);
      });
      const cam = g.camera() && g.camera().position;
      if (cam) {
        const cl = Math.hypot(cam.x, cam.y, cam.z) || 1;
        planes.forEach(p => {
          if (!p.__el) return;
          const c = g.getCoords(p.lat, p.lng, 0);
          const facing = (c.x * cam.x + c.y * cam.y + c.z * cam.z) / ((Math.hypot(c.x, c.y, c.z) || 1) * cl);
          p.__el.style.opacity = facing > 0.06 ? "1" : "0";
          if (p.__inner && facing > 0.06) {
            try {
              const a = g.getScreenCoords(p.lat, p.lng, p.alt);
              const n = gcInterp(p.arc.startLat, p.arc.startLng, p.arc.endLat, p.arc.endLng, (p.t + 0.01) % 1);
              const b = g.getScreenCoords(n.lat, n.lng, p.alt);
              p.__inner.style.transform = `rotate(${Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90}deg)`;
            } catch (e) { /* projection not ready */ }
          }
        });
      }
      g.htmlElementsData(planes);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // great-circle interpolation: fraction t between two lat/lng points
  function gcInterp(lat1, lng1, lat2, lng2, t) {
    const R = Math.PI / 180, D = 180 / Math.PI;
    const p1 = lat1 * R, l1 = lng1 * R, p2 = lat2 * R, l2 = lng2 * R;
    const v1 = [Math.cos(p1) * Math.cos(l1), Math.cos(p1) * Math.sin(l1), Math.sin(p1)];
    const v2 = [Math.cos(p2) * Math.cos(l2), Math.cos(p2) * Math.sin(l2), Math.sin(p2)];
    let dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    const om = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (om < 1e-6) return { lat: lat1, lng: lng1, omega: om };
    const s = Math.sin(om), a = Math.sin((1 - t) * om) / s, b = Math.sin(t * om) / s;
    const x = a * v1[0] + b * v2[0], y = a * v1[1] + b * v2[1], z = a * v1[2] + b * v2[2];
    return { lat: Math.atan2(z, Math.hypot(x, y)) * D, lng: Math.atan2(y, x) * D, omega: om };
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

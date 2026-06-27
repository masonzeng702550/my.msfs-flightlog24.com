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
      category: planeCategory(f.model, f.aircraft),
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

    // a few routes get a little plane flying along them — prefer category
    // variety first (so airliner / prop / GA / heli icons all show), then fill
    const flyable = arcs.filter(a => Math.abs(a.startLat - a.endLat) + Math.abs(a.startLng - a.endLng) > 0.15);
    const byCat = {};
    flyable.forEach(a => (byCat[a.category] = byCat[a.category] || []).push(a));
    const pickRandom = list => list[Math.floor(Math.random() * list.length)];
    const chosen = Object.values(byCat).map(pickRandom);
    flyable.filter(a => !chosen.includes(a)).sort(() => Math.random() - 0.5)
      .forEach(a => { if (chosen.length < 6) chosen.push(a); });
    const planes = chosen.map((arc, i) => ({
      arc, category: arc.category, t: i / Math.max(1, chosen.length),
      speed: 0.035 + Math.random() * 0.03, lat: arc.startLat, lng: arc.startLng, alt: 0,
    }));

    // arcs AND airport dots shrink as you zoom in (fixed sizes look too big up close)
    const strokeForAlt = a => Math.max(0.02, Math.min(0.3, a * 0.1));
    const radiusForAlt = a => Math.max(0.05, Math.min(0.32, a * 0.12));
    const INIT_ALT = 1.9;
    const isMobile = Math.min(window.innerWidth, window.innerHeight) < 768;

    const g = Globe({ rendererConfig: { antialias: true, alpha: true } })(elem)
      .globeImageUrl("assets/earth-day-4k.jpg")   // safe default; upgraded below if the GPU allows
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
      .pointRadius(radiusForAlt(INIT_ALT))
      .pointResolution(28)
      .pointLabel(d => `<div class="globe-tooltip"><b>${d.code}</b></div>`)
      .htmlElementsData(planes)
      .htmlLat(d => d.lat).htmlLng(d => d.lng).htmlAltitude(d => d.alt || 0)
      .htmlElement(makePlane);

    // pick a globe texture the GPU can actually upload — an 8K texture exceeds
    // the max texture size (often 4096) or memory budget of many phones, which
    // leaves the globe blank. Use 4K on mobile, 2K on very limited GPUs, 8K only
    // on capable desktops.
    const caps = g.renderer() && g.renderer().capabilities;
    const maxTex = (caps && caps.maxTextureSize) || 4096;
    if (maxTex < 4096) g.globeImageUrl("assets/earth-day-2k.jpg");
    else if (!isMobile && maxTex >= 8192) g.globeImageUrl("assets/earth-day-8k.jpg");

    // sharpen the texture at grazing angles
    g.onGlobeReady(() => {
      const tex = g.globeMaterial() && g.globeMaterial().map;
      if (tex && g.renderer()) {
        tex.anisotropy = g.renderer().capabilities.getMaxAnisotropy();
        tex.needsUpdate = true;
      }
    });
    g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 2 : 3));

    // zoom in past a threshold -> fade to a flat high-res satellite map of that region
    const FLAT_THRESHOLD = 0.5;
    const flat = setupFlatMap(g, arcs, airports, planes);
    g.onZoom(pov => {
      g.arcStroke(strokeForAlt(pov.altitude));
      g.pointRadius(radiusForAlt(pov.altitude));
      if (pov.altitude < FLAT_THRESHOLD) flat.enter(pov);
    });

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

  // classify an aircraft into an icon family (FR24-style), from model + title
  function planeCategory(model, title) {
    const s = `${model || ""} ${title || ""}`.toUpperCase();
    if (/HELI|HELICOPTER|\bH1\d\d|H160|H175|EC\d|AS3|R22|R44|R66|\bUH|AW1|BELL|S76|MD5/.test(s)) return "helicopter";
    if (/DA40|DA42|DV20|C152|C162|C172|C182|SR20|SR22|PA2|PA3|CUB|ICON|VL3|BONANZA|\bG36|\bG58|CIRRUS/.test(s)) return "ga";
    if (/TBM|PC12|C208|CARAVAN|DHC|ATR|\bAT[47]|BE20|KING|KODIAK|EMB1[12]0|SAAB|Q400|DASH|TURBOPROP|PROP/.test(s)) return "prop";
    if (/CITATION|\bC25|\bC56|\bC68|\bC70|LEAR|\bLJ\d|GLF|GLEX|GLOBAL|PHENOM|E5[05]|HAWKER|FALCON|\bCL[36]|CRJ/.test(s)) return "bizjet";
    return "airliner";
  }

  // top-down silhouettes (point up = north so heading rotation works), colour-coded
  // by category so the type reads at a glance; no glow
  const PLANE_ICONS = {
    // swept-wing jet, white
    airliner: `<path fill="#f2f7ff" stroke="#0b2030" stroke-width=".8" d="M0,-12 L2,-3 L12,3 L12,5.5 L2,1.5 L2,7 L5.5,10 L5.5,11 L0,9.5 L-5.5,11 L-5.5,10 L-2,7 L-2,1.5 L-12,5.5 L-12,3 L-2,-3 Z"/>`,
    // small swept jet, cyan
    bizjet: `<path fill="#4fc3f7" stroke="#0b2030" stroke-width=".8" d="M0,-11 L1.3,-3.5 L7.5,1.5 L7.5,3 L1.4,0.6 L1.7,6.5 L4.6,9 L4.6,10 L0,8.8 L-4.6,10 L-4.6,9 L-1.7,6.5 L-1.4,0.6 L-7.5,3 L-7.5,1.5 L-1.3,-3.5 Z"/>`,
    // straight wings + two engine nacelles, amber
    prop: `<g fill="#ffca45" stroke="#0b2030" stroke-width=".7"><path d="M-1.5,-10 L1.5,-10 L1.5,7 L4,9.5 L4,10.5 L0,9 L-4,10.5 L-4,9.5 L-1.5,7 Z"/><path d="M-12,-2 L12,-2 L12,1 L-12,1 Z"/><rect x="-7.6" y="-3.4" width="3" height="4.8" rx="1"/><rect x="4.6" y="-3.4" width="3" height="4.8" rx="1"/></g>`,
    // small high straight wing, green
    ga: `<g fill="#74e08a" stroke="#0b2030" stroke-width=".7"><path d="M-1,-7.5 L1,-7.5 L1,5 L2.8,6.8 L2.8,7.8 L0,6.6 L-2.8,7.8 L-2.8,6.8 L-1,5 Z"/><path d="M-9,-3.5 L9,-3.5 L9,-1.5 L-9,-1.5 Z"/></g>`,
    // rotor disc + tail boom, orange
    helicopter: `<g stroke="#0b2030" stroke-width=".7"><circle cx="0" cy="-1" r="11" fill="none" stroke="#ff8a5c" stroke-width="1.2" opacity=".55"/><path fill="#ff8a5c" d="M-2,-4 L2,-4 L2,3 L1.3,4 L1.3,9 L3,11 L3,12 L-3,12 L-3,11 L-1.3,9 L-1.3,4 L-2,3 Z"/><line x1="-4" y1="-1" x2="4" y2="-1" stroke="#ff8a5c" stroke-width="1.4"/></g>`,
  };

  // Flat high-res satellite map (Esri tiles) shown when the globe is zoomed in.
  // Draws the same great-circle routes, airports and flying planes; zooming back
  // out (or the back button) returns to the globe.
  function setupFlatMap(g, arcs, airports, planes) {
    const stage = document.getElementById("stage");
    const mapEl = document.getElementById("flatmap");
    const backBtn = document.getElementById("to-globe");
    const MIN_ZOOM_BACK = 4;
    let lmap = null, mapMode = false, cooldown = false, raf = null, last = null;
    const flatPlanes = planes.map(p => ({ arc: p.arc, category: p.category, t: p.t, speed: p.speed, marker: null }));

    // great-circle path as [lat,lng] points, with longitude unwrapped so routes
    // crossing the antimeridian stay continuous
    function gcLine(a) {
      const pts = []; let prev = null;
      for (let i = 0; i <= 48; i++) {
        const gi = gcInterp(a.startLat, a.startLng, a.endLat, a.endLng, i / 48);
        let lng = gi.lng;
        if (prev !== null) { while (lng - prev > 180) lng -= 360; while (lng - prev < -180) lng += 360; }
        prev = lng; pts.push([gi.lat, lng]);
      }
      return pts;
    }

    function build() {
      lmap = L.map(mapEl, { attributionControl: false, zoomControl: true, minZoom: 3, maxZoom: 18, worldCopyJump: true });
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }).addTo(lmap);
      L.control.attribution({ prefix: false }).addTo(lmap);
      arcs.forEach(a => {
        L.polyline(gcLine(a), { color: a.complete ? "#36c5ff" : "#ffaf43", weight: 2, opacity: .85 })
          .on("click", () => { location.href = `flight.html?id=${a.id}`; })
          .addTo(lmap);
      });
      airports.forEach(ap => {
        L.circleMarker([ap.lat, ap.lng], { radius: 4, color: "#fff", weight: 1.2, fillColor: "#fff", fillOpacity: 1 })
          .bindTooltip(ap.code).addTo(lmap);
      });
      flatPlanes.forEach(p => {
        const icon = L.divIcon({ className: "globe-plane", iconSize: [26, 26], iconAnchor: [13, 13],
          html: `<svg width="26" height="26" viewBox="-13 -13 26 26">${PLANE_ICONS[p.category] || PLANE_ICONS.airliner}</svg>` });
        p.marker = L.marker([p.arc.startLat, p.arc.startLng], { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(lmap);
      });
      lmap.on("zoomend", () => { if (mapMode && lmap.getZoom() <= MIN_ZOOM_BACK) exit(); });
    }

    function animate(ts) {
      if (!mapMode) { raf = null; last = null; return; }
      const dt = last == null ? 0 : Math.min(0.1, (ts - last) / 1000);
      last = ts;
      flatPlanes.forEach(p => {
        p.t = (p.t + p.speed * dt) % 1;
        const gi = gcInterp(p.arc.startLat, p.arc.startLng, p.arc.endLat, p.arc.endLng, p.t);
        if (!p.marker) return;
        p.marker.setLatLng([gi.lat, gi.lng]);
        const svg = p.marker.getElement() && p.marker.getElement().querySelector("svg");
        if (svg) {
          const n = gcInterp(p.arc.startLat, p.arc.startLng, p.arc.endLat, p.arc.endLng, (p.t + 0.01) % 1);
          const a = lmap.latLngToLayerPoint([gi.lat, gi.lng]);
          const b = lmap.latLngToLayerPoint([n.lat, n.lng]);
          svg.style.transform = `rotate(${Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90}deg)`;
        }
      });
      raf = requestAnimationFrame(animate);
    }

    function enter(pov) {
      if (mapMode || cooldown) return;
      mapMode = true;
      if (!lmap) build();
      g.controls().autoRotate = false;
      stage.classList.add("map-mode");
      backBtn.hidden = false;
      setTimeout(() => { lmap.invalidateSize(); lmap.setView([pov.lat, pov.lng], 7); }, 80);
      if (!raf) { last = null; raf = requestAnimationFrame(animate); }
    }
    function exit() {
      if (!mapMode) return;
      mapMode = false;
      cooldown = true;
      setTimeout(() => { cooldown = false; }, 1200);
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      stage.classList.remove("map-mode");
      backBtn.hidden = true;
      const c = lmap ? lmap.getCenter() : null;
      g.pointOfView(c ? { lat: c.lat, lng: c.lng, altitude: 1.1 } : { altitude: 1.1 }, 0);
    }
    backBtn.addEventListener("click", exit);
    return { enter, exit };
  }

  // DOM node for a moving plane (inner svg rotated independently of globe.gl's positioning)
  function makePlane(d) {
    const wrap = document.createElement("div");
    wrap.className = "globe-plane";
    wrap.innerHTML = `<svg width="26" height="26" viewBox="-13 -13 26 26">${PLANE_ICONS[d.category] || PLANE_ICONS.airliner}</svg>`;
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

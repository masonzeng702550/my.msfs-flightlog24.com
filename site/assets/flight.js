// Flight detail: track map + replay (FR24-style) + altitude/speed profile.
(async function () {
  const T = k => (window.I18N ? window.I18N.t(k) : k);
  const IC = n => (window.I18N ? window.I18N.ICONS[n] : "");
  const id = new URLSearchParams(location.search).get("id");
  const root = document.getElementById("detail");
  const hideSplash = () => {
    const s = document.getElementById("splash");
    if (!s || s.classList.contains("hidden")) return;
    s.classList.add("hidden"); setTimeout(() => s.remove(), 700);
  };
  setTimeout(hideSplash, 8000);
  if (!id) { root.innerHTML = `<div class="empty">${T("missing_id")}</div>`; hideSplash(); return; }

  let f;
  try {
    f = await fetch(`data/flights/${id}.json`, { cache: "no-cache" }).then(r => { if (!r.ok) throw 0; return r.json(); });
  } catch {
    root.innerHTML = `<div class="empty">${T("not_found")}</div>`;
    hideSplash();
    return;
  }

  const dep = f.route.departure, arr = f.route.arrival;
  const ac = f.aircraft;
  const S = f.replay || [];                 // [t, lat, lon, alt, hdg, ias]
  const coords = S.map(s => [s[1], s[2]]);
  const duration = f.duration_sec || (S.length ? S[S.length - 1][0] : 0);
  const sourceURL = rawSourceURL(f.source_file);

  const partial = !f.complete ? `<span class="badge">${T("partial")}</span>` : "";
  const acLine = [ac.title, ac.flight_no && ac.flight_no !== "TEMP" ? ac.flight_no : null,
                  ac.registration].filter(Boolean).join(" · ");

  root.innerHTML = `
    <div class="detail-head">
      <div>
        <div class="route-big">${dep.icao}<span class="arrow">→</span>${arr.icao} ${partial}</div>
        <div class="sub">${acLine}</div>
      </div>
      <div class="when">${f.date || ""} ${f.time_local || ""}<br>${f.title || ""}
        <br><a class="make-story-btn" href="story.html?id=${id}">${IC("film")}<span>${T("make_story")}</span></a>
      </div>
    </div>

    <div class="map-wrap">
      <div id="map"></div>
      <div id="map3d" class="map3d" hidden></div>
      <button class="view3d-btn" id="rp-view3d" aria-pressed="false" title="${T("view3d")}">${IC("cube")}<span>3D</span></button>
      <div class="view3d-hint" id="rp-view3d-hint" hidden>
        <div>${T("view3d_hint")}</div>
        <div class="view3d-attrib" id="rp-view3d-attrib"></div>
      </div>
    </div>

    <div class="replay">
      <button class="play" id="rp-play" aria-label="play">${IC("play")}</button>
      <input class="seek" id="rp-seek" type="range" min="0" max="${duration}" step="0.1" value="0">
      <span class="time" id="rp-time">00:00 / ${mmss(duration)}</span>
      <select id="rp-speed">
        <option value="1">1×</option>
        <option value="4" selected>4×</option>
        <option value="16">16×</option>
        <option value="60">60×</option>
      </select>
      <button class="follow" id="rp-follow" aria-pressed="false" title="${T("follow")}">${IC("target")}</button>
    </div>
    <div class="replay-readout">
      <span>ALT <b id="rp-alt">—</b> ft</span>
      <span>IAS <b id="rp-ias">—</b> kt</span>
      <span class="hdg">HDG <b id="rp-hdg">—</b>°</span>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="v">${f.distance.track_nm}<small> NM</small></div><div class="k">${T("k_track")}</div></div>
      <div class="kpi"><div class="v">${f.altitude.cruise_ft.toLocaleString()}<small> ft</small></div><div class="k">${T("k_cruise")}</div></div>
      <div class="kpi"><div class="v">${human(f.times.block_min)}</div><div class="k">${T("k_block")}</div></div>
      <div class="kpi"><div class="v">${f.times.air_min != null ? human(f.times.air_min) : "—"}</div><div class="k">${T("k_air")}</div></div>
    </div>

    <div class="chart-card">
      <h3>${T("profile_title")}</h3>
      <div class="chart-wrap"><canvas id="profile" height="110"></canvas><div class="chart-cursor" id="rp-cursor"></div></div>
    </div>

    <div class="meta-card">
      <h3>${T("flight_data")}</h3>
      <div class="meta-grid">
        ${row(T("l_departure"), dep.name ? `${dep.icao} · ${dep.name}` : dep.icao)}
        ${row(T("l_arrival"), arr.name ? `${arr.icao} · ${arr.name}` : arr.icao)}
        ${row(T("l_aircraft"), `${ac.title}${ac.model ? ` (${ac.model})` : ""}`)}
        ${row(T("l_airline"), ac.airline || "—")}
        ${row(T("l_maxalt"), `${f.altitude.max_ft.toLocaleString()} ft`)}
        ${row(T("l_maxgs"), f.stats.max_ground_speed_kt != null ? `${f.stats.max_ground_speed_kt} kt` : "—")}
        ${row(T("l_direct"), f.distance.direct_nm != null ? `${f.distance.direct_nm} NM` : "—")}
        ${row(T("l_landing"), f.landing ? `${Math.abs(f.landing.fpm)} fpm · ${T("rate_" + f.landing.rating)}` : "—")}
        ${row(T("l_frames"), f.frames.toLocaleString())}
        ${row(T("l_recording"), `<a href="${sourceURL}" download>${f.source_file.split("/").pop()} ${IC("download")}</a>`)}
      </div>
      ${f.notes ? `<div class="notes">${IC("note")} ${f.notes}</div>` : ""}
    </div>`;

  const map = buildMap();
  const chart = buildChart();
  const plane = buildPlane(map);
  setupReplay(map, chart, plane);
  hideSplash();

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
    L.control.layers({ [T("map_dark")]: dark, [T("map_satellite")]: satellite }, null,
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

  // ── 3D chase view (three.js) ───────────────────────────────────────
  // classify into an icon/model family, same regexes as the home-page globe
  function planeCategory(model, title) {
    const s = `${model || ""} ${title || ""}`.toUpperCase();
    if (/HELI|HELICOPTER|\bH1\d\d|H160|H175|EC\d|AS3|R22|R44|R66|\bUH|AW1|BELL|S76|MD5/.test(s)) return "helicopter";
    if (/DA40|DA42|DV20|C152|C162|C172|C182|SR20|SR22|PA2|PA3|CUB|ICON|VL3|BONANZA|\bG36|\bG58|CIRRUS/.test(s)) return "ga";
    if (/TBM|PC12|C208|CARAVAN|DHC|ATR|\bAT[47]|BE20|KING|KODIAK|EMB1[12]0|SAAB|Q400|DASH|TURBOPROP|PROP/.test(s)) return "prop";
    if (/CITATION|\bC25|\bC56|\bC68|\bC70|LEAR|\bLJ\d|GLF|GLEX|GLOBAL|PHENOM|E5[05]|HAWKER|FALCON|\bCL[36]|CRJ/.test(s)) return "bizjet";
    return "airliner";
  }

  // detect a specific real aircraft type we have a glTF model for (falls back
  // to the generic procedural shape for its category when no file matches)
  function detectRealModel(model, title) {
    const s = `${model || ""} ${title || ""}`.toUpperCase();
    if (/\bDA-?40\b/.test(s)) return "da40";
    if (/\b747\b/.test(s)) return "747";
    if (/\b787\b/.test(s)) return "787";
    if (/\b777\b/.test(s)) return "777";
    if (/A339|A330-?900/.test(s)) return "a330neo";
    if (/A33[023]|\bA330\b/.test(s)) return "a330";
    if (/A35\d|A350/.test(s)) return "a350";
    if (/B73[7-9]|B38M|B39M|7M8|\bMAX\b/.test(s)) return "b737";
    if (/A3[12]\d|A320|A319|A321|A20N|A21N|A19N/.test(s)) return "a320";
    if (/AT[47]6?|\bATR\b|Q400|DHC8|DASH/.test(s)) return "atr72";
    return null;
  }

  // real glTF models — CC-BY-4.0, credited on-canvas via the attribution corner
  // (see site/assets/models/*.license.txt for the full required credit text).
  // Each entry supports an optional `flight` variant (gear retracted) shown
  // above GEAR_UP_AGL, alongside the default `ground` variant (gear down).
  const GEAR_UP_AGL = 150;
  const REAL_MODELS = {
    787: { credit: "787 model © rocket0314 (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/787.glb", yaw: Math.PI, len: 46, sceneryRatio: .45 } },
    777: { credit: "777 model © hakai315 (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/777.glb", yaw: -Math.PI / 2, len: 52, sceneryRatio: 0 } },
    a350: { credit: "A350 model © hakai315 (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/a350.glb", yaw: -Math.PI / 2, len: 54, sceneryRatio: 0 } },
    a330neo: { credit: "A330-900neo model (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/a330neo.glb", yaw: 0, len: 63, sceneryRatio: 0 } },
    a330: { credit: "A330-300 model (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/a330.glb", yaw: 0, len: 63, sceneryRatio: 0 } },
    b737: { credit: "737 model © Dlourine (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/b737.glb", yaw: -Math.PI / 2, len: 29, sceneryRatio: 0 } },
    a320: { credit: "A320 model © Dlourine (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/a320.glb", yaw: -Math.PI / 2, len: 27, sceneryRatio: 0 } },
    atr72: { credit: "ATR72 model © Isidor G (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/atr72.glb", yaw: Math.PI / 2, len: 20, sceneryRatio: 0 } },
    da40: { credit: "DA40 model (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/da40.glb", yaw: 0, len: 8, sceneryRatio: 0 } },
    ga: { credit: "GA aircraft model (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/ga.glb", yaw: 0, len: 8, sceneryRatio: 0 } },
    747: { credit: "747-8i model (Sketchfab, CC-BY-4.0)",
      ground: { file: "assets/models/747-ground.glb", yaw: 0, len: 60, sceneryRatio: 0 },
      flight: { file: "assets/models/747-flight.glb", yaw: 0, len: 60, sceneryRatio: 0 } },
  };

  // ── ported from the "stoper" gate-taxi project: robust glTF post-processing
  // for arbitrary Sketchfab exports (strip embedded scenery, drop outlier
  // meshes, scale-to-length, ground-clamp, detect+rig rolling wheels) ──────
  function trimOutliers(holder, axis) {
    const meshes = [];
    holder.traverse(o => { if (o.isMesh && o.geometry) meshes.push(o); });
    if (meshes.length < 12) return;
    const arr = meshes.map(o => {
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      return { o, v: c[axis] };
    }).sort((a, b) => a.v - b.v);
    const range = arr[arr.length - 1].v - arr[0].v;
    if (range <= 0) return;
    let gi = -1, gmax = 0;
    for (let i = 1; i < arr.length; i++) { const g = arr[i].v - arr[i - 1].v; if (g > gmax) { gmax = g; gi = i; } }
    if (gmax < 0.18 * range) return;
    const victims = gi <= arr.length - gi ? arr.slice(0, gi) : arr.slice(gi);
    if (victims.length > 0.12 * arr.length) return;
    const hasBig = victims.some(x => {
      const sz = new THREE.Vector3(); new THREE.Box3().setFromObject(x.o).getSize(sz);
      return Math.max(sz.x, sz.y, sz.z) > 0.1 * range;
    });
    if (hasBig) return;
    victims.forEach(x => x.o.parent && x.o.parent.remove(x.o));
  }

  function wheelCandidates(holder, targetLen) {
    holder.updateMatrixWorld(true);
    const cand = [];
    holder.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const b = new THREE.Box3().setFromObject(o);
      const ws = new THREE.Vector3(); b.getSize(ws);
      const dims = [["x", ws.x], ["y", ws.y], ["z", ws.z]].sort((a, c) => a[1] - c[1]);
      const maxD = dims[2][1];
      if (!(maxD > 0 && dims[1][1] > .78 * maxD && dims[0][1] < .55 * maxD && dims[0][0] !== "y")) return;
      if (maxD > .04 * targetLen || maxD < .004 * targetLen) return;
      const c = new THREE.Vector3(); b.getCenter(c);
      if (Math.abs(holder.worldToLocal(c.clone()).x) > .14 * targetLen) return;
      cand.push({ mesh: o, c, maxD });
    });
    if (!cand.length) return [];
    const minY = Math.min(...cand.map(r => r.c.y));
    const band = Math.min(2.5, Math.max(.8, .05 * targetLen));
    return cand.filter(r => r.c.y < minY + band);
  }

  // holder is still unparented at this point, so its own space === world space
  // (mirrors how the source project zeroes the outer group's rotation first)
  function setupWheels(holder, targetLen) {
    const wheels = [];
    try {
      const cand = wheelCandidates(holder, targetLen);
      if (cand.length && cand.length <= 2 && Math.min(...cand.map(r => r.c.y)) > 1.3) return wheels;
      const latWorld = new THREE.Vector3(1, 0, 0);
      for (const r of cand) {
        const pivot = new THREE.Group();
        pivot.position.copy(holder.worldToLocal(r.c.clone()));
        holder.add(pivot);
        pivot.updateMatrixWorld(true);
        pivot.attach(r.mesh);
        const pq = new THREE.Quaternion(); pivot.getWorldQuaternion(pq);
        const axle = latWorld.clone().applyQuaternion(pq.clone().invert()).normalize();
        wheels.push({ pivot, radius: r.maxD / 2 || .5, axle });
      }
    } catch (e) { console.warn("wheel rig failed:", e); }
    return wheels;
  }

  function processRealModel(scene, spec) {
    const holder = new THREE.Group();
    holder.add(scene);
    holder.rotation.y = spec.yaw;
    holder.updateMatrixWorld(true);

    if (spec.sceneryRatio > 0) {
      const full = new THREE.Vector3();
      new THREE.Box3().setFromObject(holder).getSize(full);
      const limit = spec.sceneryRatio * Math.max(full.x, full.z);
      const remove = [];
      holder.traverse(o => {
        if (o.isMesh) {
          const s = new THREE.Vector3();
          new THREE.Box3().setFromObject(o).getSize(s);
          if (Math.max(s.x, s.y, s.z) > limit) remove.push(o);
        }
      });
      remove.forEach(o => o.parent && o.parent.remove(o));
      holder.updateMatrixWorld(true);
    }

    trimOutliers(holder, "x"); trimOutliers(holder, "z");
    trimOutliers(holder, "x"); trimOutliers(holder, "z");
    holder.updateMatrixWorld(true);

    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(holder).getSize(size);
    holder.scale.setScalar(spec.len / (Math.max(size.x, size.z) || 1));
    holder.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(holder);
    const c = box2.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, -box2.min.y, -c.z);
    holder.updateMatrixWorld(true);

    try {                                            // robust ground-clamp
      const bottoms = [];
      holder.traverse(o => { if (o.isMesh && o.geometry) bottoms.push(new THREE.Box3().setFromObject(o).min.y); });
      if (bottoms.length) {
        bottoms.sort((a, b) => a - b);
        const span = (bottoms[bottoms.length - 1] - bottoms[0]) || 1;
        let ref = bottoms[0];
        for (let i = 1; i < Math.min(4, bottoms.length); i++) {
          if (bottoms[i] - bottoms[i - 1] > .12 * span) ref = bottoms[i]; else break;
        }
        if (Math.abs(ref) > 1e-4) { holder.position.y -= ref; holder.updateMatrixWorld(true); }
      }
    } catch (e) { console.warn("ground-clamp failed:", e); }

    try {                                             // refine to true wheel-bottom when plausible
      let wheelBottom = Infinity;
      holder.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        o.geometry.computeBoundingBox();
        const ld = new THREE.Vector3(); o.geometry.boundingBox.getSize(ld);
        const d = [ld.x, ld.y, ld.z].sort((a, b) => a - b);
        if (!(d[1] > .65 * d[2] && d[0] < .6 * d[2])) return;
        const b = new THREE.Box3().setFromObject(o);
        const s = new THREE.Vector3(); b.getSize(s);
        const ctr = new THREE.Vector3(); b.getCenter(ctr);
        if (ctr.y < .3 * spec.len && Math.max(s.x, s.y, s.z) < .16 * spec.len) {
          wheelBottom = Math.min(wheelBottom, b.min.y);
        }
      });
      if (isFinite(wheelBottom) && wheelBottom > 0 && wheelBottom < .04 * spec.len) {
        holder.position.y += -wheelBottom;
        holder.updateMatrixWorld(true);
      }
    } catch (e) { console.warn("ground-clamp refine failed:", e); }

    const wheels = setupWheels(holder, spec.len);
    return { holder, wheels };
  }

  let sharedDraco = null;
  function loadRealModel(fileSpec) {
    return new Promise(resolve => {
      if (!window.THREE || !THREE.GLTFLoader) { resolve(null); return; }
      const loader = new THREE.GLTFLoader();
      if (THREE.DRACOLoader) {
        if (!sharedDraco) {
          sharedDraco = new THREE.DRACOLoader();
          sharedDraco.setDecoderPath("assets/draco/");
        }
        loader.setDRACOLoader(sharedDraco);
      }
      loader.load(fileSpec.file, gltf => {
        try { resolve(processRealModel(gltf.scene, fileSpec)); }
        catch (e) { console.warn("model post-process failed:", e); resolve(null); }
      }, undefined, () => resolve(null));
    });
  }

  const PROCEDURAL_LEN = { airliner: 58, bizjet: 18, prop: 16, ga: 8, helicopter: 12 };
  function buildProceduralPlane(category) {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0xeef3fb, metalness: .2, roughness: .55 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x36c5ff, metalness: .2, roughness: .5 });
    if (category === "helicopter") {
      const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(.9, .6, 3.6, 10), body);
      fuselage.rotation.z = Math.PI / 2; g.add(fuselage);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(.9, 10, 8), body);
      nose.position.z = -1.8; g.add(nose);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(.15, .3, 3.4, 8), body);
      tail.rotation.x = Math.PI / 2; tail.position.set(0, .2, 2.6); g.add(tail);
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(7.5, .06, .3), accent);
      rotor.position.y = 1.1; g.add(rotor);
      const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(.06, 1.1, .18), accent);
      tailRotor.position.set(.2, .3, 4.2); g.add(tailRotor);
      return g;
    }
    const len = PROCEDURAL_LEN[category] || 20, wing = len * .92, fuseR = len * .045;
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(fuseR, fuseR * .5, len * .72, 10), body);
    fuselage.rotation.x = Math.PI / 2; g.add(fuselage);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(fuseR, len * .16, 10), body);
    nose.rotation.x = -Math.PI / 2; nose.position.z = -(len * .36 + len * .08); g.add(nose);
    const wings = new THREE.Mesh(new THREE.BoxGeometry(wing, len * .02, len * .16), body);
    wings.position.z = len * .02; g.add(wings);
    const tailWing = new THREE.Mesh(new THREE.BoxGeometry(wing * .38, len * .015, len * .09), body);
    tailWing.position.z = len * .42; g.add(tailWing);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(len * .02, len * .16, len * .12), accent);
    fin.position.set(0, len * .07, len * .42); g.add(fin);
    return g;
  }

  // resolves to { group, wheels, credit, dual, groundMesh, flightMesh } —
  // dual models (gear-down/gear-up pair, e.g. 747) get both meshes added with
  // only one visible at a time, toggled from update() by AGL
  async function buildAircraftMesh(aircraft) {
    const category = planeCategory(aircraft.model, aircraft.title);
    const key = detectRealModel(aircraft.model, aircraft.title) || (category === "ga" ? "ga" : null);
    const spec = key && REAL_MODELS[key];
    const result = { group: new THREE.Group(), wheels: [], credit: null, dual: false, groundMesh: null, flightMesh: null };
    if (spec) {
      const ground = await loadRealModel(spec.ground);
      if (ground) {
        result.group.add(ground.holder);
        result.wheels = ground.wheels;
        result.credit = spec.credit;
        result.groundMesh = ground.holder;
        if (spec.flight) {
          const flight = await loadRealModel(spec.flight);
          if (flight) {
            flight.holder.visible = false;
            result.group.add(flight.holder);
            result.flightMesh = flight.holder;
            result.dual = true;
          }
        }
        return result;
      }
    }
    result.group.add(buildProceduralPlane(category));
    return result;
  }

  const DEG2RAD = Math.PI / 180;
  const metersPerDegLat = 110540;
  const metersPerDegLon = lat => 111320 * Math.cos(lat * DEG2RAD);

  let scene3d = null;
  function ensureScene3D() {
    if (scene3d || !window.THREE) return scene3d;
    const container = document.getElementById("map3d");
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070d);
    scene.fog = new THREE.Fog(0x05070d, 300, 2600);
    const camera = new THREE.PerspectiveCamera(55, 1, 1, 20000);
    camera.position.set(0, 40, 90);

    scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x0a1220, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, .9);
    sun.position.set(600, 900, 300); scene.add(sun);

    // ground: a repeating grid texture that follows the aircraft, so it always
    // looks endless without ever fetching real map tiles (cheap at any replay speed)
    const gcv = document.createElement("canvas"); gcv.width = gcv.height = 256;
    const gctx = gcv.getContext("2d");
    gctx.fillStyle = "#0a1424"; gctx.fillRect(0, 0, 256, 256);
    gctx.strokeStyle = "rgba(54,197,255,.16)"; gctx.lineWidth = 2; gctx.strokeRect(1, 1, 254, 254);
    gctx.strokeStyle = "rgba(54,197,255,.07)"; gctx.lineWidth = 1;
    for (let i = 32; i < 256; i += 32) {
      gctx.beginPath(); gctx.moveTo(i, 0); gctx.lineTo(i, 256); gctx.moveTo(0, i); gctx.lineTo(256, i); gctx.stroke();
    }
    const groundTex = new THREE.CanvasTexture(gcv);
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(300, 300);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), new THREE.MeshBasicMaterial({ map: groundTex }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // trailing flight path (windowed, so it stays cheap regardless of flight length)
    const trailGeo = new THREE.BufferGeometry();
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0x36c5ff, transparent: true, opacity: .85 }));
    scene.add(trail);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .08;
    controls.minDistance = 12; controls.maxDistance = 600;
    controls.maxPolarAngle = Math.PI * .49;

    const attribEl = document.getElementById("rp-view3d-attrib");
    const planeGroup = new THREE.Group();
    scene.add(planeGroup);
    const meshInfo = { wheels: [], credit: null, dual: false, groundMesh: null, flightMesh: null };
    buildAircraftMesh(ac).then(res => {
      planeGroup.add(res.group);
      meshInfo.wheels = res.wheels; meshInfo.credit = res.credit; meshInfo.dual = res.dual;
      meshInfo.groundMesh = res.groundMesh; meshInfo.flightMesh = res.flightMesh;
      if (attribEl) attribEl.textContent = res.credit || "";
    });
    const groundElevM = S.length ? Math.min(...S.map(s => s[3])) * .3048 : 0;

    let origin = null, initialised = false, raf3d = null, lastSimTime = null;

    function project(lat, lon) {
      return [(lon - origin.lon) * metersPerDegLon(origin.lat), -(lat - origin.lat) * metersPerDegLat];
    }
    function recentre(lat, lon) {
      if (!origin) { origin = { lat, lon }; return; }
      const [dx, dz] = project(lat, lon);          // offset measured against the OLD origin
      origin = { lat, lon };
      camera.position.x -= dx; camera.position.z -= dz;   // keep the camera visually still
    }

    function resize() {
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(container);

    function updateTrail(time) {
      if (!S.length) return;
      const windowSec = 120, pts = [];
      for (let i = 0; i < S.length; i++) {
        if (S[i][0] < time - windowSec) continue;
        if (S[i][0] > time) break;
        const [x, z] = project(S[i][1], S[i][2]);
        pts.push(new THREE.Vector3(x, S[i][3] * .3048, z));
      }
      trailGeo.setFromPoints(pts);
    }

    function update(p, time) {
      if (!origin || Math.abs(p.lat - origin.lat) + Math.abs(p.lon - origin.lon) > .03) recentre(p.lat, p.lon);
      const [x, z] = project(p.lat, p.lon), y = p.alt * .3048;
      planeGroup.position.set(x, y, z);
      planeGroup.rotation.order = "YXZ";
      planeGroup.rotation.set((p.pitch || 0) * DEG2RAD, -p.hdg * DEG2RAD, -(p.bank || 0) * DEG2RAD);
      ground.position.set(x, 0, z);
      updateTrail(time);

      const agl = Math.max(0, y - groundElevM);
      if (meshInfo.dual) {
        const airborne = agl > GEAR_UP_AGL * .3048;
        if (meshInfo.groundMesh) meshInfo.groundMesh.visible = !airborne;
        if (meshInfo.flightMesh) meshInfo.flightMesh.visible = airborne;
      }
      const simDt = lastSimTime == null ? 0 : Math.max(0, time - lastSimTime);
      lastSimTime = time;
      if (meshInfo.wheels.length && agl < 60 * .3048 && simDt > 0) {
        const mps = (p.ias || 0) * .514444;
        for (const w of meshInfo.wheels) w.pivot.rotateOnAxis(w.axle, -(mps * simDt) / w.radius);
      }

      if (!initialised) {
        const back = 55, up = 22, hdgRad = p.hdg * DEG2RAD;
        camera.position.set(x - Math.sin(hdgRad) * back, y + up, z + Math.cos(hdgRad) * back);
        initialised = true;
      }
      controls.target.set(x, y, z);
    }

    function animate() {
      raf3d = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }

    scene3d = {
      update, resize,
      resetView() { initialised = false; lastSimTime = null; },
      start() { resize(); if (!raf3d) animate(); },
      stop() { cancelAnimationFrame(raf3d); raf3d = null; },
    };
    return scene3d;
  }

  // ── replay engine ───────────────────────────────────────────────────
  function setupReplay(map, chart, plane) {
    const btn = document.getElementById("rp-play");
    const seek = document.getElementById("rp-seek");
    const timeEl = document.getElementById("rp-time");
    const speedEl = document.getElementById("rp-speed");
    const cursor = document.getElementById("rp-cursor");
    const followBtn = document.getElementById("rp-follow");
    const altEl = document.getElementById("rp-alt"), iasEl = document.getElementById("rp-ias"), hdgEl = document.getElementById("rp-hdg");
    if (!S.length) { btn.disabled = true; return; }

    let t = 0, playing = false, last = null, speed = 4, follow = false;

    function setFollow(on) {
      follow = on;
      followBtn.classList.toggle("active", on);
      followBtn.setAttribute("aria-pressed", on ? "true" : "false");
      if (on) {                                   // snap to the plane at a chase zoom
        const p = interp(t);
        map.setView([p.lat, p.lon], Math.max(map.getZoom(), 11), { animate: true });
      }
    }
    followBtn.addEventListener("click", () => setFollow(!follow));
    map.on("dragstart", () => { if (follow) setFollow(false); });   // manual pan releases follow

    // ── 3D view toggle ────────────────────────────────────────────────
    const view3dBtn = document.getElementById("rp-view3d");
    const view3dHint = document.getElementById("rp-view3d-hint");
    const mapEl = document.getElementById("map"), map3dEl = document.getElementById("map3d");
    let view3D = false;
    view3dBtn.addEventListener("click", () => {
      view3D = !view3D;
      view3dBtn.classList.toggle("active", view3D);
      view3dBtn.setAttribute("aria-pressed", String(view3D));
      view3dHint.hidden = !view3D;
      mapEl.hidden = view3D;
      map3dEl.hidden = !view3D;
      if (view3D) {
        const sc = ensureScene3D();
        if (sc) { sc.resetView(); sc.start(); sc.update(interp(t), t); }
        else { view3D = false; view3dBtn.classList.remove("active"); mapEl.hidden = false; map3dEl.hidden = true; }
      } else if (scene3d) {
        scene3d.stop();
      }
    });

    const interp = (time) => {
      // binary search for the segment [i, i+1] containing `time`
      let lo = 0, hi = S.length - 1;
      if (time <= S[0][0]) return { ...sample(0), idx: 0, pitch: 0, bank: 0 };
      if (time >= S[hi][0]) return { ...sample(hi), idx: hi, pitch: 0, bank: 0 };
      while (lo + 1 < hi) { const m = (lo + hi) >> 1; (S[m][0] <= time ? lo = m : hi = m); }
      const a = S[lo], b = S[hi];
      const r = (time - a[0]) / (b[0] - a[0] || 1);
      // pitch/bank are rough visual estimates from the bracketing samples, used
      // only to tilt the 3D model — not a flight-dynamics-accurate computation
      const dt = Math.max(0.1, b[0] - a[0]);
      const climbMps = (b[3] - a[3]) * .3048 / dt;
      const horizMps = Math.max(1, a[5] * .514444);
      const pitch = Math.max(-25, Math.min(25, Math.atan2(climbMps, horizMps) * 180 / Math.PI));
      const dHdg = ((b[4] - a[4] + 540) % 360) - 180;
      const bank = Math.max(-28, Math.min(28, (dHdg / dt) * 1.6));
      return {
        lat: a[1] + (b[1] - a[1]) * r,
        lon: a[2] + (b[2] - a[2]) * r,
        alt: a[3] + (b[3] - a[3]) * r,
        hdg: lerpAngle(a[4], b[4], r),
        ias: a[5] + (b[5] - a[5]) * r,
        idx: lo, pitch, bank,
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
      if (follow) map.panTo([p.lat, p.lon], { animate: false });
      if (view3D && scene3d) scene3d.update(p, time);
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
      playing = true; last = null; btn.innerHTML = IC("pause");
      requestAnimationFrame(tick);
    }
    function pause() { playing = false; btn.innerHTML = IC("play"); }

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

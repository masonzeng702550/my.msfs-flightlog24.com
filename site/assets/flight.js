// Flight detail: track map (Leaflet) + altitude/speed profile (Chart.js) + data.
(async function () {
  const id = new URLSearchParams(location.search).get("id");
  const root = document.getElementById("detail");
  if (!id) { root.innerHTML = `<div class="empty">缺少飛行 ID</div>`; return; }

  let f, track;
  try {
    f = await fetch(`data/flights/${id}.json`).then(r => { if (!r.ok) throw 0; return r.json(); });
    track = await fetch(f.track_ref).then(r => r.json()).catch(() => null);
  } catch {
    root.innerHTML = `<div class="empty">找不到這趟飛行</div>`;
    return;
  }

  const dep = f.route.departure, arr = f.route.arrival;
  const ac = f.aircraft;
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

    <div class="kpis">
      <div class="kpi"><div class="v">${f.distance.track_nm}<small> NM</small></div><div class="k">track distance</div></div>
      <div class="kpi"><div class="v">${f.altitude.cruise_ft.toLocaleString()}<small> ft</small></div><div class="k">cruise altitude</div></div>
      <div class="kpi"><div class="v">${human(f.times.block_min)}</div><div class="k">block time</div></div>
      <div class="kpi"><div class="v">${f.times.air_min != null ? human(f.times.air_min) : "—"}</div><div class="k">air time</div></div>
    </div>

    <div class="chart-card"><h3>Altitude &amp; speed profile</h3><canvas id="profile" height="110"></canvas></div>

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
        ${row("Source", f.source_file)}
      </div>
      ${f.notes ? `<div class="notes">📝 ${f.notes}</div>` : ""}
    </div>`;

  drawMap(track, dep, arr);
  drawProfile(f.profile);

  // ── map ─────────────────────────────────────────────────────────────
  function drawMap(geo, dep, arr) {
    const map = L.map("map", { attributionControl: false, zoomControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19, subdomains: "abcd",
    }).addTo(map);
    L.control.attribution({ prefix: false })
      .addAttribution("© OpenStreetMap · © CARTO").addTo(map);

    const latlngs = geo ? geo.geometry.coordinates.map(c => [c[1], c[0]]) : [];
    if (latlngs.length) {
      const line = L.polyline(latlngs, { color: "#36c5ff", weight: 3, opacity: .9 }).addTo(map);
      map.fitBounds(line.getBounds().pad(0.15));
    } else {
      map.setView([dep.lat || 0, dep.lon || 0], 6);
    }
    const pin = (a, color, label) => {
      if (a && a.lat != null) {
        L.circleMarker([a.lat, a.lon], { radius: 6, color, fillColor: color, fillOpacity: 1 })
          .bindTooltip(`${label}: ${a.icao}`).addTo(map);
      }
    };
    pin(dep, "#45e0a0", "DEP");
    pin(arr, "#ffaf43", "ARR");
  }

  // ── profile chart ───────────────────────────────────────────────────
  function drawProfile(profile) {
    if (!profile || !profile.length) return;
    const labels = profile.map(p => p[0]);          // minutes
    const alt = profile.map(p => p[1]);             // ft
    const ias = profile.map(p => p[2]);             // kt
    new Chart(document.getElementById("profile"), {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Altitude (ft)", data: alt, yAxisID: "y", borderColor: "#36c5ff",
            backgroundColor: "rgba(54,197,255,.12)", fill: true, pointRadius: 0, borderWidth: 2, tension: .2 },
          { label: "IAS (kt)", data: ias, yAxisID: "y1", borderColor: "#ffaf43",
            pointRadius: 0, borderWidth: 1.5, tension: .2 },
        ],
      },
      options: {
        responsive: true, interaction: { mode: "index", intersect: false },
        scales: {
          x: { title: { display: true, text: "minutes", color: "#8a99b3" },
               ticks: { color: "#8a99b3", maxTicksLimit: 10, callback: v => Math.round(labels[v]) }, grid: { color: "#1f2c44" } },
          y: { position: "left", title: { display: true, text: "ft", color: "#36c5ff" },
               ticks: { color: "#8a99b3" }, grid: { color: "#1f2c44" } },
          y1: { position: "right", title: { display: true, text: "kt", color: "#ffaf43" },
                ticks: { color: "#8a99b3" }, grid: { drawOnChartArea: false } },
        },
        plugins: { legend: { labels: { color: "#e6edf7" } } },
      },
    });
  }

  function row(k, v) { return `<div class="row"><span>${k}</span><span>${v}</span></div>`; }
  function human(min) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; }
})();

// One aircraft type, or one airport: its own flights and its own totals.
// The list page can filter, but it cannot tell you how many hours you have on
// the 777 or when you first went to RJBB — which is what a logbook is for.
(function () {
  const T = k => (window.I18N ? window.I18N.t(k) : k);
  const q = new URLSearchParams(location.search);
  const kind = q.get("aircraft") ? "aircraft" : q.get("airport") ? "airport" : null;
  const value = q.get(kind || "");
  const root = document.getElementById("group");

  const esc = s => String(s ?? "").replace(/[<>&"]/g, c =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const human = min => {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  };

  if (!kind || !value) { root.innerHTML = `<div class="empty">${T("group_missing")}</div>`; return; }

  fetch("data/flights.json", { cache: "no-cache" }).then(r => r.json()).then(all => {
    // an aircraft matches on the model code or the full title, so both the
    // analysis panel (which lists models) and the detail page can link here
    const rows = all.filter(f => kind === "aircraft"
      ? (f.model === value || f.aircraft === value)
      : (f.departure === value || f.arrival === value));

    if (!rows.length) { root.innerHTML = `<div class="empty">${T("group_none")}</div>`; return; }

    const nm = rows.reduce((s, f) => s + (f.distance_nm || 0), 0);
    const block = rows.reduce((s, f) => s + (f.block_min || 0), 0);
    const dates = rows.map(f => f.date).filter(Boolean).sort();
    const partners = new Set();
    rows.forEach(f => {
      if (kind === "airport") {
        partners.add(f.departure === value ? f.arrival : f.departure);
      } else {
        partners.add(f.departure); partners.add(f.arrival);
      }
    });
    partners.delete("UNKN");

    const title = kind === "aircraft" ? value : value;
    const sub = kind === "aircraft" ? T("group_aircraft") : T("group_airport");
    const kpi = (v, k) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`;

    rows.sort((a, b) => (b.date || "").localeCompare(a.date || "")
      || (b.time_local || "").localeCompare(a.time_local || ""));

    root.innerHTML = `
      <div class="detail-head">
        <div>
          <div class="route-big">${esc(title)}</div>
          <div class="sub">${sub}</div>
        </div>
      </div>
      <div class="kpis">
        ${kpi(rows.length, T("group_flights"))}
        ${kpi(human(block), T("k_block"))}
        ${kpi(nm.toFixed(0) + "<small> NM</small>", T("k_track"))}
        ${kpi(partners.size, kind === "airport" ? T("group_destinations") : T("group_airports"))}
      </div>
      <div class="meta-card">
        <h3>${T("group_span")}</h3>
        <div class="meta-grid">
          <div class="row"><span>${T("group_first")}</span><span>${esc(dates[0] || "—")}</span></div>
          <div class="row"><span>${T("group_last")}</span><span>${esc(dates[dates.length - 1] || "—")}</span></div>
        </div>
      </div>
      <div class="list-head"><h2>${T("list_heading")}</h2></div>
      <div id="list">${rows.map(f => {
        const partial = !f.complete ? `<span class="badge">${T("partial")}</span>` : "";
        const ac = [f.aircraft, f.flight_no && f.flight_no !== "TEMP" ? f.flight_no : null]
          .filter(Boolean).join(" · ");
        return `<a class="flight ${f.complete ? "" : "partial"}" href="f/${f.id}.html">
          <div class="date">${esc(f.date || "—")}<small>${esc(f.time_local || "")}</small></div>
          <div>
            <div class="route">${esc(f.departure)}<span class="arrow">→</span>${esc(f.arrival)} ${partial}</div>
            <div class="ac">${esc(ac)}</div>
          </div>
          <div class="num title">${esc(f.title || "")}</div>
          <div class="num alt">${(f.cruise_ft || 0).toLocaleString()}<small>${T("cell_cruise")}</small></div>
          <div class="num time">${human(f.block_min || 0)}<small>${T("cell_block")}</small></div>
          <div class="num">${f.distance_nm}<small>NM</small></div>
        </a>`;
      }).join("")}</div>`;

    document.title = `${title} · my.msfs-flightlog24`;
  }).catch(() => { root.innerHTML = `<div class="empty">${T("not_found")}</div>`; });
})();

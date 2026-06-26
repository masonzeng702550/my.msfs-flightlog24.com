#!/usr/bin/env python3
"""Parse Flight Recorder .fltrec files into the JSON the site reads.

A .fltrec is a ZIP holding a single data.json:
  { ClientVersion, StartTime, EndTime, StartState{...}, Records[ {Time, Position{...}} ] }

For each recording we derive a flight log (aircraft, route, cruise altitude,
distance, duration, ground track) and write:
  site/data/flights.json                 index for the home page
  site/data/stats.json                   aggregate header stats
  site/data/flights/<id>.json            per-flight detail
  site/data/flights/<id>.track.geojson   decimated track for maps

Standard library only — no dependencies.
"""

import csv
import hashlib
import json
import math
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECORDINGS = ROOT / "recordings"
AIRPORTS_CSV = ROOT / "scripts" / "airports.csv"
OUT = ROOT / "site" / "data"
OUT_FLIGHTS = OUT / "flights"

# ── tuning ────────────────────────────────────────────────────────────────
AIRPORT_MATCH_NM = 5.0     # nearest-airport must be within this distance
TRACK_MAX_POINTS = 1000    # decimate the ground track to at most this many pts
PROFILE_MAX_POINTS = 1500  # decimate altitude/speed profile
CRUISE_TRIM = 0.10         # drop first/last 10% (climb/descent) for cruise alt


# ── geo helpers ─────────────────────────────────────────────────────────────
def haversine_nm(lat1, lon1, lat2, lon2):
    r = 3440.065  # nautical miles
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def load_airports():
    rows = []
    with open(AIRPORTS_CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append((r["icao"], float(r["lat"]), float(r["lon"]),
                         r["name"], r["country"]))
    return rows


def nearest_airport(airports, lat, lon, limit_nm=AIRPORT_MATCH_NM):
    """Brute-force nearest airport with a coarse lat/lon prefilter."""
    best = None
    best_d = limit_nm
    for icao, alat, alon, name, country in airports:
        if abs(alat - lat) > 0.5 or abs(alon - lon) > 0.5:
            continue
        d = haversine_nm(lat, lon, alat, alon)
        if d < best_d:
            best_d = d
            best = {"icao": icao, "name": name, "country": country,
                    "lat": alat, "lon": alon, "dist_nm": round(d, 2)}
    return best


# ── text / metadata helpers ───────────────────────────────────────────────
def fix_mojibake(s):
    """Flight Recorder stores some non-ASCII strings double-encoded
    (utf-8 bytes read as latin-1). Try to repair; fall back to original."""
    if not s:
        return s
    try:
        repaired = s.encode("latin-1").decode("utf-8")
        # only accept if it removed obvious mojibake markers
        if any(c in s for c in "ÃÂåçéè") and repaired != s:
            return repaired
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return s


MODEL_TOKEN = re.compile(r"AC_MODEL_([A-Z0-9]+)", re.I)


def resolve_model(start_state):
    """ICAO-ish model code. AircraftModel is usually clean (A20N, DA40) but
    can be an unresolved localization token; recover from the title then."""
    model = (start_state.get("AircraftModel") or "").strip()
    if model and not model.startswith("ATCCOM") and "." not in model:
        return model
    m = MODEL_TOKEN.search(model)
    if m:
        return m.group(1).upper()
    # last resort: leave blank, the title carries the readable name
    return ""


DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})")


def date_from_name(stem):
    m = DATE_RE.search(stem)
    if not m:
        return None, None
    y, mo, d, h, mi = m.groups()
    return f"{y}-{mo}-{d}", f"{h}:{mi}"


# ── sidecar overrides ──────────────────────────────────────────────────────
def load_sidecar(path):
    """Minimal YAML-ish reader (key: value, and `key: [a, b]`). Optional."""
    meta = {}
    if not path.exists():
        return meta
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if v.startswith("[") and v.endswith("]"):
            v = [x.strip().strip('"').strip("'") for x in v[1:-1].split(",") if x.strip()]
        meta[k] = v
    return meta


# ── core derivation ────────────────────────────────────────────────────────
def decimate(seq, max_points):
    if len(seq) <= max_points:
        return seq
    step = len(seq) / max_points
    out = [seq[int(i * step)] for i in range(max_points)]
    out.append(seq[-1])
    return out


def transitions(on_ground):
    """Indices of the first 1->0 (takeoff) and last 0->1 (landing)."""
    takeoff = landing = None
    for i in range(1, len(on_ground)):
        if on_ground[i - 1] and not on_ground[i] and takeoff is None:
            takeoff = i
        if not on_ground[i - 1] and on_ground[i]:
            landing = i
    return takeoff, landing


def cruise_altitude(alts):
    n = len(alts)
    lo, hi = int(n * CRUISE_TRIM), int(n * (1 - CRUISE_TRIM))
    mid = alts[lo:hi] or alts
    mid_sorted = sorted(mid)
    median = mid_sorted[len(mid_sorted) // 2]
    return int(round(median / 500.0) * 500)


def landing_rating(fpm):
    a = abs(fpm)
    if a < 60:
        return "greaser"
    if a < 240:
        return "normal"
    if a < 600:
        return "firm"
    return "hard"


def parse_recording(path, airports):
    with zipfile.ZipFile(path) as z:
        data = json.loads(z.read("data.json"))

    ss = data.get("StartState", {})
    records = data.get("Records", [])
    if not records:
        raise ValueError("no records")

    pos = [r["Position"] for r in records]
    times_ms = [r["Time"] for r in records]
    lats = [p["Latitude"] for p in pos]
    lons = [p["Longitude"] for p in pos]
    alts = [p["Altitude"] for p in pos]
    on_ground = [int(p.get("IsOnGround", 0)) for p in pos]

    stem = path.stem
    date, time_local = date_from_name(stem)

    # aircraft
    title = fix_mojibake((ss.get("AircraftTitle") or "").strip())
    aircraft = {
        "title": title or "Unknown aircraft",
        "model": resolve_model(ss),
        "airline": fix_mojibake((ss.get("AircraftAirline") or "").strip()) or None,
        "flight_no": (ss.get("AircraftNumber") or "").strip() or None,
        "registration": fix_mojibake((ss.get("AircraftId") or "").strip()) or None,
    }

    # takeoff / landing
    to_i, ld_i = transitions(on_ground)
    has_takeoff = to_i is not None
    has_landing = ld_i is not None

    block_min = round((times_ms[-1] - times_ms[0]) / 60000.0, 1)
    if has_takeoff and has_landing and ld_i > to_i:
        air_min = round((times_ms[ld_i] - times_ms[to_i]) / 60000.0, 1)
    else:
        air_min = None

    # departure / arrival airports
    dep_i = 0 if on_ground[0] else (0 if not has_takeoff else max(0, to_i - 1))
    arr_i = len(pos) - 1
    departure = nearest_airport(airports, lats[dep_i], lons[dep_i]) if on_ground[0] else None
    arrival = nearest_airport(airports, lats[arr_i], lons[arr_i]) if on_ground[-1] else None

    complete = bool(on_ground[0] and on_ground[-1] and departure and arrival)

    # distances
    track_nm = 0.0
    for i in range(1, len(pos)):
        track_nm += haversine_nm(lats[i - 1], lons[i - 1], lats[i], lons[i])
    direct_nm = None
    if departure and arrival:
        direct_nm = round(haversine_nm(departure["lat"], departure["lon"],
                                       arrival["lat"], arrival["lon"]), 1)

    # cruise + speeds
    cruise_ft = cruise_altitude(alts)
    max_ft = int(round(max(alts)))
    gs = [p.get("GpsGroundSpeed", 0) for p in pos]
    max_gs = round(max(gs), 1) if gs else None

    # landing softness
    touchdown = None
    if has_landing:
        fpm = pos[ld_i].get("TouchdownNormalVelocity", 0) or 0
        # scan a small window around landing for the recorded touchdown value
        for j in range(max(0, ld_i - 3), min(len(pos), ld_i + 3)):
            v = pos[j].get("TouchdownNormalVelocity", 0) or 0
            if abs(v) > abs(fpm):
                fpm = v
        touchdown = {"fpm": round(fpm, 0), "rating": landing_rating(fpm)}

    # ids
    digest = hashlib.sha1(path.read_bytes()).hexdigest()[:6]
    dep_code = departure["icao"] if departure else "UNKN"
    arr_code = arrival["icao"] if arrival else "UNKN"
    fid = f"{date or 'nodate'}-{dep_code}-{arr_code}-{digest}"

    # track geojson (lon, lat, alt)
    coords = decimate(list(zip(lons, lats, alts)), TRACK_MAX_POINTS)
    track = {
        "type": "Feature",
        "properties": {"id": fid},
        "geometry": {"type": "LineString",
                     "coordinates": [[round(x, 5), round(y, 5), round(z, 1)] for x, y, z in coords]},
    }

    # altitude/speed profile (minutes from start, alt ft, ias kt)
    t0 = times_ms[0]
    profile_full = [
        [round((t - t0) / 60000.0, 2), round(a, 0),
         round(p.get("IndicatedAirspeed", 0), 0)]
        for t, a, p in zip(times_ms, alts, pos)
    ]
    profile = decimate(profile_full, PROFILE_MAX_POINTS)

    # sidecar overrides
    sidecar = load_sidecar(path.with_suffix(".meta.yml"))

    detail = {
        "id": fid,
        "source_file": f"recordings/{path.name}",
        "date": date,
        "time_local": time_local,
        "aircraft": aircraft,
        "route": {
            "departure": departure or {"icao": "UNKN"},
            "arrival": arrival or {"icao": "UNKN"},
        },
        "complete": complete,
        "has_takeoff": has_takeoff,
        "has_landing": has_landing,
        "times": {"block_min": block_min, "air_min": air_min},
        "altitude": {"cruise_ft": cruise_ft, "max_ft": max_ft},
        "distance": {"track_nm": round(track_nm, 1), "direct_nm": direct_nm},
        "landing": touchdown,
        "stats": {"max_ground_speed_kt": max_gs},
        "title": sidecar.get("title"),
        "notes": sidecar.get("notes"),
        "tags": sidecar.get("tags") or [],
        "endpoints": {  # raw first/last coords, always available for the globe
            "start": [round(lons[0], 5), round(lats[0], 5)],
            "end": [round(lons[-1], 5), round(lats[-1], 5)],
        },
        "frames": len(pos),
        "profile": profile,
        "track_ref": f"data/flights/{fid}.track.geojson",
    }

    # apply sidecar route overrides
    for side, key in (("departure", "departure"), ("arrival", "arrival")):
        code = sidecar.get(key)
        if code:
            ap = next((a for a in airports if a[0] == code.upper()), None)
            if ap:
                detail["route"][side] = {"icao": ap[0], "name": ap[3],
                                         "country": ap[4], "lat": ap[1], "lon": ap[2]}
    return detail, track


def summarize(detail):
    dep = detail["route"]["departure"]
    arr = detail["route"]["arrival"]
    return {
        "id": detail["id"],
        "date": detail["date"],
        "time_local": detail["time_local"],
        "aircraft": detail["aircraft"]["title"],
        "model": detail["aircraft"]["model"],
        "airline": detail["aircraft"]["airline"],
        "flight_no": detail["aircraft"]["flight_no"],
        "departure": dep.get("icao", "UNKN"),
        "arrival": arr.get("icao", "UNKN"),
        "dep_pos": [dep.get("lon"), dep.get("lat")] if dep.get("lat") else detail["endpoints"]["start"],
        "arr_pos": [arr.get("lon"), arr.get("lat")] if arr.get("lat") else detail["endpoints"]["end"],
        "distance_nm": detail["distance"]["track_nm"],
        "cruise_ft": detail["altitude"]["cruise_ft"],
        "block_min": detail["times"]["block_min"],
        "air_min": detail["times"]["air_min"],
        "complete": detail["complete"],
        "title": detail["title"],
        "tags": detail["tags"],
        "track_ref": detail["track_ref"],
    }


def human_time(minutes):
    h, m = divmod(int(round(minutes)), 60)
    return f"{h}h {m:02d}m"


def build_stats(flights):
    total_nm = sum(f["distance_nm"] for f in flights)
    total_min = sum(f["block_min"] for f in flights)
    by_ac = {}
    airports = set()
    by_month = {}
    domestic = international = 0
    for f in flights:
        by_ac.setdefault(f["model"] or f["aircraft"], {"flights": 0, "nm": 0})
        by_ac[f["model"] or f["aircraft"]]["flights"] += 1
        by_ac[f["model"] or f["aircraft"]]["nm"] += f["distance_nm"]
        for code in (f["departure"], f["arrival"]):
            if code != "UNKN":
                airports.add(code)
        if f["date"]:
            by_month[f["date"][:7]] = by_month.get(f["date"][:7], 0) + 1
        # domestic vs international by ICAO country prefix (first 2 letters region)
        if f["departure"] != "UNKN" and f["arrival"] != "UNKN":
            if f["departure"][:2] == f["arrival"][:2]:
                domestic += 1
            else:
                international += 1
    return {
        "flights_total": len(flights),
        "flights_complete": sum(1 for f in flights if f["complete"]),
        "flights_partial": sum(1 for f in flights if not f["complete"]),
        "domestic": domestic,
        "international": international,
        "distance_total_nm": round(total_nm, 0),
        "distance_total_km": round(total_nm * 1.852, 0),
        "distance_total_miles": round(total_nm * 1.15078, 0),
        "around_earth": round(total_nm * 1.852 / 40075.0, 2),
        "block_time_total_min": round(total_min, 0),
        "block_time_human": human_time(total_min),
        "by_aircraft": [{"aircraft": k, **v} for k, v in
                        sorted(by_ac.items(), key=lambda kv: -kv[1]["flights"])],
        "airports_visited": sorted(airports),
        "by_month": [{"month": k, "flights": v} for k, v in sorted(by_month.items())],
    }


def main():
    airports = load_airports()
    OUT_FLIGHTS.mkdir(parents=True, exist_ok=True)
    files = sorted(RECORDINGS.glob("*.fltrec"))
    print(f"Found {len(files)} recording(s)")

    flights = []
    for path in files:
        try:
            detail, track = parse_recording(path, airports)
        except Exception as e:  # never let one bad file break the build
            print(f"  !! {path.name}: {type(e).__name__}: {e}")
            continue
        (OUT_FLIGHTS / f"{detail['id']}.json").write_text(
            json.dumps(detail, ensure_ascii=False, indent=1), encoding="utf-8")
        (OUT_FLIGHTS / f"{detail['id']}.track.geojson").write_text(
            json.dumps(track, ensure_ascii=False), encoding="utf-8")
        flights.append(summarize(detail))
        route = f"{detail['route']['departure'].get('icao')}→{detail['route']['arrival'].get('icao')}"
        flag = "" if detail["complete"] else "  [partial]"
        print(f"  ok {path.name}: {detail['aircraft']['model'] or detail['aircraft']['title']} "
              f"{route} {detail['distance']['track_nm']}nm{flag}")

    flights.sort(key=lambda f: (f["date"] or "", f["time_local"] or ""), reverse=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "flights.json").write_text(
        json.dumps(flights, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "stats.json").write_text(
        json.dumps(build_stats(flights), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(flights)} flight(s) -> site/data/")


if __name__ == "__main__":
    main()

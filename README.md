# my.msfs-flightlog24.com

A personal flight logbook for **Microsoft Flight Simulator**, in the style of
[my.flightradar24.com](https://my.flightradar24.com/): an interactive globe that
draws every flight from the recorded coordinates, plus a stats header and a
flight list.

Flights are recorded in-sim with the
[Flight Recorder](https://flightsim.to/addon/8163/flight-recorder) add-on. Drop a
`.fltrec` file into `recordings/`, push, and the site rebuilds and redeploys
itself automatically.

## How it works

```
recordings/*.fltrec  ──►  scripts/parse_recordings.py  ──►  site/data/*.json
        (you push)              (GitHub Actions)                 (the site reads)
                                       │
                                       ▼
                            GitHub Pages (globe.gl)
```

1. **`.fltrec`** is a ZIP containing `data.json` — aircraft metadata plus one
   record per frame (lat/lon/altitude, on-ground, speeds, …).
2. The parser derives each flight log: aircraft, departure/arrival airport
   (nearest-airport match), cruise altitude, distance, duration, and a decimated
   ground track.
3. The static site renders an interactive globe with one arc per flight, a stats
   header (flights / distance / time), and a sortable flight list.

## Add a flight

```bash
cp "2026-06-27-02-45.fltrec" recordings/
git add recordings/ && git commit -m "add flight" && git push
```

Optionally add a sidecar `recordings/<name>.meta.yml` to override the title,
departure/arrival, notes or tags for that flight.

## Local build

```bash
python3 scripts/parse_recordings.py   # writes site/data/
python3 -m http.server -d site 8000   # open http://localhost:8000
```

## Stack

- Parser: Python 3 standard library (no dependencies)
- Airports: [OurAirports](https://ourairports.com/data/) (public domain)
- Globe: [globe.gl](https://github.com/vasturiano/globe.gl) · Map: Leaflet · Charts: Chart.js
- Hosting: GitHub Pages + GitHub Actions

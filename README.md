# my.msfs-flightlog24.com

🌐 **Live site / 線上網站 → https://masonzeng702550.github.io/my.msfs-flightlog24.com/**

A personal flight logbook for **Microsoft Flight Simulator**, in the style of
[my.flightradar24.com](https://my.flightradar24.com/): an interactive 3D globe
that draws every flight from the recorded coordinates, a stats header, a
collapsible analytics panel, and a flight list. Installable as a PWA.

一個 **Microsoft Flight Simulator** 的個人飛行日誌,風格參考
[my.flightradar24.com](https://my.flightradar24.com/):用錄製的經緯度在
**可互動 3D 地球**上畫出每趟飛行,加上統計列、可收合的分析面板與飛行列表,
並可安裝成 PWA(加入主畫面像 App 一樣使用)。

---

## How it works / 運作方式

```
recordings/*.fltrec  ──►  scripts/parse_recordings.py  ──►  site/data/*.json
     (you push / 你推送)        (GitHub Actions)            (the site reads / 網站讀取)
                                       │
                                       ▼
                            GitHub Pages (globe.gl)
```

**English**

1. **`.fltrec`** is a ZIP containing `data.json` — aircraft metadata plus one
   record per frame (lat/lon/altitude, on-ground, speeds, …).
2. The parser derives each flight log: aircraft, departure/arrival airport
   (nearest-airport match), cruise altitude, distance, duration, ground track
   and a time-stamped replay series.
3. The static site renders an interactive globe (with category-coded planes
   flying the routes), a stats header, an analytics panel, and a flight list.
   Zooming the globe in switches to a high-resolution Esri satellite map.

**中文**

1. **`.fltrec`** 其實是個 ZIP,內含 `data.json`——機型中繼資料 + 每幀一筆紀錄
   (經緯度、高度、是否在地面、速度…)。
2. 解析器推導出每趟飛行 log:機型、起降機場(最近機場比對)、巡航高度、
   航程、時間、航跡,以及帶時間戳的回放序列。
3. 靜態網站呈現可互動地球(航線上有依機種分色的飛機)、統計列、分析面板與
   飛行列表;地球放大時會切換成高解析 Esri 衛星地圖。

---

## Add a flight / 新增一趟飛行

```bash
cp "2026-06-27-02-45.fltrec" recordings/
git add recordings/ && git commit -m "add flight" && git push
```

**English** — Push to `recordings/` and the site rebuilds and redeploys itself.
The flight date comes from the filename (`YYYY-MM-DD-HH-MM…`, Flight Recorder's
default). If a file has no date in its name, prefix the recording's file
timestamp, e.g. `2026-03-22-07-56_CAL320RCTP1RCSS.fltrec` (git doesn't preserve
file mtimes, so the date must live in the name). An optional sidecar
`recordings/<name>.meta.yml` can override title / departure / arrival / notes / tags.

**中文** — 把檔案放進 `recordings/` 並 push,網站就會自動重建、重新部署。
飛行日期取自檔名(`YYYY-MM-DD-HH-MM…`,Flight Recorder 的預設格式)。若檔名
沒有日期,請把存檔時間加在前面,例如 `2026-03-22-07-56_CAL320RCTP1RCSS.fltrec`
(git 不保存檔案 mtime,所以日期必須寫在檔名裡)。也可放一個同名的
`recordings/<name>.meta.yml` 來覆寫 標題 / 起點 / 終點 / 備註 / 標籤。

### File size limits / 檔案大小限制

| Method / 方式 | Per-file limit / 單檔上限 |
| --- | --- |
| `git push` | **100 MB** |
| GitHub web upload (Add file → Upload files) / 網頁上傳 | **25 MB** |

A `.fltrec` is mostly redundant per-frame samples, so oversized recordings can be
downsampled with no visible effect on the site.
`.fltrec` 主要是重複的逐幀資料,過大的檔可縮減取樣,網站呈現完全不變:

```bash
python3 scripts/shrink_recording.py big.fltrec recordings/big.fltrec 20   # target ~20 MB
```

---

## Local build / 本機建置

```bash
python3 scripts/parse_recordings.py   # writes site/data/ · 產生資料
python3 -m http.server -d site 8000   # open http://localhost:8000 · 開啟預覽
```

---

## Stack / 技術

- **Parser / 解析器**: Python 3 standard library, no dependencies / 純標準庫,零相依
- **Airports / 機場資料**: [OurAirports](https://ourairports.com/data/) (public domain / 公眾領域)
- **3D globe / 地球**: [globe.gl](https://github.com/vasturiano/globe.gl) · **Maps / 地圖**: Leaflet + Esri satellite · **Charts / 圖表**: Chart.js
- **3D chase view / 3D 追機視角**: [three.js](https://threejs.org/) — real glTF aircraft models where available, procedural low-poly shapes otherwise / 有對應機型時使用真實 glTF 模型,否則使用程序化低多邊形機身
- **3D terrain / 立體地形**: satellite imagery from Esri World Imagery draped over a height field decoded from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (terrarium PNG) — both key-free and CORS-enabled / 衛星影像取自 Esri World Imagery,地形高度取自 AWS Terrain Tiles(terrarium PNG),兩者皆免金鑰且支援 CORS
- **Hosting / 托管**: GitHub Pages + GitHub Actions · **PWA**: offline-capable service worker / 可離線的 service worker

---

## Credits / 致謝

3D aircraft models used by the flight-detail page's 3D chase view, all licensed
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) via Sketchfab (see
`site/assets/models/*.license.txt` for the full required credit text):

飛行詳情頁「3D 追機視角」使用的機型模型,均取自 Sketchfab,授權為
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/)(完整標準credit文字見
`site/assets/models/*.license.txt`):

- "Boeing 787-8" by [rocket0314](https://sketchfab.com/rocket0314)
- "Boeing 777-300ER Model" by [hakai315](https://sketchfab.com/hakai315)
- "[FREE] Airbus A350-1000" by [hakai315](https://sketchfab.com/hakai315)
- "Airbus A320-200" by [Dlourine](https://sketchfab.com/fDlruosne)
- "Boeing 737 MAX 8" by [Dlourine](https://sketchfab.com/fDlruosne)
- "ATR 72-600" by [Isidor G](https://sketchfab.com/AirplaneChef)
- ["DA40 AR"](https://sketchfab.com/3d-models/da40-ar-e5db96b4a7d34bc397a5009721a43757) by SS_3D
- ["Cessna 172"](https://sketchfab.com/3d-models/massey-da40-g1000-3961cdd472d24d22b4e379166ea5b307)
- ["A330-941neo"](https://sketchfab.com/3d-models/a330-941neo-87d5b4104c50481a86fdfbb08241c408)
- ["Airbus A330-300PW"](https://sketchfab.com/3d-models/airbus-a330-300pw-9cf6da60e67646c189b9aa25ba10699a)

Models are downscaled and Draco-compressed for the web with
[gltf-transform](https://gltf-transform.dev/); geometry structure is preserved
so the landing-gear wheel detection still works.
模型以 gltf-transform 縮小貼圖並做 Draco 壓縮以利網頁載入,幾何結構保持不變,
起落架輪子偵測仍可正常運作。

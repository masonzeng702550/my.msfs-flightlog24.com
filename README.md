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
- **Hosting / 托管**: GitHub Pages + GitHub Actions · **PWA**: offline-capable service worker / 可離線的 service worker

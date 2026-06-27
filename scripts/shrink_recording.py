#!/usr/bin/env python3
"""Downsample an oversized .fltrec so it fits Git / GitHub limits.

GitHub rejects files larger than 100 MB on push, and the web uploader caps at
25 MB. A .fltrec is mostly redundant per-frame samples, so we keep all metadata
and evenly thin the Records to hit a target size. The website's derived flight
log is unaffected (it already decimates to ~1500 points); only downloading the
file for in-sim replay is slightly less smooth.

Usage:
  python3 scripts/shrink_recording.py <in.fltrec> <out.fltrec> [target_mb=20]
"""
import json
import sys
import zipfile
from pathlib import Path

MIN_FRAMES = 3000   # never thin below this, keeps in-sim replay usable


def shrink(src, dst, target_mb=20.0):
    src, dst = Path(src), Path(dst)
    orig_mb = src.stat().st_size / 1e6
    with zipfile.ZipFile(src) as z:
        data = json.loads(z.read("data.json"))
    recs = data.get("Records", [])

    if orig_mb > target_mb and len(recs) > MIN_FRAMES:
        keep = max(MIN_FRAMES, int(len(recs) * (target_mb / orig_mb)))
        step = len(recs) / keep
        idx = sorted({int(i * step) for i in range(keep)} | {len(recs) - 1})
        data["Records"] = [recs[i] for i in idx]

    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("data.json", blob)

    print(f"{src.name}: {orig_mb:.1f} MB / {len(recs)} frames "
          f"-> {dst.stat().st_size / 1e6:.1f} MB / {len(data['Records'])} frames")


if __name__ == "__main__":
    args = sys.argv
    if len(args) < 3:
        sys.exit(__doc__)
    shrink(args[1], args[2], float(args[3]) if len(args) > 3 else 20.0)

"""Extract Sentinel-2 time-series features for polygons using Google Earth Engine.

Minimal MVP extractor:
- Uses COPERNICUS/S2_SR_HARMONIZED
- Cloud masks using SCL
- Computes NDVI, EVI, NDMI, NDRE (plus mean band values)
- Aggregates per period (months or step-days) by median composite
- Reduces each polygon to mean values

Output: CSV with one row per (feature id, period).
Then you can pivot to wide format for ML.

Examples:
  python ml/export_gee_timeseries.py --labels ml/labels.geojson --label-field crop_name --start 2024-01-01 --end 2024-12-31 --period months --out ml/train_features.csv

  python ml/export_gee_timeseries.py --labels ml/farms.geojson --id-field id --start 2024-01-01 --end 2024-12-31 --period months --out ml/farm_features.csv
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--labels", required=True, help="GeoJSON path")

    # Auth options
    # Prefer env vars to avoid putting secrets in shell history:
    #   setx GOOGLE_APPLICATION_CREDENTIALS C:\path\to\key.json
    #   setx EE_SERVICE_ACCOUNT crop-detection@...iam.gserviceaccount.com
    p.add_argument("--sa-email", default=None, help="Earth Engine service account email")
    p.add_argument("--sa-key-file", default=None, help="Path to service account JSON key file")
    p.add_argument(
        "--project",
        default=None,
        help=(
            "Google Cloud project id to bill Earth Engine requests. "
            "Can also be set via EE_PROJECT env var."
        ),
    )

    # Either label-field (for training) OR id-field (for prediction). Both are allowed.
    p.add_argument("--label-field", default=None, help="Property name containing crop label")
    p.add_argument("--id-field", default=None, help="Property name containing unique id (e.g., farm id)")

    p.add_argument("--start", required=True, help="YYYY-MM-DD")
    p.add_argument("--end", required=True, help="YYYY-MM-DD")

    p.add_argument("--period", choices=["months", "step-days"], default="months")
    p.add_argument("--step-days", type=int, default=16)

    p.add_argument("--cloud-pct", type=float, default=40.0)
    p.add_argument("--scale", type=int, default=10)

    p.add_argument("--out", required=True, help="Output CSV path")
    return p.parse_args()


def _date(s: str) -> datetime:
    return datetime.fromisoformat(s)


def main() -> None:
    args = parse_args()

    import ee

    def _geojson_to_fc(path: Path) -> ee.FeatureCollection:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("type") != "FeatureCollection":
            raise SystemExit("GeoJSON must be a FeatureCollection")

        features = []
        for feat in data.get("features", []):
            geom = feat.get("geometry")
            if not geom:
                continue

            gtype = geom.get("type")
            coords = geom.get("coordinates")
            if gtype == "Polygon":
                ee_geom = ee.Geometry.Polygon(coords)
            elif gtype == "MultiPolygon":
                ee_geom = ee.Geometry.MultiPolygon(coords)
            else:
                # Keep this strict because our pipeline assumes polygons
                continue

            props = feat.get("properties") or {}
            features.append(ee.Feature(ee_geom, props))

        if not features:
            raise SystemExit("No Polygon/MultiPolygon features found in GeoJSON")
        return ee.FeatureCollection(features)

    # Initialize Earth Engine
    # 1) Service account (recommended for automation)
    # 2) Default local auth (earthengine authenticate)
    import os

    sa_email = args.sa_email or os.environ.get("EE_SERVICE_ACCOUNT")
    sa_key_file = args.sa_key_file or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    ee_project = args.project or os.environ.get("EE_PROJECT")

    try:
        if sa_email and sa_key_file:
            creds = ee.ServiceAccountCredentials(sa_email, sa_key_file)
            ee.Initialize(creds, project=ee_project)
        else:
            ee.Initialize(project=ee_project)
    except Exception as e:
        msg = str(e)
        if "earthengine authenticate" in msg or "authorize access" in msg:
            raise SystemExit(
                "Earth Engine is not authenticated. Run:\n\n"
                "  earthengine authenticate\n\n"
                "Then re-run this script.\n\n"
                "If you prefer service account auth, set env vars:\n"
                "  EE_SERVICE_ACCOUNT=...\n  GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json\n"
                "Optionally set EE_PROJECT=your-gcp-project-id\n\n"
                f"Original error: {e}"
            )
        raise

    labels_path = Path(args.labels)
    if not labels_path.exists():
        raise SystemExit(f"Labels file not found: {labels_path}")

    # Load as FeatureCollection (no geemap dependency)
    fc = _geojson_to_fc(labels_path)

    start = args.start
    end = args.end

    def mask_s2_sr(img):
        # SCL classes: 3=cloud shadow, 8=cloud medium, 9=cloud high, 10=cirrus, 11=snow
        scl = img.select("SCL")
        mask = (
            scl.neq(3)
            .And(scl.neq(8))
            .And(scl.neq(9))
            .And(scl.neq(10))
            .And(scl.neq(11))
        )
        return img.updateMask(mask)

    def add_indices(img):
        b2 = img.select("B2")
        b3 = img.select("B3")
        b4 = img.select("B4")
        b5 = img.select("B5")
        b6 = img.select("B6")
        b7 = img.select("B7")
        b8 = img.select("B8")
        b11 = img.select("B11")

        ndvi = b8.subtract(b4).divide(b8.add(b4)).rename("NDVI")
        evi = (
            b8.subtract(b4)
            .multiply(2.5)
            .divide(b8.add(b4.multiply(6)).subtract(b2.multiply(7.5)).add(1))
            .rename("EVI")
        )
        ndmi = b8.subtract(b11).divide(b8.add(b11)).rename("NDMI")
        ndre = b8.subtract(b5).divide(b8.add(b5)).rename("NDRE")

        return img.addBands([ndvi, evi, ndmi, ndre])

    col = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate(start, end)
        .filter(ee.Filter.lte("CLOUDY_PIXEL_PERCENTAGE", args.cloud_pct))
        .map(mask_s2_sr)
        .map(add_indices)
        .select(["NDVI", "EVI", "NDMI", "NDRE", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B11"])
    )

    start_dt = _date(args.start)
    end_dt = _date(args.end)

    periods = []
    if args.period == "months":
        cur = datetime(start_dt.year, start_dt.month, 1)
        while cur < end_dt:
            if cur.month == 12:
                nxt = datetime(cur.year + 1, 1, 1)
            else:
                nxt = datetime(cur.year, cur.month + 1, 1)
            periods.append((cur, min(nxt, end_dt)))
            cur = nxt
    else:
        cur = start_dt
        from datetime import timedelta

        while cur < end_dt:
            nxt = min(cur + timedelta(days=args.step_days), end_dt)
            periods.append((cur, nxt))
            cur = nxt

    rows = []

    def period_to_str(a: datetime, b: datetime) -> str:
        return f"{a.date().isoformat()}_{b.date().isoformat()}"

    # Reduce each period to a median composite, then sample per feature polygon
    for a, b in periods:
        img = col.filterDate(a.date().isoformat(), b.date().isoformat()).median()

        # Reduce over each feature
        def per_feature(feat):
            geom = feat.geometry()
            stats = img.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geom,
                scale=args.scale,
                bestEffort=True,
                maxPixels=1e9,
            )

            out = ee.Feature(None, stats)

            if args.id_field:
                out = out.set("id", feat.get(args.id_field))
            if args.label_field:
                out = out.set("crop_name", feat.get(args.label_field))

            out = out.set("period", period_to_str(a, b))
            return out

        sampled = fc.map(per_feature)
        try:
            info = sampled.getInfo()
        except Exception as e:
            raise SystemExit(
                "Failed to fetch Earth Engine results via getInfo(). "
                "If this is a larger run, consider reducing the date range or number of features. "
                f"Original error: {e}"
            )

        feats = info.get("features", [])
        if not feats:
            continue

        props = [f.get("properties", {}) for f in feats]
        df = pd.DataFrame.from_records(props)
        if df.empty:
            continue
        rows.append(df)

    if not rows:
        raise SystemExit("No features extracted. Check dates, AOI coverage, and EE auth.")

    out_df = pd.concat(rows, ignore_index=True)

    # Keep consistent columns
    expected = [
        "NDVI",
        "EVI",
        "NDMI",
        "NDRE",
        "B2",
        "B3",
        "B4",
        "B5",
        "B6",
        "B7",
        "B8",
        "B11",
        "period",
    ]

    cols = []
    if args.id_field:
        cols.append("id")
    if args.label_field:
        cols.append("crop_name")
    cols += [c for c in expected if c in out_df.columns]

    out_df = out_df[cols]
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_csv(out_path, index=False)

    print(f"Wrote {len(out_df)} rows to {out_path}")


if __name__ == "__main__":
    main()

"""Export farms (with boundary if present, else buffered point) to GeoJSON.

This produces a GeoJSON suitable for Earth Engine feature extraction.

Usage:
  python ml/export_farms_from_db.py --output ml/farms.geojson --limit 5000 --buffer-m 200

If a farm has a boundary polygon, that is used.
Otherwise, we create a buffer polygon around (lon,lat).
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import shapely
from shapely.geometry import Point
from shapely.geometry import mapping
from shapely.ops import transform as shapely_transform
from pyproj import Transformer
from sqlalchemy import create_engine, text


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--buffer-m", type=float, default=200.0, help="Buffer radius in meters for point-only farms")
    p.add_argument("--db-url", default=None)
    return p.parse_args()


def main() -> None:
    args = parse_args()

    db_url = args.db_url or os.environ.get(
        "DATABASE_URL", "postgresql://postgres:1234@127.0.0.1:5434/crop_risk_db"
    )
    engine = create_engine(db_url)

    sql = """
        SELECT
            id,
            name,
            province,
            location,
            crop_type,
            latitude,
            longitude,
            ST_AsBinary(boundary) AS boundary_wkb
        FROM farms
    """
    if args.limit:
        sql += " LIMIT :limit"

    with engine.connect() as conn:
        if args.limit:
            rows = conn.execute(text(sql), {"limit": args.limit}).fetchall()
        else:
            rows = conn.execute(text(sql)).fetchall()

    records = [dict(r._mapping) for r in rows]
    if not records:
        raise SystemExit("No farms found")

    # Build geometries
    geoms = []
    to_3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True).transform
    to_4326 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True).transform

    def _geom_from_wkb(value):
        if value is None:
            return None

        # psycopg2 returns BYTEA as memoryview; sometimes it may be a hex string like "\\x0103...".
        if isinstance(value, (bytes, bytearray, memoryview)):
            data = bytes(value)
        elif isinstance(value, str):
            hex_str = value[2:] if value.startswith("\\x") else value
            data = bytes.fromhex(hex_str)
        else:
            # Best-effort fallback (e.g., WKBElement-like objects)
            data = bytes(getattr(value, "data", value))

        return shapely.from_wkb(data)

    for rec in records:
        if rec.get("boundary_wkb") is not None:
            geom = _geom_from_wkb(rec["boundary_wkb"])
        else:
            lon = rec.get("longitude")
            lat = rec.get("latitude")
            if lon is None or lat is None:
                geoms.append(None)
                continue
            point = Point(float(lon), float(lat))
            point_3857 = shapely_transform(to_3857, point)
            poly_3857 = point_3857.buffer(args.buffer_m)
            geom = shapely_transform(to_4326, poly_3857)

        geoms.append(geom)

    # Build a minimal GeoJSON FeatureCollection without requiring fiona/pyogrio.
    features = []
    for rec, geom in zip(records, geoms, strict=False):
        if geom is None:
            continue

        props = dict(rec)
        props.pop("boundary_wkb", None)

        features.append(
            {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": props,
            }
        )

    if not features:
        raise SystemExit("No farms with valid geometry found")

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}),
        encoding="utf-8",
    )
    print(f"Exported {len(features)} farms to {args.output}")


if __name__ == "__main__":
    main()

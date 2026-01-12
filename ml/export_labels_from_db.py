"""Export crop_labels from PostGIS to GeoJSON.

Earth Engine feature extraction works cleanly with local GeoJSON.

Usage:
  python ml/export_labels_from_db.py --output ml/labels.geojson --limit 2000

Reads DATABASE_URL from env by default.
"""

from __future__ import annotations

import argparse
import os

import geopandas as gpd
import shapely
from sqlalchemy import create_engine, text


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True)
    p.add_argument("--limit", type=int, default=None)
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
            crop_name,
            country,
            admin1,
            admin2,
            season,
            label_date,
            source,
            source_id,
            ST_AsBinary(boundary) AS boundary_wkb
        FROM crop_labels
    """
    if args.limit:
        sql += " LIMIT :limit"

    with engine.connect() as conn:
        if args.limit:
            rows = conn.execute(text(sql), {"limit": args.limit}).fetchall()
        else:
            rows = conn.execute(text(sql)).fetchall()

    if not rows:
        raise SystemExit("No rows in crop_labels")

    def _geom_from_wkb(value):
        if value is None:
            return None

        if isinstance(value, (bytes, bytearray, memoryview)):
            data = bytes(value)
        elif isinstance(value, str):
            hex_str = value[2:] if value.startswith("\\x") else value
            data = bytes.fromhex(hex_str)
        else:
            data = bytes(getattr(value, "data", value))

        return shapely.from_wkb(data)

    records = [dict(r._mapping) for r in rows]
    geoms = [_geom_from_wkb(r["boundary_wkb"]) for r in records]
    df = gpd.GeoDataFrame(records, geometry=geoms, crs="EPSG:4326")
    df = df.drop(columns=["boundary_wkb"])

    df.to_file(args.output, driver="GeoJSON")
    print(f"Exported {len(df)} labels to {args.output}")


if __name__ == "__main__":
    main()

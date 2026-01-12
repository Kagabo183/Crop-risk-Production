"""Import crop labels (polygons) into PostGIS.

Supports GeoJSON / GeoPackage / Shapefile / any format readable by GeoPandas.

Example:
  python scripts/import_crop_labels.py --input data/labels.geojson --crop-field crop --source RadiantMLHub --country Rwanda

Notes:
- Expects geometries to be polygons; multipolygons are exploded.
- Reprojects to EPSG:4326.
- Writes into the crop_labels table.
"""

from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path
from typing import Optional

import geopandas as gpd


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="Path to label file (GeoJSON/GPKG/SHP/etc)")
    p.add_argument("--crop-field", required=True, help="Column containing crop name/class")
    p.add_argument("--source", default=None, help="Label source name (e.g. RadiantMLHub, RAB)")
    p.add_argument("--source-id-field", default=None, help="Optional column to store as source_id")
    p.add_argument("--country", default=None)
    p.add_argument("--admin1-field", default=None)
    p.add_argument("--admin2-field", default=None)
    p.add_argument("--season-field", default=None)
    p.add_argument("--label-date", default=None, help="YYYY-MM-DD")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--db-url", default=None, help="Override DATABASE_URL")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise SystemExit(f"Input not found: {input_path}")

    # Prefer pyogrio engine if available to avoid Fiona version incompatibilities on Windows.
    try:
        import pyogrio  # noqa: F401
        gdf = gpd.read_file(str(input_path), engine="pyogrio")
    except Exception:
        gdf = gpd.read_file(str(input_path))
    if args.limit:
        gdf = gdf.head(args.limit)

    if args.crop_field not in gdf.columns:
        raise SystemExit(f"Missing crop field '{args.crop_field}'. Available: {list(gdf.columns)}")

    # Normalize geometry
    gdf = gdf[gdf.geometry.notnull()].copy()
    gdf = gdf.explode(index_parts=False, ignore_index=True)

    # Reproject to WGS84
    if gdf.crs is None:
        # Many public datasets include CRS; if not, require user to fix it upstream.
        raise SystemExit("Input file has no CRS. Please set it (e.g., in QGIS) then retry.")
    gdf = gdf.to_crs("EPSG:4326")

    # Keep only polygons
    gdf = gdf[gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    gdf = gdf.explode(index_parts=False, ignore_index=True)

    # Build output frame
    out = gdf[[args.crop_field, "geometry"]].rename(columns={args.crop_field: "crop_name"})
    out["country"] = args.country

    def copy_field(dst: str, src: Optional[str]) -> None:
        if src and src in gdf.columns:
            out[dst] = gdf[src]
        else:
            out[dst] = None

    copy_field("admin1", args.admin1_field)
    copy_field("admin2", args.admin2_field)
    copy_field("season", args.season_field)

    if args.source is not None:
        out["source"] = args.source
    else:
        out["source"] = None

    if args.source_id_field and args.source_id_field in gdf.columns:
        out["source_id"] = gdf[args.source_id_field].astype(str)
    else:
        out["source_id"] = None

    if args.label_date:
        out["label_date"] = date.fromisoformat(args.label_date)
    else:
        out["label_date"] = None

    out["notes"] = None

    # Ensure geometry column name matches expected and remains active
    out = gpd.GeoDataFrame(out, geometry="geometry", crs="EPSG:4326")
    out = out.rename(columns={"geometry": "boundary"}).set_geometry("boundary")

    # DB URL
    import os

    db_url = args.db_url or os.environ.get(
        "DATABASE_URL", "postgresql://postgres:1234@127.0.0.1:5434/crop_risk_db"
    )

    # Requires SQLAlchemy + GeoAlchemy2; GeoPandas will use SQLAlchemy engine
    from sqlalchemy import create_engine

    engine = create_engine(db_url)

    # Write
    out.to_postgis(
        name="crop_labels",
        con=engine,
        if_exists="append",
        index=False,
    )

    print(f"Imported {len(out)} crop label polygons into crop_labels")


if __name__ == "__main__":
    main()

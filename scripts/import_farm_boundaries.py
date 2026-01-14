"""Import farm boundary polygons and update farms.boundary in PostGIS.

This lets the map show *real* farm coverage automatically (no manual drawing),
*if you already have farm boundary polygons* (GeoJSON/GPKG/SHP/etc).

Sentinel-2 imagery itself does not contain parcel/farm boundaries; it contains
raster pixels + tile footprints. To get real boundaries you need a boundary
layer (from GPS survey, cadastral/parcel data, or another dataset).

Expected input:
- A polygon/multipolygon layer with a column that identifies the farm.

Examples:
  python scripts/import_farm_boundaries.py --input data/farms.geojson --id-field farm_id
  python scripts/import_farm_boundaries.py --input data/farms.shp --id-field id --limit 100

Notes:
- Reprojects to EPSG:4326.
- MultiPolygon is reduced to the largest polygon (by area).
- Optionally sets farms.latitude/longitude to boundary centroid if missing.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Polygon, MultiPolygon


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="Path to boundary file (GeoJSON/GPKG/SHP/etc)")
    p.add_argument(
        "--id-field",
        default="farm_id",
        help="Column containing the farm id (default: farm_id). If missing, try 'id'.",
    )
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--db-url", default=None, help="Override DATABASE_URL")
    p.add_argument(
        "--set-centroid",
        action="store_true",
        help="If a farm has no lat/lon, set it to boundary centroid.",
    )
    return p.parse_args()


def _largest_polygon(geom):
    if geom is None:
        return None
    if isinstance(geom, Polygon):
        return geom
    if isinstance(geom, MultiPolygon):
        parts = list(geom.geoms)
        if not parts:
            return None
        return max(parts, key=lambda g: g.area)
    return None


def main() -> None:
    args = parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise SystemExit(f"Input not found: {input_path}")

    # Prefer pyogrio engine if available (Windows friendliness)
    try:
        import pyogrio  # noqa: F401

        gdf = gpd.read_file(str(input_path), engine="pyogrio")
    except Exception:
        gdf = gpd.read_file(str(input_path))

    if args.limit:
        gdf = gdf.head(args.limit)

    id_field = args.id_field
    if id_field not in gdf.columns:
        if "id" in gdf.columns:
            id_field = "id"
        else:
            raise SystemExit(
                f"Missing id field '{args.id_field}'. Available columns: {list(gdf.columns)}"
            )

    gdf = gdf[gdf.geometry.notnull()].copy()

    if gdf.crs is None:
        raise SystemExit("Input file has no CRS. Please set it (e.g., in QGIS) then retry.")

    gdf = gdf.to_crs("EPSG:4326")
    gdf = gdf[gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()

    # Normalize geometry to Polygon
    gdf["__poly"] = gdf.geometry.apply(_largest_polygon)
    gdf = gdf[gdf["__poly"].notnull()].copy()

    # Build updates
    updates = []
    for _, row in gdf.iterrows():
        try:
            farm_id = int(row[id_field])
        except Exception:
            continue
        poly = row["__poly"]
        if poly is None:
            continue
        updates.append((farm_id, poly.wkt, float(poly.centroid.y), float(poly.centroid.x)))

    if not updates:
        raise SystemExit("No valid polygon rows found to import.")

    db_url = args.db_url or os.environ.get(
        "DATABASE_URL", "postgresql://postgres:1234@127.0.0.1:5434/crop_risk_db"
    )

    from sqlalchemy import create_engine, text

    engine = create_engine(db_url)

    updated = 0
    missing = 0

    with engine.begin() as conn:
        for farm_id, wkt, cent_lat, cent_lon in updates:
            if args.set_centroid:
                res = conn.execute(
                    text(
                        """
                        UPDATE farms
                        SET
                          boundary = ST_SetSRID(ST_GeomFromText(:wkt), 4326),
                          latitude = COALESCE(latitude, :cent_lat),
                          longitude = COALESCE(longitude, :cent_lon)
                        WHERE id = :farm_id
                        """
                    ),
                    {"farm_id": farm_id, "wkt": wkt, "cent_lat": cent_lat, "cent_lon": cent_lon},
                )
            else:
                res = conn.execute(
                    text(
                        """
                        UPDATE farms
                        SET boundary = ST_SetSRID(ST_GeomFromText(:wkt), 4326)
                        WHERE id = :farm_id
                        """
                    ),
                    {"farm_id": farm_id, "wkt": wkt},
                )

            if res.rowcount and res.rowcount > 0:
                updated += 1
            else:
                missing += 1

    print(f"Updated farms.boundary for {updated} farm(s).")
    if missing:
        print(f"Warning: {missing} row(s) did not match any farms.id")


if __name__ == "__main__":
    main()

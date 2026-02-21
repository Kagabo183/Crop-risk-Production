"""
Import cadastral parcels from a shapefile into the PostGIS database.

Usage:
    python -m app.scripts.import_parcels <path_to_shapefile> [--district DISTRICT]

Example:
    python -m app.scripts.import_parcels /data/shapefiles/musanze.shp --district Musanze
"""
import sys
import os
import argparse
import logging

import geopandas as gpd
from sqlalchemy import create_engine, text
from shapely.geometry import mapping

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)


def import_parcels(shapefile_path: str, db_url: str, district_filter: str = None):
    """
    Import parcels from a shapefile into the cadastral_parcels table.

    1. Reads the shapefile with geopandas
    2. Reprojects from the source CRS to WGS84 (EPSG:4326)
    3. Optionally filters by district
    4. Inserts into the cadastral_parcels table
    """
    logger.info(f"Reading shapefile: {shapefile_path}")
    gdf = gpd.read_file(shapefile_path, engine='pyogrio')
    logger.info(f"  Total features: {len(gdf)}")
    logger.info(f"  Source CRS: {gdf.crs}")
    logger.info(f"  Columns: {list(gdf.columns)}")

    # Reproject to WGS84 if needed
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        logger.info(f"  Reprojecting from {gdf.crs} to EPSG:4326 (WGS84)...")
        gdf = gdf.to_crs(epsg=4326)
    else:
        logger.info("  Already in EPSG:4326")

    # Filter by district if specified
    if district_filter:
        # Try different column name cases
        dist_col = None
        for col in ['district', 'District', 'DISTRICT']:
            if col in gdf.columns:
                dist_col = col
                break

        if dist_col:
            before = len(gdf)
            gdf = gdf[gdf[dist_col].str.lower() == district_filter.lower()]
            logger.info(f"  Filtered to district '{district_filter}': {len(gdf)} of {before} parcels")
        else:
            logger.warning(f"  No 'district' column found. Importing all {len(gdf)} parcels.")

    if len(gdf) == 0:
        logger.error("No parcels to import after filtering!")
        return

    # Normalize column names to lower case
    gdf.columns = [c.lower() for c in gdf.columns]

    # Compute centroids for fast lat/lon lookups
    centroids = gdf.geometry.centroid
    gdf['centroid_lon'] = centroids.x
    gdf['centroid_lat'] = centroids.y

    # Calculate area in sq meters (reproject to projected CRS for accurate area)
    gdf_projected = gdf.to_crs(epsg=32736)  # UTM zone 36S for Rwanda
    gdf['area_sqm'] = gdf_projected.geometry.area

    # Connect to database
    engine = create_engine(db_url)

    # Create the table if it doesn't exist
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cadastral_parcels (
                id SERIAL PRIMARY KEY,
                upi VARCHAR(50),
                parcel_number DOUBLE PRECISION,
                province VARCHAR(20),
                district VARCHAR(20),
                sector VARCHAR(20),
                cell VARCHAR(20),
                village VARCHAR(30),
                cell_code VARCHAR(10),
                boundary GEOMETRY(POLYGON, 4326),
                area_sqm DOUBLE PRECISION,
                centroid_lat DOUBLE PRECISION,
                centroid_lon DOUBLE PRECISION
            )
        """))
        # Create indexes
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_cadastral_parcels_upi ON cadastral_parcels (upi)
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_cadastral_parcels_district ON cadastral_parcels (district)
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_cadastral_parcels_boundary ON cadastral_parcels USING GIST (boundary)
        """))
        logger.info("  Table and indexes ready")

    # Insert parcels in batches
    batch_size = 500
    inserted = 0
    skipped = 0

    with engine.begin() as conn:
        for i in range(0, len(gdf), batch_size):
            batch = gdf.iloc[i:i + batch_size]
            for _, row in batch.iterrows():
                geom = row.geometry
                if geom is None or geom.is_empty:
                    skipped += 1
                    continue

                # Convert MultiPolygon to Polygon (take largest)
                if geom.geom_type == 'MultiPolygon':
                    geom = max(geom.geoms, key=lambda g: g.area)

                if geom.geom_type != 'Polygon':
                    skipped += 1
                    continue

                wkt = geom.wkt

                conn.execute(text("""
                    INSERT INTO cadastral_parcels
                        (upi, parcel_number, province, district, sector, cell, village, cell_code,
                         boundary, area_sqm, centroid_lat, centroid_lon)
                    VALUES
                        (:upi, :parcel_number, :province, :district, :sector, :cell, :village, :cell_code,
                         ST_GeomFromText(:wkt, 4326), :area_sqm, :centroid_lat, :centroid_lon)
                """), {
                    'upi': str(row.get('upi', '')) if row.get('upi') else None,
                    'parcel_number': row.get('parcel_num') or row.get('parcel_number'),
                    'province': row.get('province'),
                    'district': row.get('district'),
                    'sector': row.get('sector'),
                    'cell': row.get('cell'),
                    'village': row.get('village'),
                    'cell_code': row.get('cell_code'),
                    'wkt': wkt,
                    'area_sqm': row.get('area_sqm', 0),
                    'centroid_lat': row.get('centroid_lat', 0),
                    'centroid_lon': row.get('centroid_lon', 0),
                })
                inserted += 1

            logger.info(f"  Inserted {inserted} parcels so far...")

    logger.info(f"Done! Inserted {inserted} parcels, skipped {skipped} invalid geometries.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Import cadastral parcels from shapefile')
    parser.add_argument('shapefile', help='Path to the .shp file')
    parser.add_argument('--district', help='Filter to a specific district', default=None)
    parser.add_argument('--db-url', help='Database URL',
                        default=os.environ.get(
                            'DATABASE_URL',
                            'postgresql://postgres:1234@localhost:5434/crop_risk_db'
                        ))
    args = parser.parse_args()

    if not os.path.exists(args.shapefile):
        print(f"Error: File not found: {args.shapefile}")
        sys.exit(1)

    import_parcels(args.shapefile, args.db_url, args.district)

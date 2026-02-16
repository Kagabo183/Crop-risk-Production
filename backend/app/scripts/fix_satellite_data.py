"""
Fix satellite_images table by moving data from extra_metadata JSON to proper columns.

This script:
1. Extracts farm_id from extra_metadata and populates the farm_id column
2. Extracts vegetation indices (ndvi_value, etc.) and populates mean_ndvi, mean_ndwi, etc.
3. Sets the source field to 'seed' or 'Sentinel-2'
4. Updates cloud_cover_percent if missing
"""

import json
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.db.database import SessionLocal, engine
from app.models.data import SatelliteImage
from sqlalchemy import text


def fix_satellite_data():
    """Migrate satellite data from JSON metadata to proper columns."""
    db = SessionLocal()

    try:
        print("🔍 Checking satellite_images table...")

        # Get all records where farm_id is NULL but extra_metadata exists
        records = db.query(SatelliteImage).filter(
            SatelliteImage.farm_id == None,
            SatelliteImage.extra_metadata != None
        ).all()

        if not records:
            print("✓ No records to fix. Checking if farm_id is already populated...")
            total = db.query(SatelliteImage).count()
            with_farm_id = db.query(SatelliteImage).filter(SatelliteImage.farm_id != None).count()
            print(f"  Total records: {total}")
            print(f"  With farm_id: {with_farm_id}")

            if with_farm_id == 0 and total > 0:
                print("⚠️  All records have NULL farm_id but also NULL extra_metadata.")
                print("    Cannot extract farm_id. Data may be corrupted.")
            return

        print(f"📊 Found {len(records)} records to migrate")

        updated_count = 0
        error_count = 0

        for record in records:
            try:
                metadata = record.extra_metadata

                if not metadata:
                    continue

                # Extract farm_id
                if 'farm_id' in metadata:
                    record.farm_id = metadata['farm_id']
                    print(f"  ✓ Record {record.id}: farm_id={record.farm_id}")

                # Extract vegetation indices
                if 'ndvi_value' in metadata:
                    record.mean_ndvi = metadata['ndvi_value']
                if 'ndwi_value' in metadata:
                    record.mean_ndwi = metadata['ndwi_value']
                if 'evi_value' in metadata:
                    record.mean_evi = metadata['evi_value']
                if 'ndre_value' in metadata:
                    record.mean_ndre = metadata['ndre_value']
                if 'savi_value' in metadata:
                    record.mean_savi = metadata['savi_value']

                # Set source if missing
                if not record.source:
                    # If file_path contains "mock", it's seed data
                    if record.file_path and 'mock' in record.file_path:
                        record.source = 'seed'
                    else:
                        record.source = 'Sentinel-2'

                # Set cloud_cover if missing
                if record.cloud_cover_percent is None:
                    if 'cloud_cover' in metadata:
                        record.cloud_cover_percent = metadata['cloud_cover']
                    else:
                        record.cloud_cover_percent = 5.0  # Default for seed data

                updated_count += 1

            except Exception as e:
                print(f"  ✗ Error processing record {record.id}: {e}")
                error_count += 1

        # Commit changes
        db.commit()

        print(f"\n✅ Migration complete!")
        print(f"   Updated: {updated_count} records")
        if error_count > 0:
            print(f"   Errors: {error_count} records")

        # Verify
        print(f"\n🔍 Verification:")
        total = db.query(SatelliteImage).count()
        with_farm_id = db.query(SatelliteImage).filter(SatelliteImage.farm_id != None).count()
        with_ndvi = db.query(SatelliteImage).filter(SatelliteImage.mean_ndvi != None).count()

        print(f"   Total records: {total}")
        print(f"   With farm_id: {with_farm_id} ({with_farm_id/total*100:.1f}%)")
        print(f"   With NDVI: {with_ndvi} ({with_ndvi/total*100:.1f}%)")

    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 60)
    print("Satellite Images Data Migration Script")
    print("=" * 60)
    fix_satellite_data()

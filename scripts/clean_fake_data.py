import os
import sys
from sqlalchemy import create_engine, text

# DB Connection
# If running locally, default to localhost:5434
# If running in container, DATABASE_URL env var will be used (db:5432)
DEFAULT_URL = "postgresql://postgres:1234@localhost:5434/crop_risk_db"

def clean_data():
    db_url = os.getenv('DATABASE_URL', DEFAULT_URL)
    print(f"🔌 Connecting to database...")
    
    try:
        engine = create_engine(db_url)
        with engine.begin() as conn:  # begin() automatically commits on success
            print("🧹 Cleaning up fake/simulated data...")
            
            # 1. Delete simulated satellite images
            # Delete anything that is NOT 'sentinel2_real'
            # This covers 'simulated', NULL, or other legacy sources
            query_sat = text("DELETE FROM satellite_images WHERE extra_metadata->>'source' IS NULL OR extra_metadata->>'source' != 'sentinel2_real'")
            result_sat = conn.execute(query_sat)
            print(f"   - Deleted {result_sat.rowcount} fake satellite images/records")

            # 2. Delete all predictions
            # Predictions are generated from satellite data, so if we remove sat data, predictions are invalid.
            # Real pipeline will regenerate them.
            query_pred = text("DELETE FROM predictions")
            result_pred = conn.execute(query_pred)
            print(f"   - Deleted {result_pred.rowcount} old risk predictions (will be regenerated)")

            # 3. Delete all alerts
            # Same logic
            query_alerts = text("DELETE FROM alerts")
            result_alerts = conn.execute(query_alerts)
            print(f"   - Deleted {result_alerts.rowcount} old alerts")

            print("✅ Cleanup complete! Database is ready for real data.")
            
    except Exception as e:
        print(f"❌ Error during cleanup: {e}")
        sys.exit(1)

if __name__ == "__main__":
    clean_data()

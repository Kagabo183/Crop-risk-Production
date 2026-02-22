"""
Initialize the database by creating all tables from the current models.
Used for fresh deployments (e.g., Render free tier) where Alembic migrations
may be incomplete or PostGIS is unavailable.
"""
import sys
import os

# Add backend dir to sys.path so imports work when run standalone
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def init_db():
    """Create all tables from SQLAlchemy models."""
    from app.db.database import engine, Base

    # Import ALL models so Base.metadata registers them
    from app.models.user import User  # noqa
    from app.models.farm import Farm  # noqa
    from app.models.data import SatelliteImage, WeatherRecord, VegetationHealth, DiseaseClassification  # noqa
    from app.models.prediction import Prediction  # noqa
    from app.models.disease import Disease, DiseasePrediction, DiseaseObservation, DiseaseModelConfig, WeatherForecast  # noqa
    try:
        from app.models.crop_label import CropLabel  # noqa
    except Exception:
        pass
    try:
        from app.models.cadastral_parcel import CadastralParcel  # noqa
    except Exception:
        pass

    # Try enabling PostGIS (may fail on free-tier Postgres — that's OK)
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
            conn.commit()
        print("PostGIS extension enabled.")
    except Exception as e:
        print(f"PostGIS not available (OK for basic features): {e}")
        # Remove geometry columns from metadata so create_all doesn't fail
        from geoalchemy2 import Geometry
        for table in list(Base.metadata.tables.values()):
            geo_cols = [c for c in table.columns if isinstance(c.type, Geometry)]
            for col in geo_cols:
                table._columns.remove(col)
                print(f"  Skipped geometry column: {table.name}.{col.name}")

    print("Creating database tables...")
    Base.metadata.create_all(bind=engine, checkfirst=True)
    print("Database tables created successfully!")


if __name__ == "__main__":
    init_db()

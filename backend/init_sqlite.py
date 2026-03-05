"""
Initialize SQLite database - handles PostgreSQL-specific features gracefully.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text, func
from app.db.database import engine, Base

# Import ALL models
from app.models.user import User
from app.models.farm import Farm
from app.models.data import SatelliteImage, WeatherRecord, VegetationHealth, DiseaseClassification
from app.models.prediction import Prediction
from app.models.disease import Disease, DiseasePrediction, DiseaseObservation, DiseaseModelConfig, WeatherForecast

try:
    from app.models.crop_label import CropLabel
except Exception:
    pass
try:
    from app.models.cadastral_parcel import CadastralParcel
except Exception:
    pass
try:
    from app.models.alert import Alert
except Exception:
    pass

# Fix PostgreSQL-incompatible features for SQLite
from geoalchemy2 import Geometry

for table in list(Base.metadata.tables.values()):
    # Remove geometry columns
    geo_cols = [c for c in table.columns if isinstance(c.type, Geometry)]
    geo_col_names = {col.name for col in geo_cols}
    for col in geo_cols:
        table._columns.remove(col)
        print(f"  Skipped geometry column: {table.name}.{col.name}")
    
    # Remove indexes referencing geometry columns
    bad_indexes = [idx for idx in table.indexes 
                   if {c.name for c in idx.columns} & geo_col_names]
    for idx in bad_indexes:
        table.indexes.discard(idx)
        print(f"  Skipped spatial index: {idx.name}")
    
    # Fix server_default=text('now()') -> CURRENT_TIMESTAMP for SQLite
    for col in table.columns:
        if col.server_default is not None:
            default_text = str(col.server_default.arg) if hasattr(col.server_default, 'arg') else ''
            if 'now()' in default_text.lower():
                col.server_default = text('CURRENT_TIMESTAMP')
                print(f"  Fixed default: {table.name}.{col.name} -> CURRENT_TIMESTAMP")

print("Creating database tables...")
Base.metadata.create_all(bind=engine, checkfirst=True)
print("Database tables created successfully!")

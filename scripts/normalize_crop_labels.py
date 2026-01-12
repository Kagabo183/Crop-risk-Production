"""Normalize crop_labels.crop_name values in the DB.

- Trims whitespace
- Lower-cases

This helps avoid duplicate classes like 'Maize' vs 'maize'.
"""

import os
from sqlalchemy import create_engine, text

DB = os.environ.get("DATABASE_URL", "postgresql://postgres:1234@127.0.0.1:5434/crop_risk_db")
engine = create_engine(DB)

with engine.begin() as conn:
    conn.execute(text("UPDATE crop_labels SET crop_name = lower(trim(crop_name)) WHERE crop_name IS NOT NULL"))

print("Normalized crop_labels.crop_name")

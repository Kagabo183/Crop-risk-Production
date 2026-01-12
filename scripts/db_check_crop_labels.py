import os
from sqlalchemy import create_engine, text

DB = os.environ.get("DATABASE_URL", "postgresql://postgres:1234@127.0.0.1:5434/crop_risk_db")
engine = create_engine(DB)
print("DB:", DB)

with engine.connect() as conn:
    reg = conn.execute(text("SELECT to_regclass('public.crop_labels')")).scalar()
    print("crop_labels:", reg)
    if reg:
        count = conn.execute(text("SELECT count(*) FROM crop_labels")).scalar()
        print("rows:", count)

import os
from sqlalchemy import create_engine, text

DB = os.environ.get("DATABASE_URL", "postgresql://postgres:1234@127.0.0.1:5434/crop_risk_db")
engine = create_engine(DB)

with engine.connect() as conn:
    rows = conn.execute(
        text(
            """
            SELECT crop_name, count(*) AS n
            FROM crop_labels
            GROUP BY crop_name
            ORDER BY n DESC, crop_name ASC
            """
        )
    ).fetchall()

print("Classes:")
for crop, n in rows:
    print(f"{crop}: {n}")

import os
from sqlalchemy import create_engine, text

DB = os.environ.get("DATABASE_URL", "postgresql://postgres:1234@127.0.0.1:5434/crop_risk_db")

engine = create_engine(DB)
print("DB:", DB)

with engine.connect() as conn:
    info = conn.execute(text("SELECT inet_server_addr(), inet_server_port(), current_database(), current_schema()"))
    print("server:", info.fetchone())
    cols = conn.execute(
        text("SELECT column_name FROM information_schema.columns WHERE table_name='farms' ORDER BY column_name")
    ).fetchall()

print("farms columns:", [c[0] for c in cols])

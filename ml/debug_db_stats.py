import os
from sqlalchemy import create_engine, text

DB = os.environ.get("DATABASE_URL", "postgresql://postgres:1234@127.0.0.1:5434/crop_risk_db")
engine = create_engine(DB)
print("DB:", DB)
with engine.connect() as conn:
    print(conn.execute(text("SELECT inet_server_addr(), inet_server_port(), current_database()"))
              .fetchone())
    print(conn.execute(text("SELECT count(*), min(id), max(id) FROM farms")).fetchone())

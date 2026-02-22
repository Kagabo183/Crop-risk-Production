#!/bin/bash
set -e

echo "=== Initializing database tables ==="
python -m app.scripts.init_db || echo "Warning: DB init had issues, continuing..."

echo "=== Starting server ==="
exec uvicorn app.main:app --host 0.0.0.0 --port 8000

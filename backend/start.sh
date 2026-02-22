#!/bin/bash
set -e

echo "Running database migrations..."
alembic upgrade head || echo "Migration warning: some migrations may have failed, continuing..."

echo "Starting server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000

"""
Setup and Installation Guide
Quick reference for getting the disease prediction system running
"""

# ================================
# PREREQUISITES
# ================================
# Python 3.8+
# PostgreSQL
# Redis (for Celery)

# ================================
# STEP 1: CLONE & NAVIGATE
# ================================
# cd crop-risk-backend

# ================================
# STEP 2: INSTALL DEPENDENCIES
# ================================
pip install -r backend/requirements.txt

# ================================
# STEP 3: CONFIGURE ENVIRONMENT
# ================================
# Copy template and edit with your values
cp .env.template .env
# Edit .env with your database credentials and API keys

# Required configurations:
# - DATABASE_URL
# - SECRET_KEY
# - ERA5_API_KEY (optional but recommended)
# - NOAA_API_KEY (optional but recommended)
# - IBM_EIS_API_KEY (optional but recommended)

# ================================
# STEP 4: DATABASE SETUP
# ================================
# Create database
createdb crop_risk_db

# Run migrations
alembic -c backend/alembic.ini upgrade head

# ================================
# STEP 5: INITIALIZE DISEASE CATALOG
# ================================
# This creates the 5 research-backed disease models
python -m scripts.generate_disease_predictions init

# ================================
# STEP 6: FETCH WEATHER DATA
# ================================
# Fetch historical weather (last 7 days)
python -m scripts.fetch_enhanced_weather all --days 7

# Fetch weather forecasts (next 7 days)
python -m scripts.fetch_enhanced_weather forecasts --days 7

# ================================
# STEP 7: GENERATE PREDICTIONS
# ================================
# Generate disease predictions for all farms
python -m scripts.generate_disease_predictions all

# ================================
# STEP 8: TEST THE SYSTEM
# ================================
# Run test suite to verify everything works
python -m scripts.test_disease_system

# ================================
# STEP 9: START THE API SERVER
# ================================
# Development mode
uvicorn app:app --reload --app-dir backend

# Production mode
uvicorn app:app --host 0.0.0.0 --port 8000 --app-dir backend

# ================================
# STEP 10: ACCESS API DOCUMENTATION
# ================================
# Open your browser to:
# http://localhost:8000/docs

# ================================
# VERIFICATION CHECKLIST
# ================================
# ✓ Database connected
# ✓ Migrations applied
# ✓ Disease catalog initialized (5 diseases)
# ✓ Weather data fetched
# ✓ Predictions generated
# ✓ API server running
# ✓ Can access /docs endpoint

# ================================
# QUICK TEST COMMANDS
# ================================
# Check disease catalog
curl http://localhost:8000/api/v1/diseases/

# Predict Late Blight for farm 1
curl -X POST "http://localhost:8000/api/v1/diseases/predict" \
  -H "Content-Type: application/json" \
  -d '{"farm_id": 1, "disease_name": "Late Blight", "crop_type": "potato", "forecast_days": 7}'

# Get weekly forecast
curl "http://localhost:8000/api/v1/diseases/forecast/weekly/1?disease_name=Late%20Blight"

# ================================
# AUTOMATION SETUP (OPTIONAL)
# ================================
# Start Celery worker
celery -A app.tasks.celery_app worker --loglevel=info

# Start Celery beat (scheduler)
celery -A app.tasks.celery_app beat --loglevel=info

# ================================
# TROUBLESHOOTING
# ================================
# Problem: Database connection failed
# Solution: Check DATABASE_URL in .env, ensure PostgreSQL is running

# Problem: No diseases found
# Solution: Run: python -m scripts.generate_disease_predictions init

# Problem: Weather API errors
# Solution: APIs will fallback to mock data if keys not configured
#           System will still work, but with estimated values

# Problem: Import errors
# Solution: Ensure you're in project root and dependencies installed

# ================================
# NEXT STEPS
# ================================
# 1. Register for weather API keys (ERA5, NOAA, IBM)
# 2. Configure automated tasks in Celery
# 3. Set up monitoring and alerting
# 4. Customize disease thresholds for your region
# 5. Collect field observations to improve models

# ================================
# DOCUMENTATION
# ================================
# Complete Guide: DISEASE_PREDICTION_GUIDE.md
# Quick Reference: QUICK_REFERENCE.md
# API Documentation: http://localhost:8000/docs
# Architecture: ARCHITECTURE_DIAGRAM.md

# ================================
# SUPPORT
# ================================
# Check documentation files for detailed help
# Review logs in logs/ directory
# Test individual components with test_disease_system.py

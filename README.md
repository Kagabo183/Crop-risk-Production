# Crop Risk Prediction Platform

**AI-powered backend platform for agricultural risk management in Rwanda and East Africa.**

An intelligent crop monitoring system that combines satellite imagery, weather data, and machine learning to predict disease outbreaks and crop stress before they cause damage.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Machine Learning](#machine-learning)
- [Training ML Models](#training-ml-models)
- [Automated Tasks](#automated-tasks)
- [Data Sources](#data-sources)
- [Disease Models](#disease-models)
- [Project Structure](#project-structure)
- [Development](#development)
- [Deployment](#deployment)

---

## Overview

The Crop Risk Prediction Platform provides:

- **Real-time satellite monitoring** using Google Earth Engine and Sentinel-2 imagery
- **Automated disease prediction** with 5 research-backed models
- **Weather-based risk assessment** from multiple data sources
- **Stress detection** (drought, heat, water, nutrient deficiency)
- **Automated alerts** for high-risk conditions

### Target Users

- Agricultural extension officers
- Farm managers and cooperatives
- Agricultural insurance companies
- Government agricultural departments
- Research institutions

---

## Key Features

### Satellite Monitoring
| Feature | Description |
|---------|-------------|
| Multi-source imagery | Sentinel-2, Landsat-8/9 via Google Earth Engine |
| Vegetation indices | NDVI, NDRE, NDWI, EVI, SAVI |
| Cloud filtering | Automatic filtering of cloudy images (<20%) |
| Historical analysis | 90-day trend tracking |

### Disease Prediction
| Disease | Model | Accuracy | Crops |
|---------|-------|----------|-------|
| Late Blight | Smith Period | 85-90% | Potato, Tomato |
| Septoria Leaf Spot | TOM-CAST DSV | 80-85% | Tomato |
| Powdery Mildew | Environmental | 75-80% | Wheat, Cucumber |
| Bacterial Spot | Splash Dispersal | 80-85% | Tomato, Pepper |
| Fusarium Wilt | Soil Temperature | 75-80% | Tomato, Banana |

### Weather Integration
| Source | Type | Coverage | Cost |
|--------|------|----------|------|
| Open-Meteo | Forecast + Historical | Global | Free |
| ERA5/ECMWF | Reanalysis | Global | Free |
| NOAA CDO | Historical | Global | Free |
| IBM EIS | Commercial | Global | Paid |

### Stress Detection
- **Drought stress**: NDVI decline + low rainfall analysis
- **Water stress**: NDWI monitoring + precipitation tracking
- **Heat stress**: Temperature anomaly detection
- **Nutrient deficiency**: NDRE/chlorophyll analysis

### Machine Learning
| Model | Purpose | Algorithm |
|-------|---------|-----------|
| Disease Classifier | Identify plant diseases from leaf images | CNN (EfficientNet-B0) — 80 classes, 30 plants, 92.9% accuracy |
| Anomaly Detector | Detect unusual vegetation patterns | Isolation Forest |
| Yield Predictor | Forecast crop yields | XGBoost |
| Health Forecaster | Predict vegetation trends | Prophet |
| Ensemble Scorer | Combined risk assessment | Weighted ensemble + research algorithms |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATIONS                       │
│                    (Mobile App / Web Dashboard)                  │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FastAPI Backend                          │
│                        (Port 8000)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Farms     │  │  Diseases   │  │   Weather   │             │
│  │   API       │  │   API       │  │   API       │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Satellite  │  │   Stress    │  │   Alerts    │             │
│  │   API       │  │   API       │  │   API       │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│   PostgreSQL + PostGIS  │       │         Redis           │
│   (Primary Database)    │       │   (Cache + Task Queue)  │
│   - Farms               │       │   - Celery Broker       │
│   - Weather Records     │       │   - Result Backend      │
│   - Satellite Images    │       │   - Session Cache       │
│   - Predictions         │       └─────────────────────────┘
│   - Alerts              │                   │
└─────────────────────────┘                   ▼
                              ┌─────────────────────────────────┐
                              │        Celery Workers           │
                              │  ┌───────────┐ ┌───────────┐   │
                              │  │  Weather  │ │ Satellite │   │
                              │  │  Tasks    │ │  Tasks    │   │
                              │  └───────────┘ └───────────┘   │
                              │  ┌───────────┐ ┌───────────┐   │
                              │  │  Disease  │ │  Stress   │   │
                              │  │  Tasks    │ │  Tasks    │   │
                              │  └───────────┘ └───────────┘   │
                              └─────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
        ┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
        │  Google Earth     │    │    Open-Meteo     │    │   ERA5/NOAA       │
        │  Engine           │    │    Weather API    │    │   Climate Data    │
        │  (Satellite)      │    │    (Free)         │    │                   │
        └───────────────────┘    └───────────────────┘    └───────────────────┘
```

---

## Tech Stack

| Component | Technology | Version |
|-----------|------------|---------|
| **Backend Framework** | FastAPI | 0.104.1 |
| **Database** | PostgreSQL + PostGIS | 14 + 3.4 |
| **Cache/Broker** | Redis | 7 (Alpine) |
| **Task Queue** | Celery + Celery Beat | 5.3.4 |
| **ORM** | SQLAlchemy + GeoAlchemy2 | 2.0.23 |
| **Deep Learning** | PyTorch, TorchVision | 2.0+ |
| **ML Models** | XGBoost, scikit-learn, Prophet | Latest |
| **Satellite** | Google Earth Engine, PySTAC | Latest |
| **Geospatial** | Rasterio, GeoPandas, Shapely | Latest |
| **Auth** | JWT (python-jose) | Latest |

---

## Quick Start

### Prerequisites

- Python 3.11+
- PostgreSQL 14+ with PostGIS extension
- Redis 7+
- Docker & Docker Compose (recommended)

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/your-org/crop-risk-backend.git
cd crop-risk-backend

# Copy environment file
cp .env.example .env

# Edit .env with your settings
nano .env

# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f
```

Services will be available at:
- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **PostgreSQL**: localhost:5434
- **Redis**: localhost:6379

### Option 2: Manual Installation

```bash
# 1. Install Python dependencies
pip install -r backend/requirements.txt

# 2. Setup PostgreSQL
psql -U postgres
CREATE DATABASE crop_risk_db;
\c crop_risk_db
CREATE EXTENSION postgis;
\q

# 3. Configure environment
cp .env.example .env
# Edit .env with your database credentials

# 4. Run database migrations
alembic -c backend/alembic.ini upgrade head

# 5. Initialize disease models
python -m scripts.generate_disease_predictions init

# 6. Start the API server
uvicorn app:app --reload --app-dir backend --host 0.0.0.0 --port 8000

# 7. Start Celery worker (new terminal)
celery -A app.tasks.celery_app worker --loglevel=info

# 8. Start Celery beat scheduler (new terminal)
celery -A app.tasks.celery_app beat --loglevel=info
```

---

## Configuration

### Required Environment Variables

```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5434/crop_risk_db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
CELERY_BROKER_URL=redis://localhost:6379/0

# Security
SECRET_KEY=your-secret-key-minimum-32-characters
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# ML Models
MODEL_DIR=./backend/data/models

# API Settings
DEBUG=False
PROJECT_NAME=Crop Risk Prediction Platform
```

### Optional Environment Variables

```bash
# Google Earth Engine (for satellite data)
GEE_SERVICE_ACCOUNT_EMAIL=your-account@project.iam.gserviceaccount.com
GEE_PRIVATE_KEY_PATH=/app/data/earthengine/private-key.json

# Weather APIs (optional - system has fallbacks)
ERA5_API_KEY=your-era5-key
NOAA_API_KEY=your-noaa-token
IBM_EIS_API_KEY=your-ibm-key

# Notifications
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

SMS_PROVIDER=africas_talking
SMS_API_KEY=your-sms-key
SMS_USERNAME=sandbox
```

---

## API Documentation

### Base URL
```
http://localhost:8000/api/v1
```

### Authentication
All endpoints (except `/health`) require JWT authentication:
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:8000/api/v1/farms
```

### Main Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/farms` | GET, POST | List/create farms |
| `/farms/{id}` | GET, PUT, DELETE | Farm CRUD operations |
| `/stress-monitoring/health/{farm_id}` | GET | Vegetation health timeseries |
| `/stress-monitoring/stress-assessment/{farm_id}` | GET | Current stress assessment |
| `/stress-monitoring/drought-assessment/{farm_id}` | GET | Drought analysis |
| `/stress-monitoring/water-stress/{farm_id}` | GET | Water stress analysis |
| `/stress-monitoring/heat-stress/{farm_id}` | GET | Heat stress analysis |
| `/stress-monitoring/trigger-download` | POST | Trigger satellite data fetch |
| `/farm-satellite/` | GET | All farms with satellite data |
| `/farm-satellite/history/{farm_id}` | GET | NDVI history for farm |
| `/diseases/` | GET | List all disease models |
| `/diseases/predict` | POST | Generate disease prediction |
| `/diseases/forecast/weekly/{farm_id}` | GET | 7-day disease forecast |
| `/weather/current/{farm_id}` | GET | Current weather conditions |
| `/weather/forecast/{farm_id}` | GET | Weather forecast |
| `/alerts/` | GET | List alerts |
| `/ml/classify-disease` | POST | Classify disease from leaf image (80 classes) |
| `/ml/supported-diseases` | GET | List all supported plants and diseases |
| `/ml/risk-assessment` | POST | Comprehensive ML risk assessment |
| `/ml/predict-yield` | POST | Predict crop yield |
| `/ml/detect-anomalies` | POST | Detect vegetation anomalies |
| `/ml/forecast-health` | POST | Forecast health trends |
| `/ml/models/status` | GET | ML model health status |
| `/health` | GET | API health check |

### Example Requests

**Get farm health assessment:**
```bash
curl http://localhost:8000/api/v1/stress-monitoring/stress-assessment/1
```

**Response:**
```json
{
  "health_score": 78.5,
  "stress_score": 21.5,
  "stress_level": "low",
  "primary_stress": "none",
  "message": "Farm is in good health",
  "stress_breakdown": {
    "drought": 15,
    "water": 10,
    "heat": 8,
    "nutrient": 12
  }
}
```

**Generate disease prediction:**
```bash
curl -X POST http://localhost:8000/api/v1/diseases/predict \
  -H "Content-Type: application/json" \
  -d '{
    "farm_id": 1,
    "disease_name": "Late Blight",
    "crop_type": "potato",
    "forecast_days": 7
  }'
```

---

## Machine Learning

The platform includes 5 ML models that work together with research-validated algorithms:

### ML Models

| Model | Algorithm | Purpose | Training Data |
|-------|-----------|---------|---------------|
| **Disease Classifier** | EfficientNet-B0 (CNN) | Classify plant diseases from leaf images | PlantVillage + Mendeley (190K images, 80 classes) |
| **Anomaly Detector** | Isolation Forest | Detect unusual vegetation patterns | Farm satellite data |
| **Yield Predictor** | XGBoost | Predict crop yield from conditions | Historical + satellite |
| **Health Forecaster** | Prophet | Time-series health prediction | Satellite time-series |
| **Ensemble Scorer** | Weighted Ensemble | Combine all models + research algorithms | All sources |

### Disease Classifier — 80 Classes, 30 Plants

The CNN disease classifier identifies **56 diseases across 30 plant species** using leaf images, with an overall validation accuracy of **92.9%**.

**Supported Plants**: Apple, Arjun, Basil, Blueberry, Cherry, Chinar, Coffee, Corn (Maize), Cotton, Grape, Guava, Jamun, Jatropha, Lemon, Mango, Orange, Peach, Pepper, Pomegranate, Potato, Raspberry, Rice, Soybean, Squash, Strawberry, Tomato, and more.

**Africa-relevant crops include**: Coffee (Rust, Red Spider Mite, Healthy), Rice (Brown Spot, Hispa, Leaf Blast, Healthy), Mango (Anthracnose, Bacterial Canker, Die Back, Gall Midge, Powdery Mildew, Sooty Mould, and more), Cotton (Aphids, Bacterial Blight, Powdery Mildew, Target Spot), Corn/Maize (Cercospora, Common Rust, Northern Leaf Blight), Potato (Early Blight, Late Blight), and Tomato (10 diseases).

### Research-Validated Algorithms

The Ensemble Risk Scorer combines ML predictions with proven research models:

| Algorithm | Source | Disease | Description |
|-----------|--------|---------|-------------|
| Smith Period | Cornell University | Late Blight | Temperature + humidity + leaf wetness |
| TOM-CAST DSV | Ohio State | Septoria | Disease Severity Value accumulation |
| SIMCAST | Research | Early Blight | Temperature + moisture patterns |

### ML API Endpoints

```bash
# Classify disease from leaf image (all 30 plants)
curl -X POST http://localhost:8000/api/v1/ml/classify-disease \
  -F "file=@leaf_image.jpg"

# Classify with crop filter (narrows results to one plant)
curl -X POST http://localhost:8000/api/v1/ml/classify-disease?crop_type=tomato \
  -F "file=@leaf_image.jpg"

# List all supported plants and diseases
curl http://localhost:8000/api/v1/ml/supported-diseases

# Get comprehensive risk assessment
curl -X POST http://localhost:8000/api/v1/ml/risk-assessment \
  -H "Content-Type: application/json" \
  -d '{"farm_id": 1}'

# Predict yield
curl http://localhost:8000/api/v1/ml/predict-yield/1

# Check model status
curl http://localhost:8000/api/v1/ml/models/status
```

**Example classify-disease response:**
```json
{
  "plant": "Potato",
  "disease": "Late Blight",
  "confidence": 1.0,
  "is_healthy": false,
  "top5": [
    {"class": "Potato___Late_blight", "plant": "Potato", "disease": "Late Blight", "confidence": 1.0},
    {"class": "Potato___healthy", "plant": "Potato", "disease": "Healthy", "confidence": 0.0}
  ],
  "treatment": {
    "fungicides": ["Mancozeb", "Chlorothalonil", "Copper-based fungicides"],
    "cultural": ["Remove infected plants", "Improve air circulation", "Avoid overhead irrigation"],
    "urgency": "high",
    "spread_risk": "very_high"
  },
  "crop_type": "potato"
}
```

---

## Training ML Models

### Disease Classifier (EfficientNet-B0, 80 classes)

The disease classifier is trained on the **PlantVillage + Mendeley** dataset (190K images, 80 classes) using Google Colab with a free T4 GPU. Training takes ~3 hours.

#### Option 1: Google Colab (Recommended)

1. Open [backend/notebooks/train_disease_classifier.ipynb](backend/notebooks/train_disease_classifier.ipynb) in Google Colab
2. Set runtime to **GPU** (Runtime > Change runtime type > T4 GPU)
3. Run all cells — the notebook downloads the dataset from Kaggle via `kagglehub`
4. Download the two output files when training completes
5. Place them in `backend/data/models/`:
   - `disease_classifier_80class.pth` (~16 MB)
   - `disease_classifier_80class.json` (~2.4 KB)

#### Option 2: CLI Training (requires GPU or patience)

```bash
cd backend

# Verify local dataset structure
python -m app.scripts.download_plantvillage verify --data-dir "path/to/dataset"

# Train (uses GPU if available, ~10-15 hours on CPU)
python -m app.scripts.download_plantvillage train --data-dir "path/to/dataset" --epochs 10

# List supported classes
python -m app.scripts.download_plantvillage list --data-dir "path/to/dataset"
```

### Dataset Info

| Split | Images | Classes | Source |
|-------|--------|---------|--------|
| Train | 144,795 | 80 | PlantVillage + Mendeley |
| Val | 42,372 | 80 | PlantVillage + Mendeley |
| Test | 2,910 | 42 | PlantVillage + Mendeley |
| **Total** | **190,077** | **80** | **~2.2 GB** |

**Kaggle dataset**: `hadyahmed00/plants-leafs-dataset`

### Model Storage

Trained models are saved to `backend/data/models/` (set via `MODEL_DIR` env var):

```
backend/data/models/
├── disease_classifier_80class.pth    # EfficientNet-B0 weights (16 MB)
├── disease_classifier_80class.json   # Class mapping (80 classes)
├── ndvi_anomaly_detector.pkl         # Isolation Forest
├── yield_predictor_potato.pkl        # XGBoost
└── health_forecaster.pkl             # Prophet
```

---

## Automated Tasks

The system runs automated tasks via Celery Beat:

### Weather Tasks (Critical for disease prediction)

| Task | Schedule | Description |
|------|----------|-------------|
| `fetch_all_farms_weather` | Every 6 hours | Fetch current weather from Open-Meteo, ERA5, NOAA |
| `fetch_weather_forecast` | Daily at 00:00 UTC | Fetch 7-day forecast for all farms |
| `check_extreme_conditions` | Every 3 hours | Monitor heat/frost/drought/flood conditions |

### Satellite Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| `fetch_all_farms_imagery` | Every 3 days at 02:00 UTC | Fetch Sentinel-2 imagery from GEE |
| `detect_stress_zones` | Daily at 04:00 UTC | Analyze vegetation stress |
| `scan_and_enqueue` | Every 10 minutes | Process local TIFF files |

### Disease Prediction Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| `generate_disease_predictions_task` | Daily at 06:00 UTC | Generate predictions for all farms |

### ML Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| `ml.detect_anomalies_all_farms` | Daily at 05:00 UTC | NDVI anomaly detection for all farms |
| `ml.batch_risk_assessment` | Daily at 06:30 UTC | ML risk assessment for all farms |
| `ml.generate_health_forecasts` | Daily at 07:00 UTC | Generate health trend forecasts |
| `ml.model_health_check` | Every 6 hours | Check ML model health status |
| `ml.retrain_all_models` | Weekly (Sunday 01:00 UTC) | Retrain models with new data |

### Daily Data Flow

```
00:00 → Weather forecast fetch
02:00 → Satellite imagery fetch (every 3 days)
04:00 → Stress zone detection
05:00 → ML anomaly detection
06:00 → Disease predictions (research algorithms)
06:30 → ML risk assessment (ensemble scoring)
07:00 → Health trend forecasts
Every 3h → Extreme weather alerts
Every 6h → Current weather update + ML health check
Weekly  → ML model retraining
```

---

## Data Sources

### Satellite Data

| Source | Satellite | Resolution | Revisit | Cost |
|--------|-----------|------------|---------|------|
| Google Earth Engine | Sentinel-2 | 10m | 5 days | Free |
| Google Earth Engine | Landsat-8/9 | 30m | 16 days | Free |
| Planetary Computer | Sentinel-2 | 10m | 5 days | Free |

### Weather Data

| Source | Data Type | Update Frequency | Cost |
|--------|-----------|------------------|------|
| Open-Meteo | Forecast + Historical | Hourly | Free |
| ERA5/ECMWF | Reanalysis | 6-hourly | Free |
| NOAA CDO | Historical | Daily | Free |
| IBM EIS | Commercial forecast | Hourly | Paid |

### Vegetation Indices

| Index | Full Name | Purpose | Range |
|-------|-----------|---------|-------|
| NDVI | Normalized Difference Vegetation Index | Overall crop health | -1 to 1 |
| NDRE | Normalized Difference Red Edge | Chlorophyll/nitrogen content | -1 to 1 |
| NDWI | Normalized Difference Water Index | Water content/stress | -1 to 1 |
| EVI | Enhanced Vegetation Index | Dense vegetation monitoring | -1 to 1 |
| SAVI | Soil Adjusted Vegetation Index | Sparse vegetation | -1 to 1 |

---

## Disease Models

### Late Blight (Phytophthora infestans)

**Model**: Smith Period Algorithm (Cornell University)

**Conditions**:
- Temperature ≥ 10°C
- Relative humidity ≥ 90%
- Leaf wetness ≥ 11 hours

**Risk Levels**:
| Score | Level | Action |
|-------|-------|--------|
| 0-39 | Low | Routine monitoring |
| 40-59 | Moderate | Prepare fungicide |
| 60-74 | High | Apply fungicide within 24h |
| 75-100 | Severe | Immediate application |

### Septoria Leaf Spot

**Model**: TOM-CAST DSV (Ohio State University)

**Conditions**:
- Temperature 15-27°C
- Extended leaf wetness periods
- Accumulated Daily Severity Values (DSV)

**Action Threshold**: Spray at 15-20 DSV accumulation

### Other Models

- **Powdery Mildew**: Temperature 15-22°C + 50-70% humidity (dry foliage)
- **Bacterial Spot**: Temperature 24-30°C + rainfall + wind (splash dispersal)
- **Fusarium Wilt**: Soil temperature 27-32°C (prevention-focused)

---

## Project Structure

```
crop-risk-backend/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   └── v1/
│   │   │       ├── endpoints/
│   │   │       │   ├── farms.py           # Farm CRUD
│   │   │       │   ├── stress_monitoring.py # Stress API
│   │   │       │   ├── farm_satellite.py   # Satellite API
│   │   │       │   ├── ml.py               # ML API endpoints
│   │   │       │   └── ...
│   │   │       └── api.py                  # Router aggregation
│   │   ├── core/
│   │   │   └── config.py                   # Settings
│   │   ├── db/
│   │   │   └── database.py                 # DB connection
│   │   ├── ml/                             # Machine Learning Module
│   │   │   ├── __init__.py                 # ML exports
│   │   │   ├── base.py                     # Base ML model class
│   │   │   ├── disease_classifier.py       # CNN disease classifier
│   │   │   ├── anomaly_detector.py         # NDVI anomaly detection
│   │   │   ├── yield_predictor.py          # XGBoost yield prediction
│   │   │   ├── trend_forecaster.py         # Prophet health forecasting
│   │   │   ├── ensemble_scorer.py          # Ensemble risk scoring
│   │   │   ├── model_registry.py           # Model management
│   │   │   ├── intelligence.py             # Risk intelligence
│   │   │   └── feature_engineering/        # Feature computation
│   │   ├── models/
│   │   │   ├── farm.py                     # Farm model
│   │   │   ├── data.py                     # Weather/Satellite models
│   │   │   ├── disease.py                  # Disease models
│   │   │   └── alert.py                    # Alert model
│   │   ├── scripts/
│   │   │   ├── download_plantvillage.py    # Dataset download/train
│   │   │   └── download_pretrained.py      # Pre-trained models
│   │   ├── services/
│   │   │   ├── satellite_service.py        # GEE integration
│   │   │   ├── weather_service.py          # Weather integration
│   │   │   ├── stress_detection_service.py # Stress analysis
│   │   │   └── disease_intelligence.py     # Disease models
│   │   ├── tasks/
│   │   │   ├── celery_app.py               # Celery config
│   │   │   ├── satellite_tasks.py          # Satellite jobs
│   │   │   ├── weather_tasks.py            # Weather jobs
│   │   │   ├── ml_tasks.py                 # ML training/inference jobs
│   │   │   └── process_tasks.py            # Processing jobs
│   │   └── main.py                         # FastAPI app
│   ├── migrations/                         # Alembic migrations
│   ├── requirements.txt
│   └── Dockerfile
│   ├── data/
│   │   └── models/                        # Trained ML models (.pth, .json, .pkl)
│   ├── notebooks/
│   │   └── train_disease_classifier.ipynb # Colab training notebook
├── logs/                                   # Application logs
├── docker-compose.yml
├── .env.example
├── README.md
├── API_REFERENCE.md                        # Full API documentation
├── ML_ARCHITECTURE.md                      # ML system documentation
└── DEPLOYMENT.md                           # Production deployment guide
```

---

## Development

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest backend/tests/test_farms.py
```

### Code Formatting

```bash
# Format code
black backend/
isort backend/

# Lint
flake8 backend/
```

### Database Migrations

```bash
# Create new migration
alembic -c backend/alembic.ini revision --autogenerate -m "description"

# Apply migrations
alembic -c backend/alembic.ini upgrade head

# Rollback
alembic -c backend/alembic.ini downgrade -1
```

---

## Deployment

### Docker Compose (Production)

```bash
# Build and start
docker-compose -f docker-compose.yml up -d --build

# Scale workers
docker-compose up -d --scale crop-risk-worker=3

# View logs
docker-compose logs -f crop-risk-backend
```

### Environment Checklist

- [ ] Set `DEBUG=False`
- [ ] Configure strong `SECRET_KEY`
- [ ] Set up PostgreSQL with proper credentials
- [ ] Configure Redis with password (if exposed)
- [ ] Set up Google Earth Engine service account
- [ ] Configure weather API keys (optional)
- [ ] Set up SMTP for email alerts
- [ ] Configure SMS provider for alerts

### Health Check

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected"
}
```

---

## Support

For issues and feature requests, please open an issue on GitHub.

---

## License

MIT License - see LICENSE file for details.

---

**Version**: 2.3.0
**Last Updated**: February 2026
**Maintainer**: Crop Risk Platform Team

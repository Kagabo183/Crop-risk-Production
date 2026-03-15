# Crop Prediction Staging

Agricultural satellite monitoring platform with automated crop risk assessment. Uses Google Earth Engine, Sentinel-2 imagery, vegetation index analysis, and disease prediction models to provide real-time farm health monitoring.

## Project Overview

The Crop Prediction project provides automated crop risk assessment and disease prediction for farms in Rwanda. The platform integrates:

- **Google Earth Engine** for satellite imagery acquisition
- **Sentinel-2** multispectral imagery (10m resolution)
- **Vegetation index calculation** (NDVI, NDRE, NDWI, EVI, SAVI)
- **Disease prediction models** (Late Blight, Septoria, Powdery Mildew, Fusarium Wilt)
- **Composite health scoring** with automatic risk classification
- **Celery-based task scheduling** for daily automated monitoring

## Repository Structure

```
backend/           FastAPI backend + ML pipeline
  app/
    api/v1/        REST API endpoints
    services/      Business logic (satellite, disease, stress, auto_crop_risk)
    tasks/         Celery tasks (scheduled + on-demand)
    models/        SQLAlchemy ORM models
    ml/            ML models + feature engineering
web-app/           Vue.js frontend
mobile-app/        Capacitor mobile app
scripts/           Utility & data scripts
data/              Processed data, models, uploads
ml/                Standalone ML training scripts
```

## Auto Crop Risk Pipeline

The **Auto Crop Risk** system is the core feature — a fully automated pipeline that fetches satellite data and runs the crop risk classifier without manual input.

### Pipeline Flow

```
Farm Created/Updated → Celery Task → GEE Sentinel-2 Fetch → Index Calc → Health Score → Disease Models → Risk Output
                                                                                                              ↓
Daily Schedule (06:30 UTC) ─────────────────────────────────────────────────────────────────────────→ All Farms Batch
```

### 1. Satellite Data Acquisition

- Uses **Google Earth Engine API** with Sentinel-2 Surface Reflectance (`COPERNICUS/S2_SR`)
- Filters by: farm polygon geometry, date range (last 10–15 days), cloud coverage < 20%
- Falls back to Microsoft Planetary Computer if GEE is unavailable
- Falls back to Landsat 8/9 if no Sentinel-2 data available

### 2. Vegetation Index Calculation

From Sentinel-2 bands (B2, B3, B4, B5, B8):

| Index | Formula | Purpose |
|-------|---------|---------|
| **NDVI** | (NIR − Red) / (NIR + Red) | Overall vegetation health |
| **NDRE** | (NIR − RedEdge) / (NIR + RedEdge) | Crop vigor / chlorophyll |
| **NDWI** | (Green − NIR) / (Green + NIR) | Water content |
| **EVI** | 2.5 × (NIR − Red) / (NIR + 6×Red − 7.5×Blue + 1) | Atmospheric-corrected |
| **SAVI** | ((NIR − Red) / (NIR + Red + 0.5)) × 1.5 | Soil-adjusted |

### 3. Farm Boundary Extraction

- Uses the **exact farm polygon** (GeoAlchemy2 geometry) when available
- Reduces the image over the region using **mean** pixel values at 10m scale
- Falls back to a 50m buffer around farm center coordinates

### 4. Composite Health Score

Weighted combination normalised to **0–100 scale**:

```
Composite Score = NDVI × 0.30 + NDRE × 0.20 + NDWI × 0.20 + EVI × 0.15 + SAVI × 0.15
```

### 5. Health Classification

| Status | Score Range |
|--------|-------------|
| **Healthy** | ≥ 70 |
| **Moderate Stress** | 50 – 69 |
| **High Stress** | < 50 |

### 6. Disease Risk Models

| Disease | Model | Trigger Conditions |
|---------|-------|--------------------|
| Late Blight | Smith Period (Cornell) | temp ≥ 10°C, humidity ≥ 90%, leaf wetness ≥ 11h |
| Septoria | TOM-CAST (Ohio State) | temp 15–27°C, leaf wetness ≥ 6h, accumulated DSV ≥ 15 |
| Powdery Mildew | Environmental humidity | temp 15–22°C, humidity 50–70%, low rainfall |
| Fusarium Wilt | Soil temperature | soil temp 27–32°C, moderate moisture |

### 7. Risk Detection

Automatically detects: **drought**, **water_stress**, **nutrient_deficiency**, **disease**

### 8. API Output Format

```json
{
  "farm_id": 1,
  "crop_type": "potato",
  "composite_health_score": 72.5,
  "health_status": "Healthy",
  "vegetation_indices": {
    "NDVI": 0.68,
    "NDRE": 0.35,
    "NDWI": 0.12,
    "EVI": 0.52,
    "SAVI": 0.48
  },
  "detected_risk": ["water_stress"],
  "disease_risk": [
    {
      "disease": "Late Blight",
      "risk_score": 25.0,
      "risk_level": "low",
      "recommended_actions": ["Monitor weather forecasts", "Scout weekly"]
    }
  ],
  "recommended_action": [
    "Monitor soil moisture levels and adjust irrigation schedule."
  ],
  "data_source": "google_earth_engine",
  "analysis_timestamp": "2026-03-15T06:30:00"
}
```

### 9. Auto-Run Triggers

Satellite monitoring runs automatically when:

| Trigger | Mechanism |
|---------|-----------|
| **Farm created** | Celery task `analyze_single_farm_risk` dispatched on POST /farms/ |
| **Farm updated** (coords changed) | Celery task dispatched on PUT /farms/{id} |
| **Daily schedule** | Celery Beat at 06:30 UTC runs `analyze_all_farms_risk` |
| **On-demand** | POST /api/v1/farm/analyze-risk |

### 10. Performance Optimisation

- **24-hour cache**: Results cached per farm (by coordinates + date) in Redis (with in-memory fallback)
- **Determinism**: Farms with identical coordinates return identical index values (same cache key)
- **`force_refresh=true`** to bypass cache when needed

## API Reference

### Auto Crop Risk

```
POST /api/v1/farm/analyze-risk
  Body: { "farm_id": 1, "days_back": 15, "max_cloud_cover": 20, "force_refresh": false }
  → Full auto risk analysis

GET  /api/v1/farm/analyze-risk/{farm_id}
  → Quick GET (returns cached or fresh analysis)

POST /api/v1/farm/analyze-risk/all
  → Batch analysis for all farms (admin/agronomist only)
```

### Other Key Endpoints

```
POST /api/v1/farms/                    Create farm (auto-triggers risk analysis)
PUT  /api/v1/farms/{id}               Update farm (re-triggers on coord change)
GET  /api/v1/stress-monitoring/health/{farm_id}    Vegetation health timeseries
GET  /api/v1/ml/risk-assessment/{farm_id}          ML ensemble risk assessment
POST /api/v1/diseases/predict          Disease-specific prediction
GET  /api/v1/early-warning/            NDVI anomaly + weather alerts
```

## Deployment Instructions

1. **Set Up the Environment**:
   - Ensure you have Docker installed on your system.
   - Install the required Python dependencies using `pip install -r requirements.txt`.

2. **Run Locally**:
   - Build the Docker image:
     ```bash
     docker build -t crop-prediction-backend .
     ```
   - Run the Docker container:
     ```bash
     docker run -p 8000:8000 crop-prediction-backend
     ```
   - Access the API at `http://localhost:8000`.

3. **Deploy on Render**:
   - Push your changes to the `main` or `production` branch.
   - Render will automatically build and deploy the updated services.
   - Monitor the deployment status on the Render dashboard.

## Environment Variables

```env
# Google Earth Engine
GEE_PROJECT=your-gcp-project-id
GEE_SERVICE_ACCOUNT_EMAIL=gee@project.iam.gserviceaccount.com
GEE_PRIVATE_KEY_PATH=/path/to/key.json

# Database
DATABASE_URL=postgresql://user:pass@host:5432/cropdb

# Redis (for caching + Celery broker)
REDIS_HOST=localhost
REDIS_PORT=6379

# Weather APIs (optional — enhances disease prediction accuracy)
ERA5_API_KEY=...
NOAA_API_KEY=...
```

## Services

- **Web Service**: FastAPI backend hosting the REST API
- **Celery Worker**: Processes satellite data + risk analysis tasks
- **Celery Beat**: Schedules daily/periodic monitoring jobs
- **Redis**: Caching layer + Celery message broker
- **PostgreSQL**: Primary database for farms, satellite data, predictions

## Troubleshooting

- If the Docker build fails, ensure that the `requirements.txt` file is present and correctly formatted.
- Check the Render dashboard for detailed logs in case of deployment issues.
- If GEE initialization fails, verify `GEE_PROJECT` and service account credentials.
- If no satellite data is returned, try increasing `days_back` or `max_cloud_cover`.

## Contributing

Contributions are welcome! Please follow the guidelines in `CONTRIBUTING.md`.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

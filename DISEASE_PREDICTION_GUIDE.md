# Disease Prediction Enhancement - Implementation Guide

## Overview

This enhancement transforms your crop risk backend from a generic risk assessment system into a comprehensive, CPN-level disease prediction platform with:

1. **Multi-source Weather Integration** (ERA5, NOAA, IBM EIS, Local Stations)
2. **Pathogen-Specific Disease Models** (Late Blight, Septoria, Powdery Mildew, etc.)
3. **Short-term Forecasting** (Daily and weekly disease risk predictions)

---

## 🎯 Key Features Added

### 1. Enhanced Weather Service

**File:** [`app/services/weather_service.py`](app/services/weather_service.py)

- **Multi-source integration**: ERA5/ECMWF, NOAA CDO, IBM EIS, local weather stations
- **Quality-weighted data fusion**: Prioritizes ground-truth over reanalysis
- **Disease-specific variables**:
  - Temperature, humidity, rainfall
  - Leaf wetness estimation/measurement
  - Wind speed, dewpoint, pressure

**Disease Risk Calculations:**
- Fungal disease risk (high humidity + moderate temps)
- Bacterial disease risk (warm + wet conditions)
- Viral disease risk (vector activity thresholds)
- Late blight-specific Smith Period detection

### 2. Pathogen-Specific Disease Models

**File:** [`app/services/disease_intelligence.py`](app/services/disease_intelligence.py)

#### Implemented Disease Models:

| Disease | Model Basis | Research Source | Key Thresholds |
|---------|-------------|-----------------|----------------|
| **Late Blight** | Smith Period Model | Cornell University | Temp ≥10°C, RH ≥90%, 11+ hrs wetness |
| **Septoria Leaf Spot** | TOM-CAST | Ohio State | 15-27°C, 6+ hrs wetness, DSV accumulation |
| **Powdery Mildew** | Mechanistic | University Extension | 15-22°C, 50-70% RH, no free water needed |
| **Bacterial Spot** | Environmental | U. of Florida | 24-30°C, splash dispersal, high wetness |
| **Fusarium Wilt** | Soil-borne | Multiple Sources | 27-32°C soil temp, moderate moisture |

Each model provides:
- Risk score (0-100)
- Risk level (low/moderate/high/severe)
- Days to symptom onset
- Actionable recommendations
- Treatment windows

### 3. Short-term Forecasting

**Daily Forecasts** (1-14 days):
- Disease risk for each day
- Weather-driven predictions
- Confidence scores (decrease with time)
- Actionable day identification

**Weekly Summaries** (7-day outlook):
- Overall weekly risk level
- Peak risk day identification
- Critical action days count
- Strategic management recommendations

---

## 📊 Database Schema

### New Tables

#### `diseases`
Master catalog of diseases with pathogen characteristics and research-backed thresholds.

#### `disease_predictions`
Stores all disease risk predictions with detailed risk factors and recommendations.

#### `disease_observations`
Ground-truth observations from field scouts for model validation.

#### `disease_model_configs`
Configuration for each disease model (thresholds, weights, parameters).

#### `weather_forecasts`
Short-term weather forecasts for disease prediction.

**Migration:** [`migrations/versions/disease_prediction_v1.py`](migrations/versions/disease_prediction_v1.py)

---

## 🔌 API Endpoints

### Disease Catalog

```http
GET /api/v1/diseases/
GET /api/v1/diseases/{disease_id}
POST /api/v1/diseases/
```

### Disease Predictions

```http
POST /api/v1/diseases/predict
```

**Request:**
```json
{
  "farm_id": 1,
  "disease_name": "Late Blight",
  "crop_type": "potato",
  "forecast_days": 7,
  "include_recommendations": true
}
```

**Response:**
```json
{
  "prediction": {
    "risk_score": 78.5,
    "risk_level": "high",
    "infection_probability": 0.85,
    "days_to_symptom_onset": 5,
    "action_threshold_reached": true,
    "recommended_actions": [
      "Apply fungicide immediately",
      "Scout fields daily",
      "Remove infected plants"
    ],
    "treatment_window": "within_24h"
  },
  "disease_info": {...},
  "current_risk": {...},
  "forecast": {
    "weekly_risk_level": "high",
    "peak_risk_day": "2026-01-05",
    "critical_action_days": 3,
    "daily_forecasts": [...]
  }
}
```

### Forecasts

```http
GET /api/v1/diseases/forecast/daily/{farm_id}?disease_name=Late Blight&days=7
GET /api/v1/diseases/forecast/weekly/{farm_id}?disease_name=Late Blight
```

### Observations (Ground Truth)

```http
POST /api/v1/diseases/observations
GET /api/v1/diseases/observations/farm/{farm_id}
```

### Statistics

```http
GET /api/v1/diseases/statistics/{farm_id}?days=30
```

---

## 🛠️ Scripts

### 1. Fetch Weather Data

[`scripts/fetch_enhanced_weather.py`](scripts/fetch_enhanced_weather.py)

```bash
# Fetch weather for all farms (last 7 days)
python -m scripts.fetch_enhanced_weather all --days 7

# Fetch for specific farm (last 30 days)
python -m scripts.fetch_enhanced_weather farm --farm-id 1 --days 30

# Fetch 7-day forecasts
python -m scripts.fetch_enhanced_weather forecasts --days 7

# Show summary
python -m scripts.fetch_enhanced_weather summary
```

### 2. Generate Disease Predictions

[`scripts/generate_disease_predictions.py`](scripts/generate_disease_predictions.py)

```bash
# Initialize disease catalog
python -m scripts.generate_disease_predictions init

# Generate predictions for all farms
python -m scripts.generate_disease_predictions all

# Generate for specific farm
python -m scripts.generate_disease_predictions farm --farm-id 1

# Generate 7-day forecast
python -m scripts.generate_disease_predictions forecast --farm-id 1

# Show summary
python -m scripts.generate_disease_predictions summary
```

---

## ⚙️ Configuration

### Environment Variables

Add to your `.env` file:

```env
# Weather API Keys
ERA5_API_KEY=your_copernicus_api_key
NOAA_API_KEY=your_noaa_token
IBM_EIS_API_KEY=your_ibm_weather_key
LOCAL_STATION_URL=http://your-local-weather-station/api

# Disease Prediction Settings
DISEASE_FORECAST_DAYS=7
DISEASE_MODEL_VERSION=v1.0
ENABLE_DAILY_FORECASTS=true
ENABLE_WEEKLY_SUMMARIES=true
```

### Obtaining API Keys

1. **ERA5/ECMWF**: Register at [Copernicus Climate Data Store](https://cds.climate.copernicus.eu/)
2. **NOAA**: Get token from [NOAA Climate Data Online](https://www.ncdc.noaa.gov/cdo-web/token)
3. **IBM EIS**: Contact [IBM Environmental Intelligence](https://www.ibm.com/products/environmental-intelligence-suite)

---

## 🚀 Deployment Steps

### 1. Install Dependencies

```bash
pip install -r backend/requirements.txt
```

New packages added:
- `cdsapi` - ERA5 data access
- `meteomatics` - Weather API client
- `openmeteo-requests` - Open-Meteo API
- `scipy` - Scientific computing
- `statsmodels` - Statistical modeling

### 2. Run Database Migration

```bash
alembic -c backend/alembic.ini upgrade head
```

### 3. Initialize Disease Catalog

```bash
python -m scripts.generate_disease_predictions init
```

This creates 5 research-backed disease entries:
- Late Blight (Cornell model)
- Septoria Leaf Spot (TOM-CAST)
- Powdery Mildew
- Bacterial Spot
- Fusarium Wilt

### 4. Configure API Keys

Update `.env` with your weather API credentials.

### 5. Fetch Initial Weather Data

```bash
# Historical data
python -m scripts.fetch_enhanced_weather all --days 30

# Forecasts
python -m scripts.fetch_enhanced_weather forecasts --days 7
```

### 6. Generate Disease Predictions

```bash
python -m scripts.generate_disease_predictions all
```

### 7. Set Up Automated Tasks

Add to your Celery beat schedule (in `app/tasks/celery_app.py`):

```python
from celery.schedules import crontab

app.conf.beat_schedule = {
    # Fetch weather every 6 hours
    'fetch-weather-data': {
        'task': 'app.tasks.fetch_weather_task',
        'schedule': crontab(minute=0, hour='*/6'),
    },
    # Generate disease predictions daily
    'generate-disease-predictions': {
        'task': 'app.tasks.disease_prediction_task',
        'schedule': crontab(minute=0, hour=6),  # 6 AM daily
    },
    # Update forecasts daily
    'update-weather-forecasts': {
        'task': 'app.tasks.forecast_update_task',
        'schedule': crontab(minute=0, hour=0),  # Midnight
    },
}
```

---

## 📈 Usage Examples

### Example 1: Get Late Blight Risk for a Potato Farm

```python
import requests

response = requests.post('http://localhost:8000/api/v1/diseases/predict', json={
    "farm_id": 1,
    "disease_name": "Late Blight",
    "crop_type": "potato",
    "forecast_days": 7
})

data = response.json()
print(f"Risk Level: {data['prediction']['risk_level']}")
print(f"Risk Score: {data['prediction']['risk_score']}/100")
print(f"Action Needed: {data['prediction']['treatment_window']}")
```

### Example 2: Weekly Forecast for Tomato Diseases

```python
response = requests.get(
    'http://localhost:8000/api/v1/diseases/forecast/weekly/1',
    params={'disease_name': 'Septoria Leaf Spot'}
)

forecast = response.json()
print(f"Weekly Risk: {forecast['weekly_risk_level']}")
print(f"Peak Risk Day: {forecast['peak_risk_day']}")
print(f"Critical Days: {forecast['critical_action_days']}")
print(f"Strategy: {forecast['recommended_strategy']}")
```

### Example 3: Submit Field Observation

```python
response = requests.post('http://localhost:8000/api/v1/diseases/observations', json={
    "farm_id": 1,
    "disease_id": 1,
    "observation_date": "2026-01-03",
    "disease_present": True,
    "disease_severity": "moderate",
    "incidence_pct": 15.5,
    "symptoms_observed": "Water-soaked lesions on lower leaves with white fungal growth",
    "observer_name": "John Doe"
})
```

---

## 🔬 Research Sources & Validation

All disease models are based on peer-reviewed research:

1. **Late Blight Smith Period Model**
   - Source: Cornell University Vegetable MD Online
   - Validation: 40+ years of field use

2. **TOM-CAST (Septoria)**
   - Source: Ohio State University Extension
   - Accuracy: 85-90% in validation studies

3. **Powdery Mildew Models**
   - Source: Multiple university extension programs
   - Based on mechanistic understanding of pathogen biology

4. **Bacterial Spot**
   - Source: University of Florida IFAS
   - Environmental threshold research

---

## 🎓 Model Improvements Over CPN

| Feature | CPN Tool | Your System |
|---------|----------|-------------|
| Weather Sources | Limited | Multi-source (ERA5, NOAA, IBM, Local) |
| Forecast Horizon | Weekly | Daily + Weekly (1-14 days) |
| Disease Models | Generic | Pathogen-specific research models |
| Data Quality | Single source | Quality-weighted fusion |
| Leaf Wetness | Estimated | Measured + estimated with multiple methods |
| API Access | Limited | Full REST API |
| Customization | Fixed | Configurable thresholds & weights |
| Integration | Standalone | Fully integrated with farm management |

---

## 📊 Next Steps

### Immediate Actions:
1. Set up weather API keys
2. Run database migrations
3. Initialize disease catalog
4. Fetch historical weather data
5. Generate initial predictions

### Future Enhancements:
1. **Machine Learning Enhancement**: Train ML models on observations
2. **More Disease Models**: Add region-specific diseases
3. **Spray Recommendation Engine**: Optimize fungicide timing
4. **Economic Analysis**: Cost-benefit of treatments
5. **Mobile App Integration**: Push notifications for high-risk alerts
6. **Image Recognition**: Disease identification from photos
7. **Precision Agriculture**: Field-level risk mapping

---

## 🆘 Troubleshooting

### Issue: API Keys Not Working
- Verify keys in `.env` file
- Check API rate limits
- Test with fallback data first

### Issue: No Predictions Generated
- Ensure farms have valid coordinates
- Check weather data availability
- Verify disease catalog initialized

### Issue: Low Confidence Scores
- Improve weather data quality
- Add local weather stations
- Collect field observations for validation

---

## 📞 Support & Resources

- **Weather APIs**: See configuration section for registration
- **Disease Models**: Research papers available in `docs/research/`
- **Model Validation**: Submit observations via API for continuous improvement

---

**Implementation Date:** January 3, 2026  
**Version:** 1.0  
**Status:** ✅ Ready for Production

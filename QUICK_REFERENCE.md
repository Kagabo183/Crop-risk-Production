# 🚀 Disease Prediction Quick Reference

## Installation (5 Steps)

```bash
# 1. Install dependencies
pip install -r backend/requirements.txt

# 2. Run migrations
alembic -c backend/alembic.ini upgrade head

# 3. Initialize disease catalog
python -m scripts.generate_disease_predictions init

# 4. Fetch weather data
python -m scripts.fetch_enhanced_weather all --days 7

# 5. Generate predictions
python -m scripts.generate_disease_predictions all
```

## Essential Commands

### Weather Data
```bash
# All farms, last 7 days
python -m scripts.fetch_enhanced_weather all --days 7

# Specific farm, last 30 days
python -m scripts.fetch_enhanced_weather farm --farm-id 1 --days 30

# Get 7-day forecasts
python -m scripts.fetch_enhanced_weather forecasts --days 7

# Show summary
python -m scripts.fetch_enhanced_weather summary
```

### Disease Predictions
```bash
# All farms
python -m scripts.generate_disease_predictions all

# Specific farm
python -m scripts.generate_disease_predictions farm --farm-id 1

# 7-day forecast
python -m scripts.generate_disease_predictions forecast --farm-id 1

# Show summary
python -m scripts.generate_disease_predictions summary
```

## API Quick Start

### Predict Disease Risk
```bash
curl -X POST "http://localhost:8000/api/v1/diseases/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "farm_id": 1,
    "disease_name": "Late Blight",
    "crop_type": "potato",
    "forecast_days": 7
  }'
```

### Get Daily Forecast
```bash
curl "http://localhost:8000/api/v1/diseases/forecast/daily/1?disease_name=Late%20Blight&days=7"
```

### Get Weekly Summary
```bash
curl "http://localhost:8000/api/v1/diseases/forecast/weekly/1?disease_name=Late%20Blight"
```

### Submit Observation
```bash
curl -X POST "http://localhost:8000/api/v1/diseases/observations" \
  -H "Content-Type: application/json" \
  -d '{
    "farm_id": 1,
    "disease_present": true,
    "disease_severity": "moderate",
    "incidence_pct": 15.5,
    "observation_date": "2026-01-03"
  }'
```

## Environment Variables

```env
# Required Weather API Keys
ERA5_API_KEY=your_copernicus_key
NOAA_API_KEY=your_noaa_token
IBM_EIS_API_KEY=your_ibm_key
LOCAL_STATION_URL=http://your-station-api

# Disease Settings
DISEASE_FORECAST_DAYS=7
DISEASE_MODEL_VERSION=v1.0
ENABLE_DAILY_FORECASTS=true
ENABLE_WEEKLY_SUMMARIES=true
```

## Supported Diseases

| Disease | Crops | Model Source | Severity |
|---------|-------|--------------|----------|
| **Late Blight** | Potato, Tomato | Cornell (Smith Period) | Very High |
| **Septoria Leaf Spot** | Tomato | Ohio State (TOM-CAST) | High |
| **Powdery Mildew** | Wheat, Tomato, Cucumber | Environmental | Moderate |
| **Bacterial Spot** | Tomato, Pepper | Splash Dispersal | High |
| **Fusarium Wilt** | Tomato, Banana, Cotton | Soil Temperature | Very High |

## Risk Levels

| Score | Level | Action | Timeline |
|-------|-------|--------|----------|
| 0-39 | 🟢 Low | Monitor | Routine |
| 40-59 | 🟡 Moderate | Prepare | Within 3 days |
| 60-74 | 🟠 High | Act | Within 24h |
| 75-100 | 🔴 Severe | Act Now | Immediate |

## Key Thresholds

### Late Blight (Smith Period)
- Temperature: ≥10°C
- Humidity: ≥90%
- Leaf Wetness: ≥11 hours
- **Action**: Spray threshold met when all 3 conditions satisfied

### Septoria (TOM-CAST)
- Temperature: 15-27°C optimal
- Leaf Wetness: ≥6 hours
- DSV Accumulation: ≥15-20
- **Action**: Spray when accumulated DSV reaches 15-20

### Powdery Mildew
- Temperature: 15-22°C optimal
- Humidity: 50-70% (NOT very high)
- Rainfall: Suppresses disease
- **Action**: Monitor when temp + humidity in optimal range

### Bacterial Spot
- Temperature: 24-30°C optimal
- Rainfall + Wind: Splash dispersal
- Leaf Wetness: Extended periods
- **Action**: Act during warm, wet, windy periods

### Fusarium Wilt
- Soil Temperature: 27-32°C optimal
- Soil Moisture: Moderate (not saturated)
- **Action**: Prevention-focused (resistant varieties)

## Automation Setup (Celery)

Add to `app/tasks/celery_app.py`:

```python
from celery.schedules import crontab

app.conf.beat_schedule = {
    'fetch-weather': {
        'task': 'fetch_weather_task',
        'schedule': crontab(minute=0, hour='*/6'),  # Every 6 hours
    },
    'disease-predictions': {
        'task': 'disease_prediction_task',
        'schedule': crontab(minute=0, hour=6),  # Daily at 6 AM
    },
    'weather-forecasts': {
        'task': 'forecast_update_task',
        'schedule': crontab(minute=0, hour=0),  # Daily at midnight
    },
}
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/diseases/` | List all diseases |
| POST | `/api/v1/diseases/` | Create disease |
| GET | `/api/v1/diseases/{id}` | Get disease details |
| POST | `/api/v1/diseases/predict` | Generate prediction |
| GET | `/api/v1/diseases/predictions/farm/{id}` | Farm predictions |
| GET | `/api/v1/diseases/forecast/daily/{id}` | Daily forecast |
| GET | `/api/v1/diseases/forecast/weekly/{id}` | Weekly summary |
| POST | `/api/v1/diseases/observations` | Submit observation |
| GET | `/api/v1/diseases/observations/farm/{id}` | Farm observations |
| GET | `/api/v1/diseases/statistics/{id}` | Disease statistics |

## Weather API Registration

### ERA5 (ECMWF)
1. Visit: https://cds.climate.copernicus.eu/
2. Create account
3. Get API key from profile
4. Add to `.env` as `ERA5_API_KEY`

### NOAA CDO
1. Visit: https://www.ncdc.noaa.gov/cdo-web/token
2. Request token
3. Add to `.env` as `NOAA_API_KEY`

### IBM EIS
1. Visit: https://www.ibm.com/products/environmental-intelligence-suite
2. Contact sales for API access
3. Add to `.env` as `IBM_EIS_API_KEY`

## Troubleshooting

### No predictions generated
```bash
# Check disease catalog
python -m scripts.generate_disease_predictions summary

# If empty, initialize
python -m scripts.generate_disease_predictions init
```

### Weather data missing
```bash
# Check weather records
python -m scripts.fetch_enhanced_weather summary

# Fetch data
python -m scripts.fetch_enhanced_weather all --days 7
```

### API errors
```bash
# Check logs
tail -f logs/app.log

# Test database connection
python -c "from app.db.database import SessionLocal; db=SessionLocal(); print('DB OK')"

# Check API docs
# Visit: http://localhost:8000/docs
```

### Low confidence scores
- Add more weather sources
- Configure local weather stations
- Collect field observations
- Validate with ground truth

## Documentation

- **Complete Guide**: [DISEASE_PREDICTION_GUIDE.md](DISEASE_PREDICTION_GUIDE.md)
- **Quick Start**: [DISEASE_FEATURES_README.md](DISEASE_FEATURES_README.md)
- **Summary**: [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
- **Architecture**: [ARCHITECTURE_DIAGRAM.md](ARCHITECTURE_DIAGRAM.md)
- **API Docs**: http://localhost:8000/docs

## Python Integration Example

```python
from app.services.disease_intelligence import DiseaseModelEngine
from app.services.weather_service import WeatherDataIntegrator

# Get weather data
weather = WeatherDataIntegrator()
data = weather.integrate_multi_source_data(
    lat=-1.9403,
    lon=29.8739,
    start_date=datetime.now(),
    end_date=datetime.now()
)

# Predict late blight
engine = DiseaseModelEngine()
prediction = engine.predict_late_blight(data, crop_type="potato")

print(f"Risk Score: {prediction['risk_score']}/100")
print(f"Risk Level: {prediction['risk_level']}")
print(f"Actions: {prediction['recommended_actions']}")
```

## Status Check

```bash
# System health
curl http://localhost:8000/health

# API documentation
curl http://localhost:8000/openapi.json

# Disease catalog
curl http://localhost:8000/api/v1/diseases/

# Farm predictions
curl http://localhost:8000/api/v1/diseases/predictions/farm/1
```

## Next Steps

1. ✅ Install dependencies
2. ✅ Configure API keys
3. ✅ Run migrations
4. ✅ Initialize diseases
5. ✅ Fetch weather data
6. ✅ Generate predictions
7. ✅ Set up automation
8. ✅ Test API endpoints
9. ✅ Monitor accuracy
10. ✅ Collect observations

---

**Version**: 2.0  
**Status**: Production Ready  
**Last Updated**: January 3, 2026

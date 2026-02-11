# API Reference

Complete API documentation for the Crop Risk Prediction Platform.

**Base URL**: `http://localhost:8000/api/v1`

**Interactive Docs**: `http://localhost:8000/docs` (Swagger UI)

---

## Table of Contents

- [Authentication](#authentication)
- [Farms API](#farms-api)
- [Stress Monitoring API](#stress-monitoring-api)
- [Satellite API](#satellite-api)
- [Disease API](#disease-api)
- [Weather API](#weather-api)
- [Alerts API](#alerts-api)
- [Machine Learning API](#machine-learning-api)
- [Error Handling](#error-handling)

---

## Authentication

All endpoints (except `/health`) require JWT Bearer token authentication.

### Login

```http
POST /api/v1/auth/login
Content-Type: application/x-www-form-urlencoded

username=user@example.com&password=yourpassword
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

### Using the Token

Include the token in all subsequent requests:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Farms API

### List All Farms

```http
GET /api/v1/farms
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Kigali Farm",
    "location": "Kigali, Rwanda",
    "area": 25.5,
    "latitude": -1.9403,
    "longitude": 29.8739,
    "crop_type": "potato",
    "created_at": "2026-01-15T10:30:00Z"
  }
]
```

### Get Single Farm

```http
GET /api/v1/farms/{farm_id}
```

**Response:**
```json
{
  "id": 1,
  "name": "Kigali Farm",
  "location": "Kigali, Rwanda",
  "area": 25.5,
  "latitude": -1.9403,
  "longitude": 29.8739,
  "crop_type": "potato",
  "boundary": null,
  "created_at": "2026-01-15T10:30:00Z",
  "updated_at": "2026-02-01T14:20:00Z"
}
```

### Create Farm

```http
POST /api/v1/farms
Content-Type: application/json

{
  "name": "New Farm",
  "location": "Musanze, Rwanda",
  "area": 15.0,
  "latitude": -1.4994,
  "longitude": 29.6350,
  "crop_type": "tomato"
}
```

**Response:** `201 Created`
```json
{
  "id": 2,
  "name": "New Farm",
  "location": "Musanze, Rwanda",
  "area": 15.0,
  "latitude": -1.4994,
  "longitude": 29.6350,
  "crop_type": "tomato",
  "created_at": "2026-02-10T08:00:00Z"
}
```

### Update Farm

```http
PUT /api/v1/farms/{farm_id}
Content-Type: application/json

{
  "name": "Updated Farm Name",
  "area": 20.0
}
```

### Delete Farm

```http
DELETE /api/v1/farms/{farm_id}
```

**Response:** `204 No Content`

---

## Stress Monitoring API

### Get Vegetation Health Timeseries

Returns vegetation health data over time for a farm.

```http
GET /api/v1/stress-monitoring/health/{farm_id}?days_back=90
```

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| farm_id | int | Yes | - | Farm ID |
| days_back | int | No | 90 | Number of days to retrieve |

**Response:**
```json
[
  {
    "date": "2026-02-10",
    "ndvi": 0.72,
    "ndwi": 0.45,
    "evi": 0.68,
    "health_score": 78.5,
    "stress_level": "low",
    "stress_type": null
  },
  {
    "date": "2026-02-09",
    "ndvi": 0.70,
    "ndwi": 0.43,
    "evi": 0.66,
    "health_score": 76.0,
    "stress_level": "low",
    "stress_type": null
  }
]
```

### Get Stress Assessment

Returns current comprehensive stress assessment.

```http
GET /api/v1/stress-monitoring/stress-assessment/{farm_id}
```

**Response:**
```json
{
  "health_score": 78.5,
  "stress_score": 21.5,
  "stress_level": "low",
  "primary_stress": "none",
  "message": "Farm vegetation is healthy with no significant stress detected.",
  "stress_breakdown": {
    "drought": 15,
    "water": 10,
    "heat": 8,
    "nutrient": 12
  }
}
```

**Stress Levels:**
| Score Range | Level | Description |
|-------------|-------|-------------|
| 0-25 | low | Healthy vegetation |
| 26-50 | moderate | Some stress detected |
| 51-75 | high | Significant stress |
| 76-100 | severe | Critical condition |

### Get Drought Assessment

```http
GET /api/v1/stress-monitoring/drought-assessment/{farm_id}?days_back=30
```

**Response:**
```json
{
  "drought_score": 25,
  "severity": "low",
  "ndvi_trend": "stable",
  "rainfall_deficit_mm": 12.5,
  "days_without_rain": 5,
  "recommendation": "Continue normal irrigation schedule."
}
```

### Get Water Stress Assessment

```http
GET /api/v1/stress-monitoring/water-stress/{farm_id}?days_back=14
```

**Response:**
```json
{
  "water_stress_score": 18,
  "severity": "low",
  "ndwi_average": 0.42,
  "ndwi_trend": "stable",
  "recent_rainfall_mm": 35.2,
  "recommendation": "Adequate water content detected."
}
```

### Get Heat Stress Assessment

```http
GET /api/v1/stress-monitoring/heat-stress/{farm_id}?days_back=14
```

**Response:**
```json
{
  "heat_stress_score": 12,
  "severity": "low",
  "max_temperature": 28.5,
  "avg_temperature": 24.2,
  "heat_wave_days": 0,
  "recommendation": "No heat stress detected."
}
```

### Get Nutrient Assessment

```http
GET /api/v1/stress-monitoring/nutrient-assessment/{farm_id}?days_back=30
```

**Response:**
```json
{
  "nutrient_score": 22,
  "severity": "low",
  "ndre_average": 0.38,
  "chlorophyll_status": "normal",
  "recommendation": "Nutrient levels appear adequate."
}
```

### Trigger Satellite Download

Manually trigger satellite data fetch for a farm.

```http
POST /api/v1/stress-monitoring/trigger-download
Content-Type: application/json

{
  "farm_id": 1,
  "days_back": 30
}
```

**Response:**
```json
{
  "task_id": "abc123-def456",
  "status": "processing",
  "farm_id": 1,
  "message": "Satellite data download initiated for farm 1"
}
```

### Get Stress Zones (GeoJSON)

```http
GET /api/v1/stress-monitoring/stress-zones/{farm_id}
```

**Response:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [29.8739, -1.9403]
      },
      "properties": {
        "farm_id": 1,
        "farm_name": "Kigali Farm",
        "stress_level": "low",
        "health_score": 78.5,
        "primary_stress": "none",
        "message": "Farm is in good health"
      }
    }
  ]
}
```

---

## Satellite API

### Get All Farms with Satellite Data

```http
GET /api/v1/farm-satellite/
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Kigali Farm",
    "location": "Kigali, Rwanda",
    "area": 25.5,
    "latitude": -1.9403,
    "longitude": 29.8739,
    "ndvi": 0.7234,
    "ndvi_date": "2026-02-08",
    "image_type": "NDVI",
    "ndvi_status": "healthy",
    "data_source": "real",
    "tile": "36MXE",
    "cloud_cover": 12.5
  }
]
```

**NDVI Status Mapping:**
| NDVI Range | Status |
|------------|--------|
| >= 0.6 | healthy |
| 0.3 - 0.6 | moderate |
| < 0.3 | stressed |

### Get NDVI History

```http
GET /api/v1/farm-satellite/history/{farm_id}?limit=30
```

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| farm_id | int | Yes | - | Farm ID |
| limit | int | No | 30 | Max records to return |

**Response:**
```json
[
  {
    "date": "2026-02-08",
    "ndvi": 0.7234,
    "image_type": "NDVI",
    "cloud_coverage": 12.5
  },
  {
    "date": "2026-02-05",
    "ndvi": 0.7156,
    "image_type": "NDVI",
    "cloud_coverage": 8.2
  }
]
```

### Recompute Farm Satellite Data

```http
POST /api/v1/farm-satellite/recompute/{farm_id}
```

**Response:**
```json
{
  "status": "completed",
  "farm_id": 1,
  "tiles_processed": [
    {"tile": "36MXE", "records_affected": 5}
  ],
  "total_records_affected": 5
}
```

---

## Disease API

### List All Diseases

```http
GET /api/v1/diseases/
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Late Blight",
    "scientific_name": "Phytophthora infestans",
    "affected_crops": ["potato", "tomato"],
    "model_type": "smith_period",
    "description": "Fungal disease causing rapid crop destruction"
  },
  {
    "id": 2,
    "name": "Septoria Leaf Spot",
    "scientific_name": "Septoria lycopersici",
    "affected_crops": ["tomato"],
    "model_type": "tom_cast",
    "description": "Fungal disease affecting tomato leaves"
  }
]
```

### Generate Disease Prediction

```http
POST /api/v1/diseases/predict
Content-Type: application/json

{
  "farm_id": 1,
  "disease_name": "Late Blight",
  "crop_type": "potato",
  "forecast_days": 7
}
```

**Response:**
```json
{
  "farm_id": 1,
  "disease_name": "Late Blight",
  "prediction_date": "2026-02-10",
  "risk_score": 65.5,
  "risk_level": "high",
  "infection_probability": 0.72,
  "days_to_symptom_onset": 4,
  "confidence_score": 85.0,
  "weather_conditions": {
    "temperature": 18.5,
    "humidity": 92.0,
    "rainfall": 15.2,
    "leaf_wetness_hours": 14
  },
  "recommended_actions": [
    "Apply protective fungicide within 24 hours",
    "Scout for early symptoms",
    "Ensure good air circulation"
  ],
  "treatment_window": "immediate",
  "estimated_yield_loss_pct": 32.75
}
```

### Get Weekly Forecast

```http
GET /api/v1/diseases/forecast/weekly/{farm_id}?disease_name=Late%20Blight
```

**Response:**
```json
{
  "farm_id": 1,
  "disease_name": "Late Blight",
  "forecast_period": {
    "start": "2026-02-10",
    "end": "2026-02-17"
  },
  "daily_forecasts": [
    {
      "date": "2026-02-10",
      "risk_score": 65,
      "risk_level": "high",
      "conditions": "favorable"
    },
    {
      "date": "2026-02-11",
      "risk_score": 72,
      "risk_level": "high",
      "conditions": "highly favorable"
    }
  ],
  "peak_risk_day": "2026-02-12",
  "weekly_strategy": "Apply preventive fungicide. Monitor closely.",
  "critical_action_days": ["2026-02-10", "2026-02-11"]
}
```

---

## Weather API

### Get Current Weather

```http
GET /api/v1/weather/current/{farm_id}
```

**Response:**
```json
{
  "farm_id": 1,
  "timestamp": "2026-02-10T14:30:00Z",
  "temperature": 22.5,
  "humidity": 78,
  "rainfall": 0,
  "wind_speed": 8.2,
  "pressure": 1015.3,
  "dewpoint": 18.2,
  "conditions": "partly_cloudy",
  "disease_risk_factors": {
    "fungal_risk": 45.2,
    "bacterial_risk": 32.1,
    "late_blight_risk": 38.5,
    "leaf_wetness_hours": 6
  }
}
```

### Get Weather Forecast

```http
GET /api/v1/weather/forecast/{farm_id}?days=7
```

**Response:**
```json
{
  "farm_id": 1,
  "forecast_days": 7,
  "daily": [
    {
      "date": "2026-02-10",
      "temp_max": 26.5,
      "temp_min": 18.2,
      "precipitation_probability": 40,
      "precipitation_sum": 5.2,
      "weather_code": "cloudy",
      "sunrise": "06:15",
      "sunset": "18:32"
    }
  ],
  "disease_outlook": {
    "high_risk_days": 2,
    "favorable_spray_days": 3
  }
}
```

---

## Alerts API

### List Alerts

```http
GET /api/v1/alerts/?farm_id=1&level=high
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| farm_id | int | No | Filter by farm |
| level | string | No | Filter by level (low, moderate, high, severe) |

**Response:**
```json
[
  {
    "id": 1,
    "farm_id": 1,
    "message": "[WEATHER] High Late Blight risk (72%). Conditions: 18.5°C, 92% humidity",
    "level": "high",
    "created_at": "2026-02-10T06:00:00Z"
  },
  {
    "id": 2,
    "farm_id": 1,
    "message": "[DISEASE] Septoria risk elevated. Monitor tomato crops.",
    "level": "moderate",
    "created_at": "2026-02-10T06:00:00Z"
  }
]
```

### Mark Alert as Read

```http
PUT /api/v1/alerts/{alert_id}/read
```

**Response:** `200 OK`

---

## Error Handling

### Error Response Format

```json
{
  "detail": "Error message describing what went wrong"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (successful delete) |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Invalid/missing token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 422 | Validation Error - Invalid data format |
| 500 | Internal Server Error |

### Common Errors

**Farm not found:**
```json
{
  "detail": "Farm not found"
}
```

**Missing coordinates:**
```json
{
  "detail": "Farm has no coordinates"
}
```

**Invalid token:**
```json
{
  "detail": "Could not validate credentials"
}
```

---

## Rate Limiting

Currently no rate limiting is enforced. For production deployments, consider implementing rate limiting at the reverse proxy level (nginx, CloudFlare, etc.).

---

## Machine Learning API

### Disease Classification

Classify plant disease from leaf images using CNN.

```http
POST /api/v1/ml/classify-disease?crop_type=potato
Content-Type: multipart/form-data

file: [leaf_image.jpg]
```

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| file | file | Yes | - | Leaf image (JPG, PNG) |
| crop_type | string | No | potato | Crop type: potato, tomato, maize |

**Response:**
```json
{
  "disease": "Late_Blight",
  "confidence": 0.92,
  "is_healthy": false,
  "probabilities": {
    "Late_Blight": 0.92,
    "Early_Blight": 0.05,
    "Healthy": 0.03
  },
  "treatment": {
    "fungicides": ["Mancozeb", "Chlorothalonil", "Copper-based fungicides"],
    "cultural": ["Remove infected plants", "Improve air circulation"],
    "urgency": "high",
    "spread_risk": "very_high"
  },
  "crop_type": "potato"
}
```

### Get Supported Diseases

```http
GET /api/v1/ml/supported-diseases
```

**Response:**
```json
{
  "crops": ["potato", "tomato", "maize"],
  "diseases_by_crop": {
    "potato": ["Early_Blight", "Late_Blight", "Healthy"],
    "tomato": ["Bacterial_Spot", "Early_Blight", "Late_Blight", "Septoria_Leaf_Spot", "Healthy"],
    "maize": ["Common_Rust", "Gray_Leaf_Spot", "Northern_Leaf_Blight", "Healthy"]
  }
}
```

### Risk Assessment

Calculate comprehensive risk using ML ensemble + research algorithms.

```http
POST /api/v1/ml/risk-assessment
Content-Type: application/json

{
  "farm_id": 1,
  "include_forecast": true,
  "forecast_days": 7
}
```

**Response:**
```json
{
  "farm_id": 1,
  "overall_risk_score": 65.5,
  "risk_level": "high",
  "confidence": 0.85,
  "components": {
    "disease_risk": 72.0,
    "vegetation_anomaly": 45.0,
    "weather_stress": 68.0,
    "yield_forecast": 55.0,
    "trend_forecast": 40.0
  },
  "primary_driver": "disease_risk",
  "recommendations": [
    "Apply preventive fungicide (Mancozeb or Copper-based)",
    "Scout for early disease symptoms",
    "Increase monitoring frequency to daily"
  ],
  "timestamp": "2026-02-10T08:00:00Z"
}
```

### Yield Prediction

Predict crop yield using XGBoost model.

```http
POST /api/v1/ml/predict-yield
Content-Type: application/json

{
  "farm_id": 1,
  "crop_type": "potato"
}
```

**Response:**
```json
{
  "farm_id": 1,
  "predicted_yield_tons_ha": 15.8,
  "lower_bound": 12.5,
  "upper_bound": 19.2,
  "confidence": 0.85,
  "yield_class": "good",
  "recommendations": ["Continue regular monitoring"]
}
```

**Yield Classes:**
| Class | Description |
|-------|-------------|
| excellent | Above high benchmark |
| good | At or above average |
| below_average | Below average |
| poor | Below low benchmark |

### Anomaly Detection

Detect vegetation anomalies using Isolation Forest.

```http
POST /api/v1/ml/detect-anomalies
Content-Type: application/json

{
  "farm_id": 1,
  "days_back": 30
}
```

**Response:**
```json
{
  "farm_id": 1,
  "total_records": 30,
  "anomalies_detected": 3,
  "anomaly_rate": 0.1,
  "results": [
    {
      "date": "2026-02-08",
      "is_anomaly": true,
      "anomaly_score": 0.75,
      "anomaly_type": "rapid_decline",
      "severity": "moderate",
      "recommendations": ["Immediate field inspection recommended"]
    }
  ]
}
```

**Anomaly Types:**
| Type | Description |
|------|-------------|
| rapid_decline | Fast NDVI drop (possible disease/pest) |
| water_stress | Low NDWI with declining NDVI |
| drought_stress | Prolonged low vegetation values |
| unusual_growth | Higher than expected NDVI |
| vegetation_stress | General stress pattern |

### Health Trend Forecast

Forecast vegetation health using Prophet time-series model.

```http
POST /api/v1/ml/forecast-health
Content-Type: application/json

{
  "farm_id": 1,
  "forecast_days": 14,
  "include_scenarios": true
}
```

**Response:**
```json
{
  "farm_id": 1,
  "forecast": {
    "forecast_days": 14,
    "predictions": [
      {
        "date": "2026-02-11",
        "health_score": 72.5,
        "lower_bound": 65.0,
        "upper_bound": 80.0,
        "trend": 68.2
      }
    ],
    "alerts": [
      {
        "date": "2026-02-15",
        "type": "warning",
        "message": "Below-average health predicted (55)",
        "action": "Monitor closely and prepare interventions"
      }
    ],
    "trend_direction": "declining",
    "average_forecast": 68.5
  },
  "scenarios": {
    "drought": {"average": 52.3},
    "normal": {"average": 68.5},
    "wet": {"average": 73.8}
  }
}
```

### Risk Explanation

Get detailed explanation of risk factors with SHAP-like analysis.

```http
GET /api/v1/ml/explain-risk/{farm_id}
```

**Response:**
```json
{
  "farm_id": 1,
  "risk_score": 65.5,
  "risk_level": "high",
  "explanation": "Risk driven mainly by vegetation decline (45%) and rainfall deficit (30%)",
  "contributions": {
    "ndvi_trend": 45.2,
    "rainfall_deficit": 30.1,
    "ndvi_anomaly": 15.5,
    "heat_stress_days": 9.2
  },
  "top_drivers": [
    {"factor": "ndvi_trend", "contribution": 45.2},
    {"factor": "rainfall_deficit", "contribution": 30.1}
  ],
  "time_to_impact": "7-14 days",
  "recommendations": [
    {"urgency": "Short-term", "action": "Conduct pest/disease inspection", "priority": "High"}
  ],
  "scenarios": {
    "irrigation": {
      "new_risk": 42.5,
      "risk_reduction": 23.0,
      "description": "Irrigation support"
    }
  }
}
```

### Model Status

Check health status of ML models.

```http
GET /api/v1/ml/models/status
```

**Response:**
```json
{
  "overall": "healthy",
  "models": {
    "disease_classifier": {"loaded": true, "status": "ready"},
    "anomaly_detector": {"loaded": true, "status": "ready"},
    "yield_predictor": {"loaded": true, "status": "ready"},
    "trend_forecaster": {"loaded": false, "status": "available"},
    "ensemble_scorer": {"loaded": true, "status": "ready"}
  },
  "timestamp": "2026-02-10T08:00:00Z"
}
```

### List Models

```http
GET /api/v1/ml/models/list
```

**Response:**
```json
{
  "available_models": [
    {"type": "disease_classifier", "description": "CNN-based plant disease classification", "loaded": true},
    {"type": "anomaly_detector", "description": "Isolation Forest for vegetation anomaly detection", "loaded": true},
    {"type": "yield_predictor", "description": "XGBoost-based crop yield prediction", "loaded": true},
    {"type": "trend_forecaster", "description": "Prophet-based health trend forecasting", "loaded": false},
    {"type": "ensemble_scorer", "description": "Ensemble risk assessment combining all models", "loaded": true}
  ],
  "saved_models": [
    {"file": "disease_classifier_potato.pth", "size_mb": 25.3},
    {"file": "anomaly_detector.pkl", "size_mb": 1.2}
  ]
}
```

---

## Webhooks (Coming Soon)

Future versions will support webhooks for:
- High-risk disease alerts
- Extreme weather notifications
- Satellite data availability

---

**Version**: 2.2.0
**Last Updated**: February 2026

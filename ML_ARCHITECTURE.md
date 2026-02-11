# Machine Learning Architecture

Complete ML system for crop risk prediction combining deep learning with research-validated algorithms.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ML Architecture Overview                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   Disease    │    │    NDVI      │    │    Yield     │          │
│  │  Classifier  │    │   Anomaly    │    │  Predictor   │          │
│  │    (CNN)     │    │  Detector    │    │  (XGBoost)   │          │
│  │  PlantVillage│    │ (IsoForest)  │    │              │          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                   │                   │                   │
│  ┌──────┴───────┐    ┌──────┴───────┐    ┌──────┴───────┐          │
│  │   Health     │    │  Research    │    │   Weather    │          │
│  │    Trend     │    │  Algorithms  │    │    Stress    │          │
│  │  Forecaster  │    │ Smith/TOMCAST│    │   Analysis   │          │
│  │  (Prophet)   │    │              │    │              │          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                   │                   │                   │
│         └───────────────────┼───────────────────┘                   │
│                             ▼                                       │
│                 ┌───────────────────────┐                          │
│                 │   Ensemble Risk       │                          │
│                 │      Scorer           │                          │
│                 │  (Weighted Ensemble)  │                          │
│                 └───────────┬───────────┘                          │
│                             │                                       │
│                             ▼                                       │
│                 ┌───────────────────────┐                          │
│                 │   Risk Intelligence   │                          │
│                 │   - Explainability    │                          │
│                 │   - Recommendations   │                          │
│                 │   - Impact Analysis   │                          │
│                 └───────────────────────┘                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ML Models

### 1. Disease Image Classifier (CNN)

**Location:** `backend/app/ml/disease_classifier.py`

**Architecture:** EfficientNet-B0 with transfer learning

**Training Data:** PlantVillage dataset (publicly available)

**Supported Crops & Diseases:**

| Crop | Diseases |
|------|----------|
| Potato | Early Blight, Late Blight, Healthy |
| Tomato | Early Blight, Late Blight, Septoria, Bacterial Spot, Leaf Mold, Spider Mites, Target Spot, Yellow Leaf Curl Virus, Mosaic Virus, Healthy |
| Maize | Common Rust, Gray Leaf Spot, Northern Leaf Blight, Healthy |

**Usage:**
```python
from app.ml import DiseaseClassifier

classifier = DiseaseClassifier(crop_type='potato')
result = classifier.predict('path/to/leaf_image.jpg')

# Result includes:
# - disease name
# - confidence score
# - treatment recommendations
# - probabilities for all classes
```

---

### 2. NDVI Anomaly Detector (Isolation Forest)

**Location:** `backend/app/ml/anomaly_detector.py`

**Algorithm:** Isolation Forest from scikit-learn

**Features Used:**
- NDVI value and deviation from historical mean
- NDWI (water content indicator)
- EVI (enhanced vegetation index)
- Rate of change (velocity)
- 7-day rolling statistics
- Seasonal adjustment factor

**Anomaly Types Detected:**
| Type | Description |
|------|-------------|
| `rapid_decline` | Fast NDVI drop - possible disease/pest |
| `water_stress` | Low NDWI with declining NDVI |
| `drought_stress` | Prolonged low vegetation values |
| `unusual_growth` | Higher than expected growth |
| `vegetation_stress` | General stress pattern |

**Usage:**
```python
from app.ml import NDVIAnomalyDetector

detector = NDVIAnomalyDetector(contamination=0.1)
detector.fit(historical_data)
results = detector.detect(current_data)
```

---

### 3. Yield Predictor (XGBoost)

**Location:** `backend/app/ml/yield_predictor.py`

**Algorithm:** XGBoost Regressor

**Features:**
- Vegetation indices (NDVI mean, max, trend, EVI, NDWI)
- Weather conditions (temperature, rainfall, humidity)
- Growing degree days (GDD)
- Farm characteristics (area, elevation)
- Historical yield data

**Crop Benchmarks (tons/hectare for Rwanda):**
| Crop | Low | Average | High | Potential |
|------|-----|---------|------|-----------|
| Potato | 5.0 | 12.0 | 20.0 | 25.0 |
| Tomato | 8.0 | 25.0 | 40.0 | 60.0 |
| Maize | 1.0 | 2.5 | 4.0 | 6.0 |

**Usage:**
```python
from app.ml import YieldPredictor

predictor = YieldPredictor(crop_type='potato')
result = predictor.predict(farm_data)

# Returns predicted yield with confidence intervals
```

---

### 4. Health Trend Forecaster (Prophet)

**Location:** `backend/app/ml/trend_forecaster.py`

**Algorithm:** Facebook Prophet with custom seasonality

**Features:**
- Time-series health scores
- Rwanda bimodal seasonality (Long rains: Mar-May, Short rains: Sept-Nov)
- Weather regressors (optional)
- Confidence intervals (95%)

**Usage:**
```python
from app.ml import HealthTrendForecaster

forecaster = HealthTrendForecaster(forecast_days=14)
forecaster.train(historical_data)
forecast = forecaster.forecast(days=7)

# Returns predictions with confidence intervals and alerts
```

---

### 5. Ensemble Risk Scorer

**Location:** `backend/app/ml/ensemble_scorer.py`

**Architecture:** Weighted ensemble combining:

| Component | Weight | Source |
|-----------|--------|--------|
| Disease Risk | 30% | Research-validated models |
| Vegetation Anomaly | 25% | Isolation Forest ML |
| Weather Stress | 20% | Threshold-based analysis |
| Yield Forecast | 15% | XGBoost prediction |
| Trend Forecast | 10% | Prophet time-series |

**Research-Validated Disease Models:**

1. **Smith Period Model (Cornell University)**
   - For Late Blight (Phytophthora infestans)
   - Triggers when: 10-25°C temp + >90% humidity for 11+ hours

2. **TOM-CAST DSV (Ohio State University)**
   - For Septoria leaf spot
   - Disease Severity Value based on temperature + leaf wetness

3. **SIMCAST**
   - For Early Blight (Alternaria solani)
   - Based on temperature and moisture patterns

**Usage:**
```python
from app.ml import EnsembleRiskScorer

scorer = EnsembleRiskScorer()
risk = scorer.calculate_risk(farm_data)

# Returns overall risk score, level, components, and recommendations
```

---

## API Endpoints

All ML endpoints are under `/api/v1/ml/`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/classify-disease` | POST | Classify disease from image |
| `/supported-diseases` | GET | List supported diseases |
| `/risk-assessment` | POST | Calculate comprehensive risk |
| `/risk-assessment/{farm_id}` | GET | Get risk for specific farm |
| `/predict-yield` | POST | Predict crop yield |
| `/detect-anomalies` | POST | Detect vegetation anomalies |
| `/forecast-health` | POST | Forecast health trends |
| `/explain-risk/{farm_id}` | GET | Detailed risk explanation |
| `/models/status` | GET | Check model health |
| `/models/list` | GET | List all models |
| `/models/load-all` | POST | Load all models |

---

## Celery Tasks

Automated ML tasks in `backend/app/tasks/ml_tasks.py`:

| Task | Schedule | Description |
|------|----------|-------------|
| `ml.batch_risk_assessment` | Daily 06:30 UTC | Risk for all farms |
| `ml.detect_anomalies_all_farms` | Daily 05:00 UTC | Anomaly detection |
| `ml.generate_health_forecasts` | Daily 07:00 UTC | Health forecasts |
| `ml.model_health_check` | Every 6 hours | Model health check |
| `ml.retrain_all_models` | Weekly Sunday 1 AM | Full model retraining |

---

## Model Registry

Centralized model management in `backend/app/ml/model_registry.py`:

```python
from app.ml import get_registry

registry = get_registry()

# Check health
health = registry.health_check()

# Load all models
results = registry.load_all_models()

# Get model info
info = registry.get_model_info('disease_classifier')
```

---

## Training Data Sources

| Model | Data Source | Size | Notes |
|-------|-------------|------|-------|
| Disease Classifier | PlantVillage | 54K+ images | Public dataset |
| Anomaly Detector | Farm satellite data | 90 days | Auto-collected |
| Yield Predictor | Historical + synthetic | Per farm | Requires historical yields |
| Health Forecaster | Satellite time-series | 30+ days | Per farm |

### PlantVillage Dataset

The PlantVillage dataset is the primary training data for the disease classifier.

**Sources:**
- **Kaggle:** https://www.kaggle.com/datasets/emmarex/plantdisease
- **GitHub:** https://github.com/spMohanty/PlantVillage-Dataset
- **Original:** https://plantvillage.psu.edu/

**Dataset Structure:**
```
PlantVillage/
├── Potato___Early_blight/          (~1,000 images)
├── Potato___Late_blight/           (~1,000 images)
├── Potato___healthy/               (~500 images)
├── Tomato___Bacterial_spot/        (~2,000 images)
├── Tomato___Early_blight/          (~1,000 images)
├── Tomato___Late_blight/           (~1,900 images)
├── Tomato___Septoria_leaf_spot/    (~1,700 images)
├── Tomato___healthy/               (~1,500 images)
├── Corn_(maize)___Common_rust/     (~1,200 images)
├── Corn_(maize)___healthy/         (~1,100 images)
└── ... (more crops)
```

**Download Scripts:**

```bash
cd backend

# Option 1: Download from GitHub (free, no API key needed)
python -m app.scripts.download_plantvillage download

# Option 2: Download from Kaggle (requires API setup)
python -m app.scripts.download_plantvillage download --source kaggle

# Train models after download
python -m app.scripts.download_plantvillage train --all --epochs 10
```

**Pre-trained Models:**

```bash
# Download ImageNet pre-trained models (fastest option)
python -m app.scripts.download_pretrained --all

# List available models
python -m app.scripts.download_pretrained list

# Verify models work
python -m app.scripts.download_pretrained verify
```

### Training Parameters

| Parameter | Disease Classifier | Yield Predictor | Health Forecaster |
|-----------|-------------------|-----------------|-------------------|
| Architecture | EfficientNet-B0 | XGBoost | Prophet |
| Input Size | 224x224 RGB | 18 features | Time-series |
| Batch Size | 32 | N/A | N/A |
| Learning Rate | 0.001 | 0.1 | Auto |
| Epochs | 10-20 | 100 estimators | N/A |
| Train/Val Split | 80/20 | 80/20 | N/A |

---

## Dependencies

Required packages (in `requirements.txt`):

```bash
# Deep Learning (Disease Classification)
torch>=2.0.0
torchvision>=0.15.0
Pillow>=10.0.0

# Time Series Forecasting (Health Trends)
prophet>=1.1.4

# ML Core
scikit-learn>=1.3.2
xgboost>=2.0.2
lightgbm>=4.1.0
numpy>=1.24.3
pandas>=2.0.3
joblib>=1.3.2

# Model Downloads (optional)
huggingface-hub>=0.20.0
kaggle>=1.5.0
```

**GPU Support (optional):**
```bash
# For CUDA GPU acceleration
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

---

## Model Files

Models are stored in `/app/data/models/`:

| File | Model | Size (approx) |
|------|-------|---------------|
| `disease_classifier_potato.pth` | Disease CNN | 25 MB |
| `disease_classifier_tomato.pth` | Disease CNN | 25 MB |
| `disease_classifier_maize.pth` | Disease CNN | 25 MB |
| `ndvi_anomaly_detector.pkl` | Anomaly | 1 MB |
| `yield_predictor_potato.pkl` | Yield | 2 MB |
| `health_forecaster.pkl` | Forecast | 5 MB |

---

## Performance Metrics

Target metrics for each model:

| Model | Metric | Target |
|-------|--------|--------|
| Disease Classifier | Accuracy | > 90% |
| Disease Classifier | F1 Score | > 0.85 |
| Anomaly Detector | Precision | > 80% |
| Yield Predictor | R² Score | > 0.75 |
| Yield Predictor | RMSE | < 3 t/ha |
| Health Forecaster | MAPE | < 15% |

---

## Version

**ML System Version:** 1.0.0
**Last Updated:** February 2026

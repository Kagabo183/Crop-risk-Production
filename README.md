# 🌾 Crop Risk Prediction Platform

> **Precision agriculture platform for Rwanda** — satellite-fused crop monitoring, AI-driven disease prediction, and variable-rate field management.

![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green?logo=fastapi)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)
![GEE](https://img.shields.io/badge/Google%20Earth%20Engine-enabled-4CAF50?logo=google)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Architecture](#2-architecture)
3. [Quick Start with Docker](#3-quick-start-with-docker)
4. [Frontend User Guide](#4-frontend-user-guide)
   - [Roles & Access](#roles--access)
   - [Login & Registration](#login--registration)
   - [Dashboard](#dashboard)
   - [Farms Management](#farms-management)
   - [Satellite Map](#satellite-map)
   - [Satellite Data](#satellite-data)
   - [Stress Monitoring](#stress-monitoring)
   - [Risk Assessment](#risk-assessment)
   - [Disease Forecasts](#disease-forecasts)
   - [Disease Classifier](#disease-classifier)
   - [Early Warning Alerts](#early-warning-alerts)
   - [Season Manager](#season-manager)
   - [VRA Maps](#vra-maps)
   - [Yield Analysis](#yield-analysis)
   - [ML Models](#ml-models)
   - [Admin Panel](#admin-panel)
   - [Profile](#profile)
5. [Auto Crop Risk Pipeline](#5-auto-crop-risk-pipeline)
6. [Satellite Fusion & Phenology AI](#6-satellite-fusion--phenology-ai)
7. [Weather Integration](#7-weather-integration)
8. [Backend Services Reference](#8-backend-services-reference)
9. [Celery Tasks & Schedules](#9-celery-tasks--schedules)
10. [API Reference](#10-api-reference)
11. [Environment Variables](#11-environment-variables)
12. [Database & Migrations](#12-database--migrations)
13. [GEE & Satellite Configuration](#13-gee--satellite-configuration)
14. [Deployment](#14-deployment)
15. [Development Setup (Local, No Docker)](#15-development-setup-local-no-docker)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Platform Overview

The **Crop Risk Prediction Platform** is a full-stack precision agriculture system built for Rwandan smallholder and commercial farms. It fuses data from three satellite sources, applies AI to detect crop growth stages, predicts disease outbreaks, and generates prescriptive field management recommendations — all with minimal manual input.

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **Multi-Satellite Fusion** | Sentinel-2 (optical), Sentinel-1 SAR (radar), Landsat 8/9 (backup) — merged into a single health score |
| **Phenology AI** | NDVI time-series curve analysis detects 5 crop growth stages automatically |
| **Disease Prediction** | Late Blight, Septoria, Powdery Mildew, Fusarium Wilt — using epidemiological models |
| **NDVI Tile Caching** | GEE-rendered map tiles cached in Redis with a time-slider for historical comparison |
| **Productivity Zones** | K-means clustering of satellite indices into actionable field productivity zones |
| **Variable Rate Application** | Prescription maps for fertiliser, irrigation, and pesticide input optimisation |
| **Yield Analysis** | Historical yield tracking with ML-based seasonal predictions |
| **Early Warning System** | NDVI anomaly detection + weather-triggered alerts sent to all farm users |
| **Role-Based Access** | Three separate UI views and API scopes for admins, agronomists, and farmers |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                      │
│  React 18 Web App (Vite)          Capacitor Mobile App (Android)        │
│  Port 5174                         Port 5175                             │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ REST / HTTP
┌──────────────────────────▼──────────────────────────────────────────────┐
│                        API LAYER                                         │
│  FastAPI  (uvicorn)  ·  Python 3.11  ·  Port 8000                       │
│  JWT Auth  ·  Role Guards  ·  Auto-triggered Celery tasks               │
└──────┬───────────────────────────────────┬───────────────────────────────┘
       │ SQLAlchemy / PostGIS              │ Celery tasks
┌──────▼──────────────┐        ┌──────────▼──────────────────────────────┐
│  PostgreSQL 14      │        │         Celery Workers + Beat            │
│  + PostGIS 3.4      │        │  Satellite fetch  ·  Disease analysis    │
│  Port 5434 (host)   │        │  Phenology scan   ·  Weather ingest      │
└─────────────────────┘        └──────────┬──────────────────────────────┘
                                          │
       ┌──────────────────────────────────┼──────────────────────────────┐
       │ Redis 7 (broker + cache)         │                              │
       │ Port 6379                        │                              │
       └──────────────────────────────────┘                              │
                                 External Services                        │
          ┌──────────────────────────────────────────────────────────┐   │
          │  Google Earth Engine   Planetary Computer STAC            │   │
          │  ERA5 / NOAA CDO       Open-Meteo (free fallback)         │◄──┘
          └──────────────────────────────────────────────────────────┘
```

### Repository Layout

```
backend/
  app/
    api/v1/         REST API route handlers
    services/       Core business logic (satellite, disease, phenology, …)
    tasks/          Celery tasks (satellite, weather, precision ag, ML)
    models/         SQLAlchemy ORM models + GeoAlchemy2 geometry
    ml/             Feature engineering + ML inference helpers
  migrations/       Alembic migration scripts
  tests/            pytest test suite
web-app/            React 18 + Vite frontend  (src/pages/, src/components/)
mobile-app/         Capacitor Android shell
ml/                 Standalone training scripts (Random Forest, etc.)
scripts/            Data preparation & administration utilities
data/               Satellite tile cache, uploaded images, ML model files
```

---

## 3. Quick Start with Docker

### Prerequisites

- Docker Desktop 24+ with Compose v2
- A Google Earth Engine service account key JSON (see [GEE Configuration](#13-gee--satellite-configuration))
- A `.env` file created from the [Environment Variables](#11-environment-variables) reference below

### Steps

```bash
# 1. Clone the repository
git clone <repo-url>
cd Crop-Prediction-Staging

# 2. Copy and fill in the environment file
cp .env.example .env
# Edit .env with your credentials (GEE, DB password, secret keys, etc.)

# 3. Place your GEE service account key
mkdir -p Gee_Key
cp /path/to/gee-service-account.json Gee_Key/gee-service-account.json

# 4. (Optional) Add Copernicus ERA5 credentials
cp /path/to/.cdsapirc .cdsapirc

# 5. Start all services
docker compose up --build

# Services start on:
#   API backend  → http://localhost:8000
#   Web frontend → http://localhost:5174
#   API docs     → http://localhost:8000/docs
#   Redoc        → http://localhost:8000/redoc
```

### Docker Service Overview

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| `db` | `crop-risk-db` | 5434 → 5432 | PostgreSQL 14 + PostGIS 3.4 |
| `redis` | `crop-risk-redis` | 6379 | Redis 7 Alpine (broker + cache) |
| `web` | `crop-risk-backend` | 8000 | FastAPI + uvicorn (hot-reload) |
| `worker` | `crop-risk-worker` | — | Celery worker (6 concurrent) |
| `beat` | `crop-risk-beat` | — | Celery Beat scheduler |
| `web-app` | `crop-risk-web-app` | 5174 | React + Vite dev server |

### Run Migrations After First Start

```bash
docker compose exec web alembic upgrade head
```

### Create First Admin User

```bash
docker compose exec web python -c "
from app.database import SessionLocal
from app.models.user import User
from app.core.security import get_password_hash
db = SessionLocal()
admin = User(email='admin@example.com', full_name='Admin', hashed_password=get_password_hash('changeme'), role='admin', is_active=True)
db.add(admin); db.commit()
print('Admin created')
"
```

---

## 4. Frontend User Guide

The web application is accessible at **http://localhost:5174** (Docker) or the configured `VITE_API_URL` origin in production.

### Roles & Access

The platform has three user roles, each with a distinct UI scope:

| Role | Badge Colour | Description |
|------|-------------|-------------|
| **Admin** | 🔴 Red `#D32F2F` | Full access — user management, system config, all analytics |
| **Agronomist** | 🔵 Blue `#0288D1` | Farm analytics, precision ag, disease management, satellite views |
| **Farmer** | 🟢 Green `#2E7D32` | Simplified dashboard, own farms, health overview, alerts |

The left sidebar and visible pages adapt dynamically based on the logged-in user's role. Farmers see a streamlined view focused on field health; agronomists and admins unlock the full analytical suite.

### Sidebar Navigation Map

The sidebar is organised into labelled groups. Use the **☰** button in the header to open it, and the **‹** chevron inside the sidebar brand to collapse it.

| Group | Page | URL | Roles |
|-------|------|-----|-------|
| **Overview** | Dashboard | `/` | All |
| **Overview** | My Farms | `/farms` | All |
| **Overview** | Alerts | `/early-warning` | All |
| **Satellite Intelligence** | Satellite Map | `/satellite-dashboard` | All |
| **Satellite Intelligence** | Satellite Data | `/satellite` | All |
| **Satellite Intelligence** | Stress Monitor | `/stress-monitoring` | All |
| **Analysis** | Disease Classifier | `/disease-classifier` | All |
| **Analysis** | Predictions | `/predictions` | Admin, Agronomist |
| **Analysis** | Risk Assessment | `/risk-assessment` | All |
| **Precision Agriculture** | Seasons | `/seasons` | All |
| **Precision Agriculture** | VRA Maps | `/vra` | Admin, Agronomist |
| **Precision Agriculture** | Yield Analysis | `/yield-analysis` | All |
| **Admin** | Admin Panel | `/admin` | Admin only |
| **Account** | Profile | `/profile` | All |

---

### Login & Registration

**Login (`/login`)**

1. Navigate to the platform URL — you are redirected to `/login` if not authenticated.
2. Enter your **email** and **password**.
3. Click **Sign In**. A JWT access token is stored in memory (not localStorage) for security.
4. You are redirected to the Dashboard matching your role.

**Registration (`/register`)**

1. Click **Create Account** on the login page.
2. Fill in full name, email, password, and select a role (subject to admin approval).
3. Submit — the backend creates the account and returns a session token.

> New accounts may require admin activation depending on server configuration (`REQUIRE_EMAIL_VERIFICATION`).

---

### Dashboard

**URL:** `/` | **Roles:** All

The dashboard is a single unified view that adapts its data to the logged-in user's farm portfolio. It loads in parallel with skeleton placeholders while fetching data.

**Hero Header**
- Time-of-day greeting with the user's first name.
- Subtitle showing total farms monitored and time since last satellite pass.
- Four at-a-glance metric badges: **Farms · Avg Health · At Risk · Last Satellite**.

**KPI Card Row** (5 cards across)
- **Total Farms** — count of registered farms.
- **Fields Monitored** — farms with at least one satellite acquisition.
- **Avg Health Score** — portfolio mean composite health (colour-coded green / amber / red).
- **Fields At Risk** — farms currently in High Stress status.
- **ML Models Active** — loaded/total ML models (admin and agronomist only).

**Production Units panel** (main column)
- Lists up to 6 farms with a circular **HealthGauge** SVG (green ≥ 70, amber 40–69, red < 40).
- Each row shows: crop type (AI-detected or manual), area in ha, time since last satellite pass, health badge, and quick links to the Satellite Map and Farm Details.

**Vegetation Timeline panel** (main column)
- 90-day NDVI / NDRE / EVI line chart for the first farm, powered by `VegetationTimeline`.
- Shows crop name, growth stage, and threshold reference lines.

**NDVI Field Ranking** (main column — admin/agronomist)
- Horizontal bar chart ranking all farms by current NDVI value.

**Satellite Intelligence summary** (side column)
- Shows latest NDVI, NDRE, EVI, NDWI, Stress Level and Last Observation for the featured farm.

**Health Distribution pie chart** (side column)
- Donut chart split by Healthy / Moderate / Stressed farm count.

**Active Alerts panel** (side column)
- Up to 5 non-low alerts with dot indicators and severity tags.

**Quick Actions grid** (side column)
- Four one-click tiles: Add Farm, Satellite Map, Disease AI, View Alerts.

---

### Farms Management

**URL:** `/farms` | **Roles:** Admin, Agronomist

This is the central farm registry. Every downstream analysis (satellite, disease, alerts) is anchored to farms defined here.

**How to add a farm:**
1. Click **+ New Farm** in the top-right corner.
2. Fill in the details:
   - **Farm Name** — human-readable label.
   - **Crop Type** — select from the dropdown (potato, maize, bean, wheat, tomato, …).
   - **Location** — click on the embedded map to drop a pin, or enter coordinates manually.
   - **Draw Boundary** (optional but recommended) — click the polygon tool on the map to trace the exact field boundary. The system uses this geometry for precise satellite extraction.
   - **Province / District** — used for administrative reporting.
3. Click **Save Farm**.
   - A Celery task is automatically queued to fetch satellite data and run the first risk analysis.
   - Results appear under the farm card within a few minutes (depending on GEE availability).

**How to edit a farm:**
1. Click the **Edit** (pencil) icon on any farm card.
2. Modify fields — if coordinates or boundary change, satellite analysis is re-triggered automatically.

**Farm card shows:**
- Crop type + province
- Latest NDVI value + trend arrow
- Health status badge (Healthy / Moderate / High Stress)
- Date of last satellite analysis
- Quick link to Satellite Map view for that farm

**How to delete a farm:**
1. Click the **Delete** (trash) icon.
2. Confirm the dialog — all associated satellite data, predictions and alerts are removed.

---

### Satellite Map

**URL:** `/satellite-dashboard` | **Roles:** Admin, Agronomist

The most feature-rich page — an interactive Mapbox satellite map with multi-layer index overlays, AI-powered field intelligence, and precision agriculture tools.

**Map Layers (toggle via layer panel):**
| Layer | Source | Description |
|-------|--------|-------------|
| NDVI Colour | GEE tile URL | Red-yellow-green gradient (−1 to +1) |
| Sentinel-2 True Colour | GEE | Natural colour composite (B4/B3/B2) |
| Sentinel-1 SAR | GEE | Radar backscatter (VV/VH) — works through clouds |
| Landsat Thermal | GEE | Land surface temperature overlay |
| Productivity Zones | Backend K-means | Field zones coloured by yield potential |

**Time Slider:**
- Drag the slider at the bottom of the map to compare NDVI tiles for past dates.
- Each date step loads a cached tile from Redis (sub-second response for cached dates).
- Cache covers the last 90 days (configurable via `NDVI_TILE_HISTORY_DAYS`).

**Phenology Panel (right sidebar):**
- Shows the current **crop growth stage** detected by the AI:
  - Germination → Vegetative Growth → Canopy Closure → Reproductive → Senescence
- Includes the NDVI curve chart for the selected farm with the stage highlighted.
- Stage transitions are detected from smoothed NDVI slope and acceleration.

**Satellite Fusion Status:**
- Indicator showing which satellites contributed to the current composite:
  - ✅ Sentinel-2 (optical, 10 m)
  - ✅ Sentinel-1 SAR (radar, 10 m — available even under cloud cover)
  - ✅ Landsat 9 (30 m — fallback)
- Fusion confidence score and cloud cover percentage.

**Field Intelligence Panel:**

Click any farm to open a tabbed side-panel with deep analytics:

| Tab | Content |
|-----|--------|
| **Status** | NDVI, weather, composite health score, actionable insights, productivity zone summary |
| **Vegetation** | 90-day NDVI / NDRE / EVI / NDWI time-series chart |
| **Yield Analysis** | NDVI-based yield estimation with zone breakdown |
| **Prescription maps** | List existing VRA maps • Create new OneSoil-style VRA map • View full-screen result |

Quick-action toolbar provides one-click access to:
- **Scan** — trigger a new satellite analysis
- **Prescription map** — open the OneSoil-style VRA creator (see VRA Maps below)
- **Soil sampling** — generate grid- or zone-based sampling plans

**Productivity Zone Overlays:**
- After scanning, coloured polygon overlays appear on the map: green (high), amber (medium), red (low).
- Hover to see a tooltip with zone label, mean NDVI, and area (ha).
- Zones are computed from GEE Sentinel-2 imagery using K-means clustering.

**Usage tips:**
- Use the **farm selector** dropdown to zoom to a specific farm.
- On a phone, pinch-to-zoom works on the map.
- Click any farm polygon to open a pop-up with current health stats.

---

### Satellite Data

**URL:** `/satellite-data` | **Roles:** Admin, Agronomist

Raw satellite data browser for analysing per-farm spectral history.

**What you can do:**
- Select a farm from the dropdown.
- Choose a date range (up to 12 months).
- View a table of all satellite acquisitions — date, cloud cover %, data source, band values.
- Download the index time-series as CSV for offline analysis.
- See which source (GEE / Planetary Computer / Landsat) provided each record.

---

### Stress Monitoring

**URL:** `/stress-monitoring` | **Roles:** All

Vegetation health time-series dashboard for tracking field condition trends over time.

**Charts:**
- **NDVI Trend** (line chart) — daily NDVI values for the selected farm over the chosen period.
- **Multi-Index Panel** — NDVI, NDRE, NDWI, EVI, SAVI plotted together for comparison.
- **Composite Health Score** bar — current score (0–100) with colour coding.

**Stress Indicators:**
- Drought (NDWI below threshold)
- Water Stress (NDVI decline + low NDWI)
- Nutrient Deficiency (NDRE drop)
- Disease Signature (rapid NDVI decrease)

**How to use:**
1. Select a farm from the dropdown.
2. Set the date range (last 7 / 30 / 90 days, or custom).
3. Read the stress events highlighted on the chart (shaded red bands).
4. The summary card below the chart lists detected stresses with severity and recommended actions.

---

### Risk Assessment

**URL:** `/risk-assessment` | **Roles:** Admin, Agronomist

ML ensemble risk scoring for each farm using a Random Forest model trained on satellite indices, weather features, and historical disease occurrence.

**How to run an assessment:**
1. Select a farm from the list.
2. Click **Run Analysis** — the system fetches the latest satellite data and runs the ML pipeline.
   - Or choose **Refresh All** to analyse every farm in the portfolio.
3. Results are cached for 24 hours; use **Force Refresh** to bypass cache.

**Output per farm:**
- **Overall Risk Score** (0–100) — composite ML ensemble output.
- **Risk Level Badge** — Critical / High / Medium / Low.
- **Feature Importance Breakdown** — bar chart showing which indices drove the score.
- **Disease Probability Scores** — per-disease probability from the classifier.
- **Recommended Actions** — auto-generated agronomic interventions ranked by priority.

---

### Disease Forecasts

**URL:** `/predictions` | **Roles:** Admin, Agronomist

7-day disease outbreak forecast dashboard combining weather forecasts with current vegetation stress indicators.

**How to use:**
1. Select one or multiple farms (multi-select supported).
2. The page fetches an ensemble forecast combining:
   - Weather API forecasts (temperature, humidity, rainfall)
   - Current NDVI / NDRE / NDWI readings
   - Disease epidemiological models (Smith Period, TOM-CAST, etc.)
3. Forecast cards appear for each disease:

**Forecast Cards show:**
- Disease name + pathogen
- Risk probability (%) for each of the next 7 days — plotted as a probability bar chart
- Predicted peak risk date
- Environmental trigger conditions met / not met
- Recommended spray / management window

**Disease Models Used:**

| Disease | Model | Key Triggers |
|---------|-------|-------------|
| Late Blight (*Phytophthora infestans*) | Smith Period (Cornell) | Temp ≥ 10 °C, RH ≥ 90 %, leaf wetness ≥ 11 h |
| Septoria Leaf Spot | TOM-CAST (Ohio State) | Temp 15–27 °C, leaf wetness ≥ 6 h, DSV ≥ 15 |
| Powdery Mildew | Environmental RH model | Temp 15–22 °C, RH 50–70 %, dry canopy |
| Fusarium Wilt | Soil temp model | Soil temp 27–32 °C, moderate soil moisture |

---

### Disease Classifier

**URL:** `/disease-classifier` | **Roles:** Admin, Agronomist (accessible to Farmers via quick link)

AI-powered leaf disease identification from uploaded photographs.

**How to identify a disease:**
1. Click **Upload Image** or drag-and-drop a photo of the affected leaf/crop.
2. Supported formats: JPEG, PNG, WebP (max 10 MB).
3. Click **Classify**.
4. Results appear within seconds:
   - **Top Prediction** — disease name + confidence (%).
   - **Differential Diagnoses** — 2nd and 3rd most likely conditions.
   - **Affected Crop** — identified crop species.
   - **Severity Estimate** — visual area affected.
   - **Treatment Protocol** — recommended fungicide / cultural practices.
5. Optionally **link to a farm** — saves the diagnosis to the farm's disease history for tracking.

**Model details:**
- Convolutional neural network trained on the PlantVillage dataset extended with Rwandan field imagery.
- Supports 15 disease classes across potato, tomato, maize, bean, and banana.

---

### Early Warning Alerts

**URL:** `/alerts` | **Roles:** All

Real-time alert centre showing active anomalies across the farm portfolio.

**Alert types:**
| Type | Trigger | Severity |
|------|---------|---------|
| NDVI Anomaly | NDVI drops > 15 % in 7 days | Critical / High / Medium |
| Drought Alert | NDWI below −0.1 for 5+ days | High |
| Disease Risk Alert | Disease model DSV threshold crossed | High |
| Weather Warning | Extreme rainfall / frost / heat forecast | Medium |
| Data Gap | No satellite data for > 21 days | Low |

**How to respond to an alert:**
1. Click any alert card to expand it.
2. Read the **trigger explanation** — which index changed, by how much, compared to baseline.
3. View the **farm map snapshot** showing the affected area highlighted.
4. Click **Mark Resolved** after taking action in the field.
5. Click **Snooze 7 Days** to temporarily suppress a low-priority alert.

**Alert history** is accessible via the **History** tab — searchable by farm, date, and type.

---

### Season Manager

**URL:** `/seasons` | **Roles:** Admin, Agronomist

Plan and track crop seasons and rotation schedules at the farm level.

**Creating a season:**
1. Click **+ New Season**.
2. Select the farm.
3. Fill in:
   - **Season Name** (e.g., "Season A 2025")
   - **Crop Type**
   - **Planting Date** and **Expected Harvest Date**
   - **Seed Variety** (free text)
   - **Area (ha)**
4. Click **Save**. The season is now active and linked to all satellite analyses for that farm during the date range.

**Season view:**
- Calendar strip showing active seasons across all farms.
- Per-season NDVI series overlay — see how each season performed.
- Stage annotations show when the phenology AI detected growth stage transitions.

**Crop rotation planning:**
- At season close, the system suggests a rotation based on the crop and detected soil stress patterns.
- Rotation history is stored per farm to track soil health over multiple seasons.

---

### VRA Maps

**URL:** Satellite Map → Field Intelligence Panel → **Prescription maps** tab | **Roles:** Admin, Agronomist

Variable Rate Application (VRA) prescription maps for precision input management, designed with an **OneSoil-style** professional workflow.

**What are VRA Maps?**
VRA maps divide a field into productivity zones and assign different input rates (fertiliser, seed, pesticide) to each zone based on satellite-derived productivity differences. This reduces input waste, cuts costs, and targets underperforming areas.

**Creating a VRA map (OneSoil-style modal):**
1. Open the Satellite Map, click a farm to reveal the Field Intelligence Panel.
2. Click **"Prescription map"** in the toolbar, or switch to the **Prescription maps** tab and click **"+ Create VRA map"**.
3. A white modal opens with two steps:
   - **Step 1** — Select prescription type: Planting • Crop protection • Fertiliser application • Multiple inputs.
   - **Step 2** — Select data source: Productivity map (auto-computed from GEE) • Recent NDVI image • Soil analysis results.
4. Click **"Create map"** — the backend generates a zone-based prescription.

**VRA Result View (full-screen split-screen):**

After creation, a full-screen overlay appears with three panels:

| Panel | Content |
|-------|--------|
| **Left sidebar** (280 px) | Map settings, prescription settings (crop, variety, rate, unit), zone rate table with colour bars, Invert rates toggle, Trial mode toggle, Save + Export buttons |
| **Centre map** | Mapbox satellite with VRA zone overlays in purple shades (deep purple = high productivity, light purple = low), hover tooltips with rate and area |
| **Right map** | Mapbox satellite with productivity zone overlays (green/amber/red) for side-by-side comparison with the prescription |

**Zone rate logic:**
| Zone | Productivity | Default multiplier | Example (100 kg/ha base) |
|------|-------------|--------------------|--------------------------|
| High | Strong NDVI | 0.8× (reduce) | 80 kg/ha |
| Medium | Average | 1.0× (standard) | 100 kg/ha |
| Low | Weak NDVI | 1.2× (increase) | 120 kg/ha |

Rates are fully editable; toggle **Invert rates** for seeding where more seed goes to the productive zones.

**Viewing existing VRA maps:**
- The **Prescription maps** tab lists all previously created maps for the farm.
- Each card shows: type icon, product, base rate, zone breakdown, and savings %.
- Click a card to re-open the full-screen VRA Result View.

**Exporting a prescription:**
- Click **Export** in the sidebar to download as:
  - **GeoJSON** — for use with precision agriculture equipment.
  - **ISOXML** — ISO 11783 format for compatible variable-rate controllers.

---

### Yield Analysis

**URL:** `/yield-analysis` | **Roles:** Admin, Agronomist

Historical yield tracking and ML-powered seasonal yield predictions.

**Yield History:**
- Table of all past harvests per farm — season, crop, area sown, total yield (tonnes), yield per hectare.
- Line chart showing yield trend over seasons.

**Yield Prediction:**
1. Select a farm with an active season.
2. Click **Predict Yield** — the model uses:
   - Current NDVI trend (growing season average vs. historical baseline)
   - Productivity zone distribution
   - Weather anomaly score (from ERA5/Open-Meteo)
   - Historical yield data (if available)
3. Output: **Predicted yield range** (low / mid / high scenario) in tonnes/ha.

**Logging a harvest:**
1. At season end, click **Log Harvest** on a farm.
2. Enter actual yield figures — these are stored and used to improve future predictions.

---

### ML Models

**URL:** `/ml-models` | **Roles:** Admin only

Model management and performance monitoring dashboard.

**What you can see:**
- List of deployed ML models (disease classifier, crop risk Random Forest, yield predictor).
- For each model: version, training date, accuracy / F1 / AUC metrics, last prediction timestamp.
- Confusion matrix for the disease classifier (heatmap).
- Feature importance chart for the Random Forest risk model.

**Actions:**
- **Retrain** (queues a background Celery task to re-train with latest data).
- **Rollback** to a previous model version.
- **Run Validation** — runs the test set through the current model and updates the metrics.

---

### Admin Panel

**URL:** `/admin` | **Roles:** Admin only

System-wide administration console.

**User Management tab:**
- List of all registered users with role, status, and last login.
- **Edit** to change role or deactivate an account.
- **Delete** to remove a user (with confirmation dialog).
- **Invite User** — generate a sign-up link with pre-assigned role.

**System Config tab:**
- View current environment variable status (which keys are set, masked values).
- Toggle feature flags (e.g., `USE_PLANETARY_COMPUTER`, `ENABLE_SAR_FUSION`).
- Service health indicators: GEE, Planetary Computer, ERA5, NOAA, Redis, PostgreSQL.

**Task Monitor tab:**
- Live Celery task queue — pending, active, and completed tasks with timestamps.
- **Retry** a failed task.
- **Purge** the queue (admin only).

---

### Profile

**URL:** `/profile` | **Roles:** All

Personal account management page.

- **Edit Profile** — update full name and email address.
- **Change Password** — current password required for confirmation.
- **Notification Preferences** — toggle email alerts for Critical / High severity warnings.
- **API Token** — generate a personal API token for programmatic access (admin/agronomist only).
- **My Farms** — shortcut list of farms assigned to the current user.

---

## 5. Auto Crop Risk Pipeline

### Pipeline Flow

```
Farm Created/Updated
        │
        ▼
Celery Task: analyze_single_farm_risk
        │
        ├─► GEE Sentinel-2 SR harmonised fetch  (COPERNICUS/S2_SR_HARMONIZED)
        │       └─► Fallback: Planetary Computer STAC
        │       └─► Fallback: Landsat 9 (LANDSAT/LC09/C02/T1_L2)
        │
        │   [SAR fusion if cloud cover > 40 %]
        ├─► GEE Sentinel-1 SAR fetch (COPERNICUS/S1_GRD)
        │
        ▼
  Index Calculation   NDVI · NDRE · NDWI · EVI · SAVI
        │
        ▼
  Composite Health Score  (weighted sum, 0–100)
        │
        ├─► Disease Model Pipeline  →  Late Blight · Septoria · Powdery Mildew · Fusarium
        ├─► Stress Detection        →  Drought · Water Stress · Nutrient Deficiency
        ├─► Phenology AI            →  Growth stage from NDVI curve
        └─► Productivity Zones      →  K-means spatial clustering
                                                │
                                                ▼
                                        Risk Output → DB + Redis cache

Daily Celery Beat (06:30 UTC) ──► analyze_all_farms_risk (batch over all active farms)
```

### Vegetation Index Formulae

| Index | Formula | Purpose |
|-------|---------|---------|
| NDVI | `(NIR − Red) / (NIR + Red)` | Overall vegetation greenness |
| NDRE | `(NIR − RedEdge) / (NIR + RedEdge)` | Chlorophyll content / crop vigour |
| NDWI | `(Green − NIR) / (Green + NIR)` | Canopy water content |
| EVI | `2.5 × (NIR − Red) / (NIR + 6·Red − 7.5·Blue + 1)` | Atmospheric-corrected greenness |
| SAVI | `1.5 × (NIR − Red) / (NIR + Red + 0.5)` | Soil-adjusted (sparse vegetation) |

### Composite Health Score

```
Score = NDVI×0.30 + NDRE×0.20 + NDWI×0.20 + EVI×0.15 + SAVI×0.15
```

Normalised to 0–100.

| Status | Score |
|--------|-------|
| 🟢 Healthy | ≥ 70 |
| 🟡 Moderate Stress | 50 – 69 |
| 🔴 High Stress | < 50 |

### Auto-Trigger Conditions

| Trigger | Mechanism |
|---------|-----------|
| Farm created | `POST /api/v1/farms/` dispatches `analyze_single_farm_risk` |
| Farm coordinates updated | `PUT /api/v1/farms/{id}` re-dispatches on coord change |
| Daily batch | Celery Beat at 06:30 UTC — `analyze_all_farms_risk` |
| On-demand | `POST /api/v1/farm/analyze-risk` |
| Force refresh | Any of the above with `force_refresh=true` to bypass 24 h cache |

### Sample API Response

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
  "recommended_action": ["Monitor soil moisture levels and adjust irrigation."],
  "data_source": "google_earth_engine",
  "phenology_stage": "vegetative_growth",
  "analysis_timestamp": "2026-03-15T06:30:00Z"
}
```

---

## 6. Satellite Fusion & Phenology AI

### Multi-Satellite Fusion (`SatelliteFusionService`)

When optical imagery (Sentinel-2) is unavailable due to cloud cover, the platform fuses data from multiple sensors:

| Source | Collection | Resolution | Advantage |
|--------|-----------|-----------|----------|
| Sentinel-2 (primary) | `COPERNICUS/S2_SR_HARMONIZED` | 10 m | Best spectral quality |
| Sentinel-1 SAR | `COPERNICUS/S1_GRD` | 10 m | Cloud-penetrating radar |
| Landsat 9 | `LANDSAT/LC09/C02/T1_L2` | 30 m | Thermal bands, long history |
| Planetary Computer | STAC API | varies | Fallback when GEE quota exceeded |

Fusion logic: SAR-derived vegetation proxy indices (VV/VH backscatter ratios) fill gaps in optical index composites using a weighted average scaled by per-sensor confidence.

### Phenology AI (`PhenologyService`)

The phenology engine analyses the NDVI time-series for each farm and fits a Savitzky–Golay smoothed curve to detect crop growth stage transitions:

| Stage | NDVI Pattern | Typical Duration |
|-------|-------------|----------------|
| 🌱 Germination | Near-zero rising from baseline | 1–2 weeks |
| 🌿 Vegetative Growth | Rapid positive slope | 3–6 weeks |
| 🌾 Canopy Closure | NDVI plateau near maximum | 2–4 weeks |
| 🌸 Reproductive | Slight decline from peak | 3–5 weeks |
| 🍂 Senescence | Rapid decline toward zero | 2–4 weeks |

Stage detection uses slope thresholds and a second-derivative inflection point algorithm. Outputs feed into disease risk weighting (e.g., Late Blight risk is elevated during canopy closure).

### NDVI Tile History & Time Slider

- GEE renders tiled NDVI map overlays (XYZ tiles) for each farm for each available date.
- Tile URLs are cached in Redis (`ndvi_tile:{farm_id}:{date}`) with a 7-day TTL.
- The frontend time slider animates through cached dates without additional GEE calls.
- History depth is configurable via `NDVI_TILE_HISTORY_DAYS` (default: 90).

---

## 7. Weather Integration

The platform draws weather data from four sources in priority order:

| Source | Data | Notes |
|--------|------|-------|
| **ERA5** (Copernicus CDS) | Historical reanalysis — hourly T, RH, wind, precip | Requires `ERA5_API_KEY` + `.cdsapirc` |
| **NOAA CDO** | Station-based historical + recent climatology | Requires `NOAA_API_KEY` |
| **Open-Meteo** | 7-day forecast, current conditions | Free, no key required — used as fallback |
| **IBM EIS** | Enhanced agronomic weather (optional premium) | Requires `IBM_EIS_API_KEY` |

Weather data is used for:
- Disease model input (temperature, humidity, leaf wetness hours)
- Drought/stress alert triggers
- Yield prediction features
- Early warning system

---

## 8. Backend Services Reference

| Service | Module | Responsibility |
|---------|--------|---------------|
| `SatelliteDataService` | `satellite_service.py` | GEE + Planetary Computer Sentinel-2 fetch |
| `SatelliteFusionService` | `satellite_fusion_service.py` | SAR + optical + Landsat fusion |
| `PhenologyService` | `phenology_service.py` | NDVI curve → growth stage detection |
| `NdviTileService` | `ndvi_tile_service.py` | GEE tile URLs, Redis caching, time-slider history |
| `ProductivityZoneService` | `productivity_zone_service.py` | K-means field zone clustering |
| `AutoCropRiskService` | `auto_crop_risk_service.py` | Full pipeline orchestration |
| `DiseaseRiskService` | `disease_risk_service.py` | Epidemiological disease model |
| `StressDetectionService` | `stress_detection_service.py` | NDVI anomaly + stress type classification |
| `EarlyWarningService` | `early_warning_service.py` | Alert generation + delivery |
| `WeatherDataIntegrator` | `weather_service.py` | ERA5 / NOAA / Open-Meteo multi-source merge |
| `PlanetaryComputerService` | `planetary_computer_service.py` | STAC fallback client |
| `VraService` | `vra_service.py` | Variable rate application prescription maps |
| `YieldAnalysisService` | `yield_analysis_service.py` | Yield history + ML prediction |
| `SeasonService` | `season_service.py` | Season / crop rotation management |
| `MLInferenceService` | `ml_service.py` | Random Forest ensemble risk scoring |
| `StartupValidation` | `startup_validation.py` | Boot-time service connectivity checks |

---

## 9. Celery Tasks & Schedules

### Scheduled Tasks (Celery Beat)

| Task | Schedule | Description |
|------|----------|-------------|
| `analyze_all_farms_risk` | Daily 06:30 UTC | Full satellite + risk analysis for all active farms |
| `fetch_satellite_fusion` | Every 6 hours | SAR + optical fusion refresh for high-risk farms |
| `update_ndvi_tile_cache` | Daily 05:00 UTC | Pre-render GEE NDVI tiles for all farms |
| `run_disease_forecast` | Daily 07:00 UTC | 7-day disease probability forecast |
| `ingest_weather_data` | Every 3 hours | Pull ERA5 / NOAA / Open-Meteo data |
| `detect_ndvi_anomalies` | Daily 08:00 UTC | Early warning NDVI trend analysis |
| `compute_productivity_zones` | Weekly Sunday 02:00 UTC | Re-cluster farm zones with latest imagery |

### On-Demand Tasks

| Task | Trigger |
|------|---------|
| `analyze_single_farm_risk` | Farm created / coordinates updated |
| `run_disease_classification` | Image uploaded to Disease Classifier |
| `generate_vra_map` | VRA Map generation request |
| `predict_yield` | Yield prediction request |

### Celery Configuration

```
Broker:  redis://redis:6379/0
Backend: redis://redis:6379/1
Workers: 6 concurrent processes
Beat:    persistent schedule in celerybeat-schedule
```

---

## 10. API Reference

### Authentication

All endpoints require a JWT Bearer token (except `/api/v1/auth/login` and `/api/v1/auth/register`).

```
Authorization: Bearer <token>
```

Tokens expire after 8 hours (configurable via `ACCESS_TOKEN_EXPIRE_MINUTES`).

### Farms

```
GET    /api/v1/farms/                           List all farms (filterable by crop, province)
POST   /api/v1/farms/                           Create farm → auto-triggers satellite analysis
GET    /api/v1/farms/{farm_id}                  Get farm details
PUT    /api/v1/farms/{farm_id}                  Update farm
DELETE /api/v1/farms/{farm_id}                  Delete farm + cascade
```

### Crop Risk Analysis

```
POST   /api/v1/farm/analyze-risk                Run risk analysis (body: farm_id, days_back, force_refresh)
GET    /api/v1/farm/analyze-risk/{farm_id}      Get latest analysis (cached or fresh)
POST   /api/v1/farm/analyze-risk/all            Batch analysis — all farms [admin/agronomist only]
```

### Satellite Data

```
GET    /api/v1/satellite/{farm_id}              Latest satellite indices for a farm
GET    /api/v1/satellite/{farm_id}/history      Time-series satellite data
GET    /api/v1/satellite/ndvi-tile/{farm_id}    GEE NDVI tile URL (for map overlay)
GET    /api/v1/satellite/fusion/{farm_id}       Multi-satellite fusion status + composite
POST   /api/v1/satellite/auto-fetch             Trigger satellite data fetch for all farms
```

### Phenology

```
GET    /api/v1/phenology/{farm_id}              Current growth stage + NDVI curve
GET    /api/v1/phenology/{farm_id}/history      Historical stage transitions
```

### Vegetation Stress & Health

```
GET    /api/v1/stress-monitoring/health/{farm_id}      Composite health score + indices
GET    /api/v1/stress-monitoring/timeseries/{farm_id}  NDVI timeseries
GET    /api/v1/stress-monitoring/alerts/{farm_id}      Active stress alerts
```

### Disease Prediction

```
GET    /api/v1/diseases/forecast/{farm_id}      7-day disease risk forecast
POST   /api/v1/diseases/predict                 Run disease model (body: farm_id, weather_data)
POST   /api/v1/diseases/classify-image          Upload image → AI disease classification
```

### Early Warning

```
GET    /api/v1/early-warning/                   All active alerts (current user's farms)
GET    /api/v1/early-warning/{alert_id}         Alert details
PUT    /api/v1/early-warning/{alert_id}/resolve Mark alert resolved
PUT    /api/v1/early-warning/{alert_id}/snooze  Snooze alert (body: days)
```

### ML & Risk Assessment

```
GET    /api/v1/ml/risk-assessment/{farm_id}     ML ensemble risk score + feature breakdown
GET    /api/v1/ml/models                        List deployed models + metrics
POST   /api/v1/ml/retrain/{model_name}          Queue model retrain [admin only]
```

### Precision Agriculture

```
GET    /api/v1/productivity-zones/{farm_id}     K-means productivity zones (GeoJSON)
POST   /api/v1/vra/generate                     Generate VRA prescription map
GET    /api/v1/vra/{farm_id}                    Latest VRA prescription
GET    /api/v1/seasons/{farm_id}                Seasons for a farm
POST   /api/v1/seasons/                         Create season
GET    /api/v1/yield/{farm_id}                  Yield history
POST   /api/v1/yield/predict                    Predict yield for active season
```

### User Management (Admin)

```
GET    /api/v1/users/                           List all users
PUT    /api/v1/users/{user_id}                  Update role / status
DELETE /api/v1/users/{user_id}                  Delete user
GET    /api/v1/users/me                         Current user profile
```

### Auth

```
POST   /api/v1/auth/login                       Login → returns JWT token
POST   /api/v1/auth/register                    Create account
POST   /api/v1/auth/refresh                     Refresh JWT token
```

---

## 11. Environment Variables

Copy this block to `.env` in the project root and fill in the values:

```env
# ─── Application ────────────────────────────────────────────────────────────
SECRET_KEY=change-this-to-a-random-256-bit-secret
ACCESS_TOKEN_EXPIRE_MINUTES=480
ENVIRONMENT=development          # development | staging | production

# ─── Database ───────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:1234@localhost:5434/crop_risk_db
# In Docker Compose this is set automatically:
# DATABASE_URL=postgresql://postgres:1234@db:5432/crop_risk_db

# ─── Redis ──────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/0
# In Docker Compose these point to the redis service:
# REDIS_URL=redis://redis:6379/0

# ─── Google Earth Engine ────────────────────────────────────────────────────
GEE_PROJECT=your-gcp-project-id
GEE_SERVICE_ACCOUNT_EMAIL=gee-sa@your-project.iam.gserviceaccount.com
GEE_PRIVATE_KEY_PATH=/app/keys/gee-service-account.json
# Host path: ./Gee_Key/gee-service-account.json (mounted as /app/keys/ in Docker)

# ─── Planetary Computer (optional fallback) ─────────────────────────────────
USE_PLANETARY_COMPUTER=false
MICROSOFT_PLANETARY_COMPUTER_API_STATIC_DOCUMENT=https://planetarycomputer.microsoft.com/api/stac/v1

# ─── Weather APIs ───────────────────────────────────────────────────────────
ERA5_API_KEY=                    # Copernicus CDS API key (optional)
COPERNICUS_USERNAME=             # Copernicus CDS username (for ERA5 download)
COPERNICUS_PASSWORD=             # Copernicus CDS password
NOAA_API_KEY=                    # NOAA Climate Data Online token (optional)
IBM_EIS_API_KEY=                 # IBM Environmental Intelligence Suite key (optional)

# ─── ML / Models ────────────────────────────────────────────────────────────
MODEL_DIR=/app/data/models

# ─── Satellite Storage ──────────────────────────────────────────────────────
SATELLITE_LOCAL_STORAGE_ENABLED=false

# ─── NDVI Tile History ──────────────────────────────────────────────────────
NDVI_TILE_HISTORY_DAYS=90

# ─── Frontend (web-app/.env or injected at build) ───────────────────────────
VITE_API_URL=http://localhost:8000
# Production: VITE_API_URL=https://crop-risk-api-zpgb.onrender.com
```

### Variable Reference Table

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | ✅ | — | JWT signing key — must be unique and secret |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `REDIS_URL` | ✅ | — | Redis connection (broker + cache) |
| `GEE_PROJECT` | ✅ | — | Google Cloud project ID for GEE |
| `GEE_SERVICE_ACCOUNT_EMAIL` | ✅ | — | GEE service account email |
| `GEE_PRIVATE_KEY_PATH` | ✅ | — | Path to GEE service account JSON key |
| `USE_PLANETARY_COMPUTER` | ❌ | `false` | Enable Planetary Computer fallback |
| `ERA5_API_KEY` | ❌ | — | Copernicus CDS API key for ERA5 reanalysis |
| `COPERNICUS_USERNAME` | ❌ | — | CDS username (paired with password) |
| `COPERNICUS_PASSWORD` | ❌ | — | CDS password |
| `NOAA_API_KEY` | ❌ | — | NOAA Climate Data Online token |
| `IBM_EIS_API_KEY` | ❌ | — | IBM EIS for premium weather data |
| `MODEL_DIR` | ❌ | `/app/data/models` | Directory for ML model files |
| `NDVI_TILE_HISTORY_DAYS` | ❌ | `90` | Days of NDVI tile history to cache |
| `SATELLITE_LOCAL_STORAGE_ENABLED` | ❌ | `false` | Store satellite images locally |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | ❌ | `480` | JWT expiry in minutes |
| `VITE_API_URL` | ✅ (frontend) | — | Backend API URL injected into React build |

---

## 12. Database & Migrations

The platform uses **PostgreSQL 14 with PostGIS 3.4** for spatial queries on farm geometries.

### Key Tables

| Table | Description |
|-------|-------------|
| `users` | User accounts, roles, hashed passwords |
| `farms` | Farm registry with PostGIS geometry columns |
| `satellite_data` | Per-farm per-date index records |
| `disease_predictions` | Disease risk outputs per farm |
| `early_warnings` | Alert records with severity and resolution status |
| `seasons` | Crop season planning records |
| `yield_records` | Historical and predicted yield entries |
| `vra_prescriptions` | VRA map GeoJSON prescriptions |
| `phenology_records` | Growth stage detection history |
| `productivity_zones` | K-means zone geometries |

### Running Migrations

```bash
# Apply all pending migrations
alembic upgrade head

# Generate a new migration after model changes
alembic revision --autogenerate -m "describe your change"

# Downgrade one step
alembic downgrade -1

# View migration history
alembic history
```

Inside Docker:

```bash
docker compose exec web alembic upgrade head
```

---

## 13. GEE & Satellite Configuration

### Setting Up Google Earth Engine

1. **Create a Google Cloud Project** at https://console.cloud.google.com.
2. **Enable the Earth Engine API** via APIs & Services → Enable APIs.
3. **Create a Service Account**:
   - IAM & Admin → Service Accounts → Create Service Account
   - Grant role: `Earth Engine Resource Writer`
4. **Generate a key**: Service Account → Keys → Add Key → JSON. Save as `gee-service-account.json`.
5. **Register the service account with GEE** at https://code.earthengine.google.com/register.
6. Place the key:
   ```
   ./Gee_Key/gee-service-account.json
   ```
   Docker mounts this at `/app/keys/gee-service-account.json`.
7. Set environment variables:
   ```
   GEE_PROJECT=your-project-id
   GEE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
   GEE_PRIVATE_KEY_PATH=/app/keys/gee-service-account.json
   ```

### Satellite Collections Used

| Sensor | GEE Collection ID | Resolution | Bands Used |
|--------|-------------------|-----------|-----------|
| Sentinel-2 MSI | `COPERNICUS/S2_SR_HARMONIZED` | 10 m | B2, B3, B4, B5, B8, B12 |
| Sentinel-1 SAR | `COPERNICUS/S1_GRD` | 10 m | VV, VH |
| Landsat 9 | `LANDSAT/LC09/C02/T1_L2` | 30 m | SR_B2–B7, ST_B10 |

### Planetary Computer Fallback

If GEE is unavailable or quota is exceeded, the system automatically queries Microsoft's Planetary Computer STAC API:

```env
USE_PLANETARY_COMPUTER=true
MICROSOFT_PLANETARY_COMPUTER_API_STATIC_DOCUMENT=https://planetarycomputer.microsoft.com/api/stac/v1
```

No API key is required for Planetary Computer access at standard usage rates.

---

## 14. Deployment

### Production on Render + Vercel

The platform is configured for split deployment:
- **Backend** (FastAPI + Celery) → Render.com (`render.yaml`)
- **Frontend** (React Vite) → Vercel (`vercel.json`)

#### Backend Deploy (Render)

1. Push to `main` branch — Render auto-deploys from `render.yaml`.
2. Set all environment variables in the Render Dashboard under **Environment**.
3. Provision a **Render PostgreSQL** add-on (enables PostGIS via the `db-init` script).
4. Provision a **Render Redis** add-on.
5. Upload the GEE key as a **Secret File** and reference it with `GEE_PRIVATE_KEY_PATH`.

#### Frontend Deploy (Vercel)

1. Connect the repository to Vercel, set root to `web-app/`.
2. Set build command: `npm run build`
3. Set output directory: `dist`
4. Add environment variable: `VITE_API_URL=https://your-render-backend.onrender.com`

Production API URL: `https://crop-risk-api-zpgb.onrender.com`

#### Full Docker Production Deploy

```bash
# Set production env vars
cp .env.example .env
# Edit .env — set ENVIRONMENT=production, strong SECRET_KEY, real API keys

docker compose -f docker-compose.yml up -d --build

# Verify all services healthy
docker compose ps
docker compose logs web --tail=50
```

---

## 15. Development Setup (Local, No Docker)

### Backend

```bash
# Prerequisites: Python 3.11, PostgreSQL 14 with PostGIS, Redis

cd backend

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/Mac

# Install dependencies
pip install -r requirements.txt

# Set environment variables (copy and edit)
cp ../.env.example ../.env

# Run migrations
alembic upgrade head

# Start backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Celery Workers (separate terminals)

```bash
# Worker
celery -A app.tasks.celery_app.celery_app worker --loglevel=info --concurrency=4

# Beat scheduler
celery -A app.tasks.celery_app.celery_app beat --loglevel=info
```

### Frontend

```bash
cd web-app

npm install

# Create local env file
echo "VITE_API_URL=http://localhost:8000" > .env.local

npm run dev
# → http://localhost:5174
```

### Mobile App

```bash
cd mobile-app

npm install

# Build web assets first
cd ../web-app && npm run build && cd ../mobile-app

# Sync to Android
npx cap sync android

# Open in Android Studio
npx cap open android
```

### Running Tests

```bash
cd backend

# Run all tests
pytest

# Run with coverage
pytest --cov=app tests/

# Run a specific test file
pytest tests/test_smoke.py -v
```

---

## 16. Troubleshooting

### GEE Issues

| Symptom | Fix |
|---------|-----|
| `EEException: Earth Engine application default credentials` | Ensure `GEE_PRIVATE_KEY_PATH` points to a valid service account JSON |
| No satellite data returned | Increase `days_back` (try 30), lower `max_cloud_cover` (try 40) |
| GEE quota exceeded | Set `USE_PLANETARY_COMPUTER=true` to enable the fallback |
| Service account not authorised | Re-register the SA at https://code.earthengine.google.com/register |

### Database Issues

| Symptom | Fix |
|---------|-----|
| `relation does not exist` | Run `alembic upgrade head` |
| PostGIS functions missing | Run the init script: `docker compose exec db psql -U postgres crop_risk_db -f /docker-entrypoint-initdb.d/01_postgis.sql` |
| Connection refused on port 5434 | Check `docker compose ps db` — the container may still be starting |

### Celery / Redis Issues

| Symptom | Fix |
|---------|-----|
| Tasks stay pending | Check `docker compose ps worker` — worker container may have crashed |
| Beat schedule not running | Verify `celerybeat-schedule` file exists in `/app`; delete it and restart beat to reset |
| Redis connection refused | Ensure `REDIS_URL` uses the Docker service name `redis` not `localhost` inside containers |

### Frontend Issues

| Symptom | Fix |
|---------|-----|
| Blank page / 401 errors | Ensure `VITE_API_URL` points to the correct backend (check browser Network tab) |
| Map tiles not loading | Verify NDVI tile URLs are HTTPS in production; check GEE service account has tile permissions |
| Login redirect loop | Clear browser localStorage and cookies; check JWT expiry settings |

### Startup Validation

On startup the backend runs `startup_validation.py` which checks connectivity to all configured services. Watch the logs for:

```
[OK]  PostgreSQL connection healthy
[OK]  Redis connection healthy
[OK]  GEE authentication successful
[WARN] ERA5 API key not configured — weather features degraded
[WARN] NOAA API key not configured — using Open-Meteo fallback
```

`[WARN]` items are non-fatal. `[ERROR]` items will degrade core functionality.

---

## Contributing

Contributions are welcome. Please:
1. Fork the repo and create a feature branch.
2. Run `pytest` and ensure all tests pass before opening a PR.
3. Follow the existing code style (Black formatter for Python, ESLint for JS/JSX).

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

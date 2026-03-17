# CropRisk Platform — User Guide

> **Who this guide is for:** Farmers, agronomists, and administrators using the CropRisk web application. No technical background is required.

---

## Table of Contents

1. [What is the CropRisk Platform?](#1-what-is-the-croprisk-platform)
2. [User Roles](#2-user-roles)
3. [Getting Started](#3-getting-started)
4. [Navigating the Application](#4-navigating-the-application)
5. [Dashboard](#5-dashboard)
6. [Farm Management](#6-farm-management)
7. [Satellite Intelligence](#7-satellite-intelligence)
8. [Analysis Tools](#8-analysis-tools)
9. [Precision Agriculture](#9-precision-agriculture)
10. [Early Warning Alerts](#10-early-warning-alerts)
11. [Admin Panel](#11-admin-panel)
12. [Profile & Account Settings](#12-profile--account-settings)
13. [Frequently Asked Questions](#13-frequently-asked-questions)
14. [Glossary](#14-glossary)

---

## 1. What is the CropRisk Platform?

CropRisk is a precision-agriculture web platform that combines satellite remote sensing, machine-learning models, and agronomic data to help you:

- **Monitor crop health** in near real-time using free satellite imagery (Sentinel-2 / Landsat-8).
- **Predict disease outbreaks** before visible symptoms appear.
- **Assess risk** across your entire farm portfolio at a glance.
- **Plan variable-rate applications** (fertiliser, pesticide, irrigation) based on spatial health maps.
- **Track seasonal performance** and estimate yield at the end of each growing season.

The platform runs in any modern browser — no installation required.

---

## 2. User Roles

| Role | What they can do |
|------|-----------------|
| **Farmer** | View own farms, satellite data, disease forecasts, alerts, and yield history. |
| **Agronomist** | Everything a farmer can do, plus: access risk maps, VRA tools, ML model results, and manage season records for multiple clients. |
| **Admin** | Full access to every feature plus user management, system configuration, and raw ML model controls. |

> Pages that require a higher role are hidden from users who do not have that role — you will not see broken links or error pages.

---

## 3. Getting Started

### 3.1 Create an Account

1. Open the platform URL in your browser.
2. Click **Register** on the login page.
3. Fill in your full name, e-mail address, a strong password, and your role (Farmer / Agronomist — admins are created by an existing admin).
4. Click **Create Account**.
5. You are automatically logged in and redirected to the Dashboard.

### 3.2 Log In

1. Enter your e-mail and password.
2. Click **Sign In**.
3. Check **Remember me** if you want to stay logged in on a personal device.

> Your session expires after 24 hours of inactivity. You will be redirected to the login page when it does.

### 3.3 Add Your First Farm

After logging in you will land on the Dashboard. Because no farms exist yet, the farm list will be empty. Follow these steps:

1. Click **Add Farm** in the Quick Actions panel on the dashboard, **or** open **My Farms** in the sidebar and click **+ Add Farm**.
2. Enter the farm name, crop type, total area (ha), and district / province.
3. (Optional) Pin the farm location by typing coordinates or clicking on the map.
4. Click **Save Farm**.

Satellite data for the new farm will be fetched automatically within a few minutes (background task).

---

## 4. Navigating the Application

### 4.1 Sidebar

The sidebar lists all pages grouped into sections.

| Group | Pages inside |
|-------|-------------|
| **Overview** | Dashboard, My Farms, Alerts |
| **Satellite Intelligence** | Satellite Map, Satellite Data, Stress Monitor |
| **Analysis** | Disease Classifier, Predictions, Risk Assessment |
| **Precision Agriculture** | Seasons, VRA Maps, Yield Analysis |
| **Admin** | Admin Panel *(admin only)* |
| **Account** | Profile |

**Opening the sidebar:** Click the **☰** (hamburger) button in the top-left of the header.

**Closing the sidebar:**
- Click the **‹** chevron button inside the sidebar's top-right area, **or**
- On mobile, tap anywhere on the dark overlay to the right of the sidebar.

On a wide-screen desktop (≥ 1024 px) the sidebar starts open automatically.

### 4.2 Header

- **☰ Menu button** — opens the sidebar (only visible when the sidebar is closed).
- **API status indicator** — green dot = backend online, red dot = offline.
- **Page title** — changes to reflect the active page.

---

## 5. Dashboard

**URL:** `/`

The Dashboard is your control centre. It gives you an instant overview of your entire farm portfolio without needing to open individual farm pages.

### 5.1 Hero Header

At the top of the page you will see a time-of-day greeting (*"Good morning, [Name]"*) followed by:

- How many farms are being monitored.
- How long ago the last satellite image was captured.
- Four headline metrics:

| Metric | What it shows |
|--------|--------------|
| **Farms** | Total registered farms |
| **Avg Health** | Mean health score across all farms (0–100) |
| **At Risk** | Farms currently in High Stress status |
| **Last Satellite** | Days since the most recent satellite acquisition |

### 5.2 KPI Cards Row

Five cards just below the hero give quick numeric summaries:

| Card | Description |
|------|-------------|
| Total Farms | Number of farms registered to your account |
| Fields Monitored | Farms that have received at least one satellite pass |
| Avg Health Score | Portfolio mean composite health score (green ≥ 70, amber 40–69, red < 40) |
| Fields At Risk | Farms in high-stress or critical state |
| ML Models Active | Models loaded and ready *(admin / agronomist only)* |

### 5.3 Production Units Panel

Lists up to 6 of your farms. For each farm:

- **Health Gauge** — circular SVG dial indicating health score.
- **Crop type** — detected by ML or set manually.
- **Area** — farm size in hectares.
- **Last update** — time since last satellite pass.
- **Health badge** — colour-coded: Healthy / Moderate / Stressed.
- **Quick links** — jump directly to the Satellite Map or Farm Details for that farm.

### 5.4 Vegetation Timeline Chart

A 90-day line chart showing three vegetation indices for the featured farm:

- **NDVI** (Normalised Difference Vegetation Index) — general crop greenness.
- **NDRE** (Normalised Difference Red-Edge) — nitrogen and chlorophyll stress proxy.
- **EVI** (Enhanced Vegetation Index) — atmospheric-corrected greenness.

Horizontal reference lines mark typical healthy and stressed thresholds. Hover over any data point to see the exact date and value.

### 5.5 NDVI Field Ranking *(admin / agronomist)*

A horizontal bar chart listing all farms sorted by their current NDVI. Use this to quickly identify the fields that need attention.

### 5.6 Satellite Intelligence Summary

For the top-ranked farm this panel shows:

- Latest readings for NDVI, NDRE, EVI, NDWI (water index), and Stress Level.
- Date of the last satellite observation.

### 5.7 Health Distribution Chart

A donut chart splitting your farms into three health categories:
- **Healthy** (score ≥ 70)
- **Moderate** (score 40–69)
- **Stressed** (score < 40)

### 5.8 Active Alerts

Up to 5 of the most recent non-low alerts with:

- Coloured severity dot (red = critical, orange = high, yellow = medium).
- Alert message and timestamp.
- Severity badge.

Click **View All Alerts** to open the Early Warning page.

### 5.9 Quick Actions

Four one-click tiles for common tasks:

| Tile | Goes to |
|------|---------|
| **Add Farm** | Farm registration form |
| **Satellite Map** | Full satellite map viewer |
| **Disease AI** | disease classifier tool |
| **View Alerts** | Early Warning / Alerts page |

---

## 6. Farm Management

**URL:** `/farms`

### 6.1 Farm List

The farm list shows all farms in a card grid. Each card displays:

- Farm name and crop type.
- Area (ha), district / province.
- Latest health score and NDVI.
- Last satellite date.
- Quick action buttons: **Details**, **Satellite**, **Edit**, **Delete**.

Use the **Search** bar to filter by name and the **Sort** dropdown to order by name, health score, area, or last update.

### 6.2 Adding a Farm

1. Click **+ Add Farm**.
2. Complete the form:

| Field | Notes |
|-------|-------|
| Farm Name | Required. A short descriptive name works best. |
| Crop Type | Select from the list or leave blank for AI auto-detection. |
| Area (ha) | Total cultivated area. |
| District | Administrative district. |
| Province | Province for regional grouping. |
| Latitude / Longitude | Used to fetch satellite data. Enter decimal degrees (e.g. −1.9441, 29.8739). |

3. Click **Save Farm**. The farm appears in the list immediately.

### 6.3 Editing a Farm

1. Click **Edit** on the farm card (or pencil icon).
2. Modify the fields you want to change.
3. Click **Update Farm**.

### 6.4 Deleting a Farm

1. Click **Delete** on the farm card.
2. Confirm the deletion in the dialog.

> **Warning:** Deletion removes the farm record and all associated satellite history. This action cannot be undone.

### 6.5 Farm Detail View

Click **Details** on a farm card to open its detail view. Tabs inside include:

- **Overview** — all farm attributes and health summary.
- **Satellite History** — timeline of past satellite acquisitions with NDVI / NDRE / EVI / NDWI readings.
- **Predictions** — ML crop and disease prediction results.
- **Field Boundary** — optional GeoJSON polygon drawn on a map.

---

## 7. Satellite Intelligence

### 7.1 Satellite Map

**URL:** `/satellite-dashboard`

The main interactive map — a Mapbox satellite-powered workspace for visual exploration, field intelligence, and precision agriculture.

**What you can do:**

- Pan and zoom across the map to see your farms (coloured markers by health status).
- Click any farm marker to open an info popup with latest indices.
- Use the **Layer Selector** (top-right) to switch between satellite base layers and index overlays:

| Overlay | What it shows |
|---------|--------------|
| NDVI | Canopy greenness (red–yellow–green gradient) |
| NDRE | Red-edge stress indicator |
| EVI | Atmospheric-corrected vegetation |
| NDWI | Crop water content |
| SAVI | Soil-adjusted vegetation (sparse canopies) |
| MSAVI | Modified SAVI for bare-soil areas |
| RGB | True-colour composite |

- Toggle **Farm Boundaries** to see polygon outlines if boundaries have been uploaded.
- Click **Refresh Tiles** to force-reload cached index tiles.

**Reading the health legend:**

- **Green markers** — Healthy (NDVI ≥ 0.6)
- **Orange markers** — Moderate (NDVI 0.4–0.59)
- **Red markers** — Stressed (NDVI < 0.4)
- **Grey markers** — No data yet

#### 7.1.1 Field Intelligence Panel

Click a farm on the map to open the **Field Intelligence Panel** — a tabbed side-panel that provides deep analytics for the selected field.

| Tab | What it shows |
|-----|---------------|
| **Status** | Current NDVI, weather, composite health score, actionable insights |
| **Vegetation** | NDVI / NDRE / EVI / NDWI time-series chart (90 days) |
| **Yield Analysis** | NDVI-based yield estimation + season comparison |
| **Prescription maps** | List of existing VRA maps + "Create VRA map" button |

**Quick-action toolbar** at the top of the panel provides one-click access to:
- **Scan** — run a new satellite analysis for the farm.
- **Prescription map** — open the OneSoil-style VRA map creator (see §9.2).
- **Soil sampling** — generate a grid- or zone-based soil sampling plan.

#### 7.1.2 Productivity Zone Overlays

After scanning a farm (or once zones have been computed), **productivity zones** are rendered as coloured polygon overlays on the map:

| Zone | Colour | Meaning |
|------|--------|---------|
| **High** | Green | Strong vegetation — reduce or maintain inputs |
| **Medium** | Amber | Average productivity — standard input rate |
| **Low** | Red | Weak vegetation — increase inputs or investigate |

Hover over a zone to see a tooltip with the zone label, mean NDVI, and area in hectares. These zones are computed from GEE Sentinel-2 imagery using K-means clustering.

### 7.2 Satellite Data

**URL:** `/satellite`

A tabular view of every satellite acquisition for your farms.

Columns: Farm name, acquisition date, NDVI, NDRE, EVI, NDWI, SAVI, MSAVI, cloud cover %, data source (Sentinel-2 / Landsat-8 / Planetary Computer).

**Filters:** Date range picker, farm selector, index threshold slider.

**Export:**

- Click **Export CSV** to download the filtered results as a spreadsheet.

### 7.3 Stress Monitor

**URL:** `/stress-monitoring`

Detects abiotic stress events (drought, waterlogging, heat) using a fusion of vegetation indices, water indices, and temperature data.

**How to read the Stress Monitor:**

- Each farm shows a **Stress Score** (0–100) and a **Stress Level** badge: None / Mild / Moderate / Severe / Critical.
- A trend arrow (**↑ Improving** / **→ Stable** / **↓ Worsening**) shows the 7-day change.
- The detail chart shows the last 30 days of each stress factor plotted separately.

**Recommended actions:**

| Stress Level | Suggested Action |
|-------------|-----------------|
| None–Mild | Continue standard scheduling |
| Moderate | Scout field, check irrigation records |
| Severe | Field inspection within 48 hours, adjust irrigation |
| Critical | Immediate field visit, alert agronomist |

---

## 8. Analysis Tools

### 8.1 Disease Classifier

**URL:** `/disease-classifier`

Upload a photo of a crop leaf or plant and the AI model will identify the disease (or confirm the plant is healthy).

**Steps:**

1. Click **Upload Image** (or drag and drop a JPG/PNG file, max 10 MB).
2. Select the crop type from the dropdown for better accuracy.
3. Click **Analyse**.
4. Within a few seconds you will see:
   - **Top prediction** with confidence percentage.
   - **Alternative diagnoses** (up to 4) with lower confidence scores.
   - **Recommended actions** based on the prediction.

**Tips for better results:**

- Photograph **a single leaf** against a plain background.
- Use natural daylight — avoid flash or strong shadows.
- Ensure the lesion, spot, or discolouration is centred and in focus.
- Avoid images with water droplets or dust.

### 8.2 Disease Forecasts (Predictions)

**URL:** `/predictions` *(admin / agronomist)*

Uses historical satellite imagery and weather data to forecast disease risk 7–14 days ahead for each farm.

**Reading forecast results:**

| Risk Level | Meaning |
|------------|---------|
| **Low** | Conditions unfavourable for disease development |
| **Medium** | Monitor closely; preventive action may be warranted |
| **High** | Disease outbreak likely; plan intervention |
| **Critical** | Immediate action required |

Each forecast also shows:
- Which disease(s) are most likely.
- The primary contributing factors (moisture index, temperature anomaly, NDRE drop, etc.).
- Confidence score.

### 8.3 Risk Assessment

**URL:** `/risk-assessment`

A portfolio-level risk summary that combines disease forecasts, stress scores, weather anomalies, and historical crop loss data.

**Output panels:**

- **Risk Heatmap** — colour grid of risk by farm × risk category.
- **Priority Action List** — ranked list of farms requiring intervention (highest risk first).
- **Historical Comparison** — current risk vs. the same period in previous seasons.

---

## 9. Precision Agriculture

### 9.1 Season Manager

**URL:** `/seasons`

Track the full lifecycle of each growing season for every farm.

**Creating a Season:**

1. Open **Seasons** from the sidebar.
2. Click **+ New Season**.
3. Enter: farm, crop, planting date, expected harvest date, and any notes.
4. Click **Save**.

As the season progresses, update:
- **Growth Stage** — seedling, vegetative, reproductive, maturity.
- **Inputs Applied** — fertiliser type, quantity, date.
- **Irrigation Events** — volume and date.

At season end, record the **Actual Yield** to feed the yield analysis model.

### 9.2 VRA Maps (Variable Rate Application)

**URL:** Accessible from the **Satellite Map** → Field Intelligence Panel → **Prescription maps** tab, or via the **Prescription map** quick-action button.

VRA maps divide a field into productivity zones and assign different input rates (fertiliser, seed, pesticide) to each zone. This reduces input costs and targets underperforming areas. The interface follows the **OneSoil** design pattern — a professional precision-ag workflow.

#### 9.2.1 Creating a VRA Map

1. Open the Satellite Map and click the farm you want to manage.
2. In the Field Intelligence Panel, click the **"Prescription map"** button (in the toolbar) or switch to the **Prescription maps** tab and click **"+ Create VRA map"**.
3. The **Create VRA Map** modal opens with two steps:

**Step 1 — Choose prescription type:**

| Type | Icon | Typical unit |
|------|------|--------------|
| **Planting** | Sprout | seeds/ha |
| **Crop protection** | Shield | L/ha |
| **Fertiliser application** | Flask | kg/ha |
| **Multiple inputs** | Layers | kg/ha *(coming soon)* |

Click a card to select it (dark border highlights the active type).

**Step 2 — Choose data source:**

| Source | Description |
|--------|-------------|
| **Productivity map** | Uses K-means productivity zones computed from GEE satellite data. If zones have not been computed yet, the system auto-computes them (a spinner shows progress). |
| **Recent NDVI image** | Uses the latest NDVI raster directly. |
| **Soil analysis results** | Uses uploaded soil sample data. |

4. Click the black **"Create map"** button.
5. The backend generates a prescription with zone-specific rates and the **VRA Result View** opens automatically.

#### 9.2.2 VRA Result View (Full-Screen)

After creating or viewing a VRA map you enter a full-screen split-screen view with three panels:

**Left — Settings Sidebar:**
- **Map settings**: prescription type selector, data source, number of zones.
- **Prescription settings**: crop name, variety, standard rate and unit.
- **Zone rate table**: shows each zone (Zone 1 / 2 / 3) with a colour indicator, area percentage, and editable rate values.
  - Zone colours: deep purple (high productivity), medium purple, light purple (low productivity).
- **Invert rates** toggle: swap high/low zone rates.
- **Trial mode** toggle: enable split-field test strips.
- **Save** and **Export** buttons:
  - **Save** — stores the prescription to the platform database.
  - **Export** — download as GeoJSON (for precision equipment) or ISOXML.

**Centre — VRA Zone Map:**
- Full Mapbox satellite map showing the field with VRA zone polygons overlaid in purple shades.
- Hover over a zone to see a tooltip with the zone label, recommended application rate, and area in hectares.
- A legend at the bottom shows the zone colour scale.

**Right — Productivity Map:**
- A second Mapbox satellite map showing the underlying productivity zones used to generate the prescription.
- Zone colours: green (high productivity), amber (medium), red (low).
- Provides a visual comparison of the source data side-by-side with the generated prescription.

#### 9.2.3 Viewing Existing VRA Maps

In the **Prescription maps** tab of the Field Intelligence Panel:
- All previously created VRA maps for the selected farm are listed as cards.
- Each card shows: prescription type icon, product name, base rate, zone rate summary, and potential savings percentage.
- Click any card to re-open the full-screen **VRA Result View** for that prescription.
- Click **"+ Create VRA map"** to generate a new one.

#### 9.2.4 Understanding Zone Rates

The system divides the field into three productivity zones and assigns adjusted input rates:

| Zone | Productivity | Default logic | Example (100 kg/ha base) |
|------|-------------|---------------|-------------------------|
| **High** | Strong vegetation | Reduce inputs (0.8× multiplier) | 80 kg/ha |
| **Medium** | Average | Standard rate (1.0×) | 100 kg/ha |
| **Low** | Weak vegetation | Increase inputs (1.2× multiplier) | 120 kg/ha |

Rates are fully editable in the settings sidebar. The **Invert rates** toggle reverses the logic (e.g. for seeding where you want more seed in the productive zones).

> **Tip:** After creating a VRA map, use the **Export** button to download a GeoJSON file that can be loaded directly into variable-rate application hardware.

### 9.3 Yield Analysis

**URL:** `/yield-analysis`

Estimates end-of-season yield range based on the vegetation index trajectory and actual recorded yields from previous seasons.

**Dashboard panels:**

| Panel | Content |
|-------|---------|
| **Yield Forecast** | Estimated yield range (tonnes/ha) with confidence interval |
| **NDVI × Yield Correlation** | Scatter plot of past season NDVI vs. actual yield |
| **Season Comparison** | Bar chart of yield per season per farm |
| **Anomaly Flags** | Flags seasons where yield deviated significantly from the forecast |

---

## 10. Early Warning Alerts

**URL:** `/early-warning`

Alerts are automatically generated by the backend when thresholds are crossed. You can also configure custom thresholds.

### 10.1 Alert Types

| Category | Examples |
|----------|---------|
| **NDVI Drop** | NDVI declines > 15 % in 7 days |
| **Disease Risk** | Forecast risk crosses High or Critical |
| **Stress Event** | Stress score jumps to Severe or Critical |
| **Weather Anomaly** | Prolonged drought, excess rainfall, heat wave |
| **System** | Satellite data delayed, ML model retraining complete |

### 10.2 Alert Severity Levels

| Level | Colour | Action |
|-------|--------|--------|
| **Low** | Blue | Informational only; no immediate action needed |
| **Medium** | Yellow | Monitor; plan a field check within the week |
| **High** | Orange | Field inspection within 48 hours |
| **Critical** | Red | Immediate response required |

### 10.3 Managing Alerts

- **Acknowledge** — marks the alert as seen; removes it from the Dashboard active panel.
- **Dismiss** — permanently archives the alert.
- **Filter** — use the Severity and Farm dropdowns to focus on specific issues.
- **Export** — download the filtered alert list as CSV.

### 10.4 Custom Thresholds

1. Click **Manage Thresholds** at the top of the Alerts page.
2. Select the metric (e.g. NDVI, Stress Score, Disease Risk).
3. Set the farm (or select **All Farms**).
4. Enter the trigger value and severity level.
5. Click **Save Threshold**.

---

## 11. Admin Panel

**URL:** `/admin` *(admin only)*

### 11.1 User Management

A table of all registered users showing name, e-mail, role, registration date, and active status.

**Actions:**

| Action | How |
|--------|-----|
| Change role | Click the role badge and select a new role from the dropdown |
| Deactivate account | Toggle the **Active** switch off |
| Delete user | Click the red trash icon (irreversible) |
| Reset password | Click **Send Reset Link** to e-mail the user a password reset link |

### 11.2 System Configuration

Settings available to admins:

| Setting | Description |
|---------|-------------|
| Satellite fetch schedule | Set how often the background satellite task runs (default: daily) |
| GEE asset path | Path to the Google Earth Engine service account asset folder |
| Alert notification e-mail | System sends daily digest to this address |
| ML model version | Select which version of each trained model to use in production |

### 11.3 ML Model Management

- View all loaded models with their accuracy statistics.
- Upload a new `.pkl` or `.joblib` model file.
- Run a manual prediction sweep across all farms (triggers a Celery task).
- Download model performance reports.

---

## 12. Profile & Account Settings

**URL:** `/profile`

| Setting | Notes |
|---------|-------|
| **Full Name** | Update your display name |
| **E-mail Address** | Used for login and alert notifications |
| **Password** | Must be at least 8 characters; use the strength metre as a guide |
| **Notification Preferences** | Choose which alert severities trigger an e-mail |
| **Preferred Units** | Hectares or acres; Celsius or Fahrenheit |
| **Language** | UI language selection (English supported by default) |

Click **Save Changes** after updating any field.

---

## 13. Frequently Asked Questions

**Q: How fresh is the satellite data?**

A: The platform fetches new Sentinel-2 imagery every 5 days (the satellite revisit cycle). In cloudy regions the gap can be longer because cloud-covered images are automatically excluded. The date shown on each card is the last *cloud-free* acquisition.

---

**Q: What does a health score of 0 or "—" mean?**

A: A score of 0 or a dash means no valid satellite image has been processed for that farm yet. This typically resolves within a few minutes of adding a new farm, or within 24 hours if the satellite is currently outside the revisit window.

---

**Q: Why is my farm showing a low NDVI even though the crop looks healthy?**

A: Several things can cause this:
- **Young crop / recent planting** — bare soil between rows lowers the index early in the season.
- **Cloud shadow or thin clouds** — the automated cloud filter sometimes misses haze. Check the true-colour (RGB) layer on the Satellite Map.
- **Harvest / tillage** — a newly harvested or ploughed field has bare soil, giving a very low NDVI.
- **Date mismatch** — make sure the displayed date matches the expected growth stage.

---

**Q: I uploaded an image to the Disease Classifier but got low confidence (<50%). What should I do?**

A: Try:
1. Retaking the photo in better light.
2. Selecting the correct crop type from the dropdown.
3. Photographing a clearer example of the symptom (a fresh lesion rather than dried-out tissue).
4. Cross-referencing with the Disease Forecasts page for the farm to see which pathogen is most likely in the current conditions.

---

**Q: How do I add a field boundary to my farm?**

A: On the Farm Detail page open the **Field Boundary** tab and click **Draw Boundary**. Use the polygon tool on the map to trace the field perimeter. Click the first point again (or click **Finish**) to close the polygon. Click **Save Boundary**. Once saved, boundaries appear as outlines on the Satellite Map and improve the accuracy of index calculations (which will otherwise use a point buffer).

---

**Q: Can I export my data?**

A: Yes:
- **Satellite Data** page — Export CSV button.
- **Alerts** page — Export CSV button.
- **VRA Maps** — Export as GeoTIFF or PDF.
- **Yield Analysis** — Export CSV.

For a full data export (all tables) contact your system administrator.

---

**Q: The satellite map tiles are not loading — I just see a grey square.**

A: This usually means:
- The Google Earth Engine (GEE) service account is not configured — ask your admin to check the GEE credentials.
- The farm coordinates are outside Rwanda / the configured region. Verify the latitude and longitude on the farm form.
- Tiles are still being generated. Wait 2–3 minutes and click **Refresh Tiles**.

---

**Q: How is the composite Health Score calculated?**

A: The health score is a weighted average of several indices:

| Index | Weight |
|-------|--------|
| NDVI | 35 % |
| NDRE | 25 % |
| EVI | 20 % |
| NDWI | 10 % |
| SAVI | 10 % |

Each raw index value is mapped to a 0–100 scale before weighting. The final score is colour-coded: green (≥ 70), amber (40–69), red (< 40).

---

## 14. Glossary

| Term | Definition |
|------|-----------|
| **NDVI** | Normalised Difference Vegetation Index. Measures canopy greenness using red and near-infrared bands. Range −1 to 1; healthy crops typically 0.4–0.9. |
| **NDRE** | Normalised Difference Red-Edge Index. More sensitive than NDVI to early stress and chlorophyll content. |
| **EVI** | Enhanced Vegetation Index. Similar to NDVI but corrects for atmospheric interference and soil background. Useful in dense canopies. |
| **NDWI** | Normalised Difference Water Index. Indicates crop water content. Low values signal drought stress. |
| **SAVI** | Soil-Adjusted Vegetation Index. Reduces soil background noise for sparse or emerging crops. |
| **MSAVI** | Modified SAVI. Self-adjusting version of SAVI; no need to set a soil factor constant. |
| **Composite Health Score** | Single 0–100 metric summarising all vegetation indices (see FAQ above). |
| **VRA** | Variable Rate Application. Precision-agronomy technique applying different input doses across zones of a field. |
| **GEE** | Google Earth Engine. Cloud satellite data processing platform used to compute index tiles. |
| **Sentinel-2** | ESA satellite constellation providing free 10-metre-resolution optical imagery every 5 days. |
| **Landsat-8** | USGS/NASA satellite providing free 30-metre-resolution imagery every 16 days; used as fallback. |
| **Celery** | Background task queue used by the backend to run satellite fetch, ML predictions, and alert generation without blocking the UI. |
| **Phenology** | The study of cyclic plant life stages (germination, flowering, maturity). The platform tracks phenological stage from NDVI trajectory. |
| **Growth Stage** | Current development phase of the crop: Seedling → Vegetative → Reproductive → Maturity → Harvest. |

---

*For technical issues, deployment help, or API integration questions see [README.md](README.md) and [API_REFERENCE.md](API_REFERENCE.md).*

*Last updated: see repository changelog.*

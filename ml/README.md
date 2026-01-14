# Crop-Type MVP (Radiant MLHub + GEE + RandomForest)

This folder contains a minimal, proven pipeline:

1) **Radiant MLHub** provides labeled crop polygons (you download them).
2) **Google Earth Engine (GEE)** extracts Sentinel‑2 time-series features per polygon.
3) **Python + scikit‑learn RandomForest** trains a multi-class crop classifier.

## 0) Prereqs

- You have access to **Google Earth Engine**.
- You have downloaded a **Radiant MLHub** crop-label dataset file (GeoJSON / GPKG / SHP).

## 1) Install ML dependencies

From repo root:

- Create a virtual env (recommended)
- Install:

`pip install -r ml/requirements.txt`

## 2) Authenticate Earth Engine

In a terminal:

`earthengine authenticate`

Then verify:

`python -c "import ee; ee.Initialize(); print('EE OK')"`

## 3) Import labels into PostGIS (optional but recommended)

If your label file has a crop column (e.g. `crop`, `class`, `crop_name`):

`python -m scripts.import_crop_labels --input <PATH_TO_LABELS> --crop-field <CROP_COLUMN> --source RadiantMLHub --country Rwanda`

If you have a local PostgreSQL installed on your machine, Docker may not be able to use port 5433.
This repo uses `5434` for the Docker database port mapping.

This loads polygons into `crop_labels`.

## 4) Export label polygons to GeoJSON for GEE

Earth Engine works cleanly with GeoJSON inputs. Export from DB:

`python ml/export_labels_from_db.py --output ml/labels.geojson --limit 2000`

## 5) Extract Sentinel‑2 features using GEE

Example (monthly time series, 12 steps):

`python ml/export_gee_timeseries.py --labels ml/labels.geojson --label-field crop_name --start 2024-01-01 --end 2024-12-31 --period months --out ml/train_features.csv`

## 6) Train RandomForest

`python ml/train_random_forest.py --data ml/train_features.csv --label-field crop_name --out-dir ml/models`

Outputs:
- `ml/models/crop_rf.joblib`
- `ml/models/label_encoder.joblib`
- `ml/models/feature_columns.json`

## 7) Predict crop type for your farms

1) Export farms to GeoJSON:

`python ml/export_farms_from_db.py --output ml/farms.geojson --limit 5000`

2) Extract farm features:

`python ml/export_gee_timeseries.py --labels ml/farms.geojson --id-field id --start 2024-01-01 --end 2024-12-31 --period months --out ml/farm_features.csv`

3) Predict:

`python ml/predict_crops.py --model-dir ml/models --features ml/farm_features.csv --id-field id --out ml/farm_predictions.csv`

For MVP we output a CSV with:
- `id` (farm id)
- `predicted_crop`
- `confidence`

Later we can add an API endpoint / DB columns to store predictions.

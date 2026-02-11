from .celery_app import celery_app
from pathlib import Path
import rasterio
import numpy as np
import os
import json
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
import re
from datetime import datetime, timedelta
from app.db.database import SessionLocal
from app.models.farm import Farm
from app.models.disease import Disease, DiseasePrediction
from app.models.alert import Alert
from app.services.disease_intelligence import DiseaseModelEngine
from app.services.weather_service import WeatherDataIntegrator
from app.core.config import settings


def compute_mean_ndvi_file(tif_path: str) -> float:
    p = Path(tif_path)
    if not p.exists():
        raise FileNotFoundError(tif_path)
    with rasterio.open(str(p)) as src:
        arr = src.read(1).astype('float32')
        nodata = src.nodata
        if nodata is not None:
            arr = np.where(arr == nodata, np.nan, arr)
        mean = float(np.nanmean(arr))
    return mean


def _infer_date_region_from_filename(fp: str):
    """Try to infer a date (YYYYMMDD) and a region token from filename.

    Returns (date_str, region) where date_str is ISO date 'YYYY-MM-DD' or None.
    """
    name = Path(fp).stem
    # look for YYYYMMDD
    m = re.search(r"(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])", name)
    date_str = None
    if m:
        y, mo, d = m.group(1), m.group(2), m.group(3)
        try:
            dt = datetime(int(y), int(mo), int(d))
            date_str = dt.strftime('%Y-%m-%d')
        except Exception:
            date_str = None

    # attempt region token: first token before date or first token in filename
    region = None
    if date_str:
        parts = re.split(r'_|-|\.', name)
        for i, part in enumerate(parts):
            if re.search(r"20\d{6}", part):
                if i > 0:
                    region = parts[i-1]
                break
    if not region:
        # fallback: use prefix up to first underscore
        parts = name.split('_')
        if len(parts) > 1:
            region = parts[0]
    return date_str, region


@celery_app.task(bind=True)
def process_image_task(self, file_path: str, date: str = None, region: str = None):
    """Compute mean NDVI for a file and insert/update the satellite_images table.

    `DATABASE_URL` env var must be set for DB writes. If DB is unavailable, the task
    will write to `data/ndvi_means.json` as a fallback.
    """
    if not settings.SATELLITE_LOCAL_STORAGE_ENABLED:
        return {
            'skipped': True,
            'reason': 'local satellite storage disabled',
            'file_path': file_path,
        }
    mean = compute_mean_ndvi_file(file_path)
    db_url = os.environ.get('DATABASE_URL')
    record = {'file_path': file_path, 'mean_ndvi': mean}

    if not db_url:
        # write to JSON fallback
        out = Path('data/ndvi_means.json')
        out.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = {}
            if out.exists():
                data = json.loads(out.read_text(encoding='utf-8'))
            data[file_path] = mean
            out.write_text(json.dumps(data, indent=2), encoding='utf-8')
        except Exception as e:
            raise
        return record

    # Use NullPool to avoid leaking pooled connections across many short-lived tasks.
    engine = create_engine(db_url, poolclass=NullPool, pool_pre_ping=True, pool_recycle=3600)
    conn = engine.connect()
    try:
        existing = conn.execute(
            text('SELECT id, extra_metadata FROM satellite_images WHERE file_path = :fp'),
            {'fp': file_path},
        ).fetchone()
        if existing:
            row_id = existing[0]
            meta = existing[1] or {}
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except Exception:
                    meta = {}
            meta['mean_ndvi'] = mean
            conn.execute(text('UPDATE satellite_images SET extra_metadata = :meta WHERE id = :id'), {'meta': json.dumps(meta), 'id': row_id})
        else:
            if not date or not region:
                # cannot insert without date/region, fallback to JSON
                out = Path('data/ndvi_means.json')
                out.parent.mkdir(parents=True, exist_ok=True)
                data = {}
                if out.exists():
                    data = json.loads(out.read_text(encoding='utf-8'))
                data[file_path] = mean
                out.write_text(json.dumps(data, indent=2), encoding='utf-8')
            else:
                conn.execute(text('INSERT INTO satellite_images (date, region, image_type, file_path, extra_metadata) VALUES (:date,:region,:type,:fp,:meta)'),
                             {'date': date, 'region': region, 'type': 'NDVI', 'fp': file_path, 'meta': json.dumps({'mean_ndvi': mean})})
    finally:
        conn.close()
        engine.dispose()


@celery_app.task(bind=True)
def generate_disease_predictions_task(self):
    """Generate disease predictions for all farms on a schedule."""
    db = SessionLocal()
    results = {
        'farms_processed': 0,
        'predictions_created': 0,
        'errors': 0
    }

    try:
        farms = db.query(Farm).all()
        diseases = db.query(Disease).all()

        if not farms or not diseases:
            return {
                'farms_processed': len(farms),
                'predictions_created': 0,
                'errors': 0,
                'message': 'No farms or diseases found'
            }

        disease_engine = DiseaseModelEngine()
        weather_integrator = WeatherDataIntegrator()

        for farm in farms:
            if farm.latitude is None or farm.longitude is None:
                continue

            results['farms_processed'] += 1

            try:
                weather_data = weather_integrator.integrate_multi_source_data(
                    lat=farm.latitude,
                    lon=farm.longitude,
                    start_date=datetime.now() - timedelta(days=1),
                    end_date=datetime.now()
                )
                disease_risk_factors = weather_integrator.calculate_disease_risk_factors(weather_data)
                weather_data['disease_risk_factors'] = disease_risk_factors
            except Exception:
                results['errors'] += 1
                continue

            for disease in diseases:
                try:
                    disease_name_lower = disease.name.lower()

                    if 'late blight' in disease_name_lower:
                        disease_pred = disease_engine.predict_late_blight(weather_data)
                    elif 'septoria' in disease_name_lower:
                        disease_pred = disease_engine.predict_septoria_leaf_spot(weather_data)
                    elif 'powdery mildew' in disease_name_lower:
                        disease_pred = disease_engine.predict_powdery_mildew(weather_data)
                    elif 'bacterial spot' in disease_name_lower:
                        disease_pred = disease_engine.predict_bacterial_spot(weather_data)
                    elif 'fusarium' in disease_name_lower:
                        disease_pred = disease_engine.predict_fusarium_wilt(weather_data)
                    else:
                        continue

                    prediction = DiseasePrediction(
                        farm_id=farm.id,
                        disease_id=disease.id,
                        prediction_date=datetime.now().date(),
                        forecast_horizon='current',
                        risk_score=disease_pred['risk_score'],
                        risk_level=disease_pred['risk_level'],
                        infection_probability=disease_pred.get('infection_probability', 0.5),
                        days_to_symptom_onset=disease_pred.get('days_to_symptoms'),
                        weather_risk_score=disease_pred['risk_score'],
                        risk_factors=disease_risk_factors,
                        weather_conditions=weather_data,
                        model_version=settings.DISEASE_MODEL_VERSION,
                        confidence_score=disease_pred.get('confidence_score', 75.0),
                        action_threshold_reached=disease_pred['risk_score'] >= 60,
                        recommended_actions=disease_pred.get('recommended_actions', []),
                        treatment_window=disease_pred.get('action_threshold'),
                        estimated_yield_loss_pct=min(disease_pred['risk_score'] / 2, 50)
                    )

                    db.add(prediction)
                    results['predictions_created'] += 1

                    # Create alert for high/severe risk
                    if disease_pred['risk_level'] in ['high', 'severe']:
                        alert_message = (
                            f"{disease.name} risk {disease_pred['risk_score']:.1f}/100 "
                            f"({disease_pred['risk_level']}). "
                            f"Action: {disease_pred.get('action_threshold', 'monitor')}."
                        )
                        db.add(Alert(
                            farm_id=farm.id,
                            message=alert_message,
                            level=disease_pred['risk_level']
                        ))

                except Exception:
                    results['errors'] += 1
                    continue

            db.commit()

        return results

    finally:
        db.close()
    return record


@celery_app.task(bind=True)
def scan_and_enqueue(self, data_dir: str = 'data/sentinel2'):
    """Scan `data_dir` for .tif files and enqueue `process_image_task` for files
    that do not yet have `mean_ndvi` recorded in the DB or JSON fallback.
    Returns a dict with enqueued file paths.
    """
    if not settings.SATELLITE_LOCAL_STORAGE_ENABLED:
        return {'enqueued': [], 'skipped': True, 'reason': 'local satellite storage disabled'}
    p = Path(data_dir)
    if not p.exists():
        return {'enqueued': []}

    tif_files = list(p.rglob('*.tif')) + list(p.rglob('*.tiff'))
    seen = set()

    db_url = os.environ.get('DATABASE_URL')
    if db_url:
        try:
            engine = create_engine(db_url, poolclass=NullPool, pool_pre_ping=True, pool_recycle=3600)
            conn = engine.connect()
            rows = conn.execute(text('SELECT file_path, extra_metadata FROM satellite_images')).fetchall()
            for r in rows:
                fp = r[0]
                meta = r[1] or {}
                if isinstance(meta, str):
                    try:
                        meta = json.loads(meta)
                    except Exception:
                        meta = {}
                if isinstance(meta, dict) and meta.get('mean_ndvi') is not None:
                    seen.add(fp)
        except Exception:
            # if DB fails, fallback to json below
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass
            try:
                engine.dispose()
            except Exception:
                pass

    # fallback: read JSON file of previously computed means
    if not seen and settings.SATELLITE_LOCAL_STORAGE_ENABLED:
        out = Path('data/ndvi_means.json')
        if out.exists():
            try:
                j = json.loads(out.read_text(encoding='utf-8'))
                for k in j.keys():
                    seen.add(k)
            except Exception:
                pass

    enqueued = []
    for f in tif_files:
        fp = str(f)
        if fp in seen:
            continue
        # infer date/region from filename when possible
        date_str, region = _infer_date_region_from_filename(fp)
        try:
            process_image_task.delay(fp, date_str, region)
            enqueued.append(fp)
        except Exception:
            pass

    return {'enqueued': enqueued}



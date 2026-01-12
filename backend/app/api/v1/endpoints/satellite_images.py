from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Any, Dict, List, Optional
import os
from pathlib import Path
from datetime import datetime
from sqlalchemy import func
from app.db.database import get_db
from app.models.data import SatelliteImage
from app.tasks.process_tasks import scan_and_enqueue
from app.tasks.celery_app import celery_app

router = APIRouter()


def _count_disk_images(base_dir: Path) -> int:
    if not base_dir.exists():
        return 0
    patterns = ("*.tif", "*.tiff", "*.jp2", "*.png", "*.jpg", "*.jpeg")
    total = 0
    for pat in patterns:
        total += sum(1 for _ in base_dir.rglob(pat))
    return total


def _latest_mtime_iso(base_dir: Path) -> Optional[str]:
    if not base_dir.exists():
        return None
    latest: Optional[float] = None
    for p in base_dir.rglob("*"):
        if not p.is_file():
            continue
        try:
            m = p.stat().st_mtime
        except OSError:
            continue
        if latest is None or m > latest:
            latest = m
    if latest is None:
        return None
    return datetime.utcfromtimestamp(latest).isoformat() + "Z"

@router.get("/", response_model=List[dict])
def list_satellite_images(db: Session = Depends(get_db)):
    images = db.query(SatelliteImage).all()
    return [
        {
            "id": img.id,
            "date": img.date,
            "region": img.region,
            "image_type": img.image_type,
            "file_path": img.file_path,
            "extra_metadata": img.extra_metadata
        }
        for img in images
    ]


@router.get("/count")
def satellite_images_count(db: Session = Depends(get_db)) -> Dict[str, int]:
    """Fast count of satellite image rows in the database."""
    return {"count": int(db.query(func.count(SatelliteImage.id)).scalar() or 0)}


@router.get("/stats")
def satellite_images_stats(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Return DB + disk stats so dashboards can reflect real current data."""
    db_count = int(db.query(func.count(SatelliteImage.id)).scalar() or 0)
    latest_date = db.query(func.max(SatelliteImage.date)).scalar() if db_count else None

    # Container paths: compose mounts ./data -> /app/data
    project_root = Path(os.getcwd())
    data_dir = project_root / "data"
    sentinel2_dir = data_dir / "sentinel2"
    sentinel2_real_dir = data_dir / "sentinel2_real"

    disk_counts = {
        "sentinel2": _count_disk_images(sentinel2_dir),
        "sentinel2_real": _count_disk_images(sentinel2_real_dir),
    }

    disk_latest = {
        "sentinel2": _latest_mtime_iso(sentinel2_dir),
        "sentinel2_real": _latest_mtime_iso(sentinel2_real_dir),
    }

    return {
        "db": {
            "count": db_count,
            "latest_date": str(latest_date) if latest_date else None,
        },
        "disk": {
            "counts": disk_counts,
            "latest_mtime": disk_latest,
        },
    }

@router.get("/download/{image_id}")
def download_satellite_image(image_id: int, db: Session = Depends(get_db)):
    img = db.query(SatelliteImage).filter(SatelliteImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    file_path = img.file_path
    if not os.path.isabs(file_path):
        # Assume relative to project root
        file_path = os.path.join(os.getcwd(), file_path.lstrip("/\\"))
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(file_path, filename=os.path.basename(file_path))


@router.get("/ndvi-means")
def get_ndvi_means(source: str = 'db', db: Session = Depends(get_db)):
    """Return NDVI mean values.

    - `source=db` (default): read from `satellite_images.extra_metadata.mean_ndvi`.
    - `source=json`: read from `data/ndvi_means.json` fallback file.
    """
    results = []
    if source == 'json':
        json_path = os.path.join(os.getcwd(), 'data', 'ndvi_means.json')
        if not os.path.exists(json_path):
            raise HTTPException(status_code=404, detail="ndvi_means.json not found")
        import json
        with open(json_path, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        for fp, mean in data.items():
            results.append({
                'file_path': fp,
                'mean_ndvi': mean
            })
        return results

    # default: read from DB
    images = db.query(SatelliteImage).all()
    for img in images:
        meta = img.extra_metadata or {}
        # meta may be a JSON string depending on DB driver
        if isinstance(meta, str):
            try:
                import json
                meta = json.loads(meta)
            except Exception:
                meta = {}
        mean = None
        if isinstance(meta, dict):
            mean = meta.get('mean_ndvi')
        results.append({
            'id': img.id,
            'file_path': img.file_path,
            'mean_ndvi': mean
        })
    return results


@router.api_route('/scan', methods=['GET', 'POST'])
def trigger_scan():
    """Trigger an on-demand scan of `data/sentinel2` to enqueue processing tasks.

    Accepts GET or POST for convenience. Returns a Celery task id.
    """
    try:
        # enqueue scanner task
        res = scan_and_enqueue.delay()
        return {'task_id': res.id}
    except Exception as e:
        # likely Redis/broker unavailable
        error_msg = str(e)
        if 'redis' in error_msg.lower() or 'connection' in error_msg.lower():
            raise HTTPException(
                status_code=503,
                detail='Celery broker (Redis) unavailable. Ensure Redis is running and REDIS_HOST or REDIS_URL env var points to localhost when running locally.'
            )
        raise HTTPException(status_code=500, detail=error_msg)


@router.get('/task/{task_id}')
def get_task_status(task_id: str):
    """Return Celery task status for a given task id."""
    # sanitize: strip quotes that some clients include accidentally
    tid = task_id.strip().strip('"').strip("'")
    if not tid or len(tid) < 8:
        raise HTTPException(status_code=400, detail='invalid task id')
    try:
        ar = celery_app.AsyncResult(tid)
        status = 'UNKNOWN'
        result = None
        try:
            status = ar.status
            # avoid accessing result if backend not configured
            try:
                if getattr(ar, 'successful', None) and ar.successful():
                    result = ar.result
            except Exception:
                result = None
        except Exception as e:
            # likely backend unavailable
            return {'id': tid, 'status': 'UNAVAILABLE', 'error': str(e)}

        info = {
            'id': tid,
            'status': status,
            'result': result
        }
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/task')
def get_task_status_q(task_id: str = None):
    """Return Celery task status for `?task_id=...` or return helpful message.

    This endpoint strips surrounding quotes from the provided id to handle clients
    that accidentally include them.
    """
    if not task_id:
        raise HTTPException(status_code=400, detail='task_id query parameter required')
    # strip quotes if present
    tid = task_id.strip().strip('"').strip("'")
    try:
        ar = celery_app.AsyncResult(tid)
        status = 'UNKNOWN'
        result = None
        try:
            status = ar.status
            try:
                if getattr(ar, 'successful', None) and ar.successful():
                    result = ar.result
            except Exception:
                result = None
        except Exception as e:
            # likely backend unavailable
            error_msg = str(e)
            if 'redis' in error_msg.lower() or 'connection' in error_msg.lower():
                return {'id': tid, 'status': 'UNAVAILABLE', 'error': 'Result backend (Redis) not reachable. Set REDIS_HOST=localhost when running locally.'}
            return {'id': tid, 'status': 'UNAVAILABLE', 'error': error_msg}

        info = {
            'id': tid,
            'status': status,
            'result': result
        }
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from __future__ import annotations

import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pydantic.config import ConfigDict
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db


router = APIRouter()


class CropTypeRecomputeRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    start: str = Field(default="2024-01-01", description="YYYY-MM-DD")
    end: str = Field(default="2024-12-31", description="YYYY-MM-DD")
    threshold: float = Field(default=0.6, ge=0.0, le=1.0)
    overwrite: bool = False

    # Paths are relative to workspace root, constrained to under ./ml
    model_dir: str = Field(default="ml/models_radiant_full")

    # Earth Engine billing project (or set EE_PROJECT env var)
    ee_project: Optional[str] = None

    # Export options
    buffer_m: float = Field(default=200.0, gt=0)
    limit: Optional[int] = Field(default=None, gt=0)


class CropTypeRecomputeResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    total_farms: int
    crop_type_filled_before: int
    crop_type_filled_after: int
    applied_rows: int
    threshold: float
    overwrite: bool
    start: str
    end: str
    model_dir: str
    run_dir: str
    predictions_csv: str


class CropTypeApplyRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    predictions_csv: str = Field(
        ..., description="Path under ./ml, e.g. ml/runs/<run>/farm_predictions.csv"
    )
    threshold: float = Field(default=0.6, ge=0.0, le=1.0)
    overwrite: bool = False


class CropTypeApplyResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    total_farms: int
    crop_type_filled_before: int
    crop_type_filled_after: int
    applied_rows: int
    threshold: float
    overwrite: bool
    predictions_csv: str


class CropTypeRunItem(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    run_dir: str
    created_utc: Optional[str] = None
    predictions_csv: Optional[str] = None
    farms_geojson: Optional[str] = None
    farm_features_csv: Optional[str] = None


class CropTypeRunsResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    runs: list[CropTypeRunItem]


class CropTypeLatestRunResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    run: Optional[CropTypeRunItem] = None


def _find_workspace_root(start: Path) -> Path:
    cur = start.resolve()
    for _ in range(12):
        ml_dir = cur / "ml"
        if ml_dir.exists() and (ml_dir / "export_farms_from_db.py").exists():
            return cur
        cur = cur.parent
    raise RuntimeError("Could not locate workspace root (expected ./ml/export_farms_from_db.py)")


def _resolve_under_ml(workspace_root: Path, value: str) -> Path:
    candidate = (workspace_root / value).resolve()
    ml_root = (workspace_root / "ml").resolve()
    if ml_root not in candidate.parents and candidate != ml_root:
        raise ValueError("Path must be under ./ml")
    return candidate


@dataclass(frozen=True)
class _CmdResult:
    stdout: str
    stderr: str


def _run(cmd: list[str], cwd: Path, env: dict[str, str]) -> _CmdResult:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\n\nSTDOUT:\n{proc.stdout}\n\nSTDERR:\n{proc.stderr}"
        )
    return _CmdResult(stdout=proc.stdout, stderr=proc.stderr)


def _parse_applied(stdout: str) -> int:
    # Example: "Applied crop_type to 8 farms (threshold=0.6, overwrite=False)"
    m = re.search(r"Applied crop_type to\s+(\d+)\s+farms", stdout)
    return int(m.group(1)) if m else 0


@router.post("/recompute", response_model=CropTypeRecomputeResponse)
def recompute_crop_types(payload: CropTypeRecomputeRequest, db: Session = Depends(get_db)):
    """Run farm crop-type prediction and write results to farms.crop_type.

    This endpoint shells out to the existing scripts under ./ml.
    It requires Earth Engine authentication in the environment running the API.
    """

    try:
        workspace_root = _find_workspace_root(Path(__file__))
        model_dir = _resolve_under_ml(workspace_root, payload.model_dir)
        if not model_dir.exists():
            raise HTTPException(status_code=400, detail=f"model_dir not found: {payload.model_dir}")

        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        run_dir = (workspace_root / "ml" / "runs" / f"crop_type_{ts}").resolve()
        run_dir.mkdir(parents=True, exist_ok=True)

        farms_geojson = run_dir / "farms.geojson"
        farm_features = run_dir / "farm_features.csv"
        predictions_csv = run_dir / "farm_predictions.csv"

        total_farms = int(db.execute(text("SELECT COUNT(*) FROM farms")).scalar() or 0)
        filled_before = int(
            db.execute(text("SELECT COUNT(*) FROM farms WHERE crop_type IS NOT NULL")).scalar() or 0
        )

        env = os.environ.copy()
        env["DATABASE_URL"] = settings.DATABASE_URL
        if payload.ee_project:
            env["EE_PROJECT"] = payload.ee_project

        python = sys.executable
        export_farms = [
            python,
            str((workspace_root / "ml" / "export_farms_from_db.py").resolve()),
            "--output",
            str(farms_geojson),
            "--buffer-m",
            str(payload.buffer_m),
            "--db-url",
            settings.DATABASE_URL,
        ]
        if payload.limit:
            export_farms += ["--limit", str(payload.limit)]

        _run(export_farms, cwd=workspace_root, env=env)

        export_features = [
            python,
            str((workspace_root / "ml" / "export_gee_timeseries.py").resolve()),
            "--labels",
            str(farms_geojson),
            "--id-field",
            "id",
            "--start",
            payload.start,
            "--end",
            payload.end,
            "--period",
            "months",
            "--out",
            str(farm_features),
        ]
        if payload.ee_project:
            export_features += ["--project", payload.ee_project]

        _run(export_features, cwd=workspace_root, env=env)

        predict = [
            python,
            str((workspace_root / "ml" / "predict_crops.py").resolve()),
            "--model-dir",
            str(model_dir),
            "--features",
            str(farm_features),
            "--id-field",
            "id",
            "--out",
            str(predictions_csv),
        ]
        _run(predict, cwd=workspace_root, env=env)

        apply_cmd = [
            python,
            str((workspace_root / "ml" / "apply_predictions_to_db.py").resolve()),
            "--predictions",
            str(predictions_csv),
            "--threshold",
            str(payload.threshold),
            "--db-url",
            settings.DATABASE_URL,
        ]
        if payload.overwrite:
            apply_cmd.append("--overwrite")

        apply_res = _run(apply_cmd, cwd=workspace_root, env=env)
        applied = _parse_applied(apply_res.stdout)

        filled_after = int(
            db.execute(text("SELECT COUNT(*) FROM farms WHERE crop_type IS NOT NULL")).scalar() or 0
        )

        rel_run_dir = str(run_dir.relative_to(workspace_root))
        rel_predictions = str(predictions_csv.relative_to(workspace_root))

        return CropTypeRecomputeResponse(
            total_farms=total_farms,
            crop_type_filled_before=filled_before,
            crop_type_filled_after=filled_after,
            applied_rows=applied,
            threshold=payload.threshold,
            overwrite=payload.overwrite,
            start=payload.start,
            end=payload.end,
            model_dir=payload.model_dir,
            run_dir=rel_run_dir,
            predictions_csv=rel_predictions,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/apply", response_model=CropTypeApplyResponse)
def apply_crop_type_predictions(payload: CropTypeApplyRequest, db: Session = Depends(get_db)):
    """Apply an existing predictions CSV back into farms.crop_type.

    This skips Earth Engine + feature extraction and is very fast.
    """
    try:
        workspace_root = _find_workspace_root(Path(__file__))
        predictions_path = _resolve_under_ml(workspace_root, payload.predictions_csv)
        if not predictions_path.exists():
            raise HTTPException(status_code=400, detail=f"predictions_csv not found: {payload.predictions_csv}")

        total_farms = int(db.execute(text("SELECT COUNT(*) FROM farms")).scalar() or 0)
        filled_before = int(
            db.execute(text("SELECT COUNT(*) FROM farms WHERE crop_type IS NOT NULL")).scalar() or 0
        )

        env = os.environ.copy()
        env["DATABASE_URL"] = settings.DATABASE_URL

        python = sys.executable
        apply_cmd = [
            python,
            str((workspace_root / "ml" / "apply_predictions_to_db.py").resolve()),
            "--predictions",
            str(predictions_path),
            "--threshold",
            str(payload.threshold),
            "--db-url",
            settings.DATABASE_URL,
        ]
        if payload.overwrite:
            apply_cmd.append("--overwrite")

        apply_res = _run(apply_cmd, cwd=workspace_root, env=env)
        applied = _parse_applied(apply_res.stdout)

        filled_after = int(
            db.execute(text("SELECT COUNT(*) FROM farms WHERE crop_type IS NOT NULL")).scalar() or 0
        )

        return CropTypeApplyResponse(
            total_farms=total_farms,
            crop_type_filled_before=filled_before,
            crop_type_filled_after=filled_after,
            applied_rows=applied,
            threshold=payload.threshold,
            overwrite=payload.overwrite,
            predictions_csv=payload.predictions_csv,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/runs", response_model=CropTypeRunsResponse)
def list_crop_type_runs(limit: int = 20):
    """List recent crop-type pipeline runs under ./ml/runs.

    This is a convenience endpoint so clients can quickly discover the latest
    `predictions_csv` path to reuse with `/crop-type/apply`.
    """
    try:
        workspace_root = _find_workspace_root(Path(__file__))
        runs_root = (workspace_root / "ml" / "runs").resolve()
        if not runs_root.exists():
            return CropTypeRunsResponse(runs=[])

        dirs = [p for p in runs_root.iterdir() if p.is_dir()]
        dirs.sort(key=lambda p: p.stat().st_mtime, reverse=True)

        items: list[CropTypeRunItem] = []
        for d in dirs[: max(1, min(int(limit), 200))]:
            name = d.name
            created = None
            if name.startswith("crop_type_"):
                ts = name.removeprefix("crop_type_")
                try:
                    created = datetime.strptime(ts, "%Y%m%d_%H%M%S").isoformat() + "Z"
                except Exception:
                    created = None

            preds = d / "farm_predictions.csv"
            farms = d / "farms.geojson"
            feats = d / "farm_features.csv"

            def rel(p: Path) -> Optional[str]:
                if p.exists():
                    return str(p.relative_to(workspace_root))
                return None

            items.append(
                CropTypeRunItem(
                    run_dir=str(d.relative_to(workspace_root)),
                    created_utc=created,
                    predictions_csv=rel(preds),
                    farms_geojson=rel(farms),
                    farm_features_csv=rel(feats),
                )
            )

        return CropTypeRunsResponse(runs=items)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/runs/latest", response_model=CropTypeLatestRunResponse)
def get_latest_crop_type_run():
    """Return the most recent crop-type run under ./ml/runs."""
    resp = list_crop_type_runs(limit=1)
    run = resp.runs[0] if resp.runs else None
    return CropTypeLatestRunResponse(run=run)

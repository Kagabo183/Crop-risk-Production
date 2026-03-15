"""
Phenology Service — Spectral Crop Growth Stage Detection
---------------------------------------------------------
Detects current crop growth stages from NDVI/NDRE time-series curves
using first-derivative transition analysis, combined with Growing Degree
Day (GDD) calculations when weather records are available.

Algorithm:
  1. Load the last 180 days of VegetationHealth (NDVI, NDRE, date).
  2. Fill small gaps (≤ 7 days) by linear interpolation.
  3. Apply a 5-point Savitzky-Golay-like smoothing (simple moving average fallback).
  4. Compute first derivative: rate = Δndi / Δday.
  5. Identify phenological transitions based on NDVI level + derivative sign:

     STAGE              NDVI         DERIVATIVE   NOTES
     emergence          0.10–0.25    +            After bare-soil baseline
     vegetative         0.25–0.65    + (peak)     Maximum rate of greening
     flowering          0.60–0.80    ≈ 0          NDVI plateau near peak
     grain_filling      0.45–0.70    –            Declining after peak
     maturity           < 0.35       –            Senescence / near bare soil

  6. Calculate GDD from WeatherRecord (base temp = crop-specific).
  7. Return `detected_stage` with confidence and persist to phenology_records table.

Confidence scoring:
  - Uses number of valid observations in window: ≥ 10 obs → 0.85 confidence.
  - Cross-validate NDVI-derived stage against GDD if both available.
  - Cross-validation match → confidence boost up to 0.95.
  - Calendar-only fallback → confidence = 0.50.

Supported crops + GDD base temperatures:
  maize / corn      : Tbase = 10°C, total GDD to maturity ≈ 1400
  potato            : Tbase =  7°C, total GDD to maturity ≈ 1200
  rice              : Tbase = 10°C, total GDD to maturity ≈ 1500
  wheat             : Tbase =  5°C, total GDD to maturity ≈ 1600
  beans / soybean   : Tbase = 10°C, total GDD to maturity ≈  900
  coffee            : Tbase = 15°C, event-based phenology
  banana            : Tbase = 14°C, total GDD to maturity ≈ 3000
  cassava           : Tbase = 18°C, total GDD to maturity ≈ 2500
  default           : Tbase = 10°C, total GDD to maturity ≈ 1400
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.data import VegetationHealth
from app.models.farm import Farm

logger = logging.getLogger(__name__)

# ── Crop phenology constants ───────────────────────────────────────────────────

CROP_GDD_BASE: Dict[str, float] = {
    "maize": 10.0, "corn": 10.0,
    "potato": 7.0,
    "rice": 10.0,
    "wheat": 5.0,
    "beans": 10.0, "soybean": 10.0,
    "coffee": 15.0,
    "banana": 14.0,
    "cassava": 18.0,
    "tea": 10.0,
    "default": 10.0,
}

CROP_GDD_MATURITY: Dict[str, float] = {
    "maize": 1400.0, "corn": 1400.0,
    "potato": 1200.0,
    "rice": 1500.0,
    "wheat": 1600.0,
    "beans": 900.0, "soybean": 900.0,
    "coffee": 3000.0,
    "banana": 3000.0,
    "cassava": 2500.0,
    "default": 1400.0,
}

# Fraction of total GDD at which each stage begins
CROP_GDD_STAGE_FRACTIONS: Dict[str, float] = {
    "emergence": 0.0,
    "vegetative": 0.10,
    "flowering": 0.50,
    "grain_filling": 0.65,
    "maturity": 0.85,
}

# Stage order for progression logic
STAGES = ["emergence", "vegetative", "flowering", "grain_filling", "maturity"]


# ── Main service ──────────────────────────────────────────────────────────────

class PhenologyService:
    """
    Detects crop growth stage from NDVI time series + GDD.

    Usage::
        svc  = PhenologyService()
        result = svc.detect_growth_stage(farm, db)
        # {"detected_stage": "vegetative", "confidence": 0.82, ...}
    """

    def detect_growth_stage(
        self,
        farm: Farm,
        db: Session,
        window_days: int = 180,
    ) -> Dict[str, Any]:
        """
        Determine the current crop growth stage for *farm*.

        Returns a dict that can be persisted via save_phenology_record().
        """
        crop_type = (farm.crop_type or "default").lower()

        # ── Load & smooth NDVI series ──────────────────────────────────────────
        series = self._load_ndvi_series(farm.id, db, window_days)
        smooth = self._smooth_series(series)

        # ── NDVI curve stage detection ─────────────────────────────────────────
        spectral_stage, spectral_conf, stage_start = self._detect_from_curve(smooth)

        # ── GDD stage detection ────────────────────────────────────────────────
        gdd_stage, gdd_accumulated = self._detect_from_gdd(farm, db, crop_type)

        # ── Combine: cross-validate ────────────────────────────────────────────
        final_stage, confidence, method = self._combine(
            spectral_stage, spectral_conf,
            gdd_stage, len(smooth),
        )

        # NDVI statistics
        ndvi_vals = [s["ndvi"] for s in smooth if s["ndvi"] is not None]
        ndvi_peak  = max(ndvi_vals) if ndvi_vals else None
        current_ndvi = ndvi_vals[-1] if ndvi_vals else None

        return {
            "farm_id": farm.id,
            "crop_type": crop_type,
            "detected_stage": final_stage,
            "confidence": round(confidence, 3),
            "stage_start_date": stage_start.isoformat() if stage_start else None,
            "ndvi_at_detection": round(current_ndvi, 4) if current_ndvi is not None else None,
            "ndvi_peak": round(ndvi_peak, 4) if ndvi_peak is not None else None,
            "gdd_accumulated": round(gdd_accumulated, 1) if gdd_accumulated else None,
            "detection_method": method,
            "ndvi_series_used": len(smooth),
            "computed_at": datetime.utcnow().isoformat(),
            # Human-readable summary
            "summary": self._stage_summary(final_stage, crop_type, confidence),
        }

    def save_phenology_record(self, result: Dict[str, Any], db: Session) -> Any:
        """
        Upsert a PhenologyRecord (replace most recent record for same farm).
        Returns the saved ORM object.
        """
        try:
            from app.models.phenology import PhenologyRecord
        except ImportError:
            logger.warning("PhenologyRecord model not available; skipping persistence")
            return None

        farm_id = result["farm_id"]
        existing = (
            db.query(PhenologyRecord)
            .filter(PhenologyRecord.farm_id == farm_id)
            .order_by(PhenologyRecord.computed_at.desc())
            .first()
        )

        stage_start_val: Optional[date] = None
        if result.get("stage_start_date"):
            try:
                stage_start_val = date.fromisoformat(result["stage_start_date"])
            except ValueError:
                pass

        if existing:
            existing.crop_type = result["crop_type"]
            existing.detected_stage = result["detected_stage"]
            existing.confidence = result["confidence"]
            existing.stage_start_date = stage_start_val
            existing.ndvi_at_detection = result.get("ndvi_at_detection")
            existing.ndvi_peak = result.get("ndvi_peak")
            existing.gdd_accumulated = result.get("gdd_accumulated")
            existing.detection_method = result.get("detection_method", "spectral")
            existing.ndvi_series_used = result.get("ndvi_series_used", 0)
            existing.computed_at = datetime.utcnow()
            record = existing
        else:
            record = PhenologyRecord(
                farm_id=farm_id,
                crop_type=result["crop_type"],
                detected_stage=result["detected_stage"],
                confidence=result["confidence"],
                stage_start_date=stage_start_val,
                ndvi_at_detection=result.get("ndvi_at_detection"),
                ndvi_peak=result.get("ndvi_peak"),
                gdd_accumulated=result.get("gdd_accumulated"),
                detection_method=result.get("detection_method", "spectral"),
                ndvi_series_used=result.get("ndvi_series_used", 0),
            )
            db.add(record)

        try:
            db.commit()
            db.refresh(record)
        except Exception as exc:
            logger.error("Failed to save phenology record: %s", exc)
            db.rollback()

        return record

    # ── Private: data loading ─────────────────────────────────────────────────

    def _load_ndvi_series(
        self, farm_id: int, db: Session, window_days: int
    ) -> List[Dict[str, Any]]:
        """Load and sort VegetationHealth records; fill small gaps."""
        since = (date.today() - timedelta(days=window_days))
        rows = (
            db.query(VegetationHealth)
            .filter(
                VegetationHealth.farm_id == farm_id,
                VegetationHealth.date >= since,
            )
            .order_by(VegetationHealth.date.asc())
            .all()
        )
        if not rows:
            return []

        series = [
            {
                "date": r.date,
                "ndvi": r.ndvi,
                "ndre": r.ndre,
            }
            for r in rows
        ]

        # Linear gap fill for ≤ 7-day gaps
        return self._fill_gaps(series, max_gap_days=7)

    def _fill_gaps(
        self, series: List[Dict], max_gap_days: int = 7
    ) -> List[Dict]:
        """Fill short gaps in the NDVI time series by linear interpolation."""
        if len(series) < 2:
            return series

        filled: List[Dict] = [series[0]]
        for i in range(1, len(series)):
            prev = filled[-1]
            curr = series[i]
            gap: int = (curr["date"] - prev["date"]).days

            if 1 < gap <= max_gap_days and prev["ndvi"] is not None and curr["ndvi"] is not None:
                for j in range(1, gap):
                    t = j / gap
                    interp_date = prev["date"] + timedelta(days=j)
                    interp_ndvi = prev["ndvi"] + t * (curr["ndvi"] - prev["ndvi"])
                    interp_ndre = None
                    if prev["ndre"] is not None and curr["ndre"] is not None:
                        interp_ndre = prev["ndre"] + t * (curr["ndre"] - prev["ndre"])
                    filled.append({"date": interp_date, "ndvi": interp_ndvi, "ndre": interp_ndre})

            filled.append(curr)

        return filled

    # ── Private: smoothing ────────────────────────────────────────────────────

    @staticmethod
    def _smooth_series(
        series: List[Dict], window: int = 5
    ) -> List[Dict]:
        """Apply a centred moving-average over the NDVI values."""
        if len(series) < window:
            return series

        half = window // 2
        smoothed: List[Dict] = []

        for i, s in enumerate(series):
            lo = max(0, i - half)
            hi = min(len(series), i + half + 1)
            window_ndvi = [
                series[k]["ndvi"]
                for k in range(lo, hi)
                if series[k]["ndvi"] is not None
            ]
            avg = sum(window_ndvi) / len(window_ndvi) if window_ndvi else s["ndvi"]
            smoothed.append({**s, "ndvi_smooth": avg})

        return smoothed

    # ── Private: spectral transition detection ─────────────────────────────────

    def _detect_from_curve(
        self,
        series: List[Dict],
    ) -> Tuple[str, float, Optional[date]]:
        """
        Analyse the smoothed NDVI curve using derivative-based transition detection.

        Returns (stage_name, confidence, stage_start_date).
        """
        if len(series) < 4:
            return "vegetative", 0.40, None

        ndvi_vals = [
            s.get("ndvi_smooth", s["ndvi"])
            for s in series
            if s.get("ndvi_smooth", s["ndvi"]) is not None
        ]
        dates = [s["date"] for s in series if s.get("ndvi_smooth", s["ndvi"]) is not None]

        if len(ndvi_vals) < 4:
            return "vegetative", 0.40, None

        current_ndvi = ndvi_vals[-1]

        # Derivatives using central differences on the most recent 30 points
        tail_n = min(30, len(ndvi_vals))
        tail_ndvi = ndvi_vals[-tail_n:]
        tail_dates = dates[-tail_n:]

        # Compute derivative (ΔNDVI / Δday) at each point
        derivs: List[float] = []
        for i in range(1, len(tail_ndvi)):
            delta_day = max(1, (tail_dates[i] - tail_dates[i - 1]).days)
            derivs.append((tail_ndvi[i] - tail_ndvi[i - 1]) / delta_day)

        if not derivs:
            deriv_now = 0.0
        else:
            # Use average of most recent 3 derivatives for stability
            recent_derivs = derivs[-3:]
            deriv_now = sum(recent_derivs) / len(recent_derivs)

        # Peak NDVI up to now
        ndvi_peak = max(ndvi_vals)
        ndvi_min = min(ndvi_vals)
        ndvi_range = ndvi_peak - ndvi_min

        # ── Stage decision tree (NDVI level + derivative sign) ─────────────────
        #
        # | Stage         | NDVI       | Derivative              |
        # |---------------|------------|-------------------------|
        # | Emergence     | 0.10–0.28  | positive                |
        # | Vegetative    | 0.28–0.65  | strongly positive       |
        # | Flowering     | > 0.55     | near zero (±0.002)      |
        # | Grain filling | > 0.35     | negative, after peak    |
        # | Maturity      | < 0.35     | negative / flat         |

        post_peak = any(v >= ndvi_peak - 0.02 for v in tail_ndvi[:-3 if len(tail_ndvi) > 3 else 0:])

        if current_ndvi < 0.28 and deriv_now > 0.001:
            stage = "emergence"
            conf_base = 0.75
        elif current_ndvi >= 0.28 and deriv_now > 0.002:
            stage = "vegetative"
            conf_base = 0.80
        elif current_ndvi >= 0.55 and abs(deriv_now) <= 0.002:
            stage = "flowering"
            conf_base = 0.78
        elif current_ndvi >= 0.35 and deriv_now < -0.001 and post_peak:
            stage = "grain_filling"
            conf_base = 0.77
        elif current_ndvi < 0.35 and deriv_now <= 0.001:
            stage = "maturity"
            conf_base = 0.72
        else:
            # Ambiguous — pick closest
            if post_peak:
                stage = "grain_filling"
            else:
                stage = "vegetative"
            conf_base = 0.55

        # Confidence scales with number of observations
        n_obs = len(ndvi_vals)
        obs_factor = min(1.0, n_obs / 15.0)  # saturates at 15 obs
        confidence = conf_base * (0.60 + 0.40 * obs_factor)

        # Estimate stage_start_date as first date the NDVI crossed the stage threshold
        stage_start = self._estimate_stage_start(stage, tail_ndvi, tail_dates, deriv_now)

        return stage, confidence, stage_start

    @staticmethod
    def _estimate_stage_start(
        stage: str,
        ndvi_vals: List[float],
        dates: List[date],
        current_deriv: float,
    ) -> Optional[date]:
        """Rough estimate: find the date when the current stage likely began."""
        thresholds = {
            "emergence":    (None, 0.28),
            "vegetative":   (0.28, 0.65),
            "flowering":    (0.55, None),
            "grain_filling": (0.35, None),
            "maturity":     (None, 0.35),
        }
        lo, hi = thresholds.get(stage, (None, None))

        for i in range(len(ndvi_vals) - 1, -1, -1):
            v = ndvi_vals[i]
            if lo is not None and v < lo:
                return dates[min(i + 1, len(dates) - 1)]
            if hi is not None and v > hi:
                return dates[min(i + 1, len(dates) - 1)]

        return dates[0] if dates else None

    # ── Private: GDD calculation ──────────────────────────────────────────────

    def _detect_from_gdd(
        self,
        farm: Farm,
        db: Session,
        crop_type: str,
    ) -> Tuple[Optional[str], float]:
        """
        Accumulate Growing Degree Days (GDD) from planting date.
        Returns (stage_name or None, gdd_accumulated).
        """
        if not farm.planting_date:
            return None, 0.0

        try:
            from app.models.data import WeatherRecord
        except ImportError:
            return None, 0.0

        t_base = CROP_GDD_BASE.get(crop_type, CROP_GDD_BASE["default"])
        t_maturity = CROP_GDD_MATURITY.get(crop_type, CROP_GDD_MATURITY["default"])

        weather_rows = (
            db.query(WeatherRecord)
            .filter(
                WeatherRecord.farm_id == farm.id,
                WeatherRecord.date >= farm.planting_date,
                WeatherRecord.temperature.isnot(None),
            )
            .order_by(WeatherRecord.date.asc())
            .all()
        )

        if not weather_rows:
            return None, 0.0

        gdd_total = 0.0
        for r in weather_rows:
            t_max = getattr(r, "temperature_max", None) or r.temperature
            t_min = getattr(r, "temperature_min", None) or (r.temperature - 3)
            t_avg = (t_max + t_min) / 2.0
            gdd_total += max(0.0, t_avg - t_base)

        # Map GDD fraction to stage
        frac = gdd_total / t_maturity if t_maturity else 0.0

        stage: Optional[str] = None
        for s in reversed(STAGES):
            if frac >= CROP_GDD_STAGE_FRACTIONS[s]:
                stage = s
                break

        return stage or "emergence", gdd_total

    # ── Private: combine methods ──────────────────────────────────────────────

    @staticmethod
    def _combine(
        spectral_stage: str,
        spectral_conf: float,
        gdd_stage: Optional[str],
        n_obs: int,
    ) -> Tuple[str, float, str]:
        """
        Cross-validate spectral and GDD stage detections:
        - If both agree: boost confidence.
        - If only spectral: use spectral.
        - If only GDD: use GDD at lower confidence.
        - If fewer than 5 observations: fall back to GDD or calendar.
        """
        if n_obs < 5:
            if gdd_stage:
                return gdd_stage, 0.50, "gdd"
            return spectral_stage, 0.45, "calendar_fallback"

        if gdd_stage is None:
            return spectral_stage, spectral_conf, "spectral_curve"

        if spectral_stage == gdd_stage:
            # Agreement → confidence boost
            boosted = min(0.95, spectral_conf + 0.10)
            return spectral_stage, boosted, "combined"

        # Disagreement: trust spectral (more data-driven) but penalise
        penalised = max(0.40, spectral_conf - 0.10)
        return spectral_stage, penalised, "spectral_curve"

    # ── Private: human-readable summary ──────────────────────────────────────

    @staticmethod
    def _stage_summary(stage: str, crop_type: str, confidence: float) -> str:
        summaries = {
            "emergence": (
                f"{crop_type.capitalize()} seedlings have emerged. "
                "Monitor for damping-off and early pest pressure."
            ),
            "vegetative": (
                f"{crop_type.capitalize()} is in rapid vegetative growth. "
                "Optimal time for top-dressing nitrogen fertilizer."
            ),
            "flowering": (
                f"{crop_type.capitalize()} is flowering / at reproductive stage. "
                "Critical window: avoid water stress; disease risk is highest."
            ),
            "grain_filling": (
                f"{crop_type.capitalize()} is filling grain/tubers. "
                "Maintain soil moisture; monitor for late blight and stem borers."
            ),
            "maturity": (
                f"{crop_type.capitalize()} is approaching maturity. "
                "Plan harvest; reduce irrigation to avoid quality losses."
            ),
        }
        base = summaries.get(stage, f"{crop_type.capitalize()} stage: {stage}.")
        conf_str = f"Confidence: {int(confidence * 100)}%."
        return f"{base} {conf_str}"

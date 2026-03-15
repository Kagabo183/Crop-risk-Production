"""
Season Management Service
=========================
CRUD for agricultural seasons + agronomic crop rotation recommendations.
"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models.precision_ag import Season, CropRotation, SeasonStatus

# ─── Rotation knowledge base ─────────────────────────────────────────────────

NITROGEN_FIXERS = {
    "beans", "soybean", "soya", "groundnuts", "cowpeas", "peas",
    "lentils", "clover", "alfalfa",
}

ROTATION_RULES: Dict[str, Dict] = {
    "maize": {
        "recommended_next": ["beans", "soybean", "groundnuts", "cowpeas"],
        "avoid_after_self": True,
        "rest_period_weeks": 0,
        "notes": "Follow with nitrogen-fixing legume to restore soil fertility after maize depletion.",
    },
    "beans": {
        "recommended_next": ["maize", "sorghum", "potato", "wheat"],
        "avoid_after_self": True,
        "rest_period_weeks": 0,
        "notes": "Nitrogen-fixing crop. Follow with a heavy feeder (maize, sorghum) to utilise fixed N.",
    },
    "soybean": {
        "recommended_next": ["maize", "sorghum", "wheat"],
        "avoid_after_self": True,
        "rest_period_weeks": 0,
        "notes": "Excellent N fixer. Ideal precursor for cereals. Avoid soybean-on-soybean to prevent SCN build-up.",
    },
    "potato": {
        "recommended_next": ["maize", "beans", "sorghum"],
        "avoid_after_self": True,
        "rest_period_weeks": 8,
        "notes": "Avoid same Solanaceae family. Minimum 2-year break if Late Blight observed.",
    },
    "sweet_potato": {
        "recommended_next": ["maize", "beans", "sorghum"],
        "avoid_after_self": True,
        "rest_period_weeks": 4,
        "notes": "Moderately depletes K. Follow with legumes to balance nutrient draw.",
    },
    "sorghum": {
        "recommended_next": ["beans", "groundnuts", "cowpeas"],
        "avoid_after_self": True,
        "rest_period_weeks": 0,
        "notes": "Heavy N feeder. Rotate with nitrogen-fixing legume to prevent soil depletion.",
    },
    "cassava": {
        "recommended_next": ["maize", "beans"],
        "avoid_after_self": True,
        "rest_period_weeks": 4,
        "notes": "Long-season crop that heavily depletes soil. Rest or plant legume cover crop before replanting.",
    },
    "wheat": {
        "recommended_next": ["beans", "peas", "clover"],
        "avoid_after_self": True,
        "rest_period_weeks": 0,
        "notes": "Follow with legume to break disease cycles (Fusarium, Take-all) and restore N.",
    },
    "rice": {
        "recommended_next": ["maize", "sorghum", "beans"],
        "avoid_after_self": False,
        "rest_period_weeks": 4,
        "notes": "Flooded paddies can be continuous, but drain and rest between seasons to reduce disease risk.",
    },
    "groundnuts": {
        "recommended_next": ["maize", "sorghum", "cassava"],
        "avoid_after_self": True,
        "rest_period_weeks": 0,
        "notes": "Adds nitrogen. Ideal before high N-demand cereals. Avoid groundnuts after groundnuts (pod rot).",
    },
    "cowpeas": {
        "recommended_next": ["maize", "sorghum"],
        "avoid_after_self": False,
        "rest_period_weeks": 0,
        "notes": "Dual-purpose legume; good N fixer. Can follow with cereal safely.",
    },
}

_DEFAULT_RULE = {
    "recommended_next": ["beans", "maize"],
    "avoid_after_self": True,
    "rest_period_weeks": 0,
    "notes": "General recommendation: alternate with a legume for soil health and yield stability.",
}


def _get_rule(crop: str) -> dict:
    return ROTATION_RULES.get(crop.lower().strip().replace(" ", "_"), _DEFAULT_RULE)


def _score_rotation(previous: Optional[str], current: str) -> float:
    """Return rotation quality score 0–10."""
    if not previous:
        return 7.0
    rule = _get_rule(previous)
    curr = current.lower().strip().replace(" ", "_")
    prev = previous.lower().strip().replace(" ", "_")
    if curr in [r.lower() for r in rule["recommended_next"]]:
        return 9.5
    if rule["avoid_after_self"] and curr == prev:
        return 2.0
    return 6.0


# ─── CRUD ────────────────────────────────────────────────────────────────────

def list_seasons(farm_id: int, db: Session) -> List[Season]:
    return (
        db.query(Season)
        .filter(Season.farm_id == farm_id)
        .order_by(desc(Season.year), desc(Season.created_at))
        .all()
    )


def get_season(season_id: int, db: Session) -> Optional[Season]:
    return db.query(Season).filter(Season.id == season_id).first()


def create_season(farm_id: int, data: dict, db: Session) -> Season:
    season = Season(farm_id=farm_id, **data)
    db.add(season)
    db.commit()
    db.refresh(season)
    return season


def update_season(season_id: int, data: dict, db: Session) -> Optional[Season]:
    season = db.query(Season).filter(Season.id == season_id).first()
    if not season:
        return None
    for k, v in data.items():
        if v is not None:
            setattr(season, k, v)
    season.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(season)
    return season


def delete_season(season_id: int, db: Session) -> bool:
    season = db.query(Season).filter(Season.id == season_id).first()
    if not season:
        return False
    db.delete(season)
    db.commit()
    return True


# ─── Crop rotation logic ─────────────────────────────────────────────────────

def generate_crop_rotation(farm_id: int, season_id: int, db: Session) -> CropRotation:
    """Analyse season history and produce a CropRotation with recommendations."""
    season = db.query(Season).filter(Season.id == season_id).first()
    if not season:
        raise ValueError(f"Season {season_id} not found")

    previous_season = (
        db.query(Season)
        .filter(
            Season.farm_id == farm_id,
            Season.id != season_id,
            Season.year <= season.year,
        )
        .order_by(desc(Season.year), desc(Season.created_at))
        .first()
    )

    previous_crop = previous_season.crop_type if previous_season else None
    current_crop  = season.crop_type
    rule  = _get_rule(current_crop)
    score = _score_rotation(previous_crop, current_crop)
    is_legume = current_crop.lower() in NITROGEN_FIXERS
    next_rec  = rule["recommended_next"][0] if rule["recommended_next"] else "beans"

    same_crop_repeated = (
        previous_crop and previous_crop.lower().strip().replace(" ", "_") ==
        current_crop.lower().strip().replace(" ", "_")
    )

    recommendations = {
        "next_crop":          rule["recommended_next"],
        "rationale":          rule["notes"],
        "rest_period_weeks":  rule["rest_period_weeks"],
        "nitrogen_balance":   "positive" if is_legume else "negative",
        "score_explanation": (
            "Excellent — recommended crop after previous season"  if score >= 9  else
            "Poor — same crop repeated, risk of disease build-up" if score <= 3  else
            "Acceptable — consider alternating with a legume next season"
        ),
        "alerts": (
            [f"⚠️ {current_crop.capitalize()} repeated from previous season — "
             f"yields may decline {15 + rule.get('rest_period_weeks', 0) * 2}% "
             f"and disease risk is elevated."]
            if same_crop_repeated else []
        ),
    }

    db.query(CropRotation).filter(CropRotation.season_id == season_id).delete()

    rotation = CropRotation(
        farm_id=farm_id,
        season_id=season_id,
        previous_crop=previous_crop,
        current_crop=current_crop,
        next_crop_recommendation=next_rec,
        rotation_score=score,
        nitrogen_fixation=is_legume,
        rest_period_weeks=rule["rest_period_weeks"],
        notes=rule["notes"],
        recommendations=recommendations,
    )
    db.add(rotation)
    db.commit()
    db.refresh(rotation)
    return rotation


def get_farm_rotation_history(farm_id: int, db: Session) -> List[dict]:
    """Chronological crop sequence with rotation scores — for timeline visualization."""
    seasons = (
        db.query(Season)
        .filter(Season.farm_id == farm_id, Season.status != SeasonStatus.cancelled)
        .order_by(Season.year, Season.created_at)
        .all()
    )
    result = []
    for i, s in enumerate(seasons):
        prev  = seasons[i - 1].crop_type if i > 0 else None
        rule  = _get_rule(s.crop_type)
        score = _score_rotation(prev, s.crop_type)
        result.append({
            "season_id":           s.id,
            "year":                s.year,
            "name":                s.name,
            "crop_type":           s.crop_type,
            "previous_crop":       prev,
            "rotation_score":      score,
            "next_recommendation": rule["recommended_next"][0] if rule["recommended_next"] else None,
            "is_nitrogen_fixer":   s.crop_type.lower() in NITROGEN_FIXERS,
            "planting_date":       s.planting_date.isoformat() if s.planting_date else None,
            "harvest_date":        s.harvest_date.isoformat() if s.harvest_date else None,
            "status":              s.status,
        })
    return result

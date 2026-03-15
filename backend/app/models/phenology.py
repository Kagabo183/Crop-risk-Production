"""
PhenologyRecord — Crop Growth Stage Detection Model
-----------------------------------------------------
Stores the computed phenological stage per farm, detected automatically
from NDVI/NDRE time-series curves and Growing Degree Day calculations.
"""
from datetime import datetime

from sqlalchemy import (
    Column, Integer, String, Float, Date, DateTime, ForeignKey, Text, text
)
from sqlalchemy.orm import relationship

from app.db.database import Base


class PhenologyRecord(Base):
    """
    One record per farm (overwritten on each detection run).

    detected_stage values:
        'emergence' | 'vegetative' | 'flowering' | 'grain_filling' | 'maturity'

    detection_method values:
        'spectral_curve'   – derived purely from NDVI curve analysis
        'gdd'              – derived purely from Growing Degree Days
        'combined'         – spectral + GDD cross-validated (highest confidence)
        'calendar'         – DAP-only fallback (no satellite data)
        'calendar_fallback'– very few NDVI obs; GDD-based with low confidence
    """
    __tablename__ = "phenology_records"

    id = Column(Integer, primary_key=True, index=True)
    farm_id = Column(
        Integer,
        ForeignKey("farms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Detected phenology
    crop_type = Column(String(50), nullable=True)                # e.g. 'maize', 'potato'
    detected_stage = Column(String(30), nullable=False)          # stage name
    confidence = Column(Float, nullable=True)                    # 0.0 – 1.0
    stage_start_date = Column(Date, nullable=True)               # approximate date stage began

    # Supporting metrics
    ndvi_at_detection = Column(Float, nullable=True)             # most recent NDVI value
    ndvi_peak = Column(Float, nullable=True)                     # peak NDVI in window
    gdd_accumulated = Column(Float, nullable=True)               # Growing Degree Days since planting

    # Meta
    detection_method = Column(String(30), nullable=True, server_default="spectral_curve")
    ndvi_series_used = Column(Integer, nullable=True)            # number of observations used
    computed_at = Column(
        DateTime,
        nullable=False,
        server_default=text("now()"),
        onupdate=datetime.utcnow,
    )

    # Relationship
    farm = relationship("Farm")

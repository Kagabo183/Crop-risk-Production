"""
Geo-intelligence models for precision agriculture.

Tables:
  - productivity_zones      : K-means NDVI productivity zones per farm polygon
  - scouting_observations   : Ground-truthed field notes with GPS + photos
  - ndvi_overlays           : Metadata for NDVI tile overlays (GEE or fallback)
  - detected_fields         : Auto-detected field boundaries from GEE SNIC
  - user_fields             : User-drawn / user-edited field boundaries
"""
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, Integer, String, Float, Date, DateTime,
    ForeignKey, Text, JSON, text
)
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry

from app.db.database import Base


class ProductivityZone(Base):
    """
    Spatial productivity zone computed by K-means clustering on historical NDVI.
    Three classes: high / medium / low productivity.
    """
    __tablename__ = "productivity_zones"

    id = Column(Integer, primary_key=True, index=True)
    farm_id = Column(
        Integer, ForeignKey("farms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    zone_class = Column(String(20), nullable=False)       # 'high' | 'medium' | 'low'
    boundary = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=True)
    mean_ndvi = Column(Float, nullable=True)
    area_ha = Column(Float, nullable=True)
    pixel_count = Column(Integer, nullable=True)
    color_hex = Column(String(10), nullable=True)          # '#4CAF50' / '#FFC107' / '#F44336'
    zone_index = Column(Integer, nullable=True)            # Cluster index (0-based)
    ndvi_samples_used = Column(Integer, nullable=True)
    computed_at = Column(DateTime, server_default=text("now()"), nullable=False)

    # Relationship (no back_populates to avoid modifying Farm model)
    farm = relationship("Farm")


class ScoutingObservation(Base):
    """
    Geo-located field scouting observation.
    Supports disease / pest / stress / general categories with optional photos.
    """
    __tablename__ = "scouting_observations"

    id = Column(Integer, primary_key=True, index=True)
    farm_id = Column(
        Integer, ForeignKey("farms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    observed_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    point = Column(Geometry(geometry_type="POINT", srid=4326), nullable=True)
    observation_type = Column(String(50), nullable=False)  # disease|pest|stress|general
    severity = Column(String(20), nullable=True)           # low|moderate|high|critical
    notes = Column(Text, nullable=True)
    photo_paths = Column(JSON, nullable=True)              # list[str] of relative file paths
    tags = Column(JSON, nullable=True)                     # e.g. ['late_blight', 'potato']
    created_at = Column(DateTime, server_default=text("now()"), nullable=False)

    farm = relationship("Farm")
    observer = relationship("User")


class DetectedField(Base):
    """
    Automatically detected agricultural field boundary from Sentinel-2 imagery.
    Derived via GEE SNIC superpixel segmentation + NDVI thresholding.
    Results are cached by bounding-box tile key so repeat requests are fast.
    """
    __tablename__ = "detected_fields"

    id          = Column(Integer, primary_key=True, index=True)
    # WGS-84 polygon geometry
    geometry    = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)
    # Aggregated stats for the segment
    ndvi_mean   = Column(Float, nullable=True)
    ndvi_std    = Column(Float, nullable=True)
    area_ha     = Column(Float, nullable=True)
    # Cache key: "z/{zoom}/{tile_x}/{tile_y}" or "bbox/{w},{s},{e},{n}"
    tile_key    = Column(String(120), nullable=False, index=True)
    # Source info
    imagery_date = Column(Date, nullable=True)
    cloud_pct   = Column(Float, nullable=True)
    created_at  = Column(DateTime, server_default=text("now()"), nullable=False)


class UserField(Base):
    """
    User-drawn or user-edited field boundary polygon.

    Can originate from:
      - 'drawn'    : Drawn from scratch with Leaflet.draw
      - 'promoted' : Promoted from a DetectedField (auto-segmented)
      - 'imported' : Uploaded GeoJSON

    Optionally associated with a Farm for context.
    """
    __tablename__ = "user_fields"

    id          = Column(Integer, primary_key=True, index=True)
    owner_id    = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    farm_id     = Column(
        Integer, ForeignKey("farms.id",  ondelete="SET NULL"), nullable=True, index=True
    )
    geometry    = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)
    name        = Column(String(120), nullable=True)
    crop_type   = Column(String(80),  nullable=True)
    area_ha     = Column(Float,        nullable=True)
    notes       = Column(Text,         nullable=True)
    color_hex   = Column(String(10),   nullable=True)            # user-chosen map colour
    source      = Column(String(20),   nullable=False, default="drawn")  # drawn|promoted|imported
    detected_field_id = Column(
        Integer, ForeignKey("detected_fields.id", ondelete="SET NULL"), nullable=True
    )
    is_archived = Column(Boolean, nullable=False, server_default=text("false"))
    created_at  = Column(DateTime, server_default=text("now()"), nullable=False)
    updated_at  = Column(DateTime, server_default=text("now()"), onupdate=datetime.utcnow, nullable=False)

    owner  = relationship("User")
    farm   = relationship("Farm")


class FieldCropClassification(Base):
    """
    Crop-type classification result derived from NDVI time-series growth curve
    analysis on a user field polygon.

    source values:
      'gee_curve'      – GEE time-series + template matching
      'template_only'  – template matching only (no recent imagery)
      'no_imagery'     – GEE unavailable or no cloud-free scenes
    """
    __tablename__ = "field_crop_classifications"

    id               = Column(Integer, primary_key=True, index=True)
    user_field_id    = Column(
        Integer, ForeignKey("user_fields.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    predicted_crop   = Column(String(80),  nullable=True)
    confidence       = Column(Float,       nullable=True)   # 0–1
    all_scores       = Column(JSON,        nullable=True)   # {crop: score, ...}
    growth_stage     = Column(String(50),  nullable=True)   # emergence|vegetative|…
    stage_confidence = Column(Float,       nullable=True)
    ndvi_timeseries  = Column(JSON,        nullable=True)   # [{date, ndvi, evi, ndwi}, …]
    curve_features   = Column(JSON,        nullable=True)   # peak_ndvi, auc, …
    source           = Column(String(30),  nullable=False,  server_default=text("'gee_curve'"))
    classified_at    = Column(DateTime,    server_default=text("now()"), nullable=False)

    user_field = relationship("UserField")


class NdviOverlay(Base):
    """
    Metadata for NDVI tile overlay generated for a farm.
    The GEE tile URL is short-lived (a few hours); regenerate on demand.
    """
    __tablename__ = "ndvi_overlays"

    id = Column(Integer, primary_key=True, index=True)
    farm_id = Column(
        Integer, ForeignKey("farms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date = Column(Date, nullable=False)
    tile_url_template = Column(Text, nullable=True)   # XYZ tile URL with {z}/{x}/{y}
    bounds = Column(JSON, nullable=True)              # [[lat_s, lon_w], [lat_n, lon_e]]
    min_ndvi = Column(Float, nullable=True)
    max_ndvi = Column(Float, nullable=True)
    mean_ndvi = Column(Float, nullable=True)
    source = Column(String(50), nullable=True)        # 'gee' | 'planetary_computer' | 'fallback'
    generated_at = Column(DateTime, server_default=text("now()"), nullable=False)

    farm = relationship("Farm")

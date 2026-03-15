"""
Geo-intelligence models for precision agriculture.

Tables:
  - productivity_zones      : K-means NDVI productivity zones per farm polygon
  - scouting_observations   : Ground-truthed field notes with GPS + photos
  - ndvi_overlays           : Metadata for NDVI tile overlays (GEE or fallback)
"""
from datetime import datetime

from sqlalchemy import (
    Column, Integer, String, Float, Date, DateTime, ForeignKey, Text, JSON, text
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

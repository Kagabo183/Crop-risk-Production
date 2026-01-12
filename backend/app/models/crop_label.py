from sqlalchemy import Column, Date, DateTime, Integer, String, Text, func
from geoalchemy2 import Geometry

from app.db.database import Base


class CropLabel(Base):
    __tablename__ = "crop_labels"

    id = Column(Integer, primary_key=True, index=True)

    # Optional link to an existing farm record (useful when labels come from your own farms)
    farm_id = Column(Integer, nullable=True, index=True)

    # The labeled field boundary
    boundary = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)

    # Crop label (multi-class)
    crop_name = Column(String(100), nullable=False, index=True)

    # Optional metadata
    country = Column(String(60), nullable=True, index=True)
    admin1 = Column(String(80), nullable=True, index=True)  # province
    admin2 = Column(String(80), nullable=True, index=True)  # district

    season = Column(String(40), nullable=True, index=True)  # e.g. 2025A, 2025B
    label_date = Column(Date, nullable=True)

    source = Column(String(100), nullable=True, index=True)  # e.g. RadiantMLHub, RAB, NGO
    source_id = Column(String(120), nullable=True, index=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

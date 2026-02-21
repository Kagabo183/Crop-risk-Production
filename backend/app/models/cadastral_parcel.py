from sqlalchemy import Column, Integer, String, Float, Index
from geoalchemy2 import Geometry
from app.db.database import Base


class CadastralParcel(Base):
    """
    Official cadastral parcel from Rwanda LAIS (Land Administration Information System).
    Imported from district shapefiles with survey-grade boundaries.
    """
    __tablename__ = "cadastral_parcels"

    id = Column(Integer, primary_key=True, index=True)
    upi = Column(String(50), index=True, nullable=True)          # Unique Parcel Identifier
    parcel_number = Column(Float, nullable=True)
    province = Column(String(20), nullable=True)
    district = Column(String(20), nullable=True, index=True)
    sector = Column(String(20), nullable=True)
    cell = Column(String(20), nullable=True)
    village = Column(String(30), nullable=True)
    cell_code = Column(String(10), nullable=True)
    boundary = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=True)
    area_sqm = Column(Float, nullable=True)
    centroid_lat = Column(Float, nullable=True)
    centroid_lon = Column(Float, nullable=True)

    # Spatial index for fast ST_Contains queries
    __table_args__ = (
        Index('idx_cadastral_parcels_boundary', 'boundary', postgresql_using='gist'),
    )

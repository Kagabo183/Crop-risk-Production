from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from app.db.database import Base


class Farm(Base):
    __tablename__ = "farms"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    location = Column(String, nullable=True)  # District
    province = Column(String(50), nullable=True)
    crop_type = Column(String(50), nullable=True)
    boundary = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=True)
    area = Column(Float, nullable=True)  # in hectares
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    planting_date = Column(Date, nullable=True)

    # Relationships
    owner = relationship("User", back_populates="farms")
    satellite_images = relationship("SatelliteImage", back_populates="farm", cascade="all, delete-orphan")
    weather_records = relationship("WeatherRecord", back_populates="farm", cascade="all, delete-orphan")
    vegetation_health = relationship("VegetationHealth", back_populates="farm", cascade="all, delete-orphan")

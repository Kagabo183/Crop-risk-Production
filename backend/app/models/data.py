from sqlalchemy import Column, Integer, String, Float, Date, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from app.db.database import Base

class SatelliteImage(Base):
    __tablename__ = "satellite_images"
    id = Column(Integer, primary_key=True, index=True)
    farm_id = Column(Integer, ForeignKey('farms.id', ondelete='CASCADE'), nullable=True)
    date = Column(Date, nullable=False)
    acquisition_date = Column(DateTime, nullable=True)
    region = Column(String, nullable=False)
    image_type = Column(String, nullable=False)  # e.g., 'NDVI', 'EVI', 'RGB'
    file_path = Column(String, nullable=False)  # Path to stored image file
    source = Column(String(50), nullable=True)  # 'sentinel2', 'landsat8', etc.
    cloud_cover_percent = Column(Float, nullable=True)
    processing_status = Column(String(50), nullable=True)  # 'pending', 'processing', 'completed', 'failed'
    
    # Vegetation indices
    mean_ndvi = Column(Float, nullable=True)
    mean_ndre = Column(Float, nullable=True)
    mean_ndwi = Column(Float, nullable=True)
    mean_evi = Column(Float, nullable=True)
    mean_savi = Column(Float, nullable=True)
    
    extra_metadata = Column(JSON, nullable=True)  # Any extra info
    
    # Relationship
    farm = relationship("Farm", back_populates="satellite_images")

class WeatherRecord(Base):
    __tablename__ = "weather_records"
    id = Column(Integer, primary_key=True, index=True)
    farm_id = Column(Integer, ForeignKey('farms.id', ondelete='CASCADE'), nullable=True)
    date = Column(Date, nullable=False)
    region = Column(String, nullable=False)
    rainfall = Column(Float, nullable=True)  # mm
    temperature = Column(Float, nullable=True)  # °C
    temperature_min = Column(Float, nullable=True)  # °C
    temperature_max = Column(Float, nullable=True)  # °C
    humidity = Column(Float, nullable=True)  # %
    wind_speed = Column(Float, nullable=True)  # m/s
    drought_index = Column(Float, nullable=True)  # SPI or similar
    source = Column(String, nullable=False)  # e.g., 'CHIRPS', 'ERA5', 'Open-Meteo'
    extra_metadata = Column(JSON, nullable=True)
    
    # Relationship
    farm = relationship("Farm", back_populates="weather_records")

class VegetationHealth(Base):
    __tablename__ = "vegetation_health"
    id = Column(Integer, primary_key=True, index=True)
    farm_id = Column(Integer, ForeignKey('farms.id', ondelete='CASCADE'), nullable=False)
    date = Column(Date, nullable=False)
    
    # Vegetation indices
    ndvi = Column(Float, nullable=True)
    ndvi_anomaly = Column(Float, nullable=True)  # Deviation from historical baseline
    ndre = Column(Float, nullable=True)
    ndwi = Column(Float, nullable=True)
    evi = Column(Float, nullable=True)
    savi = Column(Float, nullable=True)
    
    # Health assessment
    health_score = Column(Float, nullable=True)  # 0-100
    stress_level = Column(String(20), nullable=True)  # 'none', 'low', 'moderate', 'high', 'severe'
    stress_type = Column(String(50), nullable=True)  # 'drought', 'heat', 'water', 'nutrient', 'multiple'
    
    created_at = Column(DateTime, server_default='now()', nullable=False)
    
    # Relationship
    farm = relationship("Farm", back_populates="vegetation_health")


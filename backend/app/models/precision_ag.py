"""
Precision Agriculture models
============================
Season, CropRotation, SoilSample, SoilNutrientResult, YieldMap, VraMap
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Date, DateTime, JSON,
    ForeignKey, Enum as SAEnum, Text, Boolean,
)
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from app.db.database import Base
import enum


class SeasonStatus(str, enum.Enum):
    planning  = "planning"
    active    = "active"
    completed = "completed"
    cancelled = "cancelled"


class SamplingMethod(str, enum.Enum):
    grid   = "grid"
    zone   = "zone"
    random = "random"


class PrescriptionType(str, enum.Enum):
    seeding    = "seeding"
    fertilizer = "fertilizer"
    chemical   = "chemical"


class Season(Base):
    __tablename__ = "seasons"

    id               = Column(Integer, primary_key=True, index=True)
    farm_id          = Column(Integer, ForeignKey("farms.id", ondelete="CASCADE"), nullable=False, index=True)
    name             = Column(String(100), nullable=False)
    year             = Column(Integer, nullable=False)
    crop_type        = Column(String(100), nullable=False)
    planting_date    = Column(Date, nullable=True)
    harvest_date     = Column(Date, nullable=True)
    target_yield_tha = Column(Float, nullable=True)
    area_planted_ha  = Column(Float, nullable=True)
    status           = Column(SAEnum(SeasonStatus), default=SeasonStatus.planning, nullable=False)
    notes            = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    farm         = relationship("Farm")
    crop_rotations = relationship("CropRotation",  back_populates="season", cascade="all, delete-orphan")
    yield_maps   = relationship("YieldMap",         back_populates="season")
    vra_maps     = relationship("VraMap",            back_populates="season")


class CropRotation(Base):
    __tablename__ = "crop_rotations"

    id                      = Column(Integer, primary_key=True, index=True)
    farm_id                 = Column(Integer, ForeignKey("farms.id", ondelete="CASCADE"), nullable=False, index=True)
    season_id               = Column(Integer, ForeignKey("seasons.id", ondelete="CASCADE"), nullable=False)
    previous_crop           = Column(String(100), nullable=True)
    current_crop            = Column(String(100), nullable=False)
    next_crop_recommendation = Column(String(100), nullable=True)
    rotation_score          = Column(Float, nullable=True)      # 0–10
    nitrogen_fixation       = Column(Boolean, default=False)    # legume in rotation?
    rest_period_weeks       = Column(Integer, nullable=True)
    notes                   = Column(Text, nullable=True)
    recommendations         = Column(JSON, nullable=True)
    created_at              = Column(DateTime, default=datetime.utcnow)

    farm   = relationship("Farm")
    season = relationship("Season", back_populates="crop_rotations")


class SoilSample(Base):
    __tablename__ = "soil_samples"

    id              = Column(Integer, primary_key=True, index=True)
    farm_id         = Column(Integer, ForeignKey("farms.id", ondelete="CASCADE"), nullable=False, index=True)
    sampling_method = Column(SAEnum(SamplingMethod), default=SamplingMethod.grid, nullable=False)
    grid_size_m     = Column(Integer, nullable=True, default=100)
    sampled_at      = Column(Date, nullable=True)
    agronomist_id   = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    total_zones     = Column(Integer, nullable=True)
    sampling_geojson = Column(JSON, nullable=True)
    notes           = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    farm             = relationship("Farm")
    nutrient_results = relationship("SoilNutrientResult", back_populates="soil_sample", cascade="all, delete-orphan")


class SoilNutrientResult(Base):
    __tablename__ = "soil_nutrient_results"

    id             = Column(Integer, primary_key=True, index=True)
    soil_sample_id = Column(Integer, ForeignKey("soil_samples.id", ondelete="CASCADE"), nullable=False, index=True)
    zone_label     = Column(String(50), nullable=True)
    latitude       = Column(Float, nullable=True)
    longitude      = Column(Float, nullable=True)
    point          = Column(Geometry("POINT", srid=4326), nullable=True)
    nitrogen       = Column(Float, nullable=True)    # mg/kg
    phosphorus     = Column(Float, nullable=True)    # mg/kg
    potassium      = Column(Float, nullable=True)    # mg/kg
    organic_matter = Column(Float, nullable=True)   # %
    ph             = Column(Float, nullable=True)
    moisture       = Column(Float, nullable=True)    # %
    raw_data       = Column(JSON, nullable=True)     # additional nutrients
    created_at     = Column(DateTime, default=datetime.utcnow)

    soil_sample = relationship("SoilSample", back_populates="nutrient_results")


class YieldMap(Base):
    __tablename__ = "yield_maps"

    id               = Column(Integer, primary_key=True, index=True)
    farm_id          = Column(Integer, ForeignKey("farms.id", ondelete="CASCADE"), nullable=False, index=True)
    season_id        = Column(Integer, ForeignKey("seasons.id", ondelete="SET NULL"), nullable=True)
    crop_type        = Column(String(100), nullable=True)
    harvest_date     = Column(Date, nullable=True)
    file_path        = Column(String, nullable=True)
    geojson_data     = Column(JSON, nullable=True)
    mean_yield_tha   = Column(Float, nullable=True)
    max_yield_tha    = Column(Float, nullable=True)
    min_yield_tha    = Column(Float, nullable=True)
    total_yield_kg   = Column(Float, nullable=True)
    area_harvested_ha = Column(Float, nullable=True)
    variability_cv   = Column(Float, nullable=True)    # coefficient of variation %
    high_yield_area_ha = Column(Float, nullable=True)
    low_yield_area_ha  = Column(Float, nullable=True)
    zone_comparison  = Column(JSON, nullable=True)     # yield vs productivity zones
    created_at       = Column(DateTime, default=datetime.utcnow)

    farm   = relationship("Farm")
    season = relationship("Season", back_populates="yield_maps")


class VraMap(Base):
    __tablename__ = "vra_maps"

    id                = Column(Integer, primary_key=True, index=True)
    farm_id           = Column(Integer, ForeignKey("farms.id", ondelete="CASCADE"), nullable=False, index=True)
    season_id         = Column(Integer, ForeignKey("seasons.id", ondelete="SET NULL"), nullable=True)
    prescription_type = Column(SAEnum(PrescriptionType), nullable=False)
    zones_geojson     = Column(JSON, nullable=False)
    rates_json        = Column(JSON, nullable=True)
    product_name      = Column(String(200), nullable=True)
    base_rate         = Column(Float, nullable=True)
    high_zone_rate    = Column(Float, nullable=True)
    medium_zone_rate  = Column(Float, nullable=True)
    low_zone_rate     = Column(Float, nullable=True)
    total_product_kg  = Column(Float, nullable=True)
    savings_pct       = Column(Float, nullable=True)   # vs flat-rate application
    generated_at      = Column(DateTime, default=datetime.utcnow)

    farm   = relationship("Farm")
    season = relationship("Season", back_populates="vra_maps")

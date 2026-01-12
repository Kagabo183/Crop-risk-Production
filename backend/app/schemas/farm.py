from pydantic import BaseModel
from typing import Optional, Any, Dict

class FarmBase(BaseModel):
    name: str
    location: Optional[str] = None
    province: Optional[str] = None
    crop_type: Optional[str] = None
    boundary: Optional[Dict[str, Any]] = None  # GeoJSON Polygon
    area: Optional[float] = None
    owner_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class FarmCreate(FarmBase):
    pass


class FarmUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    province: Optional[str] = None
    crop_type: Optional[str] = None
    boundary: Optional[Dict[str, Any]] = None  # GeoJSON Polygon
    area: Optional[float] = None
    owner_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class Farm(FarmBase):
    id: int

    class Config:
        from_attributes = True

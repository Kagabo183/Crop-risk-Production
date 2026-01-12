from sqlalchemy import Column, Integer, String, Float
from geoalchemy2 import Geometry
from app.db.database import Base

class Farm(Base):
    __tablename__ = "farms"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    location = Column(String, nullable=True)  # District
    province = Column(String(50), nullable=True)  # Province (Northern, Southern, Eastern, Western, Kigali)
    crop_type = Column(String(50), nullable=True)  # Crop kind (e.g., potato, maize)
    boundary = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=True)
    area = Column(Float, nullable=True)  # in hectares
    owner_id = Column(Integer, nullable=True)  # FK to User, can be set up later
    latitude = Column(Float, nullable=True)  # GPS latitude
    longitude = Column(Float, nullable=True)  # GPS longitude

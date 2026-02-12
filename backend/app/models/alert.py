from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func, JSON, Boolean
from sqlalchemy.orm import relationship
from app.db.database import Base

class Alert(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True, index=True)
    farm_id = Column(Integer, ForeignKey("farms.id"), nullable=False)
    alert_type = Column(String(50), nullable=True)  # 'ndvi_decline', 'disease_risk', 'drought', etc.
    message = Column(String, nullable=False)
    level = Column(String(20), nullable=True)  # e.g., 'low', 'medium', 'high' (old field)
    severity = Column(String(20), nullable=True)  # 'low', 'moderate', 'high', 'critical'
    source = Column(String(50), nullable=True)  # 'simulated', 'ml_model', 'sensor', etc.
    alert_data = Column(JSON, nullable=True)  # Additional alert data (renamed from 'metadata')
    resolved = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    farm = relationship("Farm")

from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class AlertBase(BaseModel):
    farm_id: int
    message: str
    level: str
    alert_type: Optional[str] = None
    severity: Optional[str] = None
    action_days_min: Optional[int] = None
    action_days_max: Optional[int] = None

class AlertCreate(AlertBase):
    pass

class Alert(AlertBase):
    id: int
    resolved: Optional[bool] = False
    created_at: datetime

    class Config:
        from_attributes = True

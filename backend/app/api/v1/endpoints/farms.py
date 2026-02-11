from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, ConfigDict

from app.db.database import get_db
from app.models.farm import Farm as FarmModel

router = APIRouter()


class FarmOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    location: Optional[str] = None
    crop_type: Optional[str] = None
    area: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@router.get("/", response_model=List[FarmOut])
def get_farms(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    farms = db.query(FarmModel).offset(skip).limit(limit).all()
    return farms

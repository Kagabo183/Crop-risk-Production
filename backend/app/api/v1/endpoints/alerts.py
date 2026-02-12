
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.db.database import get_db
from app.models.alert import Alert as AlertModel
from app.schemas.alert import Alert, AlertCreate
from app.models.farm import Farm
from app.core.auth import get_current_active_user, check_farm_access
from app.models.user import User as UserModel

router = APIRouter()

@router.get("/", response_model=List[Alert])
def get_alerts(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    query = db.query(AlertModel).join(Farm)
    if current_user.role == "farmer":
        query = query.filter(Farm.owner_id == current_user.id)
    elif current_user.role == "agronomist" and current_user.district:
        query = query.filter(Farm.location == current_user.district)
        
    return query.all()

@router.post("/", response_model=Alert)
def create_alert(
    alert: AlertCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    # Verify farm access
    farm = db.query(Farm).filter(Farm.id == alert.farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    check_farm_access(farm, current_user)
    
    db_alert = AlertModel(**alert.dict())
    db.add(db_alert)
    db.commit()
    db.refresh(db_alert)
    return db_alert

@router.get("/{alert_id}", response_model=Alert)
def get_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    alert = db.query(AlertModel).filter(AlertModel.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    # Check access to the associated farm
    farm = db.query(Farm).filter(Farm.id == alert.farm_id).first()
    if farm:
        check_farm_access(farm, current_user)
        
    return alert

@router.put("/{alert_id}", response_model=Alert)
def update_alert(
    alert_id: int,
    alert: AlertCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    db_alert = db.query(AlertModel).filter(AlertModel.id == alert_id).first()
    if not db_alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    # Check access to the associated farm
    farm = db.query(Farm).filter(Farm.id == db_alert.farm_id).first()
    if farm:
        check_farm_access(farm, current_user)
        
    for field, value in alert.dict().items():
        setattr(db_alert, field, value)
    db.commit()
    db.refresh(db_alert)
    return db_alert

@router.api_route("/{alert_id}", methods=["DELETE"])
def delete_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    db_alert = db.query(AlertModel).filter(AlertModel.id == alert_id).first()
    if not db_alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    # Check access to the associated farm
    farm = db.query(Farm).filter(Farm.id == db_alert.farm_id).first()
    if farm:
        check_farm_access(farm, current_user)
        
    db.delete(db_alert)
    db.commit()
    return {"detail": "Alert deleted"}

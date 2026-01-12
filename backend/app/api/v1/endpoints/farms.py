from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Any, Dict, List, Optional

from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import mapping, shape

from app.db.database import get_db
from app.models.farm import Farm as FarmModel
from app.schemas.farm import Farm, FarmCreate, FarmUpdate

router = APIRouter()


def _geom_to_geojson(geom: Any) -> Optional[Dict[str, Any]]:
    if geom is None:
        return None
    try:
        return mapping(to_shape(geom))
    except Exception:
        return None


def _geojson_to_polygon(geojson: Dict[str, Any]):
    geom = shape(geojson)
    if geom.geom_type != "Polygon":
        raise HTTPException(status_code=422, detail="boundary must be a GeoJSON Polygon")
    return geom


def _farm_to_schema(db_farm: FarmModel) -> Farm:
    return Farm(
        id=db_farm.id,
        name=db_farm.name,
        location=db_farm.location,
        province=db_farm.province,
        crop_type=db_farm.crop_type,
        boundary=_geom_to_geojson(db_farm.boundary),
        area=db_farm.area,
        owner_id=db_farm.owner_id,
        latitude=db_farm.latitude,
        longitude=db_farm.longitude,
    )

@router.get("/", response_model=List[Farm])
def get_farms(db: Session = Depends(get_db)):
    farms = db.query(FarmModel).all()
    return [_farm_to_schema(f) for f in farms]

@router.post("/", response_model=Farm)
def create_farm(farm: FarmCreate, db: Session = Depends(get_db)):
    data = farm.model_dump()
    boundary_geojson = data.pop("boundary", None)

    db_farm = FarmModel(**data)
    if boundary_geojson is not None:
        polygon = _geojson_to_polygon(boundary_geojson)
        db_farm.boundary = from_shape(polygon, srid=4326)
        if db_farm.latitude is None or db_farm.longitude is None:
            centroid = polygon.centroid
            db_farm.latitude = float(centroid.y)
            db_farm.longitude = float(centroid.x)

    db.add(db_farm)
    db.commit()
    db.refresh(db_farm)
    return _farm_to_schema(db_farm)

@router.get("/{farm_id}", response_model=Farm)
def get_farm(farm_id: int, db: Session = Depends(get_db)):
    farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    return _farm_to_schema(farm)

@router.put("/{farm_id}", response_model=Farm)
def update_farm(farm_id: int, farm: FarmCreate, db: Session = Depends(get_db)):
    db_farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not db_farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    db_farm.name = farm.name
    db_farm.location = farm.location
    db_farm.province = farm.province
    db_farm.crop_type = farm.crop_type
    desired_lat = farm.latitude
    desired_lon = farm.longitude
    if farm.boundary is None:
        db_farm.boundary = None
    else:
        polygon = _geojson_to_polygon(farm.boundary)
        db_farm.boundary = from_shape(polygon, srid=4326)
        if desired_lat is None or desired_lon is None:
            centroid = polygon.centroid
            desired_lat = float(centroid.y)
            desired_lon = float(centroid.x)
    db_farm.area = farm.area
    db_farm.owner_id = farm.owner_id
    db_farm.latitude = desired_lat
    db_farm.longitude = desired_lon
    db.commit()
    db.refresh(db_farm)
    return _farm_to_schema(db_farm)


@router.patch("/{farm_id}", response_model=Farm)
def patch_farm(farm_id: int, farm: FarmUpdate, db: Session = Depends(get_db)):
    db_farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not db_farm:
        raise HTTPException(status_code=404, detail="Farm not found")

    data = farm.model_dump(exclude_unset=True)

    if "boundary" in data:
        boundary_geojson = data.pop("boundary")
        if boundary_geojson is None:
            db_farm.boundary = None
        else:
            polygon = _geojson_to_polygon(boundary_geojson)
            db_farm.boundary = from_shape(polygon, srid=4326)
            if "latitude" not in data or "longitude" not in data:
                if db_farm.latitude is None or db_farm.longitude is None:
                    centroid = polygon.centroid
                    db_farm.latitude = float(centroid.y)
                    db_farm.longitude = float(centroid.x)

    for key, value in data.items():
        setattr(db_farm, key, value)

    db.commit()
    db.refresh(db_farm)
    return _farm_to_schema(db_farm)

@router.api_route("/{farm_id}", methods=["DELETE"])
def delete_farm(farm_id: int, db: Session = Depends(get_db)):
    db_farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not db_farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    db.delete(db_farm)
    db.commit()
    return {"detail": "Farm deleted"}

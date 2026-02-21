from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from pydantic import BaseModel

from app.db.database import get_db
from app.core.auth import get_current_active_user
from app.models.user import User as UserModel

router = APIRouter()


class ParcelOut(BaseModel):
    """Response schema for a cadastral parcel."""
    id: int
    upi: Optional[str] = None
    parcel_number: Optional[float] = None
    province: Optional[str] = None
    district: Optional[str] = None
    sector: Optional[str] = None
    cell: Optional[str] = None
    village: Optional[str] = None
    area_sqm: Optional[float] = None
    area_hectares: Optional[float] = None
    centroid_lat: Optional[float] = None
    centroid_lon: Optional[float] = None
    boundary_geojson: Optional[dict] = None


def _row_to_parcel(row) -> dict:
    """Convert a database row to a ParcelOut dict."""
    area_sqm = row.area_sqm or 0
    return {
        'id': row.id,
        'upi': row.upi,
        'parcel_number': row.parcel_number,
        'province': row.province,
        'district': row.district,
        'sector': row.sector,
        'cell': row.cell,
        'village': row.village,
        'area_sqm': area_sqm,
        'area_hectares': round(area_sqm / 10000, 4) if area_sqm else None,
        'centroid_lat': row.centroid_lat,
        'centroid_lon': row.centroid_lon,
        'boundary_geojson': None,  # filled separately if needed
    }


@router.get("/search", response_model=List[ParcelOut])
def search_parcels(
    upi: str = Query(..., min_length=1, description="UPI or partial UPI to search"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Search cadastral parcels by UPI (partial match).
    Returns parcels matching the UPI prefix with their boundaries.
    """
    result = db.execute(text("""
        SELECT id, upi, parcel_number, province, district, sector, cell, village,
               area_sqm, centroid_lat, centroid_lon,
               ST_AsGeoJSON(boundary)::json AS boundary_geojson
        FROM cadastral_parcels
        WHERE upi ILIKE :pattern
        ORDER BY upi
        LIMIT :limit
    """), {'pattern': f'%{upi}%', 'limit': limit})

    parcels = []
    for row in result:
        p = _row_to_parcel(row)
        p['boundary_geojson'] = row.boundary_geojson
        parcels.append(p)

    return parcels


@router.get("/find-by-location", response_model=List[ParcelOut])
def find_parcel_by_location(
    lat: float = Query(..., description="Latitude (WGS84)"),
    lon: float = Query(..., description="Longitude (WGS84)"),
    radius_m: int = Query(50, ge=10, le=500, description="Search radius in meters"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Find cadastral parcels near or containing a GPS location.
    First tries ST_Contains (exact match), then falls back to nearest within radius.
    """
    # First: exact match — point is inside a parcel
    result = db.execute(text("""
        SELECT id, upi, parcel_number, province, district, sector, cell, village,
               area_sqm, centroid_lat, centroid_lon,
               ST_AsGeoJSON(boundary)::json AS boundary_geojson
        FROM cadastral_parcels
        WHERE ST_Contains(boundary, ST_SetSRID(ST_Point(:lon, :lat), 4326))
        LIMIT :limit
    """), {'lat': lat, 'lon': lon, 'limit': limit})

    parcels = []
    for row in result:
        p = _row_to_parcel(row)
        p['boundary_geojson'] = row.boundary_geojson
        parcels.append(p)

    if parcels:
        return parcels

    # Fallback: nearest parcels within radius
    result = db.execute(text("""
        SELECT id, upi, parcel_number, province, district, sector, cell, village,
               area_sqm, centroid_lat, centroid_lon,
               ST_AsGeoJSON(boundary)::json AS boundary_geojson,
               ST_Distance(
                   boundary::geography,
                   ST_SetSRID(ST_Point(:lon, :lat), 4326)::geography
               ) AS distance_m
        FROM cadastral_parcels
        WHERE ST_DWithin(
            boundary::geography,
            ST_SetSRID(ST_Point(:lon, :lat), 4326)::geography,
            :radius
        )
        ORDER BY distance_m
        LIMIT :limit
    """), {'lat': lat, 'lon': lon, 'radius': radius_m, 'limit': limit})

    for row in result:
        p = _row_to_parcel(row)
        p['boundary_geojson'] = row.boundary_geojson
        parcels.append(p)

    return parcels


@router.get("/stats")
def parcel_stats(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """Get summary stats about imported cadastral parcels."""
    result = db.execute(text("""
        SELECT
            COUNT(*) AS total,
            COUNT(DISTINCT district) AS districts,
            COUNT(DISTINCT sector) AS sectors,
            COUNT(DISTINCT cell) AS cells
        FROM cadastral_parcels
    """))
    row = result.first()
    return {
        'total_parcels': row.total if row else 0,
        'districts': row.districts if row else 0,
        'sectors': row.sectors if row else 0,
        'cells': row.cells if row else 0,
    }

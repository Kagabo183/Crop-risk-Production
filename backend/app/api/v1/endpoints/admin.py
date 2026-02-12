"""
Admin utility endpoint to populate VegetationHealth records
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.data import SatelliteImage, VegetationHealth
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/admin/populate-vegetation-health")
def populate_vegetation_health(db: Session = Depends(get_db)):
    """Populate VegetationHealth records from existing SatelliteImage data"""
    try:
        satellite_images = db.query(SatelliteImage).filter(
            SatelliteImage.mean_ndvi.isnot(None)
        ).all()
        
        logger.info(f"Found {len(satellite_images)} satellite images with NDVI")
        
        created = 0
        updated = 0
        
        for sat in satellite_images:
            existing = db.query(VegetationHealth).filter(
                VegetationHealth.farm_id == sat.farm_id,
                VegetationHealth.date == sat.date
            ).first()
            
            ndvi = sat.mean_ndvi or 0.5
            health_score = min(100, max(0, ndvi * 100))
            
            if ndvi >= 0.7:
                stress_level = 'none'
            elif ndvi >= 0.5:
                stress_level = 'low'
            elif ndvi >= 0.4:
                stress_level = 'moderate'
            elif ndvi >= 0.3:
                stress_level = 'high'
            else:
                stress_level = 'severe'
            
            if existing:
                existing.ndvi = sat.mean_ndvi
                existing.ndre = sat.mean_ndre
                existing.ndwi = sat.mean_ndwi
                existing.evi = sat.mean_evi
                existing.savi = sat.mean_savi
                existing.health_score = health_score
                existing.stress_level = stress_level
                existing.stress_type = stress_level
                updated += 1
            else:
                veg = VegetationHealth(
                    farm_id=sat.farm_id,
                    date=sat.date,
                    ndvi=sat.mean_ndvi,
                    ndre=sat.mean_ndre,
                    ndwi=sat.mean_ndwi,
                    evi=sat.mean_evi,
                    savi=sat.mean_savi,
                    health_score=health_score,
                    stress_level=stress_level,
                    stress_type=stress_level
                )
                db.add(veg)
                created += 1
        
        db.commit()
        total = db.query(VegetationHealth).count()
        
        return {
            "success": True,
            "created": created,
            "updated": updated,
            "total_vegetation_health_records": total
        }
        
    except Exception as e:
        logger.error(f"Error populating vegetation health: {e}")
        db.rollback()
        return {"success": False, "error": str(e)}

"""
Populate VegetationHealth records from existing SatelliteImage data
Run this to initialize stress monitoring functionality
"""
from app.db.database import SessionLocal
from app.models.data import SatelliteImage, VegetationHealth
from app.models.farm import Farm
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def populate_vegetation_health():
    db = SessionLocal()
    try:
        # Get all satellite images with vegetation indices
        satellite_images = db.query(SatelliteImage).filter(
            SatelliteImage.mean_ndvi.isnot(None)
        ).all()
        
        logger.info(f"Found {len(satellite_images)} satellite images with NDVI data")
        
        created_count = 0
        updated_count = 0
        
        for sat_img in satellite_images:
            # Check if VegetationHealth record already exists
            existing = db.query(VegetationHealth).filter(
                VegetationHealth.farm_id == sat_img.farm_id,
                VegetationHealth.date == sat_img.date
            ).first()
            
            # Calculate health score from indices
            ndvi = sat_img.mean_ndvi or 0.5
            health_score = min(100, max(0, ndvi * 100))
            
            # Determine stress level based on NDVI
            if ndvi >= 0.7:
                stress_level = 'none'
                stress_type = 'none'
            elif ndvi >= 0.5:
                stress_level = 'low'
                stress_type = 'low'
            elif ndvi >= 0.4:
                stress_level = 'moderate'
                stress_type = 'moderate'
            elif ndvi >= 0.3:
                stress_level = 'high'
                stress_type = 'high'
            else:
                stress_level = 'severe'
                stress_type = 'severe'
            
            if existing:
                # Update existing
                existing.ndvi = sat_img.mean_ndvi
                existing.ndre = sat_img.mean_ndre
                existing.ndwi = sat_img.mean_ndwi
                existing.evi = sat_img.mean_evi
                existing.savi = sat_img.mean_savi
                existing.health_score = health_score
                existing.stress_level = stress_level
                existing.stress_type = stress_type
                updated_count += 1
            else:
                # Create new
                veg_health = VegetationHealth(
                    farm_id=sat_img.farm_id,
                    date=sat_img.date,
                    ndvi=sat_img.mean_ndvi,
                    ndre=sat_img.mean_ndre,
                    ndwi=sat_img.mean_ndwi,
                    evi=sat_img.mean_evi,
                    savi=sat_img.mean_savi,
                    health_score=health_score,
                    stress_level=stress_level,
                    stress_type=stress_type
                )
                db.add(veg_health)
                created_count += 1
        
        db.commit()
        logger.info(f"✅ Created {created_count} new VegetationHealth records")
        logger.info(f"✅ Updated {updated_count} existing VegetationHealth records")
        logger.info(f"Total VegetationHealth records: {db.query(VegetationHealth).count()}")
        
    except Exception as e:
        logger.error(f"Error populating vegetation health: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    populate_vegetation_health()

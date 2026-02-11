from app.db.database import SessionLocal
from app.models.data import SatelliteImage, VegetationHealth
from datetime import datetime

db = SessionLocal()
try:
    sat_images = db.query(SatelliteImage).filter(SatelliteImage.mean_ndvi.isnot(None)).all()
    print(f"Found {len(sat_images)} satellite images with NDVI")
    
    created = 0
    for sat in sat_images:
        existing = db.query(VegetationHealth).filter(
            VegetationHealth.farm_id == sat.farm_id,
            VegetationHealth.date == sat.date
        ).first()
        
        if not existing:
            ndvi = sat.mean_ndvi or 0.5
            health_score = min(100, max(0, ndvi * 100))
            stress_level = "none" if ndvi >= 0.7 else ("low" if ndvi >= 0.5 else ("moderate" if ndvi >= 0.4 else "high"))
            
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
                stress_type=stress_level,
                created_at=datetime.utcnow()
            )
            db.add(veg)
            created += 1
            
            if created % 100 == 0:
                db.commit()
                print(f"Created {created} records so far...")
    
    db.commit()
    total = db.query(VegetationHealth).count()
    print(f"SUCCESS: Created {created} new VegetationHealth records")
    print(f"Total VegetationHealth records now: {total}")
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
    db.rollback()
finally:
    db.close()

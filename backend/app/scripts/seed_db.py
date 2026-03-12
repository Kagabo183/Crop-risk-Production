"""
Seed the database with sample data for learning and testing.
"""
import os
import sys
from datetime import datetime, timedelta
from passlib.context import CryptContext

# Add backend dir to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.db.database import SessionLocal
from app.models.user import User, UserRole
from app.models.farm import Farm
from app.models.data import SatelliteImage, VegetationHealth

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password):
    return pwd_context.hash(password)

def seed_db():
    db = SessionLocal()
    try:
        # 1. Create Users
        print("Seeding users...")
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            admin = User(
                username="admin",
                hashed_password=get_password_hash("12345"),
                full_name="Platform Admin",
                role=UserRole.admin,
                is_active=True
            )
            db.add(admin)
        
        farmer = db.query(User).filter(User.username == "farmer").first()
        if not farmer:
            farmer = User(
                username="farmer",
                hashed_password=get_password_hash("12345"),
                full_name="John Farmer",
                role=UserRole.farmer,
                district="Musanze",
                is_active=True
            )
            db.add(farmer)
        
        db.commit()
        db.refresh(farmer)
        
        # 2. Create Farms
        print("Seeding farms...")
        if db.query(Farm).count() == 0:
            farms = [
                Farm(
                    name="Musanze Potato Farm",
                    location="Musanze - Kinigi",
                    latitude=-1.467,
                    longitude=29.633,
                    area=2.5,
                    crop_type="Potato",
                    owner_id=farmer.id
                ),
                Farm(
                    name="Rwamagana Maize Field",
                    location="Rwamagana - Muhazi",
                    latitude=-1.933,
                    longitude=30.433,
                    area=5.0,
                    crop_type="Maize",
                    owner_id=farmer.id
                )
            ]
            db.add_all(farms)
            db.commit()
            
            # 3. Create Sample Satellite Data
            print("Seeding satellite and health data...")
            farms = db.query(Farm).all()
            for farm in farms:
                # Add a few historical images
                for i in range(3):
                    date = datetime.now() - timedelta(days=i*10)
                    sat_img = SatelliteImage(
                        farm_id=farm.id,
                        date=date.date(),
                        region=farm.location,
                        image_type="multispectral",
                        file_path=f"dummy_path_{i}",
                        source="sentinel2",
                        mean_ndvi=0.6 + (i * 0.05),
                        processing_status="completed"
                    )
                    db.add(sat_img)
                    
                    health = VegetationHealth(
                        farm_id=farm.id,
                        date=date.date(),
                        ndvi=0.6 + (i * 0.05),
                        health_score=75 + (i * 5),
                        stress_level="none" if i < 2 else "low"
                    )
                    db.add(health)
            
            db.commit()
            print("Database seeded successfully!")
        else:
            print("Database already has data, skipping seed.")
            
    except Exception as e:
        print(f"Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_db()

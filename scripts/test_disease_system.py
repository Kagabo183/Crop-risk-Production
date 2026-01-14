"""
Test script to verify disease prediction system is working
Run this after setup to confirm everything is configured correctly
"""
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from datetime import datetime
from app.db.database import SessionLocal
from app.models.farm import Farm
from app.models.disease import Disease
from app.services.disease_intelligence import DiseaseModelEngine, ShortTermForecastEngine
from app.services.weather_service import WeatherDataIntegrator


def test_database_connection():
    """Test database connection"""
    print("\n1️⃣  Testing Database Connection...")
    try:
        db = SessionLocal()
        # Try a simple query
        farm_count = db.query(Farm).count()
        disease_count = db.query(Disease).count()
        db.close()
        
        print(f"   ✅ Database connected successfully")
        print(f"   📊 Farms: {farm_count}, Diseases: {disease_count}")
        return True
    except Exception as e:
        print(f"   ❌ Database connection failed: {e}")
        return False


def test_weather_integration():
    """Test weather data integration"""
    print("\n2️⃣  Testing Weather Integration...")
    try:
        weather_integrator = WeatherDataIntegrator()
        
        # Test with Kigali coordinates
        test_lat = -1.9403
        test_lon = 29.8739
        
        weather_data = weather_integrator.integrate_multi_source_data(
            lat=test_lat,
            lon=test_lon,
            start_date=datetime.now(),
            end_date=datetime.now()
        )
        
        print(f"   ✅ Weather integration working")
        print(f"   🌡️  Temperature: {weather_data.get('temperature', 'N/A')}°C")
        print(f"   💧 Humidity: {weather_data.get('humidity', 'N/A')}%")
        print(f"   🌧️  Rainfall: {weather_data.get('rainfall', 'N/A')}mm")
        
        # Test disease risk calculation
        risk_factors = weather_integrator.calculate_disease_risk_factors(weather_data)
        print(f"   🦠 Fungal Risk: {risk_factors.get('fungal_risk', 'N/A')}/100")
        
        return True
    except Exception as e:
        print(f"   ❌ Weather integration failed: {e}")
        return False


def test_disease_models():
    """Test disease prediction models"""
    print("\n3️⃣  Testing Disease Models...")
    try:
        disease_engine = DiseaseModelEngine()
        
        # Test weather data
        test_weather = {
            'temperature': 18.0,
            'humidity': 92.0,
            'rainfall': 5.0,
            'leaf_wetness': 0.65,
            'wind_speed': 3.0
        }
        
        print("\n   Testing Late Blight Model...")
        late_blight = disease_engine.predict_late_blight(test_weather)
        print(f"   ✅ Late Blight: {late_blight['risk_score']:.1f}/100 ({late_blight['risk_level']})")
        
        print("\n   Testing Septoria Model...")
        septoria = disease_engine.predict_septoria_leaf_spot(test_weather)
        print(f"   ✅ Septoria: {septoria['risk_score']:.1f}/100 ({septoria['risk_level']})")
        
        print("\n   Testing Powdery Mildew Model...")
        mildew = disease_engine.predict_powdery_mildew(test_weather)
        print(f"   ✅ Powdery Mildew: {mildew['risk_score']:.1f}/100 ({mildew['risk_level']})")
        
        return True
    except Exception as e:
        print(f"   ❌ Disease models failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_forecast_engine():
    """Test forecast generation"""
    print("\n4️⃣  Testing Forecast Engine...")
    try:
        db = SessionLocal()
        
        # Get first farm
        farm = db.query(Farm).first()
        if not farm:
            print(f"   ⚠️  No farms found in database. Create a farm first.")
            db.close()
            return False
        
        forecast_engine = ShortTermForecastEngine()
        
        # Test daily forecast
        daily_forecasts = forecast_engine.generate_daily_forecast(
            farm=farm,
            disease_name="Late Blight",
            db=db,
            forecast_days=3
        )
        
        print(f"   ✅ Generated 3-day forecast for {farm.name}")
        for forecast in daily_forecasts:
            risk_icon = "🔴" if forecast['risk_score'] >= 75 else "🟡" if forecast['risk_score'] >= 40 else "🟢"
            print(f"      {risk_icon} Day {forecast['day_offset']}: {forecast['risk_score']:.1f}/100")
        
        db.close()
        return True
    except Exception as e:
        print(f"   ❌ Forecast engine failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_disease_catalog():
    """Test disease catalog"""
    print("\n5️⃣  Testing Disease Catalog...")
    try:
        db = SessionLocal()
        diseases = db.query(Disease).all()
        
        if len(diseases) == 0:
            print(f"   ⚠️  No diseases in catalog. Run: python scripts/generate_disease_predictions.py init")
            db.close()
            return False
        
        print(f"   ✅ Found {len(diseases)} diseases in catalog:")
        for disease in diseases:
            print(f"      • {disease.name} ({disease.pathogen_type})")
        
        db.close()
        return True
    except Exception as e:
        print(f"   ❌ Disease catalog check failed: {e}")
        return False


def print_summary(results):
    """Print test summary"""
    print("\n" + "=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    
    total = len(results)
    passed = sum(results.values())
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    print("=" * 60)
    print(f"Result: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All systems operational!")
        print("\n📚 Next steps:")
        print("   1. Start the API server: uvicorn app:app --reload --app-dir backend")
        print("   2. Visit API docs: http://localhost:8000/docs")
        print("   3. Fetch weather data: python scripts/fetch_enhanced_weather.py all")
        print("   4. Generate predictions: python scripts/generate_disease_predictions.py all")
    else:
        print("⚠️  Some tests failed. Check the errors above.")
        print("\n🔧 Troubleshooting:")
        if not results.get("Database Connection"):
            print("   • Check DATABASE_URL in .env file")
            print("   • Ensure PostgreSQL is running")
            print("   • Run migrations: alembic -c backend/alembic.ini upgrade head")
        if not results.get("Disease Catalog"):
            print("   • Initialize diseases: python scripts/generate_disease_predictions.py init")
        if not results.get("Forecast Engine") and not results.get("Disease Catalog"):
            print("   • Create a test farm in the database")
    
    print("=" * 60)


if __name__ == "__main__":
    print("=" * 60)
    print("🧪 Disease Prediction System Test Suite")
    print("=" * 60)
    
    results = {}
    
    # Run all tests
    results["Database Connection"] = test_database_connection()
    results["Weather Integration"] = test_weather_integration()
    results["Disease Models"] = test_disease_models()
    results["Disease Catalog"] = test_disease_catalog()
    results["Forecast Engine"] = test_forecast_engine()
    
    # Print summary
    print_summary(results)

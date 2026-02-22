import requests
import sys

BASE_URL = "http://localhost:8000/api/v1"

def test_location(lat, lon, expected_province):
    print(f"Testing {lat}, {lon} (Expected: {expected_province})...")
    try:
        # We need a token for the endpoint, but for quick testing we might skip if not easily available
        # However, the endpoint requires 'require_farmer_or_above'
        # Let's try to login first or just test the utility function directly if API is hard to reach depending on env
        
        # Actually, let's test the utility function directly to avoid auth issues in this script
        sys.path.append('.')
        from app.utils.rwanda_boundary import detect_location_details
        
        result = detect_location_details(lat, lon)
        print(f"Result: {result}")
        
        if result['province'] == expected_province:
            print("✅ PASS")
        else:
            print(f"❌ FAIL: Expected {expected_province}, got {result['province']}")
            
    except Exception as e:
        print(f"❌ ERROR: {e}")

if __name__ == "__main__":
    print("--- Testing Location Detection Utility ---")
    
    # Kigali (Convention Center)
    test_location(-1.954, 30.093, "Kigali")
    
    # Musanze (Northern)
    test_location(-1.500, 29.633, "Northern")
    
    # Huye (Southern)
    test_location(-2.600, 29.733, "Southern")
    
    # Kayonza (Eastern)
    test_location(-1.950, 30.516, "Eastern")
    
    # Rubavu (Western)
    test_location(-1.677, 29.266, "Western")

import requests
import sys

BASE_URL = "http://localhost:8000/api/v1"

# Credentials
ADMIN_CRED = {"username": "admin@example.com", "password": "adminpassword"}
FARMER_CRED = {"username": "farmer1@test.rw", "password": "test123"}
AGRO_CRED =   {"username": "kigali.agro@minagri.gov.rw", "password": "securePass123!"} # Example agro

def get_token(creds):
    try:
        data = {
            "username": creds['username'],
            "password": creds['password'],
        }
        res = requests.post(f"{BASE_URL}/auth/login", data=data) 
        # Check if login failed (maybe user doesn't exist)
        if res.status_code != 200:
            print(f"Login failed for {creds['username']}: {res.status_code}")
            return None
        return res.json()["access_token"]
    except Exception as e:
        print(f"Error logging in {creds['username']}: {e}")
        return None

def test_farm_access(role, token, should_see_owned=True, check_district=False):
    headers = {"Authorization": f"Bearer {token}"}
    print(f"\n--- Testing Farm Access as {role} ---")
    
    # 1. Get Farms
    res = requests.get(f"{BASE_URL}/farms/", headers=headers)
    if res.status_code == 200:
        farms = res.json()
        print(f"Success! Can see {len(farms)} farms.")
        if len(farms) > 0:
            farm_id = farms[0]['id']
            print(f"Sample Farm ID: {farm_id}, Owner: {farms[0]['owner_id']}, Location: {farms[0].get('location')}")
            
            # 2. Try analysis endpoint
            print(f"Testing Analysis Access for Farm {farm_id}...")
            stress_res = requests.get(f"{BASE_URL}/stress/health/{farm_id}", headers=headers)
            print(f"Metrics Status: {stress_res.status_code}")
            
            if stress_res.status_code == 200:
                 print("✅ Allowed access to analysis")
            elif stress_res.status_code == 403:
                 print("⛔ Forbidden (Correct if expected)")
            else:
                 print(f"⚠️ Unexpected status: {stress_res.status_code}")

    else:
        print(f"Failed to list farms: {res.status_code}")


import random
import string

def random_string(length=6):
    return ''.join(random.choices(string.ascii_lowercase, k=length))

def register_user(role, email, password, district="Kigali"):
    data = {
        "email": email,
        "password": password,
        "full_name": f"Test {role}",
        "role": role.lower(),
        "district": district
    }
    print(f"Registering {role}: {email} in {district}...")
    res = requests.post(f"{BASE_URL}/auth/register", json=data)
    if res.status_code == 200:
        return True
    elif res.status_code == 400 and "already registered" in res.text:
        print("User already exists, proceeding...")
        return True
    else:
        print(f"Registration failed: {res.text}")
        return False

def create_farm(token, name, location="Kigali"):
    headers = {"Authorization": f"Bearer {token}"}
    data = {
        "name": name,
        "location": location,
        "area": 1.5,
        "crop_type": "maize",
        "latitude": -1.95,
        "longitude": 30.05
    }
    res = requests.post(f"{BASE_URL}/farms/", json=data, headers=headers)
    if res.status_code == 200:
        return res.json()['id']
    else:
        print(f"Failed to create farm: {res.text}")
        return None

def main():
    print("Verifying RBAC Implementation...")
    
    suffix = random_string()
    farmer_email = f"farmer_{suffix}@test.com"
    agro_kigali_email = f"agro_kigali_{suffix}@test.com"
    agro_musanze_email = f"agro_musanze_{suffix}@test.com"
    password = "testpassword123"

    # 1. Register Users
    if not register_user("farmer", farmer_email, password, "Kigali"): return
    if not register_user("agronomist", agro_kigali_email, password, "Kigali"): return
    if not register_user("agronomist", agro_musanze_email, password, "Musanze"): return

    # 2. Login
    farmer_token = get_token({"username": farmer_email, "password": password})
    agro_kigali_token = get_token({"username": agro_kigali_email, "password": password})
    agro_musanze_token = get_token({"username": agro_musanze_email, "password": password})

    if not all([farmer_token, agro_kigali_token, agro_musanze_token]):
        print("Failed to log in one or more users.")
        return

    # 3. Farmer creates a farm in Kigali
    print("\n--- Farmer Creating Farm ---")
    farm_id = create_farm(farmer_token, f"Farm {suffix}", "Kigali")
    if not farm_id: return
    print(f"Farm Created ID: {farm_id} in Kigali")

    # 4. Agro (Kigali) Access Check
    print("\n--- Testing Agro (Kigali) Access [Should Succeed] ---")
    # List farms
    res = requests.get(f"{BASE_URL}/farms/", headers={"Authorization": f"Bearer {agro_kigali_token}"})
    farms = res.json()
    farm_found = any(f['id'] == farm_id for f in farms)
    print(f"Farm visible in list: {farm_found}")
    
    # Analysis access
    res = requests.get(f"{BASE_URL}/stress-monitoring/health/{farm_id}", headers={"Authorization": f"Bearer {agro_kigali_token}"})
    print(f"Analysis Access Code: {res.status_code} (Expected 200)")

    # 5. Agro (Musanze) Access Check
    print("\n--- Testing Agro (Musanze) Access [Should Fail] ---")
    # List farms
    res = requests.get(f"{BASE_URL}/farms/", headers={"Authorization": f"Bearer {agro_musanze_token}"})
    farms = res.json()
    farm_found = any(f['id'] == farm_id for f in farms)
    print(f"Farm visible in list: {farm_found} (Expected False)")
    
    # Analysis access
    res = requests.get(f"{BASE_URL}/stress-monitoring/health/{farm_id}", headers={"Authorization": f"Bearer {agro_musanze_token}"})
    print(f"Analysis Access Code: {res.status_code} (Expected 403)")

if __name__ == "__main__":
    main()

import json
import os

def process_locations():
    with open('temp_locations.json', 'r') as f:
        data = json.load(f)

    # Structure:
    # {
    #   "Province Name": {
    #       "District Name": {
    #           "Sector Name": True
    #       }
    #   }
    # }
    tree = {}

    for entry in data:
        prov = entry['province_name'].title()
        dist = entry['district_name'].title()
        sect = entry['sector_name'].title()

        if prov not in tree:
            tree[prov] = {}
        if dist not in tree[prov]:
            tree[prov][dist] = {}
        
        # Use dict keys to deduplicate sectors
        tree[prov][dist][sect] = True

    # Convert to frontend friendly format
    output = {
        "provinces": []
    }

    # Sort provinces
    for prov_name in sorted(tree.keys()):
        prov_obj = {
            "name": prov_name,
            "districts": []
        }
        
        # Sort districts
        for dist_name in sorted(tree[prov_name].keys()):
            dist_obj = {
                "name": dist_name,
                "sectors": sorted(list(tree[prov_name][dist_name].keys()))
            }
            prov_obj["districts"].append(dist_obj)
        
        output["provinces"].append(prov_obj)

    os.makedirs('frontend/src/data', exist_ok=True)
    with open('frontend/src/data/locations.json', 'w') as f:
        json.dump(output, f, indent=2)
    
    print("Successfully processed locations into frontend/src/data/locations.json")

if __name__ == "__main__":
    process_locations()

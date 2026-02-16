# Farm Registration with Rwanda Boundary Validation Guide

## 🎯 Overview

Your crop risk platform now has **complete farm registration** with **Rwanda boundary validation** and **automatic boundary detection from satellite imagery**.

## ✅ What's Been Implemented

### Backend Features
1. **CRUD Endpoints** (`/api/v1/farms/`)
   - `POST /farms/` - Create new farm with Rwanda validation
   - `PUT /farms/{id}` - Update farm
   - `DELETE /farms/{id}` - Delete farm
   - `POST /farms/{id}/auto-detect-boundary` - Auto-detect farm boundary from satellite
   - `POST /farms/{id}/save-boundary` - Save boundary polygon

2. **Rwanda Boundary Validation** (`backend/app/utils/rwanda_boundary.py`)
   - Validates coordinates are within Rwanda (-2.85°S to -1.05°S, 28.85°E to 30.90°E)
   - Auto-detects province from coordinates
   - Validates polygon boundaries are entirely within Rwanda
   - Calculates accurate area in hectares from boundary

3. **Security & Ownership**
   - User authentication required
   - Farms automatically linked to owner (`owner_id`)
   - Farmers can only see/edit their own farms
   - Agronomists see farms in their district
   - Admins see all farms

### Frontend Features
1. **Registration Form** (`frontend/src/pages/Farms.jsx`)
   - Farm name (required)
   - Province → District → Sector (cascading dropdowns with real Rwanda data)
   - Crop types (comma-separated for multiple: "potato, maize, beans")
   - Area (hectares) - auto-calculated if boundary provided
   - Coordinates (lat/lon)

2. **GPS Location Button**
   - "📍 Use My Location" - automatically gets device GPS coordinates
   - Works on mobile and desktop with location permission

3. **Auto-Detect Boundary**
   - "🛰️ Auto-Detect Boundary" button (appears after farm is saved)
   - Uses Google Dynamic World land cover data
   - Automatically excludes forests, buildings, water
   - Shows confidence score and land cover breakdown
   - Auto-saves detected boundary to farm

4. **Edit/Delete Buttons**
   - Edit: Opens form with farm data pre-filled
   - Delete: Removes farm and all related data (with confirmation)

## 🚀 Usage Guide

### 1. Register a New Farm (Manual Coordinates)

```
1. Click "Register New Farm"
2. Enter farm details:
   - Name: "Musanze Highland Farm"
   - Province: "Northern"
   - District: "Musanze"
   - Sector: "Muhoza"
   - Crop Types: "potato, maize"
   - Coordinates: -1.4987, 29.6342 (or use GPS button)
3. Click "Register Farm"
```

**Result**: Farm created with Rwanda validation. If coordinates are outside Rwanda, you'll get an error.

### 2. Register a Farm Using GPS

```
1. Click "Register New Farm"
2. Fill in name and location
3. Click "📍 Use My Location"
   - Browser will ask for permission
   - Coordinates auto-filled
4. Click "Register Farm"
```

**Result**: Farm registered with your current GPS location (must be in Rwanda).

### 3. Auto-Detect Farm Boundary

```
1. Register farm with center coordinates
2. Click "Edit" on the farm card
3. Click "🛰️ Auto-Detect Boundary"
   - System queries satellite imagery
   - Detects cropland area around coordinates
   - Excludes forests, buildings, water
4. Boundary automatically saved
```

**Result**:
- Accurate farm boundary polygon stored
- Area auto-calculated
- Future satellite data will be extracted only from this boundary (no neighbor mixing!)

**Example Output**:
```
✅ Farm Boundary Detected & Saved!
• Area: 2.3 hectares
• Confidence: 85%
• Crop area: 78% | Forest: 15%
ℹ️ Boundary excludes forests and buildings
```

### 4. Edit Existing Farm

```
1. Click "Edit" button on farm card
2. Modify any field (name, location, crops, coordinates, etc.)
3. Click "Update Farm"
```

**Result**: Farm updated with Rwanda validation.

### 5. Delete Farm

```
1. Click "Delete" (trash icon) on farm card
2. Confirm deletion
```

**Result**: Farm and all related data removed.

## 📊 Farm Display

Each farm card shows:
- **Name** with status badge (healthy/moderate/high risk)
- **Location**: District - Sector
- **Crop Type**: All crops (comma-separated)
- **Size**: Area in hectares
- **Coordinates**: If provided
- **Vegetation Indices**: NDVI, NDRE, NDWI, EVI, SAVI (if satellite data available)
- **Satellite Fetch**: Button to download satellite data for farm
- **Edit/Delete**: Buttons for farm management

## 🔒 Security & Data Isolation

### User Roles
1. **Farmer**
   - Can only see/edit/delete their own farms
   - Cannot see other farmers' farms

2. **Agronomist**
   - Sees farms in their assigned district
   - Can edit any farm in their district

3. **Admin**
   - Sees all farms in Rwanda
   - Can edit/delete any farm

### Data Filtering
```javascript
// Automatic based on role
GET /api/v1/farms/
  → Farmer: Returns only farms where owner_id = current_user.id
  → Agronomist: Returns farms where location matches their district
  → Admin: Returns all farms
```

## 🗺️ Rwanda Boundary Validation

### Coordinate Validation
```python
# Rwanda bounding box (validated on backend)
Latitude:  -2.85°S to -1.05°S
Longitude:  28.85°E to 30.90°E

# Examples
(-1.95, 30.06)  ✅ Kigali - Valid
(-2.45, 29.75)  ✅ Huye (Southern) - Valid
(0.00, 30.00)   ❌ Outside Rwanda - Rejected
(-3.00, 29.00)  ❌ Outside Rwanda - Rejected
```

### Province Auto-Detection
System automatically detects province from coordinates:
```
(-1.50, 29.80) → Northern Province
(-2.45, 29.75) → Southern Province
(-2.00, 30.40) → Eastern Province
(-2.05, 29.25) → Western Province
(-1.95, 30.06) → Kigali
```

### Boundary Polygon Validation
When you provide a boundary polygon:
- System checks ALL vertices are within Rwanda
- Rejects if any point falls outside Rwanda boundaries
- Auto-calculates area from polygon

## 🛰️ Satellite Data Integration

### How It Works
1. **Without Boundary**:
   - System uses 50m buffer around center point
   - May include data from neighboring fields

2. **With Boundary** (Recommended):
   - System extracts satellite data ONLY from your farm polygon
   - Accurate, no mixing with neighbors
   - Better NDVI/stress detection

### Auto-Detect Boundary (WorldCover/Dynamic World)
```
Uses: Google Dynamic World 10m resolution land cover
- Identifies cropland pixels around center point
- Excludes forests (NDVI=0.8-0.95 but not crops)
- Excludes buildings, roads, water
- Returns polygon boundary of detected cropland
- Confidence score based on land cover consistency
```

## 📝 Multiple Crop Types

Supports comma-separated crop types:
```
Examples:
- "potato"
- "potato, maize"
- "potato, maize, beans"
- "rice"
```

Each crop type is used for:
- Disease model selection (disease classifier)
- Growth stage calculation
- Risk assessment

## 🔍 Example Workflow: Complete Farm Registration

```
Step 1: Register Farm
  → Name: "Highland Potato Farm"
  → Province: Northern → District: Musanze → Sector: Muhoza
  → Crop: "potato"
  → Click "📍 Use My Location" (or enter manually)
  → Save

Step 2: Detect Boundary
  → Click "Edit" on farm card
  → Click "🛰️ Auto-Detect Boundary"
  → Wait ~5 seconds
  → Boundary detected: 2.3 ha, 85% confidence
  → Area auto-updated in form
  → Save

Step 3: Fetch Satellite Data
  → Click "Fetch Satellite Data" on farm card
  → Progress bar shows: Connecting → Fetching → Calculating → Complete
  → NDVI/NDRE/NDWI displayed on card

Step 4: Monitor Farm
  → Early Warning system now tracks YOUR specific farm
  → Alerts based on YOUR boundary (not neighbors)
  → Disease classifier knows crop type (potato)
  → Stress monitoring uses accurate farm area
```

## 🚨 Error Handling

### Common Errors

1. **"Farm location must be within Rwanda"**
   - Coordinates are outside Rwanda boundaries
   - Check latitude/longitude values
   - Use GPS if in Rwanda, or verify manual entry

2. **"Failed to detect boundary. The farm may be in a forest or non-crop area"**
   - Center point is in forest/urban/water area
   - Move center point to actual crop area
   - Or manually draw boundary (future feature)

3. **"Please save the farm first, then use Auto-Detect Boundary"**
   - Boundary detection requires existing farm ID
   - Save farm first, then edit to detect boundary

4. **"Not your farm" (HTTP 403)**
   - Trying to edit/delete farm owned by another user
   - Farmers can only modify their own farms

## 🔄 API Endpoints Summary

```
GET    /api/v1/farms/                          # List farms (filtered by role)
POST   /api/v1/farms/                          # Create farm (requires auth)
GET    /api/v1/farms/{id}                      # Get farm details
PUT    /api/v1/farms/{id}                      # Update farm (owner only)
DELETE /api/v1/farms/{id}                      # Delete farm (owner only)
POST   /api/v1/farms/{id}/auto-detect-boundary # Auto-detect boundary
POST   /api/v1/farms/{id}/save-boundary        # Save boundary polygon
```

## 📦 Optional: Add Interactive Map (Leaflet)

To add interactive map with boundary drawing, add to `frontend/public/index.html`:

```html
<!-- Leaflet CSS -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css" />

<!-- Leaflet JS -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js"></script>
```

Then use the `FarmBoundaryMap` component in `frontend/src/components/FarmBoundaryMap.jsx`.

## 🎉 Summary

You now have a complete farm registration system with:
- ✅ Rwanda boundary validation (prevents invalid locations)
- ✅ GPS location detection (mobile-friendly)
- ✅ Auto-boundary detection from satellite (excludes forests)
- ✅ Multiple crop types support
- ✅ User ownership & security
- ✅ Edit/delete functionality
- ✅ Accurate satellite data extraction per farm
- ✅ Province/district/sector selection with real Rwanda data

**Result**: Every farm is accurately located within Rwanda, linked to its owner, and monitored with precise satellite data from its exact boundary! 🇷🇼🚀

# How to Add Interactive Map to View Farm Boundaries

## 🗺️ Quick Setup (5 minutes)

### Step 1: Add Leaflet to HTML

Edit `frontend/public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Crop Risk Monitoring</title>

    <!-- ADD THESE LINES: Leaflet CSS -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
      crossorigin=""/>
    <link rel="stylesheet" href="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css"/>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>

    <!-- ADD THESE LINES: Leaflet JavaScript -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
      integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
      crossorigin=""></script>
    <script src="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js"></script>
  </body>
</html>
```

### Step 2: Use SimpleFarmMap Component

In `frontend/src/pages/Farms.jsx`, add at the top:

```javascript
import SimpleFarmMap from '../components/SimpleFarmMap'
```

Then add the map display after the boundary detection result (around line 450):

```javascript
{/* Boundary Detection Results */}
{boundaryResult && (
  <>
    <div style={{ marginTop: 12, padding: 12, background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#166534', marginBottom: 4 }}>
        ✅ Farm Boundary Detected & Saved!
      </div>
      <div style={{ fontSize: 12, color: '#15803d' }}>
        • Area: {boundaryResult.area_ha} hectares
      </div>
      <div style={{ fontSize: 12, color: '#15803d' }}>
        • Confidence: {(boundaryResult.confidence * 100).toFixed(0)}%
      </div>
      <div style={{ fontSize: 12, color: '#15803d' }}>
        • Crop area: {(boundaryResult.land_cover.crops * 100).toFixed(0)}% | Forest: {(boundaryResult.land_cover.trees * 100).toFixed(0)}%
      </div>
      <div style={{ fontSize: 11, color: '#166534', marginTop: 4 }}>
        ℹ️ Boundary excludes forests and buildings. Satellite data will now use the exact farm area.
      </div>
    </div>

    {/* ADD THIS: Map Visualization */}
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📍 Farm Boundary Map</div>
      <SimpleFarmMap
        latitude={parseFloat(formData.latitude)}
        longitude={parseFloat(formData.longitude)}
        boundary={boundaryResult.boundary}
      />
    </div>
  </>
)}
```

### Step 3: Restart Frontend

```bash
# Stop frontend (Ctrl+C)
# Start again
cd frontend
npm run dev
```

---

## 🎨 What You'll See

After following these steps, when you click "Auto-Detect Boundary":

1. **Success message** with area and confidence (already working ✅)
2. **Interactive map** showing:
   - 📍 Red marker = Farm center point
   - 🟩 Green polygon = Detected farm boundary
   - 🗺️ OpenStreetMap background

### Map Features:
- **Zoom in/out** with +/- buttons or mouse wheel
- **Pan** by clicking and dragging
- **Click marker/polygon** to see popup info
- **Auto-fits** to show entire farm boundary

---

## 🔍 Alternative: Quick Iframe Map (No Setup Needed)

If you don't want to install Leaflet, add this simple iframe instead:

```javascript
{boundaryResult && (
  <div style={{ marginTop: 12 }}>
    <iframe
      src={`https://www.openstreetmap.org/export/embed.html?bbox=${
        formData.longitude - 0.005
      },${formData.latitude - 0.005},${
        formData.longitude + 0.005
      },${formData.latitude + 0.005}&layer=mapnik&marker=${formData.latitude},${formData.longitude}`}
      style={{ width: '100%', height: 300, border: 'none', borderRadius: 8 }}
    />
  </div>
)}
```

This shows a simple map with a marker, but won't display the boundary polygon.

---

## 📦 Full Integration Example

Here's the complete section in Farms.jsx:

```javascript
{/* GPS & Boundary Detection Buttons */}
<div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
  <button
    className="btn btn-secondary"
    type="button"
    onClick={handleGetLocation}
    disabled={geoLoading}
    style={{ fontSize: 13, padding: '6px 14px' }}
  >
    <Navigation size={14} />
    {geoLoading ? 'Getting location...' : '📍 Use My Location'}
  </button>
  {editingId && formData.latitude && formData.longitude && (
    <button
      className="btn btn-secondary"
      type="button"
      onClick={handleAutoDetectBoundary}
      disabled={boundaryLoading}
      style={{ fontSize: 13, padding: '6px 14px', background: 'var(--primary)', color: 'white' }}
      title="Automatically detect farm boundary from satellite imagery"
    >
      <Scan size={14} />
      {boundaryLoading ? 'Detecting...' : '🛰️ Auto-Detect Boundary'}
    </button>
  )}
</div>

{/* Boundary Results + Map */}
{boundaryResult && (
  <>
    {/* Success Message */}
    <div style={{ marginTop: 12, padding: 12, background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#166534', marginBottom: 4 }}>
        ✅ Farm Boundary Detected & Saved!
      </div>
      <div style={{ fontSize: 12, color: '#15803d' }}>
        • Area: {boundaryResult.area_ha} hectares
      </div>
      <div style={{ fontSize: 12, color: '#15803d' }}>
        • Confidence: {(boundaryResult.confidence * 100).toFixed(0)}%
      </div>
    </div>

    {/* Interactive Map */}
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📍 Farm Boundary on Map</div>
      <SimpleFarmMap
        latitude={parseFloat(formData.latitude)}
        longitude={parseFloat(formData.longitude)}
        boundary={boundaryResult.boundary}
      />
    </div>
  </>
)}
```

---

## ✅ Result

After setup, you'll see:

```
[Edit Farm Form]
  ↓
[📍 Use My Location] [🛰️ Auto-Detect Boundary]
  ↓ (click Auto-Detect)
[✅ Farm Boundary Detected & Saved!]
  • Area: 12.42 hectares
  • Confidence: 50%

[📍 Farm Boundary on Map]
┌─────────────────────────────────┐
│  🗺️ Interactive OpenStreetMap   │
│                                  │
│        📍 (center point)         │
│     🟩🟩🟩🟩🟩                    │
│     🟩      🟩  ← boundary       │
│     🟩🟩🟩🟩🟩                    │
│                                  │
│  [+] [-] Zoom controls           │
└─────────────────────────────────┘
```

---

## 🚀 Done!

Now you can:
1. See where your farm is located on a real map
2. View the exact detected boundary as a green polygon
3. Zoom in/out to verify the boundary accuracy
4. Check if forests/buildings were correctly excluded

The map makes it easy to verify that the auto-detected boundary matches your actual farm! 🎯

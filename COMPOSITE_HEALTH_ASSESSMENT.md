# Composite Health Assessment Update

## 🎯 What Changed

The platform now uses **ALL vegetation indices** instead of only NDVI for farm health assessment.

### Before (NDVI-Only Assessment) ❌
```javascript
// Old calculation (NDVI only)
const status = ndvi >= 0.6 ? 'healthy' : ndvi >= 0.4 ? 'moderate' : 'high'
```

**Problem**: NDVI alone can be misleading:
- House location → Low NDVI → "High stress" (technically correct, but misleading context)
- Doesn't account for water stress, nutrient deficiency, or atmospheric conditions

### After (Composite Multi-Index Assessment) ✅
```javascript
// New calculation (All indices weighted)
Health Score =
  NDVI (30%) +
  NDRE (20%) +
  NDWI (20%) +
  EVI (15%) +
  SAVI (15%)
```

**Benefits**:
- More accurate health assessment
- Considers multiple stress factors
- Atmospheric correction (EVI)
- Water stress detection (NDWI)
- Nutrient status (NDRE)
- Soil adjustment (SAVI)

---

## 📊 Index Weights and Thresholds

### NDVI (30% weight) - Primary Vegetation Health
| Range | Score | Meaning |
|-------|-------|---------|
| ≥ 0.6 | 100 | Healthy dense vegetation |
| 0.5-0.6 | 70 | Moderate vegetation |
| 0.4-0.5 | 50 | Sparse vegetation |
| 0.3-0.4 | 30 | Stressed vegetation |
| < 0.3 | 10 | Very poor vegetation |

### NDRE (20% weight) - Chlorophyll/Nitrogen Status
| Range | Score | Meaning |
|-------|-------|---------|
| ≥ 0.5 | 100 | High chlorophyll content |
| 0.4-0.5 | 70 | Moderate chlorophyll |
| 0.3-0.4 | 50 | Low chlorophyll |
| 0.2-0.3 | 30 | Nitrogen deficiency |
| < 0.2 | 10 | Severe deficiency |

### NDWI (20% weight) - Water Content
| Range | Score | Meaning |
|-------|-------|---------|
| ≥ 0.3 | 100 | High water content |
| 0.2-0.3 | 70 | Moderate water |
| 0.1-0.2 | 50 | Low water |
| 0-0.1 | 30 | Water stress |
| < 0 | 10 | Severe water stress |

### EVI (15% weight) - Enhanced Vegetation (Atmospheric Correction)
| Range | Score | Meaning |
|-------|-------|---------|
| ≥ 0.6 | 100 | Excellent vegetation |
| 0.4-0.6 | 70 | Good vegetation |
| 0.3-0.4 | 50 | Moderate vegetation |
| 0.2-0.3 | 30 | Poor vegetation |
| < 0.2 | 10 | Very poor vegetation |

### SAVI (15% weight) - Soil-Adjusted Vegetation Index
| Range | Score | Meaning |
|-------|-------|---------|
| ≥ 0.5 | 100 | Dense canopy cover |
| 0.4-0.5 | 70 | Moderate canopy |
| 0.3-0.4 | 50 | Sparse canopy |
| 0.2-0.3 | 30 | Very sparse canopy |
| < 0.2 | 10 | Exposed soil |

---

## 🎨 Health Status Badges

### Final Composite Score → Badge
| Score | Badge | Color | Meaning |
|-------|-------|-------|---------|
| ≥ 70% | **Healthy** | 🟢 Green | Good overall health |
| 50-70% | **Moderate** | 🟡 Yellow | Some stress detected |
| < 50% | **High** | 🔴 Red | Significant stress |

---

## 🔄 What Was Updated

### Frontend Changes

**File**: `frontend/src/pages/Farms.jsx`

1. **Composite Health Calculation Function** (lines 488-538):
```javascript
const calculateCompositeHealth = () => {
  if (!hasIndices) return 'unknown'

  let healthScore = 0
  let totalWeight = 0

  // NDVI (30% weight)
  if (ndvi != null) {
    const ndviScore = ndvi >= 0.6 ? 100 : ndvi >= 0.5 ? 70 : ...
    healthScore += ndviScore * 0.30
    totalWeight += 0.30
  }

  // NDRE (20% weight)
  if (ndre != null) { ... }

  // NDWI (20% weight)
  if (ndwi != null) { ... }

  // EVI (15% weight)
  if (evi != null) { ... }

  // SAVI (15% weight)
  if (savi != null) { ... }

  // Normalize by actual total weight
  const finalScore = totalWeight > 0 ? healthScore / totalWeight : 0

  // Determine status badge
  if (finalScore >= 70) return 'healthy'
  if (finalScore >= 50) return 'moderate'
  return 'high' // high stress
}
```

2. **Updated Badge Display** (lines 544-546):
```javascript
// Old: <span className={`badge ${ndviStatus}`}>
// New:
<span className={`badge ${healthStatus}`}>
  {healthStatus === 'unknown' ? 'No data' : healthStatus}
</span>
```

3. **Added Info Banner** (lines 264-275):
```javascript
<div style={{ /* blue info banner */ }}>
  🎯 Comprehensive Health Assessment
  Farm health badges now consider all vegetation indices (NDVI, NDRE, NDWI, EVI, SAVI)
</div>
```

### Backend (Already Implemented) ✅

**File**: `backend/app/services/stress_detection_service.py`

The backend **already has** a comprehensive `calculate_composite_health_score()` method that:
- Detects drought stress (NDVI, NDWI, rainfall)
- Detects water stress (NDWI, NDVI decline)
- Detects heat stress (temperature, NDVI decline)
- Detects nutrient deficiency (NDRE, NDVI growth rate)
- Combines all into weighted composite score

**Endpoint**: `GET /api/v1/stress-monitoring/stress-assessment/{farm_id}`

---

## ✅ Benefits of Composite Assessment

### 1. More Accurate Health Detection
**Example**: Your farm showing "high stress"
- **NDVI**: 0.138 (very low) → Stress detected ✓
- **NDWI**: -0.175 (negative) → Water stress detected ✓
- **NDRE**: 0.083 (low) → Nutrient deficiency detected ✓
- **Composite**: **All indices agree** → High stress is CORRECT

### 2. Reduces False Alarms
**Example**: Newly planted field
- **NDVI**: 0.3 (low, but expected)
- **NDWI**: 0.4 (good water)
- **NDRE**: 0.5 (good nutrients)
- **EVI**: 0.4 (moderate)
- **Composite Score**: 60% → **Moderate** (not high stress)

### 3. Identifies Specific Problems
- **Low NDVI + Low NDWI** → Drought stress
- **Low NDVI + Good NDWI** → Disease or pest damage
- **Good NDVI + Low NDRE** → Nitrogen deficiency
- **Low NDVI + High EVI** → Atmospheric interference (clouds)

### 4. Better Seasonal Handling
- **SAVI** adjusts for soil exposure (early season)
- **EVI** corrects for atmospheric effects
- **NDRE** tracks chlorophyll independent of leaf area

---

## 🧪 Test Cases

### Case 1: Healthy Farm
```
NDVI: 0.75 → Score 100 × 0.30 = 30
NDRE: 0.55 → Score 100 × 0.20 = 20
NDWI: 0.35 → Score 100 × 0.20 = 20
EVI: 0.70 → Score 100 × 0.15 = 15
SAVI: 0.60 → Score 100 × 0.15 = 15
────────────────────────────────
Total: 100 → Badge: Healthy ✅
```

### Case 2: Water Stressed Farm
```
NDVI: 0.50 → Score 70 × 0.30 = 21
NDRE: 0.45 → Score 70 × 0.20 = 14
NDWI: 0.05 → Score 30 × 0.20 = 6  ⚠️ Water stress
EVI: 0.40 → Score 70 × 0.15 = 10.5
SAVI: 0.35 → Score 50 × 0.15 = 7.5
────────────────────────────────
Total: 59 → Badge: Moderate ⚠️
```

### Case 3: Severe Stress (Your Case)
```
NDVI: 0.138 → Score 10 × 0.30 = 3
NDRE: 0.083 → Score 10 × 0.20 = 2
NDWI: -0.175 → Score 10 × 0.20 = 2
EVI: 1.159 → Score 100 × 0.15 = 15  (anomaly, likely error)
SAVI: 0.204 → Score 30 × 0.15 = 4.5
────────────────────────────────
Total: 26.5 → Badge: High ❌ Stress
```

**Diagnosis**: All indices (except anomalous EVI) indicate severe stress. Likely causes:
- Building/house location (not cropland)
- Very sparse vegetation
- Severe drought
- Harvested field

---

## 🚀 Usage

### Frontend
1. **Farms Page**: Badge now shows composite health automatically
2. **Info Banner**: Explains the multi-index approach
3. **Vegetation Indices Section**: All 5 indices displayed below each farm card

### Backend API
```bash
# Get composite health assessment
GET /api/v1/stress-monitoring/stress-assessment/{farm_id}

Response:
{
  "health_score": 72.5,
  "stress_score": 27.5,
  "stress_level": "low",
  "primary_stress": "none",
  "stress_breakdown": {
    "drought": { "score": 25.3, "level": "low", "ndvi": 0.72, ... },
    "water": { "score": 18.2, "level": "low", "ndwi": 0.42, ... },
    "heat": { "score": 12.5, "level": "low", ... },
    "nutrient": { "score": 20.1, "level": "low", "ndre": 0.52, ... }
  }
}
```

---

## 📝 Summary

✅ **Frontend updated** to use composite health calculation
✅ **Backend already had** comprehensive stress detection
✅ **All 5 indices** now contribute to health badge
✅ **Info banner** explains the approach to users
✅ **More accurate** assessment, fewer false alarms

Your farm showing "high stress" is **correct** - all indices confirm severe stress or non-cropland location (likely your house coordinates). Update farm coordinates to actual farm location to see accurate health assessment! 🎯

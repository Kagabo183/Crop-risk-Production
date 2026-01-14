# Frontend Disease Prediction Integration

## 🎯 Overview

The frontend now includes complete disease prediction and forecasting capabilities, integrated with the backend API.

---

## ✅ What Was Added

### 1. **API Client** (`src/api.js`)
- `fetchDiseases()` - Get disease catalog
- `predictDisease()` - Generate disease prediction
- `fetchDailyForecast()` - Get 1-14 day daily forecasts
- `fetchWeeklyForecast()` - Get weekly summary
- `fetchDiseaseStatistics()` - Get historical trends
- `fetchDiseasePredictions()` - Get all predictions
- `submitDiseaseObservation()` - Submit field observations

### 2. **Components**

#### `RiskIndicator.js`
- Visual risk score display with color coding
- 🟢 Low (0-39) | 🟡 Moderate (40-59) | 🟠 High (60-74) | 🔴 Severe (75-100)
- Three sizes: small, medium, large
- Animated hover effects

#### `DiseaseCard.js`
- Disease information display
- Risk indicator integration
- Treatment urgency badges (⚡ Immediate, ⏰ Soon, 📅 Scheduled)
- Recommended actions list
- Action buttons for predictions and forecasts

#### `DiseaseList.js`
- Grid layout for disease cards
- Search functionality
- Filter by risk level (All, Severe, High, Moderate, Low)
- Sort by risk, name, or type
- Real-time prediction updates

### 3. **Pages**

#### `Diseases.js` (`/diseases`)
**Features:**
- Farm selector dropdown
- Disease catalog display
- Prediction generation (single or batch)
- Statistics summary (total diseases, predictions, high-risk count)
- Navigate to forecasts

**User Flow:**
1. Select farm
2. View all tracked diseases with current predictions
3. Generate new predictions as needed
4. Click "View Forecast" to see detailed daily/weekly forecasts

#### `DiseaseForecasts.js` (`/disease-forecasts`)
**Features:**
- Weekly summary card with strategic recommendations
- Daily forecast grid (1-14 days)
- Critical day indicators (⚡)
- Infection probability and confidence scores
- Recommended actions per day
- Peak risk day highlighting

**User Flow:**
1. Select farm and disease
2. Choose forecast window (3, 7, or 14 days)
3. View weekly strategy
4. Review daily forecasts
5. Take action based on recommendations

### 4. **Enhanced Dashboard** (`pages/Dashboard.js`)

**New Widgets:**
- 🦠 Diseases Tracked
- ⚠️ High Risk Diseases (highlighted in red)

**New Sections:**
- **Top Disease Risks** - Top 3 highest risk predictions with:
  - Ranking badges (#1, #2, #3)
  - Risk indicators
  - Infection probability
  - Quick action recommendation
  - Link to detailed forecast

- **Quick Actions** - One-click navigation to:
  - 🦠 Disease Predictions
  - 📈 View Forecasts
  - 🌾 Manage Farms
  - 🔔 View Alerts

### 5. **Navigation Updates**

**Sidebar** (`components/Sidebar.js`):
- Added: 🦠 Disease Predictions (`/diseases`)
- Added: 📊 Disease Forecasts (`/disease-forecasts`)

**Router** (`components/MainContent.js`):
- Configured routes for both new pages

---

## 🚀 How to Use

### 1. Start the Frontend

```bash
cd frontend
npm install
npm start
```

Frontend runs on: http://localhost:3000

### 2. Ensure Backend is Running

```bash
# From project root
uvicorn app:app --reload --app-dir backend
```

Backend runs on: http://localhost:8000

### 3. Navigate the Interface

**Dashboard:**
- View summary statistics
- Check top disease risks
- Use quick actions for navigation

**Disease Predictions Page:**
1. Select a farm from dropdown
2. Click "🔄 Generate All Predictions" to create predictions for all diseases
3. Or click "Generate Prediction" on individual disease cards
4. View risk scores, infection probabilities, and recommended actions
5. Click "View Forecast" to see detailed daily/weekly predictions

**Disease Forecasts Page:**
1. Select farm and disease
2. Choose forecast window (3/7/14 days)
3. Review weekly summary with strategic recommendations
4. Examine daily forecasts with critical day indicators
5. Take action based on recommendations

---

## 🎨 UI Features

### Color-Coded Risk Levels
- **🟢 Low (0-39)**: Green - Routine monitoring
- **🟡 Moderate (40-59)**: Yellow - Prepare for action
- **🟠 High (60-74)**: Orange - Act within 24-48h
- **🔴 Severe (75-100)**: Red - Immediate action

### Treatment Urgency Indicators
- **⚡ Immediate**: Critical action required now
- **⏰ Soon**: Action needed within 24-48 hours
- **📅 Scheduled**: Plan treatment within 3-7 days
- **👁️ Monitor**: Continue routine monitoring

### Interactive Elements
- Hover animations on cards
- Filter and search with real-time updates
- Sortable disease lists
- Responsive design for mobile/tablet

---

## 📊 Data Flow

```
User Action → Frontend Component → API Call → Backend Service → Database
                                                      ↓
User Interface ← React State Update ← API Response ← JSON Data
```

### Example: Generate Prediction
1. User clicks "Generate Prediction" on Disease Card
2. `Diseases.js` calls `predictDisease(farmId, diseaseName, cropType, 7)`
3. API sends POST to `/api/v1/diseases/predict`
4. Backend DiseaseModelEngine calculates risk
5. Backend stores prediction in database
6. Frontend receives prediction data
7. `DiseaseList` component updates with new risk score
8. User sees updated risk indicator and recommendations

---

## 🔧 Customization

### Modify Risk Thresholds
Edit in `RiskIndicator.js`:
```javascript
const getRiskColor = (level) => {
  const colors = {
    'low': '#10b981',      // Green
    'moderate': '#f59e0b',  // Yellow
    'high': '#f97316',      // Orange
    'severe': '#ef4444'     // Red
  };
  return colors[level?.toLowerCase()] || '#6b7280';
};
```

### Add New Disease Models
1. Backend: Add model to `app/services/disease_intelligence.py`
2. Backend: Update disease catalog in database
3. Frontend: No changes needed (automatically displayed)

### Customize Forecast Window
Edit in `DiseaseForecasts.js`:
```javascript
<select value={forecastDays} onChange={(e) => setForecastDays(parseInt(e.target.value))}>
  <option value="3">3 Days</option>
  <option value="7">7 Days</option>
  <option value="14">14 Days</option>
  <option value="21">21 Days</option>  // Add custom window
</select>
```

---

## 📱 Responsive Design

All components are mobile-responsive:
- **Desktop**: Multi-column grids, sidebar navigation
- **Tablet**: 2-column grids, collapsible sidebar
- **Mobile**: Single-column, stacked layout, full-width controls

Media breakpoint: `768px`

---

## 🔍 Troubleshooting

### No Diseases Showing
**Problem**: Disease list is empty  
**Solution**: 
```bash
python -m scripts.generate_disease_predictions init
```

### Predictions Not Loading
**Problem**: API returns empty array  
**Solution**: Generate predictions for selected farm:
```bash
python -m scripts.generate_disease_predictions farm --farm-id 1
```

### CORS Errors
**Problem**: API requests blocked by CORS  
**Solution**: Ensure backend CORS is configured in `main.py`:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 404 on Disease Routes
**Problem**: Routes not found  
**Solution**: Verify router is included in `app/api/v1/api.py`:
```python
api_router.include_router(diseases.router, prefix="/diseases", tags=["diseases"])
```

---

## 🎯 Next Steps

### Immediate
1. ✅ Test all API endpoints
2. ✅ Verify navigation works
3. ✅ Check dashboard displays data

### Short-term
1. Add loading spinners for API calls
2. Implement error boundaries
3. Add toast notifications for success/error
4. Add data export functionality (CSV/PDF)
5. Implement real-time updates with WebSockets

### Long-term
1. Add charting library (recharts/chart.js) for trend visualization
2. Implement map view for spatial disease distribution
3. Add comparison view (multiple farms/diseases)
4. Build mobile app with React Native
5. Add offline support with service workers
6. Implement push notifications for critical alerts

---

## 📚 Related Files

**Frontend:**
- `src/api.js` - API client
- `src/components/RiskIndicator.js` - Risk display
- `src/components/DiseaseCard.js` - Disease card
- `src/components/DiseaseList.js` - Disease grid
- `src/pages/Diseases.js` - Main disease page
- `src/pages/DiseaseForecasts.js` - Forecast page
- `src/pages/Dashboard.js` - Enhanced dashboard
- `src/components/Sidebar.js` - Navigation menu
- `src/components/MainContent.js` - Router

**Backend:**
- `app/api/v1/diseases.py` - API endpoints
- `app/services/disease_intelligence.py` - Disease models
- `app/services/weather_service.py` - Weather integration

**Documentation:**
- `GET_STARTED.md` - Setup guide
- `QUICK_REFERENCE.md` - Command reference
- `DISEASE_PREDICTION_GUIDE.md` - Complete guide

---

## ✅ Frontend Integration Complete!

Your crop risk frontend now has:
- ✅ 7 Disease prediction API functions
- ✅ 3 Reusable components (RiskIndicator, DiseaseCard, DiseaseList)
- ✅ 2 Full pages (Diseases, DiseaseForecasts)
- ✅ Enhanced dashboard with disease summary
- ✅ Updated navigation with disease links
- ✅ Responsive mobile-friendly design
- ✅ Color-coded risk levels
- ✅ Real-time data updates
- ✅ Search, filter, and sort capabilities

**Start using it now:**
```bash
cd frontend
npm start
# Visit http://localhost:3000
# Login and navigate to Disease Predictions!
```

---

**Version**: 2.0  
**Status**: ✅ Production Ready  
**Date**: January 3, 2026

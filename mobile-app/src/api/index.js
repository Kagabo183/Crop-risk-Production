import axios from 'axios'
import { Capacitor } from '@capacitor/core'

/**
 * Auto-detect the correct backend server based on connection type.
 */
function getInitialApiBaseUrl() {
  if (!Capacitor.isNativePlatform()) {
    return '/api/v1' // Web falls back to relative paths for proxy
  }

  // Define possible backend URLs in order of preference
  return [
    'http://localhost:8000/api/v1',         // 1. USB Debugging (ADB reverse)
    'http://10.0.2.2:8000/api/v1',          // 2. Android Emulator
    'http://192.168.1.101:8000/api/v1',     // 3. Same Wi-Fi Network
    'http://41.216.119.113/api/v1'          // 4. Public Internet (No port 8000)
  ]
}

const backendUrls = getInitialApiBaseUrl()
const activeApiBase = Array.isArray(backendUrls) ? backendUrls[3] : backendUrls // Default to public IP

const api = axios.create({
  baseURL: activeApiBase,
  timeout: 10000, 
})

// Auto-detect the fastest available backend on app startup if native
if (Capacitor.isNativePlatform()) {
  const detectBackend = async () => {
    for (const url of backendUrls) {
      try {
        const testBase = url.replace('/api/v1', '')
        // We do a fast ping to the health endpoint with a short timeout
        await axios.get(`${testBase}/api/v1/health`, { timeout: 2000 })
        console.log(`[API] Backend connected successfully at: ${url}`)
        api.defaults.baseURL = url
        break // Stop at the first successful connection
      } catch (err) {
        console.log(`[API] Failed to reach: ${url}`)
      }
    }
  }
  
  detectBackend()
}

// ── JWT Token Interceptor ──
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ──
export const loginUser = (username, pin) => {
  const form = new URLSearchParams()
  form.append('username', username)
  form.append('password', pin)
  return api.post('/auth/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}
export const registerUser = (data) => api.post('/auth/register', data)
export const getProfile = () => api.get('/auth/me')
export const updateProfile = (data) => api.put('/auth/me', data)

// ── Farms ──
export const getFarms = () => api.get('/farms/')
export const createFarm = (data) => api.post('/farms/', data)
export const updateFarm = (id, data) => api.put(`/farms/${id}`, data)
export const deleteFarm = (id) => api.delete(`/farms/${id}`)
export const detectLocation = (latitude, longitude) =>
  api.get('/farms/detect-location', { params: { latitude, longitude } })
export const saveFarmBoundary = (farmId, boundaryGeoJson) =>
  api.post(`/farms/${farmId}/save-boundary`, { boundary_geojson: boundaryGeoJson })
export const autoDetectBoundary = (farmId, bufferMeters = 200) =>
  api.post(`/farms/${farmId}/auto-detect-boundary`, null, { params: { buffer_meters: bufferMeters } })

// ── Farm Satellite ──
export const getFarmSatellite = () => api.get('/farm-satellite/')
export const getNdviHistory = (farmId, limit = 30, startDate, endDate) =>
  api.get(`/farm-satellite/history/${farmId}`, {
    params: { limit, start_date: startDate || undefined, end_date: endDate || undefined },
  })

// ── Cadastral Parcels ──
export const searchParcels = (upi, limit = 20) =>
  api.get('/parcels/search', { params: { upi, limit } })
export const findParcelByLocation = (lat, lon, radiusM = 50) =>
  api.get('/parcels/find-by-location', { params: { lat, lon, radius_m: radiusM } })
export const getParcelStats = () => api.get('/parcels/stats')

// ── Stress Monitoring ──
export const getVegetationHealth = (farmId, daysBack = 90) =>
  api.get(`/stress-monitoring/health/${farmId}`, { params: { days_back: daysBack } })
export const getStressAssessment = (farmId) =>
  api.get(`/stress-monitoring/stress-assessment/${farmId}`)
export const getVegetationIndices = (farmId) =>
  api.get(`/stress-monitoring/indices/${farmId}`)
export const getStressZones = (farmId) =>
  api.get(`/stress-monitoring/stress-zones/${farmId}`)
export const getDroughtAssessment = (farmId, daysBack = 30) =>
  api.get(`/stress-monitoring/drought-assessment/${farmId}`, { params: { days_back: daysBack } })
export const getWaterStress = (farmId, daysBack = 14) =>
  api.get(`/stress-monitoring/water-stress/${farmId}`, { params: { days_back: daysBack } })
export const getHeatStress = (farmId, daysBack = 14) =>
  api.get(`/stress-monitoring/heat-stress/${farmId}`, { params: { days_back: daysBack } })
export const getNutrientAssessment = (farmId, daysBack = 30) =>
  api.get(`/stress-monitoring/nutrient-assessment/${farmId}`, { params: { days_back: daysBack } })
export const triggerSatelliteDownload = (farmId, daysBack = 30) =>
  api.post('/stress-monitoring/trigger-download', { farm_id: farmId, days_back: daysBack })
export const getTaskStatus = (taskId) =>
  api.get(`/stress-monitoring/task-status/${taskId}`)

// ── ML ──
export const classifyDisease = (file, cropType, farmId = null) => {
  const form = new FormData()
  form.append('file', file)
  const params = {}
  if (cropType) params.crop_type = cropType
  if (farmId) params.farm_id = farmId
  return api.post('/ml/classify-disease', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params,
  })
}
export const getClassificationHistory = (limit = 20, farmId = null) =>
  api.get('/ml/classification-history', { params: { limit, farm_id: farmId || undefined } })
export const getRiskAssessment = (farmId) => api.get(`/ml/risk-assessment/${farmId}`)
export const getSupportedDiseases = () => api.get('/ml/supported-diseases')
export const getCropModels = () => api.get('/ml/crop-models')
export const getModelStatus = () => api.get('/ml/models/status')
export const predictYield = (farmId) => api.get(`/ml/predict-yield/${farmId}`)
export const forecastHealth = (farmId, forecastDays = 14) =>
  api.post('/ml/forecast-health', { farm_id: farmId, forecast_days: forecastDays })
export const detectAnomalies = (farmId, daysBack = 30) =>
  api.post('/ml/detect-anomalies', { farm_id: farmId, days_back: daysBack })

// ── Diseases ──
export const getDiseases = (skip = 0, limit = 100) =>
  api.get('/diseases/', { params: { skip, limit } })
export const getDiseaseForecasts = (farmId, diseaseName, days = 7) =>
  api.get(`/diseases/forecast/daily/${farmId}`, { params: { disease_name: diseaseName, days } })

// ── Early Warning ──
export const getEarlyWarnings = () => api.get('/early-warning/')
export const fetchWeatherAll = () => api.post('/early-warning/fetch-weather')

// ── Advisory ──
export const getDailyAdvisory = (farmId, includeRisk = true) =>
  api.get(`/advisory/daily/${farmId}`, { params: { include_risk: includeRisk } })
export const getAdvisorySummary = () => api.get('/advisory/summary')

// ── Health ──
export const getHealth = () => api.get('/health')

export default api

import axios from 'axios'

// In development: Vite proxy forwards /api → localhost:8000 (see vite.config.js)
// In production (Vercel/Render static): VITE_API_URL must point to the deployed API
const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1'

const api = axios.create({
  baseURL: BASE,
  timeout: 60000,   // 60s default — covers cold-start on Render free tier
})

// Wake up the Render backend before a slow ML request
export const pingApi = () => api.get('/health', { timeout: 10000 }).catch(() => {})

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
export const getUsers = () => api.get('/auth/users')
export const changeUserRole = (userId, role) => api.put(`/auth/users/${userId}/role`, { role })
export const toggleUserActive = (userId) => api.put(`/auth/users/${userId}/toggle-active`)

// ── Farms ──
export const getFarms = () => api.get('/farms/')
export const createFarm = (data) => api.post('/farms/', data)
export const updateFarm = (id, data) => api.put(`/farms/${id}`, data)
export const deleteFarm = (id) => api.delete(`/farms/${id}`)
export const autoDetectBoundary = (farmId, bufferMeters = 200) =>
  api.post(`/farms/${farmId}/auto-detect-boundary`, null, { params: { buffer_meters: bufferMeters } })
export const saveFarmBoundary = (farmId, boundaryGeoJson) =>
  api.post(`/farms/${farmId}/save-boundary`, { boundary_geojson: boundaryGeoJson })
export const detectLocation = (latitude, longitude) =>
  api.get('/farms/detect-location', { params: { latitude, longitude } })

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
export const autoFetchSatellite = (farmId) =>
  api.post(`/farms/${farmId}/auto-fetch-satellite`)

// ── Farm Satellite ──
export const getFarmSatellite = () => api.get('/farm-satellite/')
export const seedSatelliteData = () => api.post('/seed-all')
export const fetchRealData = (daysBack = 90, weatherDays = 7) =>
  api.post('/fetch-real-data', null, { params: { days_back: daysBack, weather_days: weatherDays }, timeout: 120000 })
export const getFetchStatus = () => api.get('/fetch-real-data/status')
export const getNdviHistory = (farmId, limit = 30, startDate, endDate) =>
  api.get(`/farm-satellite/history/${farmId}`, {
    params: { limit, start_date: startDate || undefined, end_date: endDate || undefined },
  })
export const fetchPipelineData = (startDate, endDate) =>
  api.post('/pipeline/fetch-data', null, {
    params: { start_date: startDate || undefined, end_date: endDate || undefined },
  })

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
    timeout: 120000,  // ML inference can take up to 2 min on free tier cold start
  })
}
export const getClassificationHistory = (limit = 20, farmId = null) =>
  api.get('/ml/classification-history', { params: { limit, farm_id: farmId || undefined } })
export const getSupportedDiseases = () => api.get('/ml/supported-diseases')
export const getCropModels = () => api.get('/ml/crop-models')
export const getRiskAssessment = (farmId) => api.get(`/ml/risk-assessment/${farmId}`)
export const getRiskAssessmentBatch = (farmIds) =>
  api.get('/ml/risk-assessment/batch', { params: { farm_ids: farmIds.join(',') } })
export const predictYield = (farmId) => api.get(`/ml/predict-yield/${farmId}`)
export const detectAnomalies = (farmId, daysBack = 30) =>
  api.post('/ml/detect-anomalies', { farm_id: farmId, days_back: daysBack })
export const forecastHealth = (farmId, forecastDays = 14) =>
  api.post('/ml/forecast-health', { farm_id: farmId, forecast_days: forecastDays })
export const getModelStatus = () => api.get('/ml/models/status')
export const explainRisk = (farmId) => api.get(`/ml/explain-risk/${farmId}`)

// ── Diseases ──
export const getDiseases = (skip = 0, limit = 100) =>
  api.get('/diseases/', { params: { skip, limit } })
export const predictDisease = (farmId, diseaseName, cropType, forecastDays = 7) =>
  api.post('/diseases/predict', { farm_id: farmId, disease_name: diseaseName, crop_type: cropType, forecast_days: forecastDays })
export const getDiseaseForecasts = (farmId, diseaseName, days = 7) =>
  api.get(`/diseases/forecast/daily/${farmId}`, { params: { disease_name: diseaseName, days } })
export const getWeeklyForecast = (farmId, diseaseName) =>
  api.get(`/diseases/forecast/weekly/${farmId}`, { params: { disease_name: diseaseName } })
export const getDiseaseStatistics = (farmId, days = 30) =>
  api.get(`/diseases/statistics/${farmId}`, { params: { days } })
export const getFarmPredictions = (farmId, limit = 10) =>
  api.get(`/diseases/predictions/farm/${farmId}`, { params: { limit } })

// ── Early Warning ──
export const getEarlyWarnings = () => api.get('/early-warning/')
export const fetchWeatherAll = () => api.post('/early-warning/fetch-weather')

// ── Advisory ──
export const getDailyAdvisory = (farmId, includeRisk = true) =>
  api.get(`/advisory/daily/${farmId}`, { params: { include_risk: includeRisk } })
export const getAdvisorySummary = () => api.get('/advisory/summary')

// ── Auto Crop Risk ──
export const analyzeFarmRisk = (farmId, { daysBack = 15, maxCloudCover = 20, forceRefresh = false } = {}) =>
  api.post('/farm/analyze-risk', {
    farm_id: farmId,
    days_back: daysBack,
    max_cloud_cover: maxCloudCover,
    force_refresh: forceRefresh,
  }, { timeout: 120000 })
export const getFarmRisk = (farmId, forceRefresh = false) =>
  api.get(`/farm/analyze-risk/${farmId}`, { params: { force_refresh: forceRefresh }, timeout: 120000 })
export const analyzeAllFarmsRisk = () =>
  api.post('/farm/analyze-risk/all', null, { timeout: 300000 })

// ── Health ──
export const getHealth = () => api.get('/health')

export default api

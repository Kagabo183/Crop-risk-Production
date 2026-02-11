import axios from 'axios'

const API_BASE = '/api/v1'

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
})

// ── Farms ──
export const getFarms = () => api.get('/farms/')

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

// ── Farm Satellite ──
export const getFarmSatellite = () => api.get('/farm-satellite/')

export const getNdviHistory = (farmId, limit = 30) =>
  api.get(`/farm-satellite/history/${farmId}`, { params: { limit } })

// ── ML ──
export const classifyDisease = (file, cropType) => {
  const form = new FormData()
  form.append('file', file)
  const params = cropType ? { crop_type: cropType } : {}
  return api.post('/ml/classify-disease', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params,
  })
}

export const getSupportedDiseases = () => api.get('/ml/supported-diseases')

export const getRiskAssessment = (farmId) =>
  api.get(`/ml/risk-assessment/${farmId}`)

export const getRiskAssessmentBatch = (farmIds) =>
  api.get('/ml/risk-assessment/batch', { params: { farm_ids: farmIds.join(',') } })

export const predictYield = (farmId) =>
  api.get(`/ml/predict-yield/${farmId}`)

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

// ── Health ──
export const getHealth = () => api.get('/health')

export default api

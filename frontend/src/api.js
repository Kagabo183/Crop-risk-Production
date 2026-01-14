// Simple API utility for backend requests
// Prefer env var (docker-compose sets REACT_APP_API_URL), fallback to localhost.
export const API_BASE = (process.env.REACT_APP_API_URL || 'http://localhost:8000').replace(/\/$/, '') + '/api/v1';

export async function fetchSatelliteImageCount() {
  const res = await fetch(`${API_BASE}/satellite-images/count`);
  if (!res.ok) throw new Error('Failed to fetch satellite image count');
  const data = await res.json();
  return data?.count ?? 0;
}

export async function fetchSatelliteImageStats() {
  const res = await fetch(`${API_BASE}/satellite-images/stats`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch satellite image stats');
  return res.json();
}

export async function fetchSatelliteImages(limit = 100) {
  const res = await fetch(`${API_BASE}/satellite-images/?source=db&limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch satellite images');
  return res.json();
}

export async function fetchNDVIMeans(limit = 100) {
  const res = await fetch(`${API_BASE}/satellite-images/ndvi-means?source=db&limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch NDVI means');
  return res.json();
}

export async function triggerScan() {
  const res = await fetch(`${API_BASE}/satellite-images/scan`, {
    method: 'POST',
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to trigger scan');
  return res.json();
}

export async function processMissingNDVIMeans() {
  const res = await fetch(`${API_BASE}/satellite-images/process-missing-ndvi-means`, {
    method: 'POST',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to process missing NDVI means');
  return res.json();
}

export async function getTaskStatus(taskId) {
  const res = await fetch(`${API_BASE}/satellite-images/task/${taskId}`);
  if (!res.ok) throw new Error('Failed to fetch task status');
  return res.json();
}

// ========== Disease Prediction API ==========

export async function fetchDiseases() {
  const res = await fetch(`${API_BASE}/diseases/`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch diseases');
  return res.json();
}

export async function createDisease(disease) {
  const res = await fetch(`${API_BASE}/diseases/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(disease),
  });

  if (!res.ok) {
    let detail = 'Failed to create disease';
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return res.json();
}

export async function predictDisease(farmId, diseaseName, cropType, forecastDays = 7) {
  const res = await fetch(`${API_BASE}/diseases/predict`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify({
      farm_id: farmId,
      disease_name: diseaseName,
      crop_type: cropType,
      forecast_days: forecastDays
    })
  });
  if (!res.ok) throw new Error('Failed to predict disease');
  return res.json();
}

export async function fetchDailyForecast(farmId, diseaseName, days = 7) {
  const params = new URLSearchParams({ days: days.toString() });
  if (diseaseName) params.append('disease_name', diseaseName);
  
  const res = await fetch(`${API_BASE}/diseases/forecast/daily/${farmId}?${params}`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch daily forecast');
  return res.json();
}

export async function fetchWeeklyForecast(farmId, diseaseName) {
  const params = new URLSearchParams();
  if (diseaseName) params.append('disease_name', diseaseName);
  
  const res = await fetch(`${API_BASE}/diseases/forecast/weekly/${farmId}?${params}`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch weekly forecast');
  return res.json();
}

export async function fetchDiseaseStatistics(farmId, diseaseName, days = 30) {
  const params = new URLSearchParams({ days: days.toString() });
  if (diseaseName) params.append('disease_name', diseaseName);
  
  const res = await fetch(`${API_BASE}/diseases/statistics/${farmId}?${params}`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch disease statistics');
  return res.json();
}

export async function fetchDiseasePredictions(farmId, diseaseName, limit = 10) {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (farmId) params.append('farm_id', farmId);
  if (diseaseName) params.append('disease_name', diseaseName);
  
  const res = await fetch(`${API_BASE}/diseases/predictions/?${params}`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch disease predictions');
  return res.json();
}

export async function fetchFarmObservations(farmId, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${API_BASE}/diseases/observations/farm/${farmId}?${params}`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch observations');
  return res.json();
}

export async function submitDiseaseObservation(farmId, diseaseName, severity, notes = '') {
  // Backward compatible signature:
  //   submitDiseaseObservation(farmId, diseaseName, severity, notes)
  // Preferred signature:
  //   submitDiseaseObservation({ farmId, diseaseId, diseaseName, diseasePresent, diseaseSeverity, notes, observationDate })
  let payload;
  if (typeof farmId === 'object' && farmId) {
    const {
      farmId: fId,
      diseaseId,
      diseaseName: dName,
      diseasePresent = true,
      diseaseSeverity,
      notes: n = '',
      observationDate,
    } = farmId;

    payload = {
      farm_id: fId,
      disease_id: diseaseId ?? null,
      observation_date: observationDate || new Date().toISOString().slice(0, 10),
      disease_present: Boolean(diseasePresent),
      disease_severity: diseaseSeverity ?? null,
      notes: n || null,
    };

    // If diseaseId not provided but diseaseName is, resolve it.
    if (!payload.disease_id && dName) {
      const diseases = await fetchDiseases();
      const match = (Array.isArray(diseases) ? diseases : []).find((d) => d?.name === dName);
      payload.disease_id = match?.id ?? null;
    }
  } else {
    const diseases = await fetchDiseases();
    const match = (Array.isArray(diseases) ? diseases : []).find((d) => d?.name === diseaseName);
    payload = {
      farm_id: farmId,
      disease_id: match?.id ?? null,
      observation_date: new Date().toISOString().slice(0, 10),
      disease_present: true,
      disease_severity: severity || null,
      notes: notes || null,
    };
  }

  const res = await fetch(`${API_BASE}/diseases/observations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    let detail = 'Failed to submit observation';
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function updateFarm(farmId, patch) {
  const res = await fetch(`${API_BASE}/farms/${farmId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(patch || {}),
  });
  if (!res.ok) {
    let detail = 'Failed to update farm';
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return res.json();
}
function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ========== Crop Type (GEE + ML) ==========

export async function cropTypeRecompute({
  ee_project,
  threshold = 0.6,
  overwrite = false,
  start = '2024-01-01',
  end = '2024-12-31',
  model_dir = 'ml/models_radiant_full'
} = {}) {
  const res = await fetch(`${API_BASE}/crop-type/recompute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ ee_project, threshold, overwrite, start, end, model_dir }),
  });

  if (!res.ok) {
    let detail = 'Failed to recompute crop types';
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return res.json();
}

export async function cropTypeApply({ predictions_csv, threshold = 0.6, overwrite = false } = {}) {
  const res = await fetch(`${API_BASE}/crop-type/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ predictions_csv, threshold, overwrite }),
  });

  if (!res.ok) {
    let detail = 'Failed to apply crop type predictions';
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return res.json();
}

export async function cropTypeRuns(limit = 20) {
  const res = await fetch(`${API_BASE}/crop-type/runs?limit=${encodeURIComponent(limit)}`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch crop-type runs');
  return res.json();
}

export async function cropTypeLatestRun() {
  const res = await fetch(`${API_BASE}/crop-type/runs/latest`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch latest crop-type run');
  return res.json();
}

export async function fetchFarms() {
  const res = await fetch(`${API_BASE}/farms/`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch farms');
  return res.json();
}

export async function updateFarmBoundary(farmId, boundary) {
  const res = await fetch(`${API_BASE}/farms/${encodeURIComponent(farmId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ boundary }),
  });

  if (!res.ok) {
    let detail = 'Failed to update farm boundary';
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return res.json();
}

export async function fetchPredictions() {
  const res = await fetch(`${API_BASE}/predictions/`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch predictions');
  return res.json();
}

export async function fetchAlerts() {
  const res = await fetch(`${API_BASE}/alerts/`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch alerts');
  return res.json();
}

// ===== Pipeline analytics (geographic breakdown) =====

export async function fetchRiskByProvince() {
  const res = await fetch(`${API_BASE}/pipeline/predictions/by-province`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch province analytics');
  return res.json();
}

export async function fetchRiskByDistrict() {
  const res = await fetch(`${API_BASE}/pipeline/predictions/by-district`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch district analytics');
  return res.json();
}

export async function runRiskPredictions({ overwrite = false } = {}) {
  const url = new URL(`${API_BASE}/pipeline/risk-predictions/run`, window.location.origin);
  if (overwrite) url.searchParams.set('overwrite', 'true');
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to start risk prediction job');
  return res.json();
}

export async function fetchRiskPredictionStatus() {
  const res = await fetch(`${API_BASE}/pipeline/risk-predictions/status`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch risk prediction job status');
  return res.json();
}

export async function fetchUsers() {
  const res = await fetch(`${API_BASE}/users/`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

// ========== Analytics API ==========

export async function fetchDashboardMetrics() {
  const res = await fetch(`${API_BASE}/analytics/dashboard-metrics`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch dashboard metrics');
  return res.json();
}

export async function fetchEnrichedPredictions() {
  const res = await fetch(`${API_BASE}/analytics/predictions-enriched`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch enriched predictions');
  return res.json();
}

// ========== Data Management API ==========

export async function fetchDataStatus() {
  const res = await fetch(`${API_BASE}/data/data-status`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch data status');
  return res.json();
}

export async function triggerDataFetch() {
  const res = await fetch(`${API_BASE}/data/fetch-data`, {
    method: 'POST',
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to trigger data fetch');
  return res.json();
}


// ========== Weather API ==========

export async function fetchWeatherForecast(lat, lon, days = 7) {
  const params = new URLSearchParams({ lat, lon, days: days.toString() });
  const res = await fetch(`${API_BASE}/weather/forecast?${params}`, {
    headers: { ...getAuthHeaders() }
  });
  if (!res.ok) throw new Error('Failed to fetch weather forecast');
  return res.json();
}

// ========== Remote Sensing Diagnostics (Sentinel/NDVI) ==========

export async function fetchRemoteSensingDiagnostics(farmId, days = 30, topN = 3) {
  const params = new URLSearchParams({ days: String(days), top_n: String(topN) });
  const res = await fetch(`${API_BASE}/remote-sensing/diagnostics/${farmId}?${params}`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch remote sensing diagnostics');
  return res.json();
}

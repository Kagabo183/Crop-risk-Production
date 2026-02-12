import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area,
} from 'recharts'
import { Activity, Droplets, Sun, Leaf, AlertTriangle } from 'lucide-react'
import {
  getFarms, getStressAssessment, getVegetationHealth,
  getVegetationIndices, getDroughtAssessment, getWaterStress, getHeatStress,
} from '../api'

export default function StressMonitoring() {
  const [farms, setFarms] = useState([])
  const [selectedFarm, setSelectedFarm] = useState('')
  const [stress, setStress] = useState(null)
  const [health, setHealth] = useState([])
  const [indices, setIndices] = useState(null)
  const [drought, setDrought] = useState(null)
  const [water, setWater] = useState(null)
  const [heat, setHeat] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getFarms().then(r => {
      setFarms(r.data)
      if (r.data.length) setSelectedFarm(r.data[0].id)
    }).catch(() => {})
  }, [])

  const loadData = async () => {
    if (!selectedFarm) return
    setLoading(true)
    setError(null)

    const results = await Promise.allSettled([
      getStressAssessment(selectedFarm),
      getVegetationHealth(selectedFarm, 90),
      getVegetationIndices(selectedFarm),
      getDroughtAssessment(selectedFarm),
      getWaterStress(selectedFarm),
      getHeatStress(selectedFarm),
    ])

    if (results[0].status === 'fulfilled') setStress(results[0].value.data)
    if (results[1].status === 'fulfilled') setHealth(results[1].value.data || [])
    if (results[2].status === 'fulfilled') setIndices(results[2].value.data)
    if (results[3].status === 'fulfilled') setDrought(results[3].value.data)
    if (results[4].status === 'fulfilled') setWater(results[4].value.data)
    if (results[5].status === 'fulfilled') setHeat(results[5].value.data)

    const anyFailed = results.every(r => r.status === 'rejected')
    if (anyFailed) setError('Failed to load stress data. Make sure the backend is running.')

    setLoading(false)
  }

  useEffect(() => {
    if (selectedFarm) loadData()
  }, [selectedFarm])

  const stressColor = (level) => {
    const map = { none: '#16a34a', low: '#16a34a', moderate: '#d97706', high: '#dc2626', severe: '#7c2d12' }
    return map[level] || '#6b7280'
  }

  return (
    <>
      {/* Farm selector */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
            <label>Select Farm</label>
            <select className="form-control" value={selectedFarm} onChange={e => setSelectedFarm(Number(e.target.value))}>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={loadData} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 20 }}><AlertTriangle size={18} />{error}</div>}
      {loading && <div className="loading"><div className="spinner" /><p>Loading stress data...</p></div>}

      {stress && !loading && (
        <>
          {/* Stress Overview */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon green"><Activity size={22} /></div>
              <div className="stat-info">
                <h4>Health Score</h4>
                <div className="stat-value">{stress.health_score?.toFixed(0) ?? '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>out of 100</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{
                background: stress.stress_level === 'none' || stress.stress_level === 'low' ? 'var(--success-light)' : 'var(--danger-light)',
                color: stressColor(stress.stress_level),
              }}>
                <AlertTriangle size={22} />
              </div>
              <div className="stat-info">
                <h4>Stress Level</h4>
                <div className="stat-value" style={{ textTransform: 'capitalize', color: stressColor(stress.stress_level) }}>
                  {stress.stress_level || 'none'}
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon orange"><Activity size={22} /></div>
              <div className="stat-info">
                <h4>Stress Score</h4>
                <div className="stat-value">{stress.stress_score?.toFixed(0) ?? '—'}</div>
              </div>
            </div>
            {stress.primary_stress && stress.primary_stress !== 'none' && (
              <div className="stat-card">
                <div className="stat-icon red"><AlertTriangle size={22} /></div>
                <div className="stat-info">
                  <h4>Primary Stress</h4>
                  <div className="stat-value" style={{ fontSize: 18, textTransform: 'capitalize' }}>
                    {stress.primary_stress}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Stress Breakdown */}
          {stress.stress_breakdown && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><h3>Stress Breakdown</h3></div>
              <div className="card-body">
                <div className="stress-bars">
                  {Object.entries(stress.stress_breakdown).map(([type, raw]) => {
                    const val = typeof raw === 'number' ? raw : raw?.score ?? 0
                    return (
                      <div key={type} className="stress-bar-item">
                        <label>
                          <span style={{ textTransform: 'capitalize' }}>{type}</span>
                          <span>{val?.toFixed(1)}%</span>
                        </label>
                        <div className="stress-bar-track">
                          <div className="stress-bar-fill" style={{
                            width: `${Math.min(val || 0, 100)}%`,
                            background: val > 60 ? 'var(--danger)' : val > 30 ? 'var(--warning)' : 'var(--success)',
                          }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Vegetation Indices */}
          {indices?.indices && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <h3>Current Vegetation Indices</h3>
                {indices.acquisition_date && (
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {new Date(indices.acquisition_date).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="card-body">
                <div className="stats-grid">
                  {Object.entries(indices.indices).map(([key, val]) => (
                    <div key={key} className="stat-card">
                      <div className="stat-info">
                        <h4>{key.toUpperCase()}</h4>
                        <div className="stat-value">{val?.toFixed(3) ?? '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Health Time Series */}
          {health.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><h3>Vegetation Health History (90 days)</h3></div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={health}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis domain={[0, 1]} fontSize={12} />
                    <Tooltip />
                    <Area type="monotone" dataKey="ndvi" stroke="#16a34a" fill="#dcfce7" name="NDVI" />
                    {health[0]?.ndwi != null && (
                      <Area type="monotone" dataKey="ndwi" stroke="#0891b2" fill="#cffafe" name="NDWI" />
                    )}
                    {health[0]?.evi != null && (
                      <Area type="monotone" dataKey="evi" stroke="#7c3aed" fill="#ede9fe" name="EVI" />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Detailed Stress Cards */}
          <div className="grid-3">
            {drought && (
              <div className="card">
                <div className="card-header"><h3><Sun size={16} style={{ verticalAlign: -2 }} /> Drought</h3></div>
                <div className="card-body">
                  <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(drought, null, 2).substring(0, 500)}
                  </pre>
                </div>
              </div>
            )}
            {water && (
              <div className="card">
                <div className="card-header"><h3><Droplets size={16} style={{ verticalAlign: -2 }} /> Water Stress</h3></div>
                <div className="card-body">
                  <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(water, null, 2).substring(0, 500)}
                  </pre>
                </div>
              </div>
            )}
            {heat && (
              <div className="card">
                <div className="card-header"><h3><Sun size={16} style={{ verticalAlign: -2 }} /> Heat Stress</h3></div>
                <div className="card-body">
                  <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(heat, null, 2).substring(0, 500)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!stress && !loading && !error && (
        <div className="empty-state">
          <Activity size={48} />
          <h3>Select a farm to monitor stress</h3>
          <p>View drought, heat, water, and nutrient stress indicators</p>
        </div>
      )}
    </>
  )
}

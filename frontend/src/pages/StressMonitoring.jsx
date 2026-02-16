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
  const [user, setUser] = useState(null)

  // Load user from localStorage
  useEffect(() => {
    const storedUser = localStorage.getItem('user')
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser))
      } catch (e) {
        console.error('Failed to parse user from localStorage')
      }
    }
  }, [])

  // Helper to check if user has any of the specified roles
  const hasRole = (...roles) => {
    return user && roles.includes(user.role)
  }

  useEffect(() => {
    getFarms().then(r => {
      setFarms(r.data)
      if (r.data.length) setSelectedFarm(r.data[0].id)
    }).catch(err => {
      console.error('Failed to load farms:', err)
      setError('Unable to load farms. Please refresh the page.')
    })
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

    // Check if ANY requests failed (not ALL)
    const anyFailed = results.some(r => r.status === 'rejected')
    if (anyFailed) {
      const failedCount = results.filter(r => r.status === 'rejected').length
      console.warn(`${failedCount} of ${results.length} stress monitoring requests failed`)
      setError(`Some stress data failed to load (${failedCount}/${results.length}). Data may be incomplete.`)
    }

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

      {/* Buffer warning for farms without boundaries */}
      {selectedFarm && farms.length > 0 && !loading && (() => {
        const currentFarm = farms.find(f => f.id === selectedFarm)
        const hasBoundary = currentFarm?.boundary != null
        const farmArea = currentFarm?.area

        if (!hasBoundary && farmArea) {
          const bufferAreaHa = (3.14159 * 50 * 50) / 10000 // 50m buffer area
          const ratio = bufferAreaHa / farmArea

          if (ratio > 1.5) {
            return (
              <div style={{
                padding: 16,
                marginBottom: 20,
                background: '#fef3c7',
                border: '1px solid #f59e0b',
                borderLeft: '4px solid #f59e0b',
                borderRadius: 6
              }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'start' }}>
                  <AlertTriangle size={20} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: '#92400e', display: 'block', marginBottom: 4 }}>
                      ⚠️ Data Accuracy Warning
                    </strong>
                    <p style={{ fontSize: 14, margin: '0 0 8px 0', color: '#78350f' }}>
                      This farm ({farmArea?.toFixed(1)} ha) doesn't have a defined boundary polygon. Satellite data is being
                      sampled from a 50m circular buffer (~{bufferAreaHa.toFixed(1)} ha), which is {ratio.toFixed(1)}x larger than your farm.
                    </p>
                    <p style={{ fontSize: 13, margin: 0, color: '#78350f' }}>
                      <strong>Impact:</strong> Health scores may include data from neighboring farms, forests, or roads.
                      {hasRole('agronomist', 'admin') && ' Add a boundary polygon in the farm settings for accurate analysis.'}
                    </p>
                  </div>
                </div>
              </div>
            )
          }
        }
        return null
      })()}

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

          {/* Overall Assessment Message & Action */}
          {(stress.message || stress.message_farmer || stress.message_technical) && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-body">
                <div style={{ fontSize: 14, marginBottom: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 6 }}>
                  {hasRole('farmer')
                    ? (stress.message_farmer || stress.message)
                    : (stress.message_technical || stress.message)
                  }
                </div>
                {stress.action && (
                  <div style={{
                    fontSize: 13,
                    padding: 12,
                    background: stress.stress_level === 'severe' || stress.stress_level === 'high' ? '#fef3c7' : '#f0fdf4',
                    borderLeft: `4px solid ${stress.stress_level === 'severe' || stress.stress_level === 'high' ? '#f59e0b' : '#22c55e'}`,
                    borderRadius: 4
                  }}>
                    <strong>💡 Recommended Action:</strong> {stress.action}
                    {stress.action_days_min && stress.action_days_max && (
                      <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                        ⏰ Timeline: Take action within {stress.action_days_min}-{stress.action_days_max} days
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

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
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3><Sun size={16} style={{ verticalAlign: -2 }} /> Drought Stress</h3>
                  <span className={`badge ${drought.level}`} style={{ textTransform: 'capitalize' }}>{drought.level}</span>
                </div>
                <div className="card-body">
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 32, fontWeight: 600, color: drought.score >= 60 ? 'var(--danger)' : drought.score >= 40 ? 'var(--warning)' : 'var(--success)' }}>
                      {drought.score}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Drought Score (0-100)</div>
                  </div>
                  {/* Display role-appropriate message */}
                  {(drought.message || drought.message_farmer || drought.message_technical) && (
                    <p style={{ fontSize: 14, marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 6 }}>
                      {hasRole('farmer')
                        ? (drought.message_farmer || drought.message)
                        : (drought.message_technical || drought.message)
                      }
                    </p>
                  )}
                  {/* Action recommendation */}
                  {drought.action && (
                    <div style={{
                      fontSize: 13,
                      padding: 10,
                      background: drought.level === 'severe' || drought.level === 'high' ? '#fef3c7' : '#f0fdf4',
                      borderLeft: `3px solid ${drought.level === 'severe' || drought.level === 'high' ? '#f59e0b' : '#22c55e'}`,
                      borderRadius: 4,
                      marginBottom: 12
                    }}>
                      <strong>💡 Recommended Action:</strong> {drought.action}
                      {drought.action_days_min && drought.action_days_max && (
                        <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                          ⏰ Timeline: {drought.action_days_min}-{drought.action_days_max} days
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>NDVI</span>
                      <strong>{drought.ndvi?.toFixed(3) ?? 'N/A'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>NDWI</span>
                      <strong>{drought.ndwi?.toFixed(3) ?? 'N/A'}</strong>
                    </div>
                    {drought.rainfall_deficit_percent != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Rainfall Deficit</span>
                        <strong style={{ color: drought.rainfall_deficit_percent > 50 ? 'var(--danger)' : 'var(--text)' }}>
                          {drought.rainfall_deficit_percent.toFixed(1)}%
                        </strong>
                      </div>
                    )}
                    {drought.ndvi_trend != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>NDVI Trend</span>
                        <strong style={{ color: drought.ndvi_trend < 0 ? 'var(--danger)' : 'var(--success)' }}>
                          {drought.ndvi_trend > 0 ? '+' : ''}{drought.ndvi_trend.toFixed(4)}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {water && (
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3><Droplets size={16} style={{ verticalAlign: -2 }} /> Water Stress</h3>
                  <span className={`badge ${water.level}`} style={{ textTransform: 'capitalize' }}>{water.level}</span>
                </div>
                <div className="card-body">
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 32, fontWeight: 600, color: water.score >= 60 ? 'var(--danger)' : water.score >= 40 ? 'var(--warning)' : 'var(--success)' }}>
                      {water.score}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Water Stress Score (0-100)</div>
                  </div>
                  {/* Display role-appropriate message */}
                  {(water.message || water.message_farmer || water.message_technical) && (
                    <p style={{ fontSize: 14, marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 6 }}>
                      {hasRole('farmer')
                        ? (water.message_farmer || water.message)
                        : (water.message_technical || water.message)
                      }
                    </p>
                  )}
                  {/* Action recommendation */}
                  {water.action && (
                    <div style={{
                      fontSize: 13,
                      padding: 10,
                      background: water.level === 'severe' || water.level === 'high' ? '#fef3c7' : '#f0fdf4',
                      borderLeft: `3px solid ${water.level === 'severe' || water.level === 'high' ? '#f59e0b' : '#22c55e'}`,
                      borderRadius: 4,
                      marginBottom: 12
                    }}>
                      <strong>💡 Recommended Action:</strong> {water.action}
                      {water.action_days_min && water.action_days_max && (
                        <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                          ⏰ Timeline: {water.action_days_min}-{water.action_days_max} days
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>NDWI</span>
                      <strong>{water.ndwi?.toFixed(3) ?? 'N/A'}</strong>
                    </div>
                    {water.ndvi_decline_rate != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>NDVI Decline Rate</span>
                        <strong style={{ color: water.ndvi_decline_rate < -0.02 ? 'var(--danger)' : 'var(--text)' }}>
                          {water.ndvi_decline_rate.toFixed(4)}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {heat && (
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3><Sun size={16} style={{ verticalAlign: -2 }} /> Heat Stress</h3>
                  <span className={`badge ${heat.level}`} style={{ textTransform: 'capitalize' }}>{heat.level}</span>
                </div>
                <div className="card-body">
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 32, fontWeight: 600, color: heat.score >= 60 ? 'var(--danger)' : heat.score >= 40 ? 'var(--warning)' : 'var(--success)' }}>
                      {heat.score}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Heat Stress Score (0-100)</div>
                  </div>
                  {/* Display role-appropriate message */}
                  {(heat.message || heat.message_farmer || heat.message_technical) && (
                    <p style={{ fontSize: 14, marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 6 }}>
                      {hasRole('farmer')
                        ? (heat.message_farmer || heat.message)
                        : (heat.message_technical || heat.message)
                      }
                    </p>
                  )}
                  {/* Action recommendation */}
                  {heat.action && (
                    <div style={{
                      fontSize: 13,
                      padding: 10,
                      background: heat.level === 'severe' || heat.level === 'high' ? '#fef3c7' : '#f0fdf4',
                      borderLeft: `3px solid ${heat.level === 'severe' || heat.level === 'high' ? '#f59e0b' : '#22c55e'}`,
                      borderRadius: 4,
                      marginBottom: 12
                    }}>
                      <strong>💡 Recommended Action:</strong> {heat.action}
                      {heat.action_days_min && heat.action_days_max && (
                        <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                          ⏰ Timeline: {heat.action_days_min}-{heat.action_days_max} days
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'grid', gap: 8 }}>
                    {heat.heat_stress_days != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Heat Stress Days</span>
                        <strong style={{ color: heat.heat_stress_days > 3 ? 'var(--danger)' : 'var(--text)' }}>
                          {heat.heat_stress_days} {heat.heat_stress_days === 1 ? 'day' : 'days'}
                        </strong>
                      </div>
                    )}
                    {heat.ndvi_decline_rate != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>NDVI Decline Rate</span>
                        <strong style={{ color: heat.ndvi_decline_rate < -0.02 ? 'var(--danger)' : 'var(--text)' }}>
                          {heat.ndvi_decline_rate.toFixed(4)}
                        </strong>
                      </div>
                    )}
                  </div>
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

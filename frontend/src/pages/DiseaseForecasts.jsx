import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts'
import { TrendingUp, AlertTriangle, Shield } from 'lucide-react'
import {
  getFarms, getDiseases, getDiseaseForecasts, getWeeklyForecast,
  getDiseaseStatistics, getFarmPredictions,
} from '../api'

const RISK_COLORS = { low: '#16a34a', moderate: '#d97706', high: '#dc2626', severe: '#7c2d12' }

export default function DiseaseForecasts() {
  const [farms, setFarms] = useState([])
  const [diseases, setDiseases] = useState([])
  const [selectedFarm, setSelectedFarm] = useState('')
  const [selectedDisease, setSelectedDisease] = useState('')
  const [forecast, setForecast] = useState([])
  const [weekly, setWeekly] = useState(null)
  const [stats, setStats] = useState(null)
  const [predictions, setPredictions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.allSettled([getFarms(), getDiseases()])
      .then(([fRes, dRes]) => {
        if (fRes.status === 'fulfilled') {
          setFarms(fRes.value.data)
          if (fRes.value.data.length) setSelectedFarm(fRes.value.data[0].id)
        }
        if (dRes.status === 'fulfilled') {
          setDiseases(dRes.value.data || [])
          if (dRes.value.data?.length) setSelectedDisease(dRes.value.data[0].name)
        }
      })
  }, [])

  const loadForecasts = async () => {
    if (!selectedFarm || !selectedDisease) return
    setLoading(true)
    setError(null)

    const results = await Promise.allSettled([
      getDiseaseForecasts(selectedFarm, selectedDisease, 7),
      getWeeklyForecast(selectedFarm, selectedDisease),
      getDiseaseStatistics(selectedFarm, 30),
      getFarmPredictions(selectedFarm, 10),
    ])

    if (results[0].status === 'fulfilled') setForecast(results[0].value.data || [])
    if (results[1].status === 'fulfilled') setWeekly(results[1].value.data)
    if (results[2].status === 'fulfilled') setStats(results[2].value.data)
    if (results[3].status === 'fulfilled') setPredictions(results[3].value.data || [])

    const allFailed = results.every(r => r.status === 'rejected')
    if (allFailed) setError('Failed to load forecast data')

    setLoading(false)
  }

  useEffect(() => {
    if (selectedFarm && selectedDisease) loadForecasts()
  }, [selectedFarm, selectedDisease])

  return (
    <>
      {/* Selectors */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
            <label>Farm</label>
            <select className="form-control" value={selectedFarm} onChange={e => setSelectedFarm(Number(e.target.value))}>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
            <label>Disease</label>
            <select className="form-control" value={selectedDisease} onChange={e => setSelectedDisease(e.target.value)}>
              {diseases.map(d => <option key={d.id || d.name} value={d.name}>{d.name}</option>)}
              {diseases.length === 0 && (
                <>
                  <option value="Late Blight">Late Blight</option>
                  <option value="Early Blight">Early Blight</option>
                  <option value="Septoria Leaf Spot">Septoria Leaf Spot</option>
                </>
              )}
            </select>
          </div>
          <button className="btn btn-primary" onClick={loadForecasts} disabled={loading}>
            {loading ? 'Loading...' : 'Get Forecast'}
          </button>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 20 }}><AlertTriangle size={18} />{error}</div>}
      {loading && <div className="loading"><div className="spinner" /><p>Generating disease forecast...</p></div>}

      {!loading && (
        <>
          {/* Weekly Summary */}
          {weekly && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><h3>7-Day Forecast Summary — {weekly.disease || selectedDisease}</h3></div>
              <div className="card-body">
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon orange"><TrendingUp size={22} /></div>
                    <div className="stat-info">
                      <h4>Average Risk</h4>
                      <div className="stat-value">{weekly.average_risk?.toFixed(0) ?? '—'}</div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon red"><AlertTriangle size={22} /></div>
                    <div className="stat-info">
                      <h4>Peak Risk (Day {weekly.peak_risk_day ?? '—'})</h4>
                      <div className="stat-value">{weekly.peak_risk_score?.toFixed(0) ?? '—'}</div>
                    </div>
                  </div>
                  {weekly.treatment_window && (
                    <div className="stat-card">
                      <div className="stat-icon green"><Shield size={22} /></div>
                      <div className="stat-info">
                        <h4>Treatment Window</h4>
                        <div className="stat-value" style={{ fontSize: 16 }}>{weekly.treatment_window}</div>
                      </div>
                    </div>
                  )}
                  {weekly.recommended_fungicide && (
                    <div className="stat-card">
                      <div className="stat-info">
                        <h4>Recommended</h4>
                        <div className="stat-value" style={{ fontSize: 16 }}>{weekly.recommended_fungicide}</div>
                        {weekly.application_timing && (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{weekly.application_timing}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Daily Forecast Chart */}
          {forecast.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><h3>Daily Risk Forecast</h3></div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={forecast}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis domain={[0, 100]} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="risk_score" name="Risk Score" radius={[4, 4, 0, 0]}>
                      {forecast.map((entry, i) => (
                        <Cell key={i} fill={RISK_COLORS[entry.risk_level] || '#6b7280'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Statistics */}
          {stats && (
            <div className="grid-2">
              <div className="card">
                <div className="card-header"><h3>Disease Statistics (30 days)</h3></div>
                <div className="card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Total Predictions</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.total_predictions ?? '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Avg Risk Score</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.average_risk_score?.toFixed(1) ?? '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Max Risk</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>{stats.max_risk_score?.toFixed(1) ?? '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>High Risk Alerts</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--warning)' }}>{stats.high_risk_alerts ?? '—'}</div>
                    </div>
                  </div>

                  {/* Risk Distribution */}
                  {stats.risk_distribution && (
                    <div style={{ marginTop: 20 }}>
                      <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Risk Distribution</h4>
                      {Object.entries(stats.risk_distribution).map(([level, count]) => (
                        <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span className={`badge ${level}`} style={{ minWidth: 70, justifyContent: 'center' }}>{level}</span>
                          <div className="confidence-bar" style={{ flex: 1 }}>
                            <div className="confidence-fill" style={{
                              width: `${(count / Math.max(stats.total_predictions, 1)) * 100}%`,
                              background: RISK_COLORS[level] || '#6b7280',
                            }} />
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 24 }}>{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Predictions */}
              <div className="card">
                <div className="card-header"><h3>Recent Predictions</h3></div>
                <div className="card-body table-wrap">
                  {predictions.length > 0 ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Risk</th>
                          <th>Level</th>
                        </tr>
                      </thead>
                      <tbody>
                        {predictions.slice(0, 10).map((p, i) => (
                          <tr key={i}>
                            <td>{p.prediction_date || '—'}</td>
                            <td style={{ fontWeight: 600 }}>{p.risk_score?.toFixed(1) ?? '—'}</td>
                            <td><span className={`badge ${p.risk_level || 'info'}`}>{p.risk_level || '—'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="empty-state">
                      <p>No recent predictions</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!forecast.length && !weekly && !stats && !loading && (
            <div className="empty-state">
              <TrendingUp size={48} />
              <h3>Select a farm and disease</h3>
              <p>View 7-day disease risk forecasts with treatment recommendations</p>
            </div>
          )}
        </>
      )}
    </>
  )
}

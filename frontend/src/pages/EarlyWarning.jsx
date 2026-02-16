import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { AlertTriangle, Shield, CloudRain, Sprout, RefreshCw, Clock } from 'lucide-react'
import { getEarlyWarnings, fetchWeatherAll } from '../api'

const LEVEL_COLORS = { critical: '#dc2626', high: '#ea580c', moderate: '#d97706', low: '#16a34a' }
const LEVEL_LABELS = { critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low' }

export default function EarlyWarning() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true)
    getEarlyWarnings()
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.detail || 'Failed to load alerts'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleFetchWeather = async () => {
    setFetching(true)
    try {
      await fetchWeatherAll()
      load() // Refresh warnings after weather update
    } catch (e) {
      setError(e.response?.data?.detail || 'Weather fetch failed')
    }
    setFetching(false)
  }

  if (loading) return <div className="loading"><div className="spinner" /><p>Analyzing farm conditions...</p></div>

  const alerts = data?.alerts || []
  const summary = data?.summary || {}

  const chartData = alerts.slice(0, 15).map(a => ({
    name: (a.farm_name || `Farm ${a.farm_id}`).substring(0, 12),
    score: a.combined_score,
    level: a.alert_level,
  }))

  return (
    <>
      {/* Header + Actions */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>Early Warning System</h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              Weather-disease correlation + NDVI anomaly detection + growth stage susceptibility
            </p>
          </div>
          <button className="btn btn-primary" onClick={handleFetchWeather} disabled={fetching}>
            <CloudRain size={16} />
            {fetching ? 'Fetching weather...' : 'Update Weather Data'}
          </button>
          <button className="btn btn-secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 20 }}><AlertTriangle size={18} /> {error}</div>}

      {/* Summary Cards */}
      <div className="stats-grid">
        {['critical', 'high', 'moderate', 'low'].map(level => (
          <div className="stat-card" key={level}>
            <div className="stat-icon" style={{ background: LEVEL_COLORS[level] + '20', color: LEVEL_COLORS[level] }}>
              <Shield size={22} />
            </div>
            <div className="stat-info">
              <h4>{LEVEL_LABELS[level]}</h4>
              <div className="stat-value">{summary[level] || 0}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>farms</div>
            </div>
          </div>
        ))}
      </div>

      {/* Risk Chart */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><h3>Farm Risk Scores</h3></div>
        <div className="card-body">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" fontSize={11} angle={-20} textAnchor="end" height={60} />
                <YAxis domain={[0, 100]} fontSize={12} />
                <Tooltip formatter={(v) => [`${v}%`, 'Risk Score']} />
                <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={LEVEL_COLORS[entry.level]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state"><Shield size={40} /><h3>No alert data</h3></div>
          )}
        </div>
      </div>

      {/* Alert Cards */}
      <div className="card">
        <div className="card-header"><h3>Farm Alerts ({alerts.length})</h3></div>
        <div className="card-body">
          {alerts.map(a => (
            <div
              key={a.farm_id}
              style={{
                padding: 16,
                marginBottom: 12,
                borderRadius: 8,
                border: `1px solid ${LEVEL_COLORS[a.alert_level]}40`,
                background: `${LEVEL_COLORS[a.alert_level]}08`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <strong>{a.farm_name || `Farm ${a.farm_id}`}</strong>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                    {a.location} | {a.crop_type || 'unknown crop'}
                  </span>
                </div>
                <span className={`badge ${a.alert_level === 'low' ? 'healthy' : a.alert_level}`}>
                  {a.alert_level.toUpperCase()} — {a.combined_score}%
                </span>
              </div>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, marginBottom: 8 }}>
                {/* NDVI Anomaly */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: a.ndvi_anomaly?.detected ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                    NDVI: {a.ndvi_anomaly?.trend}
                  </span>
                  {a.ndvi_anomaly?.detected && (
                    <span style={{ color: 'var(--danger)', fontSize: 12 }}>
                      ({a.ndvi_anomaly.drop_pct}% drop)
                    </span>
                  )}
                </div>
                {/* Disease Risk */}
                <div>
                  Disease risk: <strong>{a.disease_risk?.overall_risk}%</strong>
                  <span style={{ fontSize: 12, marginLeft: 4, color: 'var(--text-secondary)' }}>
                    ({a.disease_risk?.primary_threat})
                  </span>
                </div>
                {/* Growth Stage */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Sprout size={14} />
                  {a.growth_stage?.stage}
                  {a.growth_stage?.days_after_planting != null && (
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      (day {a.growth_stage.days_after_planting})
                    </span>
                  )}
                </div>
                {/* Action Days */}
                {a.action_days_min && a.action_days_max && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 10px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    background: a.action_days_min <= 3 ? '#dc262620' : '#d9770620',
                    color: a.action_days_min <= 3 ? '#dc2626' : '#d97706',
                    border: `1px solid ${a.action_days_min <= 3 ? '#dc262640' : '#d9770640'}`,
                  }}>
                    <Clock size={12} />
                    Act within {a.action_days_min}-{a.action_days_max} days
                  </div>
                )}
              </div>

              {/* Recommendations */}
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {a.recommendations?.map((r, i) => (
                  <div key={i} style={{ marginBottom: 2 }}>→ {r}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

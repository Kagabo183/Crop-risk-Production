import { useState, useEffect } from 'react'
import { usePlatform } from '../context/PlatformContext'
import { AlertTriangle, Shield, CloudRain, Sprout, RefreshCw, Clock } from 'lucide-react'
import { getEarlyWarnings, fetchWeatherAll } from '../api'
import { useTitle } from '../context/TitleContext'

const LEVEL_COLORS = { critical: '#dc2626', high: '#ea580c', moderate: '#d97706', low: '#16a34a' }
const LEVEL_LABELS = { critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low' }

export default function EarlyWarning() {
  const { isWeb } = usePlatform()
  const { setTitle } = useTitle();
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

  useEffect(() => {
    setTitle('Alerts');
    load()
  }, [])

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
      <div className="card">
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Early Warning System</h3>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-secondary)' }}>
              Weather + NDVI anomaly + growth stage analysis
            </p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={handleFetchWeather} disabled={fetching}>
            <CloudRain size={14} />
            {fetching ? 'Fetching...' : 'Weather'}
          </button>
          <button className="btn btn-sm btn-secondary" onClick={load}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> {error}</div>}

      {/* Summary Cards */}
      <div className="stats-grid">
        {['critical', 'high', 'moderate', 'low'].map(level => (
          <div className="stat-card" key={level}>
            <div className="stat-icon" style={{ background: LEVEL_COLORS[level] + '20', color: LEVEL_COLORS[level] }}>
              <Shield size={16} />
            </div>
            <div className="stat-info">
              <h4>{LEVEL_LABELS[level]}</h4>
              <div className="stat-value">{summary[level] || 0}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Risk Chart */}
      <div className="card">
        <div className="card-header"><h3>Risk Scores</h3></div>
        <div className="card-body">
          {chartData.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {chartData.map((entry, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 1 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{entry.name}</span>
                    <span style={{ fontWeight: 600 }}>{entry.score}%</span>
                  </div>
                  <div className="confidence-bar" style={{ height: 6 }}>
                    <div className="confidence-fill" style={{
                      width: `${Math.min(entry.score, 100)}%`,
                      background: LEVEL_COLORS[entry.level] || '#6b7280',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '20px 12px' }}><Shield size={28} /><h3>No alert data</h3></div>
          )}
        </div>
      </div>

      {/* Alert Cards */}
      <div className="card">
        <div className="card-header"><h3>Alerts ({alerts.length})</h3></div>
        <div className="card-body">
          {alerts.map(a => (
            <div key={a.farm_id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 13 }}>{a.farm_name || `Farm ${a.farm_id}`}</strong>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 6 }}>{a.crop_type}</span>
                </div>
                <span className={`badge ${a.alert_level === 'low' ? 'healthy' : a.alert_level}`}>
                  {a.alert_level} {a.combined_score}%
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: a.ndvi_anomaly?.detected ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                  NDVI: {a.ndvi_anomaly?.trend}
                  {a.ndvi_anomaly?.detected && ` (-${a.ndvi_anomaly.drop_pct}%)`}
                </span>
                <span>Disease: <strong>{a.disease_risk?.overall_risk}%</strong> ({a.disease_risk?.primary_threat})</span>
                {a.growth_stage?.stage && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Sprout size={11} /> {a.growth_stage.stage}
                  </span>
                )}
                {a.action_days_min && a.action_days_max && (
                  <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: a.action_days_min <= 3 ? '#dc262618' : '#d9770618', color: a.action_days_min <= 3 ? '#dc2626' : '#d97706' }}>
                    <Clock size={10} style={{ verticalAlign: -1 }} /> {a.action_days_min}-{a.action_days_max}d
                  </span>
                )}
              </div>

              {a.recommendations?.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {a.recommendations.slice(0, 2).map((r, i) => <div key={i}>→ {r}</div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

import { useState, useEffect } from 'react'
import { usePlatform } from '../context/PlatformContext'
import { AlertTriangle, Shield, CloudRain, Sprout, RefreshCw, Clock, Info, Zap } from 'lucide-react'
import { getEarlyWarnings, fetchWeatherAll, refreshAllFarms } from '../api'
import { useFarmDataListener, emitFarmDataUpdated } from '../utils/farmEvents'

const LEVEL_COLORS = { critical: '#dc2626', high: '#ea580c', moderate: '#d97706', low: '#16a34a' }
const LEVEL_LABELS = { critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low' }

export default function EarlyWarning() {
  const { isWeb } = usePlatform()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState(null)
  const [showDataInfo, setShowDataInfo] = useState(false)
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true)
    getEarlyWarnings()
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.detail || 'Failed to load alerts'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  // Re-fetch when another page triggers a scan
  useFarmDataListener(load)

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

  const handleRefreshAll = async () => {
    setRefreshing(true)
    setRefreshResult(null)
    setError(null)
    try {
      const r = await refreshAllFarms(30)
      setRefreshResult(r.data)
      emitFarmDataUpdated(null)   // tell all open pages data is incoming
      setTimeout(load, 4000)     // reload alerts after tasks have a moment to start
    } catch (e) {
      setError(e.response?.data?.detail || 'Refresh failed — ensure farms have coordinates set.')
    }
    setRefreshing(false)
  }

  if (loading) return <div className="loading"><div className="spinner" /><p>Analyzing farm conditions...</p></div>

  const alerts = data?.alerts || []
  const summary = data?.summary || {}
  const insufficientCount = alerts.filter(a => a.ndvi_anomaly?.trend === 'insufficient_data').length

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
          <button className="btn btn-sm btn-secondary" onClick={() => setShowDataInfo(v => !v)} title="What do these scores mean?">
            <Info size={14} />
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleFetchWeather} disabled={fetching || refreshing}>
            <CloudRain size={14} />
            {fetching ? 'Fetching...' : 'Weather'}
          </button>
          <button
            className="btn btn-sm"
            onClick={handleRefreshAll}
            disabled={refreshing || fetching}
            style={{
              background: refreshing ? 'var(--border)' : '#16a34a',
              color: '#fff',
              display: 'flex', alignItems: 'center', gap: 4,
              border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer'
            }}
            title="Fetch satellite indices + weather for all farms at once"
          >
            {refreshing
              ? <><div className="spinner" style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%' }} /> Refreshing…</>
              : <><Zap size={14} /> Refresh All</>}
          </button>
          <button className="btn btn-sm btn-secondary" onClick={load}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Expandable info panel */}
      {showDataInfo && (
        <div className="card" style={{ border: '1px solid #fbbf24', background: '#fffbeb' }}>
          <div className="card-body" style={{ fontSize: 12, lineHeight: 1.7 }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13 }}>
              <Info size={13} style={{ color: '#d97706' }} /> Understanding risk scores &amp; data completeness
            </strong>
            <p style={{ margin: '0 0 6px' }}>
              <b>Risk % (0–100)</b> combines three signals: <em>NDVI trend</em> (vegetation decline from
              satellite), <em>weather-driven disease risk</em> (temperature + humidity + rainfall from
              Open-Meteo), and <em>crop growth-stage susceptibility.</em> Higher = more estimated risk — not
              a confirmed disease.
            </p>
            <p style={{ margin: '0 0 6px' }}>
              <b>Why do many farms show the same score?</b> Farms without a satellite scan yet have no NDVI
              data. Their score comes from weather + growth stage only, so identical-looking farms share
              similar weather conditions today.
            </p>
            <p style={{ margin: '0 0 6px' }}>
              <b>Why is weather sometimes missing or showing defaults?</b> Weather is fetched from
              Open-Meteo (free, no API key). If a farm shows placeholder values, no cached WeatherRecord
              existed for it — this happens when a farm was created without coordinates, or when old records
              had a missing farm_id. Click <b>Weather</b> or <b>Refresh All</b> to force a fresh fetch.
            </p>
            <p style={{ margin: 0 }}>
              <b>NDVI "insufficient_data"</b> means fewer than 3 scan observations exist. Run scans on
              at least 3 separate days to enable trend detection.
            </p>
          </div>
        </div>
      )}

      {/* Refresh result toast */}
      {refreshResult && (
        <div style={{
          padding: '8px 12px', borderRadius: 6, background: '#f0fdf4',
          border: '1px solid #86efac', fontSize: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8
        }}>
          <span>
            <b>✓ Refresh started —</b> {refreshResult.satellite_tasks_queued} satellite
            scan{refreshResult.satellite_tasks_queued !== 1 ? 's' : ''} queued,&nbsp;
            {refreshResult.weather_updated} farm{refreshResult.weather_updated !== 1 ? 's' : ''} got
            fresh weather data. Results update automatically when processing completes.
            {refreshResult.farms_without_coords?.length > 0 && (
              <span style={{ color: '#d97706', display: 'block', marginTop: 3 }}>
                ⚠ {refreshResult.farms_without_coords.length} farm(s) skipped — no
                coordinates: {refreshResult.farms_without_coords.map(f => f.name || `Farm ${f.farm_id}`).join(', ')}.
              </span>
            )}
          </span>
          <button onClick={() => setRefreshResult(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#666', lineHeight: 1 }}>✕</button>
        </div>
      )}

      {/* Stale-data warning strip */}
      {!refreshResult && insufficientCount > 0 && (
        <div style={{
          padding: '7px 12px', borderRadius: 6, background: '#fffbeb',
          border: '1px solid #fcd34d', fontSize: 11,
          display: 'flex', alignItems: 'center', gap: 8
        }}>
          <AlertTriangle size={13} style={{ color: '#d97706', flexShrink: 0 }} />
          <span>
            <b>{insufficientCount} farm{insufficientCount !== 1 ? 's' : ''}</b> show estimated scores only —
            no satellite scan data yet (NDVI: insufficient_data). Click&nbsp;
            <b style={{ color: '#16a34a', cursor: 'pointer' }} onClick={handleRefreshAll}>Refresh All</b>
            &nbsp;to fetch satellite indices and weather for every farm at once.
          </span>
        </div>
      )}

      {error && <div className="error-box" style={{ marginBottom: 10, fontSize: 12 }}><AlertTriangle size={14} /> {error}</div>}

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
                  {a.alert_level.charAt(0).toUpperCase() + a.alert_level.slice(1)} — {a.combined_score}%
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

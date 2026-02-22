import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { MapPin, ShieldAlert, Activity, Bug, Satellite, TrendingUp, AlertTriangle } from 'lucide-react'
import { getFarms, getFarmSatellite, getModelStatus, getEarlyWarnings } from '../api'
import { useAuth } from '../context/AuthContext'

const RISK_COLORS = { low: '#16a34a', moderate: '#d97706', high: '#dc2626', severe: '#7c2d12' }

export default function Dashboard() {
  const { user, hasRole } = useAuth()
  const [farms, setFarms] = useState([])
  const [satellite, setSatellite] = useState([])
  const [models, setModels] = useState(null)
  const [warnings, setWarnings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.allSettled([
      getFarms(),
      getFarmSatellite(),
      getModelStatus(),
      getEarlyWarnings(),
    ]).then(([farmsRes, satRes, modelsRes, warnRes]) => {
      if (farmsRes.status === 'fulfilled') setFarms(farmsRes.value.data)
      if (satRes.status === 'fulfilled') setSatellite(satRes.value.data)
      if (modelsRes.status === 'fulfilled') setModels(modelsRes.value.data)
      if (warnRes.status === 'fulfilled') setWarnings(warnRes.value.data)
      setLoading(false)
    }).catch(e => {
      setError(e.message)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="loading"><div className="spinner" /><p>Loading dashboard...</p></div>
  if (error) return <div className="error-box">{error}</div>

  // Compute stats
  const totalFarms = farms.length
  const satWithNdvi = satellite.filter(f => f.ndvi != null)
  const avgNdvi = satWithNdvi.length
    ? (satWithNdvi.reduce((s, f) => s + f.ndvi, 0) / satWithNdvi.length).toFixed(3)
    : '—'

  const healthyCounts = { healthy: 0, moderate: 0, stressed: 0, noData: 0 }
  satellite.forEach(f => {
    if (f.ndvi == null) { healthyCounts.noData++; return }
    if (f.ndvi >= 0.6) healthyCounts.healthy++
    else if (f.ndvi >= 0.4) healthyCounts.moderate++
    else healthyCounts.stressed++
  })

  const pieData = hasRole('agronomist', 'admin')
    ? [
      { name: 'Healthy', value: healthyCounts.healthy, color: '#16a34a' },
      { name: 'Moderate', value: healthyCounts.moderate, color: '#d97706' },
      { name: 'Stressed', value: healthyCounts.stressed, color: '#dc2626' },
    ].filter(d => d.value > 0)
    : [
      { name: 'Doing Well', value: healthyCounts.healthy, color: '#16a34a' },
      { name: 'Watch Closely', value: healthyCounts.moderate, color: '#d97706' },
      { name: 'Needs Care', value: healthyCounts.stressed, color: '#dc2626' },
    ].filter(d => d.value > 0)

  const ndviChart = satellite
    .filter(f => f.ndvi != null)
    .sort((a, b) => (b.ndvi || 0) - (a.ndvi || 0))
    .slice(0, 10)
    .map(f => ({ name: f.name?.substring(0, 15) || `Farm ${f.id}`, ndvi: +(f.ndvi || 0).toFixed(3) }))

  const modelCount = models?.models ? Object.keys(models.models).length : 0
  const modelsReady = models?.models
    ? Object.values(models.models).filter(m => m.loaded || m.status === 'ready').length
    : 0

  return (
    <>
      {/* Stats Row */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><MapPin size={18} /></div>
          <div className="stat-info">
            <h4>{hasRole('admin') ? 'Total Farms' : hasRole('agronomist') ? 'District Farms' : 'My Farms'}</h4>
            <div className="stat-value">{totalFarms}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Satellite size={18} /></div>
          <div className="stat-info">
            <h4>{hasRole('agronomist', 'admin') ? 'Avg NDVI' : 'Crop Health'}</h4>
            <div className="stat-value">{avgNdvi}</div>
            <div className={`stat-change ${Number(avgNdvi) >= 0.5 ? 'positive' : 'negative'}`}>
              {Number(avgNdvi) >= 0.5 ? 'Healthy' : 'Below healthy'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><Activity size={18} /></div>
          <div className="stat-info">
            <h4>Stressed</h4>
            <div className="stat-value">{healthyCounts.stressed}</div>
            <div className="stat-change negative">Need attention</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan"><Bug size={18} /></div>
          <div className="stat-info">
            <h4>ML Models</h4>
            <div className="stat-value">{modelsReady}/{modelCount}</div>
            <div className="stat-change positive">Ready</div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid-2">
        {/* NDVI Bar Chart */}
        <div className="card">
          <div className="card-header">
            <h3>{hasRole('agronomist', 'admin') ? 'NDVI Health' : 'Farm Health'}</h3>
            <Link to="/satellite" className="btn btn-sm btn-secondary">Details</Link>
          </div>
          <div className="card-body">
            {ndviChart.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ndviChart.map((entry, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 1 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{entry.name}</span>
                      <span style={{ fontWeight: 600 }}>{entry.ndvi.toFixed(3)}</span>
                    </div>
                    <div className="confidence-bar" style={{ height: 6 }}>
                      <div className="confidence-fill" style={{
                        width: `${Math.min(Math.max(entry.ndvi, 0), 1) * 100}%`,
                        background: entry.ndvi >= 0.6 ? '#16a34a' : entry.ndvi >= 0.4 ? '#d97706' : '#dc2626',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '20px 12px' }}>
                <Satellite size={28} />
                <h3>No satellite data</h3>
              </div>
            )}
          </div>
        </div>

        {/* Health Pie Chart */}
        <div className="card">
          <div className="card-header">
            <h3>Health Distribution</h3>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={4}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {pieData.map(d => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />
                      <span style={{ fontSize: 11 }}>{d.name}: <strong>{d.value}</strong></span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state" style={{ padding: '20px 12px' }}>
                <Activity size={28} />
                <h3>No health data</h3>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Farm List (mobile-friendly cards instead of wide table) */}
      <div className="card">
        <div className="card-header">
          <h3>Farm Overview</h3>
          <Link to="/farms" className="btn btn-sm btn-primary">Manage</Link>
        </div>
        <div className="card-body">
          {farms.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {farms.map(farm => {
                const sat = satellite.find(s => s.id === farm.id)
                const ndvi = sat?.ndvi
                const compositeHealth = (() => {
                  if (ndvi == null) return null
                  const scaleValue = (val, low, high) => val == null ? null : Math.max(0, Math.min(100, ((val - low) / (high - low)) * 100))
                  const scores = { ndvi: [scaleValue(ndvi, 0.15, 0.70), 0.30], ndwi: [scaleValue(sat?.ndwi, -0.30, 0.05), 0.25], ndre: [scaleValue(sat?.ndre, 0.05, 0.35), 0.20], evi: [scaleValue(sat?.evi, 0.10, 0.50), 0.15], savi: [scaleValue(sat?.savi, 0.10, 0.55), 0.10] }
                  let tw = 0, ws = 0
                  Object.values(scores).forEach(([s, w]) => { if (s != null) { ws += s * w; tw += w } })
                  return tw > 0 ? ws / tw : null
                })()
                const status = compositeHealth == null ? 'unknown' : compositeHealth >= 75 ? 'healthy' : compositeHealth >= 40 ? 'moderate' : 'stressed'

                return (
                  <div key={farm.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{farm.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {farm.crop_type || '—'} · {farm.size_hectares || farm.area || '—'} ha
                      </div>
                    </div>
                    {ndvi != null && <span style={{ fontSize: 12, fontWeight: 600, color: ndvi >= 0.6 ? 'var(--success)' : ndvi >= 0.4 ? 'var(--warning)' : 'var(--danger)' }}>{ndvi.toFixed(2)}</span>}
                    <span className={`badge ${status}`}>
                      {status === 'unknown' ? 'No data' : status === 'healthy' ? 'Good' : status === 'moderate' ? 'Watch' : 'Alert'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '24px 12px' }}>
              <MapPin size={32} />
              <h3>No farms found</h3>
              <p>{hasRole('agronomist') ? `No farms in ${user?.district} yet.` : "Register your first farm to get started."}</p>
              {hasRole('farmer') && <Link to="/farms" className="btn btn-primary" style={{ marginTop: 8 }}>Add Farm</Link>}
            </div>
          )}
        </div>
      </div>

      {/* Early Warning Alerts */}
      {warnings && warnings.alerts && warnings.alerts.filter(a => a.alert_level !== 'low').length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3><AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 4, color: 'var(--warning)' }} />Warnings</h3>
            <Link to="/early-warning" className="btn btn-sm btn-secondary">View All</Link>
          </div>
          <div className="card-body">
            {warnings.alerts.filter(a => a.alert_level !== 'low').slice(0, 4).map(a => (
              <div key={a.farm_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span className={`badge ${a.alert_level === 'critical' ? 'high' : a.alert_level}`} style={{ minWidth: 55, textAlign: 'center', fontSize: 9 }}>
                  {a.alert_level}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 12 }}>{a.farm_name}</strong>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{a.combined_score}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="stats-grid">
        <Link to="/disease-classifier" style={{ textDecoration: 'none' }}>
          <div className="stat-card" style={{ cursor: 'pointer' }}>
            <div className="stat-icon red"><Bug size={18} /></div>
            <div className="stat-info">
              <h4>Scan Disease</h4>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Upload leaf image</div>
            </div>
          </div>
        </Link>
        <Link to="/risk-assessment" style={{ textDecoration: 'none' }}>
          <div className="stat-card" style={{ cursor: 'pointer' }}>
            <div className="stat-icon orange"><ShieldAlert size={18} /></div>
            <div className="stat-info">
              <h4>Risk Assessment</h4>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>ML-powered analysis</div>
            </div>
          </div>
        </Link>
        <Link to="/stress-monitoring" style={{ textDecoration: 'none' }}>
          <div className="stat-card" style={{ cursor: 'pointer' }}>
            <div className="stat-icon green"><Activity size={18} /></div>
            <div className="stat-info">
              <h4>Stress Monitor</h4>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Drought, heat, water</div>
            </div>
          </div>
        </Link>
        <Link to="/disease-forecasts" style={{ textDecoration: 'none' }}>
          <div className="stat-card" style={{ cursor: 'pointer' }}>
            <div className="stat-icon cyan"><TrendingUp size={18} /></div>
            <div className="stat-info">
              <h4>Forecasts</h4>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>7-day disease risk</div>
            </div>
          </div>
        </Link>
      </div>
    </>
  )
}

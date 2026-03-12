import { useState, useEffect } from 'react'
import { calculateHealthScore } from '../utils/healthScore'
import { Link } from 'react-router-dom'
import {
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { MapPin, Activity, Bug, Satellite, AlertTriangle, Leaf, ShieldAlert } from 'lucide-react'
import { getFarms, getFarmSatellite, getModelStatus, getEarlyWarnings } from '../api'
import { useAuth } from '../context/AuthContext'
import { usePlatform } from '../context/PlatformContext'
import { useTitle } from '../context/TitleContext'

export default function Dashboard() {
  const { isWeb } = usePlatform()
  const { user, hasRole } = useAuth()
  const { setTitle } = useTitle();
  const isFarmer = hasRole('farmer') && !hasRole('admin', 'agronomist')
  const [farms, setFarms] = useState([])
  const [satellite, setSatellite] = useState([])
  const [models, setModels] = useState(null)
  const [warnings, setWarnings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setTitle('Dashboard');
    Promise.allSettled([
      getFarms(),
      getFarmSatellite(),
      ...(!isFarmer ? [getModelStatus()] : []),
      getEarlyWarnings(),
    ]).then(results => {
      let idx = 0
      if (results[idx]?.status === 'fulfilled') setFarms(results[idx].value.data); idx++
      if (results[idx]?.status === 'fulfilled') setSatellite(results[idx].value.data); idx++
      if (!isFarmer && results[idx]?.status === 'fulfilled') setModels(results[idx].value.data); idx++
      if (results[idx]?.status === 'fulfilled') setWarnings(results[idx].value.data)
      setLoading(false)
    }).catch(e => {
      setError(e.message)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="loading"><div className="spinner" /><p>Loading...</p></div>
  if (error) return <div className="error-box">{error}</div>

  // Compute stats
  const totalFarms = farms.length
  const satWithNdvi = satellite.filter(f => f.ndvi != null)
  const avgNdvi = satWithNdvi.length
    ? satWithNdvi.reduce((s, f) => s + f.ndvi, 0) / satWithNdvi.length
    : null

  const healthyCounts = { healthy: 0, moderate: 0, stressed: 0, noData: 0 }
  satellite.forEach(f => {
    const { status } = calculateHealthScore(f)
    if (status === 'unknown') healthyCounts.noData++
    else if (status === 'healthy') healthyCounts.healthy++
    else if (status === 'moderate') healthyCounts.moderate++
    else healthyCounts.stressed++
  })

  // ── Farmer-friendly Dashboard ──
  if (isFarmer) {
    return (
      <div className="dashboard-farmer-view fade-in">
        {/* Welcome Section */}
        <section className="welcome-banner">
          <div className="welcome-content">
            <h2 className="welcome-title">
              Hello, <span>{user?.full_name?.split(' ')[0] || 'Farmer'}</span>
            </h2>
            <p className="welcome-subtitle">
              Your field health overview for today
            </p>
          </div>
          <div className="welcome-weather-mini">
             {/* Weather could be added here later */}
          </div>
        </section>

        {/* Primary Health Pulse */}
        <div className="health-pulse-container">
           <div className={`health-pulse-card ${avgNdvi >= 0.5 ? 'healthy' : 'warning-state'}`}>
              <div className="health-pulse-icon">
                 <Activity size={24} />
              </div>
              <div className="health-pulse-info">
                 <span className="health-pulse-label">Overall Field Health</span>
                 <div className="health-pulse-value">
                    {avgNdvi != null ? `${Math.round(avgNdvi * 100)}%` : '—'}
                    <span className="health-pulse-status">
                       {avgNdvi >= 0.6 ? 'Optimal' : avgNdvi >= 0.4 ? 'Monitor' : 'Critical'}
                    </span>
                 </div>
              </div>
              <div className="health-pulse-action">
                 <Link to="/stress-monitoring" className="btn-icon">
                    <Activity size={20} />
                 </Link>
              </div>
           </div>
        </div>

        {/* Main Content Grid */}
        <div className={isWeb ? 'grid-2' : ''} style={{ gap: isWeb ? 24 : 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Quick Stats Grid */}
            <div className="stats-grid" style={{ marginBottom: 0, gap: 12 }}>
              <div className="stat-card premium">
                <div className="stat-icon blue"><MapPin size={18} /></div>
                <div className="stat-info">
                  <h4>Managed Farms</h4>
                  <div className="stat-value" style={{ fontSize: 18 }}>{totalFarms}</div>
                </div>
              </div>
              
              <div className="stat-card premium">
                <div className="stat-icon orange"><AlertTriangle size={18} /></div>
                <div className="stat-info">
                  <h4>At Risk</h4>
                  <div className="stat-value" style={{ fontSize: 18 }}>{healthyCounts.stressed}</div>
                </div>
              </div>
            </div>

            {/* Urgent Warnings */}
            {warnings?.alerts?.filter(a => a.alert_level !== 'low').length > 0 && (
              <div className="card glass-card warning-accent">
                <div className="card-header no-border">
                  <div className="header-with-icon">
                    <ShieldAlert size={18} className="text-warning" />
                    <h3>Active Farm Alerts</h3>
                  </div>
                  <Link to="/early-warning" className="text-link">View Details</Link>
                </div>
                <div className="card-body pt-0">
                  <div className="alert-list">
                    {warnings.alerts.filter(a => a.alert_level !== 'low').slice(0, 3).map(a => (
                      <div key={a.farm_id} className="alert-item-compact">
                        <div className={`severity-indicator ${a.alert_level}`} />
                        <span className="farm-name-text">{a.farm_name}</span>
                        <span className="alert-chip">
                          {a.alert_level === 'critical' ? '🔴 Crisis' : '🟠 High'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Action Launchers */}
            <div className="section-container">
              <h4 className="section-label">Quick Actions</h4>
              <div className="quick-actions-row">
                <Link to="/disease-classifier" className="action-tile-mini">
                   <div className="action-tile-icon red"><Bug size={20} /></div>
                   <span>Scan Crops</span>
                </Link>
                <Link to="/farms" className="action-tile-mini">
                   <div className="action-tile-icon blue"><MapPin size={20} /></div>
                   <span>Manage Fields</span>
                </Link>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 className="section-label" style={{ marginBottom: -4 }}>Farms Overview</h4>
            {/* My Farms List */}
            <div className="card glass-card" style={{ height: '100%', marginBottom: 0 }}>
              <div className="card-header">
                <h3>My Production Units</h3>
                <Link to="/farms" className="text-link">Full List</Link>
              </div>
              <div className="card-body p-0">
                {farms.length === 0 ? (
                  <div className="empty-state-compact">
                    <div className="empty-icon"><MapPin size={32} /></div>
                    <p>No production units found</p>
                    <Link to="/farms" className="btn btn-primary btn-sm">Add First Farm</Link>
                  </div>
                ) : (
                  <div className="premium-farm-list">
                    {farms.slice(0, 5).map(farm => {
                      const sat = satellite.find(s => s.id === farm.id)
                      const { status } = calculateHealthScore(sat)
                      return (
                        <Link key={farm.id} to={`/farms?id=${farm.id}`} className="premium-list-item">
                          <div className="item-leading">
                             <div className={`status-pill ${status}`} />
                          </div>
                          <div className="item-content">
                            <div className="item-title">{farm.name}</div>
                            <div className="item-subtitle">
                              {farm.crop_type} • {farm.size_hectares || farm.area || '—'} ha
                            </div>
                          </div>
                          <div className="item-trailing">
                            {sat?.ndvi != null ? (
                              <div className="health-score">
                                 <span className="value">{Math.round(sat.ndvi * 100)}</span>
                                 <span className="unit">%</span>
                              </div>
                            ) : (
                               <div className="no-data-tag">No Data</div>
                            )}
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Agronomist / Admin Dashboard (full technical view) ──
  const pieData = [
    { name: 'Healthy', value: healthyCounts.healthy, color: '#16a34a' },
    { name: 'Moderate', value: healthyCounts.moderate, color: '#d97706' },
    { name: 'Stressed', value: healthyCounts.stressed, color: '#dc2626' },
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
            <h4>{hasRole('admin') ? 'Total Farms' : 'District Farms'}</h4>
            <div className="stat-value">{totalFarms}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Satellite size={18} /></div>
          <div className="stat-info">
            <h4>Avg NDVI</h4>
            <div className="stat-value">{avgNdvi != null ? avgNdvi.toFixed(3) : '—'}</div>
            {avgNdvi != null && (
              <div className={`stat-change ${avgNdvi >= 0.5 ? 'positive' : 'negative'}`}>
                {avgNdvi >= 0.5 ? 'Healthy' : 'Below healthy'}
              </div>
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><Activity size={18} /></div>
          <div className="stat-info">
            <h4>Stressed</h4>
            <div className="stat-value">{healthyCounts.stressed}</div>
            <div className={`stat-change ${healthyCounts.stressed > 0 ? 'negative' : 'positive'}`}>
              {healthyCounts.stressed > 0 ? 'Need attention' : 'All clear'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan"><Bug size={18} /></div>
          <div className="stat-info">
            <h4>ML Models</h4>
            <div className="stat-value">{modelsReady}/{modelCount}</div>
            <div className="stat-change positive">Engine Ready</div>
          </div>
        </div>
      </div>

      {isWeb && (
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          <Link to="/disease-classifier" className="stat-card" style={{ textDecoration: 'none' }}>
            <div className="stat-icon red"><Bug size={18} /></div>
            <div className="stat-info">
              <h4>Analyze Samples</h4>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Identify crop diseases via AI</div>
            </div>
          </Link>
          <Link to="/early-warning" className="stat-card" style={{ textDecoration: 'none' }}>
            <div className="stat-icon orange"><AlertTriangle size={18} /></div>
            <div className="stat-info">
              <h4>Regional Alerts</h4>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Monitor outbreak hotspots</div>
            </div>
          </Link>
          <Link to="/satellite" className="stat-card" style={{ textDecoration: 'none' }}>
            <div className="stat-icon green"><Satellite size={18} /></div>
            <div className="stat-info">
              <h4>Satellite Sync</h4>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Refresh farm health indices</div>
            </div>
          </Link>
          <Link to="/risk-assessment" className="stat-card" style={{ textDecoration: 'none' }}>
            <div className="stat-icon blue"><Activity size={18} /></div>
            <div className="stat-info">
              <h4>Risk Summary</h4>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>View agronomist reports</div>
            </div>
          </Link>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid-2">
        {/* NDVI Bar Chart */}
        <div className="card">
          <div className="card-header">
            <h3>NDVI Health</h3>
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

      {/* Farm List */}
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
                const { status } = calculateHealthScore(sat)

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
            </div>
          )}
        </div>
      </div>

      {/* Early Warning Alerts */}
      {warnings?.alerts?.filter(a => a.alert_level !== 'low').length > 0 && (
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
    </>
  )
}

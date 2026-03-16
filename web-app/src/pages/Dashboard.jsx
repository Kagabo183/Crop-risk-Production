import { useState, useEffect } from 'react'
import { calculateHealthScore } from '../utils/healthScore'
import { Link } from 'react-router-dom'
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import {
  MapPin, Activity, Bug, Satellite, AlertTriangle, Leaf, ShieldAlert,
  Clock, Plus, Map, Layers, ChevronRight, Sprout, RefreshCw, TrendingUp,
} from 'lucide-react'
import { getFarms, getFarmSatellite, getModelStatus, getEarlyWarnings } from '../api'
import { useAuth } from '../context/AuthContext'
import { usePlatform } from '../context/PlatformContext'
import VegetationTimeline from '../components/VegetationTimeline'

/* â”€â”€ Helpers â”€â”€ */
function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good Morning'
  if (h < 17) return 'Good Afternoon'
  return 'Good Evening'
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  const diffH = Math.floor((now - d) / 3600000)
  const diffD = Math.floor((now - d) / 86400000)
  if (diffH < 1)  return 'Just now'
  if (diffH < 24) return `${diffH}h ago`
  if (diffD < 7)  return `${diffD}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* â”€â”€ Skeleton loader â”€â”€ */
function Skel({ w = '100%', h = 16, r = 6 }) {
  return <div className="db-skeleton" style={{ width: w, height: h, borderRadius: r }} />
}

/* â”€â”€ Circular health gauge â”€â”€ */
function HealthGauge({ score, size = 52 }) {
  if (score == null) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--border-mid)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>N/A</div>
    )
  }
  const pct   = Math.min(Math.max(score, 0), 100)
  const color = score >= 70 ? '#16a34a' : score >= 40 ? '#d97706' : '#dc2626'
  const r     = (size / 2) - 5
  const circ  = 2 * Math.PI * r
  const dash  = (pct / 100) * circ
  return (
    <div className="db-gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)', position: 'absolute', top: 0, left: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
      </svg>
      <span className="db-gauge-label" style={{ color }}>{Math.round(score)}</span>
    </div>
  )
}

export default function Dashboard() {
  const { isWeb } = usePlatform()
  const { user, hasRole } = useAuth()
  const isFarmer = hasRole('farmer') && !hasRole('admin', 'agronomist')
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

  if (loading) return (
    <div className="db-page fade-in">
      <div className="db-hero db-hero--skeleton">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skel w={180} h={14} /><Skel w={280} h={30} /><Skel w={220} h={13} />
        </div>
        <div className="db-hero-metrics">
          {[1,2,3,4].map(i => <Skel key={i} w={90} h={52} r={12} />)}
        </div>
      </div>
      <div className="db-kpi-row">
        {[1,2,3,4,5].map(i => <Skel key={i} h={96} r={12} />)}
      </div>
      <div className="db-main-grid">
        <Skel h={340} r={14} /><Skel h={340} r={14} />
      </div>
    </div>
  )
  if (error) return <div className="error-box">{error}</div>

  /* â”€â”€ Computed stats â”€â”€ */
  const totalFarms     = farms.length
  const satWithData    = satellite.filter(s => s.health_score != null || s.ndvi != null)
  const healthScores   = satWithData.map(s => calculateHealthScore(s).score).filter(sc => sc != null)
  const avgHealthScore = healthScores.length
    ? Math.round(healthScores.reduce((a, b) => a + b, 0) / healthScores.length) : null
  const healthyCounts  = { healthy: 0, moderate: 0, stressed: 0, noData: 0 }
  satellite.forEach(f => {
    const { status } = calculateHealthScore(f)
    if      (status === 'unknown')  healthyCounts.noData++
    else if (status === 'healthy')  healthyCounts.healthy++
    else if (status === 'moderate') healthyCounts.moderate++
    else                            healthyCounts.stressed++
  })
  const lastSatDate  = satellite.map(s => s.ndvi_date || null).filter(Boolean).sort().pop() || null
  const activeAlerts = (warnings?.alerts || []).filter(a => a.alert_level !== 'low')
  const featuredFarm = farms[0]
  const featuredSat  = featuredFarm ? satellite.find(s => s.id === featuredFarm.id) : null
  const featuredHealth = featuredSat ? calculateHealthScore(featuredSat) : { score: null, status: 'unknown', label: 'No data' }
  /* admin/agronomist extras */
  const modelCount   = models?.models ? Object.keys(models.models).length : 0
  const modelsReady  = models?.models
    ? Object.values(models.models).filter(m => m.loaded || m.status === 'ready').length : 0
  const ndviRanking  = satellite
    .filter(f => f.ndvi != null)
    .sort((a, b) => (b.ndvi || 0) - (a.ndvi || 0))
    .slice(0, 8)
    .map(f => ({ name: f.name?.substring(0, 16) || `Farm ${f.id}`, ndvi: +(f.ndvi||0).toFixed(3) }))
  const pieData = [
    { name: 'Healthy',  value: healthyCounts.healthy,  color: '#16a34a' },
    { name: 'Moderate', value: healthyCounts.moderate, color: '#d97706' },
    { name: 'Stressed', value: healthyCounts.stressed, color: '#dc2626' },
  ].filter(d => d.value > 0)


  /* â•â• Shared header â•â• */
  const firstName = user?.full_name?.split(' ')[0] || user?.username || 'there'

  return (
    <div className="db-page fade-in">

      {/* â”€â”€ Hero Header â”€â”€ */}
      <div className="db-hero">
        <div className="db-hero-left">
          <p className="db-greeting">{getGreeting()}, <strong>{firstName}</strong></p>
          <h1 className="db-hero-title">Agricultural Intelligence Dashboard</h1>
          <p className="db-hero-sub">
            {totalFarms} farm{totalFarms !== 1 ? 's' : ''} monitored
            {lastSatDate && <> · Last satellite update <strong>{formatRelativeDate(lastSatDate)}</strong></>}
            {activeAlerts.length > 0 && (
              <span className="db-hero-alert-badge">
                <AlertTriangle size={12} /> {activeAlerts.length} alert{activeAlerts.length > 1 ? 's' : ''} active
              </span>
            )}
          </p>
        </div>
        <div className="db-hero-metrics">
          <div className="db-hero-metric">
            <span className="db-hero-metric-val">{totalFarms}</span>
            <span className="db-hero-metric-lbl">Farms</span>
          </div>
          <div className="db-hero-metric">
            <span className="db-hero-metric-val" style={{ color: avgHealthScore >= 70 ? '#16a34a' : avgHealthScore >= 40 ? '#d97706' : avgHealthScore != null ? '#dc2626' : undefined }}>
              {avgHealthScore != null ? avgHealthScore : '—'}
            </span>
            <span className="db-hero-metric-lbl">Avg Health</span>
          </div>
          <div className="db-hero-metric">
            <span className="db-hero-metric-val" style={{ color: healthyCounts.stressed > 0 ? '#dc2626' : '#16a34a' }}>
              {healthyCounts.stressed}
            </span>
            <span className="db-hero-metric-lbl">At Risk</span>
          </div>
          <div className="db-hero-metric">
            <span className="db-hero-metric-val" style={{ fontSize: 14, fontWeight: 600 }}>
              {lastSatDate ? formatRelativeDate(lastSatDate) : '—'}
            </span>
            <span className="db-hero-metric-lbl">Last Satellite</span>
          </div>
        </div>
      </div>

      {/* â”€â”€ KPI Card Row â”€â”€ */}
      <div className="db-kpi-row">
        <div className="db-kpi-card db-kpi-green">
          <div className="db-kpi-icon"><Sprout size={20} /></div>
          <div>
            <div className="db-kpi-value">{totalFarms}</div>
            <div className="db-kpi-label">Total Farms</div>
          </div>
        </div>
        <div className="db-kpi-card db-kpi-blue">
          <div className="db-kpi-icon"><Satellite size={20} /></div>
          <div>
            <div className="db-kpi-value">{satWithData.length}</div>
            <div className="db-kpi-label">Fields Monitored</div>
          </div>
        </div>
        <div className="db-kpi-card" style={{ '--kpi-accent': avgHealthScore >= 70 ? '#16a34a' : avgHealthScore >= 40 ? '#d97706' : '#dc2626' }}>
          <div className="db-kpi-icon" style={{ background: 'color-mix(in srgb, var(--kpi-accent) 12%, transparent)', color: 'var(--kpi-accent)' }}>
            <Activity size={20} />
          </div>
          <div>
            <div className="db-kpi-value" style={{ color: 'var(--kpi-accent)' }}>{avgHealthScore != null ? avgHealthScore : '—'}</div>
            <div className="db-kpi-label">Avg Health Score</div>
          </div>
        </div>
        <div className="db-kpi-card db-kpi-red">
          <div className="db-kpi-icon"><AlertTriangle size={20} /></div>
          <div>
            <div className="db-kpi-value">{healthyCounts.stressed}</div>
            <div className="db-kpi-label">Fields At Risk</div>
          </div>
        </div>
        {!isFarmer && (
          <div className="db-kpi-card db-kpi-purple">
            <div className="db-kpi-icon"><Layers size={20} /></div>
            <div>
              <div className="db-kpi-value">{modelsReady}<span style={{ fontSize: 13, color: 'var(--text-muted)' }}>/{modelCount}</span></div>
              <div className="db-kpi-label">ML Models Active</div>
            </div>
          </div>
        )}
      </div>

      {/* â”€â”€ Main Grid: Left (wide) + Right (narrow) â”€â”€ */}
      <div className="db-main-grid">

        {/* LEFT COLUMN */}
        <div className="db-col-main">

          {/* Production Units */}
          <div className="db-card">
            <div className="db-card-header">
              <div className="db-card-header-left">
                <MapPin size={16} className="db-card-header-icon" />
                <h3>Production Units</h3>
              </div>
              <Link to="/farms" className="btn btn-sm btn-secondary">View All</Link>
            </div>
            <div className="db-farm-list">
              {farms.length === 0 ? (
                <div className="empty-state" style={{ padding: '32px 24px' }}>
                  <MapPin size={32} />
                  <h3>No farms yet</h3>
                  <p>Register your first farm to get started</p>
                  <Link to="/farms" className="btn btn-primary btn-sm">Add Farm</Link>
                </div>
              ) : farms.slice(0, 6).map(farm => {
                const sat = satellite.find(s => s.id === farm.id)
                const { score, status, label } = calculateHealthScore(sat)
                const syncDate = sat?.ndvi_date || farm.last_satellite_date || null
                const cropLabel = farm.detected_crop
                  ? `${farm.detected_crop.charAt(0).toUpperCase() + farm.detected_crop.slice(1)} (AI)`
                  : farm.crop_type || '—'
                return (
                  <div key={farm.id} className="db-farm-row">
                    <HealthGauge score={score} size={48} />
                    <div className="db-farm-info">
                      <div className="db-farm-name">{farm.name}</div>
                      <div className="db-farm-meta">
                        <span className="db-crop-tag">{cropLabel}</span>
                        <span className="db-meta-dot" />
                        <span>{farm.size_hectares || farm.area || '—'} ha</span>
                        {syncDate && <><span className="db-meta-dot" /><Clock size={11} /><span>{formatRelativeDate(syncDate)}</span></>}
                      </div>
                    </div>
                    <div className="db-farm-status">
                      <span className={`db-health-badge db-health-badge--${status}`}>{label}</span>
                      {score != null && <span className="db-health-num">{Math.round(score)}</span>}
                    </div>
                    <div className="db-farm-actions">
                      <Link to={`/satellite-dashboard?farm=${farm.id}`} className="db-action-btn" title="Satellite Map"><Map size={14} /></Link>
                      <Link to={`/farms?id=${farm.id}`} className="db-action-btn" title="Farm Details"><ChevronRight size={14} /></Link>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Vegetation Timeline */}
          {farms.length > 0 && (
            <div className="db-card">
              <div className="db-card-header">
                <div className="db-card-header-left">
                  <TrendingUp size={16} className="db-card-header-icon" />
                  <h3>Vegetation Timeline</h3>
                  <span className="db-card-subtitle">NDVI · NDRE · EVI · Last 90 days</span>
                </div>
                <Link to="/satellite" className="btn btn-sm btn-secondary">Details</Link>
              </div>
              <div style={{ padding: '4px 22px 20px' }}>
                <VegetationTimeline
                  farmId={farms[0].id}
                  daysBack={90}
                  height={180}
                  compact
                  cropInfo={{
                    crop: farms[0].detected_crop || farms[0].crop_type,
                    growthStage: farms[0].detected_growth_stage,
                  }}
                />
              </div>
            </div>
          )}

          {/* NDVI Ranking (admin/agronomist) */}
          {!isFarmer && ndviRanking.length > 0 && (
            <div className="db-card">
              <div className="db-card-header">
                <div className="db-card-header-left">
                  <Activity size={16} className="db-card-header-icon" />
                  <h3>NDVI Field Ranking</h3>
                </div>
                <Link to="/satellite" className="btn btn-sm btn-secondary">Satellite Data</Link>
              </div>
              <div className="db-card-body">
                {ndviRanking.map((entry, i) => (
                  <div key={i} className="db-bar-row">
                    <span className="db-bar-label">{entry.name}</span>
                    <div className="db-bar-track">
                      <div className="db-bar-fill" style={{
                        width: `${Math.min(Math.max(entry.ndvi, 0), 1) * 100}%`,
                        background: entry.ndvi >= 0.6 ? '#16a34a' : entry.ndvi >= 0.4 ? '#d97706' : '#dc2626',
                      }} />
                    </div>
                    <span className="db-bar-val"
                      style={{ color: entry.ndvi >= 0.6 ? '#16a34a' : entry.ndvi >= 0.4 ? '#d97706' : '#dc2626' }}>
                      {entry.ndvi.toFixed(3)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="db-col-side">

          {/* Satellite Intelligence Summary */}
          <div className="db-card">
            <div className="db-card-header">
              <div className="db-card-header-left">
                <Satellite size={16} className="db-card-header-icon" />
                <h3>Satellite Intelligence</h3>
              </div>
            </div>
            <div className="db-sat-summary">
              {featuredSat ? (
                <>
                  <div className="db-sat-row">
                    <span className="db-sat-lbl">Latest NDVI</span>
                    <span className="db-sat-val" style={{ color: (featuredSat.ndvi||0) >= 0.5 ? '#16a34a' : '#d97706' }}>
                      {featuredSat.ndvi != null ? featuredSat.ndvi.toFixed(3) : '—'}
                    </span>
                  </div>
                  <div className="db-sat-row">
                    <span className="db-sat-lbl">NDRE (Nutrient)</span>
                    <span className="db-sat-val">{featuredSat.ndre != null ? featuredSat.ndre.toFixed(3) : '—'}</span>
                  </div>
                  <div className="db-sat-row">
                    <span className="db-sat-lbl">EVI</span>
                    <span className="db-sat-val">{featuredSat.evi != null ? featuredSat.evi.toFixed(3) : '—'}</span>
                  </div>
                  <div className="db-sat-row">
                    <span className="db-sat-lbl">NDWI (Water)</span>
                    <span className="db-sat-val">{featuredSat.ndwi != null ? featuredSat.ndwi.toFixed(3) : '—'}</span>
                  </div>
                  <div className="db-sat-row">
                    <span className="db-sat-lbl">Stress Level</span>
                    <span className={`db-health-badge db-health-badge--${featuredSat.stress_level === 'none' ? 'healthy' : featuredSat.stress_level === 'moderate' ? 'moderate' : 'stressed'}`}
                          style={{ fontSize: 11 }}>
                      {featuredSat.stress_level || '—'}
                    </span>
                  </div>
                  <div className="db-sat-row">
                    <span className="db-sat-lbl">Last Observation</span>
                    <span className="db-sat-val db-sat-date">{formatRelativeDate(featuredSat.ndvi_date) || '—'}</span>
                  </div>
                </>
              ) : (
                <div className="empty-state" style={{ padding: '24px 0' }}>
                  <Satellite size={28} />
                  <p>No satellite data yet</p>
                  <Link to="/satellite" className="btn btn-primary btn-sm">Fetch Data</Link>
                </div>
              )}
            </div>
          </div>

          {/* Health Distribution */}
          {pieData.length > 0 && (
            <div className="db-card">
              <div className="db-card-header">
                <div className="db-card-header-left">
                  <Activity size={16} className="db-card-header-icon" />
                  <h3>Health Distribution</h3>
                </div>
              </div>
              <div className="db-card-body" style={{ paddingTop: 8 }}>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={36} outerRadius={58} paddingAngle={3}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="db-pie-legend">
                  {pieData.map(d => (
                    <div key={d.name} className="db-pie-lbl">
                      <span className="db-pie-dot" style={{ background: d.color }} />
                      {d.name}: <strong>{d.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Active Alerts */}
          <div className="db-card">
            <div className="db-card-header">
              <div className="db-card-header-left">
                <ShieldAlert size={16} className="db-card-header-icon db-card-header-icon--warn" />
                <h3>Active Alerts</h3>
                {activeAlerts.length > 0 && (
                  <span className="db-alert-count">{activeAlerts.length}</span>
                )}
              </div>
              <Link to="/early-warning" className="btn btn-sm btn-secondary">View All</Link>
            </div>
            <div className="db-alert-list">
              {activeAlerts.length === 0 ? (
                <div className="db-no-alerts">
                  <Leaf size={22} />
                  <span>All fields look clear</span>
                </div>
              ) : activeAlerts.slice(0, 5).map(a => (
                <div key={a.farm_id} className={`db-alert-item db-alert-item--${a.alert_level}`}>
                  <div className={`db-alert-dot db-alert-dot--${a.alert_level}`} />
                  <div className="db-alert-body">
                    <div className="db-alert-farm">{a.farm_name}</div>
                    <div className="db-alert-text">
                      {a.stress_type ? `${a.stress_type} stress` : a.alert_level === 'critical' ? 'Critical condition' : 'Needs attention'}
                    </div>
                  </div>
                  <span className={`db-alert-tag db-alert-tag--${a.alert_level}`}>{a.alert_level}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="db-card">
            <div className="db-card-header">
              <div className="db-card-header-left">
                <h3>Quick Actions</h3>
              </div>
            </div>
            <div className="db-actions-grid">
              <Link to="/farms" className="db-action-tile">
                <div className="db-action-tile-icon db-action-tile-icon--green"><Plus size={18} /></div>
                <span>Add Farm</span>
              </Link>
              <Link to="/satellite-dashboard" className="db-action-tile">
                <div className="db-action-tile-icon db-action-tile-icon--blue"><Map size={18} /></div>
                <span>Satellite Map</span>
              </Link>
              <Link to="/disease-classifier" className="db-action-tile">
                <div className="db-action-tile-icon db-action-tile-icon--red"><Bug size={18} /></div>
                <span>Disease AI</span>
              </Link>
              <Link to="/early-warning" className="db-action-tile">
                <div className="db-action-tile-icon db-action-tile-icon--orange"><AlertTriangle size={18} /></div>
                <span>View Alerts</span>
              </Link>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
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
          <div className="stat-icon blue"><MapPin size={22} /></div>
          <div className="stat-info">
            <h4>
              {hasRole('admin') ? 'Total Farms' :
                hasRole('agronomist') ? `Farms in ${user?.district || 'District'}` :
                  'My Farms'}
            </h4>
            <div className="stat-value">{totalFarms}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Satellite size={22} /></div>
          <div className="stat-info">
            <h4>Avg NDVI</h4>
            <div className="stat-value">{avgNdvi}</div>
            <div className={`stat-change ${Number(avgNdvi) >= 0.5 ? 'positive' : 'negative'}`}>
              {Number(avgNdvi) >= 0.5 ? 'Healthy range' : 'Below healthy'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><Activity size={22} /></div>
          <div className="stat-info">
            <h4>Stressed Farms</h4>
            <div className="stat-value">{healthyCounts.stressed}</div>
            <div className="stat-change negative">Need attention</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan"><Bug size={22} /></div>
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
            <h3>Farm NDVI Comparison</h3>
            <Link to="/satellite" className="btn btn-sm btn-secondary">View All</Link>
          </div>
          <div className="card-body">
            {ndviChart.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={ndviChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" fontSize={11} angle={-20} textAnchor="end" height={60} />
                  <YAxis domain={[0, 1]} fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="ndvi" radius={[4, 4, 0, 0]}>
                    {ndviChart.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.ndvi >= 0.6 ? '#16a34a' : entry.ndvi >= 0.4 ? '#d97706' : '#dc2626'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">
                <Satellite size={40} />
                <h3>No satellite data</h3>
                <p>Farm satellite data will appear here</p>
              </div>
            )}
          </div>
        </div>

        {/* Health Pie Chart */}
        <div className="card">
          <div className="card-header">
            <h3>Farm Health Distribution</h3>
          </div>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {pieData.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                <ResponsiveContainer width={200} height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={80}
                      paddingAngle={4}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div>
                  {pieData.map(d => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: d.color }} />
                      <span style={{ fontSize: 13 }}>{d.name}: <strong>{d.value}</strong></span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <Activity size={40} />
                <h3>No health data</h3>
                <p>Add farms and satellite data to see distribution</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Farm Table */}
      <div className="card">
        <div className="card-header">
          <h3>Farm Overview</h3>
          <Link to="/farms" className="btn btn-sm btn-primary">Manage Farms</Link>
        </div>
        <div className="card-body table-wrap">
          {farms.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Farm</th>
                  <th>Location</th>
                  <th>Crop</th>
                  <th>Size (ha)</th>
                  <th>NDVI</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {farms.map(farm => {
                  const sat = satellite.find(s => s.id === farm.id)
                  const ndvi = sat?.ndvi
                  // NDVI interpretation: >=0.6 healthy, 0.4-0.6 moderate, <0.4 stressed
                  const status = ndvi == null ? 'unknown' : ndvi >= 0.6 ? 'healthy' : ndvi >= 0.4 ? 'moderate' : 'stressed'
                  const displayStatus = status === 'unknown' ? 'No data' : status === 'stressed' ? 'Stressed' : status.charAt(0).toUpperCase() + status.slice(1)
                  return (
                    <tr key={farm.id}>
                      <td><strong>{farm.name}</strong></td>
                      <td>{farm.location || '—'}</td>
                      <td>{farm.crop_type || '—'}</td>
                      <td>{farm.size_hectares || farm.area || '—'}</td>
                      <td>{ndvi != null ? ndvi.toFixed(3) : '—'}</td>
                      <td><span className={`badge ${status}`}>
                        {displayStatus}
                      </span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <MapPin size={40} />
              <h3>No farms found</h3>
              <p>
                {hasRole('agronomist')
                  ? `There are no registered farms in ${user?.district} yet.`
                  : "You haven't registered any farms yet."}
              </p>
              {hasRole('farmer') && (
                <Link to="/farms" className="btn btn-primary" style={{ marginTop: 12 }}>
                  Register Your First Farm
                </Link>
              )}
            </div>
          )}
        </div>
      </div >

      {/* Early Warning Alerts */}
      {
        warnings && warnings.alerts && warnings.alerts.filter(a => a.alert_level !== 'low').length > 0 && (
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-header">
              <h3><AlertTriangle size={18} style={{ verticalAlign: -3, marginRight: 6, color: 'var(--warning)' }} />Early Warnings</h3>
              <Link to="/early-warning" className="btn btn-sm btn-secondary">View All</Link>
            </div>
            <div className="card-body">
              {warnings.alerts.filter(a => a.alert_level !== 'low').slice(0, 5).map(a => (
                <div key={a.farm_id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <span className={`badge ${a.alert_level === 'critical' ? 'high' : a.alert_level}`} style={{ minWidth: 70, textAlign: 'center' }}>
                    {a.alert_level}
                  </span>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 13 }}>{a.farm_name}</strong>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>{a.crop_type}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                    {a.disease_risk?.primary_threat} risk {a.combined_score}%
                    {a.ndvi_anomaly?.detected && <div style={{ color: 'var(--danger)' }}>NDVI drop {a.ndvi_anomaly.drop_pct}%</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }

      {/* Quick Actions */}
      <div className="stats-grid" style={{ marginTop: 20 }}>
        <Link to="/disease-classifier" style={{ textDecoration: 'none' }}>
          <div className="stat-card" style={{ cursor: 'pointer' }}>
            <div className="stat-icon red"><Bug size={22} /></div>
            <div className="stat-info">
              <h4>Disease Classifier</h4>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                Upload leaf image to identify diseases across 30 plant species
              </div>
            </div>
          </div>
        </Link>
        <Link to="/risk-assessment" style={{ textDecoration: 'none' }}>
          <div className="stat-card" style={{ cursor: 'pointer' }}>
            <div className="stat-icon orange"><ShieldAlert size={22} /></div>
            <div className="stat-info">
              <h4>Risk Assessment</h4>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                Get comprehensive ML-powered risk analysis for any farm
              </div>
            </div>
          </div>
        </Link>
        <Link to="/stress-monitoring" style={{ textDecoration: 'none' }}>
          <div className="stat-card" style={{ cursor: 'pointer' }}>
            <div className="stat-icon green"><Activity size={22} /></div>
            <div className="stat-info">
              <h4>Stress Monitoring</h4>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                Monitor drought, heat, water, and nutrient stress
              </div>
            </div>
          </div>
        </Link>
        <Link to="/disease-forecasts" style={{ textDecoration: 'none' }}>
          <div className="stat-card" style={{ cursor: 'pointer' }}>
            <div className="stat-icon cyan"><TrendingUp size={22} /></div>
            <div className="stat-info">
              <h4>Disease Forecasts</h4>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                7-day disease risk forecasts with treatment recommendations
              </div>
            </div>
          </div>
        </Link>
      </div>
    </>
  )
}

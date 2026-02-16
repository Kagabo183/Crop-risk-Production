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
            <h4>{hasRole('agronomist', 'admin') ? 'Avg NDVI' : 'Avg Crop Health'}</h4>
            <div className="stat-value">{avgNdvi}</div>
            <div className={`stat-change ${Number(avgNdvi) >= 0.5 ? 'positive' : 'negative'}`}>
              {hasRole('agronomist', 'admin')
                ? (Number(avgNdvi) >= 0.5 ? 'Healthy range' : 'Below healthy')
                : (Number(avgNdvi) >= 0.6 ? 'Doing well' : Number(avgNdvi) >= 0.4 ? 'Watch closely' : 'Needs care')}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><Activity size={22} /></div>
          <div className="stat-info">
            <h4>{hasRole('agronomist', 'admin') ? 'Stressed Farms' : 'Farms Needing Care'}</h4>
            <div className="stat-value">{healthyCounts.stressed}</div>
            <div className="stat-change negative">{hasRole('agronomist', 'admin') ? 'Need attention' : 'Take action soon'}</div>
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
            <h3>{hasRole('agronomist', 'admin') ? 'Vegetation Health (NDVI)' : 'Farm Health Comparison'}</h3>
            <Link to="/satellite" className="btn btn-sm btn-secondary">{hasRole('agronomist', 'admin') ? 'View All Indices' : 'View Details'}</Link>
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
                  {hasRole('agronomist', 'admin') ? (
                    <>
                      <th title="Normalized Difference Vegetation Index - Overall vegetation health">NDVI</th>
                      <th title="Normalized Difference Red Edge - Chlorophyll content">NDRE</th>
                      <th title="Normalized Difference Water Index - Water/moisture stress">NDWI</th>
                      <th title="Enhanced Vegetation Index - Canopy structure">EVI</th>
                      <th title="Soil Adjusted Vegetation Index - Vegetation with soil influence">SAVI</th>
                    </>
                  ) : (
                    <>
                      <th title="How green and healthy your crops look">Crop Health</th>
                      <th title="Leaf color and nutrient status">Leaf Color</th>
                      <th title="Water and moisture in plants">Water Status</th>
                      <th title="How thick and full your crops are">Canopy</th>
                      <th title="Crop coverage on the ground">Ground Cover</th>
                    </>
                  )}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {farms.map(farm => {
                  const sat = satellite.find(s => s.id === farm.id)
                  const ndvi = sat?.ndvi
                  const ndre = sat?.ndre
                  const ndwi = sat?.ndwi
                  const evi = sat?.evi
                  const savi = sat?.savi

                  // Calculate composite health score using ALL 5 indices (not just NDVI!)
                  // This uses the same algorithm as the backend's vegetation health classification
                  const calculateCompositeHealth = () => {
                    if (ndvi == null) return null

                    // Scale each index to 0-100 score based on agricultural thresholds
                    const scaleValue = (val, low, high) => {
                      if (val == null) return null
                      const score = ((val - low) / (high - low)) * 100
                      return Math.max(0, Math.min(100, score))
                    }

                    // Thresholds based on agricultural remote sensing for tropical crops
                    const ndviScore = scaleValue(ndvi, 0.15, 0.70)  // Overall greenness/biomass
                    const ndwiScore = scaleValue(ndwi, -0.30, 0.05) // Water/moisture stress
                    const ndreScore = scaleValue(ndre, 0.05, 0.35)  // Chlorophyll/nitrogen
                    const eviScore = scaleValue(evi, 0.10, 0.50)    // Canopy density
                    const saviScore = scaleValue(savi, 0.10, 0.55)  // Crop coverage

                    // Weighted composite: NDVI (30%), NDWI (25%), NDRE (20%), EVI (15%), SAVI (10%)
                    const weights = { ndvi: 0.30, ndwi: 0.25, ndre: 0.20, evi: 0.15, savi: 0.10 }
                    const scores = { ndvi: ndviScore, ndwi: ndwiScore, ndre: ndreScore, evi: eviScore, savi: saviScore }

                    let totalWeight = 0
                    let weightedSum = 0
                    for (const [key, score] of Object.entries(scores)) {
                      if (score != null) {
                        weightedSum += score * weights[key]
                        totalWeight += weights[key]
                      }
                    }

                    return totalWeight > 0 ? weightedSum / totalWeight : null
                  }

                  const compositeHealth = calculateCompositeHealth()

                  // Status from composite score: ≥75 = healthy, 40-75 = moderate, <40 = stressed
                  const status = compositeHealth == null
                    ? 'unknown'
                    : compositeHealth >= 75 ? 'healthy'
                    : compositeHealth >= 40 ? 'moderate'
                    : 'stressed'

                  // Farmer-friendly status messages
                  const displayStatus = hasRole('agronomist', 'admin')
                    ? (status === 'unknown' ? 'No data' : status === 'stressed' ? 'Stressed' : status.charAt(0).toUpperCase() + status.slice(1))
                    : (status === 'unknown' ? 'No data' : status === 'stressed' ? '⚠️ Needs Care' : status === 'moderate' ? '👀 Watch' : '✅ Doing Well')

                  return (
                    <tr key={farm.id}>
                      <td><strong>{farm.name}</strong></td>
                      <td>{farm.location || '—'}</td>
                      <td>{farm.crop_type || '—'}</td>
                      <td>{farm.size_hectares || farm.area || '—'}</td>
                      <td style={{ fontWeight: 600, color: ndvi != null ? (ndvi >= 0.6 ? 'var(--success)' : ndvi >= 0.4 ? 'var(--warning)' : 'var(--danger)') : 'inherit' }}>
                        {ndvi != null ? ndvi.toFixed(3) : '—'}
                      </td>
                      <td>{ndre != null ? ndre.toFixed(3) : '—'}</td>
                      <td>{ndwi != null ? ndwi.toFixed(3) : '—'}</td>
                      <td>{evi != null ? evi.toFixed(3) : '—'}</td>
                      <td>{savi != null ? savi.toFixed(3) : '—'}</td>
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

import { useState, useEffect, useRef, useCallback } from 'react'
import { formatDate } from '../utils/formatDate'
import { calculateHealthScore } from '../utils/healthScore'
import { MapPin, Leaf, Droplets, Plus, Edit3, Trash2, Satellite } from 'lucide-react'
import { getFarms, getFarmSatellite, deleteFarm, triggerSatelliteDownload, getTaskStatus, autoFetchSatellite } from '../api'
import FarmRegistrationWizard from '../components/FarmRegistrationWizard'
import { useAuth } from '../context/AuthContext'
import { usePlatform } from '../context/PlatformContext'
import { Link } from 'react-router-dom'

export default function Farms() {
  const { isWeb } = usePlatform()
  const { user, hasRole } = useAuth()
  const [farms, setFarms] = useState([])
  const [satellite, setSatellite] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Wizard state
  const [showWizard, setShowWizard] = useState(false)
  const [editingFarm, setEditingFarm] = useState(null)

  // Satellite fetch progress: { [farmId]: { percent, stage, taskId } }
  const [satProgress, setSatProgress] = useState({})
  const pollTimers = useRef({})

  const loadData = () => {
    setLoading(true)
    Promise.allSettled([getFarms(), getFarmSatellite()])
      .then(([fRes, sRes]) => {
        if (fRes.status === 'fulfilled') setFarms(fRes.value.data)
        if (sRes.status === 'fulfilled') setSatellite(sRes.value.data)
        setLoading(false)
      })
  }

  useEffect(() => { loadData() }, [])

  const handleEdit = (farm) => {
    setEditingFarm(farm)
    setShowWizard(true)
  }

  const handleDelete = async (farmId, farmName) => {
    if (!confirm(`Delete farm "${farmName}"? This will also remove all related satellite and weather data.`)) return
    try {
      await deleteFarm(farmId)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete farm')
    }
  }

  const pollTaskProgress = useCallback((farmId, taskId) => {
    const poll = async () => {
      try {
        const res = await getTaskStatus(taskId)
        const { state, percent, stage } = res.data
        setSatProgress(prev => ({ ...prev, [farmId]: { percent, stage, taskId } }))

        if (state === 'SUCCESS' || state === 'FAILURE') {
          clearInterval(pollTimers.current[farmId])
          delete pollTimers.current[farmId]
          if (state === 'SUCCESS') {
            loadData()
            // Clear progress after showing 100% briefly
            setTimeout(() => setSatProgress(prev => {
              const next = { ...prev }
              delete next[farmId]
              return next
            }), 2000)
          } else {
            setSatProgress(prev => ({ ...prev, [farmId]: { percent: 0, stage: 'Failed' } }))
          }
        }
      } catch {
        // If polling fails, keep trying
      }
    }
    pollTimers.current[farmId] = setInterval(poll, 1500)
    poll() // immediate first check
  }, [])

  const handleFetchSatellite = async (farmId) => {
    setSatProgress(prev => ({ ...prev, [farmId]: { percent: 5, stage: 'Starting...' } }))
    try {
      const res = await autoFetchSatellite(farmId)
      const taskId = res.data.task_id
      pollTaskProgress(farmId, taskId)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to fetch satellite data')
      setSatProgress(prev => {
        const next = { ...prev }
        delete next[farmId]
        return next
      })
    }
  }

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval)
    }
  }, [])

  if (loading) return <div className="loading"><div className="spinner" /><p>Loading farms...</p></div>

  return (
    <>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><MapPin size={18} /></div>
          <div className="stat-info">
            <h4>Total Registered</h4>
            <div className="stat-value">{farms.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Leaf size={18} /></div>
          <div className="stat-info">
            <h4>Total Area</h4>
            <div className="stat-value">
              {farms.reduce((s, f) => s + (f.size_hectares || f.area || 0), 0).toFixed(1)} ha
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan"><Droplets size={18} /></div>
          <div className="stat-info">
            <h4>Unique Crops</h4>
            <div className="stat-value">
              {new Set(farms.flatMap(f => (f.crop_type || '').split(',').map(c => c.trim())).filter(Boolean)).size}
            </div>
          </div>
        </div>
        {!isWeb && (
          <div className="stat-card">
            <div className="stat-icon orange"><Satellite size={18} /></div>
            <div className="stat-info">
              <h4>With Data</h4>
              <div className="stat-value">{satellite.length}</div>
            </div>
          </div>
        )}
      </div>

      {/* Info Banner: Composite Health Scoring */}
      <div style={{ marginBottom: 10, padding: '8px 10px', background: '#e8f5e9', border: '1px solid #2d7a3a40', borderRadius: 8, fontSize: 11, color: '#1b5e26' }}>
        Health badges use all indices (NDVI, NDRE, NDWI, EVI, SAVI). <span style={{ opacity: 0.7 }}>Healthy ≥70% · Moderate 50-70% · Stress &lt;50%</span>
      </div>

      {/* Register button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button
          className="btn btn-primary"
          onClick={() => { setEditingFarm(null); setShowWizard(true) }}
        >
          <Plus size={14} /> Register Farm
        </button>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 10 }}>{error}</div>}

      {/* Farm Registration Wizard */}
      {showWizard && (
        <FarmRegistrationWizard
          editingFarm={editingFarm}
          onSaved={() => {
            setShowWizard(false)
            setEditingFarm(null)
            loadData()
          }}
          onCancel={() => {
            setShowWizard(false)
            setEditingFarm(null)
          }}
        />
      )}

      {/* Farm List */}
      {isWeb ? (
        <div className="card">
          <div className="card-header">
            <h3>Registered Farm Portfolios</h3>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Farm Name</th>
                    <th>Region (Sector)</th>
                    <th>Crop Portfolio</th>
                    <th>Area (ha)</th>
                    <th>Health Score</th>
                    <th>Last Sync</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {farms.length === 0 ? (
                    <tr><td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>No farms registered yet.</td></tr>
                  ) : farms.map(farm => {
                    const sat = satellite.find(s => s.id === farm.id)
                    const { status: healthStatus, score } = calculateHealthScore(sat)
                    return (
                      <tr key={farm.id}>
                        <td style={{ fontWeight: 600 }}>{farm.name}</td>
                        <td>{farm.location || '—'}</td>
                        <td>
                          {farm.crop_type ? (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {farm.crop_type.split(',').map(c => (
                                <span key={c} className="badge info" style={{ fontSize: 9 }}>{c.trim()}</span>
                              ))}
                            </div>
                          ) : '—'}
                        </td>
                        <td>{farm.size_hectares || farm.area || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className={`badge ${healthStatus}`}>{healthStatus}</span>
                            {score != null && <span style={{ opacity: 0.6, fontSize: 10 }}>{Math.round(score)}%</span>}
                          </div>
                        </td>
                        <td>{sat?.ndvi_date ? formatDate(sat.ndvi_date) : 'Never'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            {farm.latitude && farm.longitude && (
                              satProgress[farm.id] ? (
                                <span style={{ fontSize: 11, color: 'var(--primary)' }}>
                                  <Satellite size={13} /> {satProgress[farm.id].percent}%
                                </span>
                              ) : (
                                <button className="btn btn-secondary btn-sm" onClick={() => handleFetchSatellite(farm.id)} title="Fetch satellite data">
                                  <Satellite size={14} /> Fetch
                                </button>
                              )
                            )}
                            <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(farm)}>
                              <Edit3 size={14} /> Edit
                            </button>
                            <button className="btn btn-secondary btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(farm.id, farm.name)}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {farms.map(farm => {
            const sat = satellite.find(s => s.id === farm.id)
            const ndvi = sat?.ndvi
            const ndre = sat?.ndre
            const ndwi = sat?.ndwi
            const evi = sat?.evi
            const savi = sat?.savi
            const hasIndices = ndvi != null || ndre != null || ndwi != null || evi != null || savi != null
            const hasCoords = farm.latitude && farm.longitude

            // ── Composite Health Score (shared utility) ──
            const { status: healthStatus } = calculateHealthScore(sat)
            const progress = satProgress[farm.id]

            return (
              <div key={farm.id} className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3>{farm.name}</h3>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`badge ${healthStatus}`}>
                      {healthStatus === 'unknown' ? 'No data' : healthStatus}
                    </span>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      onClick={() => handleEdit(farm)}
                      title="Edit farm"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '4px 8px', fontSize: 12, color: 'var(--danger)' }}
                      onClick={() => handleDelete(farm.id, farm.name)}
                      title="Delete farm"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 12 }}>
                    <div>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>Location</span>
                      <div style={{ fontWeight: 500 }}>{farm.location || '—'}</div>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>Crop</span>
                      <div style={{ fontWeight: 500 }}>{farm.crop_type || '—'}</div>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>Size</span>
                      <div style={{ fontWeight: 500 }}>{farm.size_hectares || farm.area || '—'} ha</div>
                    </div>
                    {farm.latitude && (
                      <div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>Coords</span>
                        <div style={{ fontWeight: 500, fontSize: 11 }}>
                          {farm.latitude?.toFixed(4)}, {farm.longitude?.toFixed(4)}
                        </div>
                      </div>
                    )}
                    {sat?.ndvi_date && (
                      <div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>Updated</span>
                        <div style={{ fontWeight: 500 }}>{formatDate(sat.ndvi_date)}</div>
                      </div>
                    )}
                    {sat?.data_source && (
                      <div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>Source</span>
                        <div style={{ fontWeight: 500 }}>{sat.data_source}</div>
                      </div>
                    )}
                  </div>

                  {/* Vegetation Indices */}
                  {hasIndices ? (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>Vegetation Indices</div>
                      {[
                        { label: 'NDVI', value: ndvi },
                        { label: 'NDRE', value: ndre },
                        { label: 'NDWI', value: ndwi },
                        { label: 'EVI', value: evi },
                        { label: 'SAVI', value: savi },
                      ].filter(idx => idx.value != null).map(idx => (
                        <div key={idx.label} style={{ marginBottom: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 1 }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{idx.label}</span>
                            <span style={{ fontWeight: 600 }}>{idx.value.toFixed(3)}</span>
                          </div>
                          <div className="confidence-bar" style={{ height: 4 }}>
                            <div className="confidence-fill" style={{
                              width: `${Math.min(Math.max(idx.value, 0), 1) * 100}%`,
                              background: idx.value >= 0.6 ? 'var(--success)' : idx.value >= 0.4 ? 'var(--warning)' : 'var(--danger)',
                            }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : !progress && (
                    <div style={{ marginTop: 10, padding: 8, borderRadius: 6, background: 'var(--bg-surface)', textAlign: 'center' }}>
                      <Satellite size={16} style={{ color: 'var(--text-secondary)', marginBottom: 2 }} />
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {hasCoords ? 'No satellite data yet' : 'Add coordinates for monitoring'}
                      </div>
                    </div>
                  )}

                  {/* Buffer Size Warning for farms without boundaries */}
                  {hasCoords && farm.area && !farm.has_boundary && (() => {
                    const bufferAreaHa = (3.14159 * 50 * 50) / 10000
                    const ratio = bufferAreaHa / farm.area
                    if (ratio > 1.5) {
                      return (
                        <div style={{ marginTop: 8, padding: '6px 8px', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, fontSize: 11, color: '#92400e' }}>
                          ⚠️ Sampled area ~{bufferAreaHa.toFixed(1)} ha ({ratio.toFixed(1)}x farm size). Add boundary for accuracy.
                        </div>
                      )
                    }
                    return null
                  })()}

                  {/* Satellite Fetch Progress / Button */}
                  {hasCoords && (
                    <div style={{ marginTop: 10 }}>
                      {progress ? (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                              <Satellite size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                              {progress.stage}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>{progress.percent}%</span>
                          </div>
                          <div style={{ height: 5, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 3, width: `${progress.percent}%`, background: progress.percent >= 100 ? 'var(--success)' : 'var(--primary)', transition: 'width 0.5s ease' }} />
                          </div>
                        </div>
                      ) : (
                        <button className="btn btn-sm btn-secondary" onClick={() => handleFetchSatellite(farm.id)}>
                          <Satellite size={13} /> Fetch Data
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {
        farms.length === 0 && !showWizard && (
          <div className="empty-state">
            <MapPin size={48} />
            <h3>No farms found</h3>
            <p>
              {hasRole('agronomist')
                ? `No registered farms found in ${user?.district} district.`
                : 'Click "Register New Farm" to add your first farm'}
            </p>
          </div>
        )
      }
    </>
  )
}

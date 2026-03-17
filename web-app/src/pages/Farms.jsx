import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Leaf, Droplets, Satellite, Plus, Edit3, Trash2 } from 'lucide-react'
import FarmRegistrationWizard from '../components/FarmRegistrationWizard'
import { calculateHealthScore } from '../utils/healthScore'
import { formatDate } from '../utils/formatDate'
import {
  autoFetchSatellite,
  deleteFarm,
  getFarms,
  getFarmSatellite,
  getTaskStatus,
  analyzeFarmRisk,
} from '../api'
import { emitFarmDataUpdated, useFarmDataListener } from '../utils/farmEvents'

export default function Farms() {
  const [farms, setFarms] = useState([])
  const [satellite, setSatellite] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showWizard, setShowWizard] = useState(false)
  const [editingFarm, setEditingFarm] = useState(null)
  const [satProgress, setSatProgress] = useState({})
  const pollTimers = useRef({})

  const loadData = useCallback(() => {
    setLoading(true)
    Promise.allSettled([getFarms(), getFarmSatellite()])
      .then(([fRes, sRes]) => {
        if (fRes.status === 'fulfilled') setFarms(fRes.value.data)
        if (sRes.status === 'fulfilled') setSatellite(sRes.value.data)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Re-fetch when another page triggers a scan
  useFarmDataListener(loadData)

  useEffect(() => () => {
    Object.values(pollTimers.current).forEach(clearInterval)
  }, [])

  const farmsWithSatellite = useMemo(() => (
    farms.map(f => {
      const sat = satellite.find(s => s.id === f.id) || {}
      return {
        ...f,
        ndvi: sat.ndvi ?? sat.ndvi_mean ?? null,
        ndre: sat.ndre ?? sat.ndre_mean ?? null,
        last_satellite_date: sat.ndvi_date || f.last_satellite_date,
        cloud_cover: sat.cloud_cover ?? null,
      }
    })
  ), [farms, satellite])

  const totalArea = useMemo(() => farms.reduce((sum, f) => sum + (f.size_hectares || f.area || 0), 0), [farms])
  const uniqueCrops = useMemo(() => (
    new Set(
      farms
        .flatMap(f => (f.crop_type || '').split(',').map(c => c.trim()))
        .filter(Boolean)
    ).size
  ), [farms])

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
            analyzeFarmRisk(farmId, { forceRefresh: true }).catch(() => {})
            emitFarmDataUpdated(farmId)
            setTimeout(() => setSatProgress(prev => {
              const next = { ...prev }
              delete next[farmId]
              return next
            }), 1500)
          } else {
            setSatProgress(prev => ({ ...prev, [farmId]: { percent: 0, stage: 'Failed' } }))
          }
        }
      } catch {
        /* keep polling */
      }
    }

    pollTimers.current[farmId] = setInterval(poll, 1500)
    poll()
  }, [loadData])

  const handleFetchSatellite = useCallback(async (farmId) => {
    if (!farmId) return
    setSatProgress(prev => ({ ...prev, [farmId]: { percent: 5, stage: 'Starting…' } }))
    try {
      const res = await autoFetchSatellite(farmId)
      pollTaskProgress(farmId, res.data.task_id)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to trigger satellite analysis')
      setSatProgress(prev => {
        const next = { ...prev }
        delete next[farmId]
        return next
      })
    }
  }, [pollTaskProgress])

  const handleWizardSaved = (savedFarm) => {
    setShowWizard(false)
    setEditingFarm(null)
    loadData()
    if (savedFarm?.id) {
      handleFetchSatellite(savedFarm.id)
    }
  }

  const handleEdit = (farm) => {
    setEditingFarm(farm)
    setShowWizard(true)
  }

  const handleDelete = async (farmId, farmName) => {
    if (!confirm(`Delete farm "${farmName}"? This cannot be undone.`)) return
    try {
      await deleteFarm(farmId)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete farm')
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading farms…</p>
      </div>
    )
  }

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><MapPin size={18} /></div>
          <div className="stat-info">
            <h4>Total Farms</h4>
            <div className="stat-value">{farms.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Leaf size={18} /></div>
          <div className="stat-info">
            <h4>Total Area</h4>
            <div className="stat-value">{totalArea.toFixed(1)} ha</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan"><Droplets size={18} /></div>
          <div className="stat-info">
            <h4>Unique Crops</h4>
            <div className="stat-value">{uniqueCrops}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><Satellite size={18} /></div>
          <div className="stat-info">
            <h4>With Satellite Data</h4>
            <div className="stat-value">{satellite.length}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3>Farm Portfolio</h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12 }}>
              Register new farms, manage metadata, and keep boundaries up to date. Satellite analysis runs automatically after every save.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link className="btn btn-secondary" to="/satellite-dashboard">
              View Satellite Map
            </Link>
            <button className="btn btn-primary" onClick={() => { setEditingFarm(null); setShowWizard(true) }}>
              <Plus size={14} /> Add farm
            </button>
          </div>
        </div>

        <div className="card-body table-wrap" style={{ paddingTop: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Location</th>
                <th>Crop & Season</th>
                <th>Area (ha)</th>
                <th>NDVI</th>
                <th>Last Capture</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {farmsWithSatellite.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                    No farms registered yet.
                  </td>
                </tr>
              ) : (
                farmsWithSatellite.map(farm => {
                  const sat = satProgress[farm.id]
                  const { status: healthStatus, score } = calculateHealthScore({ ndvi: farm.ndvi, ndre: farm.ndre })
                  return (
                    <tr key={farm.id}>
                      <td style={{ fontWeight: 600 }}>{farm.name}</td>
                      <td>{farm.location || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {farm.crop_type && <span className="badge info" style={{ fontSize: 10 }}>{farm.crop_type}</span>}
                          {farm.season && <span className="badge" style={{ fontSize: 10 }}>{farm.season}</span>}
                        </div>
                      </td>
                      <td>{(farm.size_hectares || farm.area || 0).toFixed(2)}</td>
                      <td>
                        {farm.ndvi != null ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{ fontWeight: 600 }}>{farm.ndvi.toFixed(3)}</span>
                            <span className={`badge ${healthStatus}`}>
                              {healthStatus === 'unknown' ? 'No data' : `${score ?? '—'}%`}
                            </span>
                          </div>
                        ) : '—'}
                      </td>
                      <td>{farm.last_satellite_date ? formatDate(farm.last_satellite_date) : 'Never'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 8 }}>
                          {sat ? (
                            <span style={{ fontSize: 12, color: 'var(--primary)' }}>{sat.percent}% · {sat.stage}</span>
                          ) : (
                            <button className="btn btn-secondary btn-sm" onClick={() => handleFetchSatellite(farm.id)}>
                              <Satellite size={14} /> Scan
                            </button>
                          )}
                          <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(farm)}>
                            <Edit3 size={14} />
                          </button>
                          <button className="btn btn-secondary btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(farm.id, farm.name)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 20 }}>{error}</div>}

      {showWizard && (
        <FarmRegistrationWizard
          editingFarm={editingFarm}
          onSaved={handleWizardSaved}
          onCancel={() => {
            setShowWizard(false)
            setEditingFarm(null)
          }}
        />
      )}
    </>
  )
}

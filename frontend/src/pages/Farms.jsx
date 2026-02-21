import { useState, useEffect, useRef, useCallback } from 'react'
import { MapPin, Leaf, Droplets, Plus, Edit3, Trash2, X, Check, Navigation, Satellite, Scan, Footprints } from 'lucide-react'
import { getFarms, getFarmSatellite, createFarm, updateFarm, deleteFarm, triggerSatelliteDownload, getTaskStatus, autoDetectBoundary, saveFarmBoundary, detectLocation } from '../api'
import WalkMyFarm from '../components/WalkMyFarm'
import ParcelLookup from '../components/ParcelLookup'
import { useAuth } from '../context/AuthContext'
import LOCATIONS from '../data/locations.json'

const emptyForm = {
  name: '', district: '', sector: '', province: '', crop_type: '',
  area: '', latitude: '', longitude: '',
}

export default function Farms() {
  const { user, hasRole } = useAuth()
  const [farms, setFarms] = useState([])
  const [satellite, setSatellite] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Satellite fetch progress: { [farmId]: { percent, stage, taskId } }
  const [satProgress, setSatProgress] = useState({})
  const pollTimers = useRef({})

  // GPS state
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState(null)

  // Boundary detection state
  const [boundaryLoading, setBoundaryLoading] = useState(false)
  const [boundaryResult, setBoundaryResult] = useState(null)
  const [boundaryError, setBoundaryError] = useState(null)

  // Walk My Farm state
  const [showWalkMyFarm, setShowWalkMyFarm] = useState(false)
  const [showParcelLookup, setShowParcelLookup] = useState(false)

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

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        name: formData.name,
        location: formData.sector ? `${formData.district} - ${formData.sector}` : formData.district,
        province: formData.province || null,
        crop_type: formData.crop_type || null,
        area: formData.area ? parseFloat(formData.area) : null,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
      }
      if (editingId) {
        await updateFarm(editingId, payload)
      } else {
        await createFarm(payload)
      }
      setShowForm(false)
      setEditingId(null)
      setFormData(emptyForm)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save farm')
    }
    setSubmitting(false)
  }

  const handleEdit = (farm) => {
    const [dist, sect] = (farm.location || '').split(' - ')
    setFormData({
      name: farm.name || '',
      district: dist || '',
      sector: sect || '',
      province: farm.province || '',
      crop_type: farm.crop_type || '',
      area: farm.area != null ? String(farm.area) : '',
      latitude: farm.latitude != null ? String(farm.latitude) : '',
      longitude: farm.longitude != null ? String(farm.longitude) : '',
    })
    setEditingId(farm.id)
    setShowForm(true)
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

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser')
      return
    }
    setGeoLoading(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lon = position.coords.longitude

        setFormData(prev => ({
          ...prev,
          latitude: lat.toFixed(6),
          longitude: lon.toFixed(6),
        }))

        // Auto-detect location details
        try {
          const res = await detectLocation(lat, lon)
          if (res.data.success) {
            const { province, district } = res.data
            setFormData(prev => ({
              ...prev,
              province: province || prev.province,
              district: district || '', // Reset district if not found or set new one
              sector: '' // Always reset sector as we don't detect it reliably yet
            }))
            // Show a small success indicator (reusing geoError for simplicity or just console for now)
            console.log("Location detected:", res.data.message)
          }
        } catch (err) {
          console.error("Failed to detect location details:", err)
          // Don't fail the whole operation, just log
        }

        setGeoLoading(false)
      },
      (err) => {
        setGeoError(
          err.code === 1 ? 'Location access denied. Please allow location access in your browser.' :
            err.code === 2 ? 'Position unavailable. Try again or enter manually.' :
              'Location request timed out. Try again.'
        )
        setGeoLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  const handleAutoDetectBoundary = async () => {
    if (!formData.latitude || !formData.longitude) {
      setBoundaryError('Please set farm coordinates first (use GPS or enter manually)')
      return
    }

    setBoundaryLoading(true)
    setBoundaryError(null)
    setBoundaryResult(null)

    try {
      // For new farms, we need to save first to get an ID
      if (!editingId) {
        setBoundaryError('Please save the farm first, then use Auto-Detect Boundary')
        setBoundaryLoading(false)
        return
      }

      const response = await autoDetectBoundary(editingId, 200)

      if (response.data.success) {
        setBoundaryResult(response.data)

        // Auto-save the detected boundary
        await saveFarmBoundary(editingId, response.data.boundary)

        // Update area in form
        setFormData(prev => ({
          ...prev,
          area: response.data.area_ha.toFixed(2)
        }))

        setBoundaryLoading(false)
      }
    } catch (err) {
      setBoundaryError(err.response?.data?.detail || 'Failed to detect boundary. The farm may be in a forest or non-crop area.')
      setBoundaryLoading(false)
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
      const res = await triggerSatelliteDownload(farmId, 30)
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
          <div className="stat-icon blue"><MapPin size={22} /></div>
          <div className="stat-info">
            <h4>Total Farms</h4>
            <div className="stat-value">{farms.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Leaf size={22} /></div>
          <div className="stat-info">
            <h4>Total Area</h4>
            <div className="stat-value">
              {farms.reduce((s, f) => s + (f.size_hectares || f.area || 0), 0).toFixed(1)} ha
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan"><Droplets size={22} /></div>
          <div className="stat-info">
            <h4>Crop Types</h4>
            <div className="stat-value">
              {new Set(farms.flatMap(f => (f.crop_type || '').split(',').map(c => c.trim())).filter(Boolean)).size}
            </div>
          </div>
        </div>
      </div>

      {/* Info Banner: Composite Health Scoring */}
      <div style={{
        marginBottom: 16,
        padding: 12,
        background: 'linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%)',
        border: '1px solid #3b82f6',
        borderRadius: 8,
        fontSize: 13
      }}>
        <div style={{ fontWeight: 600, color: '#1e40af', marginBottom: 4 }}>
          🎯 Comprehensive Health Assessment
        </div>
        <div style={{ color: '#1e3a8a' }}>
          Farm health badges now consider <strong>all vegetation indices</strong> (NDVI, NDRE, NDWI, EVI, SAVI) for accurate assessment, not just NDVI alone.
          {' '}<span style={{ opacity: 0.8 }}>Healthy ≥70% • Moderate 50-70% • High stress &lt;50%</span>
        </div>
      </div>

      {/* Register button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          className="btn btn-primary"
          onClick={() => { setShowForm(!showForm); setEditingId(null); setFormData(emptyForm) }}
        >
          {showForm ? <><X size={16} /> Cancel</> : <><Plus size={16} /> Register New Farm</>}
        </button>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Registration / Edit Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <h3>{editingId ? 'Edit Farm' : 'Register New Farm'}</h3>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
                <div className="form-group">
                  <label>Farm Name *</label>
                  <input
                    className="form-control"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    placeholder="e.g. Musanze Highland Farm"
                  />
                </div>
                <div className="form-group">
                  <label>Province</label>
                  <select
                    className="form-control"
                    name="province"
                    value={formData.province}
                    onChange={e => {
                      setFormData(prev => ({ ...prev, province: e.target.value, district: '', sector: '' }))
                    }}
                    required
                  >
                    <option value="">Select province</option>
                    {(LOCATIONS?.provinces || []).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>District</label>
                  <select
                    className="form-control"
                    name="district"
                    value={formData.district}
                    onChange={e => {
                      setFormData(prev => ({ ...prev, district: e.target.value, sector: '' }))
                    }}
                    disabled={!formData.province}
                    required
                  >
                    <option value="">Select District</option>
                    {(LOCATIONS.provinces.find(p => p.name === formData.province)?.districts || []).map(d => (
                      <option key={d.name} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Sector</label>
                  <select
                    className="form-control"
                    name="sector"
                    value={formData.sector}
                    onChange={handleChange}
                    disabled={!formData.district}
                    required
                  >
                    <option value="">Select Sector</option>
                    {(LOCATIONS.provinces.find(p => p.name === formData.province)
                      ?.districts.find(d => d.name === formData.district)?.sectors || [])
                      .map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Crop Types</label>
                  <input
                    className="form-control"
                    name="crop_type"
                    value={formData.crop_type}
                    onChange={handleChange}
                    placeholder="e.g. potato, maize, beans"
                  />
                  <small style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Comma-separated for multiple crops</small>
                </div>
                <div className="form-group">
                  <label>Area (hectares)</label>
                  <input
                    className="form-control"
                    name="area"
                    type="number"
                    step="0.1"
                    min="0"
                    value={formData.area}
                    onChange={handleChange}
                    placeholder="e.g. 2.5"
                  />
                </div>
                <div className="form-group">
                  <label>Latitude</label>
                  <input
                    className="form-control"
                    name="latitude"
                    type="number"
                    step="0.000001"
                    min="-90"
                    max="90"
                    value={formData.latitude}
                    onChange={handleChange}
                    placeholder="e.g. -2.4834"
                  />
                </div>
                <div className="form-group">
                  <label>Longitude</label>
                  <input
                    className="form-control"
                    name="longitude"
                    type="number"
                    step="0.000001"
                    min="-180"
                    max="180"
                    value={formData.longitude}
                    onChange={handleChange}
                    placeholder="e.g. 28.9080"
                  />
                </div>
              </div>
              {/* GPS & Boundary Detection Buttons */}
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={handleGetLocation}
                  disabled={geoLoading}
                  style={{ fontSize: 13, padding: '6px 14px' }}
                >
                  <Navigation size={14} />
                  {geoLoading ? 'Getting location...' : '📍 Use My Location'}
                </button>
                {editingId && formData.latitude && formData.longitude && (
                  <>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={handleAutoDetectBoundary}
                      disabled={boundaryLoading}
                      style={{ fontSize: 13, padding: '6px 14px', background: 'var(--primary)', color: 'white' }}
                      title="Automatically detect farm boundary from satellite imagery (excludes forests)"
                    >
                      <Scan size={14} />
                      {boundaryLoading ? 'Detecting...' : '🛰️ Auto-Detect Boundary'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => setShowWalkMyFarm(!showWalkMyFarm)}
                      style={{ fontSize: 13, padding: '6px 14px', background: '#f97316', color: 'white', border: 'none' }}
                      title="Walk around your farm to record the boundary with GPS"
                    >
                      <Footprints size={14} />
                      {showWalkMyFarm ? 'Hide Walk Tool' : '🚶 Walk My Farm'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => setShowParcelLookup(true)}
                      style={{ fontSize: 13, padding: '6px 14px', background: '#6366f1', color: 'white', border: 'none' }}
                      title="Find your official land parcel boundary by UPI or GPS location"
                    >
                      <MapPin size={14} />
                      📋 Find My Parcel
                    </button>
                  </>
                )}
                {formData.latitude && formData.longitude && (
                  <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>
                    ✓ Coordinates: {formData.latitude}, {formData.longitude}
                  </span>
                )}
                {geoError && (
                  <span style={{ fontSize: 12, color: 'var(--danger)' }}>{geoError}</span>
                )}
              </div>
              {/* Boundary Detection Results */}
              {boundaryResult && (
                <div style={{ marginTop: 12, padding: 12, background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#166534', marginBottom: 4 }}>
                    ✅ Farm Boundary Detected & Saved!
                  </div>
                  <div style={{ fontSize: 12, color: '#15803d' }}>
                    • Area: {boundaryResult.area_ha} hectares
                  </div>
                  <div style={{ fontSize: 12, color: '#15803d' }}>
                    • Confidence: {(boundaryResult.confidence * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 12, color: '#15803d' }}>
                    • Crop area: {(boundaryResult.land_cover.crops * 100).toFixed(0)}% | Forest: {(boundaryResult.land_cover.trees * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 11, color: '#166534', marginTop: 4 }}>
                    ℹ️ Boundary excludes forests and buildings. Satellite data will now use the exact farm area.
                  </div>
                </div>
              )}
              {boundaryError && (
                <div style={{ marginTop: 12, padding: 10, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
                  ⚠️ {boundaryError}
                </div>
              )}
              {/* Walk My Farm Component */}
              {showWalkMyFarm && editingId && (
                <div style={{ marginTop: 16 }}>
                  <WalkMyFarm
                    farmId={editingId}
                    farmLat={parseFloat(formData.latitude)}
                    farmLon={parseFloat(formData.longitude)}
                    onSaved={(areaHa) => {
                      setFormData(prev => ({ ...prev, area: areaHa.toFixed(2) }))
                      setShowWalkMyFarm(false)
                      loadData()
                    }}
                    onClose={() => setShowWalkMyFarm(false)}
                  />
                </div>
              )}
              {/* Parcel Lookup Component */}
              {showParcelLookup && editingId && (
                <ParcelLookup
                  farmId={editingId}
                  farmLat={parseFloat(formData.latitude)}
                  farmLon={parseFloat(formData.longitude)}
                  onSaved={(areaHa) => {
                    setFormData(prev => ({ ...prev, area: areaHa.toFixed(2) }))
                    setShowParcelLookup(false)
                    loadData()
                  }}
                  onClose={() => setShowParcelLookup(false)}
                />
              )}
              <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  <Check size={16} />
                  {submitting ? 'Saving...' : editingId ? 'Update Farm' : 'Register Farm'}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => { setShowForm(false); setEditingId(null); setFormData(emptyForm) }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div >
        </div >
      )
      }

      {/* Farm Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {farms.map(farm => {
          const sat = satellite.find(s => s.id === farm.id)
          const ndvi = sat?.ndvi
          const ndre = sat?.ndre
          const ndwi = sat?.ndwi
          const evi = sat?.evi
          const savi = sat?.savi
          const hasIndices = ndvi != null || ndre != null || ndwi != null || evi != null || savi != null
          const hasCoords = farm.latitude && farm.longitude

          // ── Composite Health Score (All Indices) ──
          const calculateCompositeHealth = () => {
            if (!hasIndices) return 'unknown'

            let healthScore = 0
            let totalWeight = 0

            // NDVI (30% weight) - Primary vegetation health
            if (ndvi != null) {
              const ndviScore = ndvi >= 0.6 ? 100 : ndvi >= 0.5 ? 70 : ndvi >= 0.4 ? 50 : ndvi >= 0.3 ? 30 : 10
              healthScore += ndviScore * 0.30
              totalWeight += 0.30
            }

            // NDRE (20% weight) - Chlorophyll/nitrogen status
            if (ndre != null) {
              const ndreScore = ndre >= 0.5 ? 100 : ndre >= 0.4 ? 70 : ndre >= 0.3 ? 50 : ndre >= 0.2 ? 30 : 10
              healthScore += ndreScore * 0.20
              totalWeight += 0.20
            }

            // NDWI (20% weight) - Water content
            if (ndwi != null) {
              const ndwiScore = ndwi >= 0.3 ? 100 : ndwi >= 0.2 ? 70 : ndwi >= 0.1 ? 50 : ndwi >= 0 ? 30 : 10
              healthScore += ndwiScore * 0.20
              totalWeight += 0.20
            }

            // EVI (15% weight) - Enhanced vegetation (atmospheric correction)
            if (evi != null) {
              const eviScore = evi >= 0.6 ? 100 : evi >= 0.4 ? 70 : evi >= 0.3 ? 50 : evi >= 0.2 ? 30 : 10
              healthScore += eviScore * 0.15
              totalWeight += 0.15
            }

            // SAVI (15% weight) - Soil-adjusted
            if (savi != null) {
              const saviScore = savi >= 0.5 ? 100 : savi >= 0.4 ? 70 : savi >= 0.3 ? 50 : savi >= 0.2 ? 30 : 10
              healthScore += saviScore * 0.15
              totalWeight += 0.15
            }

            // Normalize by actual total weight
            const finalScore = totalWeight > 0 ? healthScore / totalWeight : 0

            // Determine status badge
            if (finalScore >= 70) return 'healthy'
            if (finalScore >= 50) return 'moderate'
            return 'high' // high stress
          }

          const healthStatus = calculateCompositeHealth()
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: 14 }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Location</span>
                    <div style={{ fontWeight: 500 }}>{farm.location || '—'}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Crop Type</span>
                    <div style={{ fontWeight: 500 }}>{farm.crop_type || '—'}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Size</span>
                    <div style={{ fontWeight: 500 }}>{farm.size_hectares || farm.area || '—'} ha</div>
                  </div>
                  {farm.latitude && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Coordinates</span>
                      <div style={{ fontWeight: 500, fontSize: 12 }}>
                        {farm.latitude?.toFixed(4)}, {farm.longitude?.toFixed(4)}
                      </div>
                    </div>
                  )}
                  {sat?.ndvi_date && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Last Update</span>
                      <div style={{ fontWeight: 500 }}>{sat.ndvi_date}</div>
                    </div>
                  )}
                  {sat?.data_source && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Source</span>
                      <div style={{ fontWeight: 500 }}>{sat.data_source}</div>
                    </div>
                  )}
                </div>

                {/* Vegetation Indices */}
                {hasIndices ? (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Vegetation Indices</div>
                    {[
                      { label: 'NDVI', value: ndvi, desc: 'Vegetation health' },
                      { label: 'NDRE', value: ndre, desc: 'Chlorophyll content' },
                      { label: 'NDWI', value: ndwi, desc: 'Water stress' },
                      { label: 'EVI', value: evi, desc: 'Canopy structure' },
                      { label: 'SAVI', value: savi, desc: 'Soil-adjusted veg.' },
                    ].filter(idx => idx.value != null).map(idx => (
                      <div key={idx.label} style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                          <span style={{ color: 'var(--text-secondary)' }} title={idx.desc}>{idx.label}</span>
                          <span style={{ fontWeight: 600 }}>{idx.value.toFixed(3)}</span>
                        </div>
                        <div className="confidence-bar" style={{ height: 6 }}>
                          <div
                            className="confidence-fill"
                            style={{
                              width: `${Math.min(Math.max(idx.value, 0), 1) * 100}%`,
                              background: idx.value >= 0.6 ? 'var(--success)' : idx.value >= 0.4 ? 'var(--warning)' : 'var(--danger)',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !progress && (
                  <div style={{
                    marginTop: 16, padding: 12, borderRadius: 8,
                    background: hasCoords ? '#dbeafe20' : '#fef3c720',
                    border: `1px solid ${hasCoords ? '#3b82f640' : '#d9770640'}`,
                    textAlign: 'center',
                  }}>
                    <Satellite size={20} style={{ color: 'var(--text-secondary)', marginBottom: 4 }} />
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
                      {hasCoords
                        ? 'No satellite data yet'
                        : 'Add coordinates to enable satellite monitoring'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {hasCoords
                        ? 'Click "Fetch Satellite Data" below to download imagery'
                        : 'Use "Edit" to add latitude/longitude or GPS location'}
                    </div>
                  </div>
                )}

                {/* Buffer Size Warning for farms without boundaries */}
                {hasCoords && farm.area && !farm.boundary && (() => {
                  const bufferAreaHa = (3.14159 * 50 * 50) / 10000  // 50m buffer
                  const ratio = bufferAreaHa / farm.area

                  if (ratio > 1.5) {
                    return (
                      <div style={{
                        marginTop: 16,
                        padding: 10,
                        background: '#fef3c7',
                        border: '1px solid #f59e0b',
                        borderRadius: 6,
                        fontSize: 12
                      }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
                          <span style={{ fontSize: 16 }}>⚠️</span>
                          <div>
                            <strong style={{ color: '#92400e', display: 'block', marginBottom: 2 }}>
                              Data may be inaccurate
                            </strong>
                            <div style={{ color: '#78350f', lineHeight: 1.4 }}>
                              Farm size: {farm.area.toFixed(1)} ha • Sampled area: ~{bufferAreaHa.toFixed(1)} ha ({ratio.toFixed(1)}x larger)
                            </div>
                            {hasRole('agronomist', 'admin') && (
                              <div style={{ marginTop: 4, fontSize: 11, color: '#78350f' }}>
                                Add a boundary polygon for accurate analysis
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  }
                  return null
                })()}

                {/* Satellite Fetch Progress / Button */}
                {hasCoords && (
                  <div style={{ marginTop: 16 }}>
                    {progress ? (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
                            <Satellite size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                            {progress.stage}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                            {progress.percent}%
                          </span>
                        </div>
                        <div style={{
                          height: 8, borderRadius: 4, background: 'var(--bg-secondary, #f1f5f9)',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%', borderRadius: 4,
                            width: `${progress.percent}%`,
                            background: progress.percent >= 100 ? 'var(--success)' : 'var(--primary)',
                            transition: 'width 0.5s ease',
                          }} />
                        </div>
                      </div>
                    ) : (
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 13, padding: '6px 12px' }}
                        onClick={() => handleFetchSatellite(farm.id)}
                      >
                        <Satellite size={14} />
                        Fetch Satellite Data
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {
        farms.length === 0 && !showForm && (
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

import { useState, useEffect, useRef, useCallback } from 'react'
import { formatDate } from '../utils/formatDate'
import { calculateHealthScore } from '../utils/healthScore'
import { MapPin, Leaf, Droplets, Plus, Edit3, Trash2, X, Check, Navigation, Satellite, Scan, Footprints, Search } from 'lucide-react'
import { getFarms, getFarmSatellite, createFarm, updateFarm, deleteFarm, triggerSatelliteDownload, getTaskStatus, autoDetectBoundary, saveFarmBoundary, detectLocation, searchParcels } from '../api'
import WalkMyFarm from '../components/WalkMyFarm'
import ParcelLookup from '../components/ParcelLookup'
import { useAuth } from '../context/AuthContext'
import LOCATIONS from '../data/locations.json'
import { getCurrentPosition } from '../utils/native'
import { usePlatform } from '../context/PlatformContext'
import { Link } from 'react-router-dom'

const emptyForm = {
  name: '', district: '', sector: '', cell: '', village: '', province: '', crop_type: '',
  area: '', latitude: '', longitude: '',
}

// Map parcel DB province names to LOCATIONS.json dropdown values
const PROVINCE_MAP = {
  'Northern': 'North',
  'Southern': 'South',
  'Eastern': 'East',
  'Western': 'West',
  'Kigali City': 'Kigali',
  'North': 'North',
  'South': 'South',
  'East': 'East',
  'West': 'West',
  'Kigali': 'Kigali',
}

export default function Farms() {
  const { isWeb } = usePlatform()
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

  // UPI search state
  const [upiQuery, setUpiQuery] = useState('')
  const [upiSearching, setUpiSearching] = useState(false)
  const [upiResults, setUpiResults] = useState([])
  const [upiError, setUpiError] = useState(null)
  const [selectedParcelBoundary, setSelectedParcelBoundary] = useState(null)

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

  // Search parcel by UPI and auto-fill form
  const handleUpiSearch = async () => {
    if (!upiQuery.trim()) return
    setUpiSearching(true)
    setUpiError(null)
    setUpiResults([])
    try {
      const res = await searchParcels(upiQuery.trim(), 10)
      if (res.data.length === 0) {
        setUpiError('No parcel found for this UPI.')
      } else if (res.data.length === 1) {
        applyParcelToForm(res.data[0])
      } else {
        setUpiResults(res.data)
      }
    } catch (err) {
      setUpiError(err.response?.data?.detail || 'UPI search failed.')
    }
    setUpiSearching(false)
  }

  // Auto-fill form from a parcel
  const applyParcelToForm = (parcel) => {
    // Map parcel province name to LOCATIONS.json dropdown value
    const mappedProvince = PROVINCE_MAP[parcel.province] || parcel.province || ''
    setFormData(prev => ({
      ...prev,
      name: prev.name || `Farm ${parcel.upi}`,
      province: mappedProvince || prev.province,
      district: parcel.district || prev.district,
      sector: parcel.sector || prev.sector,
      cell: parcel.cell || prev.cell,
      village: parcel.village || prev.village,
      latitude: parcel.centroid_lat ? String(parcel.centroid_lat.toFixed(6)) : prev.latitude,
      longitude: parcel.centroid_lon ? String(parcel.centroid_lon.toFixed(6)) : prev.longitude,
      area: parcel.area_hectares ? String(parcel.area_hectares) : prev.area,
    }))
    setSelectedParcelBoundary(parcel.boundary_geojson || null)
    setUpiResults([])
    setUpiError(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      // Build location string with all available detail
      const locationParts = [formData.district, formData.sector, formData.cell, formData.village].filter(Boolean)
      const payload = {
        name: formData.name,
        location: locationParts.join(' - '),
        province: formData.province || null,
        crop_type: formData.crop_type || null,
        area: formData.area ? parseFloat(formData.area) : null,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
        boundary: selectedParcelBoundary || undefined,
      }
      if (editingId) {
        await updateFarm(editingId, payload)
      } else {
        const res = await createFarm(payload)
        // If we have a parcel boundary, also save it to the new farm
        if (selectedParcelBoundary && res.data?.id) {
          try { await saveFarmBoundary(res.data.id, selectedParcelBoundary) } catch (e) { /* non-critical */ }
        }
      }
      setShowForm(false)
      setEditingId(null)
      setFormData(emptyForm)
      setSelectedParcelBoundary(null)
      setUpiQuery('')
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save farm')
    }
    setSubmitting(false)
  }

  const handleEdit = (farm) => {
    const parts = (farm.location || '').split(' - ')
    const [dist, sect, cel, vil] = [parts[0] || '', parts[1] || '', parts[2] || '', parts[3] || '']
    setFormData({
      name: farm.name || '',
      district: dist,
      sector: sect,
      cell: cel,
      village: vil,
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

  const handleGetLocation = async () => {
    setGeoLoading(true)
    setGeoError(null)
    try {
      const { latitude: lat, longitude: lon } = await getCurrentPosition()
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
            district: district || '',
            sector: '',
          }))
        }
      } catch (err) {
        console.error("Failed to detect location details:", err)
      }
    } catch (err) {
      setGeoError(err.message)
    }
    setGeoLoading(false)
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
          onClick={() => { setShowForm(!showForm); setEditingId(null); setFormData(emptyForm) }}
        >
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Register Farm</>}
        </button>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 10 }}>{error}</div>}

      {/* Registration / Edit Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <h3>{editingId ? 'Edit Farm' : 'Register New Farm'}</h3>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit}>
              {/* UPI Quick Search */}
              {!editingId && (
                <div style={{ marginBottom: 16, padding: 14, borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                    <Search size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                    Quick Fill from UPI (Official Land Parcel)
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="form-control"
                      value={upiQuery}
                      onChange={e => setUpiQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleUpiSearch())}
                      placeholder="e.g. 4/03/10/01/136"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleUpiSearch}
                      disabled={upiSearching || !upiQuery.trim()}
                      style={{ whiteSpace: 'nowrap', padding: '6px 16px' }}
                    >
                      {upiSearching ? 'Searching...' : 'Find Parcel'}
                    </button>
                  </div>
                  {upiError && <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>{upiError}</div>}
                  {selectedParcelBoundary && <div style={{ color: '#34d399', fontSize: 12, marginTop: 6 }}>Parcel boundary loaded — will be saved with farm.</div>}
                  {upiResults.length > 1 && (
                    <div style={{ marginTop: 8, maxHeight: 160, overflowY: 'auto' }}>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Multiple parcels found — select one:</div>
                      {upiResults.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyParcelToForm(p)}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            width: '100%', padding: '8px 10px', marginBottom: 4, borderRadius: 6,
                            border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                            color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontSize: 12,
                          }}
                        >
                          <span><b>{p.upi}</b> — {[p.village, p.cell, p.sector].filter(Boolean).join(', ')}</span>
                          <span style={{ color: 'var(--primary)' }}>{p.area_hectares ? `${p.area_hectares} ha` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                  <label>Cell</label>
                  <input
                    className="form-control"
                    name="cell"
                    value={formData.cell}
                    onChange={handleChange}
                    placeholder="e.g. Ruhengeri"
                  />
                </div>
                <div className="form-group">
                  <label>Village</label>
                  <input
                    className="form-control"
                    name="village"
                    value={formData.village}
                    onChange={handleChange}
                    placeholder="e.g. Kabeza"
                  />
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
                    step="any"
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

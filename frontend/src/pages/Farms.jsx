import { useState, useEffect, useRef } from 'react'
import { MapPin, Leaf, Droplets, Plus, Edit3, Trash2, Camera, X, Check, Navigation } from 'lucide-react'
import { getFarms, getFarmSatellite, createFarm, updateFarm, deleteFarm, classifyDisease } from '../api'
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

  // Leaf scan state
  const [scanFarmId, setScanFarmId] = useState(null)
  const [scanResult, setScanResult] = useState({})
  const [scanning, setScanning] = useState({})
  const fileInputRef = useRef(null)

  // GPS state
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState(null)

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
      (position) => {
        setFormData(prev => ({
          ...prev,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }))
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

  const handleScanClick = (farmId) => {
    setScanFarmId(farmId)
    fileInputRef.current?.click()
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !scanFarmId) return
    e.target.value = ''

    const farm = farms.find(f => f.id === scanFarmId)
    const cropType = farm?.crop_type?.split(',')[0]?.trim() || undefined

    setScanning(prev => ({ ...prev, [scanFarmId]: true }))
    try {
      const res = await classifyDisease(file, cropType)
      setScanResult(prev => ({ ...prev, [scanFarmId]: res.data }))
    } catch (err) {
      setScanResult(prev => ({
        ...prev,
        [scanFarmId]: { error: err.response?.data?.detail || 'Classification failed' },
      }))
    }
    setScanning(prev => ({ ...prev, [scanFarmId]: false }))
    setScanFarmId(null)
  }

  if (loading) return <div className="loading"><div className="spinner" /><p>Loading farms...</p></div>

  return (
    <>
      {/* Hidden file input for leaf scan */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="image/*"
        onChange={handleFileSelect}
      />

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
              {/* GPS Button */}
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
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
                {formData.latitude && formData.longitude && (
                  <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>
                    ✓ Coordinates set: {formData.latitude}, {formData.longitude}
                  </span>
                )}
                {geoError && (
                  <span style={{ fontSize: 12, color: 'var(--danger)' }}>{geoError}</span>
                )}
              </div>
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
          const ndviStatus = ndvi == null ? 'unknown' : ndvi >= 0.6 ? 'healthy' : ndvi >= 0.4 ? 'moderate' : 'high'
          const result = scanResult[farm.id]
          const isScanning = scanning[farm.id]

          return (
            <div key={farm.id} className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>{farm.name}</h3>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`badge ${ndviStatus}`}>
                    {ndviStatus === 'unknown' ? 'No data' : ndviStatus}
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
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>NDVI</span>
                    <div style={{ fontWeight: 500 }}>{ndvi != null ? ndvi.toFixed(3) : '—'}</div>
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
                </div>

                {/* NDVI Bar */}
                {ndvi != null && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>NDVI</span>
                      <span style={{ fontWeight: 600 }}>{ndvi.toFixed(3)}</span>
                    </div>
                    <div className="confidence-bar">
                      <div
                        className="confidence-fill"
                        style={{
                          width: `${ndvi * 100}%`,
                          background: ndvi >= 0.6 ? 'var(--success)' : ndvi >= 0.4 ? 'var(--warning)' : 'var(--danger)',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Scan Leaf Button */}
                <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 13, padding: '6px 12px' }}
                    onClick={() => handleScanClick(farm.id)}
                    disabled={isScanning}
                  >
                    <Camera size={14} />
                    {isScanning ? 'Scanning...' : 'Scan Leaf'}
                  </button>
                </div>

                {/* Scan Result */}
                {result && !result.error && (
                  <div style={{
                    marginTop: 12, padding: 12, borderRadius: 8,
                    background: 'var(--success-light, #f0fdf4)', border: '1px solid var(--success, #16a34a)',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      {result.predicted_disease || result.disease || 'Unknown'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Confidence: {((result.confidence || 0) * 100).toFixed(1)}%
                      {result.crop && <> | Crop: {result.crop}</>}
                    </div>
                    {result.is_healthy && (
                      <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500, marginTop: 4 }}>
                        Plant appears healthy
                      </div>
                    )}
                  </div>
                )}
                {result?.error && (
                  <div style={{
                    marginTop: 12, padding: 12, borderRadius: 8,
                    background: '#fef2f2', border: '1px solid var(--danger)',
                    fontSize: 13, color: 'var(--danger)',
                  }}>
                    {result.error}
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

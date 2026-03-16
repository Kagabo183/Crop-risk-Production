import { useState, useEffect, useCallback } from 'react'
import {
  MapPin, Leaf, Navigation, Scan, Footprints, Search, Check,
  ChevronRight, ChevronLeft, X, Loader, Square, Maximize2, Info
} from 'lucide-react'
import MapboxFieldMap from './MapboxFieldMap'
import WalkMyFarm from './WalkMyFarm'
import ParcelLookup from './ParcelLookup'
import LOCATIONS from '../data/locations.json'
import { getCurrentPosition } from '../utils/native'
import {
  createFarm, updateFarm, searchParcels, autoDetectBoundary,
  saveFarmBoundary, detectLocation
} from '../api'

/* ────── Constants ────── */
const PROVINCE_MAP = {
  Northern: 'North', Southern: 'South', Eastern: 'East',
  Western: 'West', 'Kigali City': 'Kigali',
  North: 'North', South: 'South', East: 'East', West: 'West', Kigali: 'Kigali',
}

const STEPS = [
  { key: 'info', label: 'Farm Info', icon: Leaf },
  { key: 'location', label: 'Location', icon: MapPin },
  { key: 'boundary', label: 'Boundaries', icon: Maximize2 },
  { key: 'review', label: 'Review & Save', icon: Check },
]

const emptyForm = {
  name: '', district: '', sector: '', cell: '', village: '',
  province: '', crop_type: '', area: '', latitude: '', longitude: '', planting_date: '', season: '',
}

// Geodesic area from polygon coordinates (Shoelace formula)
function calcAreaHectares(coords) {
  if (!coords || coords.length < 3) return 0
  const R = 6378137.0
  let total = 0
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length
    const [lon1, lat1] = coords[i]
    const [lon2, lat2] = coords[j]
    const rLat1 = (lat1 * Math.PI) / 180
    const rLat2 = (lat2 * Math.PI) / 180
    const rLon1 = (lon1 * Math.PI) / 180
    const rLon2 = (lon2 * Math.PI) / 180
    total += (rLon2 - rLon1) * (2 + Math.cos(rLat1) + Math.cos(rLat2))
  }
  return Math.abs((total * R * R) / 2.0) / 10000
}

export default function FarmRegistrationWizard({ editingFarm, onSaved, onCancel }) {
  const [step, setStep] = useState(0)
  const [formData, setFormData] = useState(emptyForm)
  const [boundary, setBoundary] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // UPI state
  const [upiQuery, setUpiQuery] = useState('')
  const [upiSearching, setUpiSearching] = useState(false)
  const [upiResults, setUpiResults] = useState([])
  const [upiError, setUpiError] = useState(null)

  // GPS state
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState(null)

  // Boundary tools state
  const [boundaryLoading, setBoundaryLoading] = useState(false)
  const [boundaryResult, setBoundaryResult] = useState(null)
  const [boundaryError, setBoundaryError] = useState(null)
  const [showWalkMyFarm, setShowWalkMyFarm] = useState(false)
  const [showParcelLookup, setShowParcelLookup] = useState(false)

  // Pre-fill on edit
  useEffect(() => {
    if (editingFarm) {
      const parts = (editingFarm.location || '').split(' - ')
      setFormData({
        name: editingFarm.name || '',
        district: parts[0] || '',
        sector: parts[1] || '',
        cell: parts[2] || '',
        village: parts[3] || '',
        province: editingFarm.province || '',
        crop_type: editingFarm.crop_type || '',
        area: editingFarm.area != null ? String(editingFarm.area) : '',
        latitude: editingFarm.latitude != null ? String(editingFarm.latitude) : '',
        longitude: editingFarm.longitude != null ? String(editingFarm.longitude) : '',
        planting_date: editingFarm.planting_date || '',
        season: editingFarm.season || '',
      })
      // TODO: load existing boundary if available
    }
  }, [editingFarm])

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  /* ────── UPI Search ────── */
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
        applyParcel(res.data[0])
      } else {
        setUpiResults(res.data)
      }
    } catch (err) {
      setUpiError(err.response?.data?.detail || 'UPI search failed.')
    }
    setUpiSearching(false)
  }

  const applyParcel = (parcel) => {
    const mapped = PROVINCE_MAP[parcel.province] || parcel.province || ''
    setFormData(prev => ({
      ...prev,
      name: prev.name || `Farm ${parcel.upi}`,
      province: mapped || prev.province,
      district: parcel.district || prev.district,
      sector: parcel.sector || prev.sector,
      cell: parcel.cell || prev.cell,
      village: parcel.village || prev.village,
      latitude: parcel.centroid_lat ? String(parcel.centroid_lat.toFixed(6)) : prev.latitude,
      longitude: parcel.centroid_lon ? String(parcel.centroid_lon.toFixed(6)) : prev.longitude,
      area: parcel.area_hectares ? String(parcel.area_hectares) : prev.area,
    }))
    if (parcel.boundary_geojson) setBoundary(parcel.boundary_geojson)
    setUpiResults([])
    setUpiError(null)
  }

  /* ────── GPS ────── */
  const handleGetLocation = async () => {
    setGeoLoading(true)
    setGeoError(null)
    try {
      const { latitude: lat, longitude: lon } = await getCurrentPosition()
      setFormData(prev => ({ ...prev, latitude: lat.toFixed(6), longitude: lon.toFixed(6) }))
      try {
        const res = await detectLocation(lat, lon)
        if (res.data.success) {
          setFormData(prev => ({
            ...prev,
            province: res.data.province || prev.province,
            district: res.data.district || prev.district,
            sector: '',
          }))
        }
      } catch { /* non-critical */ }
    } catch (err) {
      setGeoError(err.message)
    }
    setGeoLoading(false)
  }

  /* ────── Map callbacks ────── */
  const handleLocationChange = useCallback((lat, lng) => {
    setFormData(prev => ({ ...prev, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }))
  }, [])

  const handleBoundaryChange = useCallback((geom, areaHaOverride = null) => {
    setBoundary(geom)
    if (!geom) return
    const area = areaHaOverride != null && !Number.isNaN(areaHaOverride)
      ? areaHaOverride
      : (geom.coordinates && geom.coordinates[0] ? calcAreaHectares(geom.coordinates[0]) : 0)
    if (area > 0) {
      setFormData(prev => ({ ...prev, area: area.toFixed(2) }))
    }
  }, [])

  /* ────── Auto-detect boundary (works without farm ID) ────── */
  const handleAutoDetect = async () => {
    if (!formData.latitude || !formData.longitude) {
      setBoundaryError('Set farm coordinates first (use GPS or click map)')
      return
    }
    setBoundaryLoading(true)
    setBoundaryError(null)
    setBoundaryResult(null)
    try {
      if (editingFarm?.id) {
        // Existing farm — use dedicated endpoint
        const res = await autoDetectBoundary(editingFarm.id, 200)
        if (res.data.success) {
          setBoundaryResult(res.data)
          setBoundary(res.data.boundary)
          setFormData(prev => ({ ...prev, area: res.data.area_ha.toFixed(2) }))
          await saveFarmBoundary(editingFarm.id, res.data.boundary)
        }
      } else {
        // New farm — use the map component's auto-detect
        setBoundaryError('Draw a boundary manually, use GPS walk, or save the farm first then auto-detect.')
      }
    } catch (err) {
      setBoundaryError(err.response?.data?.detail || 'Auto-detect failed. Try drawing manually.')
    }
    setBoundaryLoading(false)
  }

  /* ────── Submit ────── */
  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    let savedFarm = null
    try {
      const locationParts = [formData.district, formData.sector, formData.cell, formData.village].filter(Boolean)
      const payload = {
        name: formData.name,
        location: locationParts.join(' - '),
        province: formData.province || null,
        crop_type: formData.crop_type || null,
        area: formData.area ? parseFloat(formData.area) : null,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
        planting_date: formData.planting_date || null,
        season: formData.season || null,
        boundary: boundary || undefined,
      }
      if (editingFarm?.id) {
        const res = await updateFarm(editingFarm.id, payload)
        savedFarm = res.data ? { ...editingFarm, ...res.data } : { ...editingFarm, ...payload, id: editingFarm.id }
        if (boundary) {
          try { await saveFarmBoundary(editingFarm.id, boundary) } catch { /* saved with update */ }
        }
      } else {
        const res = await createFarm(payload)
        savedFarm = res.data || null
        if (boundary && res.data?.id) {
          try { await saveFarmBoundary(res.data.id, boundary) } catch { /* non-critical */ }
        }
      }
      if (onSaved) onSaved(savedFarm)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save farm')
    }
    setSubmitting(false)
  }

  /* ────── Validation per step ────── */
  const canProceed = () => {
    if (step === 0) return formData.name.trim() && formData.province && formData.district
    if (step === 1) return true // location is optional but encouraged
    if (step === 2) return true // boundary is optional
    return true
  }

  const goNext = () => { if (step < STEPS.length - 1 && canProceed()) setStep(step + 1) }
  const goBack = () => { if (step > 0) setStep(step - 1) }

  /* ────── Districts & Sectors from locations.json ────── */
  const districts = LOCATIONS.provinces.find(p => p.name === formData.province)?.districts || []
  const sectors = districts.find(d => d.name === formData.district)?.sectors || []

  /* ══════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════ */

  return (
    <div className="wizard-overlay">
      <div className="wizard-container">
        {/* Header */}
        <div className="wizard-header">
          <h2>{editingFarm ? 'Edit Farm' : 'Register New Farm'}</h2>
          <button className="wizard-close" onClick={onCancel} title="Cancel">
            <X size={20} />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="wizard-steps">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const state = i < step ? 'done' : i === step ? 'active' : 'pending'
            return (
              <div key={s.key} className={`wizard-step ${state}`} onClick={() => i < step && setStep(i)}>
                <div className="wizard-step-circle">
                  {state === 'done' ? <Check size={14} /> : <Icon size={14} />}
                </div>
                <span className="wizard-step-label">{s.label}</span>
                {i < STEPS.length - 1 && <div className="wizard-step-line" />}
              </div>
            )
          })}
        </div>

        {/* Content */}
        <div className="wizard-body">
          {/* ────── STEP 1: Farm Info ────── */}
          {step === 0 && (
            <div className="wizard-step-content">
              {/* UPI Quick Search */}
              {!editingFarm && (
                <div className="wizard-upi-box">
                  <label className="wizard-label">
                    <Search size={14} />
                    Quick Fill from UPI (Official Land Parcel)
                  </label>
                  <div className="wizard-upi-row">
                    <input
                      className="form-control"
                      value={upiQuery}
                      onChange={e => setUpiQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleUpiSearch())}
                      placeholder="e.g. 4/03/10/01/136"
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleUpiSearch}
                      disabled={upiSearching || !upiQuery.trim()}
                    >
                      {upiSearching ? <Loader size={14} className="spin" /> : 'Find'}
                    </button>
                  </div>
                  {upiError && <div className="wizard-upi-error">{upiError}</div>}
                  {boundary && !editingFarm && (
                    <div className="wizard-upi-success">Parcel boundary loaded — will be saved with farm.</div>
                  )}
                  {upiResults.length > 1 && (
                    <div className="wizard-upi-results">
                      <div className="wizard-upi-hint">Multiple parcels found — select one:</div>
                      {upiResults.map(p => (
                        <button key={p.id} type="button" className="wizard-upi-item" onClick={() => applyParcel(p)}>
                          <span><strong>{p.upi}</strong> — {[p.village, p.cell, p.sector].filter(Boolean).join(', ')}</span>
                          <span className="wizard-upi-area">{p.area_hectares ? `${p.area_hectares} ha` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="wizard-form-grid">
                <div className="form-group">
                  <label>Farm Name <span className="required">*</span></label>
                  <input
                    className="form-control"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="e.g. Musanze Highland Farm"
                  />
                </div>
                <div className="form-group">
                  <label>Province <span className="required">*</span></label>
                  <select
                    className="form-control"
                    name="province"
                    value={formData.province}
                    onChange={e => setFormData(prev => ({ ...prev, province: e.target.value, district: '', sector: '' }))}
                  >
                    <option value="">Select province</option>
                    {(LOCATIONS?.provinces || []).map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>District <span className="required">*</span></label>
                  <select
                    className="form-control"
                    name="district"
                    value={formData.district}
                    onChange={e => setFormData(prev => ({ ...prev, district: e.target.value, sector: '' }))}
                    disabled={!formData.province}
                  >
                    <option value="">Select district</option>
                    {districts.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
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
                  >
                    <option value="">Select sector</option>
                    {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Cell</label>
                  <input className="form-control" name="cell" value={formData.cell} onChange={handleChange} placeholder="e.g. Ruhengeri" />
                </div>
                <div className="form-group">
                  <label>Village</label>
                  <input className="form-control" name="village" value={formData.village} onChange={handleChange} placeholder="e.g. Kabeza" />
                </div>
                <div className="form-group">
                  <label>Crop Types</label>
                  <input className="form-control" name="crop_type" value={formData.crop_type} onChange={handleChange} placeholder="e.g. potato, maize, beans" />
                  <small className="form-hint">Comma-separated for multiple crops</small>
                </div>
                <div className="form-group">
                  <label>Planting Date</label>
                  <input className="form-control" type="date" name="planting_date" value={formData.planting_date} onChange={handleChange} />
                </div>
                <div className="form-group">
                  <label>Season</label>
                  <input className="form-control" name="season" value={formData.season} onChange={handleChange} placeholder="e.g. 2026A" />
                </div>
                <div className="form-group">
                  <label>Area (hectares)</label>
                  <input className="form-control" name="area" type="number" step="any" min="0" value={formData.area} onChange={handleChange} placeholder="e.g. 2.5" />
                  <small className="form-hint">Auto-calculated if you draw a boundary</small>
                </div>
              </div>
            </div>
          )}

          {/* ────── STEP 2: Location ────── */}
          {step === 1 && (
            <div className="wizard-step-content">
              <div className="wizard-info-banner">
                <Info size={14} />
                <span>Click on the map to set your farm location, or use GPS. Coordinates are validated for Rwanda.</span>
              </div>

              <div className="wizard-location-controls">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleGetLocation}
                  disabled={geoLoading}
                >
                  <Navigation size={14} />
                  {geoLoading ? 'Locating...' : 'Use My Location'}
                </button>

                <div className="wizard-coord-inputs">
                  <div className="form-group compact">
                    <label>Latitude</label>
                    <input
                      className="form-control"
                      name="latitude"
                      type="number"
                      step="0.000001"
                      value={formData.latitude}
                      onChange={handleChange}
                      placeholder="-2.4834"
                    />
                  </div>
                  <div className="form-group compact">
                    <label>Longitude</label>
                    <input
                      className="form-control"
                      name="longitude"
                      type="number"
                      step="0.000001"
                      value={formData.longitude}
                      onChange={handleChange}
                      placeholder="28.9080"
                    />
                  </div>
                </div>

                {formData.latitude && formData.longitude && (
                  <span className="wizard-coord-ok">
                    <Check size={12} /> {formData.latitude}, {formData.longitude}
                  </span>
                )}
                {geoError && <span className="wizard-coord-err">{geoError}</span>}
              </div>

              <div className="wizard-map-wrap">
                <MapboxFieldMap
                  initialBoundary={boundary}
                  onLocationChange={handleLocationChange}
                  onBoundaryChange={handleBoundaryChange}
                  onAreaChange={(area) => area && setFormData(prev => ({ ...prev, area: area.toFixed(2) }))}
                />
              </div>
            </div>
          )}

          {/* ────── STEP 3: Boundaries ────── */}
          {step === 2 && (
            <div className="wizard-step-content">
              <div className="wizard-info-banner">
                <Info size={14} />
                <span>Draw your farm boundary on the map, walk the perimeter with GPS, or auto-detect from satellite data.</span>
              </div>

              <div className="wizard-boundary-tools">
                {editingFarm?.id && formData.latitude && formData.longitude && (
                  <button
                    className="btn wizard-tool-btn auto-detect"
                    type="button"
                    onClick={handleAutoDetect}
                    disabled={boundaryLoading}
                  >
                    <Scan size={16} />
                    {boundaryLoading ? 'Detecting...' : 'Auto-Detect Boundary'}
                  </button>
                )}

                {formData.latitude && formData.longitude && (
                  <button
                    className="btn wizard-tool-btn walk"
                    type="button"
                    onClick={() => setShowWalkMyFarm(!showWalkMyFarm)}
                  >
                    <Footprints size={16} />
                    {showWalkMyFarm ? 'Hide Walk Tool' : 'Walk My Farm'}
                  </button>
                )}

                {editingFarm?.id && (
                  <button
                    className="btn wizard-tool-btn parcel"
                    type="button"
                    onClick={() => setShowParcelLookup(!showParcelLookup)}
                  >
                    <MapPin size={16} />
                    Find My Parcel
                  </button>
                )}
              </div>

              {/* Boundary results */}
              {boundaryResult && (
                <div className="wizard-boundary-success">
                  <strong>Farm Boundary Detected & Saved!</strong>
                  <div>Area: {boundaryResult.area_ha} ha · Confidence: {(boundaryResult.confidence * 100).toFixed(0)}%</div>
                  {boundaryResult.land_cover && (
                    <div>Crop: {(boundaryResult.land_cover.crops * 100).toFixed(0)}% · Forest: {(boundaryResult.land_cover.trees * 100).toFixed(0)}%</div>
                  )}
                </div>
              )}
              {boundaryError && <div className="wizard-boundary-warn">{boundaryError}</div>}

              {/* Walk My Farm */}
              {showWalkMyFarm && formData.latitude && formData.longitude && (
                <div className="wizard-walk-wrap">
                  <WalkMyFarm
                    farmId={editingFarm?.id || null}
                    farmLat={parseFloat(formData.latitude)}
                    farmLon={parseFloat(formData.longitude)}
                    onSaved={(areaHa) => {
                      setFormData(prev => ({ ...prev, area: areaHa.toFixed(2) }))
                      setShowWalkMyFarm(false)
                    }}
                    onClose={() => setShowWalkMyFarm(false)}
                  />
                </div>
              )}

              {/* Parcel Lookup */}
              {showParcelLookup && editingFarm?.id && (
                <ParcelLookup
                  farmId={editingFarm.id}
                  farmLat={parseFloat(formData.latitude)}
                  farmLon={parseFloat(formData.longitude)}
                  onSaved={(areaHa) => {
                    setFormData(prev => ({ ...prev, area: areaHa.toFixed(2) }))
                    setShowParcelLookup(false)
                  }}
                  onClose={() => setShowParcelLookup(false)}
                />
              )}

              {/* Interactive boundary map */}
              <div className="wizard-map-wrap">
                <MapboxFieldMap
                  initialBoundary={boundary}
                  onLocationChange={handleLocationChange}
                  onBoundaryChange={handleBoundaryChange}
                  onAreaChange={(area) => area && setFormData(prev => ({ ...prev, area: area.toFixed(2) }))}
                />
              </div>

              {boundary && (
                <div className="wizard-boundary-info">
                  <Check size={14} />
                  <span>Boundary set · {formData.area ? `${formData.area} ha` : 'Calculating area...'}</span>
                  <button type="button" className="wizard-link-btn" onClick={() => { setBoundary(null); setBoundaryResult(null) }}>
                    Clear boundary
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ────── STEP 4: Review & Save ────── */}
          {step === 3 && (
            <div className="wizard-step-content">
              <div className="wizard-review">
                <h3 className="wizard-review-title">Review Your Farm</h3>

                <div className="wizard-review-grid">
                  <div className="wizard-review-section">
                    <h4><Leaf size={14} /> Farm Details</h4>
                    <dl className="wizard-review-dl">
                      <dt>Name</dt><dd>{formData.name || '—'}</dd>
                      <dt>Province</dt><dd>{formData.province || '—'}</dd>
                      <dt>District</dt><dd>{formData.district || '—'}</dd>
                      <dt>Sector</dt><dd>{formData.sector || '—'}</dd>
                      {formData.cell && <><dt>Cell</dt><dd>{formData.cell}</dd></>}
                      {formData.village && <><dt>Village</dt><dd>{formData.village}</dd></>}
                      <dt>Crops</dt><dd>{formData.crop_type || '—'}</dd>
                      <dt>Area</dt><dd>{formData.area ? `${formData.area} ha` : '—'}</dd>
                    </dl>
                  </div>

                  <div className="wizard-review-section">
                    <h4><MapPin size={14} /> Location & Boundary</h4>
                    <dl className="wizard-review-dl">
                      <dt>Coordinates</dt>
                      <dd>{formData.latitude && formData.longitude ? `${formData.latitude}, ${formData.longitude}` : 'Not set'}</dd>
                      <dt>Boundary</dt>
                      <dd>{boundary ? 'Defined' : 'Not set'}</dd>
                    </dl>
                    {formData.latitude && formData.longitude && (
                      <div className="wizard-review-map">
                        <MapboxFieldMap
                          initialBoundary={boundary}
                          readOnly
                          existingFields={boundary ? [{ id: editingFarm?.id || 'draft', name: formData.name, boundary_geojson: boundary, ndvi: null }] : []}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {!formData.latitude && !formData.longitude && (
                  <div className="wizard-review-warn">
                    <Info size={14} />
                    <span>No coordinates set. You can still save, but satellite monitoring requires coordinates.</span>
                  </div>
                )}

                {error && <div className="wizard-error">{error}</div>}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="wizard-footer">
          <button className="btn btn-secondary" onClick={step === 0 ? onCancel : goBack}>
            {step === 0 ? (
              <><X size={14} /> Cancel</>
            ) : (
              <><ChevronLeft size={14} /> Back</>
            )}
          </button>

          <div className="wizard-footer-info">
            Step {step + 1} of {STEPS.length}
          </div>

          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" onClick={goNext} disabled={!canProceed()}>
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || !formData.name.trim()}>
              <Check size={14} />
              {submitting ? 'Saving...' : editingFarm ? 'Update Farm' : 'Register Farm'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

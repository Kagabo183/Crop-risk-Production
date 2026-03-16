import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  BarChart2,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Filter,
  Leaf,
  Layers,
  Map as MapIcon,
  MapPin,
  Plus,
  Satellite,
  Search,
} from 'lucide-react'
import MapboxFieldMap from '../components/MapboxFieldMap'
import FieldIntelligencePanel from '../components/FieldIntelligencePanel'
import {
  autoFetchSatellite,
  createFarm,
  getFarmMetrics,
  getFarmSatellite,
  getFarms,
  getGeoNdviTiles,
  getNdviHistory,
  saveFarmBoundary,
  getTaskStatus,
  getWeatherForecast,
  updateFarm,
} from '../api'
import { formatDate } from '../utils/formatDate'

const NDVI_BANDS = [
  { label: '<0.2', color: '#d92d20' },
  { label: '0.2-0.3', color: '#f97316' },
  { label: '0.3-0.4', color: '#fbbf24' },
  { label: '0.4-0.6', color: '#a3e635' },
  { label: '>0.6', color: '#166534' },
]

const RAIL_ITEMS = [
  { icon: MapIcon, label: 'Map cockpit' },
  { icon: Layers, label: 'Layers' },
  { icon: Leaf, label: 'Vegetation' },
  { icon: CloudRain, label: 'Weather' },
  { icon: Satellite, label: 'Satellite tasks' },
  { icon: BarChart2, label: 'Analytics' },
]

const ndviColor = (v) => {
  if (v == null) return '#cbd5e1'
  if (v < 0.2) return '#d92d20'
  if (v < 0.3) return '#f97316'
  if (v < 0.4) return '#fbbf24'
  if (v < 0.5) return '#a3e635'
  return '#166534'
}

const getFieldStatus = (ndvi) => {
  if (ndvi == null) return { label: 'Awaiting scan', tone: 'pending' }
  if (ndvi < 0.2) return { label: 'Critical', tone: 'critical' }
  if (ndvi < 0.35) return { label: 'Stressed', tone: 'warning' }
  if (ndvi < 0.55) return { label: 'Stable', tone: 'stable' }
  return { label: 'Thriving', tone: 'healthy' }
}

const formatArea = (area) => `${Number(area || 0).toFixed(1)} ha`

export default function SatelliteDashboard() {
  const [farms, setFarms] = useState([])
  const [satellite, setSatellite] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedFarmId, setSelectedFarmId] = useState(null)
  const [fieldHistory, setFieldHistory] = useState([])
  const [weatherSummary, setWeatherSummary] = useState(null)
  const [intelLoading, setIntelLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [seasonFilter, setSeasonFilter] = useState('all')
  const [sortMode, setSortMode] = useState('latest')
  const [layerMetric, setLayerMetric] = useState('ndvi')
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('intelligentSidebarCollapsed') === 'true'
  })

  const [draftGeometry, setDraftGeometry] = useState(null)
  const [draftArea, setDraftArea] = useState(null)
  const [draftName, setDraftName] = useState('New field')
  const [draftCrop, setDraftCrop] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftError, setDraftError] = useState(null)
  const [tileSource, setTileSource] = useState(null)
  const [tileError, setTileError] = useState(null)

  const fileInputRef = useRef(null)

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

  useEffect(() => () => {
    Object.values(pollTimers.current).forEach(clearInterval)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('intelligentSidebarCollapsed', sidebarCollapsed ? 'true' : 'false')
  }, [sidebarCollapsed])

  const fieldsWithBoundary = useMemo(() => (
    farms
      .map(f => {
        const sat = satellite.find(s => s.id === f.id) || {}
        return {
          ...f,
          ndvi: sat.ndvi ?? sat.ndvi_mean ?? null,
          ndre: sat.ndre ?? sat.ndre_mean ?? null,
          evi: sat.evi ?? sat.evi_mean ?? null,
          savi: sat.savi ?? sat.savi_mean ?? null,
          last_satellite_date: sat.ndvi_date || f.last_satellite_date,
        }
      })
      .filter(f => f.boundary_geojson)
  ), [farms, satellite])

  const seasons = useMemo(() => {
    const unique = Array.from(new Set(farms.map(f => f.season).filter(Boolean)))
    return ['all', ...unique]
  }, [farms])

  const filteredFields = useMemo(() => fieldsWithBoundary.filter(f => {
    const matchesSeason = seasonFilter === 'all' || f.season === seasonFilter
    const matchesSearch = !search.trim() || (f.name || '').toLowerCase().includes(search.toLowerCase())
    return matchesSeason && matchesSearch
  }), [fieldsWithBoundary, seasonFilter, search])

  const sortedFields = useMemo(() => {
    const arr = [...filteredFields]
    switch (sortMode) {
      case 'name':
        return arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      case 'health':
        return arr.sort((a, b) => (b.ndvi ?? -1) - (a.ndvi ?? -1))
      default:
        return arr.sort((a, b) => new Date(b.last_satellite_date || 0) - new Date(a.last_satellite_date || 0))
    }
  }, [filteredFields, sortMode])

  useEffect(() => {
    if (!selectedFarmId && sortedFields.length) {
      setSelectedFarmId(sortedFields[0].id)
    }
  }, [selectedFarmId, sortedFields])

  const selectedFarm = useMemo(() => {
    const base = farms.find(f => f.id === selectedFarmId)
    if (!base) return null
    const sat = satellite.find(s => s.id === selectedFarmId) || {}
    return { ...base, ...sat }
  }, [farms, satellite, selectedFarmId])

  useEffect(() => {
    if (!selectedFarmId) {
      setFieldHistory([])
      setWeatherSummary(null)
      return
    }
    const farm = farms.find(f => f.id === selectedFarmId)
    if (!farm) return

    setIntelLoading(true)
    Promise.allSettled([
      getFarmMetrics(selectedFarmId, 120),
      getNdviHistory(selectedFarmId, 120),
      farm.latitude && farm.longitude
        ? getWeatherForecast(farm.latitude, farm.longitude, 3)
        : Promise.resolve({ data: null }),
    ]).then(([metricsRes, historyRes, weatherRes]) => {
      const metricRows = metricsRes.status === 'fulfilled' ? (metricsRes.value.data?.observations || []) : []
      const historyRows = historyRes.status === 'fulfilled' ? (historyRes.value.data || []) : []

      const normalize = (rows) => rows.map(r => ({
        date: r.date,
        ndvi: r.ndvi_mean ?? r.ndvi ?? null,
        ndre: r.ndre_mean ?? r.ndre ?? null,
        evi: r.evi_mean ?? r.evi ?? null,
        savi: r.savi_mean ?? r.savi ?? null,
        cloud_cover: r.cloud_cover_percent ?? r.cloud_cover,
        health_score: r.health_score,
        ndvi_min: r.ndvi_min,
        ndvi_max: r.ndvi_max,
        ndvi_std: r.ndvi_std,
      }))

      const normalizedMetrics = normalize(metricRows)
      const normalizedHistory = normalize(historyRows)
      setFieldHistory(normalizedMetrics.length ? normalizedMetrics : normalizedHistory)
      setWeatherSummary(weatherRes.status === 'fulfilled' ? weatherRes.value.data : null)
    }).finally(() => setIntelLoading(false))
  }, [selectedFarmId, farms])

  // Fetch raster tiles for the active layer
  useEffect(() => {
    if (!selectedFarmId) {
      setTileSource(null)
      return
    }
    setTileError(null)
    getGeoNdviTiles(selectedFarmId, 45, layerMetric.toUpperCase())
      .then((res) => {
        const data = res.data || {}
        const tiles = data.tiles || (data.tile_url ? [data.tile_url] : data.urls) || data
        if (tiles && tiles.length) {
          setTileSource({ tiles, minzoom: data.minzoom, maxzoom: data.maxzoom, tileSize: data.tile_size })
        } else {
          setTileSource(null)
        }
      })
      .catch(() => {
        setTileError('Live tiles unavailable for this field/index')
        setTileSource(null)
      })
  }, [selectedFarmId, layerMetric])

  const pollTaskProgress = useCallback((farmId, taskId) => {
    if (!farmId || !taskId) return

    // Avoid multiple pollers for the same farm.
    if (pollTimers.current[farmId]) {
      clearInterval(pollTimers.current[farmId])
      delete pollTimers.current[farmId]
    }

    const poll = async () => {
      try {
        const res = await getTaskStatus(taskId)
        const data = res.data || {}
        const state = data.state || data.status
        const percent = Number(data.percent ?? data.progress ?? 0)
        const stage = data.stage || data.message || String(state || 'Processing…')

        setSatProgress(prev => ({ ...prev, [farmId]: { percent, stage, taskId } }))

        if (state === 'SUCCESS' || state === 'FAILURE' || percent >= 100) {
          clearInterval(pollTimers.current[farmId])
          delete pollTimers.current[farmId]
          if (state === 'SUCCESS' || percent >= 100) {
            loadData()
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

  const handleBoundaryChange = (geometry, area) => {
    setDraftGeometry(geometry)
    if (area) setDraftArea(area)
  }

  const resetDraft = () => {
    setDraftGeometry(null)
    setDraftArea(null)
    setDraftName('New field')
    setDraftCrop('')
    setDraftError(null)
  }

  const handleCreateNewFarm = () => {
    setSelectedFarmId(null)
    setDraftGeometry(null)
    setDraftArea(null)
    setDraftName('New Field')
    setDraftCrop('')
    setDraftError(null)
    // Close sidebar on mobile if needed
    if (window.innerWidth < 1200) setSidebarCollapsed(true)
  }

  const handleSaveField = async () => {
    if (!draftGeometry) {
      setDraftError('Draw a polygon or upload GeoJSON first')
      return
    }
    setDraftError(null)
    setSavingDraft(true)
    try {
      const targetFarmId = selectedFarmId && selectedFarm ? selectedFarmId : null

      if (targetFarmId) {
        if (draftArea) {
          await updateFarm(targetFarmId, { size_hectares: draftArea })
        }
        await saveFarmBoundary(targetFarmId, draftGeometry)
        await handleFetchSatellite(targetFarmId)
        loadData()
        setSelectedFarmId(targetFarmId)
      } else {
        const payload = {
          name: draftName || 'New field',
          crop_type: draftCrop || undefined,
          size_hectares: draftArea || undefined,
        }
        const res = await createFarm(payload)
        const farmId = res.data?.id
        if (farmId) {
          await saveFarmBoundary(farmId, draftGeometry)
          await handleFetchSatellite(farmId)
          loadData()
          setSelectedFarmId(farmId)
        }
      }
      resetDraft()
    } catch (err) {
      setDraftError(err.response?.data?.detail || 'Failed to save field')
    } finally {
      setSavingDraft(false)
    }
  }

  const parseGeoJsonText = (text) => {
    try {
      const geo = JSON.parse(text)
      if (geo.type === 'FeatureCollection') return geo.features?.[0]?.geometry
      if (geo.type === 'Feature') return geo.geometry
      if (geo.type === 'Polygon' || geo.type === 'MultiPolygon') return geo
    } catch {}
    return null
  }

  const handleFileUpload = async (file) => {
    setDraftError(null)
    if (!file) return
    const name = file.name.toLowerCase()

    if (name.endsWith('.geojson') || name.endsWith('.json')) {
      const text = await file.text()
      const geometry = parseGeoJsonText(text)
      if (!geometry) throw new Error('Invalid GeoJSON file')
      setDraftGeometry(geometry)
      return
    }

    throw new Error('Unsupported file type. Use GeoJSON (.geojson/.json).')
  }

  const onUploadChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await handleFileUpload(file)
    } catch (err) {
      setDraftError(err.message)
    }
  }

  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev)

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading satellite map…</p>
      </div>
    )
  }

  return (
    <div className={`intelligent-map${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="intelligent-map__rail">
        <div className="rail-brand">CR</div>
        <div className="rail-icons">
          {RAIL_ITEMS.map((item, idx) => (
            <button key={item.label} className={`rail-icon${idx === 0 ? ' active' : ''}`} title={item.label} aria-label={item.label}>
              <item.icon size={18} />
            </button>
          ))}
        </div>
      </div>

      <aside className={`field-sidebar intelligent-sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        <button className="field-sidebar__collapse" onClick={toggleSidebar} aria-label="Toggle field drawer">
          {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        {sidebarCollapsed ? (
          <div className="field-sidebar__collapsed-content">
            <span>Fields</span>
            <button
              onClick={handleCreateNewFarm}
              className="collapsed-add"
              title="Add field"
              style={{ border: 'none', cursor: 'pointer' }}
            >
              <Plus size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className="field-sidebar__header">
              <div>
                <div className="eyebrow">Season</div>
                <select value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)} className="field-sidebar__select">
                  {seasons.map(season => (
                    <option key={season} value={season}>{season === 'all' ? 'All seasons' : season}</option>
                  ))}
                </select>
              </div>
              <Link className="btn btn-secondary" to="/farms">
                Manage
              </Link>
            </div>

            <div className="field-sidebar__filters">
              <div className="field-sidebar__search">
                <Search size={16} />
                <input
                  placeholder="Search fields"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="field-sidebar__sort">
                <Filter size={14} />
                <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                  <option value="latest">Newest scan</option>
                  <option value="health">Health</option>
                  <option value="name">Name A-Z</option>
                </select>
              </div>
            </div>

            <div className="field-sidebar__list">
              {sortedFields.length === 0 && (
                <div className="empty-state" style={{ padding: 24 }}>
                  <p>No mapped fields yet. Add fields on the Farms page.</p>
                </div>
              )}
              {sortedFields.map(f => {
                const status = getFieldStatus(f.ndvi)
                return (
                  <button
                    key={f.id}
                    className={`field-card${selectedFarmId === f.id ? ' active' : ''}`}
                    onClick={() => setSelectedFarmId(f.id)}
                  >
                    <div className="field-card__title-row">
                      <div className="field-card__title">{f.name}</div>
                      <span className={`field-status field-status--${status.tone}`}>{status.label}</span>
                    </div>
                    <div className="field-card__meta">
                      <span className="pill"><Leaf size={12} /> {f.crop_type || 'Crop'}</span>
                      <span className="pill"><MapPin size={12} /> {formatArea(f.size_hectares || f.area)}</span>
                    </div>
                    <div className="field-card__bottom">
                      <div className="ndvi-dot" style={{ background: ndviColor(f.ndvi) }} />
                      <span className="field-card__ndvi">{f.ndvi != null ? f.ndvi.toFixed(3) : 'Awaiting scan'}</span>
                      <span className="field-card__date">{f.last_satellite_date ? formatDate(f.last_satellite_date) : 'No capture yet'}</span>
                      {satProgress[f.id] && (
                        <span className="pill pill-progress">{satProgress[f.id].percent}% · {satProgress[f.id].stage}</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            <button
              className="btn btn-primary"
              onClick={handleCreateNewFarm}
              style={{ justifyContent: 'center' }}
            >
              <Plus size={14} /> Add field
            </button>
          </>
        )}
      </aside>

      <section className="intelligent-map__stage">
        <header className="intelligent-map__header">
          <div>
            <div className="eyebrow">Intelligent Map</div>
            <h2>Satellite agronomy cockpit</h2>
            <p className="map-subtitle">Interrogate every farm polygon with live {layerMetric.toUpperCase()} layers, weather overlays, and instant analytics.</p>
          </div>

          {selectedFarm && (
            <div className="selected-summary">
              <div className="selected-summary__title">{selectedFarm.name}</div>
              <div className="selected-summary__meta">
                <span className="pill"><Leaf size={12} /> {selectedFarm.crop_type || '—'}</span>
                <span className="pill"><MapPin size={12} /> {formatArea(selectedFarm.size_hectares || selectedFarm.area)}</span>
                <span className="pill"><Activity size={12} /> {selectedFarm.ndvi != null ? selectedFarm.ndvi.toFixed(3) : 'Awaiting NDVI'}</span>
                <span className="pill"><CloudRain size={12} /> {selectedFarm.last_satellite_date ? formatDate(selectedFarm.last_satellite_date) : 'No capture yet'}</span>
              </div>
              <div className="selected-summary__actions">
                <button className="btn btn-secondary" onClick={() => handleFetchSatellite(selectedFarm.id)}>
                  <Satellite size={14} /> Rescan field
                </button>
              </div>
            </div>
          )}
        </header>

        <div className={`intelligent-map__canvas${selectedFarm ? ' intel-open' : ''}`}>
          <MapboxFieldMap
            height={700}
            existingFields={fieldsWithBoundary}
            selectedFieldId={selectedFarmId}
            onSelectField={setSelectedFarmId}
            readOnly={false}
            metric={layerMetric}
            onMetricChange={(next) => {
              setLayerMetric(next)
              setOverlayVisible(true)
            }}
            focusOnSelect
            enableDrawing
            initialBoundary={selectedFarm?.boundary_geojson || null}
            onBoundaryChange={handleBoundaryChange}
            onAreaChange={setDraftArea}
            rasterTiles={tileSource}
            rasterVisible={overlayVisible}
            onRasterVisibleChange={setOverlayVisible}
            onUploadGeoJson={() => fileInputRef.current?.click()}
          />

          <input
            type="file"
            accept=".geojson,.json"
            style={{ display: 'none' }}
            onChange={onUploadChange}
            ref={fileInputRef}
          />

          <div className="intelligent-map__legend">
            {NDVI_BANDS.map(band => (
              <span key={band.label} className="legend-item">
                <span style={{ background: band.color }} />{band.label}
              </span>
            ))}
          </div>

          <div className={`intelligent-map__intel${selectedFarm ? ' open' : ''}`}>
            {intelLoading ? (
              <div className="intel-loading">
                <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                Loading intelligence…
              </div>
            ) : (
              <div className="intel-panel-scroll">
                <FieldIntelligencePanel farm={selectedFarm} history={fieldHistory} weather={weatherSummary} />
              </div>
            )}
          </div>
          {draftGeometry && (
            <div className="draft-card">
              <div className="draft-card__header">
                <div>
                  <div className="eyebrow">New field</div>
                  <strong>Save drawn area</strong>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={resetDraft}>Clear</button>
              </div>
              <div className="draft-card__form">
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Field name" />
                <input value={draftCrop} onChange={(e) => setDraftCrop(e.target.value)} placeholder="Crop (optional)" />
                <div className="draft-card__meta">Area: {draftArea ? `${draftArea.toFixed(2)} ha` : '—'}</div>
                <div className="draft-card__actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload GeoJSON
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveField} disabled={savingDraft}>
                    {savingDraft ? 'Saving…' : 'Save & scan'}
                  </button>
                </div>
                {draftError && <div className="error-box" style={{ marginTop: 8 }}>{draftError}</div>}
              </div>
            </div>
          )}
        </div>

        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
        {tileError && <div className="error-box" style={{ marginTop: 12 }}>{tileError}</div>}
      </section>
    </div>
  )
}

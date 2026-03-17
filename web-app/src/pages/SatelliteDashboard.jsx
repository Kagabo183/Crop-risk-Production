import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useNavigate } from 'react-router-dom'

import {

  BarChart2,

  ChevronDown,

  ChevronRight,

  CloudRain,

  Filter,

  FolderPlus,

  Leaf,

  Layers,

  Map as MapIcon,

  MapPin,

  Navigation2,

  Pencil,

  Plus,

  Satellite,

  Search,

  Truck,

  Upload,

  X,

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

  getGeoZones,

  computeGeoZones,

  getNdviHistory,

  quickScanFarm,

  saveFarmBoundary,

  getTaskStatus,

  getWeatherForecast,

  updateFarm,

  fetchOpenMeteo,

} from '../api'

import { formatDate } from '../utils/formatDate'
import { emitFarmDataUpdated } from '../utils/farmEvents'
import { analyzeFarmRisk } from '../api'



const NDVI_BANDS = [

  { label: '<0.2', color: '#d92d20' },

  { label: '0.2-0.3', color: '#f97316' },

  { label: '0.3-0.4', color: '#fbbf24' },

  { label: '0.4-0.6', color: '#a3e635' },

  { label: '>0.6', color: '#166534' },

]



const RAIL_ITEMS = [

  { icon: MapIcon, label: 'Map cockpit', active: true },

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

  const navigate = useNavigate()

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

  const [groupCollapsed, setGroupCollapsed] = useState({ analyzed: false, notAnalyzed: false })



  const [draftGeometry, setDraftGeometry] = useState(null)

  const [draftArea, setDraftArea] = useState(null)

  const [draftName, setDraftName] = useState('New field')

  const [draftCrop, setDraftCrop] = useState('')

  const [savingDraft, setSavingDraft] = useState(false)

  const [draftError, setDraftError] = useState(null)

  const [tileSource, setTileSource] = useState(null)

  const [tileError, setTileError] = useState(null)

  const [isDrawing, setIsDrawing] = useState(false)
  const [creatingField, setCreatingField] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [showMapView, setShowMapView] = useState(true)
  const [activateDraw, setActivateDraw] = useState(false)

  const fileInputRef = useRef(null)
  const addMenuRef = useRef(null)

  const [satProgress, setSatProgress] = useState({})

  const pollTimers = useRef({})

  const [zoneData, setZoneData] = useState({}) // farmId → { zones: [...], geojson: {...} }



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

  // Close add-field menu when clicking outside
  useEffect(() => {
    if (!addMenuOpen) return
    const handler = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setAddMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addMenuOpen])

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

      case 'name': return arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''))

      case 'health': return arr.sort((a, b) => (b.ndvi ?? -1) - (a.ndvi ?? -1))

      default: return arr.sort((a, b) => new Date(b.last_satellite_date || 0) - new Date(a.last_satellite_date || 0))

    }

  }, [filteredFields, sortMode])



  // grouped for sidebar

  const analyzedFields = useMemo(() => sortedFields.filter(f => f.ndvi != null), [sortedFields])

  const notAnalyzedFields = useMemo(() => sortedFields.filter(f => f.ndvi == null), [sortedFields])

  const totalAreaHa = useMemo(() => sortedFields.reduce((s, f) => s + Number(f.size_hectares || f.area || 0), 0), [sortedFields])

  const currentSeason = useMemo(() => {

    const activeSeasons = farms.map(f => f.season).filter(Boolean)

    const latest = activeSeasons.sort().reverse()[0]

    return latest || new Date().getFullYear()

  }, [farms])



  useEffect(() => {

    if (!selectedFarmId && sortedFields.length && !creatingField && !showMapView) {

      setSelectedFarmId(sortedFields[0].id)

    }

  }, [selectedFarmId, sortedFields, creatingField, showMapView])



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

      // Fallback to Open-Meteo if backend weather unavailable

      if ((weatherRes.status !== 'fulfilled' || !weatherRes.value.data) && farm.latitude && farm.longitude) {

        fetchOpenMeteo(farm.latitude, farm.longitude)

          .then(meteo => setWeatherSummary(meteo))

          .catch(() => {})

      }

    }).finally(() => setIntelLoading(false))

    // Load productivity zones for selected field
    if (!zoneData[selectedFarmId]) {
      getGeoZones(selectedFarmId)
        .then(r => { if (r.data) setZoneData(prev => ({ ...prev, [selectedFarmId]: r.data })) })
        .catch(() => {})
    }

  }, [selectedFarmId, farms])



  useEffect(() => {

    if (!selectedFarmId || creatingField) { setTileSource(null); return }

    setTileError(null)

    getGeoNdviTiles(selectedFarmId, 45, layerMetric.toUpperCase())

      .then((res) => {

        const data = res.data || {}

        const tiles = data.tiles || (data.tile_url ? [data.tile_url] : data.urls) || data

        if (tiles && tiles.length) {

          setTileSource({ tiles, minzoom: data.minzoom, maxzoom: data.maxzoom, tileSize: data.tile_size })

        } else { setTileSource(null) }

      })

      .catch(() => { setTileError('Live tiles unavailable for this field/index'); setTileSource(null) })

  }, [selectedFarmId, layerMetric, creatingField])



  const pollTaskProgress = useCallback((farmId, taskId) => {

    if (!farmId || !taskId) return

    if (pollTimers.current[farmId]) { clearInterval(pollTimers.current[farmId]); delete pollTimers.current[farmId] }

    // Kill polling after 3 minutes regardless (prevents stuck UI forever)
    const hardTimeout = setTimeout(() => {
      if (pollTimers.current[farmId]) {
        clearInterval(pollTimers.current[farmId])
        delete pollTimers.current[farmId]
      }
      setSatProgress(prev => ({ ...prev, [farmId]: { percent: 0, stage: 'Scan timed out — please retry' } }))
    }, 3 * 60 * 1000)

    const stopPolling = () => {
      clearTimeout(hardTimeout)
      if (pollTimers.current[farmId]) { clearInterval(pollTimers.current[farmId]); delete pollTimers.current[farmId] }
    }

    const poll = async () => {

      try {

        const res = await getTaskStatus(taskId)

        const data = res.data || {}

        const state = data.state || data.status

        const percent = Number(data.percent ?? data.progress ?? 0)

        const stage = data.stage || data.message || String(state || 'Processing…')

        setSatProgress(prev => ({ ...prev, [farmId]: { percent, stage, taskId } }))

        const isSuccess = state === 'SUCCESS' || (state !== 'FAILURE' && percent >= 100)
        const isFailure = state === 'FAILURE' || stage?.toLowerCase().includes('failed')

        if (isSuccess || isFailure) {

          stopPolling()

          if (isSuccess) {

            loadData()

            // Trigger full risk pipeline + notify all pages
            analyzeFarmRisk(farmId, { forceRefresh: true }).catch(() => {})
            emitFarmDataUpdated(farmId)

            setTimeout(() => setSatProgress(prev => { const next = { ...prev }; delete next[farmId]; return next }), 2000)

          } else {

            setSatProgress(prev => ({ ...prev, [farmId]: { percent: 0, stage: stage || 'Scan failed — please retry' } }))

          }

        }

      } catch { /* keep polling */ }

    }

    pollTimers.current[farmId] = setInterval(poll, 1500)

    poll()

  }, [loadData])



  const handleFetchSatellite = useCallback(async (farmId) => {

    if (!farmId) return

    setSatProgress(prev => ({ ...prev, [farmId]: { percent: 10, stage: 'Scanning via GEE...' } }))

    try {

      // Fast synchronous scan — returns data immediately

      const res = await quickScanFarm(farmId)

      const data = res.data || {}

      setSatProgress(prev => ({ ...prev, [farmId]: { percent: 80, stage: 'Computing zones...' } }))

      // Auto-compute productivity zones after scan
      try {
        await computeGeoZones(farmId, 3, 90)
        const zonesRes = await getGeoZones(farmId)
        setZoneData(prev => ({ ...prev, [farmId]: zonesRes.data }))
      } catch (zErr) {
        console.warn('Zone computation failed (non-blocking):', zErr.response?.data?.detail || zErr.message)
      }

      setSatProgress(prev => ({ ...prev, [farmId]: { percent: 100, stage: 'Complete' } }))

      // Refresh data lists so sidebar & panel update

      loadData()

      // Reload selected farm history

      if (farmId === selectedFarmId) {

        getFarmMetrics(farmId, 120).then(r => {

          const rows = r.data?.observations || []

          setFieldHistory(rows.map(row => ({

            date: row.date,

            ndvi: row.ndvi_mean ?? row.ndvi ?? null,

            ndre: row.ndre_mean ?? row.ndre ?? null,

            evi: row.evi_mean ?? row.evi ?? null,

            savi: row.savi_mean ?? row.savi ?? null,

            cloud_cover: row.cloud_cover_percent ?? row.cloud_cover,

            health_score: row.health_score,

            ndvi_min: row.ndvi_min,

            ndvi_max: row.ndvi_max,

            ndvi_std: row.ndvi_std,

          })))

        }).catch(() => {})

      }

      // Trigger full risk pipeline so all downstream data (disease, alerts, stress) updates
      analyzeFarmRisk(farmId, { forceRefresh: true }).catch(() => {})

      // Notify all other pages to re-fetch
      emitFarmDataUpdated(farmId)

      setTimeout(() => setSatProgress(prev => { const next = { ...prev }; delete next[farmId]; return next }), 2000)

    } catch (err) {

      // Fallback to Celery-based pipeline

      console.warn('Quick scan failed, falling back to async pipeline:', err.response?.data?.detail || err.message)

      try {

        setSatProgress(prev => ({ ...prev, [farmId]: { percent: 5, stage: 'Queuing async scan...' } }))

        const res = await autoFetchSatellite(farmId)

        pollTaskProgress(farmId, res.data.task_id)

      } catch (fallbackErr) {

        setError(fallbackErr.response?.data?.detail || 'Failed to trigger satellite analysis')

        setSatProgress(prev => { const next = { ...prev }; delete next[farmId]; return next })

      }

    }

  }, [pollTaskProgress, loadData, selectedFarmId])



  const handleBoundaryChange = (geometry, area) => {

    setDraftGeometry(geometry)

    if (area) setDraftArea(area)

  }



  const resetDraft = () => {

    setDraftGeometry(null); setDraftArea(null)

    setDraftName('New field'); setDraftCrop(''); setDraftError(null)

  }



  const handleCreateNewFarm = () => {

    setCreatingField(true)

    setShowMapView(true)

    setSelectedFarmId(null)

    setTileSource(null)

    setDraftGeometry(null); setDraftArea(null)

    setDraftName('New Field'); setDraftCrop(''); setDraftError(null)

    setActivateDraw(true)

  }



  const handleSaveField = async () => {

    if (!draftGeometry) { setDraftError('Draw a polygon or upload GeoJSON first'); return }

    setDraftError(null); setSavingDraft(true)

    try {

      const targetFarmId = selectedFarmId && selectedFarm ? selectedFarmId : null

      if (targetFarmId) {

        if (draftArea) await updateFarm(targetFarmId, { area: draftArea })

        await saveFarmBoundary(targetFarmId, draftGeometry)

        await handleFetchSatellite(targetFarmId)

        loadData(); setSelectedFarmId(targetFarmId)

      } else {

        // Compute centroid from polygon ring
        const ring = draftGeometry?.coordinates?.[0] || []
        let cLat, cLon
        if (ring.length) {
          cLon = ring.reduce((s, c) => s + c[0], 0) / ring.length
          cLat = ring.reduce((s, c) => s + c[1], 0) / ring.length
        }
        const payload = { name: draftName || 'New field', crop_type: draftCrop || undefined, area: draftArea || undefined, ...(cLat != null && { latitude: cLat, longitude: cLon }) }

        const res = await createFarm(payload)

        const farmId = res.data?.id

        if (farmId) {

          await saveFarmBoundary(farmId, draftGeometry)

          await handleFetchSatellite(farmId)

          loadData(); setSelectedFarmId(farmId)

        }

      }

      resetDraft()

      setCreatingField(false)

    } catch (err) {

      setDraftError(err.response?.data?.detail || 'Failed to save field')

    } finally { setSavingDraft(false) }

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



  const onUploadChange = async (e) => {

    const file = e.target.files?.[0]

    if (!file) return

    try {

      setDraftError(null)

      const name = file.name.toLowerCase()

      if (name.endsWith('.geojson') || name.endsWith('.json')) {

        const text = await file.text()

        const geometry = parseGeoJsonText(text)

        if (!geometry) throw new Error('Invalid GeoJSON file')

        setDraftGeometry(geometry)

      } else {

        throw new Error('Unsupported file type. Use GeoJSON (.geojson/.json).')

      }

    } catch (err) { setDraftError(err.message) }

  }



  const toggleSidebar = () => setSidebarCollapsed(p => !p)

  const toggleGroup = (key) => setGroupCollapsed(p => ({ ...p, [key]: !p[key] }))



  if (loading) {

    return (

      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#e2e8f0' }}>

        <div className="spinner" style={{ width: 32, height: 32, borderColor: 'rgba(255,255,255,0.15)', borderTopColor: '#4ade80' }} />

        <p style={{ marginTop: 14, fontSize: 14, opacity: 0.7 }}>Loading satellite map…</p>

      </div>

    )

  }



  const renderFieldGroup = (fields, groupKey, label) => {

    const groupArea = fields.reduce((s, f) => s + Number(f.size_hectares || f.area || 0), 0)

    const collapsed = groupCollapsed[groupKey]

    return (

      <div className="field-group" key={groupKey}>

        <button className="field-group__header" onClick={() => toggleGroup(groupKey)}>

          <div className="field-group__toggle">

            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}

            <span className="field-group__label">{label}</span>

            <span className="field-group__area">{formatArea(groupArea)}</span>

          </div>

        </button>

        {!collapsed && fields.map(f => {

          const status = getFieldStatus(f.ndvi)

          return (

            <button

              key={f.id}

              className={`field-card${selectedFarmId === f.id ? ' active' : ''}`}

              onClick={() => { setCreatingField(false); setShowMapView(false); setSelectedFarmId(f.id) }}

            >

              <div className="field-card__thumb" style={{ background: ndviColor(f.ndvi) }}>

                <Leaf size={14} color="rgba(255,255,255,0.9)" />

              </div>

              <div className="field-card__info">

                <div className="field-card__title-row">

                  <span className="field-card__title">{f.name}</span>

                  <span className={`field-status field-status--${status.tone}`}>{status.label}</span>

                </div>

                <div className="field-card__meta">

                  <span>{formatArea(f.size_hectares || f.area)}</span>

                  {satProgress[f.id] && (

                    <span className="pill pill-progress" style={{ fontSize: 10 }}>{satProgress[f.id].percent}%</span>

                  )}

                </div>

              </div>

            </button>

          )

        })}

      </div>

    )

  }



  return (

    <div className={`intelligent-map${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>

      {/* Left rail */}

      <div className="intelligent-map__rail">

        <button className="rail-brand" onClick={() => navigate('/')} title="Back to dashboard">CR</button>

        <div className="rail-icons">

          {RAIL_ITEMS.map((item) => (

            <button key={item.label} className={`rail-icon${item.active ? ' active' : ''}`} title={item.label} aria-label={item.label}>

              <item.icon size={18} />

            </button>

          ))}

        </div>

      </div>



      {/* Field sidebar */}

      <aside className={`field-sidebar intelligent-sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>

        {sidebarCollapsed ? (

          <div className="field-sidebar__collapsed-content">

            <button className="field-sidebar__collapse" onClick={toggleSidebar} aria-label="Expand sidebar" style={{ position: 'static', marginBottom: 8 }}>

              <ChevronRight size={16} />

            </button>

            <button onClick={handleCreateNewFarm} className="collapsed-add" title="Add field" style={{ border: 'none', cursor: 'pointer' }}>

              <Plus size={16} />

            </button>

          </div>

        ) : (

          <>

            {/* Sidebar header */}

            <div className="field-sidebar__top">

              <div className="field-sidebar__season">

                <span className="field-sidebar__season-label">Season {currentSeason}</span>

                <span className="field-sidebar__season-area">{formatArea(totalAreaHa)}</span>

              </div>

              <button className="field-sidebar__collapse" onClick={toggleSidebar} aria-label="Collapse sidebar">

                <ChevronDown size={16} style={{ transform: 'rotate(90deg)' }} />

              </button>

            </div>



            {/* Search + sort */}

            <div className="field-sidebar__filters">

              <div className="field-sidebar__search">

                <Search size={14} />

                <input placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} />

              </div>

              <button className="field-sidebar__sort-btn" title="Sort">

                <Filter size={14} />

                <select value={sortMode} onChange={e => setSortMode(e.target.value)} style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer' }}>

                  <option value="latest">Newest</option>

                  <option value="health">Health</option>

                  <option value="name">Name A-Z</option>

                </select>

              </button>

            </div>



            {/* Season filter */}

            {seasons.length > 2 && (

              <select value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)} className="field-sidebar__season-select">

                {seasons.map(s => <option key={s} value={s}>{s === 'all' ? 'All seasons' : s}</option>)}

              </select>

            )}



            {/* Grouped field list */}

            <div className="field-sidebar__list">

              {sortedFields.length === 0 && (

                <div style={{ padding: '24px 8px', color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center' }}>

                  No mapped fields yet.<br />Draw a polygon to add your first field.

                </div>

              )}

              {notAnalyzedFields.length > 0 && renderFieldGroup(notAnalyzedFields, 'notAnalyzed', 'Fields not analyzed')}

              {analyzedFields.length > 0 && renderFieldGroup(analyzedFields, 'analyzed', 'Fields analyzed')}

            </div>

            {/* Floating add button with action menu */}
            <div ref={addMenuRef} style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
              {addMenuOpen && (
                <div className="add-field-menu">
                  <button className="add-field-menu__item" onClick={() => setAddMenuOpen(false)}>
                    <Navigation2 size={14} /> Select on map
                  </button>
                  <button className="add-field-menu__item" onClick={() => { setAddMenuOpen(false); handleCreateNewFarm() }}>
                    <Pencil size={14} /> Draw fields
                  </button>
                  <button className="add-field-menu__item" onClick={() => { setAddMenuOpen(false); fileInputRef.current?.click() }}>
                    <Upload size={14} /> Upload file
                  </button>
                  <button className="add-field-menu__item" disabled>
                    <Truck size={14} /> Import from John Deere
                  </button>
                  <button className="add-field-menu__item" disabled>
                    <FolderPlus size={14} /> Create group
                  </button>
                </div>
              )}
              <button className="sidebar-add-btn" onClick={() => setAddMenuOpen(p => !p)} title="Add field">
                <Plus size={20} />
              </button>
            </div>

          </>

        )}

      </aside>



      {/* Map stage */}

      <section className={`intelligent-map__stage${selectedFarm && !isDrawing && !creatingField && !showMapView ? ' analytics-mode' : ''}`}>

        <div className="intelligent-map__canvas">

          <MapboxFieldMap

            height="100%"

            existingFields={fieldsWithBoundary}

            selectedFieldId={selectedFarmId}

            onSelectField={(id) => { setCreatingField(false); setShowMapView(false); setSelectedFarmId(id) }}

            readOnly={false}

            metric={layerMetric}

            onMetricChange={(next) => { setLayerMetric(next); setOverlayVisible(true) }}

            focusOnSelect

            enableDrawing

            initialBoundary={selectedFarm?.boundary_geojson || null}

            onBoundaryChange={handleBoundaryChange}

            onAreaChange={setDraftArea}

            rasterTiles={tileSource}

            rasterVisible={overlayVisible}

            onRasterVisibleChange={setOverlayVisible}

            onUploadGeoJson={() => fileInputRef.current?.click()}

            selectedFieldName={selectedFarm?.name || null}

            weatherSummary={weatherSummary}

            onDrawModeChange={setIsDrawing}

            activateDraw={activateDraw}

            onDrawStarted={() => setActivateDraw(false)}

            productivityZones={selectedFarmId ? zoneData[selectedFarmId] : null}

          />



          <input type="file" accept=".geojson,.json" style={{ display: 'none' }} onChange={onUploadChange} ref={fileInputRef} />







        </div>



        {/* Field intelligence panel — full-width when field selected */}

        <div className={`sat-intel-panel${(selectedFarm && !isDrawing && !showMapView) || creatingField ? ' open' : ''}${selectedFarm && !isDrawing && !creatingField && !showMapView ? ' full' : ''}`}>

          {creatingField ? (
            <div className="create-field-panel">
              <div className="create-field-panel__header">
                <div>
                  <div className="eyebrow" style={{ color: '#94a3b8' }}>New field</div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9', margin: 0 }}>
                    {draftGeometry ? 'Save drawn area' : 'Draw a field'}
                  </h3>
                </div>
                <button className="intel-panel__close" onClick={() => { setCreatingField(false); resetDraft() }} aria-label="Close panel">
                  <X size={18} />
                </button>
              </div>

              {!draftGeometry ? (
                <div className="create-field-panel__hint">
                  <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 12 }}>✏️</div>
                  <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6, textAlign: 'center' }}>
                    Use the <strong style={{ color: '#f1f5f9' }}>Draw</strong> tool on the map to outline your field boundary. Double-click to finish.
                  </p>
                  <p style={{ marginTop: 10, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
                    Or{' '}
                    <button style={{ background: 'none', border: 'none', color: '#22c55e', cursor: 'pointer', fontWeight: 600, padding: 0, fontSize: 12 }} onClick={() => fileInputRef.current?.click()}>
                      upload a GeoJSON file
                    </button>
                  </p>
                </div>
              ) : (
                <div className="create-field-panel__form">
                  <div className="create-field-panel__area-chip">
                    {draftArea ? `${draftArea.toFixed(2)} ha` : '—'}
                  </div>
                  <input
                    className="create-field-panel__input"
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    placeholder="Field name"
                  />
                  <input
                    className="create-field-panel__input"
                    value={draftCrop}
                    onChange={e => setDraftCrop(e.target.value)}
                    placeholder="Crop (optional)"
                  />
                  {draftError && <div className="error-box" style={{ fontSize: 12, padding: '8px 12px' }}>{draftError}</div>}
                  <div className="create-field-panel__actions">
                    <button className="btn btn-secondary btn-sm create-field-panel__action-btn" onClick={() => fileInputRef.current?.click()}>
                      Upload GeoJSON
                    </button>
                    <button className="btn btn-sm create-field-panel__action-btn create-field-panel__action-btn--primary" onClick={handleSaveField} disabled={savingDraft}>
                      {savingDraft ? 'Saving…' : 'Save & scan'}
                    </button>
                  </div>
                  <button className="create-field-panel__clear" onClick={resetDraft}>Clear drawing</button>
                </div>
              )}
            </div>
          ) : intelLoading ? (

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10, color: 'var(--text-secondary)' }}>

              <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />Loading…

            </div>

          ) : (

            <FieldIntelligencePanel

              farm={selectedFarm}

              history={fieldHistory}

              weather={weatherSummary}

              tileSource={tileSource}

              onClose={() => { setSelectedFarmId(null); setShowMapView(true) }}

              onRescan={() => selectedFarm && handleFetchSatellite(selectedFarm.id)}

              satProgress={selectedFarm ? satProgress[selectedFarm.id] : null}

              productivityZones={selectedFarm ? zoneData[selectedFarm.id] : null}

              onZonesComputed={(zones) => selectedFarm && setZoneData(prev => ({ ...prev, [selectedFarm.id]: zones }))}

            />

          )}

        </div>



        {error && <div className="error-box" style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30 }}>{error}</div>}

        {tileError && <div className="error-box" style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 30 }}>{tileError}</div>}

      </section>

    </div>

  )

}


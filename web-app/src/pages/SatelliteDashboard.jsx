/**
 * SatelliteDashboard
 * ------------------
 * Precision agriculture satellite intelligence hub.
 *
 * Left panel : farm selector, live health badges, layer toggles,
 *              productivity zone legend, scouting form, NDVI timeline chart.
 * Right panel: full-height Leaflet map (vanilla L via CDN, consistent with
 *              other map components in this app) with:
 *                - OSM base tiles
 *                - Farm boundary (GeoJSON)
 *                - NDVI tile overlay (GEE signed URL or color fallback)
 *                - Productivity zone polygons
 *                - Stress hotspot circles
 *                - Scouting observation markers
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Map, Layers, Activity, Camera, Crosshair,
  RefreshCw, ChevronDown, AlertTriangle, Eye, EyeOff,
  Plus, Trash2, CheckCircle,
} from 'lucide-react'
import VegetationTimeline from '../components/VegetationTimeline'
import {
  getFarms, getGeoNdviTiles, getGeoZones, computeGeoZones,
  getGeoHotspots, getGeoScouting, createScoutingObservation,
  deleteScoutingObservation, getGeoCropClassification,
  getGeoPhenology, getGeoNdviTileHistory, getGeoFusionStatus,
} from '../api'

// ─── helpers ────────────────────────────────────────────────────────────────

const ZONE_COLORS  = { high: '#4CAF50', medium: '#FFC107', low: '#F44336' }
const SEV_COLORS   = { low: '#8BC34A', medium: '#FFC107', high: '#FF5722', critical: '#D32F2F' }
const OBSERVATION_TYPES = ['pest', 'disease', 'nutrient_deficiency', 'irrigation_issue', 'soil_issue', 'other']

const ndviGradient = (v) => {
  if (v === null || v === undefined) return '#94a3b8'
  if (v < 0.2) return '#F44336'
  if (v < 0.35) return '#FF5722'
  if (v < 0.5) return '#FFC107'
  if (v < 0.65) return '#CDDC39'
  if (v < 0.8) return '#8BC34A'
  return '#4CAF50'
}

const fmt = (n, d = 3) => (n !== null && n !== undefined ? Number(n).toFixed(d) : '—')

// ─── component ───────────────────────────────────────────────────────────────

export default function SatelliteDashboard() {
  // ── farm list ──
  const [farms, setFarms]           = useState([])
  const [selectedId, setSelectedId] = useState(null)

  // ── layer data ──
  const [ndviInfo, setNdviInfo]         = useState(null)
  const [zones, setZones]               = useState([])
  const [hotspots, setHotspots]         = useState([])
  const [scoutingObs, setScoutingObs]   = useState([])
  const [cropClass, setCropClass]       = useState(null)
  const [phenology, setPhenology]           = useState(null)
  const [tileHistory, setTileHistory]       = useState([])
  const [tileHistoryIdx, setTileHistoryIdx] = useState(0)
  const [fusionStatus, setFusionStatus]     = useState(null)

  // ── layer visibility toggles ──
  const [showNdvi,     setShowNdvi]     = useState(true)
  const [showZones,    setShowZones]    = useState(true)
  const [showHotspots, setShowHotspots] = useState(true)
  const [showScouting, setShowScouting] = useState(true)

  // ── ui state ──
  const [loading,    setLoading]    = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [scoutForm,  setScoutForm]  = useState(false)
  const [scoutPending, setScoutPending] = useState({ lat: null, lon: null })
  const [scoutData,  setScoutData]  = useState({ type: 'pest', severity: 'medium', notes: '', tags: '' })
  const [scoutSaving, setScoutSaving] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)

  // ── map refs ──
  const mapRef         = useRef(null)        // DOM container
  const mapInstance    = useRef(null)        // L.Map
  const farmLayer      = useRef(null)        // GeoJSON farm boundary
  const ndviLayer      = useRef(null)        // TileLayer or GeoJSON NDVI overlay
  const zoneLayer      = useRef(null)        // GeoJSON zones
  const hotLayer       = useRef(null)        // FeatureGroup hotspot circles
  const scoutLayer     = useRef(null)        // LayerGroup scouting markers
  const clickListener  = useRef(null)        // map click handler for scouting

  const selectedFarm = farms.find(f => f.id === selectedId) || null

  // ── initialise Leaflet map ──────────────────────────────────────────────────
  useEffect(() => {
    if (mapInstance.current || !mapRef.current || !window.L) return
    const L = window.L
    const map = L.map(mapRef.current, {
      center: [-1.95, 30.06],
      zoom: 8,
      zoomControl: true,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)
    mapInstance.current = map
    return () => {
      map.remove()
      mapInstance.current = null
    }
  }, [])

  // ── load farm list ──────────────────────────────────────────────────────────
  useEffect(() => {
    getFarms()
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : res.data.farms || []
        setFarms(list)
        if (list.length) setSelectedId(list[0].id)
      })
      .catch(console.error)
  }, [])

  // ── draw farm boundary ──────────────────────────────────────────────────────
  const drawFarmBoundary = useCallback((farm) => {
    const L = window.L
    const map = mapInstance.current
    if (!map || !L) return

    if (farmLayer.current) { map.removeLayer(farmLayer.current); farmLayer.current = null }

    const geo = farm?.boundary_geojson || farm?.boundary
    if (!geo) return

    const layer = L.geoJSON(typeof geo === 'string' ? JSON.parse(geo) : geo, {
      style: { color: '#2196F3', weight: 2.5, fillOpacity: 0.08, fillColor: '#2196F3' },
    }).addTo(map)
    farmLayer.current = layer

    try { map.fitBounds(layer.getBounds(), { padding: [40, 40] }) }
    catch (_) {}
  }, [])

  // ── apply historical NDVI tile (time slider) ─────────────────────────────────
  const applyHistoricalTile = useCallback((tile) => {
    const L = window.L
    const map = mapInstance.current
    if (!map || !L || !tile?.tile_url) return
    if (ndviLayer.current) { map.removeLayer(ndviLayer.current); ndviLayer.current = null }
    ndviLayer.current = L.tileLayer(tile.tile_url, {
      opacity: 0.75,
      attribution: '© Google Earth Engine',
      maxZoom: 17,
    }).addTo(map)
  }, [])

  // ── draw NDVI overlay ───────────────────────────────────────────────────────
  const drawNdvi = useCallback((info, farm) => {
    const L = window.L
    const map = mapInstance.current
    if (!map || !L || !showNdvi) return

    if (ndviLayer.current) { map.removeLayer(ndviLayer.current); ndviLayer.current = null }
    if (!info) return

    if (info.tile_url) {
      // GEE signed XYZ tile layer
      ndviLayer.current = L.tileLayer(info.tile_url, {
        opacity: 0.75,
        attribution: '© Google Earth Engine',
        maxZoom: 17,
      }).addTo(map)
    } else if (info.color_hex) {
      // Fallback: colour the farm polygon by latest NDVI value
      const geo = farm?.boundary_geojson || farm?.boundary
      if (!geo) return
      ndviLayer.current = L.geoJSON(typeof geo === 'string' ? JSON.parse(geo) : geo, {
        style: {
          color: info.color_hex, weight: 0,
          fillColor: info.color_hex, fillOpacity: 0.55,
        },
      }).addTo(map)
    }
  }, [showNdvi])

  // ── draw productivity zones ─────────────────────────────────────────────────
  const drawZones = useCallback((zoneList) => {
    const L = window.L
    const map = mapInstance.current
    if (!map || !L) return

    if (zoneLayer.current) { map.removeLayer(zoneLayer.current); zoneLayer.current = null }
    if (!showZones || !zoneList.length) return

    const features = zoneList
      .filter(z => z.boundary)
      .map(z => ({
        type: 'Feature',
        geometry: typeof z.boundary === 'string' ? JSON.parse(z.boundary) : z.boundary,
        properties: { zone_class: z.zone_class, mean_ndvi: z.mean_ndvi, area_ha: z.area_ha, color: ZONE_COLORS[z.zone_class] || '#888' },
      }))

    if (!features.length) return

    zoneLayer.current = L.geoJSON({ type: 'FeatureCollection', features }, {
      style: f => ({
        color: f.properties.color,
        weight: 1.5,
        fillColor: f.properties.color,
        fillOpacity: 0.35,
      }),
      onEachFeature: (f, layer) => {
        layer.bindPopup(
          `<b>${capitalize(f.properties.zone_class)} Productivity</b><br>` +
          `NDVI: ${fmt(f.properties.mean_ndvi)}<br>` +
          `Area: ${fmt(f.properties.area_ha, 2)} ha`
        )
      },
    }).addTo(map)
  }, [showZones])

  // ── draw hotspots ─────────────────────────────────────────────────────────
  const drawHotspots = useCallback((spots) => {
    const L = window.L
    const map = mapInstance.current
    if (!map || !L) return

    if (hotLayer.current) { map.removeLayer(hotLayer.current); hotLayer.current = null }
    if (!showHotspots || !spots.length) return

    hotLayer.current = L.featureGroup().addTo(map)
    spots.forEach(s => {
      if (s.lat == null || s.lon == null) return
      const severity = s.severity || 'medium'
      L.circleMarker([s.lat, s.lon], {
        radius: 8 + (s.anomaly_magnitude || 0) * 20,
        color: SEV_COLORS[severity] || '#FF5722',
        weight: 2,
        fillColor: SEV_COLORS[severity] || '#FF5722',
        fillOpacity: 0.5,
      })
        .bindPopup(
          `<b>⚡ Stress Hotspot</b><br>` +
          `NDVI delta: ${fmt(s.ndvi_delta, 3)}<br>` +
          `Severity: ${severity}`
        )
        .addTo(hotLayer.current)
    })
  }, [showHotspots])

  // ── draw scouting markers ───────────────────────────────────────────────────
  const drawScouting = useCallback((obsList) => {
    const L = window.L
    const map = mapInstance.current
    if (!map || !L) return

    if (scoutLayer.current) { map.removeLayer(scoutLayer.current); scoutLayer.current = null }
    if (!showScouting || !obsList.length) return

    scoutLayer.current = L.layerGroup().addTo(map)
    obsList.forEach(obs => {
      if (obs.latitude == null || obs.longitude == null) return
      const color = SEV_COLORS[obs.severity] || '#607D8B'
      const icon = L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>`,
        className: '',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })
      L.marker([obs.latitude, obs.longitude], { icon })
        .bindPopup(
          `<b>${obs.observation_type?.replace(/_/g, ' ')}</b><br>` +
          `Severity: ${obs.severity || '—'}<br>` +
          `${obs.notes ? `<i>${obs.notes.slice(0, 120)}</i>` : ''}`
        )
        .addTo(scoutLayer.current)
    })
  }, [showScouting])

  // ── map click → place scouting pin ─────────────────────────────────────────
  const enableScoutingClick = useCallback(() => {
    const map = mapInstance.current
    if (!map) return
    disableScoutingClick()
    const handler = (e) => {
      setScoutPending({ lat: e.latlng.lat, lon: e.latlng.lng })
      setScoutForm(true)
      disableScoutingClick()
    }
    map.once('click', handler)
    clickListener.current = handler
    map.getContainer().style.cursor = 'crosshair'
  }, [])

  const disableScoutingClick = useCallback(() => {
    const map = mapInstance.current
    if (!map) return
    if (clickListener.current) {
      map.off('click', clickListener.current)
      clickListener.current = null
    }
    map.getContainer().style.cursor = ''
  }, [])

  // ── load all data for selected farm ────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return
    const farm = farms.find(f => f.id === selectedId)
    if (!farm) return

    drawFarmBoundary(farm)
    setLoading(true)
    setNdviInfo(null); setZones([]); setHotspots([]); setScoutingObs([]); setCropClass(null)
    setPhenology(null); setTileHistory([]); setTileHistoryIdx(0); setFusionStatus(null)

    Promise.allSettled([
      getGeoNdviTiles(selectedId),
      getGeoZones(selectedId),
      getGeoHotspots(selectedId),
      getGeoScouting(selectedId),
      getGeoCropClassification(selectedId),
      getGeoPhenology(selectedId),
      getGeoNdviTileHistory(selectedId, 12),
      getGeoFusionStatus(selectedId),
    ]).then(([ndvi, z, h, s, cc, pheno, hist, fusion]) => {
      const ndviData   = ndvi.status   === 'fulfilled' ? ndvi.value.data   : null
      const zonesData  = z.status      === 'fulfilled' ? (z.value.data.zones || [])        : []
      const hotData    = h.status      === 'fulfilled' ? (h.value.data.hotspots || [])     : []
      const scData     = s.status      === 'fulfilled' ? (s.value.data.observations || []) : []
      const ccData     = cc.status     === 'fulfilled' ? cc.value.data     : null
      const phenoData  = pheno.status  === 'fulfilled' ? pheno.value.data  : null
      const histData   = hist.status   === 'fulfilled' ? (hist.value.data.tiles || [])     : []
      const fusionData = fusion.status === 'fulfilled' ? fusion.value.data : null

      setNdviInfo(ndviData)
      setZones(zonesData)
      setHotspots(hotData)
      setScoutingObs(scData)
      setCropClass(ccData)
      setPhenology(phenoData)
      setTileHistory(histData)
      setTileHistoryIdx(0)
      setFusionStatus(fusionData)

      drawNdvi(ndviData, farm)
      drawZones(zonesData)
      drawHotspots(hotData)
      drawScouting(scData)
    }).finally(() => setLoading(false))
  }, [selectedId, farms, drawFarmBoundary, drawNdvi, drawZones, drawHotspots, drawScouting])

  // ── time slider: swap NDVI tile when index changes ───────────────────────────
  useEffect(() => {
    if (!tileHistory.length) return
    const tile = tileHistory[tileHistoryIdx]
    if (tile?.tile_url) {
      applyHistoricalTile(tile)
    } else if (tileHistoryIdx === 0) {
      // restore live tile when snapping back to latest
      drawNdvi(ndviInfo, selectedFarm)
    }
  }, [tileHistoryIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── re-draw when toggles change ─────────────────────────────────────────────
  useEffect(() => { drawNdvi(ndviInfo, selectedFarm) }, [showNdvi, ndviInfo, selectedFarm, drawNdvi])
  useEffect(() => { drawZones(zones)    }, [showZones, zones, drawZones])
  useEffect(() => { drawHotspots(hotspots) }, [showHotspots, hotspots, drawHotspots])
  useEffect(() => { drawScouting(scoutingObs) }, [showScouting, scoutingObs, drawScouting])

  // ── recompute zones ─────────────────────────────────────────────────────────
  const handleRecomputeZones = async () => {
    if (!selectedId) return
    setRecomputing(true)
    try {
      const res = await computeGeoZones(selectedId)
      const zonesData = res.data.zones || []
      setZones(zonesData)
      drawZones(zonesData)
    } catch (e) {
      console.error('recompute zones failed', e)
    } finally {
      setRecomputing(false)
    }
  }

  // ── save scouting observation ───────────────────────────────────────────────
  const handleSaveObservation = async () => {
    if (!selectedId || scoutPending.lat == null) return
    setScoutSaving(true)
    try {
      const payload = {
        ...scoutData,
        latitude: scoutPending.lat,
        longitude: scoutPending.lon,
        tags: scoutData.tags ? scoutData.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      }
      const res = await createScoutingObservation(selectedId, payload)
      const updated = [...scoutingObs, res.data]
      setScoutingObs(updated)
      drawScouting(updated)
      setScoutForm(false)
      setScoutPending({ lat: null, lon: null })
      setScoutData({ type: 'pest', severity: 'medium', notes: '', tags: '' })
    } catch (e) {
      console.error('failed to save observation', e)
    } finally {
      setScoutSaving(false)
    }
  }

  // ── delete scouting observation ─────────────────────────────────────────────
  const handleDeleteObs = async (obsId) => {
    try {
      await deleteScoutingObservation(obsId)
      const updated = scoutingObs.filter(o => o.id !== obsId)
      setScoutingObs(updated)
      drawScouting(updated)
    } catch (e) { console.error('delete obs failed', e) }
  }

  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden', background: 'var(--bg-body)' }}>

      {/* ── LEFT CONTROL PANEL ─────────────────────────────────────────────── */}
      <aside style={{
        width: 320, flexShrink: 0, overflowY: 'auto', overflowX: 'hidden',
        borderRight: '1px solid var(--border)', padding: '16px',
        display: 'flex', flexDirection: 'column', gap: 16,
        background: 'var(--bg-card)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Map size={20} color="var(--primary)" />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            Satellite Intelligence
          </h2>
        </div>

        {/* Farm selector */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Farm
          </label>
          <div style={{ position: 'relative', marginTop: 4 }}>
            <select
              value={selectedId || ''}
              onChange={e => setSelectedId(Number(e.target.value))}
              style={{
                width: '100%', padding: '8px 32px 8px 10px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-body)',
                color: 'var(--text-primary)', fontSize: 13, appearance: 'none', cursor: 'pointer',
              }}
            >
              {farms.map(f => (
                <option key={f.id} value={f.id}>{f.name || `Farm #${f.id}`}</option>
              ))}
            </select>
            <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
          </div>
        </div>

        {/* NDVI + crop type badges */}
        {ndviInfo && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <InfoBadge
              label="Mean NDVI"
              value={fmt(ndviInfo.mean_ndvi)}
              color={ndviGradient(ndviInfo.mean_ndvi)}
            />
            <InfoBadge
              label="Source"
              value={ndviInfo.source || '—'}
              color="var(--primary)"
            />
            {cropClass && (
              <InfoBadge
                label="Crop Type"
                value={cropClass.crop_type || '—'}
                color="#9C27B0"
                span={2}
              />
            )}
          </div>
        )}

        {/* Phenology / growth stage card */}
        {phenology && !loading && (
          <PhenologyCard phenology={phenology} />
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            <span className="spinner" style={{ width: 14, height: 14 }} />
            Loading satellite data…
          </div>
        )}

        {/* Layer toggles */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
            <Layers size={11} style={{ marginRight: 4 }} />Layers
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <LayerToggle active={showNdvi}     onChange={setShowNdvi}     color="#4CAF50" label="NDVI Overlay" />
            <LayerToggle active={showZones}    onChange={setShowZones}    color="#FFC107" label="Productivity Zones" />
            <LayerToggle active={showHotspots} onChange={setShowHotspots} color="#FF5722" label="Stress Hotspots" />
            <LayerToggle active={showScouting} onChange={setShowScouting} color="#2196F3" label="Field Scouting" />
          </div>
        </div>

        {/* Satellite fusion coverage status */}
        {fusionStatus && !loading && (
          <FusionStatusRow status={fusionStatus} />
        )}

        {/* Productivity zones legend + recompute */}
        {zones.length > 0 && showZones && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              Zone Breakdown
            </div>
            {['high', 'medium', 'low'].map(cls => {
              const z = zones.filter(z => z.zone_class === cls)
              if (!z.length) return null
              const avgNdvi = z.reduce((s, x) => s + (x.mean_ndvi || 0), 0) / z.length
              const area    = z.reduce((s, x) => s + (x.area_ha || 0), 0)
              return (
                <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: ZONE_COLORS[cls], flexShrink: 0 }} />
                  <span style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 500 }}>{capitalize(cls)}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>NDVI {fmt(avgNdvi)}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{fmt(area, 1)} ha</span>
                </div>
              )
            })}
            <button
              onClick={handleRecomputeZones}
              disabled={recomputing}
              style={{
                marginTop: 8, width: '100%', padding: '6px 0',
                background: 'var(--bg-body)', border: '1px solid var(--border)', borderRadius: 6,
                color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <RefreshCw size={12} className={recomputing ? 'spin' : ''} />
              {recomputing ? 'Recomputing…' : 'Recompute Zones'}
            </button>
          </div>
        )}

        {/* Hotspot summary */}
        {hotspots.length > 0 && (
          <div style={{ background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <AlertTriangle size={14} color="#FF6F00" />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#E65100' }}>
                {hotspots.length} stress hotspot{hotspots.length !== 1 ? 's' : ''} detected
              </span>
            </div>
            {hotspots.slice(0, 3).map((h, i) => (
              <div key={i} style={{ fontSize: 11, color: '#BF360C', marginBottom: 2 }}>
                • NDVI Δ {fmt(h.ndvi_delta, 3)} — {h.severity || 'medium'}
              </div>
            ))}
          </div>
        )}

        {/* Scouting section */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              <Camera size={11} style={{ marginRight: 4 }} />Field Scouting
            </div>
            <button
              onClick={enableScoutingClick}
              title="Click on the map to place an observation"
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                borderRadius: 6, border: '1px solid var(--primary)', background: 'transparent',
                color: 'var(--primary)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Crosshair size={11} /> Add
            </button>
          </div>

          {/* Inline scouting form */}
          {scoutForm && (
            <div style={{
              background: 'var(--bg-body)', border: '1px solid var(--border)', borderRadius: 8,
              padding: 12, marginBottom: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary)', marginBottom: 8 }}>
                📍 {scoutPending.lat ? `${Number(scoutPending.lat).toFixed(5)}, ${Number(scoutPending.lon).toFixed(5)}` : 'Click map to place pin…'}
              </div>
              <select
                value={scoutData.type}
                onChange={e => setScoutData(p => ({ ...p, type: e.target.value }))}
                style={FIELD_STYLE}
              >
                {OBSERVATION_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
              <select
                value={scoutData.severity}
                onChange={e => setScoutData(p => ({ ...p, severity: e.target.value }))}
                style={{ ...FIELD_STYLE, marginTop: 6 }}
              >
                {['low', 'medium', 'high', 'critical'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <textarea
                value={scoutData.notes}
                onChange={e => setScoutData(p => ({ ...p, notes: e.target.value }))}
                placeholder="Field notes…"
                rows={2}
                style={{ ...FIELD_STYLE, marginTop: 6, resize: 'none' }}
              />
              <input
                value={scoutData.tags}
                onChange={e => setScoutData(p => ({ ...p, tags: e.target.value }))}
                placeholder="Tags (comma separated)"
                style={{ ...FIELD_STYLE, marginTop: 6 }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  onClick={handleSaveObservation}
                  disabled={scoutSaving || scoutPending.lat == null}
                  style={{ flex: 1, padding: '6px 0', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  {scoutSaving ? 'Saving…' : <><CheckCircle size={11} style={{ marginRight: 4 }} />Save</>}
                </button>
                <button
                  onClick={() => { setScoutForm(false); disableScoutingClick(); setScoutPending({ lat: null, lon: null }) }}
                  style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Observation list */}
          {scoutingObs.length > 0 ? (
            <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {scoutingObs.slice(0, 8).map(obs => (
                <ObsRow key={obs.id} obs={obs} onDelete={() => handleDeleteObs(obs.id)} />
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>
              No observations yet. Click <b>Add</b> then tap the map.
            </p>
          )}
        </div>

        {/* NDVI timeline toggle */}
        <div>
          <button
            onClick={() => setShowTimeline(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '6px 0', background: 'none', border: 'none',
              color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={13} color="var(--primary)" />
              Vegetation Timeline
            </span>
            {showTimeline ? <EyeOff size={12} color="var(--text-secondary)" /> : <Eye size={12} color="var(--text-secondary)" />}
          </button>
          {showTimeline && selectedId && (
            <div style={{ marginTop: 4 }}>
              <VegetationTimeline farmId={selectedId} height={180} compact />
            </div>
          )}
        </div>

        {/* NDVI time slider (satellite history) */}
        {tileHistory.length > 1 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
              Satellite History
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 4 }}>
              {tileHistory[tileHistoryIdx]?.date
                ? new Date(tileHistory[tileHistoryIdx].date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                : '—'}
              {tileHistoryIdx === 0 && <span style={{ color: 'var(--primary)', marginLeft: 4, fontSize: 10 }}>(latest)</span>}
            </div>
            <input
              type="range"
              min={0}
              max={tileHistory.length - 1}
              value={tileHistoryIdx}
              onChange={e => setTileHistoryIdx(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
              title="Drag to view NDVI for a past date"
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
              <span>{tileHistory[tileHistory.length - 1]?.date?.slice(0, 10)}</span>
              <span>{tileHistory.length} dates</span>
              <span>{tileHistory[0]?.date?.slice(0, 10)}</span>
            </div>
          </div>
        )}

      </aside>

      {/* ── MAP ──────────────────────────────────────────────────────────────── */}
      <div
        ref={mapRef}
        style={{ flex: 1, position: 'relative' }}
        aria-label="Satellite map"
      />
    </div>
  )
}

// ─── sub-components ──────────────────────────────────────────────────────────

function InfoBadge({ label, value, color, span }) {
  return (
    <div style={{
      background: 'var(--bg-body)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '8px 10px', gridColumn: span ? `span ${span}` : undefined,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function LayerToggle({ active, onChange, color, label }) {
  return (
    <div
      onClick={() => onChange(p => !p)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
        background: active ? `${color}15` : 'transparent',
        border: `1px solid ${active ? color + '40' : 'transparent'}`,
      }}
    >
      <div style={{
        width: 12, height: 12, borderRadius: 2, flexShrink: 0,
        background: active ? color : '#cbd5e1', border: `1px solid ${active ? color : '#94a3b8'}`,
      }} />
      <span style={{ fontSize: 12, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: active ? 500 : 400 }}>
        {label}
      </span>
    </div>
  )
}

function ObsRow({ obs, onDelete }) {
  const color = SEV_COLORS[obs.severity] || '#607D8B'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
      background: 'var(--bg-body)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11,
    }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
        {obs.observation_type?.replace(/_/g, ' ')}
        {obs.notes ? ` — ${obs.notes.slice(0, 40)}` : ''}
      </span>
      <button
        onClick={onDelete}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2, flexShrink: 0 }}
        title="Delete observation"
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const FIELD_STYLE = {
  width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, boxSizing: 'border-box',
}

const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

// ─── PhenologyCard ───────────────────────────────────────────────────────────

const STAGE_META = {
  emergence:    { label: 'Emergence',    color: '#81C784', icon: '🌱' },
  vegetative:   { label: 'Vegetative',   color: '#4CAF50', icon: '🌿' },
  flowering:    { label: 'Flowering',    color: '#FFC107', icon: '🌸' },
  grain_filling:{ label: 'Grain Filling',color: '#FF9800', icon: '🌾' },
  maturity:     { label: 'Maturity',     color: '#795548', icon: '✅' },
}

function PhenologyCard({ phenology }) {
  const stage   = phenology?.detected_stage || 'vegetative'
  const meta    = STAGE_META[stage] || { label: capitalize(stage), color: '#607D8B', icon: '📊' }
  const conf    = Math.round((phenology?.confidence || 0) * 100)
  const method  = phenology?.detection_method || 'spectral_curve'
  return (
    <div style={{
      background: `${meta.color}12`, border: `1px solid ${meta.color}50`,
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{meta.icon}</span>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Growth Stage</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: meta.color }}>{meta.label}</div>
        </div>
      </div>
      {/* confidence bar */}
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginBottom: 6 }}>
        <div style={{ height: '100%', width: `${conf}%`, background: meta.color, borderRadius: 2, transition: 'width .4s' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
        <span>Confidence: <b style={{ color: 'var(--text-primary)' }}>{conf}%</b></span>
        <span>Method: <b style={{ color: 'var(--text-primary)' }}>{method.replace(/_/g, ' ')}</b></span>
        {phenology?.ndvi_at_detection != null && (
          <span>NDVI: <b style={{ color: 'var(--text-primary)' }}>{Number(phenology.ndvi_at_detection).toFixed(3)}</b></span>
        )}
        {phenology?.gdd_accumulated != null && (
          <span>GDD: <b style={{ color: 'var(--text-primary)' }}>{Math.round(phenology.gdd_accumulated)}°C·d</b></span>
        )}
      </div>
    </div>
  )
}

// ─── FusionStatusRow ─────────────────────────────────────────────────────────

function FusionStatusRow({ status }) {
  const total   = status?.total_observations || 0
  const s2      = status?.by_source?.sentinel2 || 0
  const sar     = status?.sar_filled  || 0
  const ls      = status?.landsat_filled || 0
  const cov     = Math.round((status?.coverage_pct || 0) * 100)
  if (!total) return null
  return (
    <div style={{
      background: 'var(--bg-body)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
        Satellite Fusion Coverage
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <FusionChip label="S2 optical" value={s2}  color="#2196F3" />
        <FusionChip label="SAR fills"  value={sar} color="#FF9800" />
        <FusionChip label="Landsat"    value={ls}  color="#9C27B0" />
      </div>
      <div style={{ marginTop: 6, height: 4, background: 'var(--border)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${cov}%`, background: 'var(--primary)', borderRadius: 2, transition: 'width .4s' }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 3 }}>{cov}% coverage ({total} obs)</div>
    </div>
  )
}

function FusionChip({ label, value, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 12, fontSize: 10, fontWeight: 600,
      background: `${color}18`, border: `1px solid ${color}40`, color,
    }}>
      {value} {label}
    </span>
  )
}

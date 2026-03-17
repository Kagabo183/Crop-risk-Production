/**
 * VraMapView – OneSoil-style VRA map creation & viewing experience.
 *
 * Two phases:
 *   1) "Create VRA map" modal  – card-based type + source selection
 *   2) Full-screen result view – settings sidebar + dual map panels
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import {
  ChevronLeft, ChevronDown, Download, X, Loader2, Check, Info,
  Sprout, Shield, FlaskConical, Layers, BookOpen, Save,
} from 'lucide-react'
import {
  computeVraMap, getVraMapsForFarm, exportVraGeoJson, exportVraIsoxml,
  computeGeoZones, getGeoZones,
} from '../api'

/* ── Prescription type cards ─────────────────────────────────────────────── */
const PRESC_TYPES = [
  { key: 'seeding',    label: 'Planting',              icon: Sprout,       unit: 'seeds/ha' },
  { key: 'chemical',   label: 'Crop protection',       icon: Shield,       unit: 'L/ha'     },
  { key: 'fertilizer', label: 'Fertilizer application', icon: FlaskConical, unit: 'kg/ha'    },
  { key: 'multiple',   label: 'Multiple inputs',        icon: Layers,       unit: 'kg/ha'    },
]

const SOURCE_OPTIONS = [
  { key: 'productivity', label: 'Productivity map',    desc: 'Building productivity zones' },
  { key: 'ndvi',         label: 'Recent NDVI image',   desc: null },
  { key: 'soil',         label: 'Soil analysis results', desc: null },
]

const ZONE_COLORS = {
  high:   { fill: '#7c3aed', label: 'High',   mapFill: '#9333ea' },
  medium: { fill: '#a855f7', label: 'Medium', mapFill: '#c084fc' },
  low:    { fill: '#e9d5ff', label: 'Low',    mapFill: '#e9d5ff' },
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  PHASE 1 — Create VRA Modal                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function CreateVraModal({ farmId, farmName, farmArea, onClose, onCreated, productivityZones, onZonesComputed }) {
  const [prescType, setPrescType] = useState('seeding')
  const [source, setSource] = useState('productivity')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sourceStatus, setSourceStatus] = useState({
    productivity: productivityZones?.zones?.length || productivityZones?.length ? 'ready' : 'pending',
    ndvi: 'ready',
    soil: 'unavailable',
  })

  // Auto-compute zones when modal opens if needed
  useEffect(() => {
    if (sourceStatus.productivity !== 'pending') return
    let cancelled = false
    setSourceStatus(s => ({ ...s, productivity: 'loading' }))
    ;(async () => {
      try {
        await computeGeoZones(farmId, 3, 90)
        const zRes = await getGeoZones(farmId)
        if (!cancelled) {
          onZonesComputed?.(zRes.data)
          setSourceStatus(s => ({ ...s, productivity: 'ready' }))
        }
      } catch {
        if (!cancelled) setSourceStatus(s => ({ ...s, productivity: 'error' }))
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (prescType === 'multiple') return // not implemented
    setLoading(true); setError(null)
    try {
      // Ensure zones if source is productivity
      if (source === 'productivity' && sourceStatus.productivity === 'error') {
        setSourceStatus(s => ({ ...s, productivity: 'loading' }))
        await computeGeoZones(farmId, 3, 90)
        const zRes = await getGeoZones(farmId)
        onZonesComputed?.(zRes.data)
        setSourceStatus(s => ({ ...s, productivity: 'ready' }))
      }
      const res = await computeVraMap(farmId, {
        prescription_type: prescType === 'multiple' ? 'fertilizer' : prescType,
        base_rate: 100,
        product_name: '',
      })
      onCreated(res.data, prescType)
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to create VRA map')
    } finally { setLoading(false) }
  }

  const sourceReady = sourceStatus[source] === 'ready'
  const canCreate = sourceReady && prescType !== 'multiple' && !loading

  return (
    <div className="vra-create-overlay" role="dialog" aria-modal="true">
      <div className="vra-create-modal">
        <div className="vra-create-modal__header">
          <h2>Create VRA map</h2>
          <button className="vra-create-modal__close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        <div className="vra-create-modal__body">
          {/* Left: type cards */}
          <div className="vra-create-modal__types">
            {PRESC_TYPES.map(t => {
              const Icon = t.icon
              const sel = prescType === t.key
              return (
                <button
                  key={t.key}
                  className={`vra-type-card${sel ? ' vra-type-card--selected' : ''}${t.key === 'multiple' ? ' vra-type-card--disabled' : ''}`}
                  onClick={() => t.key !== 'multiple' && setPrescType(t.key)}
                >
                  <div className="vra-type-card__radio">{sel && <div className="vra-type-card__radio-dot" />}</div>
                  <Icon size={24} strokeWidth={1.5} />
                  <span>{t.label}</span>
                </button>
              )
            })}
          </div>

          {/* Right: source + create */}
          <div className="vra-create-modal__right">
            <div className="vra-create-modal__source-label">Source for prescription map:</div>
            <div className="vra-create-modal__sources">
              {SOURCE_OPTIONS.map(s => {
                const status = sourceStatus[s.key]
                return (
                  <button
                    key={s.key}
                    className={`vra-source-row${source === s.key ? ' vra-source-row--active' : ''}${status === 'unavailable' ? ' vra-source-row--disabled' : ''}`}
                    onClick={() => status !== 'unavailable' && setSource(s.key)}
                  >
                    <div className="vra-source-row__icon">
                      {s.key === 'productivity' && <Layers size={16} />}
                      {s.key === 'ndvi' && <Sprout size={16} />}
                      {s.key === 'soil' && <FlaskConical size={16} />}
                    </div>
                    <div className="vra-source-row__text">
                      <div className="vra-source-row__label">{s.label}</div>
                      {status === 'loading' && s.desc && <div className="vra-source-row__desc">{s.desc}</div>}
                    </div>
                    <div className="vra-source-row__status">
                      {status === 'loading' && <Loader2 size={16} className="vra-spin" />}
                      {status === 'ready' &&   <Check size={16} className="vra-check" />}
                      {status === 'error' &&   <X size={16} className="vra-error-icon" />}
                      {status === 'unavailable' && <Info size={16} className="vra-info-icon" />}
                    </div>
                  </button>
                )
              })}
            </div>

            {error && <div className="vra-create-modal__error">{error}</div>}

            <button className="vra-create-modal__submit" onClick={handleCreate} disabled={!canCreate}>
              {loading ? <><Loader2 size={16} className="vra-spin" /> Creating…</> : 'Create map'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  PHASE 2 — Full-screen VRA Result View                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function VraResultView({ farm, vraData, prescType: initialPrescType, productivityZones, onBack, onZonesComputed }) {
  const [prescType, setPrescType] = useState(initialPrescType || 'seeding')
  const [source, setSource] = useState('productivity')
  const [nZones, setNZones] = useState(3)
  const [product, setProduct] = useState(vraData?.product_name || '')
  const [variety, setVariety] = useState('')
  const [baseRate, setBaseRate] = useState(vraData?.base_rate ?? 100)
  const [rateUnit, setRateUnit] = useState(PRESC_TYPES.find(p => p.key === initialPrescType)?.unit || 'seeds/ha')
  const [result, setResult] = useState(vraData)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [zonesDropOpen, setZonesDropOpen] = useState(false)

  const vraMapRef = useRef(null)
  const vraMapNodeRef = useRef(null)
  const prodMapRef = useRef(null)
  const prodMapNodeRef = useRef(null)

  // Extract zone info from VRA result
  const zones = result
    ? Object.entries(result.rates_json || {}).map(([cls, info]) => ({
        zone: cls,
        rate: info?.rate ?? result[`${cls}_zone_rate`] ?? 0,
        area_ha: info?.area_ha ?? 0,
        multiplier: info?.multiplier ?? 1,
      }))
    : []

  const totalArea = zones.reduce((s, z) => s + (z.area_ha || 0), 0) || (farm.size_hectares || farm.area || 0)

  // Regenerate when params change
  const regenerate = useCallback(async () => {
    if (!farm?.id) return
    setLoading(true)
    try {
      const res = await computeVraMap(farm.id, {
        prescription_type: prescType === 'multiple' ? 'fertilizer' : prescType,
        base_rate: Number(baseRate),
        product_name: product || '',
      })
      setResult(res.data)
    } catch (e) {
      console.error('VRA regenerate failed:', e)
    } finally { setLoading(false) }
  }, [farm?.id, prescType, baseRate, product])

  /* ── VRA map (left) ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!vraMapNodeRef.current || !result?.zones_geojson) return
    const token = import.meta.env.VITE_MAPBOX_TOKEN || ''
    if (!token) return
    mapboxgl.accessToken = token

    const map = new mapboxgl.Map({
      container: vraMapNodeRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [farm.longitude || 30.06, farm.latitude || -1.94],
      zoom: 17,
      attributionControl: true,
    })
    vraMapRef.current = map

    map.on('load', () => {
      const fc = result.zones_geojson
      if (!fc?.features?.length) return

      map.addSource('vra-zones', { type: 'geojson', data: fc })
      map.addLayer({
        id: 'vra-fill', type: 'fill', source: 'vra-zones',
        paint: {
          'fill-color': [
            'match', ['get', 'zone_class'],
            'high',   ZONE_COLORS.high.mapFill,
            'medium', ZONE_COLORS.medium.mapFill,
            'low',    ZONE_COLORS.low.mapFill,
            '#888'
          ],
          'fill-opacity': 0.65,
        },
      })
      map.addLayer({
        id: 'vra-line', type: 'line', source: 'vra-zones',
        paint: { 'line-color': '#4c1d95', 'line-width': 1.5, 'line-opacity': 0.8 },
      })

      // Add farm boundary if available
      if (farm.boundary_geojson || farm.boundary) {
        let geom = farm.boundary_geojson || farm.boundary
        if (typeof geom === 'string') geom = JSON.parse(geom)
        map.addSource('farm-border', {
          type: 'geojson',
          data: { type: 'Feature', geometry: geom, properties: {} },
        })
        map.addLayer({
          id: 'farm-border-line', type: 'line', source: 'farm-border',
          paint: { 'line-color': '#111', 'line-width': 2, 'line-opacity': 0.7 },
        })
      }

      // Fit to features
      try {
        const coords = fc.features.flatMap(f =>
          f.geometry?.coordinates?.flat?.(2) || []
        ).filter(c => Array.isArray(c) && c.length === 2)
        if (coords.length > 1) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c),
            new mapboxgl.LngLatBounds(coords[0], coords[0])
          )
          map.fitBounds(bounds, { padding: 60, maxZoom: 18 })
        }
      } catch {} // eslint-disable-line no-empty

      // Hover popup
      const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'vra-map-tooltip' })
      map.on('mousemove', 'vra-fill', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const p = e.features?.[0]?.properties
        if (!p) return
        const cls = (p.zone_class || '').charAt(0).toUpperCase() + (p.zone_class || '').slice(1)
        popup.setLngLat(e.lngLat).setHTML(
          `<strong>${cls}</strong><br/>Rate: ${p.prescription_rate || '—'} ${p.rate_unit || ''}<br/>NDVI: ${Number(p.mean_ndvi || 0).toFixed(3)}`
        ).addTo(map)
      })
      map.on('mouseleave', 'vra-fill', () => {
        map.getCanvas().style.cursor = ''
        popup.remove()
      })
    })

    return () => map.remove()
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Productivity map (right) ─────────────────────────────────────── */
  useEffect(() => {
    if (!prodMapNodeRef.current) return
    const token = import.meta.env.VITE_MAPBOX_TOKEN || ''
    if (!token) return
    mapboxgl.accessToken = token

    const pz = productivityZones?.zones || productivityZones || []

    const map = new mapboxgl.Map({
      container: prodMapNodeRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [farm.longitude || 30.06, farm.latitude || -1.94],
      zoom: 17,
      attributionControl: true,
    })
    prodMapRef.current = map

    map.on('load', () => {
      // Productivity zone data
      const features = pz
        .filter(z => z.boundary_geojson || z.boundary)
        .map((z, i) => {
          let geom = z.boundary_geojson || z.boundary
          if (typeof geom === 'string') geom = JSON.parse(geom)
          return {
            type: 'Feature',
            geometry: geom,
            properties: {
              zone_class: z.zone_class,
              mean_ndvi: z.mean_ndvi,
              color_hex: z.color_hex || (z.zone_class === 'high' ? '#4CAF50' : z.zone_class === 'medium' ? '#FFC107' : '#F44336'),
              area_ha: z.area_ha,
            },
          }
        })

      if (features.length) {
        const fc = { type: 'FeatureCollection', features }
        map.addSource('prod-zones', { type: 'geojson', data: fc })
        map.addLayer({
          id: 'prod-fill', type: 'fill', source: 'prod-zones',
          paint: { 'fill-color': ['get', 'color_hex'], 'fill-opacity': 0.55 },
        })
        map.addLayer({
          id: 'prod-line', type: 'line', source: 'prod-zones',
          paint: { 'line-color': ['get', 'color_hex'], 'line-width': 1.5, 'line-opacity': 0.8 },
        })

        // Fit to features
        try {
          const coords = features.flatMap(f =>
            f.geometry?.coordinates?.flat?.(2) || []
          ).filter(c => Array.isArray(c) && c.length === 2)
          if (coords.length > 1) {
            const bounds = coords.reduce(
              (b, c) => b.extend(c),
              new mapboxgl.LngLatBounds(coords[0], coords[0])
            )
            map.fitBounds(bounds, { padding: 60, maxZoom: 18 })
          }
        } catch {} // eslint-disable-line no-empty
      }

      // Farm boundary
      if (farm.boundary_geojson || farm.boundary) {
        let geom = farm.boundary_geojson || farm.boundary
        if (typeof geom === 'string') geom = JSON.parse(geom)
        map.addSource('farm-border', {
          type: 'geojson',
          data: { type: 'Feature', geometry: geom, properties: {} },
        })
        map.addLayer({
          id: 'farm-border-line', type: 'line', source: 'farm-border',
          paint: { 'line-color': '#111', 'line-width': 2, 'line-opacity': 0.7 },
        })
      }
    })

    return () => map.remove()
  }, [productivityZones]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Export handler ────────────────────────────────────────────────── */
  const doExport = async (type) => {
    if (!result?.id) return
    setExporting(true)
    try {
      const res = type === 'geojson' ? await exportVraGeoJson(result.id) : await exportVraIsoxml(result.id)
      const mime = type === 'geojson' ? 'application/json' : 'application/xml'
      const ext  = type === 'geojson' ? 'geojson' : 'xml'
      const blob = new Blob([res.data], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${farm.name || 'field'}_vra.${ext}`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { console.error('Export failed', e) }
    finally { setExporting(false) }
  }

  const typeInfo = PRESC_TYPES.find(t => t.key === prescType) || PRESC_TYPES[0]

  return (
    <div className="vra-result-view">
      {/* ── Left sidebar ─────────────────────────────────────────── */}
      <div className="vra-sidebar">
        <div className="vra-sidebar__top">
          <button className="vra-sidebar__back" onClick={onBack}>
            <ChevronLeft size={16} /> Back
          </button>
          <button className="vra-sidebar__guide">
            <BookOpen size={14} /> User Guide
          </button>
        </div>

        <div className="vra-sidebar__title">
          <h3>VRA map</h3>
          <span className="vra-sidebar__field-info">{farm.name} · {Number(totalArea).toFixed(1)} ha</span>
        </div>

        {/* Map settings */}
        <details className="vra-sidebar__section" open>
          <summary className="vra-sidebar__section-title">Map settings</summary>
          <div className="vra-sidebar__type-grid">
            {PRESC_TYPES.map(t => {
              const Icon = t.icon
              return (
                <button
                  key={t.key}
                  className={`vra-sidebar__type-btn${prescType === t.key ? ' active' : ''}${t.key === 'multiple' ? ' disabled' : ''}`}
                  onClick={() => {
                    if (t.key !== 'multiple') {
                      setPrescType(t.key)
                      setRateUnit(t.unit)
                    }
                  }}
                >
                  <Icon size={16} strokeWidth={1.5} />
                  <span>{t.label}</span>
                </button>
              )
            })}
          </div>

          {/* Source dropdown display */}
          <div className="vra-sidebar__field-row">
            <label>Source for prescription map</label>
            <div className="vra-sidebar__select-display">
              <Layers size={14} /> Productivity map
            </div>
          </div>

          {/* Zones */}
          <div className="vra-sidebar__field-row">
            <div className="vra-sidebar__zones-dropdown" onClick={() => setZonesDropOpen(!zonesDropOpen)}>
              <span>{nZones} zones</span>
              <ChevronDown size={14} />
            </div>
          </div>

          <button className="vra-sidebar__edit-zones-btn" onClick={regenerate} disabled={loading}>
            {loading ? <Loader2 size={14} className="vra-spin" /> : '✧'} {loading ? 'Regenerating…' : 'Edit zones'}
          </button>
        </details>

        {/* Planting / prescription settings */}
        <details className="vra-sidebar__section" open>
          <summary className="vra-sidebar__section-title">{typeInfo.label}</summary>

          <div className="vra-sidebar__field-row">
            <select className="vra-sidebar__select" defaultValue="">
              <option value="" disabled>Select…</option>
              <option value="maize">Maize</option>
              <option value="wheat">Wheat</option>
              <option value="cassava">Cassava</option>
              <option value="rice">Rice</option>
              <option value="potato">Potato</option>
              <option value="beans">Beans</option>
            </select>
          </div>

          <div className="vra-sidebar__field-row">
            <input
              className="vra-sidebar__input vra-sidebar__input--hint"
              type="text"
              placeholder="Variety/Hybrid"
              value={variety}
              onChange={e => setVariety(e.target.value)}
            />
          </div>

          <div className="vra-sidebar__field-row">
            <label>Standard rate</label>
            <div className="vra-sidebar__rate-row">
              <input
                className="vra-sidebar__input vra-sidebar__input--number"
                type="number"
                value={baseRate}
                onChange={e => setBaseRate(e.target.value)}
                min={0}
              />
              <div className="vra-sidebar__unit-select">
                <span>{rateUnit}</span>
                <ChevronDown size={12} />
              </div>
            </div>
          </div>

          {/* Zone rate table */}
          <div className="vra-sidebar__zone-table">
            <div className="vra-sidebar__zone-table-header">
              <span>Productivity zone</span>
              <span>Rate, {rateUnit}</span>
            </div>
            {['high', 'medium', 'low'].map((cls, i) => {
              const z = zones.find(zz => zz.zone === cls)
              const pct = totalArea > 0 && z ? ((z.area_ha / totalArea) * 100).toFixed(0) : '—'
              return (
                <div key={cls} className="vra-sidebar__zone-row">
                  <div className="vra-sidebar__zone-label">
                    <div className="vra-sidebar__zone-color" style={{ background: ZONE_COLORS[cls].fill }} />
                    <div>
                      <div className="vra-sidebar__zone-name">Zone {i + 1}</div>
                      <div className="vra-sidebar__zone-detail">
                        {z ? `${z.area_ha.toFixed(1)} ha (${pct}%)` : '—'} · {cls.charAt(0).toUpperCase() + cls.slice(1)}
                        {z?.multiplier != null && z.multiplier !== 1 && (
                          <span className={`vra-sidebar__zone-pct ${z.multiplier < 1 ? 'save' : 'boost'}`}>
                            {z.multiplier < 1 ? `${((1 - z.multiplier) * 100).toFixed(0)}%` : `+${((z.multiplier - 1) * 100).toFixed(0)}%`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <input
                    className="vra-sidebar__zone-rate-input"
                    type="number"
                    value={z?.rate?.toFixed(0) ?? 0}
                    readOnly
                  />
                </div>
              )
            })}
          </div>

          <button className="vra-sidebar__invert-btn">
            Invert rates ⇅
          </button>
        </details>

        {/* Trial toggle */}
        <div className="vra-sidebar__trial-row">
          <span>🧪 Trial</span>
          <Info size={14} />
        </div>

        {/* Bottom actions */}
        <div className="vra-sidebar__actions">
          <button className="vra-sidebar__save-btn" onClick={regenerate} disabled={loading}>
            <Save size={14} /> Save
          </button>
          <button className="vra-sidebar__export-btn" onClick={() => doExport('geojson')} disabled={exporting || !result?.id}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* ── Center: VRA Map ───────────────────────────────────────── */}
      <div className="vra-map-panel">
        <div className="vra-map-panel__label">
          <span>VRA map</span>
          <span className="vra-map-panel__sub">⚡ {typeInfo.label}</span>
        </div>
        <div className="vra-map-panel__map" ref={vraMapNodeRef} />
        <div className="vra-map-panel__legend">
          {['low', 'medium', 'high'].map(cls => (
            <div key={cls} className="vra-map-panel__legend-item">
              <span className="vra-map-panel__legend-swatch" style={{ background: ZONE_COLORS[cls].mapFill }} />
              <span>Zone {cls === 'low' ? 3 : cls === 'medium' ? 2 : 1} ({ZONE_COLORS[cls].label})</span>
            </div>
          ))}
          <button className="vra-map-panel__legend-toggle">▾ Hide legend</button>
        </div>
      </div>

      {/* ── Right: Productivity Map ───────────────────────────────── */}
      <div className="vra-map-panel vra-map-panel--source">
        <div className="vra-map-panel__label">
          <span>Source data</span>
          <span className="vra-map-panel__sub">🗺 Productivity map</span>
        </div>
        <div className="vra-map-panel__map" ref={prodMapNodeRef} />
        <div className="vra-map-panel__legend">
          <div className="vra-map-panel__legend-item">
            <span className="vra-map-panel__legend-swatch" style={{ background: '#F44336' }} />
            <span>Low</span>
          </div>
          <div className="vra-map-panel__legend-item">
            <span className="vra-map-panel__legend-swatch" style={{ background: '#FFC107' }} />
            <span>Medium</span>
          </div>
          <div className="vra-map-panel__legend-item">
            <span className="vra-map-panel__legend-swatch" style={{ background: '#4CAF50' }} />
            <span>High</span>
          </div>
          <button className="vra-map-panel__legend-toggle">▾ Hide legend</button>
        </div>
      </div>
    </div>
  )
}

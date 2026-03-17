/**
 * VraDashboard
 * ------------
 * Generate, view, and export Variable Rate Application prescription maps.
 * Leaflet map (window.L CDN) shows zones colored by prescription intensity.
 */
import { useEffect, useRef, useState } from 'react'
import { Layers, RefreshCw, Download, Info, ChevronDown } from 'lucide-react'
import {
  getFarms, getSeasonsForFarm,
  getVraMapsForFarm, computeVraMap,
  exportVraGeoJson, exportVraIsoxml,
} from '../api'
import { useFarmDataListener } from '../utils/farmEvents'

const PRESCRIPTION_TYPES = [
  { key: 'fertilizer', label: 'Fertilizer', unit: 'kg/ha' },
  { key: 'seeding',    label: 'Seeding',    unit: 'kg/ha' },
  { key: 'chemical',  label: 'Chemical',   unit: 'L/ha' },
]

const ZONE_INFO = {
  high:   { label: 'High Productivity', color: '#1565C0', bg: '#E3F2FD', tip: 'Reduce input — over-application risk' },
  medium: { label: 'Medium Productivity', color: '#F57F17', bg: '#FFF8E1', tip: 'Standard application rate' },
  low:    { label: 'Low Productivity',  color: '#B71C1C', bg: '#FFEBEE', tip: 'Increase input — nutrient deficiency likely' },
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function VraDashboard() {
  const [farms, setFarms]           = useState([])
  const [farmId, setFarmId]         = useState(null)
  const [seasons, setSeasons]       = useState([])
  const [seasonId, setSeasonId]     = useState('')
  const [prescType, setPrescType]   = useState('fertilizer')
  const [baseRate, setBaseRate]     = useState(100)
  const [product, setProduct]       = useState('')
  const [vraMaps, setVraMaps]       = useState([])
  const [activeVra, setActiveVra]   = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState(null)
  const mapRef = useRef(null)
  const mapObj = useRef(null)

  // Load farms
  useEffect(() => {
    getFarms()
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : res.data.farms || []
        setFarms(list)
        if (list.length) setFarmId(list[0].id)
      })
      .catch(console.error)
  }, [])

  // Re-fetch when another page triggers a scan
  useFarmDataListener(() => {
    getFarms().then(res => {
      const list = Array.isArray(res.data) ? res.data : res.data.farms || []
      setFarms(list)
    }).catch(() => {})
  })

  // Load seasons + vra maps when farm changes
  useEffect(() => {
    if (!farmId) return
    setActiveVra(null)
    Promise.allSettled([
      getSeasonsForFarm(farmId),
      getVraMapsForFarm(farmId),
    ]).then(([s, v]) => {
      setSeasons(s.status === 'fulfilled' ? (s.value.data.seasons || []) : [])
      const maps = v.status === 'fulfilled' ? (v.value.data.vra_maps || []) : []
      setVraMaps(maps)
      if (maps.length) setActiveVra(maps[0])
    })
  }, [farmId])

  // Show active VRA zones on map
  useEffect(() => {
    if (!mapRef.current || !window.L) return
    if (!mapObj.current) {
      mapObj.current = window.L.map(mapRef.current, { zoomControl: true }).setView([0, 0], 2)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(mapObj.current)
    }
    const map = mapObj.current

    // Clear existing layers
    map.eachLayer(l => { if (l._isVraLayer) map.removeLayer(l) })

    if (!activeVra?.zone_rates) return
    const gj = {
      type: 'FeatureCollection',
      features: Object.entries(activeVra.zone_rates).map(([zone, info]) => ({
        type: 'Feature',
        properties: { zone_class: zone, ...info },
        geometry: info.geometry || null,
      })).filter(f => f.geometry),
    }
    if (!gj.features.length) return

    const layer = window.L.geoJSON(gj, {
      style: f => {
        const zi = ZONE_INFO[f.properties.zone_class] || ZONE_INFO.medium
        return { color: '#fff', weight: 1, fillColor: f.properties.fill_color || zi.color, fillOpacity: 0.65 }
      },
      onEachFeature: (f, l) => {
        const p = f.properties
        l.bindPopup(`
          <b>${p.zone_class?.toUpperCase()} Zone</b><br>
          Area: ${p.area_ha?.toFixed(2) || '—'} ha<br>
          Rate: ${p.prescription_rate?.toFixed(1) || '—'} ${PRESCRIPTION_TYPES.find(t => t.key === activeVra.prescription_type)?.unit || ''}<br>
          Multiplier: ${p.rate_multiplier?.toFixed(2) || '—'}x
        `)
      },
    })
    layer._isVraLayer = true
    layer.addTo(map)
    try { map.fitBounds(layer.getBounds(), { padding: [20, 20] }) } catch (_) {}
  }, [activeVra])

  const handleGenerate = async () => {
    if (!farmId) return
    setGenerating(true); setError(null)
    try {
      const res = await computeVraMap(farmId, {
        prescription_type: prescType,
        base_rate: Number(baseRate),
        product_name: product || null,
        season_id: seasonId ? Number(seasonId) : null,
      })
      const newVra = res.data
      setVraMaps(prev => [newVra, ...prev.slice(0, 9)])
      setActiveVra(newVra)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Map generation failed — ensure productivity zones exist for this farm.')
    } finally {
      setGenerating(false)
    }
  }

  const handleDownload = async (type) => {
    if (!activeVra) return
    try {
      if (type === 'geojson') {
        const res = await exportVraGeoJson(activeVra.id)
        downloadBlob(res.data, `vra_${activeVra.id}.geojson`)
      } else {
        const res = await exportVraIsoxml(activeVra.id)
        downloadBlob(res.data, `vra_${activeVra.id}.xml`)
      }
    } catch (e) {
      console.error('Download failed', e)
    }
  }

  const activeType = PRESCRIPTION_TYPES.find(t => t.key === prescType)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Layers size={22} color="var(--primary)" />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>VRA Prescription Maps</h1>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20, alignItems: 'flex-end' }}>
        <div>
          <label style={LABEL}>Farm</label>
          <div style={{ position: 'relative' }}>
            <select value={farmId || ''} onChange={e => setFarmId(Number(e.target.value))} style={{ ...SEL, paddingRight: 30, marginTop: 4 }}>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name || `Farm #${f.id}`}</option>)}
            </select>
            <ChevronDown size={12} style={CHEVRON} />
          </div>
        </div>
        <div>
          <label style={LABEL}>Season (optional)</label>
          <div style={{ position: 'relative' }}>
            <select value={seasonId} onChange={e => setSeasonId(e.target.value)} style={{ ...SEL, paddingRight: 30, marginTop: 4 }}>
              <option value="">— All —</option>
              {seasons.map(s => <option key={s.id} value={s.id}>{s.name} ({s.year})</option>)}
            </select>
            <ChevronDown size={12} style={CHEVRON} />
          </div>
        </div>
        <div>
          <label style={LABEL}>Product Name</label>
          <input
            value={product} onChange={e => setProduct(e.target.value)}
            placeholder="e.g. NPK 17-17-17"
            style={{ ...INP, marginTop: 4 }}
          />
        </div>
        <div>
          <label style={LABEL}>Base Rate ({activeType?.unit})</label>
          <input type="number" value={baseRate} onChange={e => setBaseRate(e.target.value)} style={{ ...INP, width: 90, marginTop: 4 }} />
        </div>
        <button
          onClick={handleGenerate} disabled={generating}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
          {generating ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
          Generate Map
        </button>
      </div>

      {/* Prescription type tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 8, padding: 4, width: 'fit-content', border: '1px solid var(--border)' }}>
        {PRESCRIPTION_TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => setPrescType(t.key)}
            style={{
              padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: prescType === t.key ? 'var(--primary)' : 'transparent',
              color: prescType === t.key ? '#fff' : 'var(--text-secondary)',
            }}
          >{t.label}</button>
        ))}
      </div>

      {error && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 14px', background: '#FFEBEE', borderRadius: 8, marginBottom: 16, color: '#B71C1C', fontSize: 13 }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}

      {/* Map + sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>

        {/* Map */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', minHeight: 420, position: 'relative' }}>
          <div ref={mapRef} style={{ width: '100%', height: 420 }} />
          {!activeVra && !generating && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', color: 'var(--text-secondary)' }}>
              <Layers size={36} style={{ opacity: 0.25, marginBottom: 8 }} />
              <div style={{ fontSize: 13 }}>Generate a prescription map to see zone coverage</div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Zone legend */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>Zone Legend</div>
            {Object.entries(ZONE_INFO).map(([key, z]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: z.color, flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: z.color }}>{z.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{z.tip}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Active VRA stats */}
          {activeVra && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>Prescription Summary</div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Base Rate</div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{activeVra.base_rate} {activeType?.unit}</div>
              </div>
              {activeVra.product_name && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Product</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{activeVra.product_name}</div>
                </div>
              )}
              {activeVra.savings_pct != null && (
                <div style={{ padding: '8px 10px', background: '#E8F5E9', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#2E7D32' }}>{activeVra.savings_pct?.toFixed(1)}%</div>
                  <div style={{ fontSize: 11, color: '#388E3C', marginTop: 2 }}>Estimated product savings vs flat-rate</div>
                </div>
              )}

              {/* Zone rate table */}
              {activeVra.zone_rates && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>Zone Rates</div>
                  {Object.entries(activeVra.zone_rates).map(([zone, info]) => {
                    const zi = ZONE_INFO[zone] || ZONE_INFO.medium
                    return (
                      <div key={zone} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: zi.color }} />
                          <span style={{ color: 'var(--text-secondary)' }}>{zone}</span>
                        </div>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{info.prescription_rate?.toFixed(1)}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Downloads */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 12 }}>
                <button onClick={() => handleDownload('geojson')} style={{ ...DL_BTN }}>
                  <Download size={11} /> GeoJSON
                </button>
                <button onClick={() => handleDownload('isoxml')} style={{ ...DL_BTN }}>
                  <Download size={11} /> ISOXML
                </button>
              </div>
            </div>
          )}

          {/* History list */}
          {vraMaps.length > 1 && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>Map History</div>
              {vraMaps.map(v => (
                <button
                  key={v.id}
                  onClick={() => setActiveVra(v)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '6px 8px', marginBottom: 4, borderRadius: 7,
                    border: activeVra?.id === v.id ? '1px solid var(--primary)' : '1px solid transparent',
                    background: activeVra?.id === v.id ? 'var(--primary-10)' : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{v.prescription_type}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{v.base_rate} {activeType?.unit}</div>
                  </div>
                  {v.savings_pct != null && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#2E7D32' }}>−{v.savings_pct?.toFixed(0)}%</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── styles ──────────────────────────────────────────────────────────────────

const LABEL   = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }
const SEL     = { padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: 13 }
const INP     = { padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: 13, minWidth: 140 }
const CHEVRON = { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8' }
const DL_BTN  = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '7px 0', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }

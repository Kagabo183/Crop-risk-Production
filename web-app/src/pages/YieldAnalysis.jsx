/**
 * YieldAnalysis
 * -------------
 * Upload harvest GeoJSON, visualize yield statistics, and compare productivity zones.
 */
import { useEffect, useRef, useState } from 'react'
import { BarChart2, Upload, Trash2, ChevronDown, Info } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  getFarms, getSeasonsForFarm, getYieldMapsForFarm, uploadYieldMap, deleteYieldMap,
} from '../api'
import { useFarmDataListener } from '../utils/farmEvents'

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmt = (n, d = 2) => (n != null && !isNaN(n) ? Number(n).toFixed(d) : '—')

const ZONE_COLORS = { high: '#1565C0', medium: '#F57F17', low: '#B71C1C', default: '#607D8B' }
function zoneColor(name) {
  return ZONE_COLORS[String(name).toLowerCase()] || ZONE_COLORS.default
}

const STAT_ITEMS = [
  { key: 'mean_yield_tha',  label: 'Mean Yield',  unit: 't/ha',  color: '#2E7D32' },
  { key: 'max_yield_tha',   label: 'Peak Yield',  unit: 't/ha',  color: '#1565C0' },
  { key: 'min_yield_tha',   label: 'Min Yield',   unit: 't/ha',  color: '#FF8F00' },
  { key: 'cv_pct',          label: 'Variability', unit: 'CV%',   color: '#7B1FA2' },
  { key: 'total_yield_kg',  label: 'Total',       unit: 'kg',    color: '#00695C' },
  { key: 'area_surveyed_ha',label: 'Area',        unit: 'ha',    color: '#37474F' },
]

// ─── component ───────────────────────────────────────────────────────────────

export default function YieldAnalysis() {
  const [farms, setFarms]         = useState([])
  const [farmId, setFarmId]       = useState(null)
  const [seasons, setSeasons]     = useState([])
  const [seasonId, setSeasonId]   = useState('')
  const [cropType, setCropType]   = useState('')
  const [harvestDate, setHarvestDate] = useState('')
  const [yieldMaps, setYieldMaps] = useState([])
  const [activeMap, setActiveMap] = useState(null)
  const [loading, setLoading]     = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver]   = useState(false)
  const [error, setError]         = useState(null)
  const fileInput = useRef(null)

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

  // Load seasons + yield maps when farm changes
  useEffect(() => {
    if (!farmId) return
    setLoading(true)
    setActiveMap(null)
    Promise.allSettled([
      getSeasonsForFarm(farmId),
      getYieldMapsForFarm(farmId),
    ]).then(([s, y]) => {
      setSeasons(s.status === 'fulfilled' ? (s.value.data.seasons || []) : [])
      const maps = y.status === 'fulfilled' ? (y.value.data.yield_maps || []) : []
      setYieldMaps(maps)
      if (maps.length) setActiveMap(maps[0])
    }).finally(() => setLoading(false))
  }, [farmId])

  const processFile = async (file) => {
    if (!file) return
    if (!file.name.match(/\.(geojson|json)$/i)) {
      setError('Only .geojson or .json files are accepted.'); return
    }
    setUploading(true); setError(null)
    try {
      const res = await uploadYieldMap(farmId, file, {
        seasonId: seasonId ? Number(seasonId) : undefined,
        cropType: cropType || undefined,
        harvestDate: harvestDate || undefined,
      })
      const newMap = res.data
      setYieldMaps(prev => [newMap, ...prev])
      setActiveMap(newMap)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Upload failed — ensure the file contains geometry and a yield field.')
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (e) => processFile(e.target.files?.[0])

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    processFile(e.dataTransfer.files?.[0])
  }

  const handleDelete = async (mapId) => {
    if (!window.confirm('Delete this yield map?')) return
    await deleteYieldMap(mapId)
    setYieldMaps(prev => prev.filter(m => m.id !== mapId))
    if (activeMap?.id === mapId) setActiveMap(yieldMaps.find(m => m.id !== mapId) || null)
  }

  // Build zone comparison chart data
  const chartData = activeMap?.zone_comparison
    ? Object.entries(activeMap.zone_comparison).map(([zone, info]) => ({
        zone: zone.charAt(0).toUpperCase() + zone.slice(1),
        key: zone,
        yield: Number(info.estimated_yield_tha ?? info.yield ?? 0),
        ndvi: Number(info.mean_ndvi ?? 0),
        area: Number(info.area_ha ?? 0),
      }))
    : []

  const stats = activeMap?.statistics || {}

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <BarChart2 size={22} color="var(--primary)" />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Yield Analysis</h1>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24, alignItems: 'flex-end' }}>
        <Select label="Farm" value={farmId || ''} onChange={v => setFarmId(Number(v))}>
          {farms.map(f => <option key={f.id} value={f.id}>{f.name || `Farm #${f.id}`}</option>)}
        </Select>
        <Select label="Season (optional)" value={seasonId} onChange={setSeasonId}>
          <option value="">— None —</option>
          {seasons.map(s => <option key={s.id} value={s.id}>{s.name} ({s.year})</option>)}
        </Select>
        <div>
          <label style={LBL}>Crop Type</label>
          <input value={cropType} onChange={e => setCropType(e.target.value)} placeholder="e.g. Maize" style={{ ...INP, marginTop: 4 }} />
        </div>
        <div>
          <label style={LBL}>Harvest Date</label>
          <input type="date" value={harvestDate} onChange={e => setHarvestDate(e.target.value)} style={{ ...INP, marginTop: 4 }} />
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInput.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--border)'}`,
          borderRadius: 12, padding: '28px 20px', textAlign: 'center',
          background: dragOver ? 'var(--primary-10)' : 'var(--bg-card)',
          cursor: 'pointer', marginBottom: 24, transition: 'all .2s',
        }}
      >
        <input ref={fileInput} type="file" accept=".geojson,.json" onChange={handleFileChange} style={{ display: 'none' }} />
        <Upload size={28} style={{ opacity: .4, marginBottom: 8, color: 'var(--primary)' }} />
        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
          {uploading ? 'Uploading…' : 'Drop GeoJSON yield map here, or click to browse'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
          Accepts .geojson / .json · max 20 MB · must include yield values per polygon/point
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 14px', background: '#FFEBEE', borderRadius: 8, marginBottom: 20, color: '#B71C1C', fontSize: 13 }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}

      {/* Yield map selector */}
      {yieldMaps.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {yieldMaps.map(m => (
            <div key={m.id}
              onClick={() => setActiveMap(m)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 99, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                border: `1px solid ${activeMap?.id === m.id ? 'var(--primary)' : 'var(--border)'}`,
                background: activeMap?.id === m.id ? 'var(--primary)' : 'var(--bg-card)',
                color: activeMap?.id === m.id ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {m.crop_type || 'Yield'} {m.harvest_date ? `(${m.harvest_date})` : `#${m.id}`}
              <Trash2 size={11} style={{ opacity: .6 }} onClick={e => { e.stopPropagation(); handleDelete(m.id) }} />
            </div>
          ))}
        </div>
      )}

      {/* Stats grid */}
      {activeMap && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
            {STAT_ITEMS.map(({ key, label, unit, color }) => (
              <div key={key} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1 }}>
                  {key === 'total_yield_kg'
                    ? (stats[key] != null ? Math.round(stats[key]).toLocaleString() : '—')
                    : fmt(stats[key])}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{unit}</div>
              </div>
            ))}
          </div>

          {/* Zone comparison chart */}
          {chartData.length > 0 && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700 }}>Zone Yield Comparison</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="zone" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} unit=" t/ha" />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => [`${fmt(v)} t/ha`, 'Estimated Yield']}
                  />
                  <Bar dataKey="yield" radius={[4, 4, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={zoneColor(d.key)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Zone comparison table */}
          {chartData.length > 0 && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Zone', 'Area (ha)', 'Est. Yield (t/ha)', 'Mean NDVI', 'Yield Gap vs Mean'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((d, i) => {
                    const meanYield = activeMap?.statistics?.mean_yield_tha
                    const gap = meanYield != null ? d.yield - meanYield : null
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 2, background: zoneColor(d.key), flexShrink: 0 }} />
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{d.zone}</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{fmt(d.area)}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: zoneColor(d.key) }}>{fmt(d.yield)}</td>
                        <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{fmt(d.ndvi, 3)}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: gap == null ? 'var(--text-secondary)' : gap >= 0 ? '#2E7D32' : '#B71C1C' }}>
                          {gap != null ? `${gap >= 0 ? '+' : ''}${fmt(gap)} t/ha` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && !activeMap && yieldMaps.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
          <BarChart2 size={40} style={{ opacity: .3, marginBottom: 8 }} />
          <div>No yield maps yet. Upload your first harvest GeoJSON above.</div>
        </div>
      )}
    </div>
  )
}

// ─── micro-components ─────────────────────────────────────────────────────────

function Select({ label, value, onChange, children }) {
  return (
    <div>
      <label style={LBL}>{label}</label>
      <div style={{ position: 'relative', marginTop: 4 }}>
        <select value={value} onChange={e => onChange(e.target.value)} style={{ ...INP, paddingRight: 28 }}>
          {children}
        </select>
        <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8' }} />
      </div>
    </div>
  )
}

// ─── styles ──────────────────────────────────────────────────────────────────

const LBL = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }
const INP = { padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: 13 }

import { useEffect, useRef, useState, useCallback } from 'react'

import mapboxgl from 'mapbox-gl'

import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts'

import { ArrowUpRight, CalendarDays, Droplets, Leaf, MoreHorizontal, Thermometer, Upload, Wind, X, Map, FileText, BarChart2, Download, Zap, FlaskConical, CheckCircle2 } from 'lucide-react'

import {
  computeVraMap, getVraMapsForFarm, exportVraGeoJson, exportVraIsoxml,
  generateGridSampling, generateZoneSampling, getSoilSamplesForFarm,
  getYieldMapsForFarm, getYieldEstimate,
  computeGeoZones, getGeoZones,
} from '../api'

import { CreateVraModal, VraResultView } from './VraMapView'



const ndviColor = (v) => {

  if (v == null) return '#94a3b8'

  if (v < 0.2) return '#d92d20'

  if (v < 0.3) return '#f97316'

  if (v < 0.4) return '#fbbf24'

  if (v < 0.5) return '#a3e635'

  return '#166534'

}



const fmt = (iso) => {

  if (!iso) return '—'

  const d = new Date(iso)

  return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}, ${d.getFullYear()}`

}



const fmtShort = (iso) => {

  if (!iso) return '—'

  const d = new Date(iso)

  return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`

}



const TABS = [

  { key: 'status', label: 'Status' },

  { key: 'report', label: 'Field report' },

  { key: 'prescription', label: 'Prescription maps' },

  { key: 'data', label: 'Data' },

  { key: 'yield', label: 'Yield Analysis' },

]



export default function FieldIntelligencePanel({

  farm,

  history = [],

  weather = null,

  tileSource = null,

  onClose,

  onRescan,

  satProgress = null,

  productivityZones = null,

  onZonesComputed,

}) {

  const [activeTab, setActiveTab] = useState('status')

  const [showPrescription, setShowPrescription] = useState(false)
  const [vraResult, setVraResult] = useState(null)
  const [vraPrescType, setVraPrescType] = useState(null)

  const [showSoilSampling, setShowSoilSampling] = useState(false)

  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('fp_features_seen'))

  const markFeatureSeen = useCallback(() => {

    localStorage.setItem('fp_features_seen', '1')

    setShowOnboarding(false)

  }, [])

  const latest = history?.[history.length - 1] || null

  const insights = buildInsights({ farm, latest, weather })



  const weatherTemp = weather?.current?.temperature_2m

    ?? weather?.daily?.temperature_2m_max?.[0]

    ?? weather?.current?.temperature

    ?? null

  const weatherRain = weather?.daily?.precipitation_sum?.[0]

    ?? weather?.current?.precipitation

    ?? weather?.daily?.[0]?.precipitation

    ?? 0

  const weatherWind = weather?.current?.wind_speed_10m

    ?? weather?.daily?.wind_speed_10m_max?.[0]

    ?? null



  if (!farm) {

    return (

      <div className="intel-panel intel-panel--empty">

        <p>Click a field polygon to view intelligence.</p>

      </div>

    )

  }



  return (

    <div className="intel-panel">

      {/* Header */}

      <div className="intel-panel__header">

        <div className="intel-panel__header-top">

          <div>

            <h3 className="intel-panel__title">{farm.name}</h3>

            <div className="intel-panel__subtitle">

              {Number(farm.size_hectares || farm.area || 0).toFixed(1)} ha,{' '}

              {farm.crop_type ? farm.crop_type : <span className="intel-panel__no-data">No crop</span>}

            </div>

          </div>

          <button className="intel-panel__close" onClick={onClose} aria-label="Close panel"><X size={18} /></button>

        </div>



        {/* Header action row */}

        <div className="intel-panel__actions">

          <button className="intel-panel__action-btn" onClick={() => farm.crop_type ? null : null}>

            <Leaf size={14} /> {farm.crop_type ? farm.crop_type : 'Add crop'}

          </button>

          <button className="intel-panel__action-btn">

            <CalendarDays size={14} /> {farm.planting_date ? fmtShort(farm.planting_date) : 'Add planting date'}

          </button>

          {weatherTemp != null && (

            <div className="intel-panel__weather-pill">

              <Thermometer size={13} /> +{Math.round(weatherTemp)}°

              <Droplets size={13} /> {Number(weatherRain).toFixed(0)} mm

              {weatherWind != null && <><Wind size={13} /> {Math.round(weatherWind)} m/s</>}

            </div>

          )}

        </div>



        {/* Tool buttons — all free */}

        <div className="intel-panel__tools">

          <button className="intel-panel__tool-btn" onClick={() => { setShowPrescription(true); markFeatureSeen() }} aria-label="Open prescription map">

            <Map size={12} /> Prescription map <span className="free-badge">Free</span>

          </button>

          <button className="intel-panel__tool-btn" onClick={() => { setShowSoilSampling(true); markFeatureSeen() }} aria-label="Open soil sampling">

            <FlaskConical size={12} /> Soil sampling <span className="free-badge">Free</span>

          </button>

          <button className="intel-panel__tool-btn" onClick={onRescan}>

            <Upload size={12} /> Rescan

          </button>

          <button className="intel-panel__tool-btn icon-only" aria-label="More options"><MoreHorizontal size={15} /></button>

        </div>



        {satProgress && (

          <div className="intel-panel__progress">

            <div
              className="intel-panel__progress-bar"
              style={{
                width: `${satProgress.percent || 0}%`,
                background: satProgress.stage?.toLowerCase().includes('fail') || satProgress.stage?.toLowerCase().includes('timed out')
                  ? '#ef4444'
                  : undefined,
              }}
            />

            <span>{satProgress.stage} {satProgress.percent > 0 ? `${satProgress.percent}%` : ''}</span>

          </div>

        )}

      </div>



      {/* Onboarding toast */}

      {showOnboarding && (

        <div className="fp-onboarding-toast">

          <CheckCircle2 size={15} color="#22c55e" />

          <span>Prescription maps, soil sampling &amp; reports are now <strong>free</strong> — powered by Open-Meteo &amp; Rwanda GIS data.</span>

          <button onClick={markFeatureSeen} aria-label="Dismiss"><X size={13} /></button>

        </div>

      )}



      {/* Tabs */}

      <div className="intel-panel__tabs">

        {TABS.map(t => (

          <button

            key={t.key}

            className={`intel-panel__tab${activeTab === t.key ? ' active' : ''}${t.pro ? ' pro' : ''}`}

            onClick={() => !t.pro && setActiveTab(t.key)}

            disabled={!!t.pro}

          >

            {t.label}

            {t.pro && <span className="pro-badge">PRO</span>}

          </button>

        ))}

      </div>



      {/* Tab content */}

      <div className="intel-panel__content">

        {activeTab === 'status' && (

          <StatusTab farm={farm} history={history} latest={latest} weather={weather} tileSource={tileSource} insights={insights} productivityZones={productivityZones} />

        )}

        {activeTab === 'report' && (

          <ReportTab farm={farm} latest={latest} history={history} weather={weather} insights={insights} />

        )}

        {activeTab === 'prescription' && (

          <PrescriptionMapsTab
            farmId={farm.id}
            farmName={farm.name}
            farm={farm}
            productivityZones={productivityZones}
            onViewVra={(vra, pType) => { setVraResult(vra); setVraPrescType(pType || vra.prescription_type) }}
            onCreateNew={() => setShowPrescription(true)}
          />

        )}

        {activeTab === 'data' && (

          <DataTab latest={latest} history={history} />

        )}

        {activeTab === 'yield' && (

          <YieldTab farmId={farm.id} />

        )}

      </div>



      {/* VRA Modals — OneSoil-style */}

      {showPrescription && !vraResult && (
        <CreateVraModal
          farmId={farm.id}
          farmName={farm.name}
          farmArea={farm.size_hectares || farm.area}
          onClose={() => setShowPrescription(false)}
          productivityZones={productivityZones}
          onZonesComputed={onZonesComputed}
          onCreated={(data, pType) => { setVraResult(data); setVraPrescType(pType); setShowPrescription(false) }}
        />
      )}

      {vraResult && (
        <VraResultView
          farm={farm}
          vraData={vraResult}
          prescType={vraPrescType}
          productivityZones={productivityZones}
          onBack={() => setVraResult(null)}
          onZonesComputed={onZonesComputed}
        />
      )}



      {showSoilSampling && (

        <SoilSamplingModal farmId={farm.id} farmName={farm.name} onClose={() => setShowSoilSampling(false)} />

      )}

    </div>

  )

}



function StatusTab({ farm, history, latest, weather, tileSource, insights, productivityZones }) {

  const [imgHistoryIdx, setImgHistoryIdx] = useState(0)

  const obsWithData = history.filter(h => h.ndvi != null)

  const currentObs = obsWithData[imgHistoryIdx] || latest



  return (

    <div className="intel-status-tab">

      {/* NDVI + Satellite image cards side by side */}

      <div className="intel-image-row">

        <div className="intel-image-card dark">

          <div className="intel-image-card__header">

            <div>

              <strong>NDVI</strong>

              {currentObs?.date && <span className="intel-image-card__date">, {fmtShort(currentObs.date)}</span>}

            </div>

            <div className="intel-image-card__nav">

              <button onClick={() => setImgHistoryIdx(i => Math.max(0, i - 1))} disabled={imgHistoryIdx === 0}>←</button>

              <button onClick={() => setImgHistoryIdx(i => Math.min(obsWithData.length - 1, i + 1))} disabled={imgHistoryIdx >= obsWithData.length - 1}>→</button>

              <button className="expand-btn" title="Expand">⤢</button>

            </div>

          </div>

          <FieldMiniMap geometry={farm.boundary_geojson} ndvi={currentObs?.ndvi} variant="ndvi" />

          {tileSource && (

            <div className="intel-image-card__banner">

              New NDVI image available <ArrowUpRight size={13} />

            </div>

          )}

        </div>



        <div className="intel-image-card dark">

          <div className="intel-image-card__header">

            <div>

              <strong><span role="img" aria-label="satellite">🛰️</span> Satellite image</strong>

              {currentObs?.date && <span className="intel-image-card__date">, {fmtShort(currentObs.date)}</span>}

            </div>

            <button className="expand-btn" title="Expand">⤢</button>

          </div>

          <FieldMiniMap geometry={farm.boundary_geojson} ndvi={currentObs?.ndvi} variant="satellite" />



        </div>

      </div>



      {/* NDVI timeline chart */}

      <div className="intel-timeline">

        <div className="intel-timeline__header">

          <span style={{ fontWeight: 600, fontSize: 13 }}>NDVI</span>

          <div style={{ display: 'flex', gap: 6 }}>

            <button className="intel-date-btn">📅 Custom period ⌄</button>

            <button className="intel-date-btn">📅 {new Date().getFullYear() - 1} Jan 1 – {fmtShort(new Date().toISOString())} ⌄</button>

          </div>

        </div>

        <TimelineChart data={history} />

      </div>



      {/* Precipitation */}

      <PrecipitationChart weather={weather} />



      {/* Metrics grid */}

      <MetricGrid latest={history[history.length - 1] || null} />



      {/* Insights */}

      <div className="intel-insights">

        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Insights & alerts</div>

        {insights.length ? insights.map(item => (

          <div key={item.title} className={`intel-insight intel-insight--${item.tone}`}>

            <div className="intel-insight__row">

              <span className="intel-insight__title">{item.title}</span>

              <span className="intel-insight__badge">{item.badge}</span>

            </div>

            <p className="intel-insight__msg">{item.message}</p>

          </div>

        )) : (

          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No active alerts.</div>

        )}

      </div>

      {/* Productivity zones summary */}
      {(() => {
        const zones = productivityZones?.zones || (Array.isArray(productivityZones) ? productivityZones : [])
        if (!zones.length) return null
        return (
          <div className="intel-zones-summary">
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Productivity zones</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {zones.map((z, i) => {
                const cls = z.zone_class || 'unknown'
                const color = z.color_hex || (cls === 'high' ? '#4CAF50' : cls === 'medium' ? '#FFC107' : '#F44336')
                return (
                  <div key={i} style={{
                    flex: '1 1 0', minWidth: 80, background: '#111318', border: `1px solid ${color}40`,
                    borderRadius: 8, padding: '8px 10px', borderLeft: `3px solid ${color}`,
                  }}>
                    <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: 'uppercase' }}>{cls}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{z.mean_ndvi != null ? z.mean_ndvi.toFixed(3) : '—'}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{z.area_ha != null ? `${z.area_ha.toFixed(1)} ha` : ''}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

    </div>

  )

}



function DataTab({ latest, history }) {

  const metrics = [

    { label: 'NDVI', key: 'ndvi' },

    { label: 'NDRE', key: 'ndre' },

    { label: 'EVI', key: 'evi' },

    { label: 'SAVI', key: 'savi' },

    { label: 'Cloud %', key: 'cloud_cover' },

    { label: 'Health score', key: 'health_score' },

  ]

  return (

    <div style={{ padding: '12px 0' }}>

      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Latest metrics</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

        {metrics.map(m => (

          <div key={m.key} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>

            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>{m.label}</div>

            <div style={{ fontSize: 20, fontWeight: 700 }}>

              {latest?.[m.key] != null ? Number(latest[m.key]).toFixed(3) : '—'}

            </div>

          </div>

        ))}

      </div>

      <div style={{ fontWeight: 600, fontSize: 13, margin: '16px 0 8px' }}>All observations ({history.length})</div>

      <div style={{ maxHeight: 240, overflowY: 'auto', fontSize: 12 }}>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>

          <thead>

            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>

              {['Date','NDVI','NDRE','EVI','Cloud%'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600 }}>{h}</th>)}

            </tr>

          </thead>

          <tbody>

            {[...history].reverse().map((row, i) => (

              <tr key={i} style={{ borderBottom: '1px solid var(--border-light, #f1f5f9)' }}>

                <td style={{ padding: '5px 8px' }}>{fmtShort(row.date)}</td>

                <td style={{ padding: '5px 8px', color: ndviColor(row.ndvi), fontWeight: 600 }}>{row.ndvi != null ? row.ndvi.toFixed(3) : '—'}</td>

                <td style={{ padding: '5px 8px' }}>{row.ndre != null ? row.ndre.toFixed(3) : '—'}</td>

                <td style={{ padding: '5px 8px' }}>{row.evi != null ? row.evi.toFixed(3) : '—'}</td>

                <td style={{ padding: '5px 8px' }}>{row.cloud_cover != null ? `${row.cloud_cover.toFixed(0)}%` : '—'}</td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

    </div>

  )

}



function buildInsights({ farm, latest, weather }) {

  const items = []

  const ndvi = latest?.ndvi

  if (ndvi == null) {

    items.push({ title: 'Satellite scan pending', badge: 'Awaiting imagery', tone: 'info', message: 'Run a scan to unlock vegetation layers and timeline analytics.' })

  } else if (ndvi < 0.2) {

    items.push({ title: 'Vegetation stress detected', badge: `NDVI ${ndvi.toFixed(3)}`, tone: 'critical', message: 'Very low vigor. Check for irrigation issues, pests/disease, or crop failure zones and consider scouting immediately.' })

  } else if (ndvi < 0.35) {

    items.push({ title: 'Moderate stress signal', badge: `NDVI ${ndvi.toFixed(3)}`, tone: 'warning', message: 'Monitor variability inside the field and prioritize scouting where the heatmap shows weaker patches.' })

  } else {

    items.push({ title: 'Vegetation looks stable', badge: `NDVI ${ndvi.toFixed(3)}`, tone: 'info', message: 'Continue tracking trends and compare against rainfall/temperature for early changes.' })

  }

  const weatherTemp = weather?.current?.temperature_2m ?? weather?.current?.temperature

  if (weatherTemp != null && weatherTemp >= 33) {

    items.push({ title: 'Heat risk', badge: `${Math.round(weatherTemp)}°C`, tone: 'warning', message: 'High temperatures can reduce growth. Consider heat stress mitigation where applicable.' })

  }

  if (farm?.crop_type) {

    items.push({ title: 'Crop context', badge: farm.crop_type, tone: 'info', message: 'Use the index selector (NDVI/NDRE/EVI/SAVI) to triangulate vigor vs nutrient/soil signals.' })

  }

  return items

}



function MetricGrid({ latest }) {

  const items = [

    { label: 'NDVI', value: latest?.ndvi },

    { label: 'NDRE', value: latest?.ndre },

    { label: 'EVI', value: latest?.evi },

    { label: 'SAVI', value: latest?.savi },

    { label: 'Cloud %', value: latest?.cloud_cover },

    { label: 'Health', value: latest?.health_score },

  ]

  return (

    <div className="intel-metric-grid">

      {items.map(item => (

        <div key={item.label} className="intel-metric-cell">

          <div className="intel-metric-cell__label">{item.label}</div>

          <div className="intel-metric-cell__value">{item.value != null ? Number(item.value).toFixed(3) : '—'}</div>

        </div>

      ))}

    </div>

  )

}



function TimelineChart({ data }) {

  if (!data || !data.length) {

    return <div style={{ padding: '16px 0', color: 'var(--text-secondary)', fontSize: 12 }}>No vegetation observations yet.</div>

  }

  const mapped = data.map(d => ({ ...d, label: fmtShort(d.date) }))

  return (

    <div style={{ width: '100%', height: 200 }}>

      <ResponsiveContainer width="100%" height="100%">

        <LineChart data={mapped} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>

          <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" />

          <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />

          <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />

          <Tooltip content={({ active, payload }) => {

            if (!active || !payload?.length) return null

            return (

              <div style={{ background: '#1e2128', border: '1px solid #2a2d35', borderRadius: 8, padding: '6px 10px', fontSize: 11, color: '#f1f5f9' }}>

                <div style={{ fontWeight: 700, marginBottom: 4, color: '#f1f5f9' }}>{payload[0]?.payload?.label}</div>

                {payload.map(p => <div key={p.dataKey} style={{ color: p.color }}>{p.name}: {p.value != null ? Number(p.value).toFixed(3) : '—'}</div>)}

              </div>

            )

          }} />

          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4, color: '#94a3b8' }} />

          <Line type="monotone" dataKey="ndvi" name="NDVI" stroke="#86efac" strokeWidth={2} dot={false} connectNulls />

          <Line type="monotone" dataKey="ndre" name="NDRE" stroke="#60a5fa" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="5 3" />

          <Line type="monotone" dataKey="evi" name="EVI" stroke="#fbbf24" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2" />

          <Line type="monotone" dataKey="savi" name="SAVI" stroke="#f472b6" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="3 2" />

        </LineChart>

      </ResponsiveContainer>

    </div>

  )

}



function PrecipitationChart({ weather }) {

  const days = weather?.daily

  if (!days) return null

  const dates = days.time || days.dates || []

  const rain = days.precipitation_sum || days.precipitation || []

  if (!rain.length) return null

  const data = rain.map((r, i) => ({ date: fmtShort(dates[i]), rain: Number(r || 0) }))

  const total = rain.reduce((s, v) => s + Number(v || 0), 0)

  return (

    <div className="intel-precipitation">

      <div className="intel-precipitation__header">

        <span style={{ fontWeight: 600, fontSize: 13 }}>Accumulated precipitation</span>

        <span className="intel-precipitation__total">☁ {total.toFixed(0)} mm</span>

      </div>

      <div style={{ width: '100%', height: 90 }}>

        <ResponsiveContainer width="100%" height="100%">

          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>

            <defs>

              <linearGradient id="rainGrad" x1="0" y1="0" x2="0" y2="1">

                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />

                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.02} />

              </linearGradient>

            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" />

            <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />

            <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />

            <Tooltip formatter={(v) => [`${v} mm`, 'Rain']} contentStyle={{ background: '#1e2128', border: '1px solid #2a2d35', borderRadius: 8, fontSize: 11, color: '#f1f5f9' }} />

            <Area type="monotone" dataKey="rain" stroke="#0ea5e9" fill="url(#rainGrad)" strokeWidth={1.5} />

          </AreaChart>

        </ResponsiveContainer>

      </div>

    </div>

  )

}



function FieldMiniMap({ geometry, ndvi, variant = 'ndvi' }) {

  const mapNode = useRef(null)

  const mapRef = useRef(null)

  const color = variant === 'ndvi' ? ndviColor(ndvi) : '#0ea5e955'

  const lineColor = '#ffffff'

  const fillOpacity = 0.3



  useEffect(() => {

    if (!geometry) return

    const token = import.meta.env.VITE_MAPBOX_TOKEN || ''

    if (!token) return

    mapboxgl.accessToken = token

    const map = new mapboxgl.Map({

      container: mapNode.current,

      style: 'mapbox://styles/mapbox/satellite-streets-v12',

      interactive: false,

    })

    mapRef.current = map

    map.on('load', () => {

      map.addSource('mini-field', { type: 'geojson', data: { type: 'Feature', geometry } })

      map.addLayer({ id: 'mini-fill', type: 'fill', source: 'mini-field', paint: { 'fill-color': color, 'fill-opacity': fillOpacity } })

      map.addLayer({ id: 'mini-line', type: 'line', source: 'mini-field', paint: { 'line-color': lineColor, 'line-width': 2 } })

      try {

        const coords = geometry.coordinates?.[0]?.map(([lon, lat]) => [lon, lat])

        if (coords?.length) {

          const lons = coords.map(c => c[0]); const lats = coords.map(c => c[1])

          map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 20 })

        }

      } catch {}

    })

    return () => map.remove()

  }, [geometry, color, lineColor, fillOpacity])



  return <div ref={mapNode} className="field-mini-map" style={{ width: '100%', minHeight: 160, borderRadius: 8, overflow: 'hidden' }} />
}

// ─── Report Tab ───────────────────────────────────────────────────────────────

function ReportTab({ farm, latest, history, weather, insights }) {
  const weatherTemp = weather?.current?.temperature_2m ?? weather?.daily?.temperature_2m_max?.[0] ?? null
  const weatherRain = weather?.daily?.precipitation_sum?.[0] ?? 0

  const downloadReport = () => {
    const report = {
      generated: new Date().toISOString(),
      field: {
        name: farm.name,
        area_ha: Number(farm.area || farm.size_hectares || 0).toFixed(2),
        crop: farm.crop_type || 'Unknown',
        planting_date: farm.planting_date || null,
        location: farm.province || farm.location || null,
        coordinates: farm.latitude ? `${farm.latitude.toFixed(5)}, ${farm.longitude.toFixed(5)}` : null,
      },
      vegetation: {
        ndvi: latest?.ndvi ?? null,
        ndre: latest?.ndre ?? null,
        evi: latest?.evi ?? null,
        savi: latest?.savi ?? null,
        health_score: latest?.health_score ?? null,
        last_scan: latest?.date ?? null,
        total_observations: history.length,
      },
      weather: weatherTemp != null ? { temperature_c: Math.round(weatherTemp), precipitation_mm: Number(weatherRain).toFixed(1) } : null,
      alerts: insights.map(i => ({ title: i.title, level: i.tone, message: i.message })),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${farm.name.replace(/\s+/g, '_')}_report_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const rows = [
    { label: 'Field name', value: farm.name },
    { label: 'Area', value: `${Number(farm.area || farm.size_hectares || 0).toFixed(2)} ha` },
    { label: 'Crop', value: farm.crop_type || '—' },
    { label: 'Planting date', value: farm.planting_date ? fmt(farm.planting_date) : '—' },
    { label: 'Province', value: farm.province || farm.location || '—' },
    { label: 'Last NDVI scan', value: latest?.date ? fmt(latest.date) : '—' },
    { label: 'NDVI', value: latest?.ndvi != null ? latest.ndvi.toFixed(3) : '—' },
    { label: 'NDRE', value: latest?.ndre != null ? latest.ndre.toFixed(3) : '—' },
    { label: 'EVI', value: latest?.evi != null ? latest.evi.toFixed(3) : '—' },
    { label: 'Temperature', value: weatherTemp != null ? `${Math.round(weatherTemp)} °C` : '—' },
    { label: 'Precipitation', value: `${Number(weatherRain).toFixed(1)} mm` },
    { label: 'Observations', value: history.length },
  ]

  return (
    <div className="fp-report-tab">
      <div className="fp-report-tab__header">
        <FileText size={15} />
        <span>Field Report</span>
        <button className="fp-report-tab__download" onClick={downloadReport} aria-label="Download report">
          <Download size={13} /> Download JSON
        </button>
      </div>
      <table className="fp-report-table">
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td className="fp-report-table__key">{r.label}</td>
              <td className="fp-report-table__val">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="fp-report-alerts">
        <div className="fp-report-alerts__title">Alerts &amp; insights</div>
        {insights.map(i => (
          <div key={i.title} className={`intel-insight intel-insight--${i.tone}`} style={{ marginBottom: 6 }}>
            <div className="intel-insight__row">
              <span className="intel-insight__title">{i.title}</span>
              <span className="intel-insight__badge">{i.badge}</span>
            </div>
            <p className="intel-insight__msg">{i.message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Yield Tab ────────────────────────────────────────────────────────────────

function YieldTab({ farmId }) {
  const [maps, setMaps] = useState([])
  const [estimate, setEstimate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.allSettled([
      getYieldMapsForFarm(farmId),
      getYieldEstimate(farmId),
    ]).then(([mapsRes, estRes]) => {
      if (mapsRes.status === 'fulfilled') setMaps(mapsRes.value.data?.yield_maps || mapsRes.value.data || [])
      if (estRes.status === 'fulfilled') setEstimate(estRes.value.data)
      if (mapsRes.status === 'rejected' && estRes.status === 'rejected') setError('Could not load yield data')
      setLoading(false)
    })
  }, [farmId])

  if (loading) return <div className="fp-tab-state">Loading yield data…</div>
  if (error && !estimate && !maps.length) return <div className="fp-tab-state fp-tab-state--error">{error}</div>

  return (
    <div className="fp-yield-tab">
      {/* NDVI-based estimation */}
      {estimate && (
        <div className="fp-yield-card" style={{ borderLeft: '3px solid #22c55e' }}>
          <div className="fp-yield-card__title">
            Estimated yield — {estimate.crop_type || 'Unknown crop'}
            <span style={{ float: 'right', fontSize: 10, color: '#64748b', fontWeight: 400 }}>
              {estimate.confidence === 'moderate' ? '⬤ Moderate' : '○ Low'} confidence
            </span>
          </div>
          <div className="fp-yield-card__stats">
            {[
              { label: 'Yield', value: estimate.estimated_yield_tha != null ? `${estimate.estimated_yield_tha} t/ha` : '—' },
              { label: 'Total', value: estimate.estimated_total_kg != null ? `${(estimate.estimated_total_kg / 1000).toFixed(1)} t` : '—' },
              { label: 'NDVI', value: estimate.ndvi_mean != null ? estimate.ndvi_mean.toFixed(3) : '—' },
              { label: 'Area', value: estimate.area_ha != null ? `${estimate.area_ha} ha` : '—' },
            ].map(s => (
              <div key={s.label} className="fp-yield-stat">
                <span className="fp-yield-stat__label">{s.label}</span>
                <span className="fp-yield-stat__value">{s.value}</span>
              </div>
            ))}
          </div>
          {/* Zone-level breakdown */}
          {estimate.zone_estimates?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>By productivity zone</div>
              {estimate.zone_estimates.map(z => (
                <div key={z.zone_class} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid #1e2128' }}>
                  <span style={{ color: z.zone_class === 'high' ? '#4CAF50' : z.zone_class === 'medium' ? '#FFC107' : '#F44336' }}>
                    {z.zone_class.charAt(0).toUpperCase() + z.zone_class.slice(1)}
                  </span>
                  <span style={{ color: '#f1f5f9' }}>{z.estimated_yield_tha} t/ha</span>
                  <span style={{ color: '#64748b' }}>{z.area_ha} ha</span>
                </div>
              ))}
            </div>
          )}
          {estimate.ndvi_date && (
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>Based on NDVI from {fmt(estimate.ndvi_date)}</div>
          )}
        </div>
      )}

      {/* Uploaded yield maps */}
      {maps.map(m => (
        <div key={m.id} className="fp-yield-card">
          <div className="fp-yield-card__title">{m.crop_type || 'Yield map'} — {m.harvest_date ? fmt(m.harvest_date) : '—'}</div>
          {m.statistics && (
            <div className="fp-yield-card__stats">
              {[
                { label: 'Mean', value: m.statistics.mean_yield_tha != null ? `${m.statistics.mean_yield_tha.toFixed(2)} t/ha` : '—' },
                { label: 'Peak', value: m.statistics.max_yield_tha != null ? `${m.statistics.max_yield_tha.toFixed(2)} t/ha` : '—' },
                { label: 'CV%', value: m.statistics.cv_pct != null ? `${m.statistics.cv_pct.toFixed(1)}%` : '—' },
                { label: 'Area', value: m.statistics.area_surveyed_ha != null ? `${m.statistics.area_surveyed_ha.toFixed(2)} ha` : '—' },
              ].map(s => (
                <div key={s.label} className="fp-yield-stat">
                  <span className="fp-yield-stat__label">{s.label}</span>
                  <span className="fp-yield-stat__value">{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {!estimate && !maps.length && (
        <div className="fp-tab-state">
          <BarChart2 size={32} color="#3a3d45" />
          <p>No yield data available. Run a satellite scan to get NDVI-based estimates.</p>
        </div>
      )}
    </div>
  )
}

// ─── Prescription Maps Tab (OneSoil-style listing) ────────────────────────────

const PRESC_TYPE_LABELS = { fertilizer: 'Fertilizer', seeding: 'Planting', chemical: 'Crop protection' }
const PRESC_TYPE_ICONS = { fertilizer: '🧪', seeding: '🌱', chemical: '🛡' }

function PrescriptionMapsTab({ farmId, farmName, farm, productivityZones, onViewVra, onCreateNew }) {
  const [maps, setMaps] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getVraMapsForFarm(farmId).then(res => {
      if (!cancelled) setMaps(res.data?.vra_maps || [])
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [farmId])

  if (loading) {
    return (
      <div className="fp-tab-state">
        <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
        <p>Loading prescription maps…</p>
      </div>
    )
  }

  return (
    <div className="fp-presc-tab">
      {/* Header with create button */}
      <div className="fp-presc-tab__header">
        <span>VRA Maps</span>
        <button className="fp-presc-tab__create-btn" onClick={onCreateNew}>
          + Create VRA map
        </button>
      </div>

      {/* Existing maps */}
      {maps.length === 0 ? (
        <div className="fp-presc-tab__empty">
          <Map size={32} color="#9ca3af" />
          <p>No VRA maps yet</p>
          <p style={{ fontSize: 11, color: '#9ca3af' }}>Create your first variable rate prescription map</p>
          <button className="fp-presc-tab__create-btn fp-presc-tab__create-btn--large" onClick={onCreateNew}>
            + Create VRA map
          </button>
        </div>
      ) : (
        <div className="fp-presc-tab__list">
          {maps.map(m => {
            const typeLabel = PRESC_TYPE_LABELS[m.prescription_type] || m.prescription_type
            const typeIcon = PRESC_TYPE_ICONS[m.prescription_type] || '📋'
            const zones = m.rates_json ? Object.entries(m.rates_json) : []
            return (
              <div key={m.id} className="fp-presc-tab__card" onClick={() => onViewVra(m, m.prescription_type)}>
                <div className="fp-presc-tab__card-top">
                  <span className="fp-presc-tab__card-icon">{typeIcon}</span>
                  <div className="fp-presc-tab__card-info">
                    <div className="fp-presc-tab__card-type">{typeLabel}</div>
                    <div className="fp-presc-tab__card-meta">
                      {m.product_name || 'Product'} · {m.base_rate} {m.prescription_type === 'chemical' ? 'L/ha' : 'kg/ha'}
                    </div>
                  </div>
                  <div className="fp-presc-tab__card-date">
                    {m.generated_at ? new Date(m.generated_at).toLocaleDateString() : ''}
                  </div>
                </div>
                {/* Zone summary */}
                <div className="fp-presc-tab__card-zones">
                  {zones.map(([cls, info]) => (
                    <div key={cls} className="fp-presc-tab__zone-chip" style={{
                      borderLeft: `3px solid ${cls === 'high' ? '#7c3aed' : cls === 'medium' ? '#a855f7' : '#e9d5ff'}`,
                    }}>
                      <span className="fp-presc-tab__zone-cls">{cls.charAt(0).toUpperCase() + cls.slice(1)}</span>
                      <span className="fp-presc-tab__zone-rate">{info?.rate?.toFixed(0) ?? '—'}</span>
                      <span className="fp-presc-tab__zone-area">{info?.area_ha?.toFixed(2) ?? '—'} ha</span>
                    </div>
                  ))}
                </div>
                {m.savings_pct != null && m.savings_pct > 0 && (
                  <div className="fp-presc-tab__savings">💰 {m.savings_pct}% savings vs flat-rate</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Without VRA maps section — fields not analyzed */}
      {maps.length > 0 && (
        <div className="fp-presc-tab__section-label">
          {maps.length} VRA map{maps.length !== 1 ? 's' : ''} generated
        </div>
      )}
    </div>
  )
}

// ─── Prescription Modal (Legacy — kept for reference) ─────────────────────────

const PRESC_TYPES = [
  { key: 'fertilizer', label: 'Fertilizer', unit: 'kg/ha' },
  { key: 'seeding',    label: 'Seeding',    unit: 'kg/ha' },
  { key: 'chemical',  label: 'Chemical',   unit: 'L/ha' },
]
const ZONE_COLORS_VRA = { high: '#1a56db', medium: '#d97706', low: '#dc2626' }

function PrescriptionModal({ farmId, farmName, onClose, productivityZones, onZonesComputed }) {
  const [prescType, setPrescType] = useState('fertilizer')
  const [baseRate, setBaseRate] = useState(100)
  const [product, setProduct] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [stage, setStage] = useState('')

  const generate = async () => {
    setLoading(true); setError(null); setResult(null)
    try {
      // Ensure productivity zones exist before VRA generation
      const zones = productivityZones?.zones || productivityZones
      if (!zones || !zones.length) {
        setStage('Computing productivity zones...')
        try {
          await computeGeoZones(farmId, 3, 90)
          const zRes = await getGeoZones(farmId)
          onZonesComputed?.(zRes.data)
        } catch (zErr) {
          console.warn('Auto zone computation:', zErr.response?.data?.detail || zErr.message)
        }
      }
      setStage('Generating prescription map...')
      const res = await computeVraMap(farmId, { prescription_type: prescType, base_rate: Number(baseRate), product_name: product || undefined })
      setResult(res.data)
      setStage('')
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to generate prescription map')
      setStage('')
    } finally { setLoading(false) }
  }

  const doExport = async (type) => {
    if (!result?.id) return
    setExporting(true)
    try {
      const res = type === 'geojson' ? await exportVraGeoJson(result.id) : await exportVraIsoxml(result.id)
      const mime = type === 'geojson' ? 'application/json' : 'application/xml'
      const ext  = type === 'geojson' ? 'geojson' : 'xml'
      const blob = new Blob([res.data], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${farmName}_prescription.${ext}`; a.click()
      URL.revokeObjectURL(url)
    } catch { setError('Export failed') } finally { setExporting(false) }
  }

  const unit = PRESC_TYPES.find(p => p.key === prescType)?.unit || 'kg/ha'
  // Extract zones from VRA result — backend returns rates_json with per-class info
  const zones = result
    ? Object.entries(result.rates_json || {}).map(([cls, info]) => ({
        zone: cls,
        adjusted_rate: info?.rate ?? result[`${cls}_zone_rate`],
        area_ha: info?.area_ha,
      }))
    : []

  return (
    <div className="fp-modal-overlay" role="dialog" aria-modal="true" aria-label="Prescription map">
      <div className="fp-modal">
        <div className="fp-modal__header">
          <Map size={16} color="#22c55e" />
          <span>Prescription map — {farmName}</span>
          <button className="fp-modal__close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="fp-modal__body">
          <div className="fp-modal__row">
            <label className="fp-modal__label">Prescription type</label>
            <div className="fp-modal__segmented">
              {PRESC_TYPES.map(p => (
                <button key={p.key} className={`fp-modal__seg-btn${prescType === p.key ? ' active' : ''}`} onClick={() => setPrescType(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-modal__row">
            <label className="fp-modal__label">Base rate — {baseRate} {unit}</label>
            <input type="range" min={10} max={500} step={5} value={baseRate}
              onChange={e => setBaseRate(e.target.value)} className="fp-modal__slider" />
            <div className="fp-modal__slider-labels"><span>10</span><span>500 {unit}</span></div>
          </div>
          <div className="fp-modal__row">
            <label className="fp-modal__label">Product (optional)</label>
            <input type="text" value={product} onChange={e => setProduct(e.target.value)}
              className="fp-modal__input" placeholder="e.g. DAP, Urea, NPK 17-17-17" />
          </div>
          {error && <div className="fp-modal__error">{error}</div>}
          <button className="fp-modal__primary-btn" onClick={generate} disabled={loading}>
            <Zap size={14} /> {loading ? (stage || 'Generating…') : 'Generate prescription map'}
          </button>
          {result && (
            <div className="fp-presc-result">
              <div className="fp-presc-result__title">
                <CheckCircle2 size={14} color="#22c55e" /> Prescription ready
                {result.savings_pct != null && result.savings_pct > 0 && (
                  <span style={{ fontSize: 11, color: '#22c55e', marginLeft: 8 }}>
                    {result.savings_pct}% savings
                  </span>
                )}
              </div>
              {result.total_product_kg != null && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Total product: {result.total_product_kg.toFixed(1)} {prescType === 'chemical' ? 'L' : 'kg'}
                </div>
              )}
              <div className="fp-presc-zones">
                {zones.map(z => (
                  <div key={z.zone} className="fp-presc-zone" style={{ borderLeft: `3px solid ${ZONE_COLORS_VRA[z.zone] || '#555'}` }}>
                    <span className="fp-presc-zone__name" style={{ color: ZONE_COLORS_VRA[z.zone] }}>
                      {z.zone?.charAt(0).toUpperCase()}{z.zone?.slice(1)} productivity
                    </span>
                    <span className="fp-presc-zone__rate">{(z.adjusted_rate ?? z.rate)?.toFixed(0) ?? '—'} {unit}</span>
                    <span className="fp-presc-zone__area">{z.area_ha?.toFixed(2) ?? '—'} ha</span>
                  </div>
                ))}
              </div>
              <div className="fp-presc-result__actions">
                <button className="fp-modal__export-btn" onClick={() => doExport('geojson')} disabled={exporting}>
                  <Download size={13} /> GeoJSON
                </button>
                <button className="fp-modal__export-btn" onClick={() => doExport('isoxml')} disabled={exporting}>
                  <Download size={13} /> ISOXML
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Soil Sampling Modal ──────────────────────────────────────────────────────

function SoilSamplingModal({ farmId, farmName, onClose }) {
  const [method, setMethod] = useState('grid')
  const [gridSize, setGridSize] = useState(50)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const generate = async () => {
    setLoading(true); setError(null); setResult(null)
    try {
      const res = method === 'grid'
        ? await generateGridSampling(farmId, Number(gridSize), notes || undefined)
        : await generateZoneSampling(farmId, notes || undefined)
      setResult(res.data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to generate sampling plan')
    } finally { setLoading(false) }
  }

  const downloadCsv = () => {
    if (!result) return
    const samples = result.sample_points || result.samples || []
    if (!samples.length) { alert('No sample points in response'); return }
    const header = 'id,latitude,longitude,zone,notes\n'
    const rows = samples.map((s, i) =>
      `${s.id || i + 1},${s.latitude ?? s.lat ?? ''},${s.longitude ?? s.lon ?? ''},${s.zone || ''},${s.notes || ''}`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `${farmName.replace(/\s+/g, '_')}_soil_sampling.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const sampleCount = result?.sample_points?.length ?? result?.samples?.length ?? result?.points_count ?? null

  return (
    <div className="fp-modal-overlay" role="dialog" aria-modal="true" aria-label="Soil sampling">
      <div className="fp-modal">
        <div className="fp-modal__header">
          <FlaskConical size={16} color="#22c55e" />
          <span>Soil sampling — {farmName}</span>
          <button className="fp-modal__close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="fp-modal__body">
          <div className="fp-modal__row">
            <label className="fp-modal__label">Sampling method</label>
            <div className="fp-modal__segmented">
              <button className={`fp-modal__seg-btn${method === 'grid' ? ' active' : ''}`} onClick={() => setMethod('grid')}>Grid</button>
              <button className={`fp-modal__seg-btn${method === 'zone' ? ' active' : ''}`} onClick={() => setMethod('zone')}>By zone</button>
            </div>
          </div>
          {method === 'grid' && (
            <div className="fp-modal__row">
              <label className="fp-modal__label">Grid spacing — {gridSize} m</label>
              <input type="range" min={10} max={200} step={5} value={gridSize}
                onChange={e => setGridSize(e.target.value)} className="fp-modal__slider" />
              <div className="fp-modal__slider-labels"><span>10 m</span><span>200 m</span></div>
            </div>
          )}
          <div className="fp-modal__row">
            <label className="fp-modal__label">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              className="fp-modal__input" rows={2} placeholder="Sampling instructions, lab contact…" style={{ resize: 'vertical' }} />
          </div>
          {error && <div className="fp-modal__error">{error}</div>}
          <button className="fp-modal__primary-btn" onClick={generate} disabled={loading}>
            <FlaskConical size={14} /> {loading ? 'Generating…' : 'Generate sampling plan'}
          </button>
          {result && (
            <div className="fp-presc-result">
              <div className="fp-presc-result__title">
                <CheckCircle2 size={14} color="#22c55e" />
                {sampleCount != null ? `${sampleCount} sample points generated` : 'Sampling plan ready'}
              </div>
              {result.notes && <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '6px 0 0' }}>{result.notes}</p>}
              <div className="fp-presc-result__actions">
                <button className="fp-modal__export-btn" onClick={downloadCsv}>
                  <Download size={13} /> Download CSV
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


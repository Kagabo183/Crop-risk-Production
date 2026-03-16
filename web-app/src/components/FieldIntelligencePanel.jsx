import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts'
import { Leaf, Cloud, CalendarClock, Thermometer, Droplets } from 'lucide-react'

const ndviColor = (v) => {
  if (v == null) return '#94a3b8'
  if (v < 0.2) return '#d92d20'
  if (v < 0.3) return '#f97316'
  if (v < 0.4) return '#fbbf24'
  if (v < 0.5) return '#a3e635'
  return '#166534'
}

const formatDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()} ${d.toLocaleString('default', { month: 'short' })}`
}

export default function FieldIntelligencePanel({ farm, history = [], weather = null }) {
  const latest = history?.[history.length - 1] || null
  const color = ndviColor(latest?.ndvi)
  const insights = buildInsights({ farm, latest, weather })

  return (
    <div className="card" style={{ minHeight: 360 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 10, height: 32, borderRadius: 6, background: color }} />
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Field Intelligence</div>
            <h3 style={{ margin: 0 }}>{farm?.name || 'Select a field'}</h3>
          </div>
        </div>
        {farm?.area && (
          <div className="badge info" style={{ fontSize: 12 }}>{farm.area} ha</div>
        )}
      </div>

      {!farm ? (
        <div style={{ padding: 16, color: 'var(--text-secondary)' }}>Click a field polygon to view intelligence.</div>
      ) : (
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <InfoRow icon={<Leaf size={14} />} label="Crop" value={farm.crop_type || farm.detected_crop || '—'} />
            <InfoRow icon={<CalendarClock size={14} />} label="Planting Date" value={farm.planting_date ? formatDate(farm.planting_date) : '—'} />
            <InfoRow icon={<CalendarClock size={14} />} label="Season" value={farm.season || '—'} />
            <InfoRow icon={<Cloud size={14} />} label="Last Observation" value={latest?.date ? formatDate(latest.date) : '—'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1.05fr 0.9fr', gap: 12, alignItems: 'stretch' }}>
            <div style={{ background: '#0f172a', color: '#e2e8f0', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Leaf size={16} />
                  <span style={{ fontWeight: 600 }}>NDVI Heat</span>
                </div>
                <span style={{ fontWeight: 700 }}>{latest?.ndvi != null ? latest.ndvi.toFixed(3) : '—'}</span>
              </div>
              <FieldMiniMap geometry={farm.boundary_geojson} ndvi={latest?.ndvi} variant="ndvi" />
              <div style={{ fontSize: 11, opacity: 0.85, marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <LegendSwatch color="#d92d20" label="<0.2" />
                <LegendSwatch color="#f97316" label="0.2-0.3" />
                <LegendSwatch color="#fbbf24" label="0.3-0.4" />
                <LegendSwatch color="#a3e635" label="0.4-0.6" />
                <LegendSwatch color="#166534" label=">0.6" />
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span role="img" aria-label="satellite">🛰️</span> Satellite image
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{latest?.date ? formatDate(latest.date) : 'Awaiting capture'}</span>
              </div>
              <FieldMiniMap geometry={farm.boundary_geojson} ndvi={latest?.ndvi} variant="satellite" />
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
                Latest capture uses Mapbox satellite as base. NDVI overlay appears when available.
              </div>
            </div>

            <WeatherCard weather={weather} />
          </div>

          <MetricGrid latest={latest} />

          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Vegetation Timeline</div>
            <TimelineChart data={history} />
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Insights & alerts</div>
            {insights.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {insights.map((item) => (
                  <div
                    key={item.title}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: item.tone === 'critical'
                        ? '#fff1f2'
                        : item.tone === 'warning'
                          ? '#fff7ed'
                          : '#f8fafc',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.badge}</div>
                    </div>
                    <div style={{ fontSize: 12, color: '#334155', marginTop: 4 }}>{item.message}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 10, color: 'var(--text-secondary)', fontSize: 12 }}>No active alerts.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function buildInsights({ farm, latest, weather }) {
  const items = []

  const ndvi = latest?.ndvi
  if (ndvi == null) {
    items.push({
      title: 'Satellite scan pending',
      badge: 'Awaiting imagery',
      tone: 'info',
      message: 'Run a scan to unlock vegetation layers and timeline analytics.',
    })
  } else if (ndvi < 0.2) {
    items.push({
      title: 'Vegetation stress detected',
      badge: `NDVI ${ndvi.toFixed(3)}`,
      tone: 'critical',
      message: 'Very low vigor. Check for irrigation issues, pests/disease, or crop failure zones and consider scouting immediately.',
    })
  } else if (ndvi < 0.35) {
    items.push({
      title: 'Moderate stress signal',
      badge: `NDVI ${ndvi.toFixed(3)}`,
      tone: 'warning',
      message: 'Monitor variability inside the field and prioritize scouting where the heatmap shows weaker patches.',
    })
  } else {
    items.push({
      title: 'Vegetation looks stable',
      badge: `NDVI ${ndvi.toFixed(3)}`,
      tone: 'info',
      message: 'Continue tracking trends and compare against rainfall/temperature for early changes.',
    })
  }

  const today = weather?.daily?.[0]
  const current = weather?.current
  if (current && typeof current.temperature === 'number') {
    if (current.temperature >= 33) {
      items.push({
        title: 'Heat risk',
        badge: `${Math.round(current.temperature)}°C`,
        tone: 'warning',
        message: 'High temperatures can reduce growth. Consider heat stress mitigation (timely irrigation, mulching) where applicable.',
      })
    }
  }
  if (today && typeof today.precipitation === 'number') {
    if (today.precipitation <= 1) {
      items.push({
        title: 'Low rainfall today',
        badge: `${today.precipitation} mm`,
        tone: 'warning',
        message: 'If the field is rain-fed, watch for moisture stress and verify soil conditions during scouting.',
      })
    }
  }

  if (farm?.crop_type) {
    items.push({
      title: 'Crop context',
      badge: farm.crop_type,
      tone: 'info',
      message: 'Use the index selector (NDVI/NDRE/EVI/SAVI) to triangulate vigor vs nutrient/soil signals.',
    })
  }

  return items
}

function InfoRow({ icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
      {icon}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  )
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }}>
      {items.map((item) => (
        <div key={item.label} className="stat-card" style={{ padding: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.label}</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            {item.value != null ? Number(item.value).toFixed(3) : '—'}
          </div>
        </div>
      ))}
    </div>
  )
}

function WeatherCard({ weather }) {
  const today = weather?.daily?.[0] || null
  const current = weather?.current || null
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Cloud size={16} />
        <span style={{ fontWeight: 700 }}>Weather</span>
      </div>
      {current ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Thermometer size={14} /> {Math.round(current.temperature)}°C
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Droplets size={14} /> {current.humidity}% RH
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <CalendarClock size={14} /> {today ? today.summary || 'Today' : 'Today'}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Droplets size={14} /> {today?.precipitation || 0} mm
          </div>
        </div>
      ) : (
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>No weather data yet.</div>
      )}
    </div>
  )
}

function TimelineChart({ data }) {
  if (!data || !data.length) {
    return <div style={{ padding: 10, color: 'var(--text-secondary)', fontSize: 12 }}>No vegetation observations yet.</div>
  }
  const mapped = data.map((d) => ({
    ...d,
    label: formatDate(d.date),
  }))
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={mapped} margin={{ top: 6, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis domain={[-0.1, 1.1]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            return (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{payload[0]?.payload?.label}</div>
                {payload.map((p) => (
                  <div key={p.dataKey} style={{ color: p.color }}>{p.name}: {p.value != null ? p.value.toFixed(3) : '—'}</div>
                ))}
              </div>
            )
          }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="ndvi" name="NDVI" stroke="#2e7d32" strokeWidth={2} dot={false} connectNulls />
          <Line type="monotone" dataKey="ndre" name="NDRE" stroke="#0ea5e9" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="5 3" />
          <Line type="monotone" dataKey="evi" name="EVI" stroke="#fb8c00" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2" />
          <Line type="monotone" dataKey="savi" name="SAVI" stroke="#7c3aed" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="3 2" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function FieldMiniMap({ geometry, ndvi, variant = 'ndvi' }) {
  const mapNode = useRef(null)
  const mapRef = useRef(null)
  const color = variant === 'ndvi' ? ndviColor(ndvi) : '#0ea5e955'
  const lineColor = variant === 'ndvi' ? '#0ea5e9' : '#1f2937'
  const fillOpacity = variant === 'ndvi' ? 0.35 : 0.18

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
      map.addLayer({
        id: 'mini-fill', type: 'fill', source: 'mini-field', paint: { 'fill-color': color, 'fill-opacity': fillOpacity }
      })
      map.addLayer({ id: 'mini-line', type: 'line', source: 'mini-field', paint: { 'line-color': lineColor, 'line-width': 2 } })
      try {
        const coords = geometry.coordinates?.[0]?.map(([lon, lat]) => [lon, lat])
        if (coords?.length) {
          const lons = coords.map(c => c[0]); const lats = coords.map(c => c[1])
          const minLon = Math.min(...lons), maxLon = Math.max(...lons)
          const minLat = Math.min(...lats), maxLat = Math.max(...lats)
          map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 20 })
        }
      } catch {}
    })

    return () => map.remove()
  }, [geometry, color, lineColor, fillOpacity])

  return <div ref={mapNode} style={{ width: '100%', height: 160, borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0' }} />
}

function LegendSwatch({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ width: 12, height: 12, background: color, borderRadius: 4, border: '1px solid #cbd5e1' }} />
      {label}
    </span>
  )
}

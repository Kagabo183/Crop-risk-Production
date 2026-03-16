/**
 * VegetationTimeline
 * ------------------
 * Renders a multi-line chart of NDVI, NDRE, EVI, and NDWI over time
 * using data fetched from GET /api/v1/geo/farms/{farmId}/timeline.
 *
 * Props:
 *   farmId      – int   (required)
 *   daysBack    – int   (default 90)
 *   height      – int   (default 220, px)
 *   compact     – bool  (hides legend when true, for sidebar use)
 */
import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { getGeoTimeline } from '../api'

const INDEX_CONFIG = [
  { key: 'ndvi',  label: 'NDVI',  color: '#4CAF50', strokeWidth: 2 },
  { key: 'ndre',  label: 'NDRE',  color: '#2196F3', strokeWidth: 1.5, strokeDasharray: '4 2' },
  { key: 'evi',   label: 'EVI',   color: '#FF9800', strokeWidth: 1.5, strokeDasharray: '4 2' },
  { key: 'ndwi',  label: 'NDWI',  color: '#00BCD4', strokeWidth: 1.5, strokeDasharray: '2 3' },
]

const formatDate = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getDate()} ${dt.toLocaleString('default', { month: 'short' })}`
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-card, #fff)', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary, #1a202c)' }}>{formatDate(label)}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{p.value != null ? p.value.toFixed(3) : '—'}</strong>
        </div>
      ))}
    </div>
  )
}

export default function VegetationTimeline({ farmId, daysBack = 90, height = 220, compact = false, cropInfo = null }) {
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [visibleLines, setVisibleLines] = useState({ ndvi: true, ndre: true, evi: true, ndwi: false })

  useEffect(() => {
    if (!farmId) return
    setLoading(true)
    setError(null)
    getGeoTimeline(farmId, daysBack)
      .then(res => setSeries(res.data.series || []))
      .catch(() => setError('Failed to load timeline data'))
      .finally(() => setLoading(false))
  }, [farmId, daysBack])

  const toggleLine = (key) => setVisibleLines(prev => ({ ...prev, [key]: !prev[key] }))

  if (loading) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
        <div className="spinner" style={{ width: 20, height: 20, marginRight: 8 }} />
        Loading timeline…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)', fontSize: 13 }}>
        {error}
      </div>
    )
  }

  if (!series.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4, color: 'var(--text-secondary)', fontSize: 12 }}>
        <span>No vegetation data yet</span>
        <span style={{ opacity: 0.6 }}>Trigger a satellite fetch to populate this chart</span>
      </div>
    )
  }

  return (
    <div>
      {/* Crop info header band */}
      {cropInfo?.crop && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6, padding: '4px 8px', background: 'rgba(76,175,80,0.08)', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            &#127807; {cropInfo.crop.charAt(0).toUpperCase() + cropInfo.crop.slice(1)}
          </span>
          {cropInfo.growthStage && cropInfo.growthStage !== 'unknown' && (
            <span style={{ opacity: 0.75 }}>Stage: {cropInfo.growthStage.charAt(0).toUpperCase() + cropInfo.growthStage.slice(1)}</span>
          )}
        </div>
      )}
      {/* Legend / toggle buttons */}
      {!compact && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {INDEX_CONFIG.map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => toggleLine(key)}
              style={{
                padding: '2px 10px',
                borderRadius: 99,
                border: `1.5px solid ${color}`,
                background: visibleLines[key] ? color : 'transparent',
                color: visibleLines[key] ? '#fff' : color,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[-0.1, 1.0]}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickCount={5}
          />
          {/* Healthy zone band */}
          <ReferenceLine y={0.6} stroke="#4CAF50" strokeDasharray="4 4" strokeOpacity={0.4} />
          <ReferenceLine y={0.3} stroke="#FF9800" strokeDasharray="4 4" strokeOpacity={0.4} />
          <Tooltip content={<CustomTooltip />} />
          {!compact && <Legend wrapperStyle={{ fontSize: 11 }} />}

          {INDEX_CONFIG.map(({ key, label, color, strokeWidth, strokeDasharray }) =>
            visibleLines[key] ? (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
              />
            ) : null
          )}
        </LineChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10, color: 'var(--text-secondary)' }}>
        <span>— — Healthy threshold (NDVI ≥ 0.6)</span>
        <span>— — Stress threshold (NDVI ≤ 0.3)</span>
      </div>
    </div>
  )
}

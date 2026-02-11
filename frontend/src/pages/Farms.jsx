import { useState, useEffect } from 'react'
import { MapPin, Leaf, Droplets } from 'lucide-react'
import { getFarms, getFarmSatellite } from '../api'

export default function Farms() {
  const [farms, setFarms] = useState([])
  const [satellite, setSatellite] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.allSettled([getFarms(), getFarmSatellite()])
      .then(([fRes, sRes]) => {
        if (fRes.status === 'fulfilled') setFarms(fRes.value.data)
        if (sRes.status === 'fulfilled') setSatellite(sRes.value.data)
        setLoading(false)
      })
  }, [])

  if (loading) return <div className="loading"><div className="spinner" /><p>Loading farms...</p></div>
  if (error) return <div className="error-box">{error}</div>

  return (
    <>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><MapPin size={22} /></div>
          <div className="stat-info">
            <h4>Total Farms</h4>
            <div className="stat-value">{farms.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Leaf size={22} /></div>
          <div className="stat-info">
            <h4>Total Area</h4>
            <div className="stat-value">
              {farms.reduce((s, f) => s + (f.size_hectares || f.area || 0), 0).toFixed(1)} ha
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan"><Droplets size={22} /></div>
          <div className="stat-info">
            <h4>Crop Types</h4>
            <div className="stat-value">
              {new Set(farms.map(f => f.crop_type).filter(Boolean)).size}
            </div>
          </div>
        </div>
      </div>

      {/* Farm Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {farms.map(farm => {
          const sat = satellite.find(s => s.id === farm.id)
          const ndvi = sat?.ndvi
          const ndviStatus = ndvi == null ? 'unknown' : ndvi >= 0.6 ? 'healthy' : ndvi >= 0.4 ? 'moderate' : 'high'

          return (
            <div key={farm.id} className="card">
              <div className="card-header">
                <h3>{farm.name}</h3>
                <span className={`badge ${ndviStatus}`}>
                  {ndviStatus === 'unknown' ? 'No data' : ndviStatus}
                </span>
              </div>
              <div className="card-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: 14 }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Location</span>
                    <div style={{ fontWeight: 500 }}>{farm.location || '—'}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Crop Type</span>
                    <div style={{ fontWeight: 500 }}>{farm.crop_type || '—'}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Size</span>
                    <div style={{ fontWeight: 500 }}>{farm.size_hectares || farm.area || '—'} ha</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>NDVI</span>
                    <div style={{ fontWeight: 500 }}>{ndvi != null ? ndvi.toFixed(3) : '—'}</div>
                  </div>
                  {farm.latitude && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Coordinates</span>
                      <div style={{ fontWeight: 500, fontSize: 12 }}>
                        {farm.latitude?.toFixed(4)}, {farm.longitude?.toFixed(4)}
                      </div>
                    </div>
                  )}
                  {sat?.ndvi_date && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Last Update</span>
                      <div style={{ fontWeight: 500 }}>{sat.ndvi_date}</div>
                    </div>
                  )}
                </div>

                {/* NDVI Bar */}
                {ndvi != null && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>NDVI</span>
                      <span style={{ fontWeight: 600 }}>{ndvi.toFixed(3)}</span>
                    </div>
                    <div className="confidence-bar">
                      <div
                        className="confidence-fill"
                        style={{
                          width: `${ndvi * 100}%`,
                          background: ndvi >= 0.6 ? 'var(--success)' : ndvi >= 0.4 ? 'var(--warning)' : 'var(--danger)',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {farms.length === 0 && (
        <div className="empty-state">
          <MapPin size={48} />
          <h3>No farms registered</h3>
          <p>Farms are added through the backend API or database</p>
        </div>
      )}
    </>
  )
}

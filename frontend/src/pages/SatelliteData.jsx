import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ReferenceLine,
} from 'recharts'
import { Satellite, RefreshCw, Download, AlertTriangle } from 'lucide-react'
import { getFarmSatellite, getNdviHistory, getFarms, triggerSatelliteDownload } from '../api'

export default function SatelliteData() {
  const [farms, setFarms] = useState([])
  const [satellite, setSatellite] = useState([])
  const [selectedFarm, setSelectedFarm] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.allSettled([getFarms(), getFarmSatellite()])
      .then(([fRes, sRes]) => {
        if (fRes.status === 'fulfilled') setFarms(fRes.value.data)
        if (sRes.status === 'fulfilled') setSatellite(sRes.value.data)
        if (fRes.status === 'fulfilled' && fRes.value.data.length) {
          setSelectedFarm(fRes.value.data[0].id)
        }
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!selectedFarm) return
    setHistoryLoading(true)
    getNdviHistory(selectedFarm, 60)
      .then(r => setHistory(r.data || []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false))
  }, [selectedFarm])

  const handleDownload = async () => {
    if (!selectedFarm) return
    setDownloading(true)
    try {
      await triggerSatelliteDownload(selectedFarm, 30)
    } catch (e) {
      setError(e.response?.data?.detail || 'Download trigger failed')
    }
    setDownloading(false)
  }

  if (loading) return <div className="loading"><div className="spinner" /><p>Loading satellite data...</p></div>

  const farmSat = satellite.find(s => s.id === selectedFarm)

  return (
    <>
      {/* Farm Selector */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
            <label>Select Farm</label>
            <select className="form-control" value={selectedFarm} onChange={e => setSelectedFarm(Number(e.target.value))}>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={handleDownload} disabled={downloading || !selectedFarm}>
            <Download size={16} />
            {downloading ? 'Triggering...' : 'Trigger Download'}
          </button>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 20 }}><AlertTriangle size={18} />{error}</div>}

      {/* Current Status */}
      {farmSat && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon green"><Satellite size={22} /></div>
            <div className="stat-info">
              <h4>Current NDVI</h4>
              <div className="stat-value" style={{
                color: farmSat.ndvi >= 0.6 ? 'var(--success)' : farmSat.ndvi >= 0.4 ? 'var(--warning)' : 'var(--danger)',
              }}>
                {farmSat.ndvi?.toFixed(3) || '—'}
              </div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-info">
              <h4>Status</h4>
              <div className="stat-value" style={{ fontSize: 18 }}>
                <span className={`badge ${farmSat.ndvi_status || 'info'}`}>
                  {farmSat.ndvi_status || 'Unknown'}
                </span>
              </div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-info">
              <h4>Data Source</h4>
              <div className="stat-value" style={{ fontSize: 16 }}>
                {farmSat.data_source || 'Unknown'}
              </div>
              {farmSat.tile && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Tile: {farmSat.tile}</div>}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-info">
              <h4>Last Updated</h4>
              <div className="stat-value" style={{ fontSize: 16 }}>
                {farmSat.ndvi_date || '—'}
              </div>
              {farmSat.cloud_cover != null && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Cloud: {farmSat.cloud_cover}%</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* NDVI History Chart */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h3>NDVI History</h3>
          {historyLoading && <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />}
        </div>
        <div className="card-body">
          {history.length > 0 ? (
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis domain={[0, 1]} fontSize={12} />
                <Tooltip />
                <ReferenceLine y={0.6} stroke="#16a34a" strokeDasharray="3 3" label={{ value: 'Healthy', fontSize: 11 }} />
                <ReferenceLine y={0.4} stroke="#d97706" strokeDasharray="3 3" label={{ value: 'Moderate', fontSize: 11 }} />
                <Area type="monotone" dataKey="ndvi" stroke="#2563eb" fill="#dbeafe" strokeWidth={2} name="NDVI" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">
              <Satellite size={40} />
              <h3>No NDVI history</h3>
              <p>Historical satellite data will appear here after processing</p>
            </div>
          )}
        </div>
      </div>

      {/* All Farms Satellite Table */}
      <div className="card">
        <div className="card-header"><h3>All Farms — Satellite Overview</h3></div>
        <div className="card-body table-wrap">
          {satellite.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Farm</th>
                  <th>Location</th>
                  <th>NDVI</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Date</th>
                  <th>Cloud %</th>
                </tr>
              </thead>
              <tbody>
                {satellite.map(s => (
                  <tr
                    key={s.id}
                    style={{ cursor: 'pointer', background: s.id === selectedFarm ? 'var(--primary-light)' : undefined }}
                    onClick={() => setSelectedFarm(s.id)}
                  >
                    <td><strong>{s.name || `Farm ${s.id}`}</strong></td>
                    <td>{s.location || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{s.ndvi?.toFixed(3) || '—'}</td>
                    <td><span className={`badge ${s.ndvi_status || 'info'}`}>{s.ndvi_status || 'Unknown'}</span></td>
                    <td>{s.data_source || '—'}</td>
                    <td>{s.ndvi_date || '—'}</td>
                    <td>{s.cloud_cover != null ? `${s.cloud_cover}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <Satellite size={40} />
              <h3>No satellite data available</h3>
              <p>Satellite images will appear after Sentinel-2 data is processed</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

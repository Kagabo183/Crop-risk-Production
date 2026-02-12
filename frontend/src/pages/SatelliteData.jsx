import { useState, useEffect } from 'react'
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ReferenceLine,
} from 'recharts'
import { Satellite, Download, AlertTriangle, Database, Calendar } from 'lucide-react'
import { getFarmSatellite, getNdviHistory, getFarms, triggerSatelliteDownload, fetchPipelineData, fetchRealData, getFetchStatus } from '../api'
import { useAuth } from '../context/AuthContext'

export default function SatelliteData() {
  const { hasRole } = useAuth()
  const [farms, setFarms] = useState([])
  const [satellite, setSatellite] = useState([])
  const [selectedFarm, setSelectedFarm] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [fetchResult, setFetchResult] = useState(null)
  const [error, setError] = useState(null)

  // Date range state
  const toIso = (d) => d.toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(() => toIso(new Date(Date.now() - 90 * 86400000)))
  const [endDate, setEndDate] = useState(() => toIso(new Date()))

  const loadData = () => {
    setLoading(true)
    Promise.allSettled([getFarms(), getFarmSatellite()])
      .then(([fRes, sRes]) => {
        if (fRes.status === 'fulfilled') setFarms(fRes.value.data)
        if (sRes.status === 'fulfilled') setSatellite(sRes.value.data)
        if (fRes.status === 'fulfilled' && fRes.value.data.length) {
          setSelectedFarm(prev => prev || fRes.value.data[0].id)
        }
        setLoading(false)
      })
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (!selectedFarm) return
    setHistoryLoading(true)
    getNdviHistory(selectedFarm, 200, startDate, endDate)
      .then(r => setHistory(r.data || []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false))
  }, [selectedFarm, startDate, endDate])

  const handleDownload = async () => {
    setDownloading(true)
    setError(null)
    try {
      await fetchPipelineData(startDate, endDate)
    } catch (e) {
      setError(e.response?.data?.detail || 'Download trigger failed')
    }
    setDownloading(false)
  }

  const handleFetchPipeline = async () => {
    setFetching(true)
    setError(null)
    setFetchResult(null)
    try {
      const res = await fetchPipelineData(startDate, endDate)
      setFetchResult(res.data)
      // Refresh all data after fetching
      loadData()
      // Also refresh history for the selected farm
      if (selectedFarm) {
        getNdviHistory(selectedFarm, 200, startDate, endDate)
          .then(r => setHistory(r.data || []))
          .catch(() => { })
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Pipeline data fetch failed')
    }
    setFetching(false)
  }

  const handleFetchReal = async () => {
    setSeeding(true)
    setError(null)
    setFetchResult(null)
    try {
      await fetchRealData(90, 7)
      // Poll status until done
      const poll = setInterval(async () => {
        try {
          const s = await getFetchStatus()
          if (!s.data.is_running) {
            clearInterval(poll)
            setSeeding(false)
            setFetchResult(s.data.last_result)
            loadData()
            if (selectedFarm) {
              getNdviHistory(selectedFarm, 200, startDate, endDate)
                .then(r => setHistory(r.data || []))
                .catch(() => { })
            }
          }
        } catch { clearInterval(poll); setSeeding(false) }
      }, 3000)
    } catch (e) {
      setError(e.response?.data?.detail || 'Real data fetch failed')
      setSeeding(false)
    }
  }

  if (loading) return <div className="loading"><div className="spinner" /><p>Loading satellite data...</p></div>

  const farmSat = satellite.find(s => s.id === selectedFarm)

  return (
    <>
      {/* Farm Selector + Date Range + Action Buttons */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
            <label>Select Farm</label>
            <select className="form-control" value={selectedFarm} onChange={e => setSelectedFarm(Number(e.target.value))}>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 150 }}>
            <label><Calendar size={13} style={{ verticalAlign: -1, marginRight: 4 }} />Start Date</label>
            <input type="date" className="form-control" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 150 }}>
            <label><Calendar size={13} style={{ verticalAlign: -1, marginRight: 4 }} />End Date</label>
            <input type="date" className="form-control" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          {hasRole('admin', 'agronomist') && (
            <>
              <button className="btn btn-primary" onClick={handleFetchPipeline} disabled={fetching}>
                <Database size={16} />
                {fetching ? 'Fetching...' : 'Fetch Real Satellite Data'}
              </button>
              <button className="btn btn-success" onClick={handleFetchReal} disabled={seeding} title="Fetch real satellite & weather data">
                <Satellite size={16} />
                {seeding ? 'Fetching Real Data...' : 'Fetch Real Data'}
              </button>
              <button className="btn btn-secondary" onClick={handleDownload} disabled={downloading}>
                <Download size={16} />
                {downloading ? 'Downloading...' : 'Download from Copernicus'}
              </button>
            </>
          )}
        </div>
      </div>

      {seeding && (
        <div className="card" style={{ marginBottom: 20, border: '1px solid var(--primary)', background: '#eff6ff' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
            <span><strong>Fetching real satellite & weather data...</strong> This may take 1-3 minutes. Reading Sentinel-2 data from Microsoft Planetary Computer and weather from Open-Meteo.</span>
          </div>
        </div>
      )}

      {error && <div className="error-box" style={{ marginBottom: 20 }}><AlertTriangle size={18} /> {error}</div>}

      {fetchResult && (
        <div className="card" style={{
          marginBottom: 20,
          border: `1px solid ${fetchResult.status === 'completed' ? 'var(--success)' : fetchResult.status === 'no_farms' ? 'var(--warning)' : 'var(--danger)'}`,
          background: fetchResult.status === 'completed' ? '#f0fdf4' : fetchResult.status === 'no_farms' ? '#fffbeb' : '#fef2f2',
        }}>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <Satellite size={20} style={{
                color: fetchResult.status === 'completed' ? 'var(--success)' : fetchResult.status === 'no_farms' ? 'var(--warning)' : 'var(--danger)'
              }} />
              <strong>
                {fetchResult.status === 'completed' ? 'Real data fetch completed!' :
                  fetchResult.status === 'no_farms' ? 'No farms found — add farms first.' :
                    fetchResult.status === 'failed' ? `Fetch failed: ${fetchResult.error || 'Unknown error'}` :
                      fetchResult.message || 'Fetch finished.'}
              </strong>
            </div>
            {fetchResult.status === 'completed' && (
              <div style={{ display: 'flex', gap: 24, fontSize: 14, color: '#555', flexWrap: 'wrap' }}>
                <span>🌾 <strong>{fetchResult.farms_processed || 0}</strong> farms processed</span>
                <span>🛰️ <strong>{fetchResult.satellite_records || 0}</strong> satellite observations</span>
                <span>🌦️ <strong>{fetchResult.weather_records || 0}</strong> weather records</span>
                <span>🌿 <strong>{fetchResult.vegetation_records || 0}</strong> vegetation health</span>
                {fetchResult.errors?.length > 0 && (
                  <span style={{ color: 'var(--danger)' }}>⚠️ {fetchResult.errors.length} error(s)</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

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
              <p>Click "Fetch Satellite Data" to populate satellite observations</p>
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
              <p>Click "Fetch Satellite Data" above to generate satellite observations</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

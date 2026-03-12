import { useState, useEffect } from 'react'
import { Cpu, CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import { getModelStatus, getSupportedDiseases, detectAnomalies, forecastHealth, getFarms } from '../api'

const STATUS_ICONS = {
  ready: { icon: CheckCircle, color: 'var(--success)', bg: 'var(--success-light)' },
  loaded: { icon: CheckCircle, color: 'var(--success)', bg: 'var(--success-light)' },
  not_loaded: { icon: XCircle, color: 'var(--text-secondary)', bg: '#f3f4f6' },
  error: { icon: AlertTriangle, color: 'var(--danger)', bg: 'var(--danger-light)' },
  not_trained: { icon: XCircle, color: 'var(--warning)', bg: 'var(--warning-light)' },
}

const MODEL_INFO = {
  disease_classifier: { name: 'Disease Classifier', desc: 'EfficientNet-B0 CNN — 80 classes, 30 plants', algo: 'CNN' },
  risk_scorer: { name: 'Ensemble Risk Scorer', desc: 'Combined ML + research algorithms', algo: 'Ensemble' },
  ensemble_scorer: { name: 'Ensemble Risk Scorer', desc: 'Combined ML + research algorithms', algo: 'Ensemble' },
  yield_predictor: { name: 'Yield Predictor', desc: 'Crop yield forecasting', algo: 'XGBoost' },
  anomaly_detector: { name: 'Anomaly Detector', desc: 'Unusual vegetation pattern detection', algo: 'Isolation Forest' },
  health_forecaster: { name: 'Health Forecaster', desc: 'Vegetation health time-series prediction', algo: 'Prophet' },
  trend_forecaster: { name: 'Trend Forecaster', desc: 'Health trend prediction', algo: 'Prophet' },
}

export default function MLModels() {
  const [models, setModels] = useState(null)
  const [supported, setSupported] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [farms, setFarms] = useState([])
  const [testFarm, setTestFarm] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    Promise.allSettled([getModelStatus(), getSupportedDiseases(), getFarms()])
      .then(([mRes, sRes, fRes]) => {
        if (mRes.status === 'fulfilled') setModels(mRes.value.data)
        if (sRes.status === 'fulfilled') setSupported(sRes.value.data)
        if (fRes.status === 'fulfilled') {
          setFarms(fRes.value.data)
          if (fRes.value.data.length) setTestFarm(fRes.value.data[0].id)
        }
        setLoading(false)
      })
  }, [])

  const refresh = () => {
    setLoading(true)
    getModelStatus()
      .then(r => setModels(r.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  const runAnomalyTest = async () => {
    if (!testFarm) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await detectAnomalies(testFarm, 30)
      setTestResult({ type: 'anomaly', data: res.data })
    } catch (e) {
      setTestResult({ type: 'error', data: e.response?.data?.detail || e.message })
    }
    setTesting(false)
  }

  const runForecastTest = async () => {
    if (!testFarm) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await forecastHealth(testFarm, 7)
      setTestResult({ type: 'forecast', data: res.data })
    } catch (e) {
      setTestResult({ type: 'error', data: e.response?.data?.detail || e.message })
    }
    setTesting(false)
  }

  if (loading) return <div className="loading"><div className="spinner" /><p>Loading model status...</p></div>

  const modelEntries = models?.models ? Object.entries(models.models) : []
  // New API format: models.models[key] = {status, trained, description, ...}
  const readyCount = modelEntries.filter(([, modelInfo]) => {
    const st = typeof modelInfo === 'string' ? modelInfo : modelInfo?.status
    return st === 'ready' || st === 'loaded' || st === 'available'
  }).length

  return (
    <>
      {/* Overview */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon cyan"><Cpu size={22} /></div>
          <div className="stat-info">
            <h4>Total Models</h4>
            <div className="stat-value">{modelEntries.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><CheckCircle size={22} /></div>
          <div className="stat-info">
            <h4>Ready</h4>
            <div className="stat-value">{readyCount}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><Cpu size={22} /></div>
          <div className="stat-info">
            <h4>Disease Classes</h4>
            <div className="stat-value">{supported?.total_classes || 80}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Cpu size={22} /></div>
          <div className="stat-info">
            <h4>Plants Covered</h4>
            <div className="stat-value">{supported?.total_plants || 30}</div>
          </div>
        </div>
      </div>

      {/* Model Cards */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h3>Model Status</h3>
          <button className="btn btn-sm btn-secondary" onClick={refresh}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {modelEntries.map(([key, modelInfo]) => {
              const info = MODEL_INFO[key] || { name: key.replace(/_/g, ' '), desc: '', algo: '' }
              // Handle both old string format and new object format
              const status = typeof modelInfo === 'string' ? modelInfo : modelInfo?.status || 'unknown'
              const trained = typeof modelInfo === 'object' ? modelInfo?.trained : null
              const note = typeof modelInfo === 'object' ? modelInfo?.note : null

              const st = STATUS_ICONS[status] || STATUS_ICONS.not_loaded
              const Icon = st.icon

              return (
                <div key={key} style={{
                  padding: 16,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 8,
                    background: st.bg, color: st.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{info.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{info.desc}</div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className={`badge ${status === 'ready' || status === 'loaded' ? 'healthy' : status === 'error' ? 'high' : 'info'}`}>
                        {status}
                      </span>
                      {trained === true && <span className="badge healthy">Trained</span>}
                      {trained === false && <span className="badge info">Defaults</span>}
                      {info.algo && (
                        <span className="badge info">{info.algo}</span>
                      )}
                    </div>
                    {note && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                        {note}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Supported Plants */}
      {supported?.diseases_by_plant && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><h3>Supported Plants & Diseases</h3></div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
              {Object.entries(supported.diseases_by_plant).map(([plant, diseases]) => (
                <div key={plant} style={{
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize', marginBottom: 6 }}>
                    {plant}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(Array.isArray(diseases) ? diseases : []).map((d, i) => (
                      <span key={i} className={`badge ${d === 'Healthy' ? 'healthy' : 'info'}`} style={{ fontSize: 11 }}>
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Test Models */}
      <div className="card">
        <div className="card-header"><h3>Test Models</h3></div>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
              <label>Farm</label>
              <select className="form-control" value={testFarm} onChange={e => setTestFarm(Number(e.target.value))}>
                {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <button className="btn btn-secondary" onClick={runAnomalyTest} disabled={testing || !testFarm}>
              Detect Anomalies
            </button>
            <button className="btn btn-secondary" onClick={runForecastTest} disabled={testing || !testFarm}>
              Forecast Health
            </button>
          </div>

          {testing && <div className="loading"><div className="spinner" /><p>Running model...</p></div>}

          {testResult && (
            <div style={{ marginTop: 12 }}>
              {testResult.type === 'error' ? (
                <div className="error-box"><AlertTriangle size={18} />{testResult.data}</div>
              ) : (
                <pre style={{
                  background: '#f9fafb',
                  padding: 16,
                  borderRadius: 'var(--radius)',
                  fontSize: 12,
                  overflow: 'auto',
                  maxHeight: 300,
                }}>
                  {JSON.stringify(testResult.data, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

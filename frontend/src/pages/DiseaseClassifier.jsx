import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, Camera, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import { classifyDisease, getSupportedDiseases, getCropModels } from '../api'

export default function DiseaseClassifier() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [cropType, setCropType] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [supported, setSupported] = useState(null)
  const [cropModels, setCropModels] = useState([])
  const [dragover, setDragover] = useState(false)
  const inputRef = useRef()

  // Load supported diseases and crop models on first render
  useEffect(() => {
    getSupportedDiseases()
      .then(r => setSupported(r.data))
      .catch(() => {})
    getCropModels()
      .then(r => setCropModels(r.data.crop_models || []))
      .catch(() => {})
  }, [])

  const handleFile = useCallback((f) => {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target.result)
    reader.readAsDataURL(f)
  }, [])

  const handleDrop = useCallback(e => {
    e.preventDefault()
    setDragover(false)
    const f = e.dataTransfer.files[0]
    if (f && f.type.startsWith('image/')) handleFile(f)
  }, [handleFile])

  const classify = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await classifyDisease(file, cropType || undefined)
      setResult(res.data)
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Classification failed')
    }
    setLoading(false)
  }

  const confidenceColor = (conf) => {
    if (conf >= 0.7) return 'var(--success)'
    if (conf >= 0.4) return 'var(--warning)'
    return 'var(--danger)'
  }

  const plants = supported?.plants || []

  return (
    <>
      <div className="grid-2">
        {/* Upload Panel */}
        <div className="card">
          <div className="card-header">
            <h3>Upload Leaf Image</h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {supported ? `${supported.total_classes} classes, ${supported.total_plants} plants` : '80 classes'}
            </span>
          </div>
          <div className="card-body">
            {/* Crop filter */}
            <div className="form-group">
              <label>Crop Type (select for best accuracy)</label>
              <select className="form-control" value={cropType} onChange={e => setCropType(e.target.value)}>
                <option value="">All plants (general model)</option>
                {cropModels.length > 0 && (
                  <optgroup label="Rwanda Priority Crops (specialized models)">
                    {cropModels.filter(m => m.rwanda_priority).map(m => (
                      <option key={m.crop_key} value={m.crop_key}>
                        {m.display_name} ({m.num_classes} classes){m.model_available ? '' : ' — general model'}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Other Plants (general model)">
                  {plants
                    .filter(p => !cropModels.some(m => m.crop_key === p))
                    .map(p => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                </optgroup>
              </select>
            </div>

            {/* Upload zone */}
            <div
              className={`upload-zone ${dragover ? 'dragover' : ''}`}
              onClick={() => inputRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragover(true) }}
              onDragLeave={() => setDragover(false)}
              onDrop={handleDrop}
            >
              <Upload size={40} />
              <p>Drag & drop a leaf image here, or click to browse</p>
              <p className="upload-hint">JPG, PNG up to 10MB</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])}
            />

            {/* Preview: original + Grad-CAM side by side */}
            {preview && (
              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>Original</div>
                  <div className="image-preview">
                    <img src={preview} alt="Leaf preview" />
                  </div>
                </div>
                {result?.gradcam_base64 && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>Grad-CAM — Disease Region</div>
                    <div className="image-preview" style={{ border: '2px solid var(--danger)' }}>
                      <img src={`data:image/png;base64,${result.gradcam_base64}`} alt="Grad-CAM heatmap" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Classify button */}
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}
              onClick={classify}
              disabled={!file || loading}
            >
              {loading ? <><Loader2 size={16} className="spinner" style={{ border: 'none', borderTop: 'none' }} /> Analyzing...</> : <><Camera size={16} /> Classify Disease</>}
            </button>

            {error && <div className="error-box" style={{ marginTop: 16 }}><AlertTriangle size={18} />{error}</div>}
          </div>
        </div>

        {/* Results Panel */}
        <div className="card">
          <div className="card-header">
            <h3>Classification Results</h3>
          </div>
          <div className="card-body">
            {!result && !loading && (
              <div className="empty-state">
                <Bug size={48} />
                <h3>No results yet</h3>
                <p>Upload a leaf image and click "Classify Disease" to see results</p>
              </div>
            )}

            {loading && (
              <div className="loading">
                <div className="spinner" />
                <p>Analyzing image with EfficientNet-B0...</p>
              </div>
            )}

            {result && (
              <>
                {/* Main result */}
                <div className={`result-card`}>
                  <div className={`result-header ${result.is_healthy ? 'healthy' : 'diseased'}`}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>
                        {result.is_healthy ? (
                          <span style={{ color: 'var(--success)' }}><CheckCircle size={20} style={{ verticalAlign: -3 }} /> Healthy</span>
                        ) : (
                          <span style={{ color: 'var(--danger)' }}><AlertTriangle size={20} style={{ verticalAlign: -3 }} /> {result.disease}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Plant: <strong>{result.plant}</strong>
                        {result.crop_type && <> | Crop: <strong>{result.crop_type}</strong></>}
                        {result.model_type && (
                          <> | <span style={{
                            fontSize: 11,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: result.model_type === 'per_crop' ? 'var(--success)' : 'var(--text-secondary)',
                            color: '#fff',
                          }}>
                            {result.model_type === 'per_crop' ? 'Specialized Model' : 'General Model'}
                          </span></>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: confidenceColor(result.confidence) }}>
                        {(result.confidence * 100).toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>confidence</div>
                    </div>
                  </div>

                  {/* Confidence bar */}
                  <div style={{ padding: '12px 20px' }}>
                    <div className="confidence-bar">
                      <div className="confidence-fill" style={{
                        width: `${result.confidence * 100}%`,
                        background: confidenceColor(result.confidence),
                      }} />
                    </div>
                  </div>
                </div>

                {/* Treatment */}
                {result.treatment && !result.is_healthy && (
                  <div className="treatment-box">
                    <h4>Treatment Recommendations</h4>
                    {result.treatment.urgency && (
                      <div style={{ marginBottom: 8, fontSize: 13 }}>
                        Urgency: <span className={`badge ${result.treatment.urgency === 'high' || result.treatment.urgency === 'very_high' ? 'high' : 'moderate'}`}>
                          {result.treatment.urgency}
                        </span>
                        {result.treatment.spread_risk && (
                          <> | Spread risk: <span className={`badge ${result.treatment.spread_risk === 'very_high' || result.treatment.spread_risk === 'high' ? 'high' : 'moderate'}`}>
                            {result.treatment.spread_risk}
                          </span></>
                        )}
                      </div>
                    )}
                    {result.treatment.fungicides && (
                      <div style={{ marginBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>Fungicides:</strong>
                        <ul>{result.treatment.fungicides.map((f, i) => <li key={i}>{f}</li>)}</ul>
                      </div>
                    )}
                    {result.treatment.cultural && (
                      <div>
                        <strong style={{ fontSize: 13 }}>Cultural practices:</strong>
                        <ul>{result.treatment.cultural.map((c, i) => <li key={i}>{c}</li>)}</ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Top 5 */}
                {result.top5 && result.top5.length > 0 && (
                  <div className="top5-list">
                    <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Top 5 Predictions</h4>
                    {result.top5.map((item, i) => (
                      <div key={i} className="top5-item">
                        <div className="top5-rank">{i + 1}</div>
                        <div className="top5-info">
                          <div className="top5-name">
                            {item.plant || result.plant} — {item.disease || 'Unknown'}
                          </div>
                          <div className="confidence-bar" style={{ marginTop: 4 }}>
                            <div className="confidence-fill" style={{
                              width: `${(item.confidence || 0) * 100}%`,
                              background: confidenceColor(item.confidence || 0),
                            }} />
                          </div>
                        </div>
                        <div className="top5-conf">{((item.confidence || 0) * 100).toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Bug(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={props.size || 24} height={props.size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>
  )
}

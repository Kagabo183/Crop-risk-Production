import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, Camera, AlertTriangle, CheckCircle, Loader2, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { classifyDisease, getSupportedDiseases, getCropModels, getClassificationHistory } from '../api'
import { formatDate } from '../utils/formatDate'

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
  const [history, setHistory] = useState([])
  const [historyExpanded, setHistoryExpanded] = useState(null)
  const inputRef = useRef()

  const loadHistory = useCallback(() => {
    getClassificationHistory(20)
      .then(r => setHistory(r.data.classifications || []))
      .catch(err => {
        console.warn('Failed to load classification history:', err)
        setHistory([])  // Set to empty array on error
      })
  }, [])

  // Load supported diseases, crop models, and history on first render
  useEffect(() => {
    getSupportedDiseases()
      .then(r => setSupported(r.data))
      .catch(err => {
        console.error('Failed to load supported diseases:', err)
        setError('Unable to load disease information. Please refresh the page.')
      })
    getCropModels()
      .then(r => setCropModels(r.data.crop_models || []))
      .catch(err => {
        console.warn('Failed to load crop models:', err)
        setCropModels([])  // Default to empty array
      })
    loadHistory()
  }, [loadHistory])

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
      loadHistory()
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
                        Urgency: <span className={`badge ${result.treatment.urgency === 'high' || result.treatment.urgency === 'very_high' || result.treatment.urgency === 'critical' ? 'high' : 'moderate'}`}>
                          {result.treatment.urgency}
                        </span>
                        {result.treatment.spread_risk && (
                          <> | Spread risk: <span className={`badge ${result.treatment.spread_risk === 'very_high' || result.treatment.spread_risk === 'high' ? 'high' : 'moderate'}`}>
                            {result.treatment.spread_risk}
                          </span></>
                        )}
                        {result.treatment.action_days && (
                          <> | <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                            background: result.treatment.action_days[0] <= 3 ? '#dc262620' : '#d9770620',
                            color: result.treatment.action_days[0] <= 3 ? '#dc2626' : '#d97706',
                            border: `1px solid ${result.treatment.action_days[0] <= 3 ? '#dc262640' : '#d9770640'}`,
                          }}>
                            Act within {result.treatment.action_days[0]}-{result.treatment.action_days[1]} days
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

      {/* Classification History */}
      {history.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <h3><Clock size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Recent Classifications</h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{history.length} results</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 16px' }}>Image</th>
                  <th style={{ padding: '10px 8px' }}>Plant</th>
                  <th style={{ padding: '10px 8px' }}>Disease</th>
                  <th style={{ padding: '10px 8px' }}>Confidence</th>
                  <th style={{ padding: '10px 8px' }}>Model</th>
                  <th style={{ padding: '10px 16px' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => {
                  const isOpen = historyExpanded === h.id
                  return (
                    <React.Fragment key={h.id}>
                      <tr
                        style={{ borderBottom: isOpen ? 'none' : '1px solid var(--border)', cursor: 'pointer', background: isOpen ? 'var(--bg-secondary, rgba(0,0,0,0.02))' : undefined }}
                        onClick={() => setHistoryExpanded(isOpen ? null : h.id)}
                      >
                        <td style={{ padding: '8px 16px' }}>
                          {h.image_url ? (
                            <img
                              src={h.image_url}
                              alt="leaf"
                              style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }}
                            />
                          ) : (
                            <div style={{ width: 40, height: 40, background: 'var(--border)', borderRadius: 4 }} />
                          )}
                        </td>
                        <td style={{ padding: '8px' }}>{h.plant}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{ color: h.is_healthy ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                            {h.is_healthy ? 'Healthy' : h.disease}
                          </span>
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span style={{ color: confidenceColor(h.confidence), fontWeight: 600 }}>
                            {(h.confidence * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: h.model_type === 'per_crop' ? 'var(--success)' : 'var(--text-secondary)',
                            color: '#fff',
                          }}>
                            {h.model_type === 'per_crop' ? 'Specialized' : 'General'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {formatDate(h.created_at)}
                          </span>
                          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {isOpen && (
                        <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary, rgba(0,0,0,0.02))' }}>
                          <td colSpan={6} style={{ padding: '16px' }}>
                            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                              {/* Image preview */}
                              {h.image_url && (
                                <div style={{ flexShrink: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>Uploaded Image</div>
                                  <img
                                    src={h.image_url}
                                    alt={`${h.plant} leaf`}
                                    style={{ width: 200, height: 200, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                                  />
                                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                                    {h.original_filename || 'uploaded image'}
                                  </div>
                                </div>
                              )}

                              {/* Classification details */}
                              <div style={{ flex: 1, minWidth: 250 }}>
                                {/* Main result header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                  <div>
                                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                                      {h.is_healthy ? (
                                        <span style={{ color: 'var(--success)' }}><CheckCircle size={18} style={{ verticalAlign: -3 }} /> Healthy</span>
                                      ) : (
                                        <span style={{ color: 'var(--danger)' }}><AlertTriangle size={18} style={{ verticalAlign: -3 }} /> {h.disease}</span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                                      Plant: <strong>{h.plant}</strong>
                                      {h.crop_type && <> | Crop: <strong>{h.crop_type}</strong></>}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 24, fontWeight: 700, color: confidenceColor(h.confidence) }}>
                                      {(h.confidence * 100).toFixed(1)}%
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>confidence</div>
                                  </div>
                                </div>

                                {/* Confidence bar */}
                                <div className="confidence-bar" style={{ marginBottom: 16 }}>
                                  <div className="confidence-fill" style={{
                                    width: `${h.confidence * 100}%`,
                                    background: confidenceColor(h.confidence),
                                  }} />
                                </div>

                                {/* Top 5 predictions */}
                                {h.top5 && h.top5.length > 0 && (
                                  <div style={{ marginBottom: 16 }}>
                                    <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Top 5 Predictions</h4>
                                    {h.top5.map((item, i) => (
                                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12 }}>
                                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                                          {i + 1}
                                        </span>
                                        <span style={{ flex: 1 }}>
                                          {item.plant || h.plant} — {item.disease || 'Unknown'}
                                        </span>
                                        <div style={{ width: 80 }}>
                                          <div className="confidence-bar" style={{ height: 4 }}>
                                            <div className="confidence-fill" style={{
                                              width: `${(item.confidence || 0) * 100}%`,
                                              background: confidenceColor(item.confidence || 0),
                                            }} />
                                          </div>
                                        </div>
                                        <span style={{ fontWeight: 600, color: confidenceColor(item.confidence || 0), width: 45, textAlign: 'right' }}>
                                          {((item.confidence || 0) * 100).toFixed(1)}%
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Treatment recommendations */}
                                {h.treatment && !h.is_healthy && Object.keys(h.treatment).length > 0 && (
                                  <div style={{ background: 'var(--bg-primary, #fff)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                                    <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Treatment Recommendations</h4>
                                    {h.treatment.urgency && (
                                      <div style={{ marginBottom: 6, fontSize: 12 }}>
                                        Urgency: <span className={`badge ${h.treatment.urgency === 'high' || h.treatment.urgency === 'very_high' || h.treatment.urgency === 'critical' ? 'high' : 'moderate'}`}>
                                          {h.treatment.urgency}
                                        </span>
                                        {h.treatment.spread_risk && (
                                          <> | Spread risk: <span className={`badge ${h.treatment.spread_risk === 'very_high' || h.treatment.spread_risk === 'high' ? 'high' : 'moderate'}`}>
                                            {h.treatment.spread_risk}
                                          </span></>
                                        )}
                                        {h.treatment.action_days && (
                                          <> | <span style={{
                                            display: 'inline-block',
                                            padding: '2px 8px',
                                            borderRadius: 4,
                                            fontSize: 11,
                                            fontWeight: 600,
                                            background: h.treatment.action_days[0] <= 3 ? '#dc262620' : '#d9770620',
                                            color: h.treatment.action_days[0] <= 3 ? '#dc2626' : '#d97706',
                                            border: `1px solid ${h.treatment.action_days[0] <= 3 ? '#dc262640' : '#d9770640'}`,
                                          }}>
                                            Act within {h.treatment.action_days[0]}-{h.treatment.action_days[1]} days
                                          </span></>
                                        )}
                                      </div>
                                    )}
                                    {h.treatment.fungicides && (
                                      <div style={{ marginBottom: 6, fontSize: 12 }}>
                                        <strong>Fungicides:</strong>
                                        <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>{h.treatment.fungicides.map((f, i) => <li key={i}>{f}</li>)}</ul>
                                      </div>
                                    )}
                                    {h.treatment.cultural && (
                                      <div style={{ fontSize: 12 }}>
                                        <strong>Cultural practices:</strong>
                                        <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>{h.treatment.cultural.map((c, i) => <li key={i}>{c}</li>)}</ul>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

function Bug(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={props.size || 24} height={props.size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 2 1.88 1.88" /><path d="M14.12 3.88 16 2" /><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" /><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" /><path d="M12 20v-9" /><path d="M6.53 9C4.6 8.8 3 7.1 3 5" /><path d="M6 13H2" /><path d="M3 21c0-2.1 1.7-3.9 3.8-4" /><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" /><path d="M22 13h-4" /><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" /></svg>
  )
}

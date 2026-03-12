/**
 * Mobile Disease Classifier — camera-first, low-bandwidth redesign.
 *
 * Key changes from the previous version:
 *  1. Camera button is the primary CTA (not a drag-drop zone)
 *  2. Images are compressed client-side before upload (10-20× smaller)
 *  3. Image quality errors from the backend are shown as friendly UI prompts
 *  4. Results shown as a simple card — no 6-column table on a small screen
 *  5. History shown as compact cards, not a desktop table
 *  6. Advisory tips appear automatically after a diseased scan result
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Camera, Upload, AlertTriangle, CheckCircle,
  Loader2, Clock, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  classifyDisease,
  getSupportedDiseases,
  getCropModels,
  getClassificationHistory,
  getDailyAdvisory,
} from '../api'
import { formatDate } from '../utils/formatDate'
import { compressImage, compressionSummary } from '../utils/imageCompressor'
import { useTitle } from '../context/TitleContext'

// ── Confidence colour helper ──────────────────────────────────────────────────
const confColor = (c) =>
  c >= 0.7 ? 'var(--success)' : c >= 0.4 ? 'var(--warning)' : 'var(--danger)'

// ── Priority badge styles ─────────────────────────────────────────────────────
const priorityStyle = {
  urgent:    { background: '#dc262618', color: '#dc2626', border: '1px solid #dc262640' },
  important: { background: '#d9770618', color: '#d97706', border: '1px solid #d9770640' },
  info:      { background: '#2563eb18', color: '#2563eb', border: '1px solid #2563eb40' },
}

export default function DiseaseClassifier() {
  const { setTitle } = useTitle()

  // ── Form state ──────────────────────────────────────────────────────────────
  const [file, setFile]         = useState(null)
  const [preview, setPreview]   = useState(null)
  const [cropType, setCropType] = useState('')
  const [compressionInfo, setCompressionInfo] = useState(null)

  // ── Async state ─────────────────────────────────────────────────────────────
  const [result, setResult]       = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [qualityError, setQualityError] = useState(null)

  // ── Metadata ─────────────────────────────────────────────────────────────────
  const [supported, setSupported]   = useState(null)
  const [cropModels, setCropModels] = useState([])

  // ── History ──────────────────────────────────────────────────────────────────
  const [history, setHistory]     = useState([])
  const [expandedId, setExpandedId] = useState(null)

  // ── Advisory tips shown after a diseased result ───────────────────────────
  const [advisories, setAdvisories] = useState([])

  const cameraRef  = useRef()
  const galleryRef = useRef()

  // ── Initialisation ───────────────────────────────────────────────────────────
  useEffect(() => {
    setTitle('Disease Check')
    getSupportedDiseases().then(r => setSupported(r.data)).catch(() => {})
    getCropModels().then(r => setCropModels(r.data.crop_models || [])).catch(() => {})
    loadHistory()
  }, [])

  const loadHistory = useCallback(() => {
    getClassificationHistory(15)
      .then(r => setHistory(r.data.classifications || []))
      .catch(() => setHistory([]))
  }, [])

  // ── File handling with compression ──────────────────────────────────────────
  const handleFile = useCallback(async (rawFile) => {
    if (!rawFile) return
    setResult(null)
    setError(null)
    setQualityError(null)
    setAdvisories([])
    setCompressionInfo(null)

    // Show preview of the original immediately (feels instant to the user)
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target.result)
    reader.readAsDataURL(rawFile)

    // Compress asynchronously — swap file once done
    const originalSize = rawFile.size
    const compressed = await compressImage(rawFile)
    setFile(compressed)

    if (compressed.size < originalSize) {
      setCompressionInfo(compressionSummary(originalSize, compressed.size))
    }
  }, [])

  // ── Classify ──────────────────────────────────────────────────────────────
  const classify = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    setQualityError(null)
    setResult(null)
    setAdvisories([])

    try {
      const res = await classifyDisease(file, cropType || undefined)
      const data = res.data
      setResult(data)
      loadHistory()

      // Fetch advisory tips when a disease is found and a farm_id is linked
      if (!data.is_healthy && data.farm_id) {
        getDailyAdvisory(data.farm_id, false)
          .then(r => setAdvisories(r.data.advisories || []))
          .catch(() => {})
      }
    } catch (e) {
      // HTTP 422 from the quality gate — show a friendly photo-tip prompt
      const detail = e.response?.data?.detail
      if (detail?.type === 'image_quality') {
        setQualityError(detail.feedback)
      } else {
        setError(e.response?.data?.detail || e.message || 'Classification failed. Please try again.')
      }
    }
    setLoading(false)
  }

  // ── Reset ────────────────────────────────────────────────────────────────
  const reset = () => {
    setFile(null)
    setPreview(null)
    setResult(null)
    setError(null)
    setQualityError(null)
    setAdvisories([])
    setCompressionInfo(null)
  }

  const priorityCrops = cropModels.filter(m => m.rwanda_priority)
  const otherPlants   = (supported?.plants || []).filter(
    p => !cropModels.some(m => m.crop_key === p)
  )

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Scan card ───────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <h3>Scan Your Crop</h3>
          {supported && (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {supported.total_classes} diseases · {supported.total_plants} crops
            </span>
          )}
        </div>

        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Crop selector */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 13 }}>
              Which crop?{' '}
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                (optional — improves accuracy)
              </span>
            </label>
            <select
              className="form-control"
              value={cropType}
              onChange={e => setCropType(e.target.value)}
            >
              <option value="">All crops (general model)</option>
              {priorityCrops.length > 0 && (
                <optgroup label="Rwanda Priority Crops">
                  {priorityCrops.map(m => (
                    <option key={m.crop_key} value={m.crop_key}>
                      {m.display_name}
                    </option>
                  ))}
                </optgroup>
              )}
              {otherPlants.length > 0 && (
                <optgroup label="Other Crops">
                  {otherPlants.map(p => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* ── Primary action: camera + gallery ─────────────────────────── */}
          {!preview ? (
            <div style={{ display: 'flex', gap: 10 }}>
              {/* Camera — primary for mobile */}
              <button
                className="btn btn-primary"
                style={{ flex: 2, justifyContent: 'center', gap: 6, padding: '10px 0' }}
                onClick={() => cameraRef.current?.click()}
              >
                <Camera size={18} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>Take Photo</span>
              </button>

              {/* Gallery — secondary */}
              <button
                className="btn btn-secondary"
                style={{ flex: 1, justifyContent: 'center', gap: 4, padding: '10px 0' }}
                onClick={() => galleryRef.current?.click()}
              >
                <Upload size={16} />
                <span>Gallery</span>
              </button>

              {/* Hidden file inputs */}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])}
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])}
              />
            </div>
          ) : (
            /* ── Preview + action ────────────────────────────────────────── */
            <div>
              {/* Image preview */}
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <img
                  src={preview}
                  alt="Crop preview"
                  style={{
                    width: '100%',
                    maxHeight: 260,
                    objectFit: 'cover',
                    borderRadius: 10,
                    border: '2px solid var(--border)',
                  }}
                />
                <button
                  className="btn btn-secondary"
                  onClick={reset}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    padding: '6px 10px', fontSize: 12, gap: 4,
                  }}
                >
                  <RefreshCw size={13} /> Retake
                </button>
              </div>

              {/* Data-savings label */}
              {compressionInfo && (
                <div style={{
                  fontSize: 11, color: 'var(--text-secondary)',
                  marginBottom: 8, textAlign: 'center',
                }}>
                  📦 {compressionInfo}
                </div>
              )}

              {/* Grad-CAM comparison (shown after result) */}
              {result?.gradcam_base64 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)' }}>
                    Original
                    <img src={preview} alt="original"
                      style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, display: 'block', marginTop: 4 }} />
                  </div>
                  <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'var(--danger)' }}>
                    Disease Region
                    <img src={`data:image/png;base64,${result.gradcam_base64}`} alt="Grad-CAM"
                      style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, border: '2px solid var(--danger)', display: 'block', marginTop: 4 }} />
                  </div>
                </div>
              )}

              {/* Analyse button — only before result */}
              {!result && (
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '13px 0', fontSize: 15 }}
                  onClick={classify}
                  disabled={loading}
                >
                  {loading
                    ? <><Loader2 size={18} className="spinner" style={{ border: 'none' }} /> Analysing…</>
                    : <><Camera size={18} /> Analyse Disease</>
                  }
                </button>
              )}
            </div>
          )}

          {/* ── Quality error ─────────────────────────────────────────────── */}
          {qualityError && (
            <div style={{
              background: '#fef3c720', border: '1px solid #d9770660',
              borderRadius: 10, padding: 14,
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 24 }}>📸</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#d97706', marginBottom: 4 }}>
                  Photo needs improvement
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {qualityError}
                </div>
                <button className="btn btn-secondary" onClick={reset}
                  style={{ marginTop: 10, padding: '6px 14px', fontSize: 12 }}>
                  <Camera size={13} /> Take another photo
                </button>
              </div>
            </div>
          )}

          {/* General error */}
          {error && (
            <div className="error-box">
              <AlertTriangle size={16} /> {error}
            </div>
          )}
        </div>
      </div>

      {/* ── Result card ─────────────────────────────────────────────────────── */}
      {result && (
        <div className="card">
          <div className="card-header">
            <h3>Result</h3>
            {result.model_type && (
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 10,
                background: result.model_type === 'per_crop' ? 'var(--success)' : 'var(--text-secondary)',
                color: '#fff',
              }}>
                {result.model_type === 'per_crop' ? 'Specialized' : 'General'}
                {result.tta_augments_used > 0 && ` · TTA ×${result.tta_augments_used}`}
              </span>
            )}
          </div>

          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Status banner */}
            <div style={{
              borderRadius: 10, padding: 16,
              background: result.is_healthy ? '#16a34a15' : '#dc262615',
              border: `1px solid ${result.is_healthy ? '#16a34a40' : '#dc262640'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{
                  fontSize: 20, fontWeight: 800,
                  color: result.is_healthy ? 'var(--success)' : 'var(--danger)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {result.is_healthy
                    ? <><CheckCircle size={22} /> Healthy</>
                    : <><AlertTriangle size={22} /> {result.disease}</>
                  }
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Plant: <strong>{result.plant}</strong>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: confColor(result.confidence) }}>
                  {(result.confidence * 100).toFixed(0)}%
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>confidence</div>
              </div>
            </div>

            {/* Confidence bar */}
            <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3,
                width: `${result.confidence * 100}%`,
                background: confColor(result.confidence),
                transition: 'width 0.5s ease',
              }} />
            </div>

            {/* Treatment recommendations */}
            {result.treatment && !result.is_healthy && (
              <div style={{
                borderRadius: 10, padding: 14,
                background: 'var(--bg-secondary, #f8f9fa)',
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
                  💊 What to do now
                </div>

                {result.treatment.urgency && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span className={`badge ${['high','very_high','critical'].includes(result.treatment.urgency) ? 'high' : 'moderate'}`}>
                      {result.treatment.urgency} urgency
                    </span>
                    {result.treatment.action_days && (
                      <span style={{
                        fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                        background: result.treatment.action_days[0] <= 3 ? '#dc262620' : '#d9770620',
                        color:      result.treatment.action_days[0] <= 3 ? '#dc2626'   : '#d97706',
                        border:     `1px solid ${result.treatment.action_days[0] <= 3 ? '#dc262640' : '#d9770640'}`,
                      }}>
                        Act within {result.treatment.action_days[0]}–{result.treatment.action_days[1]} days
                      </span>
                    )}
                  </div>
                )}

                {result.treatment.fungicides?.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>Spray with:</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                      {result.treatment.fungicides.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}

                {result.treatment.cultural?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>Also do:</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                      {result.treatment.cultural.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Healthy message */}
            {result.is_healthy && (
              <div style={{
                borderRadius: 10, padding: 14, fontSize: 14, lineHeight: 1.5,
                background: '#16a34a12', border: '1px solid #16a34a30', color: '#15803d',
              }}>
                <strong>Your crop looks healthy!</strong> Keep monitoring weekly and
                maintain good field hygiene to prevent future infections.
              </div>
            )}

            <button className="btn btn-secondary" onClick={reset}
              style={{ justifyContent: 'center' }}>
              <Camera size={15} /> Scan Another Photo
            </button>
          </div>
        </div>
      )}

      {/* ── Advisory tips ───────────────────────────────────────────────────── */}
      {advisories.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>💡 Your Action Tips</h3>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {advisories.map((tip, i) => (
              <div key={i} style={{
                borderRadius: 8, padding: 12,
                background: 'var(--bg-secondary, #f8f9fa)',
                border: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  {tip.emoji && <span style={{ fontSize: 20, lineHeight: 1.2 }}>{tip.emoji}</span>}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{tip.title}</span>
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 10,
                        ...(priorityStyle[tip.priority] || {}),
                      }}>
                        {tip.priority}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                      {tip.message}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Scan history ────────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>
              <Clock size={15} style={{ verticalAlign: -2, marginRight: 5 }} />
              Recent Scans
            </h3>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{history.length}</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {history.map(h => {
              const isOpen = expandedId === h.id
              return (
                <div key={h.id}>
                  {/* Compact row */}
                  <div
                    onClick={() => setExpandedId(isOpen ? null : h.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 16px', cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      background: isOpen ? 'var(--bg-secondary, #f8f9fa)' : undefined,
                    }}
                  >
                    {h.image_url ? (
                      <img src={h.image_url} alt=""
                        style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 38, height: 38, background: 'var(--border)', borderRadius: 6, flexShrink: 0 }} />
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: 700, fontSize: 13,
                        color: h.is_healthy ? 'var(--success)' : 'var(--danger)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {h.is_healthy ? '✓ Healthy' : h.disease}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {h.plant} · {formatDate(h.created_at)}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: confColor(h.confidence) }}>
                        {(h.confidence * 100).toFixed(0)}%
                      </div>
                    </div>

                    {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>

                  {/* Expanded detail */}
                  {isOpen && (
                    <div style={{
                      padding: 14,
                      background: 'var(--bg-secondary, #f8f9fa)',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      {h.image_url && (
                        <img src={h.image_url} alt={h.plant}
                          style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />
                      )}
                      {h.treatment && !h.is_healthy && Object.keys(h.treatment).length > 0 && (
                        <div style={{ fontSize: 13 }}>
                          <div style={{ fontWeight: 700, marginBottom: 6 }}>💊 Treatment</div>
                          {h.treatment.fungicides?.length > 0 && (
                            <div style={{ marginBottom: 6 }}>
                              <strong>Spray: </strong>{h.treatment.fungicides.join(', ')}
                            </div>
                          )}
                          {h.treatment.cultural?.length > 0 && (
                            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                              {h.treatment.cultural.slice(0, 2).map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

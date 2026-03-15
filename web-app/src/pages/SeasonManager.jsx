/**
 * SeasonManager
 * -------------
 * Create, view, and manage agricultural seasons per farm.
 * Includes crop rotation history timeline with rotation quality scores.
 */
import { useEffect, useState } from 'react'
import { Calendar, Plus, Edit2, Trash2, RefreshCw, Leaf, AlertTriangle, ChevronDown } from 'lucide-react'
import {
  getFarms, getSeasonsForFarm, createSeason, updateSeason,
  deleteSeason, getCropRotationHistory, generateCropRotation,
} from '../api'

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  planning:  { label: 'Planning',  color: '#1976D2', bg: '#E3F2FD' },
  active:    { label: 'Active',    color: '#2E7D32', bg: '#E8F5E9' },
  completed: { label: 'Completed', color: '#6A1B9A', bg: '#F3E5F5' },
  cancelled: { label: 'Cancelled', color: '#B71C1C', bg: '#FFEBEE' },
}

const SCORE_COLOR = (s) => s >= 8 ? '#2E7D32' : s >= 5 ? '#F9A825' : '#C62828'
const CROPS = [
  'Maize', 'Beans', 'Soybean', 'Potato', 'Sweet Potato', 'Sorghum',
  'Cassava', 'Wheat', 'Rice', 'Groundnuts', 'Cowpeas', 'Other',
]
const STATUSES = ['planning', 'active', 'completed', 'cancelled']

const EMPTY_FORM = {
  name: '', year: new Date().getFullYear(), crop_type: 'Maize',
  planting_date: '', harvest_date: '', target_yield_tha: '',
  area_planted_ha: '', status: 'planning', notes: '',
}

const fmt = (n, d = 2) => (n != null ? Number(n).toFixed(d) : '—')

// ─── component ───────────────────────────────────────────────────────────────

export default function SeasonManager() {
  const [farms, setFarms]               = useState([])
  const [farmId, setFarmId]             = useState(null)
  const [seasons, setSeasons]           = useState([])
  const [rotation, setRotation]         = useState([])
  const [loading, setLoading]           = useState(false)
  const [rotLoading, setRotLoading]     = useState(false)

  // Modal
  const [showModal, setShowModal]       = useState(false)
  const [editingSeason, setEditingSeason] = useState(null)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState(null)

  // Load farms
  useEffect(() => {
    getFarms()
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : res.data.farms || []
        setFarms(list)
        if (list.length) setFarmId(list[0].id)
      })
      .catch(console.error)
  }, [])

  // Load seasons + rotation when farm changes
  useEffect(() => {
    if (!farmId) return
    setLoading(true)
    Promise.allSettled([
      getSeasonsForFarm(farmId),
      getCropRotationHistory(farmId),
    ]).then(([s, r]) => {
      setSeasons(s.status === 'fulfilled' ? (s.value.data.seasons || []) : [])
      setRotation(r.status === 'fulfilled' ? (r.value.data.history || []) : [])
    }).finally(() => setLoading(false))
  }, [farmId])

  const openCreate = () => { setEditingSeason(null); setForm(EMPTY_FORM); setError(null); setShowModal(true) }
  const openEdit = (s) => {
    setEditingSeason(s)
    setForm({
      name: s.name, year: s.year, crop_type: s.crop_type,
      planting_date: s.planting_date || '', harvest_date: s.harvest_date || '',
      target_yield_tha: s.target_yield_tha || '', area_planted_ha: s.area_planted_ha || '',
      status: s.status, notes: s.notes || '',
    })
    setError(null)
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.crop_type) { setError('Name and crop type are required'); return }
    setSaving(true); setError(null)
    try {
      const payload = {
        ...form,
        year: Number(form.year),
        target_yield_tha: form.target_yield_tha ? Number(form.target_yield_tha) : null,
        area_planted_ha: form.area_planted_ha ? Number(form.area_planted_ha) : null,
        planting_date: form.planting_date || null,
        harvest_date: form.harvest_date || null,
      }
      if (editingSeason) {
        await updateSeason(editingSeason.id, payload)
      } else {
        await createSeason(farmId, payload)
      }
      setShowModal(false)
      // Reload
      const [s, r] = await Promise.all([getSeasonsForFarm(farmId), getCropRotationHistory(farmId)])
      setSeasons(s.data.seasons || [])
      setRotation(r.data.history || [])
    } catch (e) {
      setError(e?.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (seasonId) => {
    if (!window.confirm('Delete this season?')) return
    await deleteSeason(seasonId)
    setSeasons(prev => prev.filter(s => s.id !== seasonId))
    setRotation(prev => prev.filter(r => r.season_id !== seasonId))
  }

  const handleGenerateRotation = async (seasonId) => {
    setRotLoading(true)
    try {
      await generateCropRotation(seasonId)
      const r = await getCropRotationHistory(farmId)
      setRotation(r.data.history || [])
    } catch (e) {
      console.error(e)
    } finally {
      setRotLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Calendar size={22} color="var(--primary)" />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Season Management</h1>
        </div>
        <button
          onClick={openCreate}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', background: 'var(--primary)', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Plus size={14} /> New Season
        </button>
      </div>

      {/* Farm selector */}
      <div style={{ marginBottom: 20 }}>
        <label style={LABEL_STYLE}>Farm</label>
        <div style={{ position: 'relative', display: 'inline-block', marginTop: 4 }}>
          <select
            value={farmId || ''}
            onChange={e => setFarmId(Number(e.target.value))}
            style={{ ...FIELD_STYLE, minWidth: 220, paddingRight: 32 }}
          >
            {farms.map(f => <option key={f.id} value={f.id}>{f.name || `Farm #${f.id}`}</option>)}
          </select>
          <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8' }} />
        </div>
      </div>

      {loading && <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading seasons…</div>}

      {/* Season grid */}
      {seasons.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
          {seasons.map(s => {
            const badge = STATUS_BADGE[s.status] || STATUS_BADGE.planning
            return (
              <div key={s.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{s.year} · {s.crop_type}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, color: badge.color, background: badge.bg }}>
                    {badge.label}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                  <StatItem label="Planted" value={s.planting_date || '—'} />
                  <StatItem label="Harvest" value={s.harvest_date || '—'} />
                  <StatItem label="Target Yield" value={s.target_yield_tha ? `${s.target_yield_tha} t/ha` : '—'} />
                  <StatItem label="Area" value={s.area_planted_ha ? `${s.area_planted_ha} ha` : '—'} />
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => handleGenerateRotation(s.id)} title="Refresh rotation analysis"
                    style={{ ...BTN_GHOST, flex: 1 }}>
                    <RefreshCw size={11} /> Rotation
                  </button>
                  <button onClick={() => openEdit(s)} style={{ ...BTN_GHOST }}>
                    <Edit2 size={11} />
                  </button>
                  <button onClick={() => handleDelete(s.id)} style={{ ...BTN_GHOST, color: '#C62828' }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && seasons.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-secondary)' }}>
          <Calendar size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div>No seasons recorded for this farm.</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Click <b>New Season</b> to get started.</div>
        </div>
      )}

      {/* Crop Rotation Timeline */}
      {rotation.length > 0 && (
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Leaf size={16} color="var(--primary)" /> Crop Rotation History
            {rotLoading && <span className="spinner" style={{ width: 14, height: 14 }} />}
          </h2>
          <div style={{ position: 'relative', paddingLeft: 32 }}>
            {/* timeline vertical line */}
            <div style={{ position: 'absolute', left: 10, top: 8, bottom: 8, width: 2, background: 'var(--border)' }} />

            {rotation.map((r, i) => {
              const score = r.rotation_score || 0
              const color = SCORE_COLOR(score)
              return (
                <div key={i} style={{ position: 'relative', marginBottom: 20 }}>
                  <div style={{ position: 'absolute', left: -26, top: 4, width: 14, height: 14, borderRadius: '50%', background: color, border: '2px solid var(--bg-card)' }} />
                  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{r.crop_type}</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12, marginLeft: 8 }}>{r.year} · {r.name}</span>
                        {r.is_nitrogen_fixer && (
                          <span style={{ marginLeft: 6, fontSize: 10, background: '#E8F5E9', color: '#2E7D32', borderRadius: 99, padding: '1px 6px', fontWeight: 600 }}>N-Fixer</span>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{score.toFixed(1)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>/ 10</div>
                      </div>
                    </div>
                    {r.previous_crop && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        After: <b>{r.previous_crop}</b>
                        {r.next_recommendation && <> → Next: <b style={{ color: '#1976D2' }}>{r.next_recommendation}</b></>}
                      </div>
                    )}
                    {score < 4 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: '#B71C1C' }}>
                        <AlertTriangle size={11} /> Repeated crop — yield decline risk
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 28, width: 440, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700 }}>
              {editingSeason ? 'Edit Season' : 'New Season'}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Season Name *" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} placeholder="Season A 2026" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Year *" type="number" value={form.year} onChange={v => setForm(p => ({ ...p, year: v }))} />
                <div>
                  <label style={LABEL_STYLE}>Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} style={{ ...FIELD_STYLE, marginTop: 4 }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={LABEL_STYLE}>Crop Type *</label>
                <select value={form.crop_type} onChange={e => setForm(p => ({ ...p, crop_type: e.target.value }))} style={{ ...FIELD_STYLE, marginTop: 4 }}>
                  {CROPS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Planting Date" type="date" value={form.planting_date} onChange={v => setForm(p => ({ ...p, planting_date: v }))} />
                <Field label="Harvest Date" type="date" value={form.harvest_date} onChange={v => setForm(p => ({ ...p, harvest_date: v }))} />
                <Field label="Target Yield (t/ha)" type="number" value={form.target_yield_tha} onChange={v => setForm(p => ({ ...p, target_yield_tha: v }))} placeholder="3.5" />
                <Field label="Area Planted (ha)" type="number" value={form.area_planted_ha} onChange={v => setForm(p => ({ ...p, area_planted_ha: v }))} placeholder="1.5" />
              </div>
              <Field label="Notes" value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Optional notes…" />
            </div>

            {error && <div style={{ color: '#C62828', fontSize: 12, marginTop: 10 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 1, padding: '10px 0', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Saving…' : editingSeason ? 'Update' : 'Create'}
              </button>
              <button onClick={() => setShowModal(false)}
                style={{ padding: '10px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── micro-components ─────────────────────────────────────────────────────────

function StatItem({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginTop: 1 }}>{value}</div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div>
      <label style={LABEL_STYLE}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...FIELD_STYLE, marginTop: 4 }}
      />
    </div>
  )
}

// ─── styles ──────────────────────────────────────────────────────────────────

const LABEL_STYLE = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }
const FIELD_STYLE = { width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' }
const BTN_GHOST   = { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }

import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateProfile } from '../api'
import { User, Save, Shield, Clock, CheckCircle, XCircle, MapPin } from 'lucide-react'
import LOCATIONS from '../data/locations.json'

const ROLE_BADGE = {
    admin: { label: 'Admin', color: '#D32F2F', bg: '#FFEBEE' },
    agronomist: { label: 'Agronomist', color: '#0288D1', bg: '#E1F5FE' },
    farmer: { label: 'Farmer', color: '#2E7D32', bg: '#E8F5E9' },
}

const REQUESTABLE_ROLES = [
    { value: 'agronomist', label: 'Agronomist', desc: 'Monitor farms in your district, access risk assessments and disease forecasts' },
    { value: 'admin', label: 'Administrator', desc: 'Full system access including user management' },
]

/* ── localStorage helpers for role applications ── */
function getRoleApplications() {
    try { return JSON.parse(localStorage.getItem('role_applications') || '[]') }
    catch { return [] }
}
function saveRoleApplications(apps) {
    localStorage.setItem('role_applications', JSON.stringify(apps))
}

export default function Profile() {
    const { user, logout } = useAuth()
    const badge = ROLE_BADGE[user?.role] || ROLE_BADGE.farmer

    /* ── Profile editing state ── */
    const [editing, setEditing] = useState(false)
    const [form, setForm] = useState({ full_name: '', phone: '', district: '' })
    const [selectedProvince, setSelectedProvince] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveMsg, setSaveMsg] = useState('')

    /* ── Role application state ── */
    const [myApp, setMyApp] = useState(null)
    const [requestedRole, setRequestedRole] = useState('agronomist')
    const [applyMsg, setApplyMsg] = useState('')

    const provinces = LOCATIONS?.provinces || []

    const districts = selectedProvince
        ? provinces.find(p => p.name === selectedProvince)?.districts || []
        : []

    /* Determine if profile is incomplete */
    const isProfileIncomplete = !user?.phone || !user?.district

    useEffect(() => {
        if (user) {
            setForm({
                full_name: user.full_name || '',
                phone: user.phone || '',
                district: user.district || '',
            })
            // try to match province from district
            if (user.district) {
                for (const p of provinces) {
                    if (p.districts?.some(d => d.name === user.district)) {
                        setSelectedProvince(p.name)
                        break
                    }
                }
            }
        }
        // Load existing application for this user
        const apps = getRoleApplications()
        const mine = apps.find(a => a.userId === user?.id && a.status === 'pending')
        setMyApp(mine || null)
    }, [user]) // eslint-disable-line

    const handleSave = async () => {
        setSaving(true)
        setSaveMsg('')
        try {
            await updateProfile({
                full_name: form.full_name || undefined,
                phone: form.phone || undefined,
                district: form.district || undefined,
            })
            setSaveMsg('Profile updated successfully!')
            setEditing(false)
            // Reload after a moment
            setTimeout(() => window.location.reload(), 1200)
        } catch (err) {
            setSaveMsg(err.response?.data?.detail || 'Failed to update profile')
        } finally {
            setSaving(false)
        }
    }

    const handleApplyRole = () => {
        if (!requestedRole || requestedRole === user?.role) return
        const apps = getRoleApplications()
        // Remove any existing pending app for this user
        const filtered = apps.filter(a => !(a.userId === user.id && a.status === 'pending'))
        const newApp = {
            userId: user.id,
            username: user.username,
            fullName: user.full_name,
            currentRole: user.role,
            requestedRole,
            status: 'pending',
            timestamp: new Date().toISOString(),
        }
        filtered.push(newApp)
        saveRoleApplications(filtered)
        setMyApp(newApp)
        setApplyMsg('Your role application has been submitted! An admin will review it shortly.')
    }

    const handleProvinceChange = (e) => {
        setSelectedProvince(e.target.value)
        setForm(prev => ({ ...prev, district: '' }))
    }

    return (
        <div className="profile-page">
            {/* Profile Completion Banner */}
            {isProfileIncomplete && (
                <div className="profile-completion-banner">
                    <MapPin size={20} />
                    <div>
                        <strong>Complete your profile</strong>
                        <p>Add your phone number and district to get the most out of the platform.</p>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
                        Complete Now
                    </button>
                </div>
            )}

            {/* User Info Card */}
            <div className="profile-card">
                <div className="profile-card-header">
                    <div className="profile-avatar-lg">
                        {(user?.full_name || user?.username || '?')[0].toUpperCase()}
                    </div>
                    <div className="profile-header-info">
                        <h2>{user?.full_name || user?.username}</h2>
                        <span className="profile-username">@{user?.username}</span>
                        <span className="profile-role-badge" style={{ background: badge.bg, color: badge.color }}>
                            {badge.label}
                        </span>
                    </div>
                </div>

                <div className="profile-card-body">
                    {saveMsg && (
                        <div className={`profile-msg ${saveMsg.includes('success') ? 'success' : 'error'}`}>
                            {saveMsg}
                        </div>
                    )}

                    {editing ? (
                        <div className="profile-edit-form">
                            <div className="form-group">
                                <label>Full Name</label>
                                <input value={form.full_name}
                                    onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))}
                                    placeholder="Your full name" />
                            </div>
                            <div className="form-group">
                                <label>Phone</label>
                                <input value={form.phone}
                                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                                    placeholder="+250 78X XXX XXX" />
                            </div>
                            <div className="profile-edit-row">
                                <div className="form-group">
                                    <label>Province</label>
                                    <select value={selectedProvince} onChange={handleProvinceChange}>
                                        <option value="">Select Province</option>
                                        {provinces.map(p => (
                                            <option key={p.name} value={p.name}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>District</label>
                                    <select value={form.district}
                                        onChange={e => setForm(p => ({ ...p, district: e.target.value }))}
                                        disabled={!selectedProvince}>
                                        <option value="">Select District</option>
                                        {districts.map(d => (
                                            <option key={d.name} value={d.name}>{d.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="profile-edit-actions">
                                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                    <Save size={16} />
                                    {saving ? 'Saving…' : 'Save Changes'}
                                </button>
                                <button className="btn btn-secondary" onClick={() => setEditing(false)}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="profile-info-grid">
                            <div className="profile-info-item">
                                <span className="profile-info-label">Full Name</span>
                                <span className="profile-info-value">{user?.full_name || '—'}</span>
                            </div>
                            <div className="profile-info-item">
                                <span className="profile-info-label">Username</span>
                                <span className="profile-info-value">@{user?.username}</span>
                            </div>
                            <div className="profile-info-item">
                                <span className="profile-info-label">Phone</span>
                                <span className="profile-info-value">{user?.phone || '—'}</span>
                            </div>
                            <div className="profile-info-item">
                                <span className="profile-info-label">District</span>
                                <span className="profile-info-value">{user?.district || '—'}</span>
                            </div>
                            <div className="profile-info-item">
                                <span className="profile-info-label">Role</span>
                                <span className="profile-info-value">
                                    <span className="profile-role-badge" style={{ background: badge.bg, color: badge.color }}>
                                        {badge.label}
                                    </span>
                                </span>
                            </div>
                            <div className="profile-info-item">
                                <span className="profile-info-label">Member Since</span>
                                <span className="profile-info-value">
                                    {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                                </span>
                            </div>
                            <button className="btn btn-secondary" onClick={() => setEditing(true)} style={{ marginTop: 8 }}>
                                <User size={16} /> Edit Profile
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Role Application Card */}
            {user?.role !== 'admin' && (
                <div className="profile-card">
                    <div className="profile-card-section-header">
                        <Shield size={20} />
                        <h3>Apply for a New Role</h3>
                    </div>
                    <div className="profile-card-body">
                        {applyMsg && (
                            <div className="profile-msg success">{applyMsg}</div>
                        )}

                        {myApp ? (
                            <div className="role-app-status">
                                <div className="role-app-status-icon pending">
                                    <Clock size={24} />
                                </div>
                                <div>
                                    <h4>Application Pending</h4>
                                    <p>You've applied for <strong>{myApp.requestedRole}</strong> role.</p>
                                    <span className="role-app-date">
                                        Submitted {new Date(myApp.timestamp).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p className="profile-section-desc">
                                    Request an upgrade to access additional features and tools.
                                </p>
                                <div className="role-request-options">
                                    {REQUESTABLE_ROLES
                                        .filter(r => r.value !== user?.role)
                                        .map(r => (
                                            <label key={r.value}
                                                className={`role-request-option ${requestedRole === r.value ? 'selected' : ''}`}>
                                                <input type="radio" name="requestedRole" value={r.value}
                                                    checked={requestedRole === r.value}
                                                    onChange={e => setRequestedRole(e.target.value)} />
                                                <div>
                                                    <span className="role-request-label">{r.label}</span>
                                                    <span className="role-request-desc">{r.desc}</span>
                                                </div>
                                            </label>
                                        ))}
                                </div>
                                <button className="btn btn-primary" onClick={handleApplyRole} style={{ marginTop: 16 }}>
                                    <Shield size={16} /> Submit Application
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Sign Out */}
            <button className="btn btn-danger" onClick={logout} style={{ marginTop: 8 }}>
                Sign Out
            </button>
        </div>
    )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTitle } from '../context/TitleContext'
import { useLanguage } from '../context/LanguageContext'
import { updateProfile } from '../api'
import { User, Save, Shield, Clock, MapPin, CheckCircle, XCircle } from 'lucide-react'
import LOCATIONS from '../data/locations.json'
import './Profile.css'

const ROLE_BADGE = {
    admin: { label: 'Admin', color: '#ff6b6b', bg: 'rgba(255, 107, 107, 0.15)' },
    agronomist: { label: 'Agronomist', color: '#4ecdc4', bg: 'rgba(78, 205, 196, 0.15)' },
    farmer: { label: 'Farmer', color: '#34a853', bg: 'rgba(52, 168, 83, 0.15)' },
}

const REQUESTABLE_ROLES = [
    { value: 'agronomist', label: 'Agronomist', desc: 'Monitor farms in your district, access risk assessments' },
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
    const { setTitle } = useTitle()
    const { t } = useLanguage()
    const navigate = useNavigate()
    const badge = ROLE_BADGE[user?.role] || ROLE_BADGE.farmer

    useEffect(() => {
        setTitle(t('nav.more')) // Profile is accessed from More usually, or just leave as Profile logic
    }, [setTitle, t])

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

    const isProfileIncomplete = !user?.phone || !user?.district

    useEffect(() => {
        if (user) {
            setForm({
                full_name: user.full_name || '',
                phone: user.phone || '',
                district: user.district || '',
            })
            if (user.district) {
                for (const p of provinces) {
                    if (p.districts?.some(d => d.name === user.district)) {
                        setSelectedProvince(p.name)
                        break
                    }
                }
            }
        }
        const apps = getRoleApplications()
        const mine = apps.find(a => a.userId === user?.id && a.status === 'pending')
        setMyApp(mine || null)
    }, [user, provinces])

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

    const handleLogout = () => {
        logout()
        navigate('/login')
    }

    return (
        <div className="mobile-profile-page fade-in">
            {isProfileIncomplete && (
                <div className="profile-banner">
                    <MapPin size={20} className="profile-banner-icon" />
                    <div className="profile-banner-text">
                        <strong>{t('profile.banner.title')}</strong>
                        <p>{t('profile.banner.desc')}</p>
                    </div>
                    <button className="profile-btn profile-btn-sm" onClick={() => setEditing(true)}>
                        {t('profile.banner.btn')}
                    </button>
                </div>
            )}

            <div className="profile-card">
                <div className="profile-header">
                    <div className="profile-avatar">
                        {(user?.full_name || user?.username || '?')[0].toUpperCase()}
                    </div>
                    <div className="profile-title">
                        <h2>{user?.full_name || user?.username}</h2>
                        <span>@{user?.username}</span>
                        <div className="profile-badge" style={{ background: badge.bg, color: badge.color }}>
                            {t(`role.${user?.role}`)}
                        </div>
                    </div>
                </div>

                <div className="profile-body">
                    {saveMsg && (
                        <div className={`profile-msg ${saveMsg.includes('success') ? 'success' : 'error'}`}>
                            {saveMsg}
                        </div>
                    )}

                    {editing ? (
                        <div className="profile-edit">
                            <div className="profile-field">
                                <label>{t('auth.fullname')}</label>
                                <input value={form.full_name}
                                    onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))}
                                    placeholder={t('auth.fullname.placeholder')} />
                            </div>
                            <div className="profile-field">
                                <label>{t('profile.field.phone')}</label>
                                <input value={form.phone}
                                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                                    placeholder={t('profile.field.phone.placeholder')} />
                            </div>
                            <div className="profile-field">
                                <label>{t('profile.field.province')}</label>
                                <select value={selectedProvince} onChange={handleProvinceChange}>
                                    <option value="">{t('profile.select.province')}</option>
                                    {provinces.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                                </select>
                            </div>
                            <div className="profile-field">
                                <label>{t('profile.field.district')}</label>
                                <select value={form.district}
                                    onChange={e => setForm(p => ({ ...p, district: e.target.value }))}
                                    disabled={!selectedProvince}>
                                    <option value="">{t('profile.select.district')}</option>
                                    {districts.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                                </select>
                            </div>
                            <div className="profile-actions">
                                <button className="profile-btn profile-btn-primary" onClick={handleSave} disabled={saving}>
                                    <Save size={16} /> {saving ? t('loading') : t('btn.save')}
                                </button>
                                <button className="profile-btn profile-btn-secondary" onClick={() => setEditing(false)}>
                                    {t('btn.cancel')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="profile-info">
                            <div className="profile-info-item">
                                <label>{t('auth.fullname')}</label>
                                <span>{user?.full_name || '—'}</span>
                            </div>
                            <div className="profile-info-item">
                                <label>{t('profile.field.phone')}</label>
                                <span>{user?.phone || '—'}</span>
                            </div>
                            <div className="profile-info-item">
                                <label>{t('profile.field.district')}</label>
                                <span>{user?.district || '—'}</span>
                            </div>
                            <button className="profile-btn profile-btn-secondary profile-btn-block" onClick={() => setEditing(true)}>
                                <User size={16} /> {t('profile.edit.title')}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {user?.role !== 'admin' && (
                <div className="profile-card">
                    <div className="profile-section-header">
                        <Shield size={18} className="text-primary" />
                        <h3>{t('profile.role.title')}</h3>
                    </div>
                    <div className="profile-body">
                        {applyMsg && <div className="profile-msg success">{applyMsg}</div>}

                        {myApp ? (
                            <div className="profile-app-status">
                                <Clock size={20} className="text-warning" />
                                <div>
                                    <h4>{t('profile.role.pending')}</h4>
                                    <p>{t('profile.role.requested')}: {t(`role.${myApp.requestedRole}`)}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="profile-role-form">
                                <p className="profile-desc">{t('profile.role.desc')}</p>
                                <div className="profile-radios">
                                    {REQUESTABLE_ROLES.filter(r => r.value !== user?.role).map(r => (
                                        <label key={r.value} className={`profile-radio ${requestedRole === r.value ? 'selected' : ''}`}>
                                            <input type="radio" name="requestedRole" value={r.value}
                                                checked={requestedRole === r.value}
                                                onChange={e => setRequestedRole(e.target.value)} />
                                            <div>
                                                <strong>{t(`role.${r.value}`)}</strong>
                                                <small>{t(`role.desc.${r.value}`)}</small>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                                <button className="profile-btn profile-btn-primary profile-btn-block" onClick={handleApplyRole}>
                                    {t('btn.submit')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <button className="profile-btn profile-btn-danger profile-btn-block" onClick={handleLogout} style={{ marginBottom: 24 }}>
                {t('profile.signout')}
            </button>
        </div>
    )
}

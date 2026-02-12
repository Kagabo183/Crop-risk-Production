import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LOCATIONS from '../data/locations.json'
import './Auth.css'

const ROLES = [
    { value: 'farmer', label: '🌱 Farmer', desc: 'Manage your own farms and view crop health' },
    { value: 'agronomist', label: '🔬 Agronomist', desc: 'Monitor farms in your district' },
    { value: 'viewer', label: '📊 Viewer', desc: 'Read-only access to dashboards and reports' },
]

export default function Register() {
    const navigate = useNavigate()
    const { register } = useAuth()
    const [form, setForm] = useState({
        email: '', password: '', confirmPassword: '',
        full_name: '', role: 'farmer', phone: '', district: '',
    })
    const [selectedProvince, setSelectedProvince] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)

    // Derived state for districts
    const provinces = LOCATIONS?.provinces || []

    if (!provinces.length) {
        return <div style={{ padding: 20, color: 'red' }}>Error: Could not load location data. Please contact support.</div>
    }

    const districts = selectedProvince
        ? provinces.find(p => p.name === selectedProvince)?.districts || []
        : []

    const handleChange = (e) => {
        setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    }

    const handleProvinceChange = (e) => {
        const prov = e.target.value
        setSelectedProvince(prov)
        setForm(prev => ({ ...prev, district: '' })) // reset district
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')

        if (form.password !== form.confirmPassword) {
            setError('Passwords do not match')
            return
        }
        if (form.password.length < 6) {
            setError('Password must be at least 6 characters')
            return
        }
        if (!form.district) {
            setError('Please select a district.')
            return
        }

        setLoading(true)
        try {
            await register({
                email: form.email,
                password: form.password,
                full_name: form.full_name,
                role: form.role,
                phone: form.phone || null,
                district: form.district,
            })
            setSuccess(true)
            setTimeout(() => navigate('/login'), 2000)
        } catch (err) {
            setError(err.response?.data?.detail || 'Registration failed.')
        } finally {
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="auth-page">
                <div className="auth-card">
                    <div className="auth-header">
                        <div className="auth-logo"><span className="auth-logo-icon">✅</span></div>
                        <h1>Account Created!</h1>
                        <p>Redirecting to login...</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="auth-page">
            <div className="auth-card auth-card--wide">
                <div className="auth-header">
                    <div className="auth-logo"><span className="auth-logo-icon">🌾</span></div>
                    <h1>Join Crop Risk Platform</h1>
                    <p>Create your account to start monitoring</p>
                </div>

                <form onSubmit={handleSubmit} className="auth-form">
                    {error && <div className="auth-error">{error}</div>}

                    <div className="auth-row">
                        <div className="auth-field">
                            <label htmlFor="full_name">Full Name *</label>
                            <input id="full_name" name="full_name" value={form.full_name}
                                onChange={handleChange} placeholder="Jean Baptiste" required />
                        </div>
                        <div className="auth-field">
                            <label htmlFor="email">Email *</label>
                            <input id="email" name="email" type="email" value={form.email}
                                onChange={handleChange} placeholder="you@example.com" required />
                        </div>
                    </div>

                    <div className="auth-row">
                        <div className="auth-field">
                            <label htmlFor="password">Password *</label>
                            <input id="password" name="password" type="password" value={form.password}
                                onChange={handleChange} placeholder="Min 6 characters" required />
                        </div>
                        <div className="auth-field">
                            <label htmlFor="confirmPassword">Confirm Password *</label>
                            <input id="confirmPassword" name="confirmPassword" type="password"
                                value={form.confirmPassword} onChange={handleChange} placeholder="••••••••" required />
                        </div>
                    </div>

                    <div className="auth-row">
                        <div className="auth-field">
                            <label htmlFor="phone">Phone (optional)</label>
                            <input id="phone" name="phone" value={form.phone}
                                onChange={handleChange} placeholder="+250 78X XXX XXX" />
                        </div>
                    </div>

                    <div className="auth-row">
                        <div className="auth-field">
                            <label>Province *</label>
                            <select
                                className="auth-select"
                                value={selectedProvince}
                                onChange={handleProvinceChange}
                                required
                            >
                                <option value="">Select Province</option>
                                {provinces.map(p => (
                                    <option key={p.name} value={p.name}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="auth-field">
                            <label htmlFor="district">District *</label>
                            <select
                                id="district"
                                name="district"
                                className="auth-select"
                                value={form.district}
                                onChange={handleChange}
                                required
                                disabled={!selectedProvince}
                            >
                                <option value="">Select District</option>
                                {districts.map(d => (
                                    <option key={d.name} value={d.name}>{d.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="auth-field">
                        <label>Select Your Role</label>
                        <div className="role-selector">
                            {ROLES.map(r => (
                                <label key={r.value}
                                    className={`role-option ${form.role === r.value ? 'role-option--active' : ''}`}>
                                    <input type="radio" name="role" value={r.value}
                                        checked={form.role === r.value} onChange={handleChange} />
                                    <div className="role-content">
                                        <span className="role-label">{r.label}</span>
                                        <span className="role-desc">{r.desc}</span>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    <button type="submit" className="auth-btn" disabled={loading}>
                        {loading ? 'Creating account...' : 'Create Account'}
                    </button>

                    <p className="auth-switch">
                        Already have an account? <Link to="/login">Sign in</Link>
                    </p>
                </form>
            </div>
        </div>
    )
}

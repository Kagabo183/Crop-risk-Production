import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff } from 'lucide-react'
import LOCATIONS from '../data/locations.json'
import './Auth.css'

const ROLES = [
    { value: 'farmer', label: '🌱 Farmer', desc: 'Manage your own farms and view crop health' },
    { value: 'agronomist', label: '🔬 Agronomist', desc: 'Monitor farms in your district' },
]

export default function Register() {
    const navigate = useNavigate()
    const { register } = useAuth()
    const [form, setForm] = useState({
        username: '', pin: '', confirmPin: '',
        full_name: '', role: 'farmer', phone: '', district: '',
    })
    const [selectedProvince, setSelectedProvince] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)

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

        if (form.pin !== form.confirmPin) {
            setError('PINs do not match')
            return
        }
        if (form.pin.length !== 5 || !/^\d{5}$/.test(form.pin)) {
            setError('PIN must be exactly 5 digits')
            return
        }
        if (!form.district) {
            setError('Please select a district.')
            return
        }

        setLoading(true)
        try {
            await register({
                username: form.username,
                password: form.pin,
                full_name: form.full_name,
                role: form.role,
                phone: form.phone || null,
                district: form.district,
            })
            setSuccess(true)
            setTimeout(() => navigate('/login'), 2000)
        } catch (err) {
            console.error('Registration error:', err)
            setError(err.response?.data?.detail || err.message || 'Registration failed.')
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
                            <label htmlFor="username">Username *</label>
                            <input id="username" name="username" type="text" value={form.username}
                                onChange={handleChange} placeholder="johndoe" required />
                        </div>
                    </div>

                    <div className="auth-row">
                        <div className="auth-field">
                            <label htmlFor="pin">5-Digit PIN *</label>
                            <div className="password-wrapper">
                                <input id="pin" name="pin" type={showPassword ? 'text' : 'password'} value={form.pin}
                                    onChange={handleChange} placeholder="5 digits" 
                                    pattern="\d{5}" maxLength="5" inputMode="numeric" required />
                                <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>
                        <div className="auth-field">
                            <label htmlFor="confirmPin">Confirm PIN *</label>
                            <div className="password-wrapper">
                                <input id="confirmPin" name="confirmPin" type={showConfirm ? 'text' : 'password'}
                                    value={form.confirmPin} onChange={handleChange} placeholder="Repeat PIN" 
                                    pattern="\d{5}" maxLength="5" inputMode="numeric" required />
                                <button type="button" className="password-toggle" onClick={() => setShowConfirm(!showConfirm)} tabIndex={-1}>
                                    {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
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

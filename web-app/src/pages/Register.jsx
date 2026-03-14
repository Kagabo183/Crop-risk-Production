import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff } from 'lucide-react'
import './Auth.css'

export default function Register() {
    const navigate = useNavigate()
    const { register } = useAuth()
    const [form, setForm] = useState({
        full_name: '', username: '', pin: '', confirmPin: '',
    })
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)

    const handleChange = (e) => {
        setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')

        if (form.pin !== form.confirmPin) {
            setError('PINs do not match')
            return
        }
        if (form.pin.length !== 5 || !/^\d{5}$/.test(form.pin)) {
            setError('Password must be exactly 5 digits')
            return
        }

        setLoading(true)
        try {
            await register({
                username: form.username,
                password: form.pin,
                full_name: form.full_name,
                role: 'farmer',
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
                        <p>Redirecting to login…</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-header">
                    <div className="auth-logo"><span className="auth-logo-icon">🌾</span></div>
                    <h1>Join Crop Risk Platform</h1>
                    <p>Create your account to start monitoring</p>
                </div>

                <form onSubmit={handleSubmit} className="auth-form">
                    {error && <div className="auth-error">{error}</div>}

                    <div className="auth-field">
                        <label htmlFor="full_name">Full Name</label>
                        <input id="full_name" name="full_name" value={form.full_name}
                            onChange={handleChange} placeholder="Jean Baptiste" required autoFocus />
                    </div>

                    <div className="auth-field">
                        <label htmlFor="username">Username</label>
                        <input id="username" name="username" type="text" value={form.username}
                            onChange={handleChange} placeholder="johndoe" required />
                    </div>

                    <div className="auth-row">
                        <div className="auth-field">
                            <label htmlFor="pin">5-Digit PIN</label>
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
                            <label htmlFor="confirmPin">Confirm PIN</label>
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

                    <button type="submit" className="auth-btn" disabled={loading}>
                        {loading ? 'Creating account…' : 'Create Account'}
                    </button>

                    <p className="auth-switch">
                        Already have an account? <Link to="/login">Sign in</Link>
                    </p>
                </form>
            </div>
        </div>
    )
}

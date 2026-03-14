import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { Eye, EyeOff } from 'lucide-react'
import './Auth.css'

export default function Register() {
    const navigate = useNavigate()
    const { register } = useAuth()
    const { t } = useLanguage()
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
                        <h1>{t('auth.register.title')}</h1>
                        <p>{t('auth.register.creating')}</p>
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
                    <h1>{t('app.title')}</h1>
                    <p>{t('app.subtitle')}</p>
                </div>

                <form onSubmit={handleSubmit} className="auth-form">
                    {error && <div className="auth-error">{error}</div>}

                    <div className="auth-field">
                        <label htmlFor="full_name">{t('auth.fullname')}</label>
                        <input id="full_name" name="full_name" value={form.full_name}
                            onChange={handleChange} placeholder={t('auth.fullname.placeholder')} required autoFocus />
                    </div>

                    <div className="auth-field">
                        <label htmlFor="username">{t('auth.username')}</label>
                        <input id="username" name="username" type="text" value={form.username}
                            onChange={handleChange} placeholder={t('auth.username.placeholder')} required />
                    </div>

                    <div className="auth-row">
                        <div className="auth-field">
                            <label htmlFor="pin">{t('auth.pin')}</label>
                            <div className="password-wrapper">
                                <input id="pin" name="pin" type={showPassword ? 'text' : 'password'} value={form.pin}
                                    onChange={handleChange} placeholder={t('auth.pin.placeholder')}
                                    pattern="\d{5}" maxLength="5" inputMode="numeric" required />
                                <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>
                        <div className="auth-field">
                            <label htmlFor="confirmPin">{t('auth.pin.confirm')}</label>
                            <div className="password-wrapper">
                                <input id="confirmPin" name="confirmPin" type={showConfirm ? 'text' : 'password'}
                                    value={form.confirmPin} onChange={handleChange} placeholder={t('auth.pin.placeholder')}
                                    pattern="\d{5}" maxLength="5" inputMode="numeric" required />
                                <button type="button" className="password-toggle" onClick={() => setShowConfirm(!showConfirm)} tabIndex={-1}>
                                    {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>
                    </div>

                    <button type="submit" className="auth-btn" disabled={loading}>
                        {loading ? t('auth.register.creating') : t('auth.register.btn')}
                    </button>

                    <p className="auth-switch">
                        {t('auth.register.has_account')} <Link to="/login">{t('auth.register.sign_in')}</Link>
                    </p>
                </form>
            </div>
        </div>
    )
}

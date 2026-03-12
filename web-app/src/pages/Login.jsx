import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff } from 'lucide-react'
import './Auth.css'

export default function Login() {
    const [username, setUsername] = useState('')
    const [pin, setPin] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const { login } = useAuth()
    const navigate = useNavigate()

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            await login(username, pin)
            navigate('/')
        } catch (err) {
            setError(err.response?.data?.detail || 'Login failed. Please check your credentials.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-header">
                    <div className="auth-logo">
                        <span className="auth-logo-icon">🌾</span>
                    </div>
                    <h1>Crop Risk Platform</h1>
                    <p>Rwanda Agricultural Monitoring System</p>
                </div>

                <form onSubmit={handleSubmit} className="auth-form">
                    <h2>Sign In</h2>

                    {error && <div className="auth-error">{error}</div>}

                    <div className="auth-field">
                        <label htmlFor="username">Username</label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="e.g. johndoe"
                            required
                            autoFocus
                        />
                    </div>

                    <div className="auth-field">
                        <label htmlFor="pin">5-Digit PIN</label>
                        <div className="password-wrapper">
                            <input
                                id="pin"
                                type={showPassword ? 'text' : 'password'}
                                value={pin}
                                onChange={(e) => setPin(e.target.value)}
                                placeholder="•••••"
                                pattern="\d{5}"
                                maxLength="5"
                                inputMode="numeric"
                                required
                            />
                            <button
                                type="button"
                                className="password-toggle"
                                onClick={() => setShowPassword(!showPassword)}
                                tabIndex={-1}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    <button type="submit" className="auth-btn" disabled={loading}>
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>

                    <p className="auth-switch">
                        Don't have an account? <Link to="/register">Create one</Link>
                    </p>
                </form>
            </div>
        </div>
    )
}

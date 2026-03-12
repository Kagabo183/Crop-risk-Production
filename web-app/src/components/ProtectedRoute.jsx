import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, roles }) {
    const { isAuthenticated, user, loading } = useAuth()

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <div className="spinner" />
            </div>
        )
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />
    }

    if (roles && !roles.includes(user.role)) {
        return (
            <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                <h2 style={{ color: 'var(--color-danger, #e74c3c)' }}>Access Denied</h2>
                <p style={{ color: 'var(--color-text-secondary, #888)', marginTop: '1rem' }}>
                    Your role (<strong>{user.role}</strong>) does not have access to this page.
                </p>
            </div>
        )
    }

    return children
}

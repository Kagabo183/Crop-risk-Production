import { useState, useEffect } from 'react'
import { getUsers, changeUserRole, toggleUserActive } from '../api'

const ROLE_COLORS = {
    admin: '#e74c3c',
    agronomist: '#3498db',
    farmer: '#2ecc71',
}

const ROLE_OPTIONS = ['admin', 'agronomist', 'farmer']

export default function UserManagement() {
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    const fetchUsers = () => {
        setLoading(true)
        getUsers()
            .then(res => setUsers(res.data))
            .catch(err => setError(err.response?.data?.detail || 'Failed to load users'))
            .finally(() => setLoading(false))
    }

    useEffect(() => { fetchUsers() }, [])

    const handleRoleChange = async (userId, newRole) => {
        try {
            await changeUserRole(userId, newRole)
            fetchUsers()
        } catch (err) {
            alert(err.response?.data?.detail || 'Failed to change role')
        }
    }

    const handleToggleActive = async (userId) => {
        try {
            await toggleUserActive(userId)
            fetchUsers()
        } catch (err) {
            alert(err.response?.data?.detail || 'Failed to toggle user status')
        }
    }

    if (loading) {
        return <div style={{ textAlign: 'center', padding: '3rem' }}><div className="spinner" /></div>
    }

    return (
        <div style={{ padding: '1.5rem' }}>
            <div className="card" style={{ padding: '1.5rem' }}>
                <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>User Management</h2>
                <p style={{ color: 'var(--color-text-secondary)', margin: '0 0 1.5rem', fontSize: '0.875rem' }}>
                    Manage user accounts, roles, and access levels.
                </p>

                {error && <div style={{ color: '#e74c3c', marginBottom: '1rem' }}>{error}</div>}

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                {['Name', 'Email', 'Role', 'District', 'Status', 'Actions'].map(h => (
                                    <th key={h} style={{
                                        textAlign: 'left', padding: '0.75rem', fontSize: '0.75rem',
                                        textTransform: 'uppercase', letterSpacing: '0.5px',
                                        color: 'var(--color-text-secondary)',
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} style={{
                                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                                    opacity: u.is_active ? 1 : 0.5,
                                }}>
                                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>
                                        {u.full_name || '—'}
                                    </td>
                                    <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{u.email}</td>
                                    <td style={{ padding: '0.75rem' }}>
                                        <select
                                            value={u.role}
                                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                            style={{
                                                background: 'rgba(255,255,255,0.06)',
                                                border: `1px solid ${ROLE_COLORS[u.role] || '#555'}`,
                                                color: ROLE_COLORS[u.role] || '#fff',
                                                borderRadius: '0.5rem',
                                                padding: '0.35rem 0.5rem',
                                                fontSize: '0.8rem',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {ROLE_OPTIONS.map(r => (
                                                <option key={r} value={r} style={{ color: '#000' }}>
                                                    {r.charAt(0).toUpperCase() + r.slice(1)}
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                                        {u.district || '—'}
                                    </td>
                                    <td style={{ padding: '0.75rem' }}>
                                        <span style={{
                                            display: 'inline-block',
                                            padding: '0.2rem 0.6rem',
                                            borderRadius: '1rem',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            background: u.is_active ? 'rgba(46,204,113,0.15)' : 'rgba(231,76,60,0.15)',
                                            color: u.is_active ? '#2ecc71' : '#e74c3c',
                                        }}>
                                            {u.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.75rem' }}>
                                        <button
                                            onClick={() => handleToggleActive(u.id)}
                                            style={{
                                                background: 'rgba(255,255,255,0.06)',
                                                border: '1px solid rgba(255,255,255,0.12)',
                                                color: u.is_active ? '#e74c3c' : '#2ecc71',
                                                borderRadius: '0.5rem',
                                                padding: '0.35rem 0.75rem',
                                                fontSize: '0.8rem',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {u.is_active ? 'Deactivate' : 'Activate'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div style={{
                    marginTop: '1rem', padding: '0.75rem',
                    background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem',
                    fontSize: '0.8rem', color: 'var(--color-text-secondary)',
                }}>
                    Total: {users.length} users · {users.filter(u => u.is_active).length} active
                </div>
            </div>
        </div>
    )
}

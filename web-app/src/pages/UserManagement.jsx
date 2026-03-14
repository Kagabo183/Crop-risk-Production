import { useState, useEffect } from 'react'
import { getUsers, changeUserRole, toggleUserActive } from '../api'
import { Users, Shield, CheckCircle, XCircle, Clock } from 'lucide-react'

const ROLE_COLORS = {
    admin: { color: '#D32F2F', bg: '#FFEBEE' },
    agronomist: { color: '#0288D1', bg: '#E1F5FE' },
    farmer: { color: '#2E7D32', bg: '#E8F5E9' },
}
const ROLE_OPTIONS = ['admin', 'agronomist', 'farmer']

/* ── localStorage helpers ── */
function getRoleApplications() {
    try { return JSON.parse(localStorage.getItem('role_applications') || '[]') }
    catch { return [] }
}
function saveRoleApplications(apps) {
    localStorage.setItem('role_applications', JSON.stringify(apps))
}

export default function UserManagement() {
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [tab, setTab] = useState('users') // 'users' | 'applications'
    const [applications, setApplications] = useState([])

    const fetchUsers = () => {
        setLoading(true)
        getUsers()
            .then(res => setUsers(res.data))
            .catch(err => setError(err.response?.data?.detail || 'Failed to load users'))
            .finally(() => setLoading(false))
    }

    const loadApplications = () => {
        setApplications(getRoleApplications())
    }

    useEffect(() => {
        fetchUsers()
        loadApplications()
    }, [])

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

    const handleApprove = async (app) => {
        try {
            await changeUserRole(app.userId, app.requestedRole)
            const apps = getRoleApplications().map(a =>
                a.userId === app.userId && a.timestamp === app.timestamp
                    ? { ...a, status: 'approved' } : a
            )
            saveRoleApplications(apps)
            loadApplications()
            fetchUsers()
        } catch (err) {
            alert(err.response?.data?.detail || 'Failed to approve role')
        }
    }

    const handleReject = (app) => {
        const apps = getRoleApplications().map(a =>
            a.userId === app.userId && a.timestamp === app.timestamp
                ? { ...a, status: 'rejected' } : a
        )
        saveRoleApplications(apps)
        loadApplications()
    }

    const pendingApps = applications.filter(a => a.status === 'pending')
    const processedApps = applications.filter(a => a.status !== 'pending')

    if (loading) {
        return <div style={{ textAlign: 'center', padding: '3rem' }}><div className="spinner" /></div>
    }

    return (
        <div className="admin-page">
            {/* Tab Switcher */}
            <div className="admin-tabs">
                <button
                    className={`admin-tab ${tab === 'users' ? 'active' : ''}`}
                    onClick={() => setTab('users')}
                >
                    <Users size={16} />
                    Users
                    <span className="admin-tab-count">{users.length}</span>
                </button>
                <button
                    className={`admin-tab ${tab === 'applications' ? 'active' : ''}`}
                    onClick={() => { setTab('applications'); loadApplications() }}
                >
                    <Shield size={16} />
                    Role Applications
                    {pendingApps.length > 0 && (
                        <span className="admin-tab-badge">{pendingApps.length}</span>
                    )}
                </button>
            </div>

            {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

            {/* Users Table */}
            {tab === 'users' && (
                <div className="card">
                    <div className="card-header">
                        <h3>All Users</h3>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {users.filter(u => u.is_active).length} active · {users.length} total
                        </span>
                    </div>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Username</th>
                                    <th>Role</th>
                                    <th>District</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(u => {
                                    const rc = ROLE_COLORS[u.role] || ROLE_COLORS.farmer
                                    return (
                                        <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                                            <td style={{ fontWeight: 600 }}>{u.full_name || '—'}</td>
                                            <td>@{u.username}</td>
                                            <td>
                                                <select
                                                    value={u.role}
                                                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                                    className="admin-role-select"
                                                    style={{ borderColor: rc.color, color: rc.color }}
                                                >
                                                    {ROLE_OPTIONS.map(r => (
                                                        <option key={r} value={r}>
                                                            {r.charAt(0).toUpperCase() + r.slice(1)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td>{u.district || '—'}</td>
                                            <td>
                                                <span className={`badge ${u.is_active ? 'healthy' : 'critical'}`}>
                                                    {u.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td>
                                                <button
                                                    className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}`}
                                                    onClick={() => handleToggleActive(u.id)}
                                                >
                                                    {u.is_active ? 'Deactivate' : 'Activate'}
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Role Applications */}
            {tab === 'applications' && (
                <div className="admin-applications">
                    {pendingApps.length === 0 && processedApps.length === 0 ? (
                        <div className="empty-state">
                            <Shield size={48} />
                            <h3>No Role Applications</h3>
                            <p>When users apply for new roles, their requests will appear here.</p>
                        </div>
                    ) : (
                        <>
                            {pendingApps.length > 0 && (
                                <>
                                    <h3 className="admin-section-title">Pending Applications</h3>
                                    <div className="admin-app-grid">
                                        {pendingApps.map((app, i) => (
                                            <div key={i} className="admin-app-card pending">
                                                <div className="admin-app-card-header">
                                                    <div className="admin-app-avatar">
                                                        {(app.fullName || app.username || '?')[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <h4>{app.fullName || app.username}</h4>
                                                        <span className="admin-app-username">@{app.username}</span>
                                                    </div>
                                                    <Clock size={18} className="admin-app-clock" />
                                                </div>
                                                <div className="admin-app-card-body">
                                                    <div className="admin-app-role-change">
                                                        <span className="badge" style={{
                                                            background: ROLE_COLORS[app.currentRole]?.bg,
                                                            color: ROLE_COLORS[app.currentRole]?.color,
                                                        }}>{app.currentRole}</span>
                                                        <span className="admin-app-arrow">→</span>
                                                        <span className="badge" style={{
                                                            background: ROLE_COLORS[app.requestedRole]?.bg,
                                                            color: ROLE_COLORS[app.requestedRole]?.color,
                                                        }}>{app.requestedRole}</span>
                                                    </div>
                                                    <span className="admin-app-date">
                                                        {new Date(app.timestamp).toLocaleDateString()}
                                                    </span>
                                                </div>
                                                <div className="admin-app-card-actions">
                                                    <button className="btn btn-primary btn-sm" onClick={() => handleApprove(app)}>
                                                        <CheckCircle size={14} /> Approve
                                                    </button>
                                                    <button className="btn btn-danger btn-sm" onClick={() => handleReject(app)}>
                                                        <XCircle size={14} /> Reject
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {processedApps.length > 0 && (
                                <>
                                    <h3 className="admin-section-title" style={{ marginTop: 28 }}>History</h3>
                                    <div className="admin-app-grid">
                                        {processedApps.map((app, i) => (
                                            <div key={i} className={`admin-app-card ${app.status}`}>
                                                <div className="admin-app-card-header">
                                                    <div className="admin-app-avatar">
                                                        {(app.fullName || app.username || '?')[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <h4>{app.fullName || app.username}</h4>
                                                        <span className="admin-app-username">@{app.username}</span>
                                                    </div>
                                                    {app.status === 'approved'
                                                        ? <CheckCircle size={18} style={{ color: 'var(--success)' }} />
                                                        : <XCircle size={18} style={{ color: 'var(--danger)' }} />
                                                    }
                                                </div>
                                                <div className="admin-app-card-body">
                                                    <div className="admin-app-role-change">
                                                        <span className="badge" style={{
                                                            background: ROLE_COLORS[app.currentRole]?.bg,
                                                            color: ROLE_COLORS[app.currentRole]?.color,
                                                        }}>{app.currentRole}</span>
                                                        <span className="admin-app-arrow">→</span>
                                                        <span className="badge" style={{
                                                            background: ROLE_COLORS[app.requestedRole]?.bg,
                                                            color: ROLE_COLORS[app.requestedRole]?.color,
                                                        }}>{app.requestedRole}</span>
                                                    </div>
                                                    <span className={`badge ${app.status === 'approved' ? 'healthy' : 'critical'}`}>
                                                        {app.status}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

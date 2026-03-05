import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard,
  MapPin,
  Bug,
  ShieldAlert,
  Activity,
  Satellite,
  TrendingUp,
  Cpu,
  AlertTriangle,
  Users,
  LogOut,
} from 'lucide-react'

const ROLE_BADGE = {
  admin: { label: 'Admin', color: '#e74c3c' },
  agronomist: { label: 'Agronomist', color: '#3498db' },
  farmer: { label: 'Farmer', color: '#2ecc71' },
}

export default function Sidebar({ open, onClose }) {
  const { user, logout, hasRole } = useAuth()

  const badge = ROLE_BADGE[user?.role] || ROLE_BADGE.farmer

  const NAV = [
    {
      label: 'Overview', items: [
        { to: '/', icon: LayoutDashboard, text: 'Dashboard' },
        ...(hasRole('admin', 'agronomist', 'farmer') ?
          [{ to: '/farms', icon: MapPin, text: 'Farms' }] : []),
      ]
    },
    {
      label: 'Analysis', items: [
        ...(hasRole('admin', 'agronomist', 'farmer') ?
          [{ to: '/disease-classifier', icon: Bug, text: 'Disease Classifier' }] : []),
        ...(hasRole('admin', 'agronomist') ?
          [{ to: '/risk-assessment', icon: ShieldAlert, text: 'Risk Assessment' }] : []),
        { to: '/stress-monitoring', icon: Activity, text: 'Stress Monitoring' },
        { to: '/early-warning', icon: AlertTriangle, text: 'Early Warning' },
      ]
    },
    {
      label: 'Data', items: [
        { to: '/satellite', icon: Satellite, text: 'Satellite Data' },
        ...(hasRole('admin', 'agronomist') ?
          [{ to: '/disease-forecasts', icon: TrendingUp, text: 'Disease Forecasts' }] : []),
        ...(hasRole('admin', 'agronomist') ?
          [{ to: '/ml-models', icon: Cpu, text: 'ML Models' }] : []),
      ]
    },
    ...(hasRole('admin') ? [{
      label: 'Admin', items: [
        { to: '/users', icon: Users, text: 'User Management' },
      ],
    }] : []),
  ]

  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">🌾</div>
          <div>
            <h1>CropRisk</h1>
            <span>Prediction Platform</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(section => (
            <div key={section.label}>
              <div className="sidebar-section">{section.label}</div>
              {section.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `sidebar-link${isActive ? ' active' : ''}`
                  }
                  onClick={onClose}
                >
                  <item.icon />
                  {item.text}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* User profile + logout */}
        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <div className="sidebar-user-avatar">
              {(user?.full_name || user?.email || '?')[0].toUpperCase()}
            </div>
            <div className="sidebar-user-details">
              <span className="sidebar-user-name" title={user?.full_name || user?.email}>
                {user?.full_name || user?.email}
              </span>
              <div className="sidebar-user-badges">
                <span className="sidebar-user-role" style={{ background: badge.color + '22', color: badge.color }}>
                  {badge.label}
                </span>
                {user?.district && user.role === 'agronomist' && (
                  <span className="sidebar-user-district">{user.district}</span>
                )}
              </div>
            </div>
          </div>
          <button className="sidebar-logout" onClick={logout} title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 99,
          }}
        />
      )}
    </>
  )
}

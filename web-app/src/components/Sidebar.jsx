import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard,
  MapPin,
  ShieldAlert,
  AlertTriangle,
  Bug,
  Users,
  UserCircle,
  LogOut,
  Satellite,
  Calendar,
  Layers,
  BarChart2,
  Activity,
  Leaf,
  Radio,
  ChevronLeft,
} from 'lucide-react'

const ROLE_BADGE = {
  admin: { label: 'Admin', color: '#D32F2F' },
  agronomist: { label: 'Agronomist', color: '#0288D1' },
  farmer: { label: 'Farmer', color: '#2E7D32' },
}

export default function Sidebar({ open, onClose }) {
  const { user, logout, hasRole } = useAuth()
  const badge = ROLE_BADGE[user?.role] || ROLE_BADGE.farmer

  const NAV = [
    {
      label: 'Overview', items: [
        { to: '/', icon: LayoutDashboard, text: 'Dashboard' },
        ...(hasRole('admin', 'agronomist', 'farmer')
          ? [{ to: '/farms', icon: MapPin, text: 'My Farms' }] : []),
        { to: '/early-warning', icon: AlertTriangle, text: 'Alerts' },
      ]
    },
    {
      label: 'Satellite Intelligence', items: [
        ...(hasRole('admin', 'agronomist', 'farmer')
          ? [{ to: '/satellite-dashboard', icon: Satellite, text: 'Satellite Map' }] : []),
        ...(hasRole('admin', 'agronomist', 'farmer')
          ? [{ to: '/satellite', icon: Radio, text: 'Satellite Data' }] : []),
        ...(hasRole('admin', 'agronomist', 'farmer')
          ? [{ to: '/stress-monitoring', icon: Activity, text: 'Stress Monitor' }] : []),
      ]
    },
    {
      label: 'Analysis', items: [
        ...(hasRole('admin', 'agronomist', 'farmer')
          ? [{ to: '/disease-classifier', icon: Bug, text: 'Disease Classifier' }] : []),
        ...(hasRole('admin', 'agronomist')
          ? [{ to: '/predictions', icon: ShieldAlert, text: 'Predictions' }] : []),
        ...(hasRole('admin', 'agronomist', 'farmer')
          ? [{ to: '/risk-assessment', icon: Leaf, text: 'Risk Assessment' }] : []),
      ]
    },
    {
      label: 'Precision Agriculture', items: [
        ...(hasRole('admin', 'agronomist', 'farmer')
          ? [{ to: '/seasons', icon: Calendar, text: 'Seasons' }] : []),
        ...(hasRole('admin', 'agronomist')
          ? [{ to: '/vra', icon: Layers, text: 'VRA Maps' }] : []),
        ...(hasRole('admin', 'agronomist', 'farmer')
          ? [{ to: '/yield-analysis', icon: BarChart2, text: 'Yield Analysis' }] : []),
      ]
    },
    ...(hasRole('admin') ? [{
      label: 'Admin', items: [
        { to: '/admin', icon: Users, text: 'Admin Panel' },
      ],
    }] : []),
    {
      label: 'Account', items: [
        { to: '/profile', icon: UserCircle, text: 'Profile' },
      ]
    },
  ]

  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">🌾</div>
          <div>
            <h1>CropRisk</h1>
            <span>Precision Agriculture</span>
          </div>
          <button className="sidebar-collapse-btn" onClick={onClose} title="Collapse sidebar">
            <ChevronLeft size={16} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(section => {
            const visibleItems = section.items.filter(Boolean)
            if (visibleItems.length === 0) return null
            return (
              <div key={section.label} className="sidebar-group">
                <div className="sidebar-section">{section.label}</div>
                {visibleItems.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `sidebar-link${isActive ? ' active' : ''}`
                    }
                  >
                    <span className="sidebar-link-icon"><item.icon size={16} /></span>
                    <span className="sidebar-link-text">{item.text}</span>
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <div className="sidebar-user-avatar">
              {(user?.full_name || user?.username || '?')[0].toUpperCase()}
            </div>
            <div className="sidebar-user-details">
              <span className="sidebar-user-name" title={user?.full_name || user?.username}>
                {user?.full_name || user?.username}
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

      {open && (
        <div className="sidebar-overlay" onClick={onClose} />
      )}
    </>
  )
}

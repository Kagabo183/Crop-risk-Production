import { useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Menu } from 'lucide-react'

const ROLE_BADGE = {
  admin: { label: 'Admin', color: '#D32F2F', bg: '#FFEBEE' },
  agronomist: { label: 'Agronomist', color: '#0288D1', bg: '#E1F5FE' },
  farmer: { label: 'Farmer', color: '#2E7D32', bg: '#E8F5E9' },
}

export default function Header({ titles, apiStatus, onMenuClick }) {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const title = titles[pathname] || 'Crop Risk Platform'
  const badge = ROLE_BADGE[user?.role] || ROLE_BADGE.farmer

  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="mobile-menu-btn" onClick={onMenuClick}>
          <Menu size={22} />
        </button>
        <h2 className="header-title">{title}</h2>
      </div>
      <div className="header-right">
        <div className="header-status">
          <div className={`status-dot ${apiStatus === 'online' ? '' : apiStatus === 'offline' ? 'offline' : 'loading'}`} />
          <span>API {apiStatus}</span>
        </div>
        <Link to="/profile" className="header-user" title="View Profile">
          <span className="header-user-role" style={{ background: badge.bg, color: badge.color }}>
            {badge.label}
          </span>
          <div className="header-user-avatar">
            {(user?.full_name || user?.username || '?')[0].toUpperCase()}
          </div>
        </Link>
      </div>
    </header>
  )
}

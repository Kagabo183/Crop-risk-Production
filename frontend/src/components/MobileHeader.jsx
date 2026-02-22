import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function MobileHeader({ titles, apiStatus }) {
  const location = useLocation()
  const { user } = useAuth()

  const title = titles[location.pathname] || 'CropRisk'
  const initial = (user?.full_name || user?.email || '?')[0].toUpperCase()

  return (
    <div className="mobile-header">
      <span className="mobile-header-title">{title}</span>
      <div className="mobile-header-right">
        <div className={`status-dot ${apiStatus}`} />
        <div className="mobile-header-avatar">{initial}</div>
      </div>
    </div>
  )
}

import { useLocation } from 'react-router-dom'
import { Menu, Wifi, WifiOff } from 'lucide-react'

export default function Header({ titles, apiStatus, onMenuClick }) {
  const { pathname } = useLocation()
  const title = titles[pathname] || 'Crop Risk Platform'

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
      </div>
    </header>
  )
}

import { useAuth } from '../context/AuthContext'
import { useTitle } from '../context/TitleContext';
import { Wifi, WifiOff } from 'lucide-react';
import './MobileHeader.css'

export default function MobileHeader({ apiStatus }) {
  const { user } = useAuth()
  const { title } = useTitle();

  const initial = (user?.full_name || user?.email || '?')[0].toUpperCase()

  return (
    <header className="mobile-header">
      <div className="mobile-header-title-container">
        <span className="mobile-header-subtitle">Crop Risk</span>
        <h1 className="mobile-header-title">{title}</h1>
      </div>
      <div className="mobile-header-right">
        <div className={`status-indicator ${apiStatus}`} title={`API is ${apiStatus}`}>
          {apiStatus === 'online' ? <Wifi size={16} /> : <WifiOff size={16} />}
        </div>
        <div className="mobile-header-avatar" title={user?.full_name}>
          {initial}
        </div>
      </div>
    </header>
  )
}

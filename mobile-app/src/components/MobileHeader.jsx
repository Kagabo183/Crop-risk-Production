import { useAuth } from '../context/AuthContext'
import { useTitle } from '../context/TitleContext'
import { useLanguage } from '../context/LanguageContext'
import { Wifi, WifiOff } from 'lucide-react'
import './MobileHeader.css'

export default function MobileHeader({ apiStatus }) {
  const { user } = useAuth()
  const { title } = useTitle()
  const { language, toggleLanguage, t } = useLanguage()

  const initial = (user?.full_name || user?.email || '?')[0].toUpperCase()

  return (
    <header className="mobile-header">
      <div className="mobile-header-title-container">
        <span className="mobile-header-subtitle">{t('app.subtitle')}</span>
        <h1 className="mobile-header-title">{t(title)}</h1>
      </div>
      <div className="mobile-header-right">
        <button className="lang-toggle-btn" onClick={toggleLanguage} title={`Switch to ${language === 'en' ? 'Kinyarwanda' : 'English'}`}>
            {language === 'en' ? 'EN' : 'RW'}
        </button>
        <div className={`status-indicator ${apiStatus}`} title={apiStatus === 'online' ? t('api.online') : t('api.offline')}>
          {apiStatus === 'online' ? <Wifi size={16} /> : <WifiOff size={16} />}
        </div>
        <div className="mobile-header-avatar" title={user?.full_name}>
          {initial}
        </div>
      </div>
    </header>
  )
}

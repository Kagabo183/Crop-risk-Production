import { NavLink } from 'react-router-dom'
import { LayoutDashboard, MapPin, ShieldAlert, MoreHorizontal } from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import './BottomNav.css'

const TABS = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard', end: true },
  { to: '/farms', icon: MapPin, labelKey: 'nav.farms' },
  { isSpacer: true },
  { to: '/early-warning', icon: ShieldAlert, labelKey: 'nav.alerts' },
  { to: '/more', icon: MoreHorizontal, labelKey: 'nav.more' },
]

function BottomNavSpacer() {
  return <div className="bottom-nav-fab-spacer" />;
}

export default function BottomNav() {
  const { t } = useLanguage();
  return (
    <nav className="bottom-nav">
      {TABS.map((tab, i) => {
        if (tab.isSpacer) return <BottomNavSpacer key={i} />
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          >
            {({ isActive }) => (
              <>
                <div className="bottom-nav-icon-wrapper">
                  <tab.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span>{t(tab.labelKey)}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}



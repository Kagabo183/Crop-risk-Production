import { NavLink } from 'react-router-dom'
import { LayoutDashboard, MapPin, ShieldAlert, MoreHorizontal } from 'lucide-react'
import './BottomNav.css'

const TABS = [
  { to: '/', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/farms', icon: MapPin, label: 'Farms' },
  { isSpacer: true },
  { to: '/early-warning', icon: ShieldAlert, label: 'Alerts' },
  { to: '/more', icon: MoreHorizontal, label: 'More' },
]

function BottomNavSpacer() {
  return <div className="bottom-nav-fab-spacer" />;
}

export default function BottomNav() {
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
                <span>{tab.label}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}



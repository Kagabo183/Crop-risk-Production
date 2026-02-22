import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LayoutDashboard, MapPin, ShieldAlert, Activity, MoreHorizontal } from 'lucide-react'

const TABS = [
  { to: '/', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/farms', icon: MapPin, label: 'Farms', roles: ['admin', 'agronomist', 'farmer'] },
  null, // FAB spacer
  { to: '/early-warning', icon: ShieldAlert, label: 'Alerts' },
  { to: '/more', icon: MoreHorizontal, label: 'More' },
]

export default function BottomNav() {
  const { hasRole } = useAuth()

  return (
    <nav className="bottom-nav">
      {TABS.map((tab, i) => {
        if (!tab) return <div key="spacer" className="bottom-nav-fab-spacer" />
        if (tab.roles && !hasRole(...tab.roles)) return null
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          >
            <tab.icon size={24} />
            <span>{tab.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

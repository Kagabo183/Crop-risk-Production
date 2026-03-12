import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Bug, Activity, Satellite, TrendingUp, Cpu, Users, LogOut, ChevronRight,
} from 'lucide-react'
import { useTitle } from '../context/TitleContext';
import { useEffect } from 'react';

const ROLE_BADGE = {
  admin: { label: 'Admin', color: '#C62828' },
  agronomist: { label: 'Agronomist', color: '#00796B' },
  farmer: { label: 'Farmer', color: '#2d7a3a' },
}

export default function MoreMenu() {
  const { user, logout, hasRole } = useAuth()
  const { setTitle } = useTitle();
  const navigate = useNavigate()

  useEffect(() => {
    setTitle('More');
  }, [])

  const badge = ROLE_BADGE[user?.role] || ROLE_BADGE.farmer
  const initial = (user?.full_name || user?.email || '?')[0].toUpperCase()

  const items = [
    { icon: Bug, label: 'Disease Classifier', to: '/disease-classifier', roles: ['admin', 'agronomist', 'farmer'] },
    { icon: Activity, label: 'Stress Monitoring', to: '/stress-monitoring', roles: ['admin', 'agronomist', 'farmer'] },
    { icon: Satellite, label: 'Satellite Data', to: '/satellite', roles: ['admin', 'agronomist', 'farmer'] },
    { icon: TrendingUp, label: 'Disease Forecasts', to: '/disease-forecasts', roles: ['admin', 'agronomist'] },
    { icon: Cpu, label: 'ML Models', to: '/ml-models', roles: ['admin', 'agronomist'] },
    { icon: Users, label: 'User Management', to: '/users', roles: ['admin'] },
  ]

  return (
    <>
      <div className="more-menu-profile">
        <div className="more-menu-profile-avatar">{initial}</div>
        <div className="more-menu-profile-info">
          <h3>{user?.full_name || user?.email}</h3>
          <span style={{ color: badge.color, fontWeight: 600 }}>
            {badge.label}
            {user?.district && user.role === 'agronomist' && ` \u00B7 ${user.district}`}
          </span>
        </div>
      </div>

      <ul className="more-menu-list">
        {items.map(item => {
          if (item.roles && !hasRole(...item.roles)) return null
          return (
            <li key={item.to}>
              <button className="more-menu-item" onClick={() => navigate(item.to)}>
                <item.icon size={22} />
                {item.label}
                <ChevronRight size={18} className="chevron" />
              </button>
            </li>
          )
        })}
        <li>
          <button className="more-menu-item danger" onClick={logout}>
            <LogOut size={22} />
            Sign Out
          </button>
        </li>
      </ul>
    </>
  )
}

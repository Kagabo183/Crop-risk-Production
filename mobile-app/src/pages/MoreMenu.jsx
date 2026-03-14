import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Bug, Activity, Satellite, TrendingUp, Cpu, Users, LogOut, ChevronRight,
} from 'lucide-react'
import { useTitle } from '../context/TitleContext';
import { useLanguage } from '../context/LanguageContext';
import { useEffect } from 'react';

const ROLE_BADGE = {
  admin: { label: 'Admin', color: '#C62828' },
  agronomist: { label: 'Agronomist', color: '#00796B' },
  farmer: { label: 'Farmer', color: '#2d7a3a' },
}

export default function MoreMenu() {
  const { user, logout, hasRole } = useAuth()
  const { setTitle } = useTitle();
  const { t } = useLanguage();
  const navigate = useNavigate()

  useEffect(() => {
    setTitle(t('nav.more'));
  }, [setTitle, t])

  const badge = ROLE_BADGE[user?.role] || ROLE_BADGE.farmer
  const initial = (user?.full_name || user?.email || '?')[0].toUpperCase()

  const items = [
    { icon: Bug, labelKey: 'more.disease', to: '/disease-classifier', roles: ['admin', 'agronomist', 'farmer'] },
    { icon: Activity, labelKey: 'more.stress', to: '/stress-monitoring', roles: ['admin', 'agronomist', 'farmer'] },
    { icon: Satellite, labelKey: 'more.satellite', to: '/satellite', roles: ['admin', 'agronomist', 'farmer'] },
    { icon: TrendingUp, labelKey: 'more.forecasts', to: '/disease-forecasts', roles: ['admin', 'agronomist'] },
    { icon: Cpu, labelKey: 'more.models', to: '/ml-models', roles: ['admin', 'agronomist'] },
    { icon: Users, labelKey: 'more.users', to: '/users', roles: ['admin'] },
  ]

  return (
    <>
      <button className="more-menu-profile" onClick={() => navigate('/profile')} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', background: 'transparent' }}>
        <div className="more-menu-profile-avatar">{initial}</div>
        <div className="more-menu-profile-info" style={{ flex: 1 }}>
          <h3>{user?.full_name || user?.email}</h3>
          <span style={{ color: badge.color, fontWeight: 600 }}>
            {t(`role.${user?.role}`)}
            {user?.district && user.role === 'agronomist' && ` \u00B7 ${user.district}`}
          </span>
        </div>
        <ChevronRight size={20} className="chevron" style={{ color: 'rgba(255,255,255,0.4)' }} />
      </button>

      <ul className="more-menu-list">
        {items.map(item => {
          if (item.roles && !hasRole(...item.roles)) return null
          return (
            <li key={item.to}>
              <button className="more-menu-item" onClick={() => navigate(item.to)}>
                <item.icon size={22} />
                {item.labelKey ? t(item.labelKey) : item.label}
                <ChevronRight size={18} className="chevron" />
              </button>
            </li>
          )
        })}
        <li>
          <button className="more-menu-item danger" onClick={logout}>
            <LogOut size={22} />
            {t('profile.signout')}
          </button>
        </li>
      </ul>
    </>
  )
}

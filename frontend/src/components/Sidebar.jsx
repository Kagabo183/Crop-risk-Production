import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  MapPin,
  Bug,
  ShieldAlert,
  Activity,
  Satellite,
  TrendingUp,
  Cpu,
} from 'lucide-react'

const NAV = [
  { label: 'Overview', items: [
    { to: '/', icon: LayoutDashboard, text: 'Dashboard' },
    { to: '/farms', icon: MapPin, text: 'Farms' },
  ]},
  { label: 'Analysis', items: [
    { to: '/disease-classifier', icon: Bug, text: 'Disease Classifier' },
    { to: '/risk-assessment', icon: ShieldAlert, text: 'Risk Assessment' },
    { to: '/stress-monitoring', icon: Activity, text: 'Stress Monitoring' },
  ]},
  { label: 'Data', items: [
    { to: '/satellite', icon: Satellite, text: 'Satellite Data' },
    { to: '/disease-forecasts', icon: TrendingUp, text: 'Disease Forecasts' },
    { to: '/ml-models', icon: Cpu, text: 'ML Models' },
  ]},
]

export default function Sidebar({ open, onClose }) {
  const location = useLocation()

  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 99,
        display: 'none',
      }} />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">🌾</div>
          <div>
            <h1>CropRisk</h1>
            <span>Prediction Platform</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(section => (
            <div key={section.label}>
              <div className="sidebar-section">{section.label}</div>
              {section.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `sidebar-link${isActive ? ' active' : ''}`
                  }
                  onClick={onClose}
                >
                  <item.icon />
                  {item.text}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {/* Mobile overlay */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 99,
          }}
        />
      )}
    </>
  )
}

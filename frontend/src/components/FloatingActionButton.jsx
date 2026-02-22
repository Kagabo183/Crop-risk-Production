import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Plus, MapPin, Bug, ShieldAlert } from 'lucide-react'

export default function FloatingActionButton() {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const { hasRole } = useAuth()

  const actions = [
    ...(hasRole('admin', 'agronomist', 'farmer')
      ? [{ icon: MapPin, label: 'Add Farm', color: '#2d7a3a', bg: '#e8f5e9', action: () => navigate('/farms', { state: { openForm: true } }) }]
      : []),
    ...(hasRole('admin', 'agronomist', 'farmer')
      ? [{ icon: Bug, label: 'Scan Disease', color: '#E08A1E', bg: '#FFF3E0', action: () => navigate('/disease-classifier') }]
      : []),
    ...(hasRole('admin', 'agronomist', 'viewer')
      ? [{ icon: ShieldAlert, label: 'Check Risk', color: '#C62828', bg: '#FFEBEE', action: () => navigate('/risk-assessment') }]
      : []),
  ]

  const handleAction = (action) => {
    setExpanded(false)
    action()
  }

  return (
    <>
      <div
        className={`fab-backdrop ${expanded ? 'visible' : ''}`}
        onClick={() => setExpanded(false)}
      />
      <div className={`fab-actions ${expanded ? 'visible' : ''}`}>
        {actions.map((a, i) => (
          <button
            key={i}
            className="fab-action-item"
            onClick={() => handleAction(a.action)}
          >
            <div className="fab-action-icon" style={{ background: a.bg, color: a.color }}>
              <a.icon size={20} />
            </div>
            {a.label}
          </button>
        ))}
      </div>
      <button
        className={`fab ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <Plus size={28} />
      </button>
    </>
  )
}

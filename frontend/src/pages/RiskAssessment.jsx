import { useState, useEffect } from 'react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts'
import { ShieldAlert, TrendingDown, Lightbulb, AlertTriangle } from 'lucide-react'
import { getFarms, getRiskAssessment, explainRisk, predictYield } from '../api'

const RISK_COLORS = { low: '#16a34a', moderate: '#d97706', high: '#dc2626', severe: '#7c2d12' }
const RISK_BG = { low: 'var(--success-light)', moderate: 'var(--warning-light)', high: 'var(--danger-light)', severe: 'var(--danger-light)' }

export default function RiskAssessment() {
  const [farms, setFarms] = useState([])
  const [selectedFarm, setSelectedFarm] = useState('')
  const [risk, setRisk] = useState(null)
  const [explain, setExplain] = useState(null)
  const [yieldData, setYieldData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getFarms().then(r => {
      setFarms(r.data)
      if (r.data.length) setSelectedFarm(r.data[0].id)
    }).catch(() => {})
  }, [])

  const loadRisk = async () => {
    if (!selectedFarm) return
    setLoading(true)
    setError(null)
    setRisk(null)
    setExplain(null)
    setYieldData(null)

    const results = await Promise.allSettled([
      getRiskAssessment(selectedFarm),
      explainRisk(selectedFarm),
      predictYield(selectedFarm),
    ])

    if (results[0].status === 'fulfilled') setRisk(results[0].value.data)
    else setError(results[0].reason?.response?.data?.detail || 'Failed to load risk assessment')

    if (results[1].status === 'fulfilled') setExplain(results[1].value.data)
    if (results[2].status === 'fulfilled') setYieldData(results[2].value.data)

    setLoading(false)
  }

  useEffect(() => {
    if (selectedFarm) loadRisk()
  }, [selectedFarm])

  const riskLevel = risk?.risk_level || 'low'
  const riskScore = risk?.overall_risk_score ?? risk?.risk_score ?? 0
  const gaugeColor = RISK_COLORS[riskLevel] || RISK_COLORS.low

  // Radar data from components
  const radarData = risk?.components
    ? Object.entries(risk.components).map(([key, val]) => ({
        subject: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        value: val,
      }))
    : []

  // Contribution bar data
  const contribData = explain?.contributions
    ? Object.entries(explain.contributions)
        .sort(([, a], [, b]) => b - a)
        .map(([key, val]) => ({
          name: key.replace(/_/g, ' '),
          value: +(val * 100).toFixed(1),
        }))
    : []

  return (
    <>
      {/* Farm selector */}
      <div className="card">
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 140 }}>
            <select className="form-control" value={selectedFarm} onChange={e => setSelectedFarm(Number(e.target.value))} style={{ fontSize: 13 }}>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name} — {f.crop_type || 'Unknown'}</option>)}
            </select>
          </div>
          <button className="btn btn-sm btn-primary" onClick={loadRisk} disabled={loading || !selectedFarm}>
            {loading ? 'Analyzing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 10 }}><AlertTriangle size={14} />{error}</div>}

      {loading && <div className="loading"><div className="spinner" /><p>Running risk assessment...</p></div>}

      {risk && !loading && (
        <>
          {/* Risk Score + Radar */}
          <div className="grid-2">
            {/* Risk Gauge */}
            <div className="card">
              <div className="card-header"><h3>Overall Risk Score</h3></div>
              <div className="card-body">
                <div className="risk-gauge">
                  <div className="gauge-circle" style={{
                    background: `conic-gradient(${gaugeColor} ${riskScore * 3.6}deg, #e5e7eb ${riskScore * 3.6}deg)`,
                  }}>
                    <span style={{ color: gaugeColor }}>{riskScore.toFixed(0)}</span>
                  </div>
                  <div className="gauge-label" style={{ color: gaugeColor }}>{riskLevel}</div>
                  {risk.primary_driver && (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
                      Primary driver: <strong>{risk.primary_driver.replace(/_/g, ' ')}</strong>
                    </div>
                  )}
                  {risk.confidence != null && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      Confidence: {(risk.confidence * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Radar Chart */}
            <div className="card">
              <div className="card-header"><h3>Risk Components</h3></div>
              <div className="card-body">
                {radarData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <RadarChart data={radarData}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="subject" fontSize={9} />
                      <PolarRadiusAxis domain={[0, 100]} fontSize={9} />
                      <Radar dataKey="value" stroke={gaugeColor} fill={gaugeColor} fillOpacity={0.3} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state"><p>No component breakdown available</p></div>
                )}
              </div>
            </div>
          </div>

          {/* Recommendations + Contributions */}
          <div className="grid-2">
            {/* Recommendations */}
            <div className="card">
              <div className="card-header"><h3><Lightbulb size={16} style={{ verticalAlign: -2 }} /> Recommendations</h3></div>
              <div className="card-body">
                {(risk.recommendations || explain?.recommendations || []).length > 0 ? (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {(risk.recommendations || explain?.recommendations || []).map((rec, i) => (
                      <li key={i} style={{
                        padding: '10px 12px',
                        borderBottom: '1px solid var(--border)',
                        fontSize: 14,
                        display: 'flex',
                        gap: 8,
                        alignItems: 'flex-start',
                      }}>
                        <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{i + 1}.</span>
                        {rec}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty-state"><p>No recommendations available</p></div>
                )}
              </div>
            </div>

            {/* Contributions */}
            <div className="card">
              <div className="card-header"><h3>Risk Factor Contributions</h3></div>
              <div className="card-body">
                {contribData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={contribData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} fontSize={10} />
                      <YAxis type="category" dataKey="name" fontSize={9} width={90} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                        {contribData.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? 'var(--danger)' : i === 1 ? 'var(--warning)' : 'var(--primary)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state"><p>No contribution data available</p></div>
                )}
              </div>
            </div>
          </div>

          {/* Yield Prediction */}
          {yieldData && (
            <div className="card">
              <div className="card-header"><h3>Yield Prediction</h3></div>
              <div className="card-body">
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon green"><TrendingDown size={22} /></div>
                    <div className="stat-info">
                      <h4>Predicted Yield</h4>
                      <div className="stat-value">
                        {yieldData.predicted_yield_tons_ha?.toFixed(1) || '—'} t/ha
                      </div>
                      {yieldData.lower_bound != null && (
                        <div className="stat-change" style={{ color: 'var(--text-secondary)' }}>
                          Range: {yieldData.lower_bound?.toFixed(1)} — {yieldData.upper_bound?.toFixed(1)} t/ha
                        </div>
                      )}
                    </div>
                  </div>
                  {yieldData.yield_class && (
                    <div className="stat-card">
                      <div className="stat-info">
                        <h4>Yield Class</h4>
                        <div className="stat-value" style={{ fontSize: 20, textTransform: 'capitalize' }}>
                          {yieldData.yield_class.replace(/_/g, ' ')}
                        </div>
                      </div>
                    </div>
                  )}
                  {yieldData.confidence != null && (
                    <div className="stat-card">
                      <div className="stat-info">
                        <h4>Confidence</h4>
                        <div className="stat-value">{(yieldData.confidence * 100).toFixed(0)}%</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Scenarios */}
          {explain?.scenarios && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="card-header"><h3>What-If Scenarios</h3></div>
              <div className="card-body">
                <div className="stats-grid">
                  {Object.entries(explain.scenarios).map(([key, scenario]) => (
                    <div key={key} className="stat-card">
                      <div className="stat-info">
                        <h4 style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</h4>
                        <div className="stat-value" style={{
                          color: scenario.new_risk < riskScore ? 'var(--success)' : 'var(--danger)',
                        }}>
                          {scenario.new_risk?.toFixed(0) ?? '—'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                          {scenario.description}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!risk && !loading && !error && (
        <div className="empty-state">
          <ShieldAlert size={48} />
          <h3>Select a farm to view risk assessment</h3>
          <p>The ML ensemble will analyze disease, weather, and vegetation data</p>
        </div>
      )}
    </>
  )
}

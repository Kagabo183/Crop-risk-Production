import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Dashboard from './pages/Dashboard'
import Farms from './pages/Farms'
import DiseaseClassifier from './pages/DiseaseClassifier'
import RiskAssessment from './pages/RiskAssessment'
import StressMonitoring from './pages/StressMonitoring'
import SatelliteData from './pages/SatelliteData'
import DiseaseForecasts from './pages/DiseaseForecasts'
import MLModels from './pages/MLModels'
import { getHealth } from './api'

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/farms': 'Farm Management',
  '/disease-classifier': 'Disease Classifier',
  '/risk-assessment': 'Risk Assessment',
  '/stress-monitoring': 'Stress Monitoring',
  '/satellite': 'Satellite Data',
  '/disease-forecasts': 'Disease Forecasts',
  '/ml-models': 'ML Models',
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [apiStatus, setApiStatus] = useState('loading')

  useEffect(() => {
    getHealth()
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'))
  }, [])

  return (
    <div className="app-layout">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main-content">
        <Header
          titles={PAGE_TITLES}
          apiStatus={apiStatus}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <div className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/farms" element={<Farms />} />
            <Route path="/disease-classifier" element={<DiseaseClassifier />} />
            <Route path="/risk-assessment" element={<RiskAssessment />} />
            <Route path="/stress-monitoring" element={<StressMonitoring />} />
            <Route path="/satellite" element={<SatelliteData />} />
            <Route path="/disease-forecasts" element={<DiseaseForecasts />} />
            <Route path="/ml-models" element={<MLModels />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

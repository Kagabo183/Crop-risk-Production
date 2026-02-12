import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
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
import EarlyWarning from './pages/EarlyWarning'
import Login from './pages/Login'
import Register from './pages/Register'
import UserManagement from './pages/UserManagement'
import { getHealth } from './api'

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/farms': 'Farm Management',
  '/disease-classifier': 'Disease Classifier',
  '/risk-assessment': 'Risk Assessment',
  '/stress-monitoring': 'Stress Monitoring',
  '/satellite': 'Satellite Data',
  '/disease-forecasts': 'Disease Forecasts',
  '/early-warning': 'Early Warning System',
  '/ml-models': 'ML Models',
  '/users': 'User Management',
}

function AppRoutes() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [apiStatus, setApiStatus] = useState('loading')
  const { isAuthenticated, loading } = useAuth()

  useEffect(() => {
    getHealth()
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'))
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0a1628' }}>
        <div className="spinner" />
      </div>
    )
  }

  // Public routes (login/register) — no sidebar/header
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  // Authenticated layout
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
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/farms" element={
              <ProtectedRoute roles={['admin', 'agronomist', 'farmer']}>
                <Farms />
              </ProtectedRoute>
            } />
            <Route path="/disease-classifier" element={
              <ProtectedRoute roles={['admin', 'agronomist', 'farmer']}>
                <DiseaseClassifier />
              </ProtectedRoute>
            } />
            <Route path="/risk-assessment" element={
              <ProtectedRoute roles={['admin', 'agronomist', 'viewer']}>
                <RiskAssessment />
              </ProtectedRoute>
            } />
            <Route path="/stress-monitoring" element={
              <ProtectedRoute><StressMonitoring /></ProtectedRoute>
            } />
            <Route path="/satellite" element={
              <ProtectedRoute><SatelliteData /></ProtectedRoute>
            } />
            <Route path="/disease-forecasts" element={
              <ProtectedRoute roles={['admin', 'agronomist', 'viewer']}>
                <DiseaseForecasts />
              </ProtectedRoute>
            } />
            <Route path="/early-warning" element={
              <ProtectedRoute><EarlyWarning /></ProtectedRoute>
            } />
            <Route path="/ml-models" element={
              <ProtectedRoute roles={['admin', 'agronomist']}>
                <MLModels />
              </ProtectedRoute>
            } />
            <Route path="/users" element={
              <ProtectedRoute roles={['admin']}>
                <UserManagement />
              </ProtectedRoute>
            } />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/register" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

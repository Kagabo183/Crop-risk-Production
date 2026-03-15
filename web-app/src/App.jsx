import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import WebLayout from './components/WebLayout'
import ProtectedRoute from './components/ProtectedRoute'
import Dashboard from './pages/Dashboard'
import Farms from './pages/Farms'
import DiseaseClassifier from './pages/DiseaseClassifier'
import RiskAssessment from './pages/RiskAssessment'
import StressMonitoring from './pages/StressMonitoring'
import SatelliteData from './pages/SatelliteData'
import DiseaseForecasts from './pages/DiseaseForecasts'
import MLModels from './pages/MLModels'
import EarlyWarning from './pages/EarlyWarning'
import UserManagement from './pages/UserManagement'
import Profile from './pages/Profile'
import Login from './pages/Login'
import Register from './pages/Register'
import SatelliteDashboard from './pages/SatelliteDashboard'
import SeasonManager from './pages/SeasonManager'
import VraDashboard from './pages/VraDashboard'
import YieldAnalysis from './pages/YieldAnalysis'
import { getHealth } from './api'

const PAGE_TITLES = {
  '/': 'Dashboard Overview',
  '/farms': 'Farm Management',
  '/predictions': 'Agronomic Risk Assessment',
  '/alerts': 'Regional Alerts',
  '/admin': 'Admin Panel',
  '/profile': 'My Profile',
  '/disease-classifier': 'AI Disease Classifier',
  '/stress-monitoring': 'Crop Stress Monitoring',
  '/satellite': 'Satellite Index Analysis',
  '/disease-forecasts': 'Outbreak Forecasts',
  '/ml-models': 'ML Model Engine',
  '/satellite-dashboard': 'Satellite Intelligence Map',
  '/seasons': 'Season & Crop Rotation Management',
  '/vra': 'VRA Prescription Maps',
  '/yield-analysis': 'Yield Analysis',
}

function AppRoutes() {
  const [apiStatus, setApiStatus] = useState('loading')
  const { isAuthenticated, loading } = useAuth()

  useEffect(() => {
    getHealth()
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'))
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f4f1' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  return (
    <WebLayout titles={PAGE_TITLES} apiStatus={apiStatus}>
      <Routes>
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/farms" element={
          <ProtectedRoute roles={['admin', 'agronomist', 'farmer']}>
            <Farms />
          </ProtectedRoute>
        } />
        <Route path="/predictions" element={
          <ProtectedRoute roles={['admin', 'agronomist']}>
            <RiskAssessment />
          </ProtectedRoute>
        } />
        <Route path="/alerts" element={<ProtectedRoute><EarlyWarning /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

        {/* Admin Panel */}
        <Route path="/admin" element={
          <ProtectedRoute roles={['admin']}>
            <UserManagement />
          </ProtectedRoute>
        } />

        {/* Keep existing deep-link routes for tools accessible from dashboard */}
        <Route path="/disease-classifier" element={
          <ProtectedRoute roles={['admin', 'agronomist', 'farmer']}>
            <DiseaseClassifier />
          </ProtectedRoute>
        } />
        <Route path="/risk-assessment" element={
          <ProtectedRoute roles={['admin', 'agronomist']}>
            <RiskAssessment />
          </ProtectedRoute>
        } />
        <Route path="/stress-monitoring" element={<ProtectedRoute><StressMonitoring /></ProtectedRoute>} />
        <Route path="/satellite" element={<ProtectedRoute><SatelliteData /></ProtectedRoute>} />
        <Route path="/disease-forecasts" element={
          <ProtectedRoute roles={['admin', 'agronomist']}>
            <DiseaseForecasts />
          </ProtectedRoute>
        } />
        <Route path="/early-warning" element={<ProtectedRoute><EarlyWarning /></ProtectedRoute>} />
        <Route path="/ml-models" element={
          <ProtectedRoute roles={['admin', 'agronomist']}>
            <MLModels />
          </ProtectedRoute>
        } />
        <Route path="/satellite-dashboard" element={
          <ProtectedRoute roles={['admin', 'agronomist', 'farmer']}>
            <SatelliteDashboard />
          </ProtectedRoute>
        } />
        <Route path="/seasons" element={
          <ProtectedRoute roles={['admin', 'agronomist', 'farmer']}>
            <SeasonManager />
          </ProtectedRoute>
        } />
        <Route path="/vra" element={
          <ProtectedRoute roles={['admin', 'agronomist']}>
            <VraDashboard />
          </ProtectedRoute>
        } />
        <Route path="/yield-analysis" element={
          <ProtectedRoute roles={['admin', 'agronomist', 'farmer']}>
            <YieldAnalysis />
          </ProtectedRoute>
        } />

        {/* Legacy redirects */}
        <Route path="/users" element={<Navigate to="/admin" replace />} />
        <Route path="/more" element={<Navigate to="/profile" replace />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/register" element={<Navigate to="/" replace />} />
      </Routes>
    </WebLayout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

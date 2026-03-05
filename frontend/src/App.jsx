import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import BottomNav from './components/BottomNav'
import MobileHeader from './components/MobileHeader'
import FloatingActionButton from './components/FloatingActionButton'
import Dashboard from './pages/Dashboard'
import Farms from './pages/Farms'
import DiseaseClassifier from './pages/DiseaseClassifier'
import RiskAssessment from './pages/RiskAssessment'
import StressMonitoring from './pages/StressMonitoring'
import SatelliteData from './pages/SatelliteData'
import DiseaseForecasts from './pages/DiseaseForecasts'
import MLModels from './pages/MLModels'
import EarlyWarning from './pages/EarlyWarning'
import MoreMenu from './pages/MoreMenu'
import Login from './pages/Login'
import Register from './pages/Register'
import UserManagement from './pages/UserManagement'
import { getHealth } from './api'

import { PlatformProvider, usePlatform } from './context/PlatformContext'
import MobileLayout from './components/MobileLayout'
import WebLayout from './components/WebLayout'

const PAGE_TITLES = {
  '/': 'Dashboard Overview',
  '/farms': 'Farm Management',
  '/disease-classifier': 'AI Disease Classifier',
  '/risk-assessment': 'Agronomic Risk Assessment',
  '/stress-monitoring': 'Crop Stress Monitoring',
  '/satellite': 'Satellite Index Analysis',
  '/disease-forecasts': 'Outbreak Forecasts',
  '/early-warning': 'Regional Alerts',
  '/ml-models': 'ML Model Engine',
  '/users': 'System User Management',
  '/more': 'Account & Settings',
}

function AppRoutes() {
  const [apiStatus, setApiStatus] = useState('loading')
  const { isAuthenticated, loading } = useAuth()
  const { isWeb } = usePlatform()

  useEffect(() => {
    getHealth()
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'))
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#1B3A1F' }}>
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

  const routes = (
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
        <ProtectedRoute roles={['admin', 'agronomist']}>
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
        <ProtectedRoute roles={['admin', 'agronomist']}>
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
      <Route path="/more" element={<ProtectedRoute><MoreMenu /></ProtectedRoute>} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
    </Routes>
  )

  if (isWeb) {
    return (
      <WebLayout titles={PAGE_TITLES} apiStatus={apiStatus}>
        {routes}
      </WebLayout>
    )
  }

  return (
    <MobileLayout titles={PAGE_TITLES} apiStatus={apiStatus}>
      {routes}
    </MobileLayout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <PlatformProvider>
        <AppRoutes />
      </PlatformProvider>
    </AuthProvider>
  )
}

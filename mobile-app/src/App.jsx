import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { TitleProvider } from './context/TitleContext'
import { LanguageProvider } from './context/LanguageContext' // Added LanguageProvider import
import MobileLayout from './components/MobileLayout'
import ProtectedRoute from './components/ProtectedRoute'
import Dashboard from './pages/Dashboard'
import Farms from './pages/Farms'
import DiseaseClassifier from './pages/DiseaseClassifier'
import StressMonitoring from './pages/StressMonitoring'
import EarlyWarning from './pages/EarlyWarning'
import MoreMenu from './pages/MoreMenu'
import Profile from './pages/Profile'
import Login from './pages/Login'
import Register from './pages/Register'
import { getHealth } from './api'

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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#112314' }}>
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
    <MobileLayout apiStatus={apiStatus}>
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
        <Route path="/stress-monitoring" element={<ProtectedRoute><StressMonitoring /></ProtectedRoute>} />
        <Route path="/early-warning" element={<ProtectedRoute><EarlyWarning /></ProtectedRoute>} />
        <Route path="/more" element={<ProtectedRoute><MoreMenu /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/register" element={<Navigate to="/" replace />} />
      </Routes>
    </MobileLayout>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <TitleProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </TitleProvider>
    </LanguageProvider>
  )
}

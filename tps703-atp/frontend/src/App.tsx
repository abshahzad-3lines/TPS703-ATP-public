import { useState, useEffect, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import TestSetupPage from '@/pages/TestSetupPage'
import TestExecutionPage from '@/pages/TestExecutionPage'
import ResultsPage from '@/pages/ResultsPage'
import ResultDetailPage from '@/pages/ResultDetailPage'
import AuditTrailPage from '@/pages/AuditTrailPage'
import EquipmentPage from '@/pages/EquipmentPage'
import BenchDispatcher from '@/pages/BenchDispatcher'
import AtpAuthorPage from '@/pages/AtpAuthorPage'
import AtpDefinitionPage from '@/pages/AtpDefinitionPage'
import AtpDiffPage from '@/pages/AtpDiffPage'
import AppShell from '@/components/layout/AppShell'
import ProtectedRoute from '@/components/layout/ProtectedRoute'
import type { AuthState } from '@/contexts/AuthContext'
import { api } from '@/lib/api'

interface UserInfo {
  id: number
  username: string
  full_name: string
  role: 'admin' | 'engineer' | 'technician' | 'viewer'
  badge_id?: string
}

function AppRoutes() {
  const navigate = useNavigate()
  const [auth, setAuth] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      setLoading(false)
      return
    }
    api.setToken(token)
    api
      .get<UserInfo>('/auth/me')
      .then((user) => {
        setAuth({ user, token, isAuthenticated: true })
      })
      .catch(() => {
        localStorage.removeItem('token')
        localStorage.removeItem('refresh_token')
        api.setToken(null)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('refresh_token')
    api.setToken(null)
    setAuth({ user: null, token: null, isAuthenticated: false })
    navigate('/login')
  }, [navigate])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role}>
            <AppShell auth={auth} onLogout={handleLogout}>
              <DashboardPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/test-setup"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role} minRole="technician">
            <AppShell auth={auth} onLogout={handleLogout}>
              <TestSetupPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/test-execution/:runId?"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role} minRole="technician">
            <AppShell auth={auth} onLogout={handleLogout}>
              <TestExecutionPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/results"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role}>
            <AppShell auth={auth} onLogout={handleLogout}>
              <ResultsPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/results/:runId"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role}>
            <AppShell auth={auth} onLogout={handleLogout}>
              <ResultDetailPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/equipment"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role} minRole="technician">
            <AppShell auth={auth} onLogout={handleLogout}>
              <EquipmentPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/instrument-bench/:equipmentId?"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role} minRole="technician">
            <AppShell auth={auth} onLogout={handleLogout}>
              <BenchDispatcher />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/atp-author"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role}>
            <AppShell auth={auth} onLogout={handleLogout}>
              <AtpAuthorPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/atp-author/diff/:baseId/:targetId"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role}>
            <AppShell auth={auth} onLogout={handleLogout}>
              <AtpDiffPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/atp-author/:definitionId"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role}>
            <AppShell auth={auth} onLogout={handleLogout}>
              <AtpDefinitionPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute isAuthenticated={auth.isAuthenticated} userRole={auth.user?.role} minRole="admin">
            <AppShell auth={auth} onLogout={handleLogout}>
              <AuditTrailPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App

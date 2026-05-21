import { useState, useEffect, useCallback, type ReactNode } from 'react'
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
import SparamListPage from '@/pages/SparamListPage'
import SparamDetailPage from '@/pages/SparamDetailPage'
import RolesPage from '@/pages/RolesPage'
import AppShell from '@/components/layout/AppShell'
import ProtectedRoute from '@/components/layout/ProtectedRoute'
import type { AuthState, AuthUser } from '@/contexts/AuthContext'
import { api } from '@/lib/api'

type UserInfo = AuthUser

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

  const shell = (page: string, node: ReactNode) => (
    <ProtectedRoute auth={auth} page={page}>
      <AppShell auth={auth} onLogout={handleLogout}>{node}</AppShell>
    </ProtectedRoute>
  )

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={shell('/dashboard', <DashboardPage />)} />
      <Route path="/test-setup" element={shell('/test-setup', <TestSetupPage />)} />
      <Route path="/test-execution/:runId?" element={shell('/test-execution', <TestExecutionPage />)} />
      <Route path="/results" element={shell('/results', <ResultsPage />)} />
      <Route path="/results/:runId" element={shell('/results', <ResultDetailPage />)} />
      <Route path="/equipment" element={shell('/equipment', <EquipmentPage />)} />
      <Route path="/instrument-bench/:equipmentId?" element={shell('/instrument-bench', <BenchDispatcher />)} />
      <Route path="/atp-author" element={shell('/atp-author', <AtpAuthorPage />)} />
      <Route path="/atp-author/diff/:baseId/:targetId" element={shell('/atp-author', <AtpDiffPage />)} />
      <Route path="/atp-author/:definitionId" element={shell('/atp-author', <AtpDefinitionPage />)} />
      <Route path="/sparam" element={shell('/sparam', <SparamListPage />)} />
      <Route path="/sparam/:sweepId" element={shell('/sparam', <SparamDetailPage />)} />
      <Route path="/roles" element={shell('/roles', <RolesPage />)} />
      <Route path="/admin" element={shell('/admin', <AuditTrailPage />)} />
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

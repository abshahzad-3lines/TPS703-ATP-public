import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { canAccessPage, type AuthState } from '@/contexts/AuthContext'

interface ProtectedRouteProps {
  children: ReactNode
  auth: AuthState
  /** The application page this route maps to, used for DB-driven access checks. */
  page?: string
}

export default function ProtectedRoute({ children, auth, page }: ProtectedRouteProps) {
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (page && !canAccessPage(auth.user, page)) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold text-slate-900">Access denied</h2>
          <p className="mt-2 text-slate-500">
            Your role <span className="font-semibold">{auth.user?.role}</span> doesn't have
            access to this page. Ask a Super Admin to grant it under
            <span className="font-mono"> Roles &amp; Access</span>.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

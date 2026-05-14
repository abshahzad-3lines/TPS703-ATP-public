import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

interface ProtectedRouteProps {
  children: ReactNode
  isAuthenticated: boolean
  userRole?: string
  minRole?: string
}

const ROLE_HIERARCHY = ['viewer', 'technician', 'engineer', 'admin']

export default function ProtectedRoute({ children, isAuthenticated, userRole, minRole }: ProtectedRouteProps) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (minRole && userRole) {
    const userLevel = ROLE_HIERARCHY.indexOf(userRole)
    const requiredLevel = ROLE_HIERARCHY.indexOf(minRole)
    if (userLevel < requiredLevel) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-slate-900">Access Denied</h2>
            <p className="mt-2 text-slate-500">
              You need at least <span className="font-semibold">{minRole}</span> role to access this page.
            </p>
          </div>
        </div>
      )
    }
  }

  return <>{children}</>
}

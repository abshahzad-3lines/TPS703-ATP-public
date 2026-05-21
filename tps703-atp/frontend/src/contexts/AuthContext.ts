import { createContext } from 'react'

export interface AuthUser {
  id: number | string
  username: string
  full_name: string
  /** DB-driven role name (super_admin, admin, engineer, technician, viewer, or custom) */
  role: string
  badge_id?: string
  is_super_admin?: boolean
  is_admin?: boolean
  /** Page paths + feature: flags this role may access (empty for admin/super = all) */
  allowed_pages?: string[]
}

export interface AuthState {
  user: AuthUser | null
  token: string | null
  isAuthenticated: boolean
}

export const AuthContext = createContext<AuthState | null>(null)

/** Whether the current user may access an application page path. */
export function canAccessPage(user: AuthUser | null | undefined, path: string): boolean {
  if (!user) return false
  if (user.is_super_admin) return true
  // admin sees every app page except the roles-management page
  if (user.is_admin && path !== '/roles') return true
  const pages = user.allowed_pages ?? []
  if (pages.includes(path)) return true
  // sub-paths inherit their parent grant (e.g. /sparam/3 -> /sparam)
  return pages.some(p => !p.startsWith('feature:') && path.startsWith(p + '/'))
}

/** Whether the current user has a feature flag (e.g. 'atp-approve'). */
export function canAccessFeature(user: AuthUser | null | undefined, feature: string): boolean {
  if (!user) return false
  const key = feature.startsWith('feature:') ? feature : `feature:${feature}`
  if (user.is_super_admin) return true
  if (user.is_admin && key !== 'feature:manage-roles') return true
  return (user.allowed_pages ?? []).includes(key)
}

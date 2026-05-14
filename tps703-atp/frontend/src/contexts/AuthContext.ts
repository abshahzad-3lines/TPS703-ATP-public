import { createContext } from 'react'

export interface AuthState {
  user: {
    id: number
    username: string
    full_name: string
    role: 'admin' | 'engineer' | 'technician' | 'viewer'
    badge_id?: string
  } | null
  token: string | null
  isAuthenticated: boolean
}

export const AuthContext = createContext<AuthState | null>(null)

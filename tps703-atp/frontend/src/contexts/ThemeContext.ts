import { createContext } from 'react'

export interface ThemeState {
  bezelColor: string
  passColor: string
  failColor: string
  warningColor: string
  runningColor: string
  pendingColor: string
}

export const defaultTheme: ThemeState = {
  bezelColor: '#e5e7eb',
  passColor: '#10b981',
  failColor: '#ef4444',
  warningColor: '#f59e0b',
  runningColor: '#3b82f6',
  pendingColor: '#64748b',
}

export const ThemeContext = createContext<ThemeState>(defaultTheme)

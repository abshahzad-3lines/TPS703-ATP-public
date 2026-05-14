import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

const root = createRoot(document.getElementById('root')!, {
  onCaughtError: (error, errorInfo) => {
    console.error('Caught error:', error, errorInfo.componentStack)
  },
  onUncaughtError: (error, errorInfo) => {
    console.error('Uncaught error:', error, errorInfo.componentStack)
  },
  onRecoverableError: (error, _errorInfo) => {
    console.warn('Recoverable error:', error)
  },
})
root.render(<App />)

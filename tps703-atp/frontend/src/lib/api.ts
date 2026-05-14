const API_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`

class ApiClient {
  private token: string | null = null

  setToken(token: string | null) {
    this.token = token
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    }
    const token = this.token || localStorage.getItem('token')
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }))
      // Auth failed — token is missing/expired/invalid. Clear it and bounce
      // to the login page so the user re-auths cleanly. Skip if we're already
      // on /login to avoid an endless redirect loop on the login request.
      if (res.status === 401 && !path.startsWith('/auth/login')) {
        this.setToken(null)
        localStorage.removeItem('token')
        localStorage.removeItem('refresh_token')
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
      }
      throw new Error(error.detail || res.statusText)
    }
    return res.json()
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) })
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path)
  }

  async downloadFile(path: string, filename: string): Promise<void> {
    const headers: Record<string, string> = {}
    const token = this.token || localStorage.getItem('token')
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    const res = await fetch(`${API_BASE}${path}`, { headers })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(error.detail || res.statusText)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
}

export const api = new ApiClient()

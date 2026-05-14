import { useActionState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SubmitButton } from '@/components/layout/SubmitButton'
import { api } from '@/lib/api'
import { Lock, User } from 'lucide-react'
import logoImg from '@/assets/logo.png'

export default function LoginPage() {
  const [error, submitAction] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      try {
        const res = await api.post<{ access_token: string; refresh_token: string }>('/auth/login', {
          username: formData.get('username'),
          password: formData.get('password'),
        })
        api.setToken(res.access_token)
        localStorage.setItem('token', res.access_token)
        localStorage.setItem('refresh_token', res.refresh_token)
        window.location.href = '/dashboard'
        return null
      } catch (e) {
        return e instanceof Error ? e.message : 'Login failed'
      }
    },
    null,
  )

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <title>Login - TPS-703 ATP</title>

      {/* Branding */}
      <div className="flex flex-col items-center mb-8">
        <img src={logoImg} alt="Facon" className="h-28 w-28 object-contain mb-4" />
        <h1 className="text-3xl font-bold tracking-tight text-foreground">TPS-703</h1>
        <p className="text-sm tracking-widest text-muted-foreground uppercase mt-1">
          Acceptance Test Procedure System
        </p>
      </div>

      {/* Login card */}
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-xl">Sign In</CardTitle>
          <CardDescription>Enter your credentials to access the system</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submitAction} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium text-foreground">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="username"
                  name="username"
                  required
                  autoFocus
                  placeholder="Enter your username"
                  className="pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  placeholder="Enter your password"
                  className="pl-10"
                />
              </div>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <SubmitButton className="w-full">Sign In</SubmitButton>
          </form>
        </CardContent>
      </Card>

      {/* Footer */}
      <p className="mt-6 text-xs text-muted-foreground">
        TPS-703 ATP System v1.0 -- CAGE Code 97942
      </p>
    </div>
  )
}

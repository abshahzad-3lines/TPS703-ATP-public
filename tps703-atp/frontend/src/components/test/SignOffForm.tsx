import { useActionState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SubmitButton } from '@/components/layout/SubmitButton'
import { api } from '@/lib/api'

interface SignOffResponse {
  run_id: number
  signed_by: number
  signer_name: string
  signed_at: string
  signature_hash: string
}

interface SignOffFormProps {
  runId: number
  status: string
  isSigned: boolean
  signedBy?: string
  signatureHash?: string
  role: string
}

type SignState = {
  error: string | null
  success: SignOffResponse | null
}

export function SignOffForm({
  runId,
  status,
  isSigned,
  signedBy,
  signatureHash,
  role,
}: SignOffFormProps) {
  const [state, signAction] = useActionState(
    async (prev: SignState, _formData: FormData): Promise<SignState> => {
      try {
        const res = await api.post<SignOffResponse>(`/results/${runId}/sign`, {})
        return { error: null, success: res }
      } catch (e) {
        return {
          error: e instanceof Error ? e.message : 'Sign-off failed',
          success: null,
        }
      }
    },
    { error: null, success: null },
  )

  const signed = isSigned || state.success !== null
  const signerName = state.success?.signer_name ?? signedBy
  const sigHash = state.success?.signature_hash ?? signatureHash

  const isTerminal = status === 'passed' || status === 'failed'
  const canSign = (role === 'engineer' || role === 'admin') && isTerminal && !signed

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Digital Sign-Off</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {signed ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500 text-white">Signed</Badge>
              <span className="text-sm text-muted-foreground">
                by {signerName}
              </span>
            </div>
            {sigHash && (
              <p className="text-xs font-mono text-muted-foreground break-all">
                Signature: {sigHash.slice(0, 16)}...
              </p>
            )}
            {state.success && (
              <Alert>
                <AlertDescription>
                  Test run successfully signed off.
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : !isTerminal ? (
          <p className="text-sm text-muted-foreground">
            Sign-off is only available for completed test runs (passed or failed).
          </p>
        ) : !canSign ? (
          <p className="text-sm text-muted-foreground">
            Only engineers and admins can sign off on test runs.
          </p>
        ) : (
          <form action={signAction} className="space-y-4">
            <p className="text-sm">
              I certify that this test was conducted in accordance with the approved ATP.
            </p>
            {state.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <SubmitButton>Sign Off</SubmitButton>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

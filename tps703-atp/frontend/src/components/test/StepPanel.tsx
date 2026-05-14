import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { StepStatusBadge } from '@/components/test/StatusBadge'
import { AlertTriangle, Activity, Gauge, Info, Ruler } from 'lucide-react'

interface StepData {
  id: number
  step_number: number
  name: string
  step_type: string
  instrument: string | null
  frequency_mhz: number | null
  input_power_dbm: number | null
  pulse_width_us: number | null
  limit_type: string | null
  limit_min: number | null
  limit_max: number | null
  limit_nominal: number | null
  limit_tolerance: number | null
  unit: string | null
  instructions: string | null
  safety_warning: string | null
  is_optional: boolean
  is_record_only: boolean
}

interface StepResult {
  measured_value: number | null
  pass_fail: string | null
}

interface StepPanelProps {
  step: StepData | null
  result: StepResult | null
  isRunning: boolean
}

function formatLimits(step: StepData): string {
  const u = step.unit ?? ''
  switch (step.limit_type) {
    case 'min': return `≥ ${step.limit_min} ${u}`
    case 'max': return `≤ ${step.limit_max} ${u}`
    case 'range': return `${step.limit_min} – ${step.limit_max} ${u}`
    case 'nominal': return `${step.limit_nominal} ± ${step.limit_tolerance} ${u}`
    case 'exact': return `= ${step.limit_nominal ?? ''} ${u}`
    case 'passfail': return 'Record Only'
    default: return '—'
  }
}

const resultColor: Record<string, string> = {
  pass: 'text-emerald-600 font-bold',
  fail: 'text-red-600 font-bold',
  warning: 'text-amber-600 font-bold',
  record_only: 'text-slate-600',
}

export default function StepPanel({ step, result, isRunning }: StepPanelProps) {
  if (!step) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16 text-muted-foreground">
          <p>No step selected</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            Step {step.step_number}: {step.name}
          </CardTitle>
          <div className="flex gap-2">
            {step.is_optional && <Badge variant="outline">Optional</Badge>}
            {step.is_record_only && <Badge className="bg-amber-500 text-white hover:bg-amber-500">Record Only</Badge>}
            {isRunning && <Badge className="bg-blue-500 text-white animate-pulse hover:bg-blue-500">Running</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          {step.instrument && (
            <Badge className="bg-blue-500/15 text-blue-600">{step.instrument.replace(/_/g, ' ')}</Badge>
          )}
          <Badge variant="secondary">{step.step_type}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Safety Warning */}
        {step.safety_warning && (
          <Alert className="border-amber-400 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800 font-semibold">Safety Warning</AlertTitle>
            <AlertDescription className="text-amber-800">
              {step.safety_warning}
            </AlertDescription>
          </Alert>
        )}

        {/* Instructions */}
        {step.instructions && (
          <div>
            <h4 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-1">
              <Info className="h-3.5 w-3.5" />
              Instructions
            </h4>
            <div className="rounded-md border-l-2 border-blue-300 bg-blue-50/50 pl-3 py-2">
              <p className="text-sm whitespace-pre-wrap">{step.instructions}</p>
            </div>
          </div>
        )}

        {/* Parameters */}
        {(step.frequency_mhz || step.input_power_dbm || step.pulse_width_us) && (
          <div>
            <h4 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
              <Activity className="h-3.5 w-3.5" />
              Parameters
            </h4>
            <div className="grid grid-cols-3 gap-3">
              {step.frequency_mhz != null && (
                <div className="rounded-lg border bg-slate-50/80 p-3 text-center shadow-sm">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">Frequency</div>
                  <div className="text-sm font-mono font-semibold">{step.frequency_mhz} MHz</div>
                </div>
              )}
              {step.input_power_dbm != null && (
                <div className="rounded-lg border bg-slate-50/80 p-3 text-center shadow-sm">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">Input Power</div>
                  <div className="text-sm font-mono font-semibold">{step.input_power_dbm} dBm</div>
                </div>
              )}
              {step.pulse_width_us != null && (
                <div className="rounded-lg border bg-slate-50/80 p-3 text-center shadow-sm">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">Pulse Width</div>
                  <div className="text-sm font-mono font-semibold">{step.pulse_width_us} µs</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Limits */}
        <div>
          <h4 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-1">
            <Ruler className="h-3.5 w-3.5" />
            Acceptance Limits
          </h4>
          <div className="rounded-lg border bg-slate-50/80 p-3 shadow-sm">
            <span className="font-mono text-sm font-medium">{formatLimits(step)}</span>
          </div>
        </div>

        {/* Result */}
        {result && result.measured_value != null && (
          <div>
            <h4 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
              <Gauge className="h-3.5 w-3.5" />
              Result
            </h4>
            <div className={`flex items-center justify-between rounded-lg border p-3 ${
              result.pass_fail === 'pass' ? 'border-emerald-200 bg-emerald-50/50' :
              result.pass_fail === 'fail' ? 'border-red-200 bg-red-50/50' :
              result.pass_fail === 'warning' ? 'border-amber-200 bg-amber-50/50' : ''
            }`}>
              <span className={`font-mono text-lg ${resultColor[result.pass_fail ?? ''] ?? ''}`}>
                {result.measured_value} {step.unit ?? ''}
              </span>
              {result.pass_fail && (
                <StepStatusBadge
                  status={result.pass_fail as 'pass' | 'fail' | 'warning' | 'running' | 'pending'}
                  showIcon
                />
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

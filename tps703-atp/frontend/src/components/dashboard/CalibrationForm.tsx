import { useState, useEffect, useActionState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalParameter {
  name: string
  unit: string
  limit_type: string
  limit_min: number | null
  limit_max: number | null
  limit_nominal: number | null
  limit_tolerance: number | null
}

interface CalParametersResponse {
  subsystem_id: number
  drawing_no: string
  subsystem_name: string
  parameters: CalParameter[]
}

interface Equipment {
  id: number
  name: string
  model: string | null
  manufacturer: string | null
  serial_number: string | null
  cal_due_date: string | null
  is_active: number
}

interface CalibrationFormProps {
  subsystemId: number
  onCalibrationComplete: () => void
}

type FormResult =
  | { success: true; message: string }
  | { success: false; error: string }
  | null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLimit(p: CalParameter): string {
  switch (p.limit_type) {
    case 'max': return `\u2264 ${p.limit_max} ${p.unit}`
    case 'min': return `\u2265 ${p.limit_min} ${p.unit}`
    case 'nominal': return `${p.limit_nominal} \u00B1 ${p.limit_tolerance} ${p.unit}`
    case 'range': return `${p.limit_min} \u2013 ${p.limit_max} ${p.unit}`
    default: return '\u2014'
  }
}

function evaluateResult(value: number, p: CalParameter): 'pass' | 'fail' {
  if (p.limit_type === 'max' && p.limit_max != null) {
    return value <= p.limit_max ? 'pass' : 'fail'
  }
  if (p.limit_type === 'min' && p.limit_min != null) {
    return value >= p.limit_min ? 'pass' : 'fail'
  }
  if (p.limit_type === 'nominal' && p.limit_nominal != null && p.limit_tolerance != null) {
    return Math.abs(value - p.limit_nominal) <= p.limit_tolerance ? 'pass' : 'fail'
  }
  if (p.limit_type === 'range' && p.limit_min != null && p.limit_max != null) {
    return value >= p.limit_min && value <= p.limit_max ? 'pass' : 'fail'
  }
  return 'pass'
}

function getCalDueStatus(calDueDate: string | null): { ok: boolean; label: string } {
  if (!calDueDate) return { ok: false, label: 'No cal date' }
  const due = new Date(calDueDate)
  const now = new Date()
  if (due < now) return { ok: false, label: 'Overdue' }
  return { ok: true, label: 'Current' }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CalibrationForm({ subsystemId, onCalibrationComplete }: CalibrationFormProps) {
  const [calParams, setCalParams] = useState<CalParametersResponse | null>(null)
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Measurement values keyed by parameter index
  const [values, setValues] = useState<Record<number, string>>({})
  // Equipment selection
  const [selectedEquipment, setSelectedEquipment] = useState<Set<number>>(new Set())
  // Reference cable S/N
  const [refCableSn, setRefCableSn] = useState('')

  // Fetch calibration parameters and equipment list
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      api.get<CalParametersResponse>(`/calibrations/parameters/${subsystemId}`),
      api.get<Equipment[]>('/equipment'),
    ])
      .then(([params, equip]) => {
        if (!cancelled) {
          setCalParams(params)
          setEquipment(equip.filter(e => e.is_active))
          setValues({})
          setSelectedEquipment(new Set())
          setLoading(false)
        }
      })
      .catch(e => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load calibration data')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [subsystemId])

  // Toggle equipment selection
  function toggleEquipment(id: number) {
    setSelectedEquipment(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Compute per-row pass/fail
  const rowResults: Array<{ filled: boolean; passFail: 'pass' | 'fail' | null }> = (calParams?.parameters ?? []).map((p, i) => {
    const raw = values[i]
    if (raw === undefined || raw === '') return { filled: false, passFail: null }
    const num = parseFloat(raw)
    if (isNaN(num)) return { filled: false, passFail: null }
    return { filled: true, passFail: evaluateResult(num, p) }
  })

  const allFilled = rowResults.every(r => r.filled)
  const anyFail = rowResults.some(r => r.passFail === 'fail')
  const noEquipment = selectedEquipment.size === 0

  // Submit calibration
  const [submitResult, submitAction] = useActionState<FormResult, FormData>(
    async (_prev) => {
      if (!calParams) return { success: false, error: 'No calibration parameters loaded' }

      const results = calParams.parameters.map((p, i) => {
        const measured = parseFloat(values[i] ?? '0')
        return {
          parameter_name: p.name,
          measured_value: measured,
          limit_min: p.limit_min,
          limit_max: p.limit_max,
          unit: p.unit,
          pass_fail: evaluateResult(measured, p),
        }
      })

      try {
        await api.post('/calibrations', {
          subsystem_id: subsystemId,
          cal_type: 'daily',
          ref_cable_sn: refCableSn || null,
          equipment_ids: Array.from(selectedEquipment),
          results,
        })
        onCalibrationComplete()
        return { success: true, message: 'Calibration recorded successfully.' }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Failed to save calibration' }
      }
    },
    null,
  )

  if (loading) {
    return <p className="text-sm text-muted-foreground py-4">Loading calibration parameters...</p>
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!calParams || calParams.parameters.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No calibration parameters defined for this subsystem.</p>
  }

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Perform Daily Calibration</CardTitle>
        <CardDescription>
          {calParams.drawing_no} &mdash; {calParams.subsystem_name}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={submitAction} className="space-y-5">
          {/* Reference Cable */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Reference Cable S/N</label>
            <Input
              value={refCableSn}
              onChange={e => setRefCableSn(e.target.value)}
              placeholder="e.g., G05"
              className="max-w-xs"
            />
          </div>

          {/* Equipment selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Equipment Used <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {equipment.map(eq => {
                const isSelected = selectedEquipment.has(eq.id)
                const calStatus = getCalDueStatus(eq.cal_due_date)
                return (
                  <button
                    key={eq.id}
                    type="button"
                    onClick={() => toggleEquipment(eq.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors',
                      isSelected
                        ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                        : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold',
                        isSelected
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : 'border-slate-300 text-transparent',
                      )}
                    >
                      {'\u2713'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{eq.name}</span>
                        <Badge
                          className={cn(
                            'text-[10px] px-1.5 py-0',
                            calStatus.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white',
                          )}
                        >
                          {calStatus.label}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {eq.model ?? ''} {eq.serial_number ? `(${eq.serial_number})` : ''}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
            {noEquipment && (
              <p className="text-xs text-red-600">Select at least one piece of equipment</p>
            )}
          </div>

          <Separator />

          {/* Measurement entries */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Calibration Measurements</label>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-xs">
                    <th className="text-left px-3 py-2 font-semibold">Parameter</th>
                    <th className="text-left px-3 py-2 font-semibold">Acceptance Limit</th>
                    <th className="text-left px-3 py-2 font-semibold w-36">Measured Value</th>
                    <th className="text-center px-3 py-2 font-semibold w-16">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {calParams.parameters.map((p, i) => {
                    const row = rowResults[i]
                    return (
                      <tr
                        key={i}
                        className={cn(
                          'border-t',
                          row.passFail === 'fail' && 'bg-red-50',
                          row.passFail === 'pass' && 'bg-emerald-50/50',
                        )}
                      >
                        <td className="px-3 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {formatLimit(p)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              step="any"
                              value={values[i] ?? ''}
                              onChange={e => setValues(prev => ({ ...prev, [i]: e.target.value }))}
                              className={cn(
                                'h-8 font-mono text-sm',
                                row.passFail === 'fail' && 'border-red-400 focus-visible:ring-red-400',
                                row.passFail === 'pass' && 'border-emerald-400 focus-visible:ring-emerald-400',
                              )}
                              placeholder="0.00"
                            />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">{p.unit}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {row.passFail === 'pass' && (
                            <Badge className="bg-emerald-500 text-white text-xs">Pass</Badge>
                          )}
                          {row.passFail === 'fail' && (
                            <Badge className="bg-red-500 text-white text-xs">Fail</Badge>
                          )}
                          {row.passFail === null && (
                            <span className="text-xs text-slate-400">&mdash;</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Warning if any fail */}
          {anyFail && allFilled && (
            <Alert variant="destructive">
              <AlertDescription>
                One or more measurements are outside acceptance limits.
                The calibration will be recorded as <strong>invalid</strong> and you will not be able to proceed.
              </AlertDescription>
            </Alert>
          )}

          {/* Submit result feedback */}
          {submitResult && submitResult.success && (
            <Alert>
              <AlertDescription className="text-emerald-700">{submitResult.message}</AlertDescription>
            </Alert>
          )}
          {submitResult && !submitResult.success && (
            <Alert variant="destructive">
              <AlertDescription>{submitResult.error}</AlertDescription>
            </Alert>
          )}

          {/* Submit button */}
          <div className="pt-1">
            <button
              type="submit"
              disabled={!allFilled || anyFail || noEquipment}
              className={cn(
                'inline-flex h-10 items-center justify-center rounded-md px-6 text-sm font-semibold text-white transition-colors',
                allFilled && !anyFail && !noEquipment
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-slate-300 cursor-not-allowed',
              )}
            >
              Submit Calibration
            </button>
            {!allFilled && (
              <span className="ml-3 text-xs text-muted-foreground">Fill all measurements to submit</span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

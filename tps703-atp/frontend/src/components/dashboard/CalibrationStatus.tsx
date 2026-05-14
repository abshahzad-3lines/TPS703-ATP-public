import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface CalibrationApiResponse {
  id: number
  subsystem_id: number
  status: string
  expires_at: string
  performed_at: string
  time_remaining_seconds: number
  time_remaining_human: string
}

interface CalibrationInfo {
  subsystem_id: number
  subsystem_name: string
  drawing_no: string
  is_valid: boolean
  expires_at: string | null
  performed_at: string | null
  time_remaining_seconds: number | null
}

const SUBSYSTEMS = [
  { id: 1, name: 'Power Module', drawing_no: '110K245' },
  { id: 2, name: 'Preamplifier Panel', drawing_no: '110K244' },
  { id: 3, name: 'RF Output Panel', drawing_no: '110K243' },
  { id: 4, name: 'IF Receiver', drawing_no: 'IF_RECVR' },
] as const

const SECONDS_IN_24H = 86400
const WARNING_THRESHOLD_SECONDS = 2 * 3600 // 2 hours

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return '0h 0m remaining'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m remaining`
}

type CalibrationState = 'valid' | 'warning' | 'expired' | 'none'

function getCalibrationState(info: CalibrationInfo | null): CalibrationState {
  if (!info || !info.is_valid || info.expires_at === null) return 'none'
  const remaining = getRemainingSeconds(info.expires_at)
  if (remaining <= 0) return 'expired'
  if (remaining < WARNING_THRESHOLD_SECONDS) return 'warning'
  return 'valid'
}

function getRemainingSeconds(expiresAt: string): number {
  const expiry = new Date(expiresAt).getTime()
  const now = Date.now()
  return Math.max(0, Math.floor((expiry - now) / 1000))
}

function StatusBadge({ state }: { state: CalibrationState }) {
  const config: Record<CalibrationState, { label: string; className: string }> = {
    valid: {
      label: 'Valid',
      className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    },
    warning: {
      label: 'Valid',
      className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    },
    expired: {
      label: 'Expired',
      className: 'bg-red-500/15 text-red-600 dark:text-red-400',
    },
    none: {
      label: 'None',
      className: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
    },
  }

  const { label, className } = config[state]
  return <Badge variant="secondary" className={className}>{label}</Badge>
}

export function CalibrationStatus() {
  const [calibrations, setCalibrations] = useState<Map<number, CalibrationInfo | null>>(
    new Map()
  )
  const [, setTick] = useState(0)

  // Fetch calibration data on mount
  useEffect(() => {
    let cancelled = false

    async function fetchCalibrations() {
      const results = new Map<number, CalibrationInfo | null>()

      await Promise.all(
        SUBSYSTEMS.map(async (sub) => {
          try {
            const data = await api.get<CalibrationApiResponse>(
              `/calibrations/valid/${sub.id}`
            )
            if (!cancelled) {
              results.set(sub.id, {
                subsystem_id: data.subsystem_id,
                subsystem_name: sub.name,
                drawing_no: sub.drawing_no,
                is_valid: data.status === 'valid',
                expires_at: data.expires_at,
                performed_at: data.performed_at,
                time_remaining_seconds: data.time_remaining_seconds,
              })
            }
          } catch {
            // API may not exist yet or subsystem has no calibration
            if (!cancelled) {
              results.set(sub.id, null)
            }
          }
        })
      )

      if (!cancelled) {
        setCalibrations(results)
      }
    }

    fetchCalibrations()

    return () => {
      cancelled = true
    }
  }, [])

  // Countdown timer: tick every minute to re-render time remaining
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1)
    }, 60_000)

    return () => clearInterval(interval)
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calibration Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {SUBSYSTEMS.map((sub) => {
            const info = calibrations.get(sub.id) ?? null
            const state = getCalibrationState(info)
            const remaining =
              info?.expires_at ? getRemainingSeconds(info.expires_at) : 0
            const progressPercent = Math.min(
              100,
              Math.max(0, (remaining / SECONDS_IN_24H) * 100)
            )

            return (
              <div key={sub.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{sub.drawing_no}</span>
                    <span className="text-xs text-muted-foreground">
                      {sub.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(state === 'valid' || state === 'warning') && (
                      <span
                        className={cn(
                          'text-xs tabular-nums',
                          state === 'warning'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-muted-foreground'
                        )}
                      >
                        {formatTimeRemaining(remaining)}
                      </span>
                    )}
                    <StatusBadge state={state} />
                  </div>
                </div>
                {(state === 'valid' || state === 'warning') && (
                  <Progress
                    value={progressPercent}
                    className={cn(
                      '[&_[data-slot=progress-indicator]]:transition-all',
                      state === 'warning'
                        ? '[&_[data-slot=progress-indicator]]:bg-amber-500'
                        : '[&_[data-slot=progress-indicator]]:bg-emerald-500'
                    )}
                  />
                )}
                {state === 'expired' && (
                  <Progress
                    value={0}
                    className="[&_[data-slot=progress-indicator]]:bg-red-500"
                  />
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

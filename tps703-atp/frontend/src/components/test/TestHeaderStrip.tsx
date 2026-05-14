import { useEffect, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Cpu,
  ClipboardList,
  Hash,
  User,
  Clock,
  Activity,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  Loader2,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type TestStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'passed'
  | 'failed'
  | 'aborted'

interface TestHeaderStripProps {
  subsystemName: string
  drawingNo: string
  procedureName: string
  procedureCode: string
  serialNumber: string
  operatorName: string
  startedAt: string | null
  status: TestStatus
  executionMode: 'simulator' | 'live' | null
  completedSteps: number
  totalSteps: number
  passedCount: number
  failedCount: number
  /** Optional action controls (Start / Pause / Abort / Take etc.) rendered
   *  inside the header so the operator doesn't lose a row to a separate
   *  control bar. */
  controls?: ReactNode
}

const statusStyle: Record<TestStatus, { label: string; icon: typeof Clock; cls: string }> = {
  pending:   { label: 'Pending',  icon: Clock,        cls: 'bg-slate-100 text-slate-700' },
  running:   { label: 'Running',  icon: Loader2,      cls: 'bg-blue-100 text-blue-700' },
  paused:    { label: 'Paused',   icon: PauseCircle,  cls: 'bg-amber-100 text-amber-700' },
  passed:    { label: 'Passed',   icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700' },
  failed:    { label: 'Failed',   icon: XCircle,      cls: 'bg-red-100 text-red-700' },
  aborted:   { label: 'Aborted',  icon: AlertCircle,  cls: 'bg-slate-200 text-slate-700' },
}

function formatElapsed(ms: number): string {
  if (ms < 0) return '00:00:00'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export default function TestHeaderStrip({
  subsystemName,
  drawingNo,
  procedureName,
  procedureCode,
  serialNumber,
  operatorName,
  startedAt,
  status,
  executionMode,
  completedSteps,
  totalSteps,
  passedCount,
  failedCount,
  controls,
}: TestHeaderStripProps) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!startedAt || (status !== 'running' && status !== 'paused')) {
      // Freeze the elapsed time once the run leaves a live state.
      if (!startedAt) {
        setElapsedMs(0)
        return
      }
      // Show the final elapsed once
      setElapsedMs(Date.now() - new Date(startedAt).getTime())
      return
    }
    const tick = () =>
      setElapsedMs(Date.now() - new Date(startedAt).getTime())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, status])

  const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0
  const { label, icon: StatusIcon, cls } = statusStyle[status]

  return (
    <div className="rounded-lg border bg-white px-4 py-3 shadow-sm">
      {/* Top row: context + status */}
      <div className="flex items-center gap-4 flex-wrap">
        <Field icon={Cpu} label="Subsystem" value={subsystemName} subValue={drawingNo} mono />
        <Divider />
        <Field icon={ClipboardList} label="Procedure" value={procedureName} subValue={procedureCode} />
        <Divider />
        <Field icon={Hash} label="Serial" value={serialNumber} mono />
        <Divider />
        <Field icon={User} label="Operator" value={operatorName} />
        <div className="ml-auto flex items-center gap-2">
          {executionMode && (
            <Badge
              className={cn(
                'text-[10px] uppercase tracking-wider',
                executionMode === 'live'
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-100',
              )}
            >
              {executionMode}
            </Badge>
          )}
          <Badge className={cn('gap-1.5 px-2 py-1', cls)}>
            <StatusIcon
              className={cn(
                'h-3.5 w-3.5',
                status === 'running' && 'animate-spin',
              )}
            />
            <span className="text-xs font-semibold">{label}</span>
          </Badge>
          {controls && (
            <div className="ml-2 flex items-center">{controls}</div>
          )}
        </div>
      </div>

      {/* Bottom row: progress + counts + timer */}
      <div className="mt-3 flex items-center gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Progress
            </span>
            <span className="text-xs font-mono tabular-nums">
              {completedSteps} / {totalSteps}
              <span className="text-muted-foreground"> · {percent}%</span>
            </span>
          </div>
          <Progress value={percent} className="h-1.5" />
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-mono font-semibold tabular-nums">{passedCount}</span>
          </span>
          <span className="flex items-center gap-1 text-red-600">
            <XCircle className="h-3.5 w-3.5" />
            <span className="font-mono font-semibold tabular-nums">{failedCount}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 text-slate-700">
          <Activity className="h-3.5 w-3.5" />
          <span className="font-mono text-xs tabular-nums">{formatElapsed(elapsedMs)}</span>
        </div>
      </div>
    </div>
  )
}

function Field({
  icon: Icon,
  label,
  value,
  subValue,
  mono,
}: {
  icon: typeof Cpu
  label: string
  value: string
  subValue?: string
  mono?: boolean
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            'text-sm font-semibold truncate',
            mono && 'font-mono',
          )}
          title={subValue ? `${value} (${subValue})` : value}
        >
          {value || '—'}
          {subValue && (
            <span className="text-muted-foreground font-normal text-xs ml-1.5">
              {subValue}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

function Divider() {
  return <span className="h-8 w-px bg-slate-200 shrink-0" />
}

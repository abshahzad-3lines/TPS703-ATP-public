import { Suspense, use, useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TestStatusBadge, StepStatusBadge } from '@/components/test/StatusBadge'
import {
  FileText,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Clock,
  PenLine,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Hash,
  Minus,
  ClipboardCheck,
  RefreshCw,
  Loader2,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResultStep {
  step_number: number
  name: string
  step_type: string
  instrument: string | null
  frequency_mhz: number | null
  input_power_dbm: number | null
  limit_type: string | null
  limit_min: number | null
  limit_max: number | null
  limit_nominal: number | null
  limit_tolerance: number | null
  unit: string | null
  measured_value: number | null
  secondary_value: number | null
  pass_fail: string | null
  measured_at: string | null
  integrity_hash: string | null
  is_record_only: boolean
}

interface ResultSummary {
  total: number
  passed: number
  failed: number
  warnings: number
  record_only: number
  skipped: number
}

interface ResultDetail {
  id: number
  procedure_code: string | null
  procedure_name: string | null
  subsystem_drawing_no: string | null
  subsystem_name: string | null
  serial_number: string | null
  operator_name: string | null
  started_at: string | null
  completed_at: string | null
  status: string
  execution_mode: string | null
  signature_hash: string | null
  signed_by: string | null
  results: ResultStep[]
  summary: ResultSummary
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchResultDetail(runId: string): Promise<ResultDetail> {
  return api.get<ResultDetail>(`/test-runs/${runId}/detail`)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatLimit(step: ResultStep): string {
  switch (step.limit_type) {
    case 'min':
      return `\u2265 ${step.limit_min}`
    case 'max':
      return `\u2264 ${step.limit_max}`
    case 'range':
      return `${step.limit_min} \u2013 ${step.limit_max}`
    case 'nominal':
      return `${step.limit_nominal} \u00B1 ${step.limit_tolerance}`
    case 'exact':
      return `= ${step.limit_nominal ?? ''}`
    case 'passfail':
      return 'Record'
    default:
      return '\u2014'
  }
}

const valueColor: Record<string, string> = {
  pass: 'text-emerald-600 font-bold',
  fail: 'text-red-600 font-bold',
  warning: 'text-amber-600 font-bold',
  record_only: 'text-slate-600',
  skipped: 'text-slate-400 italic',
}

// ---------------------------------------------------------------------------
// Skeleton (loading state)
// ---------------------------------------------------------------------------

function ResultDetailSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {/* Header skeleton */}
      <div className="space-y-3">
        <div className="h-7 w-64 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-5 w-48 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
      {/* Table skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 w-10 animate-pulse rounded bg-muted" />
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-4 w-12 animate-pulse rounded bg-muted" />
            <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content component (uses use() to read the promise)
// ---------------------------------------------------------------------------

function ResultDetailContent({ promise }: { promise: Promise<ResultDetail> }) {
  const detail = use(promise)
  const navigate = useNavigate()
  const [restarting, setRestarting] = useState(false)

  const handleRestart = async () => {
    setRestarting(true)
    try {
      // Get the original run's procedure_id and uut_id
      const originalRun = await api.get<{ procedure_id: number; uut_id: number; execution_mode: string | null }>(
        `/test-runs/${detail.id}`
      )
      // Create a new run with the same config
      const newRun = await api.post<{ id: number }>('/test-runs', {
        procedure_id: originalRun.procedure_id,
        uut_id: originalRun.uut_id,
        execution_mode: originalRun.execution_mode || 'simulator',
      })
      // Start it
      await api.post(`/test-runs/${newRun.id}/start`, {})
      // Navigate to execution
      navigate(`/test-execution/${newRun.id}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to restart test')
      setRestarting(false)
    }
  }

  return (
    <>
      <title>{`Result #${detail.id} - TPS-703 ATP`}</title>

      <div className="space-y-6">
        {/* Page heading */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
              <FileText className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Test Result <span className="font-mono">#{detail.id}</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Full data sheet for test run #{detail.id}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleRestart}
              disabled={restarting}
              className="gap-1.5"
            >
              {restarting
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />
              }
              {restarting ? 'Starting...' : 'Restart Test'}
            </Button>
            <TestStatusBadge
              status={detail.status as 'pending' | 'running' | 'paused' | 'passed' | 'failed' | 'aborted'}
              size="lg"
              showIcon
            />
          </div>
        </div>

        {/* Header section */}
        <Card className="print:shadow-none print:border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-slate-500" />
              Acceptance Test Procedure -- Data Sheet
            </CardTitle>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm border rounded-lg p-4 bg-slate-50 print:bg-white">
              <div>
                <span className="text-muted-foreground">Drawing No: </span>
                <span className="font-medium">{detail.subsystem_drawing_no ?? '--'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Subsystem: </span>
                <span className="font-medium">{detail.subsystem_name ?? '--'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Procedure: </span>
                <span className="font-medium">
                  {detail.procedure_code ?? '--'} -- {detail.procedure_name ?? '--'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Serial #: </span>
                <span className="font-mono font-medium">{detail.serial_number ?? '--'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Operator: </span>
                <span className="font-medium">{detail.operator_name ?? '--'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Started: </span>
                <span className="font-medium">{formatDate(detail.started_at)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Completed: </span>
                <span className="font-medium">{formatDate(detail.completed_at)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Mode: </span>
                <Badge variant="outline" className="text-xs">
                  {detail.execution_mode ?? 'simulator'}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Status: </span>
                <TestStatusBadge
                  status={detail.status as 'pending' | 'running' | 'paused' | 'passed' | 'failed' | 'aborted'}
                  size="sm"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Results table */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Step</TableHead>
                    <TableHead>Parameter</TableHead>
                    <TableHead className="w-20">Freq (MHz)</TableHead>
                    <TableHead className="w-20">Input (dBm)</TableHead>
                    <TableHead className="w-36">Acceptance Limit</TableHead>
                    <TableHead className="w-24">Measured</TableHead>
                    <TableHead className="w-16">Unit</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.results.map((step) => {
                    const pf = step.pass_fail ?? 'pending'
                    return (
                      <TableRow
                        key={step.step_number}
                        className={cn(
                          'transition-colors',
                          pf === 'fail' && 'bg-red-50 hover:bg-red-100/60',
                          pf === 'warning' && 'bg-amber-50 hover:bg-amber-100/60',
                          pf !== 'fail' && pf !== 'warning' && 'hover:bg-slate-50/80',
                        )}
                      >
                        <TableCell className="font-mono text-xs">
                          {step.step_number}
                        </TableCell>
                        <TableCell className="text-sm">
                          {step.name}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {step.frequency_mhz != null ? step.frequency_mhz : '\u2014'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {step.input_power_dbm != null ? step.input_power_dbm : '\u2014'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatLimit(step)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'font-mono text-sm',
                            valueColor[pf] ?? 'text-slate-400 italic',
                          )}
                        >
                          {step.measured_value != null ? step.measured_value : '\u2014'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {step.unit ?? ''}
                        </TableCell>
                        <TableCell>
                          {step.pass_fail ? (
                            <StepStatusBadge
                              status={
                                (['pass', 'fail', 'warning', 'running', 'pending'].includes(step.pass_fail)
                                  ? step.pass_fail
                                  : 'pending') as 'pass' | 'fail' | 'warning' | 'running' | 'pending'
                              }
                              size="sm"
                            />
                          ) : (
                            <span className="text-xs text-slate-400">{'\u2014'}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Summary footer */}
            <Separator />
            <div className="flex flex-wrap gap-5 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                Total: <span className="font-semibold text-foreground tabular-nums">{detail.summary.total}</span>
              </span>
              <span className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Passed: <span className="font-semibold tabular-nums">{detail.summary.passed}</span>
              </span>
              <span className="flex items-center gap-1.5 text-red-600">
                <XCircle className="h-3.5 w-3.5" />
                Failed: <span className="font-semibold tabular-nums">{detail.summary.failed}</span>
              </span>
              <span className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                Warnings: <span className="font-semibold tabular-nums">{detail.summary.warnings}</span>
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Minus className="h-3.5 w-3.5" />
                Record Only: <span className="font-semibold tabular-nums">{detail.summary.record_only}</span>
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Minus className="h-3.5 w-3.5" />
                Skipped: <span className="font-semibold tabular-nums">{detail.summary.skipped}</span>
              </span>
            </div>

            {/* Signature section */}
            <Separator />
            <div className="rounded-lg border p-4 bg-slate-50 print:bg-white">
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                {detail.signature_hash ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-amber-500" />
                )}
                Digital Signature / Sign-off
              </h3>
              {detail.signature_hash ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <PenLine className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Signed By:</span>
                    <span className="font-medium">{detail.signed_by}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <span className="text-muted-foreground shrink-0">Signature Hash:</span>
                    <code className="font-mono text-xs break-all bg-white border rounded px-1.5 py-0.5">
                      {detail.signature_hash}
                    </code>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-amber-600">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="italic">Awaiting sign-off</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Back link */}
        <div className="flex justify-start">
          <Link
            to="/results"
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Results
          </Link>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function ResultDetailPage() {
  const { runId } = useParams<{ runId: string }>()

  const detailPromise = useMemo(() => {
    if (!runId) {
      return Promise.reject(new Error('No run ID provided'))
    }
    return fetchResultDetail(runId)
  }, [runId])

  if (!runId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No test run ID specified.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Suspense fallback={<ResultDetailSkeleton />}>
        <ResultDetailContent promise={detailPromise} />
      </Suspense>
    </div>
  )
}

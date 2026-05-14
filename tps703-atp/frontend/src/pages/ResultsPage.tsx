import { Suspense, use, useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ClipboardList,
  CheckCircle2,
  XCircle,
  Ban,
  Filter,
  Inbox,
  ChevronRight,
} from 'lucide-react'

interface ResultItem {
  id: number
  procedure_name: string | null
  procedure_code: string | null
  subsystem_name: string | null
  drawing_no: string | null
  serial_number: string | null
  operator_name: string | null
  started_at: string | null
  completed_at: string | null
  status: string
  execution_mode: string | null
  total_steps: number
  passed_steps: number
  failed_steps: number
}

interface Subsystem {
  id: number
  drawing_no: string
  name: string
}

const statusConfig: Record<string, { className: string; icon: typeof CheckCircle2 }> = {
  passed: { className: 'bg-emerald-500/10 text-emerald-700 border-emerald-200 hover:bg-emerald-500/10', icon: CheckCircle2 },
  failed: { className: 'bg-red-500/10 text-red-700 border-red-200 hover:bg-red-500/10', icon: XCircle },
  aborted: { className: 'bg-red-300/10 text-red-500 border-red-200 hover:bg-red-300/10', icon: Ban },
}

const defaultStatusConfig = { className: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100', icon: Ban }

function fetchResults(status: string | null, subsystemId: string | null): Promise<ResultItem[]> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (subsystemId) params.set('subsystem_id', subsystemId)
  const qs = params.toString()
  return api.get<ResultItem[]>(`/results${qs ? '?' + qs : ''}`).catch(() => [])
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

function ResultsTableContent({ promise }: { promise: Promise<ResultItem[]> }) {
  const results = use(promise)
  const navigate = useNavigate()

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Inbox className="h-10 w-10 mb-3 text-slate-300" />
        <p className="text-sm font-medium">No results found</p>
        <p className="text-xs mt-1">Completed test runs will appear here</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run ID</TableHead>
          <TableHead>Subsystem</TableHead>
          <TableHead>Serial #</TableHead>
          <TableHead>Procedure</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Steps</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Operator</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((result) => (
          <TableRow
            key={result.id}
            className="cursor-pointer transition-colors hover:bg-slate-50/80 group"
            onClick={() => navigate(`/results/${result.id}`)}
          >
            <TableCell className="font-mono text-sm font-semibold text-slate-700">
              #{result.id}
            </TableCell>
            <TableCell>
              <div className="flex flex-col">
                <span className="font-medium text-sm">{result.subsystem_name ?? '--'}</span>
                {result.drawing_no && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {result.drawing_no}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="font-mono text-sm tabular-nums">{result.serial_number ?? '--'}</TableCell>
            <TableCell>
              <div className="flex flex-col">
                <span className="text-sm">{result.procedure_name ?? '--'}</span>
                {result.procedure_code && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {result.procedure_code}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell>
              {(() => {
                const cfg = statusConfig[result.status] ?? defaultStatusConfig
                const StatusIcon = cfg.icon
                return (
                  <Badge
                    variant="outline"
                    className={cfg.className}
                  >
                    <StatusIcon className="h-3 w-3 mr-1" />
                    {result.status.charAt(0).toUpperCase() + result.status.slice(1)}
                  </Badge>
                )
              })()}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1.5 text-sm tabular-nums">
                <span className="text-emerald-600 font-medium">{result.passed_steps}</span>
                <span className="text-muted-foreground/50">/</span>
                <span className="text-red-600 font-medium">{result.failed_steps}</span>
                <span className="text-muted-foreground/50">/</span>
                <span className="text-muted-foreground">{result.total_steps}</span>
              </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatDate(result.completed_at ?? result.started_at)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-between">
                <span className="text-sm">{result.operator_name ?? '--'}</span>
                <ChevronRight className="h-4 w-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3 p-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-12 animate-pulse rounded bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="h-4 w-36 animate-pulse rounded bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

export default function ResultsPage() {
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [subsystemFilter, setSubsystemFilter] = useState<string | null>(null)
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])

  // Fetch subsystems for the filter dropdown
  useEffect(() => {
    let cancelled = false
    api
      .get<Subsystem[]>('/subsystems')
      .then((data) => {
        if (!cancelled) setSubsystems(data)
      })
      .catch(() => {
        // Silently ignore — filter just won't show subsystems
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Re-create the promise whenever filters change, triggering Suspense
  const resultsPromise = useMemo(
    () => fetchResults(statusFilter, subsystemFilter),
    [statusFilter, subsystemFilter],
  )

  return (
    <div className="space-y-6">
      <title>Results - TPS-703 ATP</title>

      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
          <ClipboardList className="h-5 w-5 text-slate-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Test Results</h1>
          <p className="text-sm text-muted-foreground">
            View and filter completed acceptance test results
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Filter className="h-3 w-3" />
            Status
          </label>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value === '__all__' ? null : value)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Statuses</SelectItem>
              <SelectItem value="passed">Passed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="aborted">Aborted</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Filter className="h-3 w-3" />
            Subsystem
          </label>
          <Select
            value={subsystemFilter}
            onValueChange={(value) => setSubsystemFilter(value === '__all__' ? null : value)}
          >
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="All Subsystems" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Subsystems</SelectItem>
              {subsystems.map((sub) => (
                <SelectItem key={sub.id} value={String(sub.id)}>
                  {sub.drawing_no} - {sub.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results table */}
      <Card>
        <CardHeader>
          <CardTitle>Completed Test Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ResultsSkeleton />}>
            <ResultsTableContent promise={resultsPromise} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  )
}

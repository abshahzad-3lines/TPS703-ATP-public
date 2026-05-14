import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  ScrollText,
  AlertCircle,
  Loader2,
  ChevronDown,
  Inbox,
  User,
  LogIn,
  Plus,
  Play,
  Pause,
  RotateCcw,
  XCircle,
  CheckCircle2,
  Pencil,
  Trash2,
  Download,
  Shield,
  FileSignature,
  Filter,
  X,
  Activity,
  Clock,
  Hash,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEntry {
  id: number
  user_id: number | null
  user_full_name: string | null
  action: string
  entity_type: string | null
  entity_id: number | null
  details: string | null
  timestamp: string
}

const ENTITY_TYPES = ['All', 'test_run', 'uut', 'calibration', 'user', 'equipment'] as const
const ACTIONS = [
  'All', 'create', 'update', 'delete', 'start', 'pause', 'resume',
  'abort', 'complete', 'sign', 'login', 'export',
] as const

const PAGE_SIZE = 100

// ---------------------------------------------------------------------------
// Action config — icon, color, label
// ---------------------------------------------------------------------------

interface ActionConfig {
  icon: LucideIcon
  bg: string
  text: string
  border: string
  rowTint: string
  label: string
}

const ACTION_CONFIG: Record<string, ActionConfig> = {
  login:    { icon: LogIn,         bg: 'bg-blue-500',    text: 'text-white', border: 'border-l-blue-500',    rowTint: '', label: 'Login' },
  create:   { icon: Plus,          bg: 'bg-sky-500',     text: 'text-white', border: 'border-l-sky-500',     rowTint: '', label: 'Create' },
  update:   { icon: Pencil,        bg: 'bg-slate-500',   text: 'text-white', border: 'border-l-slate-400',   rowTint: '', label: 'Update' },
  delete:   { icon: Trash2,        bg: 'bg-red-500',     text: 'text-white', border: 'border-l-red-500',     rowTint: 'bg-red-50/40', label: 'Delete' },
  start:    { icon: Play,          bg: 'bg-emerald-500', text: 'text-white', border: 'border-l-emerald-500', rowTint: '', label: 'Start' },
  pause:    { icon: Pause,         bg: 'bg-amber-500',   text: 'text-white', border: 'border-l-amber-500',   rowTint: '', label: 'Pause' },
  resume:   { icon: RotateCcw,     bg: 'bg-emerald-500', text: 'text-white', border: 'border-l-emerald-500', rowTint: '', label: 'Resume' },
  abort:    { icon: XCircle,       bg: 'bg-red-500',     text: 'text-white', border: 'border-l-red-500',     rowTint: 'bg-red-50/40', label: 'Abort' },
  complete: { icon: CheckCircle2,  bg: 'bg-emerald-600', text: 'text-white', border: 'border-l-emerald-600', rowTint: 'bg-emerald-50/40', label: 'Complete' },
  sign:     { icon: FileSignature, bg: 'bg-violet-500',  text: 'text-white', border: 'border-l-violet-500',  rowTint: '', label: 'Sign-off' },
  export:   { icon: Download,      bg: 'bg-slate-500',   text: 'text-white', border: 'border-l-slate-400',   rowTint: '', label: 'Export' },
}

const DEFAULT_ACTION_CONFIG: ActionConfig = {
  icon: Activity, bg: 'bg-slate-400', text: 'text-white', border: 'border-l-slate-300', rowTint: '', label: 'Unknown',
}

function getConfig(action: string): ActionConfig {
  return ACTION_CONFIG[action] ?? DEFAULT_ACTION_CONFIG
}

// ---------------------------------------------------------------------------
// Entity type config
// ---------------------------------------------------------------------------

const ENTITY_LABELS: Record<string, { label: string; cls: string }> = {
  test_run:    { label: 'Test Run',    cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  uut:         { label: 'UUT',         cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  calibration: { label: 'Calibration', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  user:        { label: 'User',        cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  equipment:   { label: 'Equipment',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: string) {
  const d = new Date(ts + 'Z')
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return { date, time }
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts + 'Z').getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell className="py-3"><div className="h-4 w-4 rounded bg-slate-100 animate-pulse" /></TableCell>
          <TableCell className="py-3">
            <div className="space-y-1.5">
              <div className="h-3 w-24 rounded bg-slate-100 animate-pulse" />
              <div className="h-2.5 w-16 rounded bg-slate-100 animate-pulse" />
            </div>
          </TableCell>
          <TableCell className="py-3"><div className="h-4 w-28 rounded bg-slate-100 animate-pulse" /></TableCell>
          <TableCell className="py-3"><div className="h-5 w-16 rounded-full bg-slate-100 animate-pulse" /></TableCell>
          <TableCell className="py-3"><div className="h-5 w-20 rounded-full bg-slate-100 animate-pulse" /></TableCell>
          <TableCell className="py-3"><div className="h-4 w-8 rounded bg-slate-100 animate-pulse" /></TableCell>
          <TableCell className="py-3"><div className="h-3 w-56 rounded bg-slate-100 animate-pulse" /></TableCell>
        </TableRow>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: LucideIcon; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-white px-4 py-3">
      <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', color)}>
        <Icon className="h-4.5 w-4.5 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AuditTrailPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filter state
  const [sinceFilter, setSinceFilter] = useState('')
  const [untilFilter, setUntilFilter] = useState('')
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('All')
  const [actionFilter, setActionFilter] = useState<string>('All')

  // Applied filters
  const [appliedFilters, setAppliedFilters] = useState({
    since: '',
    until: '',
    entityType: 'All',
    action: 'All',
  })

  const hasActiveFilters =
    appliedFilters.since !== '' ||
    appliedFilters.until !== '' ||
    appliedFilters.entityType !== 'All' ||
    appliedFilters.action !== 'All'

  const fetchAuditLog = useCallback(
    async (currentOffset: number, append: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        params.set('limit', String(PAGE_SIZE))
        params.set('offset', String(currentOffset))

        if (appliedFilters.entityType && appliedFilters.entityType !== 'All') {
          params.set('entity_type', appliedFilters.entityType)
        }
        if (appliedFilters.action && appliedFilters.action !== 'All') {
          params.set('action', appliedFilters.action)
        }
        if (appliedFilters.since) {
          params.set('since', new Date(appliedFilters.since).toISOString())
        }
        if (appliedFilters.until) {
          params.set('until', new Date(appliedFilters.until).toISOString())
        }

        const data = await api.get<AuditEntry[]>(`/audit?${params.toString()}`)
        if (append) {
          setEntries(prev => [...prev, ...data])
        } else {
          setEntries(data)
        }
        setTotal(data.length < PAGE_SIZE ? currentOffset + data.length : currentOffset + PAGE_SIZE + 1)
        setOffset(currentOffset)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load audit log')
      } finally {
        setLoading(false)
      }
    },
    [appliedFilters],
  )

  useEffect(() => {
    fetchAuditLog(0, false)
  }, [fetchAuditLog])

  function handleApplyFilters() {
    setAppliedFilters({
      since: sinceFilter,
      until: untilFilter,
      entityType: entityTypeFilter ?? 'All',
      action: actionFilter ?? 'All',
    })
  }

  function handleClearFilters() {
    setSinceFilter('')
    setUntilFilter('')
    setEntityTypeFilter('All')
    setActionFilter('All')
    setAppliedFilters({ since: '', until: '', entityType: 'All', action: 'All' })
  }

  function handleLoadMore() {
    fetchAuditLog(offset + PAGE_SIZE, true)
  }

  const hasMore = entries.length < total

  // Compute stats from loaded entries
  const stats = {
    total: entries.length,
    logins: entries.filter(e => e.action === 'login').length,
    creates: entries.filter(e => e.action === 'create').length,
    testActions: entries.filter(e => ['start', 'pause', 'resume', 'abort', 'complete'].includes(e.action)).length,
    changes: entries.filter(e => ['update', 'delete', 'sign', 'export'].includes(e.action)).length,
  }

  return (
    <div className="space-y-6">
      <title>Audit Log - TPS-703 ATP</title>

      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 shadow-sm">
            <Shield className="h-5.5 w-5.5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Audit Trail</h1>
            <p className="text-sm text-muted-foreground">
              Append-only system log for all write operations
            </p>
          </div>
        </div>
        {!loading && entries.length > 0 && (
          <Badge variant="secondary" className="text-xs font-mono tabular-nums px-3 py-1">
            {entries.length} entries loaded
          </Badge>
        )}
      </div>

      {/* ── Summary stats ── */}
      {!loading && entries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total Entries" value={stats.total} icon={ScrollText} color="bg-slate-700" />
          <StatCard label="Logins" value={stats.logins} icon={LogIn} color="bg-blue-500" />
          <StatCard label="Created" value={stats.creates} icon={Plus} color="bg-sky-500" />
          <StatCard label="Test Actions" value={stats.testActions} icon={Play} color="bg-emerald-500" />
          <StatCard label="Changes & Signs" value={stats.changes} icon={FileSignature} color="bg-violet-500" />
        </div>
      )}

      {/* ── Filters ── */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Filters</CardTitle>
              {hasActiveFilters && (
                <Badge className="bg-blue-500 text-white text-[10px] px-1.5 py-0">Active</Badge>
              )}
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={handleClearFilters} className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1">
                <X className="h-3 w-3" />
                Clear All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pb-4 px-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <label className="block mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Since</label>
              <Input
                type="datetime-local"
                value={sinceFilter}
                onChange={e => setSinceFilter(e.target.value)}
                className="text-sm h-9"
              />
            </div>
            <div className="w-48">
              <label className="block mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Until</label>
              <Input
                type="datetime-local"
                value={untilFilter}
                onChange={e => setUntilFilter(e.target.value)}
                className="text-sm h-9"
              />
            </div>
            <div className="w-40">
              <label className="block mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Entity Type</label>
              <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
                <SelectTrigger className="w-full text-sm h-9">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map(et => (
                    <SelectItem key={et} value={et}>
                      {et === 'All' ? 'All Types' : (ENTITY_LABELS[et]?.label ?? et)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-36">
              <label className="block mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Action</label>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-full text-sm h-9">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map(a => (
                    <SelectItem key={a} value={a}>
                      {a === 'All' ? 'All Actions' : (ACTION_CONFIG[a]?.label ?? a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Button onClick={handleApplyFilters} className="h-9 px-5 gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Apply Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Error state ── */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {/* ── Audit log table ── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="w-[32px] pl-3 pr-0" />
                <TableHead className="w-[140px] text-[11px] uppercase tracking-wider font-semibold text-slate-500">Timestamp</TableHead>
                <TableHead className="w-[170px] text-[11px] uppercase tracking-wider font-semibold text-slate-500">User</TableHead>
                <TableHead className="w-[100px] text-[11px] uppercase tracking-wider font-semibold text-slate-500">Action</TableHead>
                <TableHead className="w-[110px] text-[11px] uppercase tracking-wider font-semibold text-slate-500">Entity</TableHead>
                <TableHead className="w-[50px] text-[11px] uppercase tracking-wider font-semibold text-slate-500 text-center">ID</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Loading skeleton */}
              {loading && entries.length === 0 && <TableSkeleton />}

              {/* Empty state */}
              {entries.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={7} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 mb-3">
                        <Inbox className="h-7 w-7 text-slate-300" />
                      </div>
                      <p className="text-sm font-semibold text-slate-500">No audit entries found</p>
                      <p className="text-xs mt-1 text-slate-400">
                        {hasActiveFilters ? 'Try adjusting your filters' : 'Entries will appear as system activity occurs'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {/* Data rows */}
              {entries.map(entry => {
                const cfg = getConfig(entry.action)
                const ActionIcon = cfg.icon
                const { date, time } = formatTimestamp(entry.timestamp)
                const relative = relativeTime(entry.timestamp)
                const entityCfg = entry.entity_type ? ENTITY_LABELS[entry.entity_type] : null

                return (
                  <TableRow
                    key={entry.id}
                    className={cn(
                      'transition-colors hover:bg-slate-50/80 border-l-[3px]',
                      cfg.border,
                      cfg.rowTint,
                    )}
                  >
                    {/* Action icon */}
                    <TableCell className="pl-3 pr-0 py-2.5">
                      <div className={cn('flex h-7 w-7 items-center justify-center rounded-md', cfg.bg)}>
                        <ActionIcon className={cn('h-3.5 w-3.5', cfg.text)} />
                      </div>
                    </TableCell>

                    {/* Timestamp */}
                    <TableCell className="py-2.5">
                      <div className="text-xs font-medium text-slate-700">{date}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] text-muted-foreground font-mono tabular-nums">{time}</span>
                        <span className="text-[10px] text-slate-400">{relative}</span>
                      </div>
                    </TableCell>

                    {/* User */}
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 shrink-0">
                          <User className="h-3 w-3 text-slate-500" />
                        </div>
                        <span className="text-sm font-medium text-slate-700 truncate max-w-[130px]">
                          {entry.user_full_name ?? 'System'}
                        </span>
                      </div>
                    </TableCell>

                    {/* Action badge */}
                    <TableCell className="py-2.5">
                      <Badge className={cn(cfg.bg, cfg.text, 'text-[11px] gap-1 px-2 py-0.5 font-medium')}>
                        <ActionIcon className="h-3 w-3" />
                        {cfg.label}
                      </Badge>
                    </TableCell>

                    {/* Entity type */}
                    <TableCell className="py-2.5">
                      {entityCfg ? (
                        <Badge variant="outline" className={cn('text-[11px] font-medium border', entityCfg.cls)}>
                          {entityCfg.label}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-300">--</span>
                      )}
                    </TableCell>

                    {/* Entity ID */}
                    <TableCell className="py-2.5 text-center">
                      {entry.entity_id != null ? (
                        <span className="inline-flex items-center gap-0.5 text-xs font-mono tabular-nums text-slate-500">
                          <Hash className="h-3 w-3 text-slate-300" />
                          {entry.entity_id}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">--</span>
                      )}
                    </TableCell>

                    {/* Details */}
                    <TableCell className="py-2.5">
                      {entry.details ? (
                        <p className="text-xs text-slate-600 leading-relaxed break-words max-w-md">
                          {entry.details}
                        </p>
                      ) : (
                        <span className="text-xs text-slate-300 italic">No details</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Loading indicator (for Load More) ── */}
      {loading && entries.length > 0 && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading more entries...</p>
        </div>
      )}

      {/* ── Pagination footer ── */}
      {!loading && entries.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-white px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{entries.length}</span> of{' '}
            <span className="font-semibold text-foreground">{total}</span> entries
          </p>
          {hasMore && (
            <Button variant="outline" onClick={handleLoadMore} className="gap-1.5">
              <ChevronDown className="h-4 w-4" />
              Load More
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

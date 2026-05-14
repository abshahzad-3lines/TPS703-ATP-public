import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Library,
  ChevronRight,
  ClipboardList,
  Shield,
  FlaskConical,
  ExternalLink,
  Clock,
  PackageSearch,
  Activity,
  TrendingUp,
  Target,
  Layers,
} from 'lucide-react'
import {
  ComposedChart,
  Area,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Subsystem {
  id: number
  drawing_no: string
  name: string
  assembly_no: string | null
  revision: string | null
  description: string | null
  rf_band_start_mhz: number | null
  rf_band_stop_mhz: number | null
  nominal_output_dbm: number | null
  nominal_output_watts: number | null
  procedure_count: number
}

interface Procedure {
  id: number
  code: string
  name: string
  section_ref: string | null
  sequence_order: number | null
  warmup_minutes: number | null
  step_count: number
  is_active: boolean
}

interface SubsystemDetail extends Subsystem {
  procedures: Procedure[]
}

interface TestRun {
  id: number
  subsystem_name: string | null
  drawing_no: string | null
  serial_number: string | null
  procedure_name: string | null
  status: string
  started_at: string | null
  completed_at: string | null
  operator_name: string | null
}

interface Equipment {
  id: number
  name: string
  model: string | null
  serial_number: string | null
  connection_type: string | null
  cal_due_date: string | null
  is_active: number
}

interface AnalyticsSummary {
  total_tests_30d: number
  total_tests_7d: number
  pass_rate_30d: number
  pass_rate_7d: number
  first_pass_yield: number
  active_subsystems: number
  pending_calibrations: number
}

interface DailyTrend {
  date: string
  total: number
  passed: number
  failed: number
  pass_rate: number
}

interface SubsystemBreakdown {
  drawing_no: string
  name: string
  passed: number
  failed: number
  total: number
  pass_rate: number
}

interface TopFailure {
  step_name: string
  procedure_code: string
  subsystem_name: string
  fail_count: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function passRateColor(rate: number): string {
  if (rate >= 90) return 'text-emerald-500'
  if (rate >= 70) return 'text-amber-500'
  return 'text-red-500'
}

function passRateBg(rate: number): string {
  if (rate >= 90) return 'bg-emerald-50'
  if (rate >= 70) return 'bg-amber-50'
  return 'bg-red-50'
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const statusStyles: Record<string, string> = {
  passed: 'bg-emerald-500 text-white hover:bg-emerald-600',
  failed: 'bg-red-500 text-white hover:bg-red-600',
  running: 'bg-blue-500 text-white hover:bg-blue-600',
  pending: 'bg-slate-500 text-white hover:bg-slate-600',
  paused: 'bg-amber-500 text-white hover:bg-amber-600',
  aborted: 'bg-red-300 text-white hover:bg-red-400',
}

function getCalStatus(calDueDate: string | null): { label: string; cls: string } {
  if (!calDueDate) return { label: 'No Cal Date', cls: 'bg-slate-100 text-slate-500' }
  const due = new Date(calDueDate)
  const now = new Date()
  const days = Math.ceil((due.getTime() - now.getTime()) / 86400000)
  if (days < 0) return { label: `Overdue ${Math.abs(days)}d`, cls: 'bg-red-500 text-white' }
  if (days <= 30) return { label: `${days}d left`, cls: 'bg-amber-500 text-white' }
  return { label: 'Valid', cls: 'bg-emerald-500 text-white' }
}

// ---------------------------------------------------------------------------
// Chevron icon
// ---------------------------------------------------------------------------

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <ChevronRight
      className={cn(
        'h-4 w-4 text-slate-400 transition-transform duration-200',
        open && 'rotate-90',
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const navigate = useNavigate()

  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [recentTests, setRecentTests] = useState<TestRun[]>([])
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)

  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null)
  const [dailyTrend, setDailyTrend] = useState<DailyTrend[]>([])
  const [subsystemBreakdown, setSubsystemBreakdown] = useState<SubsystemBreakdown[]>([])
  const [topFailures, setTopFailures] = useState<TopFailure[]>([])

  // Expanded assembly details — multiple can be open at once
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [expandedDetails, setExpandedDetails] = useState<Map<number, SubsystemDetail>>(new Map())
  const [detailLoadingIds, setDetailLoadingIds] = useState<Set<number>>(new Set())

  // Fetch all data on mount
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get<Subsystem[]>('/subsystems').catch(() => []),
      api.get<TestRun[]>('/test-runs/recent').catch(() => []),
      api.get<Equipment[]>('/equipment').catch(() => []),
      api.get<AnalyticsSummary>('/analytics/summary').catch(() => null),
      api.get<DailyTrend[]>('/analytics/daily-trend').catch(() => []),
      api.get<SubsystemBreakdown[]>('/analytics/subsystem-breakdown').catch(() => []),
      api.get<TopFailure[]>('/analytics/top-failures?limit=5').catch(() => []),
    ]).then(([subs, tests, equip, summary, trend, breakdown, failures]) => {
      if (!cancelled) {
        setSubsystems(subs)
        setRecentTests(tests)
        setEquipment(equip)
        setAnalytics(summary as AnalyticsSummary | null)
        setDailyTrend(trend as DailyTrend[])
        setSubsystemBreakdown(breakdown as SubsystemBreakdown[])
        setTopFailures(failures as TopFailure[])
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  // Toggle assembly expand — multiple can be open simultaneously
  async function handleToggleAssembly(id: number) {
    if (expandedIds.has(id)) {
      setExpandedIds(prev => { const next = new Set(prev); next.delete(id); return next })
      return
    }
    setExpandedIds(prev => new Set(prev).add(id))
    if (!expandedDetails.has(id)) {
      setDetailLoadingIds(prev => new Set(prev).add(id))
      try {
        const detail = await api.get<SubsystemDetail>(`/subsystems/${id}`)
        setExpandedDetails(prev => new Map(prev).set(id, detail))
      } catch {
        // leave detail missing — UI shows error state
      } finally {
        setDetailLoadingIds(prev => { const next = new Set(prev); next.delete(id); return next })
      }
    }
  }

  // Click a test row
  function handleTestClick(test: TestRun) {
    if (['running', 'paused', 'pending'].includes(test.status)) {
      navigate(`/test-execution/${test.id}`)
    } else {
      navigate(`/results/${test.id}`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <title>Dashboard - TPS-703 ATP</title>
        <p className="text-muted-foreground">Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div className="space-y-10">
      <title>Dashboard - TPS-703 ATP</title>
      <div>
        <div className="flex items-center gap-3 mb-1">
          <LayoutDashboard className="h-7 w-7 text-blue-600" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        </div>
        <p className="text-sm text-muted-foreground ml-10">
          TPS-703 Acceptance Test Procedure system overview
        </p>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          Analytics — KPI Cards + Charts
         ════════════════════════════════════════════════════════════════════ */}
      <section>
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Tests (7d)</p>
                  <p className="text-3xl font-bold text-slate-900">{analytics?.total_tests_7d ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">{analytics?.total_tests_30d ?? 0} in last 30 days</p>
                </div>
                <div className="rounded-lg bg-blue-50 p-3">
                  <Activity className="h-6 w-6 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pass Rate (7d)</p>
                  <p className={cn('text-3xl font-bold', passRateColor(analytics?.pass_rate_7d ?? 0))}>
                    {analytics?.pass_rate_7d ?? 0}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{analytics?.pass_rate_30d ?? 0}% over 30 days</p>
                </div>
                <div className={cn('rounded-lg p-3', passRateBg(analytics?.pass_rate_7d ?? 0))}>
                  <TrendingUp className={cn('h-6 w-6', passRateColor(analytics?.pass_rate_7d ?? 0))} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">First-Pass Yield</p>
                  <p className={cn('text-3xl font-bold', passRateColor(analytics?.first_pass_yield ?? 0))}>
                    {analytics?.first_pass_yield ?? 0}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Passed on first attempt</p>
                </div>
                <div className={cn('rounded-lg p-3', passRateBg(analytics?.first_pass_yield ?? 0))}>
                  <Target className={cn('h-6 w-6', passRateColor(analytics?.first_pass_yield ?? 0))} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Subsystems</p>
                  <p className="text-3xl font-bold text-slate-900">{analytics?.active_subsystems ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {analytics?.pending_calibrations ?? 0} calibration{(analytics?.pending_calibrations ?? 0) !== 1 ? 's' : ''} expiring soon
                  </p>
                </div>
                <div className="rounded-lg bg-slate-100 p-3">
                  <Layers className="h-6 w-6 text-slate-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 30-Day Trend Chart */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">30-Day Test Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {dailyTrend.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                No test data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={dailyTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(val: string) => {
                      const d = new Date(val + 'T00:00:00')
                      return `${d.getMonth() + 1}/${d.getDate()}`
                    }}
                  />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(val: number) => `${val}%`}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === 'pass_rate') return [`${value}%`, 'Pass Rate']
                      return [value, name.charAt(0).toUpperCase() + name.slice(1)]
                    }}
                    labelFormatter={(label: string) => {
                      const d = new Date(label + 'T00:00:00')
                      return d.toLocaleDateString()
                    }}
                  />
                  <Legend
                    formatter={(value: string) => {
                      if (value === 'pass_rate') return 'Pass Rate'
                      return value.charAt(0).toUpperCase() + value.slice(1)
                    }}
                  />
                  <Bar yAxisId="left" dataKey="passed" stackId="tests" fill="#10b981" name="passed" barSize={20} />
                  <Bar yAxisId="left" dataKey="failed" stackId="tests" fill="#ef4444" name="failed" barSize={20} />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="pass_rate"
                    stroke="#10b981"
                    fill="#10b981"
                    fillOpacity={0.1}
                    strokeWidth={2}
                    name="pass_rate"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Subsystem Breakdown + Top Failures side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Subsystem Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {subsystemBreakdown.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                  No test data yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(180, subsystemBreakdown.length * 55)}>
                  <BarChart
                    data={subsystemBreakdown}
                    layout="vertical"
                    margin={{ top: 5, right: 20, bottom: 5, left: 100 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={95} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="passed" stackId="tests" fill="#10b981" name="Passed" />
                    <Bar dataKey="failed" stackId="tests" fill="#ef4444" name="Failed" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top Failure Points</CardTitle>
            </CardHeader>
            <CardContent>
              {topFailures.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                  No failures recorded
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead className="text-xs">Step Name</TableHead>
                      <TableHead className="text-xs">Procedure</TableHead>
                      <TableHead className="text-xs text-right">Fails</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topFailures.map((f, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-sm font-medium">{f.step_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{f.procedure_code}</TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                            {f.fail_count}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* ════════════════════════════════════════════════════════════════════
          Library — Assemblies
         ════════════════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <Library className="h-5 w-5 text-slate-500" />
          <h2 className="text-xl font-semibold text-slate-800">Assembly Library</h2>
          <Badge variant="secondary" className="text-xs font-medium">{subsystems.length} assemblies</Badge>
        </div>

        <div className="space-y-2">
          {subsystems.map(sub => {
            const isExpanded = expandedIds.has(sub.id)
            const detail = isExpanded ? expandedDetails.get(sub.id) ?? null : null
            const isDetailLoading = detailLoadingIds.has(sub.id)

            return (
              <Card key={sub.id} className={cn(
                'transition-all duration-200 border',
                isExpanded
                  ? 'ring-2 ring-blue-200 shadow-md border-blue-200'
                  : 'hover:shadow-sm hover:border-slate-300',
              )}>
                {/* ── Clickable header ── */}
                <button
                  type="button"
                  onClick={() => handleToggleAssembly(sub.id)}
                  className="w-full text-left group"
                >
                  <div className="flex items-center justify-between px-5 py-3.5 rounded-lg group-hover:bg-slate-50/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <ChevronIcon open={isExpanded} />
                      <div className="flex items-baseline gap-2">
                        <span className="font-bold text-sm text-slate-900 font-mono">{sub.drawing_no}</span>
                        <span className="text-sm text-slate-600">{sub.name}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {sub.assembly_no && (
                        <span>Assy: <span className="font-medium text-foreground">{sub.assembly_no}</span></span>
                      )}
                      {sub.revision && (
                        <span>Rev {sub.revision}</span>
                      )}
                      {sub.nominal_output_watts != null && (
                        <Badge variant="outline" className="text-xs font-mono">{sub.nominal_output_watts}W</Badge>
                      )}
                      <Badge variant="secondary" className="text-xs">{sub.procedure_count} procedures</Badge>
                    </div>
                  </div>
                </button>

                {/* ── Expanded detail ── */}
                {isExpanded && (
                  <CardContent className="pt-0 pb-5 px-5">
                    <Separator className="mb-4" />

                    {isDetailLoading ? (
                      <p className="text-sm text-muted-foreground py-4">Loading details...</p>
                    ) : detail ? (
                      <div className="space-y-5">
                        {/* Introduction & Function */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-700 mb-2">Introduction & Function</h3>
                            <p className="text-sm text-slate-600">{detail.description ?? 'No description available.'}</p>
                          </div>

                          <div>
                            <h3 className="text-sm font-semibold text-slate-700 mb-2">Specifications</h3>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                              <div>
                                <span className="text-muted-foreground">Drawing No: </span>
                                <span className="font-mono font-medium">{detail.drawing_no}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Assembly No: </span>
                                <span className="font-mono font-medium">{detail.assembly_no ?? '--'}</span>
                              </div>
                              {detail.rf_band_start_mhz != null && detail.rf_band_stop_mhz != null && (
                                <div>
                                  <span className="text-muted-foreground">RF Band: </span>
                                  <span className="font-mono font-medium">{detail.rf_band_start_mhz}–{detail.rf_band_stop_mhz} MHz</span>
                                </div>
                              )}
                              {detail.nominal_output_dbm != null && (
                                <div>
                                  <span className="text-muted-foreground">Output: </span>
                                  <span className="font-mono font-medium">{detail.nominal_output_dbm} dBm ({detail.nominal_output_watts}W)</span>
                                </div>
                              )}
                              {detail.revision && (
                                <div>
                                  <span className="text-muted-foreground">Revision: </span>
                                  <span className="font-medium">{detail.revision}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Test Procedures */}
                        <div>
                          <h3 className="text-sm font-semibold text-slate-700 mb-2">Test Procedures</h3>
                          <div className="rounded-lg border overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-slate-50 hover:bg-slate-50">
                                  <TableHead className="text-xs">Code</TableHead>
                                  <TableHead className="text-xs">Procedure Name</TableHead>
                                  <TableHead className="text-xs">Section</TableHead>
                                  <TableHead className="text-xs text-center">Steps</TableHead>
                                  <TableHead className="text-xs text-center">Warmup</TableHead>
                                  <TableHead className="text-xs text-right">Action</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {detail.procedures.map(proc => (
                                  <TableRow key={proc.id} className="hover:bg-slate-50">
                                    <TableCell className="font-mono text-xs font-medium">{proc.code}</TableCell>
                                    <TableCell className="text-sm">{proc.name}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{proc.section_ref ?? '--'}</TableCell>
                                    <TableCell className="text-xs text-center font-mono">{proc.step_count}</TableCell>
                                    <TableCell className="text-xs text-center text-muted-foreground">
                                      {proc.warmup_minutes ? `${proc.warmup_minutes} min` : '--'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Link
                                        to={`/test-setup?subsystemId=${sub.id}&procedureId=${proc.id}`}
                                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline"
                                      >
                                        Start Test
                                        <ExternalLink className="h-3 w-3" />
                                      </Link>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-red-500 py-4">Failed to load details.</p>
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          Recent Tests — clickable rows
         ════════════════════════════════════════════════════════════════════ */}
      <Separator />

      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <ClipboardList className="h-5 w-5 text-slate-500" />
          <h2 className="text-xl font-semibold text-slate-800">Recent Tests</h2>
          {recentTests.length > 0 && (
            <Badge variant="secondary" className="text-xs font-medium">{recentTests.length}</Badge>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            {recentTests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <PackageSearch className="h-10 w-10 text-slate-300 mb-3" />
                <p className="text-sm font-medium text-slate-500">No test runs yet</p>
                <p className="text-xs mt-1.5">
                  Start a test from the <Link to="/test-setup" className="text-blue-600 hover:underline font-medium">Test Setup</Link> page
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="w-[70px]">Run</TableHead>
                    <TableHead>Assembly</TableHead>
                    <TableHead className="w-[130px]">Serial #</TableHead>
                    <TableHead>Procedure</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[170px]">Date</TableHead>
                    <TableHead className="w-[120px]">Operator</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentTests.map(test => (
                    <TableRow
                      key={test.id}
                      className="cursor-pointer hover:bg-blue-50/60 transition-colors group"
                      onClick={() => handleTestClick(test)}
                    >
                      <TableCell className="font-mono text-sm font-semibold text-blue-600 group-hover:text-blue-700">#{test.id}</TableCell>
                      <TableCell>
                        <span className="font-medium text-sm">{test.subsystem_name ?? '--'}</span>
                        {test.drawing_no && (
                          <span className="ml-2 text-xs text-muted-foreground font-mono">{test.drawing_no}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm tabular-nums text-slate-700">{test.serial_number ?? '--'}</TableCell>
                      <TableCell className="text-sm">{test.procedure_name ?? '--'}</TableCell>
                      <TableCell>
                        <Badge className={cn('text-xs', statusStyles[test.status] ?? 'bg-slate-400 text-white')}>
                          {test.status.charAt(0).toUpperCase() + test.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDate(test.completed_at ?? test.started_at)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{test.operator_name ?? '--'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          Test Equipment Calibration
         ════════════════════════════════════════════════════════════════════ */}
      <Separator />

      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <Shield className="h-5 w-5 text-slate-500" />
          <h2 className="text-xl font-semibold text-slate-800">Test Equipment Calibration</h2>
          {equipment.length > 0 && (
            <Badge variant="secondary" className="text-xs font-medium">{equipment.length} items</Badge>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            {equipment.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <FlaskConical className="h-10 w-10 text-slate-300 mb-3" />
                <p className="text-sm font-medium text-slate-500">No test equipment registered</p>
                <p className="text-xs mt-1.5">
                  Add equipment from the <Link to="/equipment" className="text-blue-600 hover:underline font-medium">Test Equipment</Link> page
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Equipment</TableHead>
                    <TableHead className="w-[160px]">Model</TableHead>
                    <TableHead className="w-[140px]">Serial No.</TableHead>
                    <TableHead className="w-[140px]">Cal Due Date</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.filter(e => e.is_active).map(eq => {
                    const cal = getCalStatus(eq.cal_due_date)
                    return (
                      <TableRow key={eq.id} className="hover:bg-slate-50/50 transition-colors">
                        <TableCell className="font-medium text-sm">{eq.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{eq.model ?? '--'}</TableCell>
                        <TableCell className="text-sm font-mono tabular-nums text-slate-600">{eq.serial_number ?? '--'}</TableCell>
                        <TableCell className="text-sm tabular-nums">{eq.cal_due_date ?? '--'}</TableCell>
                        <TableCell>
                          <Badge className={cn('text-xs', cal.cls)}>{cal.label}</Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

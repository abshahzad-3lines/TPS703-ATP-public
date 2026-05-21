import { useState, useEffect, useCallback, use } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthContext } from '@/contexts/AuthContext'
import {
  getDefinition, addStep, updateStep, deleteStep, reorderSteps,
  transition, validate, submitApproval, simulate, listSimulations,
  aiSafetyWarning, aiOrderReview,
  STEP_TYPES, STATE_COLORS, SOURCE_LABELS,
  type AtpDefinitionDetail, type AtpStep, type SimulationSummary,
} from '@/lib/atp'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, Save, Plus, Trash2, ChevronUp, ChevronDown, Sparkles,
  Send, Check, X, PlayCircle, Download, AlertCircle,
  ShieldAlert, CheckCircle2, Clock, GitBranch,
} from 'lucide-react'

type Tab = 'steps' | 'metadata' | 'history' | 'simulation' | 'ai'

const TAB_LABELS: Record<Exclude<Tab, 'ai'>, string> = {
  steps: 'Steps',
  metadata: 'Metadata',
  simulation: 'Simulated run',
  history: 'History',
}

export default function AtpDefinitionPage() {
  const { definitionId } = useParams()
  const navigate = useNavigate()
  const auth = use(AuthContext)
  const role = auth?.user?.role ?? 'viewer'
  const isEng = role === 'engineer' || role === 'admin'

  const [defn, setDefn] = useState<AtpDefinitionDetail | null>(null)
  const [issues, setIssues] = useState<string[] | null>(null)
  const [tab, setTab] = useState<Tab>('steps')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!definitionId) return
    setLoading(true)
    try {
      const d = await getDefinition(Number(definitionId))
      setDefn(d)
      const v = await validate(Number(definitionId))
      setIssues(v.issues)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [definitionId])

  useEffect(() => { refresh() }, [refresh])

  if (loading && !defn) {
    return <div className="p-6 text-muted-foreground">Loading…</div>
  }
  if (error && !defn) {
    return (
      <div className="p-6">
        <Alert variant="destructive"><AlertCircle className="size-4" />
          <AlertTitle>Couldn't load definition</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }
  if (!defn) return null

  const editable = defn.state === 'draft' && isEng
  const isAuthor = auth?.user?.id != null && defn.created_by === auth.user.id

  return (
    <div className="p-6 space-y-4 max-w-screen-2xl mx-auto">
      <title>{defn.code} rev {defn.revision} · ATP</title>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={() => navigate('/atp-author')} className="-ml-3">
            <ArrowLeft className="size-4 mr-1" /> Back to list
          </Button>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold font-mono">{defn.code}</h1>
            <Badge variant="outline" className="text-base px-2">rev {defn.revision}</Badge>
            <span className={cn('text-xs px-2 py-1 rounded border', STATE_COLORS[defn.state])}>
              {defn.state.replace('_', ' ')}
            </span>
            <span className="text-xs text-muted-foreground">{SOURCE_LABELS[defn.source]}</span>
          </div>
          <p className="text-sm text-muted-foreground">{defn.name}</p>
        </div>
        <ActionBar defn={defn} isAuthor={isAuthor} isEng={isEng} refresh={refresh} issues={issues ?? []} />
      </div>

      {issues && issues.length > 0 && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>{issues.length} validation issue(s) — must be resolved to publish</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 text-xs space-y-0.5 mt-1">
              {issues.slice(0, 6).map((i, idx) => <li key={idx}>{i}</li>)}
              {issues.length > 6 && <li className="text-muted-foreground">… and {issues.length - 6} more</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {issues && issues.length === 0 && (
        <Alert>
          <CheckCircle2 className="size-4 text-emerald-600" />
          <AlertTitle>Schema validation passing</AlertTitle>
        </Alert>
      )}

      {/* Tab strip */}
      <div className="flex gap-1 border-b">
        {(['steps','metadata','simulation','history','ai'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-4 py-2 text-sm border-b-2 -mb-px',
              tab === t ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t === 'ai'
              ? <span className="flex items-center gap-1"><Sparkles className="size-3.5" /> AI</span>
              : TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'steps' && <StepsTab defn={defn} editable={editable} refresh={refresh} />}
      {tab === 'metadata' && <MetadataTab defn={defn} editable={editable} refresh={refresh} />}
      {tab === 'simulation' && <SimulationTab defn={defn} isEng={isEng} />}
      {tab === 'history' && <HistoryTab defn={defn} />}
      {tab === 'ai' && <AiTab defn={defn} editable={editable} refresh={refresh} />}
    </div>
  )
}

// ============================================================================
// Action bar — state transitions
// ============================================================================

function ActionBar({
  defn, isAuthor, isEng, refresh, issues,
}: {
  defn: AtpDefinitionDetail
  isAuthor: boolean
  isEng: boolean
  refresh: () => void
  issues: string[]
}) {
  const [busy, setBusy] = useState(false)
  const apiBase = import.meta.env.VITE_API_URL ?? ''

  const act = async (fn: () => Promise<unknown>, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return
    setBusy(true)
    try { await fn(); refresh() }
    catch (e) { alert(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 justify-end">
      <a href={`${apiBase}/api/atp/definitions/${defn.id}/export`}
        target="_blank" rel="noreferrer">
        <Button variant="outline" size="sm">
          <Download className="size-4 mr-1" /> Export bundle
        </Button>
      </a>

      {defn.state === 'draft' && isEng && (
        <Button size="sm" disabled={busy}
          onClick={() => act(() => transition(defn.id, 'in_review'), 'Submit for peer review?')}>
          <Send className="size-4 mr-1" /> Submit for review
        </Button>
      )}

      {defn.state === 'in_review' && (
        <>
          {!isAuthor && isEng && (
            <>
              <Button size="sm" disabled={busy}
                onClick={() => act(() => submitApproval(defn.id, 'approve'))}>
                <Check className="size-4 mr-1" /> Approve
              </Button>
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => {
                  const c = prompt('Reason for rejection?')
                  if (c == null) return
                  act(() => submitApproval(defn.id, 'reject', c))
                }}>
                <X className="size-4 mr-1" /> Reject
              </Button>
            </>
          )}
          {isAuthor && isEng && (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => act(() => transition(defn.id, 'draft', 'author withdrawn'),
                                 'Withdraw this ATP back to draft?')}>
              Withdraw
            </Button>
          )}
        </>
      )}

      {defn.state === 'approved' && isEng && (
        <>
          <Button size="sm" disabled={busy || issues.length > 0}
            title={issues.length ? `${issues.length} validation issue(s) blocking publish` : undefined}
            onClick={() => act(() => transition(defn.id, 'published'),
                               'Publish this revision? Any prior published rev for the same code will be superseded.')}>
            <CheckCircle2 className="size-4 mr-1" /> Publish
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => act(() => transition(defn.id, 'draft', 'kicked back to draft for fixes'),
                               'Kick this back to draft?')}>
            Back to draft
          </Button>
        </>
      )}

      {defn.parent_definition_id && (
        <Link
          to={`/atp-author/diff/${defn.parent_definition_id}/${defn.id}`}
          className="inline-flex items-center px-2.5 h-7 text-[0.8rem] rounded-[12px] border border-border bg-background hover:bg-muted"
        >
          <GitBranch className="size-3.5 mr-1" /> Diff vs parent
        </Link>
      )}
    </div>
  )
}

// ============================================================================
// Steps tab
// ============================================================================

function StepsTab({
  defn, editable, refresh,
}: { defn: AtpDefinitionDetail; editable: boolean; refresh: () => void }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [addingOpen, setAddingOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const move = async (idx: number, dir: -1 | 1) => {
    const newOrder = [...defn.steps]
    const target = idx + dir
    if (target < 0 || target >= newOrder.length) return
    ;[newOrder[idx], newOrder[target]] = [newOrder[target], newOrder[idx]]
    setBusy(true)
    try { await reorderSteps(defn.id, newOrder.map(s => s.id)); refresh() }
    catch (e) { alert(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Steps</CardTitle>
          <CardDescription>{defn.steps.length} step(s).</CardDescription>
        </div>
        {editable && (
          <Button size="sm" onClick={() => setAddingOpen(true)}>
            <Plus className="size-4 mr-1" /> Add step
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Freq (MHz)</TableHead>
              <TableHead>Input (dBm)</TableHead>
              <TableHead>Limits</TableHead>
              <TableHead>Unit</TableHead>
              {editable && <TableHead className="w-32 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {defn.steps.length === 0 && (
              <TableRow><TableCell colSpan={editable ? 8 : 7} className="text-center py-8 text-muted-foreground">
                {editable ? 'No steps yet. Click "Add step" or use the AI extractor tab.' : 'This revision has no steps.'}
              </TableCell></TableRow>
            )}
            {defn.steps.map((s, idx) => (
              <TableRow key={s.id} className="hover:bg-muted/30 align-top">
                <TableCell className="tabular-nums text-xs">{s.step_number}</TableCell>
                <TableCell className="max-w-md">
                  <div className="font-medium">{s.name}</div>
                  {s.instructions && (
                    <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{s.instructions}</div>
                  )}
                  {s.safety_warning && (
                    <div className="text-xs text-red-600 mt-1 flex items-start gap-1">
                      <ShieldAlert className="size-3 mt-0.5 shrink-0" /> {s.safety_warning}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs font-mono">{s.step_type}</TableCell>
                <TableCell className="tabular-nums text-xs">{s.frequency_mhz ?? '—'}</TableCell>
                <TableCell className="tabular-nums text-xs">{s.input_power_dbm ?? '—'}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{formatLimits(s)}</TableCell>
                <TableCell className="text-xs">{s.unit ?? '—'}</TableCell>
                {editable && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" disabled={idx === 0 || busy} onClick={() => move(idx, -1)} title="Move up">
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" disabled={idx === defn.steps.length - 1 || busy} onClick={() => move(idx, 1)} title="Move down">
                        <ChevronDown className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(s.id)}>Edit</Button>
                      <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={async () => {
                        if (!confirm(`Delete step ${s.step_number}: ${s.name}?`)) return
                        try { await deleteStep(defn.id, s.id); refresh() }
                        catch (e) { alert(e instanceof Error ? e.message : String(e)) }
                      }}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      {addingOpen && (
        <StepEditorDialog
          defnId={defn.id} initial={null} nextNumber={defn.steps.length + 1}
          onClose={() => setAddingOpen(false)}
          onSaved={() => { setAddingOpen(false); refresh() }}
        />
      )}
      {editingId != null && (
        <StepEditorDialog
          defnId={defn.id} initial={defn.steps.find(s => s.id === editingId) ?? null}
          nextNumber={defn.steps.find(s => s.id === editingId)?.step_number ?? 1}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); refresh() }}
        />
      )}
    </Card>
  )
}

function formatLimits(s: AtpStep): string {
  if (s.is_record_only) return 'record-only'
  if (s.limit_nominal != null && s.limit_tolerance != null) return `${s.limit_nominal} ±${s.limit_tolerance}`
  if (s.limit_min != null && s.limit_max != null) return `[${s.limit_min}, ${s.limit_max}]`
  if (s.limit_min != null) return `≥ ${s.limit_min}`
  if (s.limit_max != null) return `≤ ${s.limit_max}`
  return '—'
}

// ============================================================================
// Step editor dialog
// ============================================================================

function StepEditorDialog({
  defnId, initial, nextNumber, onClose, onSaved,
}: {
  defnId: number
  initial: AtpStep | null
  nextNumber: number
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Partial<AtpStep>>(
    initial ?? {
      step_number: nextNumber, name: '', step_type: 'voltage',
      unit: 'V', is_optional: false, is_record_only: false,
    }
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const body = { ...form } as Partial<AtpStep>
      if (initial) await updateStep(defnId, initial.id, body)
      else await addStep(defnId, body)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const askAiForSafety = async () => {
    if (!initial) return
    setAiBusy(true)
    try {
      const r = await aiSafetyWarning(defnId, initial.id)
      if (r.safety_warning) setForm(f => ({ ...f, safety_warning: r.safety_warning }))
      else alert('Grok did not propose a warning (no safety concern detected).')
    } catch (e) { alert(e instanceof Error ? e.message : String(e)) }
    finally { setAiBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit step ${initial.step_number}` : 'Add step'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-2">
          <Field label="Step number" type="number" value={form.step_number ?? ''} onChange={v => setForm(f => ({ ...f, step_number: Number(v) }))} />
          <Field label="Type">
            <select
              value={form.step_type ?? ''}
              onChange={e => setForm(f => ({ ...f, step_type: e.target.value }))}
              className="w-full h-9 px-3 text-sm bg-background border rounded-md"
            >
              {STEP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Name" className="col-span-2" value={form.name ?? ''} onChange={v => setForm(f => ({ ...f, name: v }))} />
          <Field label="Frequency (MHz)" type="number" value={form.frequency_mhz ?? ''} onChange={v => setForm(f => ({ ...f, frequency_mhz: v === '' ? null : Number(v) }))} />
          <Field label="Input power (dBm)" type="number" value={form.input_power_dbm ?? ''} onChange={v => setForm(f => ({ ...f, input_power_dbm: v === '' ? null : Number(v) }))} />
          <Field label="Pulse width (μs)" type="number" value={form.pulse_width_us ?? ''} onChange={v => setForm(f => ({ ...f, pulse_width_us: v === '' ? null : Number(v) }))} />
          <Field label="Unit" value={form.unit ?? ''} onChange={v => setForm(f => ({ ...f, unit: v || null }))} />
          <Field label="Limit min" type="number" value={form.limit_min ?? ''} onChange={v => setForm(f => ({ ...f, limit_min: v === '' ? null : Number(v) }))} />
          <Field label="Limit max" type="number" value={form.limit_max ?? ''} onChange={v => setForm(f => ({ ...f, limit_max: v === '' ? null : Number(v) }))} />
          <Field label="Nominal" type="number" value={form.limit_nominal ?? ''} onChange={v => setForm(f => ({ ...f, limit_nominal: v === '' ? null : Number(v) }))} />
          <Field label="Tolerance" type="number" value={form.limit_tolerance ?? ''} onChange={v => setForm(f => ({ ...f, limit_tolerance: v === '' ? null : Number(v) }))} />
          <Field label="Instructions" className="col-span-2">
            <textarea
              value={form.instructions ?? ''}
              onChange={e => setForm(f => ({ ...f, instructions: e.target.value || null }))}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-background border rounded-md"
            />
          </Field>
          <Field label="Safety warning" className="col-span-2">
            <div className="flex gap-2 items-start">
              <textarea
                value={form.safety_warning ?? ''}
                onChange={e => setForm(f => ({ ...f, safety_warning: e.target.value || null }))}
                rows={2}
                className="flex-1 px-3 py-2 text-sm bg-background border rounded-md"
              />
              {initial && (
                <Button size="sm" variant="outline" disabled={aiBusy} onClick={askAiForSafety} title="Ask Grok">
                  <Sparkles className="size-4" />
                </Button>
              )}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.is_optional} onChange={e => setForm(f => ({ ...f, is_optional: e.target.checked }))} />
            Optional
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.is_record_only} onChange={e => setForm(f => ({ ...f, is_record_only: e.target.checked }))} />
            Record-only (no pass/fail)
          </label>
        </div>
        {error && <Alert variant="destructive" className="mt-3"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}><Save className="size-4 mr-1" /> {busy ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label, children, value, onChange, type = 'text', className,
}: {
  label: string
  children?: React.ReactNode
  value?: string | number
  onChange?: (v: string) => void
  type?: string
  className?: string
}) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children ?? (
        <Input type={type} value={value ?? ''} onChange={e => onChange?.(e.target.value)} className="mt-1" />
      )}
    </div>
  )
}

// ============================================================================
// Metadata tab
// ============================================================================

function MetadataTab({
  defn, editable,
}: { defn: AtpDefinitionDetail; editable: boolean; refresh: () => void }) {
  return (
    <Card>
      <CardContent className="pt-6 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <Meta label="Code" value={defn.code} />
        <Meta label="Revision" value={defn.revision} />
        <Meta label="Subsystem ID" value={defn.subsystem_id} />
        <Meta label="Section ref" value={defn.section_ref ?? '—'} />
        <Meta label="Sequence order" value={defn.sequence_order ?? '—'} />
        <Meta label="Warmup minutes" value={defn.warmup_minutes ?? 0} />
        <Meta label="Default pulse width (μs)" value={defn.default_pulse_width_us ?? '—'} />
        <Meta label="Requires calibration" value={defn.requires_calibration ? 'yes' : 'no'} />
        <Meta label="State" value={defn.state} />
        <Meta label="Source" value={SOURCE_LABELS[defn.source]} />
        <Meta label="Parent" value={defn.parent_definition_id ?? '—'} />
        <Meta label="Created at" value={defn.created_at ?? '—'} />
        <Meta label="Published at" value={defn.published_at ?? '—'} />
        <Meta label="Notes" value={defn.notes ?? '—'} className="col-span-2 whitespace-pre-wrap" />
        {!editable && (
          <Alert className="col-span-2 mt-2">
            <AlertDescription>
              Metadata is only editable in <b>draft</b> state.
              To change metadata on a published revision, clone it.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

function Meta({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{String(value)}</div>
    </div>
  )
}

// ============================================================================
// Simulation tab
// ============================================================================

function SimulationTab({ defn, isEng }: { defn: AtpDefinitionDetail; isEng: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SimulationSummary | null>(null)
  const [history, setHistory] = useState<{ id: number; pass_count: number; fail_count: number; skipped_count: number; simulated_at: string }[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { listSimulations(defn.id).then(setHistory).catch(() => {}) }, [defn.id])

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const r = await simulate(defn.id)
      setResult(r)
      const h = await listSimulations(defn.id)
      setHistory(h)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Simulated run</CardTitle>
          <CardDescription>
            Rehearse every step with simulated instrument readings to predict pass/fail
            before publishing. No real equipment or unit under test — this is a software
            dry-run, not a golden-unit comparison.
          </CardDescription>
        </div>
        {isEng && (
          <Button onClick={run} disabled={busy}>
            <PlayCircle className="size-4 mr-1" />{busy ? 'Running…' : 'Run simulation'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {result && (
          <div className="space-y-3">
            <div className="flex gap-4">
              <SimStat label="Pass" value={result.pass_count} colour="text-emerald-600" />
              <SimStat label="Fail" value={result.fail_count} colour="text-red-600" />
              <SimStat label="Skipped" value={result.skipped_count} colour="text-amber-600" />
            </div>
            {result.results && (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Measured</TableHead><TableHead>Limits</TableHead><TableHead>Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {result.results.map(r => (
                    <TableRow key={r.step_number}>
                      <TableCell className="tabular-nums">{r.step_number}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="font-mono text-xs">{r.step_type}</TableCell>
                      <TableCell className="tabular-nums">{r.measured ?? '—'} {r.unit}</TableCell>
                      <TableCell className="text-xs">{
                        r.limit_nominal != null && r.limit_tolerance != null
                          ? `${r.limit_nominal} ±${r.limit_tolerance}`
                          : `[${r.limit_min ?? '−∞'}, ${r.limit_max ?? '+∞'}]`
                      }</TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'pass' ? 'default' : r.status === 'fail' ? 'destructive' : 'outline'}>
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
        {history.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mt-4 mb-2">Past simulated runs</h4>
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Pass</TableHead><TableHead>Fail</TableHead><TableHead>Skip</TableHead></TableRow></TableHeader>
              <TableBody>
                {history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="text-xs text-muted-foreground">{h.simulated_at}</TableCell>
                    <TableCell className="text-emerald-700">{h.pass_count}</TableCell>
                    <TableCell className="text-red-700">{h.fail_count}</TableCell>
                    <TableCell className="text-amber-700">{h.skipped_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SimStat({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div className="px-4 py-3 border rounded bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-3xl font-bold tabular-nums', colour)}>{value}</div>
    </div>
  )
}

// ============================================================================
// History tab — transitions + approvals
// ============================================================================

function HistoryTab({ defn }: { defn: AtpDefinitionDetail }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="size-4" /> State transitions</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>By</TableHead><TableHead>When</TableHead><TableHead>Comment</TableHead></TableRow></TableHeader>
            <TableBody>
              {defn.transitions.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{t.from_state ?? '—'}</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline">{t.to_state}</Badge></TableCell>
                  <TableCell className="text-xs">{t.user_id ?? 'system'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.transitioned_at}</TableCell>
                  <TableCell className="text-xs">{t.comment ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Peer-review decisions</CardTitle></CardHeader>
        <CardContent>
          {defn.approvals.length === 0 && <div className="text-sm text-muted-foreground">No decisions recorded yet.</div>}
          <Table>
            <TableBody>
              {defn.approvals.map(a => (
                <TableRow key={a.id}>
                  <TableCell>
                    {a.decision === 'approve'
                      ? <Badge className="bg-emerald-600">approve</Badge>
                      : <Badge variant="destructive">reject</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">user #{a.approver_id}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.decided_at}</TableCell>
                  <TableCell className="text-xs">{a.comment ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// AI tab — ordering review + revision-impact
// ============================================================================

function AiTab({ defn }: { defn: AtpDefinitionDetail; editable: boolean; refresh: () => void }) {
  const [concerns, setConcerns] = useState<{ severity: string; category: string; step_numbers: number[]; message: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runOrderReview = async () => {
    setBusy(true); setError(null)
    try { const r = await aiOrderReview(defn.id); setConcerns(r.concerns) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="size-4 text-purple-600" /> AI step-ordering review</CardTitle>
            <CardDescription>Grok scans the sequence for missing warm-up, settling delays, dependency violations, duplicate stimuli.</CardDescription>
          </div>
          <Button onClick={runOrderReview} disabled={busy}>{busy ? 'Asking Grok…' : 'Review'}</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {concerns && concerns.length === 0 && (
            <Alert><CheckCircle2 className="size-4 text-emerald-600" /><AlertTitle>No concerns flagged</AlertTitle></Alert>
          )}
          {concerns?.map((c, i) => (
            <div key={i} className="border rounded p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant={c.severity === 'high' ? 'destructive' : 'outline'}>{c.severity}</Badge>
                <span className="font-mono text-xs">{c.category}</span>
                {c.step_numbers.length > 0 && (
                  <span className="text-xs text-muted-foreground">steps {c.step_numbers.join(', ')}</span>
                )}
              </div>
              <div>{c.message}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-step safety warning</CardTitle>
          <CardDescription>Use the AI button on each step in the Steps tab to draft a warning sentence.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Open the Steps tab → click <b>Edit</b> on a step → press the <Sparkles className="size-3 inline" /> button next to the safety-warning field.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

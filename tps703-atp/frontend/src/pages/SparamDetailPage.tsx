import { useState, useEffect, useCallback, use } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthContext } from '@/contexts/AuthContext'
import {
  getSweep, listMasks, listGoldenRefs, listCalSets,
  evaluateMask, compareWithGolden, deembed, createMask,
  aiAnomalies, aiNarrate, aiSuggestCal, aiExplainFailures,
  paramColor,
  type SparamDetail, type SparamMask, type GoldenRef, type CalSet,
  type MaskEvaluation, type CompareResult, type Anomaly,
} from '@/lib/sparam'
import SparamLineChart from '@/components/sparam/LineChart'
import SmithChart from '@/components/sparam/SmithChart'
import PolarChart from '@/components/sparam/PolarChart'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, Download, Sparkles, AlertCircle, CheckCircle2,
  GitCompare, Cable, ShieldAlert, Activity,
} from 'lucide-react'

type Tab = 'plots' | 'compare' | 'mask' | 'deembed' | 'ai'
type PlotKind = 'mag_db' | 'phase_deg' | 'group_delay_s' | 'smith' | 'polar'

export default function SparamDetailPage() {
  const { sweepId } = useParams()
  const navigate = useNavigate()
  const auth = use(AuthContext)
  const isEng = auth?.user?.role === 'engineer' || auth?.user?.role === 'admin'

  const [detail, setDetail] = useState<SparamDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('plots')
  const [plot, setPlot] = useState<PlotKind>('mag_db')
  const [activeParams, setActiveParams] = useState<Set<string>>(new Set(['s21', 's11']))

  const refresh = useCallback(async () => {
    if (!sweepId) return
    try { setDetail(await getSweep(Number(sweepId))) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [sweepId])

  useEffect(() => { refresh() }, [refresh])

  if (error) return (
    <div className="p-6">
      <Alert variant="destructive"><AlertCircle className="size-4" />
        <AlertTitle>Couldn't load sweep</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    </div>
  )
  if (!detail) return <div className="p-6 text-muted-foreground">Loading…</div>

  const { summary, viz } = detail
  const paramKeys = Object.keys(viz.params)
  const apiBase = import.meta.env.VITE_API_URL ?? ''

  return (
    <div className="p-6 space-y-4 max-w-screen-2xl mx-auto">
      <title>Sweep #{summary.id} · {summary.filename}</title>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={() => navigate('/sparam')} className="-ml-3">
            <ArrowLeft className="size-4 mr-1" /> Back to list
          </Button>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">Sweep #{summary.id}</h1>
            <Badge variant="outline">{summary.source.replace('_', ' ')}</Badge>
            <span className="text-sm text-muted-foreground">
              {summary.n_ports}-port · {summary.n_points} points · {(summary.f_start_hz/1e9).toFixed(3)}–{(summary.f_stop_hz/1e9).toFixed(3)} GHz · Z₀={summary.z0_ohm}Ω
            </span>
          </div>
          <p className="text-sm text-muted-foreground font-mono">{summary.filename}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href={`${apiBase}/api/sparam/sweeps/${summary.id}/touchstone`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm"><Download className="size-4 mr-1" /> .s{summary.n_ports}p</Button>
          </a>
          <a href={`${apiBase}/api/sparam/sweeps/${summary.id}/export?fmt=csv`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">.csv</Button>
          </a>
          <a href={`${apiBase}/api/sparam/sweeps/${summary.id}/export?fmt=mat`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">.mat</Button>
          </a>
          <a href={`${apiBase}/api/sparam/sweeps/${summary.id}/export?fmt=npz`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">.npz</Button>
          </a>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {([
          ['plots', 'Plots', Activity],
          ['compare', 'Compare vs golden', GitCompare],
          ['mask', 'Pass/fail mask', ShieldAlert],
          ['deembed', 'De-embed fixture', Cable],
          ['ai', 'AI', Sparkles],
        ] as const).map(([t, label, Icon]) => (
          <button
            key={t} onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm border-b-2 -mb-px flex items-center gap-1',
              tab === t ? 'border-blue-600 text-blue-700 font-medium'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'plots' && (
        <PlotsTab
          viz={viz}
          plot={plot} setPlot={setPlot}
          activeParams={activeParams} setActiveParams={setActiveParams}
          paramKeys={paramKeys}
        />
      )}
      {tab === 'compare' && <CompareTab sweepId={summary.id} subsystem_id={summary.subsystem_id} />}
      {tab === 'mask' && <MaskTab sweepId={summary.id} subsystem_id={summary.subsystem_id} viz={viz} isEng={isEng} />}
      {tab === 'deembed' && <DeembedTab sweepId={summary.id} isEng={isEng} onComplete={refresh} />}
      {tab === 'ai' && <AiTab sweepId={summary.id} subsystem_id={summary.subsystem_id} isEng={isEng} />}
    </div>
  )
}

// ============================================================================
// Plots tab
// ============================================================================

function PlotsTab({
  viz, plot, setPlot, activeParams, setActiveParams, paramKeys,
}: {
  viz: SparamDetail['viz']
  plot: PlotKind; setPlot: (p: PlotKind) => void
  activeParams: Set<string>; setActiveParams: (s: Set<string>) => void
  paramKeys: string[]
}) {
  const toggle = (p: string) => {
    const next = new Set(activeParams)
    if (next.has(p)) next.delete(p); else next.add(p)
    setActiveParams(next)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={plot} onValueChange={v => setPlot((v ?? 'mag_db') as PlotKind)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mag_db">Magnitude (dB)</SelectItem>
              <SelectItem value="phase_deg">Phase (°)</SelectItem>
              <SelectItem value="group_delay_s">Group delay (s)</SelectItem>
              <SelectItem value="smith">Smith chart</SelectItem>
              <SelectItem value="polar">Polar</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-1 flex-wrap">
            {paramKeys.map(p => (
              <button key={p} onClick={() => toggle(p)}
                className={cn(
                  'px-2 py-1 rounded text-xs font-mono border',
                  activeParams.has(p)
                    ? 'text-white border-transparent'
                    : 'bg-background text-muted-foreground border-border'
                )}
                style={activeParams.has(p) ? { backgroundColor: paramColor(p) } : undefined}>
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {(plot === 'mag_db' || plot === 'phase_deg' || plot === 'group_delay_s') && (
          <SparamLineChart
            freq_hz={viz.freq_hz}
            series={[...activeParams].filter(p => p in viz.params).map(p => ({
              name: p,
              values: plot === 'mag_db' ? viz.params[p].mag_db
                    : plot === 'phase_deg' ? viz.params[p].phase_deg
                    : viz.params[p].group_delay_s,
            }))}
            yLabel={
              plot === 'mag_db' ? '|S| (dB)'
              : plot === 'phase_deg' ? 'Phase (°)'
              : 'Group delay (s)'
            }
            height={420}
          />
        )}
        {plot === 'smith' && (
          <div className="flex justify-center">
            <SmithChart
              size={520}
              traces={[...activeParams].filter(p => p in viz.params).map(p => ({
                name: p,
                real: viz.params[p].real,
                imag: viz.params[p].imag,
              }))}
            />
          </div>
        )}
        {plot === 'polar' && (
          <div className="flex justify-center">
            <PolarChart
              size={420}
              traces={[...activeParams].filter(p => p in viz.params).map(p => ({
                name: p,
                mag: viz.params[p].mag_db.map(db => Math.pow(10, db / 20)),
                phase_rad: viz.params[p].phase_deg.map(d => (d * Math.PI) / 180),
              }))}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Compare tab
// ============================================================================

function CompareTab({ sweepId, subsystem_id }: { sweepId: number; subsystem_id: number | null }) {
  const [refs, setRefs] = useState<GoldenRef[]>([])
  const [pickedId, setPickedId] = useState<string>('')
  const [data, setData] = useState<CompareResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listGoldenRefs(subsystem_id ?? undefined).then(setRefs).catch(() => {})
  }, [subsystem_id])

  const run = async () => {
    if (!pickedId) return
    setBusy(true); setError(null)
    try { setData(await compareWithGolden(sweepId, Number(pickedId))) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Compare against golden unit</CardTitle>
        <CardDescription>
          Overlay this measured sweep against a stored sweep from a real known-good
          reference unit (the “golden” unit) and visualise the per-frequency delta.
          This is a measurement-to-measurement comparison — not a simulation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-end flex-wrap">
          <Select value={pickedId} onValueChange={v => setPickedId(v ?? '')}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Select golden reference…" /></SelectTrigger>
            <SelectContent>
              {refs.length === 0 && <SelectItem value="none" disabled>No golden refs registered</SelectItem>}
              {refs.map(r => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name} {r.uut_family ? `(${r.uut_family})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={run} disabled={!pickedId || busy}>
            <GitCompare className="size-4 mr-1" />{busy ? 'Comparing…' : 'Compare'}
          </Button>
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {data && (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2">|S| (dB) — measured vs golden</h4>
              <SparamLineChart
                freq_hz={data.measured.freq_hz}
                series={[
                  { name: 'S21 measured', values: data.measured.params.s21?.mag_db ?? [], color: '#f59e0b' },
                  { name: 'S21 golden',   values: interp(data.measured.freq_hz, data.golden.freq_hz, data.golden.params.s21?.mag_db ?? []), color: '#94a3b8' },
                  ...(data.measured.params.s11
                    ? [{ name: 'S11 measured', values: data.measured.params.s11.mag_db, color: '#3b82f6' }]
                    : []),
                ]}
                yLabel="|S| (dB)"
                height={300}
              />
            </div>
            {data.deltas && (
              <div>
                <h4 className="text-sm font-medium mb-2">Δ |S| (dB) — measured minus golden</h4>
                <SparamLineChart
                  freq_hz={data.measured.freq_hz}
                  series={Object.entries(data.deltas).map(([k, v]) => ({
                    name: k.toUpperCase(),
                    values: v.mag_db,
                    color: paramColor(k),
                  }))}
                  yLabel="Δ dB"
                  height={250}
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Simple linear-interpolation helper (golden onto measured grid)
function interp(targetX: number[], sourceX: number[], sourceY: number[]): number[] {
  if (sourceX.length < 2 || sourceY.length < 2) return targetX.map(() => NaN)
  const out: number[] = []
  let i = 0
  for (const x of targetX) {
    while (i < sourceX.length - 2 && sourceX[i + 1] < x) i++
    const x0 = sourceX[i], x1 = sourceX[i + 1]
    const y0 = sourceY[i], y1 = sourceY[i + 1]
    if (x <= x0) out.push(y0)
    else if (x >= x1) out.push(y1)
    else out.push(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0))
  }
  return out
}

// ============================================================================
// Mask tab
// ============================================================================

function MaskTab({
  sweepId, subsystem_id, viz, isEng,
}: {
  sweepId: number; subsystem_id: number | null
  viz: SparamDetail['viz']; isEng: boolean
}) {
  const [masks, setMasks] = useState<SparamMask[]>([])
  const [pickedId, setPickedId] = useState<string>('')
  const [result, setResult] = useState<MaskEvaluation | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const refresh = useCallback(() => {
    listMasks(subsystem_id ?? undefined).then(setMasks).catch(() => {})
  }, [subsystem_id])
  useEffect(() => { refresh() }, [refresh])

  const run = async () => {
    if (!pickedId) return
    setResult(await evaluateMask(sweepId, Number(pickedId)))
  }

  const pickedMask = masks.find(m => String(m.id) === pickedId)
  const bands = pickedMask ? JSON.parse(pickedMask.bands_json) : null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Pass / fail mask</CardTitle>
          <CardDescription>Evaluate the sweep against a frequency-banded mask.</CardDescription>
        </div>
        {isEng && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>+ New mask</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Select value={pickedId} onValueChange={v => setPickedId(v ?? '')}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Select mask…" /></SelectTrigger>
            <SelectContent>
              {masks.length === 0 && <SelectItem value="none" disabled>No masks defined</SelectItem>}
              {masks.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={run} disabled={!pickedId}>Evaluate</Button>
        </div>
        {result && (
          <div className="space-y-3">
            <Alert variant={result.passed ? 'default' : 'destructive'}>
              {result.passed
                ? <CheckCircle2 className="size-4 text-emerald-600" />
                : <ShieldAlert className="size-4" />}
              <AlertTitle>
                {result.passed ? 'PASS' : 'FAIL'} — {result.failed_count} / {result.band_count} bands failed
              </AlertTitle>
            </Alert>
            {bands && (
              <SparamLineChart
                freq_hz={viz.freq_hz}
                series={Array.from(new Set(bands.map((b: any) => b.param.toLowerCase()))).map(p => ({
                  name: (p as string).toUpperCase(),
                  values: viz.params[p as string]?.mag_db ?? [],
                  color: paramColor(p as string),
                }))}
                yLabel="|S| (dB)"
                height={320}
                maskBands={bands}
              />
            )}
            <Table>
              <TableHeader><TableRow>
                <TableHead>Band</TableHead><TableHead>Param</TableHead>
                <TableHead>Span (GHz)</TableHead><TableHead>Min/Max</TableHead>
                <TableHead>Worst</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {result.bands.map(b => (
                  <TableRow key={b.band_index}>
                    <TableCell>{b.band_index + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{b.param}</TableCell>
                    <TableCell className="tabular-nums">{(b.f_start_hz/1e9).toFixed(3)}–{(b.f_stop_hz/1e9).toFixed(3)}</TableCell>
                    <TableCell className="text-xs">[{b.min ?? '−∞'}, {b.max ?? '+∞'}]</TableCell>
                    <TableCell className="tabular-nums">{b.worst_value.toFixed(2)} @ {(b.worst_freq_hz/1e9).toFixed(3)} GHz</TableCell>
                    <TableCell>
                      <Badge variant={b.status === 'pass' ? 'default' : b.status === 'fail' ? 'destructive' : 'outline'}>
                        {b.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {createOpen && (
          <CreateMaskDialog
            subsystem_id={subsystem_id}
            onClose={() => setCreateOpen(false)}
            onCreated={() => { setCreateOpen(false); refresh() }}
          />
        )}
      </CardContent>
    </Card>
  )
}

function CreateMaskDialog({
  subsystem_id, onClose, onCreated,
}: { subsystem_id: number | null; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [fStart, setFStart] = useState('2.85')
  const [fStop, setFStop] = useState('3.05')
  const [param, setParam] = useState('s21')
  const [quantity, setQuantity] = useState<'mag_db'|'mag_linear'|'phase_deg'|'vswr'|'return_loss_db'>('mag_db')
  const [min, setMin] = useState('-3')
  const [max, setMax] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      await createMask({
        name, subsystem_id: subsystem_id ?? undefined,
        param, quantity,
        bands: [{
          f_start_hz: Number(fStart) * 1e9,
          f_stop_hz:  Number(fStop)  * 1e9,
          param, quantity,
          min: min === '' ? null : Number(min),
          max: max === '' ? null : Number(max),
        }],
      })
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create pass/fail mask</DialogTitle>
          <DialogDescription>One-band mask. Edit the JSON via the API for multi-band masks.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><label className="text-xs text-muted-foreground">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="K245 in-band loss" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground">f_start (GHz)</label>
              <Input value={fStart} onChange={e => setFStart(e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground">f_stop (GHz)</label>
              <Input value={fStop} onChange={e => setFStop(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground">Param</label>
              <Input value={param} onChange={e => setParam(e.target.value)} placeholder="s21" /></div>
            <div><label className="text-xs text-muted-foreground">Quantity</label>
              <Select value={quantity} onValueChange={v => setQuantity((v ?? 'mag_db') as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mag_db">mag_db</SelectItem>
                  <SelectItem value="mag_linear">mag_linear</SelectItem>
                  <SelectItem value="phase_deg">phase_deg</SelectItem>
                  <SelectItem value="vswr">vswr</SelectItem>
                  <SelectItem value="return_loss_db">return_loss_db</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground">Min</label>
              <Input value={min} onChange={e => setMin(e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground">Max</label>
              <Input value={max} onChange={e => setMax(e.target.value)} /></div>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!name || busy}>{busy ? 'Creating…' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// De-embed tab
// ============================================================================

function DeembedTab({ sweepId, isEng, onComplete }: { sweepId: number; isEng: boolean; onComplete: () => void }) {
  const [cals, setCals] = useState<CalSet[]>([])
  const [pickedId, setPickedId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<number | null>(null)

  useEffect(() => { listCalSets().then(setCals).catch(() => {}) }, [])

  const run = async () => {
    if (!pickedId) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      const newSweep = await deembed(sweepId, Number(pickedId))
      setSuccess(newSweep.id)
      onComplete()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fixture de-embedding (OSLT)</CardTitle>
        <CardDescription>
          Apply a calibration set to the raw sweep; the de-embedded result is stored as a new sweep
          linked back to this one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isEng && (
          <Alert><AlertDescription>De-embedding requires Engineer role.</AlertDescription></Alert>
        )}
        <div className="flex gap-2">
          <Select value={pickedId} onValueChange={v => setPickedId(v ?? '')}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Select cal set…" /></SelectTrigger>
            <SelectContent>
              {cals.length === 0 && <SelectItem value="none" disabled>No cal sets registered</SelectItem>}
              {cals.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.cal_type})</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={run} disabled={!pickedId || busy || !isEng}>
            {busy ? 'De-embedding…' : 'Apply calibration'}
          </Button>
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {success && (
          <Alert>
            <CheckCircle2 className="size-4 text-emerald-600" />
            <AlertTitle>De-embedded sweep created</AlertTitle>
            <AlertDescription>
              <Link to={`/sparam/${success}`} className="underline">Open sweep #{success}</Link>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

// ============================================================================
// AI tab
// ============================================================================

function AiTab({ sweepId, subsystem_id, isEng }: { sweepId: number; subsystem_id: number | null; isEng: boolean }) {
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null)
  const [narrative, setNarrative] = useState<string | null>(null)
  const [suggestCal, setSuggestCal] = useState<{ best_match_id: number | null; confidence: string; reason: string } | null>(null)
  const [explain, setExplain] = useState<string | null>(null)
  const [refs, setRefs] = useState<GoldenRef[]>([])
  const [masks, setMasks] = useState<SparamMask[]>([])
  const [pickedGoldenId, setPickedGoldenId] = useState<string>('')
  const [pickedMaskId, setPickedMaskId] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listGoldenRefs(subsystem_id ?? undefined).then(setRefs).catch(() => {})
    listMasks(subsystem_id ?? undefined).then(setMasks).catch(() => {})
  }, [subsystem_id])

  const wrap = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null)
    try { await fn() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  if (!isEng) return <Alert><AlertDescription>AI features require Engineer role.</AlertDescription></Alert>

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="size-4 text-purple-600" /> Anomaly detection</CardTitle>
            <CardDescription>Compares against this subsystem's historical sweeps.</CardDescription>
          </div>
          <Button disabled={!!busy} onClick={() => wrap('anomalies', async () => {
            const r = await aiAnomalies(sweepId); setAnomalies(r.anomalies)
          })}>
            {busy === 'anomalies' ? 'Asking…' : 'Detect'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {anomalies && anomalies.length === 0 && (
            <Alert><CheckCircle2 className="size-4 text-emerald-600" />
              <AlertTitle>No anomalies flagged</AlertTitle></Alert>
          )}
          {anomalies?.map((a, i) => (
            <div key={i} className="border rounded p-2 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant={a.severity === 'high' ? 'destructive' : 'outline'}>{a.severity}</Badge>
                <span className="font-mono text-xs">{a.kind}</span>
                {a.freq_ghz && <span className="text-xs text-muted-foreground">@ {a.freq_ghz} GHz</span>}
              </div>
              <div>{a.description}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="size-4 text-purple-600" /> Narrative vs golden</CardTitle>
          <CardDescription>Plain-English comparison against a chosen golden reference.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Select value={pickedGoldenId} onValueChange={v => setPickedGoldenId(v ?? '')}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Pick golden…" /></SelectTrigger>
              <SelectContent>
                {refs.length === 0 && <SelectItem value="none" disabled>No golden refs</SelectItem>}
                {refs.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button disabled={!pickedGoldenId || !!busy} onClick={() => wrap('narrate', async () => {
              const r = await aiNarrate(sweepId, Number(pickedGoldenId)); setNarrative(r.narrative)
            })}>{busy === 'narrate' ? 'Asking…' : 'Generate'}</Button>
          </div>
          {narrative && (
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm">{narrative}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="size-4 text-purple-600" /> Cal-set suggestion</CardTitle>
            <CardDescription>Matches the sweep's frequency span against registered cal sets.</CardDescription>
          </div>
          <Button disabled={!!busy} onClick={() => wrap('suggest', async () => {
            setSuggestCal(await aiSuggestCal(sweepId))
          })}>{busy === 'suggest' ? 'Asking…' : 'Suggest'}</Button>
        </CardHeader>
        <CardContent>
          {suggestCal && (
            <div className="text-sm space-y-1">
              <div>Best match: <b>{suggestCal.best_match_id ?? '—'}</b></div>
              <div>Confidence: <Badge variant="outline">{suggestCal.confidence}</Badge></div>
              <div className="text-muted-foreground">{suggestCal.reason}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="size-4 text-purple-600" /> Mask-failure explanation</CardTitle>
          <CardDescription>One paragraph on what failed and a likely cause.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Select value={pickedMaskId} onValueChange={v => setPickedMaskId(v ?? '')}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Pick mask…" /></SelectTrigger>
              <SelectContent>
                {masks.length === 0 && <SelectItem value="none" disabled>No masks</SelectItem>}
                {masks.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button disabled={!pickedMaskId || !!busy} onClick={() => wrap('explain', async () => {
              const r = await aiExplainFailures(sweepId, Number(pickedMaskId)); setExplain(r.explanation)
            })}>{busy === 'explain' ? 'Asking…' : 'Explain'}</Button>
          </div>
          {explain && <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm">{explain}</div>}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive" className="col-span-2">
          <AlertCircle className="size-4" /><AlertTitle>AI error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback, useActionState, use } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { AuthContext } from '@/contexts/AuthContext'
import {
  listDefinitions, createDraft, cloneDefinition, deleteDefinition,
  aiExtractFromDoc,
  type AtpDefinitionSummary, type AtpState, type UploadPreview,
  STATE_COLORS, SOURCE_LABELS,
} from '@/lib/atp'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { SubmitButton } from '@/components/layout/SubmitButton'
import { cn } from '@/lib/utils'
import {
  FileText, Plus, Copy, Trash2, Upload, Download, Sparkles, FilePlus2,
  AlertCircle,
} from 'lucide-react'

interface Subsystem {
  id: number
  drawing_no: string
  name: string
}

type FormResult =
  | { success: true; message: string }
  | { success: false; error: string }
  | null

const STATE_FILTERS: { value: AtpState | 'all'; label: string }[] = [
  { value: 'all', label: 'All states' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'superseded', label: 'Superseded' },
]

export default function AtpAuthorPage() {
  const auth = use(AuthContext)
  const navigate = useNavigate()
  const role = auth?.user?.role ?? 'viewer'
  const canEdit = role === 'engineer' || role === 'admin'

  const [defs, setDefs] = useState<AtpDefinitionSummary[]>([])
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subsystemFilter, setSubsystemFilter] = useState<string>('all')
  const [stateFilter, setStateFilter] = useState<AtpState | 'all'>('all')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const filters: Parameters<typeof listDefinitions>[0] = {}
      if (subsystemFilter !== 'all') filters.subsystem_id = Number(subsystemFilter)
      if (stateFilter !== 'all') filters.state = stateFilter
      const list = await listDefinitions(filters)
      setDefs(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [subsystemFilter, stateFilter])

  useEffect(() => {
    api.get<Subsystem[]>('/subsystems').then(setSubsystems).catch(() => {})
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const filtered = defs.filter(d => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
  })

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <title>ATP Author · TPS-703</title>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileText className="size-6 text-blue-600" />
            ATP Author
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Draft, review, publish, and import revisions of Acceptance Test Procedures.
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <>
              <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogTrigger render={<Button variant="outline" />}>
                  <Upload className="size-4 mr-2" /> Import .docx / .pdf
                </DialogTrigger>
                <ImportDialog onDone={() => { setImportOpen(false); refresh() }} subsystems={subsystems} />
              </Dialog>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger render={<Button />}>
                  <Plus className="size-4 mr-2" /> New draft
                </DialogTrigger>
                <CreateDraftDialog
                  subsystems={subsystems}
                  onDone={(id) => { setCreateOpen(false); navigate(`/atp-author/${id}`) }}
                />
              </Dialog>
            </>
          )}
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Couldn't load definitions</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search code or name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={subsystemFilter} onValueChange={v => setSubsystemFilter(v ?? 'all')}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subsystems</SelectItem>
                {subsystems.map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.drawing_no} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={stateFilter} onValueChange={v => setStateFilter((v ?? 'all') as AtpState | 'all')}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATE_FILTERS.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">
              {filtered.length} of {defs.length} revision(s)
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Rev</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Steps</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No definitions match.</TableCell></TableRow>
              )}
              {!loading && filtered.map(d => (
                <TableRow key={d.id} className="hover:bg-muted/40">
                  <TableCell className="font-mono text-sm">{d.code}</TableCell>
                  <TableCell><Badge variant="outline">{d.revision}</Badge></TableCell>
                  <TableCell>
                    <Link to={`/atp-author/${d.id}`} className="font-medium hover:underline">
                      {d.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className={cn('text-xs px-2 py-1 rounded border', STATE_COLORS[d.state])}>
                      {d.state.replace('_', ' ')}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {SOURCE_LABELS[d.source]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.step_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {d.updated_at ?? d.created_at ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Link
                        to={`/atp-author/${d.id}`}
                        className="inline-flex items-center px-2.5 h-7 text-[0.8rem] rounded-[12px] hover:bg-muted text-foreground"
                      >Open</Link>
                      {canEdit && (
                        <CloneButton id={d.id} onDone={refresh} />
                      )}
                      <a
                        href={`${import.meta.env.VITE_API_URL ?? ''}/api/atp/definitions/${d.id}/export`}
                        target="_blank" rel="noreferrer"
                        title="Download signed bundle"
                        className="inline-flex items-center justify-center h-8 w-8 rounded hover:bg-muted text-muted-foreground"
                      >
                        <Download className="size-4" />
                      </a>
                      {canEdit && d.state === 'draft' && (
                        <DeleteButton id={d.id} code={d.code} rev={d.revision} onDone={refresh} />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Helper components
// ----------------------------------------------------------------------------

function CloneButton({ id, onDone }: { id: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm" variant="ghost" disabled={busy}
      title="Clone as new draft"
      onClick={async () => {
        setBusy(true)
        try { await cloneDefinition(id); onDone() }
        catch (e) { alert(e instanceof Error ? e.message : String(e)) }
        finally { setBusy(false) }
      }}
    >
      <Copy className="size-4" />
    </Button>
  )
}

function DeleteButton({ id, code, rev, onDone }: { id: number; code: string; rev: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm" variant="ghost" disabled={busy}
      title="Delete draft"
      onClick={async () => {
        if (!confirm(`Delete draft ${code} rev ${rev}? This cannot be undone.`)) return
        setBusy(true)
        try { await deleteDefinition(id); onDone() }
        catch (e) { alert(e instanceof Error ? e.message : String(e)) }
        finally { setBusy(false) }
      }}
      className="text-red-600 hover:text-red-700"
    >
      <Trash2 className="size-4" />
    </Button>
  )
}

// ----------------------------------------------------------------------------
// Create draft dialog
// ----------------------------------------------------------------------------

function CreateDraftDialog({
  subsystems, onDone,
}: { subsystems: Subsystem[]; onDone: (id: number) => void }) {
  const [result, action] = useActionState(async (_: FormResult, fd: FormData) => {
    try {
      const body = {
        subsystem_id: Number(fd.get('subsystem_id')),
        code: String(fd.get('code') ?? '').trim(),
        name: String(fd.get('name') ?? '').trim(),
        revision: String(fd.get('revision') ?? 'A').trim() || 'A',
        section_ref: String(fd.get('section_ref') ?? '').trim() || null,
      }
      if (!body.code || !body.name || !body.subsystem_id) {
        return { success: false, error: 'Subsystem, code, and name are required.' } as FormResult
      }
      const created = await createDraft(body)
      onDone(created.id)
      return { success: true, message: `Created ${created.code} rev ${created.revision}` } as FormResult
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) } as FormResult
    }
  }, null)

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FilePlus2 className="size-5" /> Create new draft
        </DialogTitle>
        <DialogDescription>
          Starts a blank revision in <b>draft</b> state. You can also clone an existing revision from the list.
        </DialogDescription>
      </DialogHeader>
      <form action={action} className="space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Subsystem</label>
          <select name="subsystem_id" required className="w-full h-9 px-3 mt-1 text-sm bg-background border rounded-md">
            <option value="">— select —</option>
            {subsystems.map(s => (
              <option key={s.id} value={s.id}>{s.drawing_no} — {s.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Code</label>
            <Input name="code" required placeholder="K245-NEWTEST" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Revision</label>
            <Input name="revision" defaultValue="A" placeholder="A" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Procedure name</label>
          <Input name="name" required placeholder="Custom RF measurement procedure" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Section reference (optional)</label>
          <Input name="section_ref" placeholder="4.9" />
        </div>
        {result && !result.success && (
          <Alert variant="destructive"><AlertDescription>{result.error}</AlertDescription></Alert>
        )}
        <DialogFooter>
          <SubmitButton>Create draft</SubmitButton>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

// ----------------------------------------------------------------------------
// Import dialog (.docx / .pdf)
// ----------------------------------------------------------------------------

function ImportDialog({
  subsystems, onDone,
}: { subsystems: Subsystem[]; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<UploadPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [finalSubsystem, setFinalSubsystem] = useState<string>('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [useHeuristic, setUseHeuristic] = useState(true)
  const [useAi, setUseAi] = useState(false)
  const navigate = useNavigate()

  const upload = async () => {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const token = localStorage.getItem('token')
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/atp/imports/upload`, {
        method: 'POST', body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (!res.ok) throw new Error(await res.text())
      const p = await res.json() as UploadPreview
      setPreview(p)
      if (p.guessed_metadata.code) setCode(p.guessed_metadata.code)
      if (p.guessed_metadata.name) setName(p.guessed_metadata.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const finalize = async () => {
    if (!preview) return
    setBusy(true); setError(null)
    try {
      if (useAi) {
        const created = await aiExtractFromDoc({
          import_id: preview.import_id,
          subsystem_id: Number(finalSubsystem),
          code, name,
        })
        onDone()
        navigate(`/atp-author/${created.id}`)
        return
      }
      const created = await api.post<AtpDefinitionSummary>(
        `/atp/imports/${preview.import_id}/finalize`,
        {
          subsystem_id: Number(finalSubsystem), code, name,
          use_heuristic_steps: useHeuristic,
        },
      )
      onDone()
      navigate(`/atp-author/${created.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Upload className="size-5" /> Import ATP document
        </DialogTitle>
        <DialogDescription>
          Upload a .docx or .pdf. The deterministic extractor pulls the text + a heuristic step split.
          Optionally hand the text to Grok for full structured extraction.
        </DialogDescription>
      </DialogHeader>

      {!preview && (
        <div className="space-y-3">
          <Input type="file" accept=".docx,.pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <Button disabled={!file || busy} onClick={upload}>
            {busy ? 'Extracting…' : 'Extract'}
          </Button>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">
            Extracted from <b>{preview.filename}</b> · status <b>{preview.status}</b> · heuristic found <b>{preview.heuristic_steps.length}</b> step(s).
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Text preview ({preview.text_preview.length} chars)</summary>
            <pre className="mt-2 p-2 bg-muted rounded max-h-48 overflow-auto whitespace-pre-wrap">
              {preview.text_preview}
            </pre>
          </details>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Subsystem</label>
              <select value={finalSubsystem} onChange={e => setFinalSubsystem(e.target.value)}
                className="w-full h-9 px-3 mt-1 text-sm bg-background border rounded-md" required>
                <option value="">— select —</option>
                {subsystems.map(s => <option key={s.id} value={s.id}>{s.drawing_no} — {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Code</label>
              <Input value={code} onChange={e => setCode(e.target.value)} placeholder="ATP code" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Procedure name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Name from document" />
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={!useAi && useHeuristic} onChange={() => { setUseAi(false); setUseHeuristic(true) }} />
              Use heuristic split ({preview.heuristic_steps.length} steps)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!useAi && !useHeuristic} onChange={() => { setUseAi(false); setUseHeuristic(false) }} />
              Empty (I'll author from scratch)
            </label>
            <label className="flex items-center gap-2 text-purple-700">
              <input type="radio" checked={useAi} onChange={() => setUseAi(true)} />
              <Sparkles className="size-3.5" /> AI-extract via Grok
            </label>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPreview(null); setFile(null) }}>
              Re-upload
            </Button>
            <Button onClick={finalize} disabled={!finalSubsystem || !code || !name || busy}>
              {busy ? 'Creating…' : 'Create draft'}
            </Button>
          </DialogFooter>
        </div>
      )}
    </DialogContent>
  )
}

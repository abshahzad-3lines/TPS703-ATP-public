import { useState, useEffect, useCallback, use } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { AuthContext } from '@/contexts/AuthContext'
import { listSweeps, deleteSweep, type SparamSweep } from '@/lib/sparam'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Waves, Upload, Trash2, AlertCircle, Download } from 'lucide-react'

interface Subsystem { id: number; drawing_no: string; name: string }

const SOURCE_BADGE: Record<string, string> = {
  uploaded:    'bg-blue-100 text-blue-700 border-blue-300',
  captured:    'bg-emerald-100 text-emerald-700 border-emerald-300',
  de_embedded: 'bg-purple-100 text-purple-700 border-purple-300',
  golden_ref:  'bg-amber-100 text-amber-700 border-amber-300',
}

const SOURCE_LABEL: Record<string, string> = {
  uploaded:    'uploaded',
  captured:    'captured (VNA)',
  de_embedded: 'de-embedded',
  golden_ref:  'golden unit',
}

export default function SparamListPage() {
  const auth = use(AuthContext)
  const isEng = auth?.user?.role === 'engineer' || auth?.user?.role === 'admin'

  const [sweeps, setSweeps] = useState<SparamSweep[]>([])
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subsystemFilter, setSubsystemFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const filters: Parameters<typeof listSweeps>[0] = {}
      if (subsystemFilter !== 'all') filters.subsystem_id = Number(subsystemFilter)
      if (sourceFilter !== 'all') filters.source = sourceFilter
      const list = await listSweeps(filters)
      setSweeps(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [subsystemFilter, sourceFilter])

  useEffect(() => {
    api.get<Subsystem[]>('/subsystems').then(setSubsystems).catch(() => {})
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const upload = async (file: File) => {
    setUploadBusy(true); setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const token = localStorage.getItem('token')
      const url = `${import.meta.env.VITE_API_URL ?? ''}/api/sparam/sweeps/upload`
        + (subsystemFilter !== 'all' ? `?subsystem_id=${subsystemFilter}` : '')
      const res = await fetch(url, {
        method: 'POST', body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const d = body.detail
        if (d && typeof d === 'object' && 'line' in d) {
          throw new Error(`${d.message} (line ${d.line}${d.column ? `, col ${d.column}` : ''})`)
        }
        throw new Error(typeof d === 'string' ? d : JSON.stringify(d ?? body))
      }
      refresh()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e))
    } finally { setUploadBusy(false) }
  }

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <title>S-Parameter Sweeps · TPS-703</title>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Waves className="size-6 text-blue-600" />
            S-Parameter Sweeps
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload Touchstone (.sNp) files, de-embed fixtures, compare against golden units,
            and run pass/fail masks with AI assists.
          </p>
        </div>
        {isEng && (
          <div className="flex gap-2">
            <input
              id="sparam-upload-input"
              type="file"
              accept=".s1p,.s2p,.s3p,.s4p,.s5p,.s6p,.snp,.txt"
              hidden
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) upload(f)
                e.target.value = ''
              }}
            />
            <Button
              disabled={uploadBusy}
              onClick={() => document.getElementById('sparam-upload-input')?.click()}
            >
              <Upload className="size-4 mr-2" />
              {uploadBusy ? 'Uploading…' : 'Upload .sNp'}
            </Button>
          </div>
        )}
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Failed to load sweeps</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {uploadError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Upload rejected</AlertTitle>
          <AlertDescription className="font-mono text-xs">{uploadError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={subsystemFilter} onValueChange={v => setSubsystemFilter(v ?? 'all')}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subsystems</SelectItem>
                {subsystems.map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.drawing_no} — {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={v => setSourceFilter(v ?? 'all')}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="uploaded">Uploaded</SelectItem>
                <SelectItem value="captured">Captured (VNA)</SelectItem>
                <SelectItem value="de_embedded">De-embedded</SelectItem>
                <SelectItem value="golden_ref">Golden unit</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">
              {sweeps.length} sweep(s)
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Filename</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Ports</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead>Span (GHz)</TableHead>
                <TableHead>Z₀</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!loading && sweeps.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No sweeps yet. Upload a Touchstone file to start.
                </TableCell></TableRow>
              )}
              {!loading && sweeps.map(s => (
                <TableRow key={s.id} className="hover:bg-muted/30">
                  <TableCell className="tabular-nums text-xs">{s.id}</TableCell>
                  <TableCell>
                    <Link to={`/sparam/${s.id}`} className="font-medium hover:underline">
                      {s.filename ?? '—'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-1 rounded border ${SOURCE_BADGE[s.source] ?? ''}`}>
                      {SOURCE_LABEL[s.source] ?? s.source.replace('_', ' ')}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.n_ports}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.n_points}</TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {(s.f_start_hz / 1e9).toFixed(3)} – {(s.f_stop_hz / 1e9).toFixed(3)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">{s.z0_ohm}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {s.created_at}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Link to={`/sparam/${s.id}`}
                        className="inline-flex h-7 items-center px-2.5 rounded text-xs hover:bg-muted">
                        Open
                      </Link>
                      <a
                        href={`${import.meta.env.VITE_API_URL ?? ''}/api/sparam/sweeps/${s.id}/touchstone`}
                        target="_blank" rel="noreferrer"
                        title="Download Touchstone"
                        className="inline-flex items-center justify-center h-8 w-8 rounded hover:bg-muted text-muted-foreground"
                      >
                        <Download className="size-4" />
                      </a>
                      {isEng && (
                        <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700"
                          onClick={async () => {
                            if (!confirm(`Delete sweep ${s.id} (${s.filename})?`)) return
                            try { await deleteSweep(s.id); refresh() }
                            catch (e) { alert(e instanceof Error ? e.message : String(e)) }
                          }}>
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tools</CardTitle>
          <CardDescription>Cal sets, masks, and golden references live on the detail page of each sweep.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}


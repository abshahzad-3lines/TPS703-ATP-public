import { useState, useEffect, use } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AuthContext } from '@/contexts/AuthContext'
import { diff, aiImpactSummary, type AtpDiffResponse } from '@/lib/atp'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeft, GitBranch, Sparkles, AlertCircle, PlusCircle, MinusCircle, Edit3 } from 'lucide-react'

export default function AtpDiffPage() {
  const { baseId, targetId } = useParams()
  const navigate = useNavigate()
  const auth = use(AuthContext)
  const isEng = auth?.user?.role === 'engineer' || auth?.user?.role === 'admin'

  const [data, setData] = useState<AtpDiffResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    if (!baseId || !targetId) return
    diff(Number(baseId), Number(targetId))
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [baseId, targetId])

  const askAi = async () => {
    if (!baseId || !targetId) return
    setAiBusy(true); setAiError(null)
    try {
      const r = await aiImpactSummary(Number(baseId), Number(targetId))
      setAiSummary(r.summary)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally { setAiBusy(false) }
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive"><AlertCircle className="size-4" />
          <AlertTitle>Couldn't load diff</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }
  if (!data) return <div className="p-6 text-muted-foreground">Loading diff…</div>

  return (
    <div className="p-6 space-y-4 max-w-screen-2xl mx-auto">
      <title>Diff · {data.target.code} rev {data.base.revision}→{data.target.revision}</title>
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="-ml-3 mb-2">
          <ArrowLeft className="size-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <GitBranch className="size-6 text-blue-600" />
          Revision diff
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Comparing <b className="font-mono">{data.base.code}</b> rev <Badge variant="outline">{data.base.revision}</Badge> ({data.base.state})
          → rev <Badge variant="outline">{data.target.revision}</Badge> ({data.target.state})
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="size-4 text-purple-600" /> AI impact summary</CardTitle>
            <CardDescription>Plain-English ECR-ready paragraphs from Grok.</CardDescription>
          </div>
          {isEng && (
            <Button onClick={askAi} disabled={aiBusy}>
              {aiBusy ? 'Asking Grok…' : aiSummary ? 'Regenerate' : 'Generate summary'}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {aiError && <Alert variant="destructive"><AlertDescription>{aiError}</AlertDescription></Alert>}
          {aiSummary && <div className="prose prose-sm max-w-none whitespace-pre-wrap">{aiSummary}</div>}
          {!aiSummary && !aiError && (
            <div className="text-sm text-muted-foreground">
              Click <b>Generate summary</b> to get an ECR-ready description of what changed and why it matters.
            </div>
          )}
        </CardContent>
      </Card>

      {data.metadata_changes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Edit3 className="size-4 text-amber-600" /> Metadata changes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Field</TableHead><TableHead>Base ({data.base.revision})</TableHead><TableHead>Target ({data.target.revision})</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data.metadata_changes.map(c => (
                  <TableRow key={c.field}>
                    <TableCell className="font-mono text-xs">{c.field}</TableCell>
                    <TableCell className="text-xs"><DiffValue v={c.base} /></TableCell>
                    <TableCell className="text-xs"><DiffValue v={c.target} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step changes</CardTitle>
          <CardDescription>
            <span className="text-emerald-700 font-medium">{data.steps.added.length} added</span>{' · '}
            <span className="text-red-700 font-medium">{data.steps.removed.length} removed</span>{' · '}
            <span className="text-amber-700 font-medium">{data.steps.modified.length} modified</span>{' · '}
            <span className="text-muted-foreground">{data.steps.unchanged_count} unchanged</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.steps.added.length > 0 && (
            <section>
              <h4 className="text-sm font-medium mb-2 text-emerald-700 flex items-center gap-1">
                <PlusCircle className="size-4" /> Added
              </h4>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data.steps.added.map(s => (
                    <TableRow key={s.id} className="bg-emerald-50">
                      <TableCell>{s.step_number}</TableCell>
                      <TableCell>{s.name}</TableCell>
                      <TableCell className="font-mono text-xs">{s.step_type}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
          {data.steps.removed.length > 0 && (
            <section>
              <h4 className="text-sm font-medium mb-2 text-red-700 flex items-center gap-1">
                <MinusCircle className="size-4" /> Removed
              </h4>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data.steps.removed.map(s => (
                    <TableRow key={s.id} className="bg-red-50">
                      <TableCell>{s.step_number}</TableCell>
                      <TableCell className="line-through">{s.name}</TableCell>
                      <TableCell className="font-mono text-xs line-through">{s.step_type}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
          {data.steps.modified.length > 0 && (
            <section>
              <h4 className="text-sm font-medium mb-2 text-amber-700 flex items-center gap-1">
                <Edit3 className="size-4" /> Modified
              </h4>
              {data.steps.modified.map(m => (
                <div key={m.step_number} className="border rounded p-3 mb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline">#{m.step_number}</Badge>
                    <span className="font-medium">{m.name}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Field</TableHead><TableHead>Base ({data.base.revision})</TableHead><TableHead>Target ({data.target.revision})</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {m.changes.map(c => (
                        <TableRow key={c.field}>
                          <TableCell className="font-mono text-xs">{c.field}</TableCell>
                          <TableCell className="text-xs"><DiffValue v={c.base} /></TableCell>
                          <TableCell className="text-xs"><DiffValue v={c.target} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DiffValue({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-muted-foreground italic">null</span>
  if (typeof v === 'string') return <span>{v}</span>
  return <span className="font-mono">{JSON.stringify(v)}</span>
}

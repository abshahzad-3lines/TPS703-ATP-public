import { useState, useEffect, useCallback, use } from 'react'
import { api } from '@/lib/api'
import { AuthContext } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { Users, ShieldCheck, Plus, Trash2, Save, AlertCircle, Lock } from 'lucide-react'

interface Role { name: string; label: string; description: string | null; is_system: boolean; rank: number; grant_count: number }
interface AppPage { path: string; label: string; kind: 'page' | 'feature'; sort_order: number }
interface Profile { id: string; username: string; full_name: string; email: string | null; role: string; is_active: boolean }

export default function RolesPage() {
  const auth = use(AuthContext)
  const isSuper = !!auth?.user?.is_super_admin

  const [roles, setRoles] = useState<Role[]>([])
  const [pages, setPages] = useState<AppPage[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selected, setSelected] = useState<string>('')
  const [grants, setGrants] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newRole, setNewRole] = useState({ name: '', label: '' })

  const refresh = useCallback(async () => {
    try {
      const [r, p, pr] = await Promise.all([
        api.get<Role[]>('/roles'),
        api.get<AppPage[]>('/app-pages'),
        isSuper ? api.get<Profile[]>('/profiles') : Promise.resolve([] as Profile[]),
      ])
      setRoles(r); setPages(p); setProfiles(pr)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [isSuper])

  useEffect(() => { refresh() }, [refresh])

  const loadGrants = useCallback(async (role: string) => {
    setSelected(role); setDirty(false)
    const r = await api.get<{ data: { pages: string[] } }>(`/roles/${role}`)
    setGrants(new Set(r.data.pages))
  }, [])

  const toggle = (path: string) => {
    const next = new Set(grants)
    next.has(path) ? next.delete(path) : next.add(path)
    setGrants(next); setDirty(true)
  }

  const saveGrants = async () => {
    setBusy(true); setError(null); setMsg(null)
    try {
      await api.request(`/roles/${selected}/pages`, { method: 'PUT', body: JSON.stringify({ pages: [...grants] }) })
      setMsg(`Saved grants for "${selected}".`); setDirty(false); refresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const createRole = async () => {
    if (!newRole.name || !newRole.label) return
    setBusy(true); setError(null)
    try {
      await api.post('/roles', { name: newRole.name, label: newRole.label, rank: 30 })
      setNewRole({ name: '', label: '' }); setMsg(`Role "${newRole.name}" created.`); refresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const deleteRole = async (name: string) => {
    if (!confirm(`Delete role "${name}"? This cannot be undone.`)) return
    try { await api.request(`/roles/${name}`, { method: 'DELETE' }); if (selected === name) setSelected(''); refresh() }
    catch (e) { alert(e instanceof Error ? e.message : String(e)) }
  }

  const assignRole = async (profileId: string, role: string) => {
    try { await api.request(`/profiles/${profileId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }); refresh() }
    catch (e) { alert(e instanceof Error ? e.message : String(e)) }
  }

  const pageRows = pages.filter(p => p.kind === 'page')
  const featureRows = pages.filter(p => p.kind === 'feature')
  const selRole = roles.find(r => r.name === selected)
  const editable = isSuper && selected && selected !== 'super_admin'

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <title>Roles &amp; Access · TPS-703</title>
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Users className="size-6 text-blue-600" /> Roles &amp; Access
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isSuper
            ? 'Create roles, grant pages + features, and assign roles to users. Database-driven — changes take effect on the user\'s next page load.'
            : 'View the role catalogue. Editing requires the Super Admin role.'}
        </p>
      </header>

      {error && <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {msg && <Alert><ShieldCheck className="size-4 text-emerald-600" /><AlertDescription>{msg}</AlertDescription></Alert>}

      <div className="grid grid-cols-[300px_1fr] gap-6">
        {/* Roles list */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Roles</CardTitle>
            <CardDescription>{roles.length} defined</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {roles.map(r => (
              <button key={r.name} onClick={() => loadGrants(r.name)}
                className={cn('w-full text-left px-3 py-2 rounded-lg border flex items-center justify-between gap-2',
                  selected === r.name ? 'border-blue-600 bg-blue-50' : 'border-border hover:bg-muted')}>
                <div>
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {r.label}
                    {r.is_system && <Lock className="size-3 text-muted-foreground" />}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{r.name} · rank {r.rank} · {r.grant_count} grants</div>
                </div>
                {isSuper && !r.is_system && (
                  <span onClick={e => { e.stopPropagation(); deleteRole(r.name) }}
                    className="text-red-500 hover:text-red-700 p-1"><Trash2 className="size-4" /></span>
                )}
              </button>
            ))}
            {isSuper && (
              <div className="pt-3 mt-2 border-t space-y-2">
                <div className="text-xs font-medium text-muted-foreground">New role</div>
                <Input placeholder="name (e.g. auditor)" value={newRole.name}
                  onChange={e => setNewRole(s => ({ ...s, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} />
                <Input placeholder="Label (e.g. Auditor)" value={newRole.label}
                  onChange={e => setNewRole(s => ({ ...s, label: e.target.value }))} />
                <Button size="sm" className="w-full" disabled={busy || !newRole.name || !newRole.label} onClick={createRole}>
                  <Plus className="size-4 mr-1" /> Create role
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Grants editor */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">{selRole ? `${selRole.label} — access` : 'Select a role'}</CardTitle>
              <CardDescription>
                {selected === 'super_admin' ? 'Super Admin always has full access (not editable).'
                  : selRole ? `${grants.size} grants. Tick to allow, untick to revoke.`
                  : 'Pick a role on the left to view or edit its access.'}
              </CardDescription>
            </div>
            {editable && (
              <Button size="sm" disabled={!dirty || busy} onClick={saveGrants}>
                <Save className="size-4 mr-1" /> {busy ? 'Saving…' : 'Save grants'}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!selected && <div className="text-sm text-muted-foreground py-8 text-center">No role selected.</div>}
            {selected && (
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Pages</h4>
                  <div className="space-y-1.5">
                    {pageRows.map(p => (
                      <label key={p.path} className={cn('flex items-center gap-2 text-sm', !editable && 'opacity-70')}>
                        <Checkbox checked={grants.has(p.path)} disabled={!editable} onCheckedChange={() => toggle(p.path)} />
                        <span>{p.label}</span>
                        <span className="text-xs text-muted-foreground font-mono ml-auto">{p.path}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Features</h4>
                  <div className="space-y-1.5">
                    {featureRows.map(p => (
                      <label key={p.path} className={cn('flex items-center gap-2 text-sm', !editable && 'opacity-70')}>
                        <Checkbox checked={grants.has(p.path)} disabled={!editable} onCheckedChange={() => toggle(p.path)} />
                        <span>{p.label}</span>
                        <span className="text-xs text-muted-foreground font-mono ml-auto">{p.path.replace('feature:', '')}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* User assignments — super_admin only */}
      {isSuper && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Users</CardTitle>
            <CardDescription>Assign a role to each user.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Username</TableHead><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.username}</TableCell>
                    <TableCell>{p.full_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.email}</TableCell>
                    <TableCell>
                      <Select value={p.role} onValueChange={v => v && assignRole(p.id, v)}>
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {roles.map(r => <SelectItem key={r.name} value={r.name}>{r.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

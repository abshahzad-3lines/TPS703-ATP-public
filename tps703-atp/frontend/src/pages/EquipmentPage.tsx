import { useState, useEffect, useCallback, useActionState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { SubmitButton } from '@/components/layout/SubmitButton'
import { cn } from '@/lib/utils'
import {
  Wrench,
  Plus,
  Pencil,
  Trash2,
  PlugZap,
  Loader2,
  CheckCircle2,
  XCircle,
  PackageSearch,
  Cable,
  Radar,
  Activity,
  CheckSquare,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Equipment {
  id: number
  name: string
  model: string | null
  manufacturer: string | null
  serial_number: string | null
  connection_type: string | null
  connection_address: string | null
  cal_due_date: string | null
  is_active: number
  instrument_role: string | null
}

interface TestConnectionResult {
  success: boolean
  message: string
  idn_string?: string | null
}

interface DiscoveredInstrument {
  resource: string
  connection_type: string
  manufacturer: string | null
  model: string | null
  serial: string | null
  idn: string | null
  instrument_type: string | null
  host?: string | null
  port?: number | null
  service_type?: string | null
  already_registered: boolean
}

type FormResult =
  | { success: true; message: string }
  | { success: false; error: string }
  | null

const CONNECTION_TYPES = [
  { value: 'simulator', label: 'Simulator' },
  { value: 'gpib', label: 'GPIB' },
  { value: 'usb_tmc', label: 'USB-TMC' },
  { value: 'vxi11', label: 'VXI-11' },
  { value: 'tcp_scpi', label: 'TCP/SCPI' },
  { value: 'lan', label: 'LAN' },
] as const

const INSTRUMENT_ROLES = [
  { value: 'multimeter', label: 'Multimeter' },
  { value: 'power_meter', label: 'Power Meter' },
  { value: 'spectrum_analyzer', label: 'Spectrum Analyzer' },
  { value: 'oscilloscope', label: 'Oscilloscope' },
  { value: 'network_analyzer', label: 'Network Analyzer' },
  { value: 'phase_meter', label: 'Phase Meter' },
  { value: 'signal_generator', label: 'Signal Generator' },
  { value: 'fft_display', label: 'FFT Display' },
  { value: 'common_bus', label: 'Common Bus' },
] as const

function roleLabel(role: string | null | undefined): string {
  if (!role) return '--'
  const entry = INSTRUMENT_ROLES.find((r) => r.value === role)
  return entry ? entry.label : role
}

// ---------------------------------------------------------------------------
// Badge color mapping for connection types
// ---------------------------------------------------------------------------

function connectionBadgeClass(type: string | null): string {
  switch (type) {
    case 'simulator':
      return 'bg-slate-500 text-white'
    case 'gpib':
      return 'bg-blue-500 text-white'
    case 'usb_tmc':
      return 'bg-purple-500 text-white'
    case 'vxi11':
      return 'bg-cyan-500 text-white'
    case 'tcp_scpi':
      return 'bg-emerald-500 text-white'
    case 'lan':
      return 'bg-amber-500 text-white'
    default:
      return 'bg-slate-300 text-slate-700'
  }
}

function connectionLabel(type: string | null): string {
  const entry = CONNECTION_TYPES.find((c) => c.value === type)
  return entry ? entry.label : type ?? 'None'
}

// Use a sentinel to represent "no connection type selected" since shadcn Select
// does not allow empty string as a value.
const NONE_SENTINEL = '__none__'

// ---------------------------------------------------------------------------
// EquipmentPage
// ---------------------------------------------------------------------------

export default function EquipmentPage() {
  const navigate = useNavigate()
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null)

  // Connection test results keyed by equipment id
  const [testResults, setTestResults] = useState<Record<number, TestConnectionResult | 'loading'>>({})

  // Discovery state
  const [discoverDialogOpen, setDiscoverDialogOpen] = useState(false)
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [discovered, setDiscovered] = useState<DiscoveredInstrument[]>([])
  const [registeringKey, setRegisteringKey] = useState<string | null>(null)
  const [selectedDiscoveryKeys, setSelectedDiscoveryKeys] = useState<Set<string>>(new Set())
  const [registering, setRegistering] = useState(false)
  const [registerNotice, setRegisterNotice] = useState<string | null>(null)

  // Reconcile state — heal cached IPs to whatever the local network actually has
  const [reconcileLoading, setReconcileLoading] = useState(false)
  const [reconcileNotice, setReconcileNotice] = useState<string | null>(null)
  const [reconcileError, setReconcileError] = useState<string | null>(null)

  // ------ Data fetching ------

  const fetchEquipment = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<Equipment[]>('/equipment?is_active=1')
      setEquipment(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load equipment')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEquipment()
  }, [fetchEquipment])

  // ------ Add Equipment form action (React 19 useActionState) ------

  const [addResult, addAction] = useActionState<FormResult, FormData>(
    async (_prev, formData) => {
      try {
        const connType = formData.get('connection_type') as string
        const role = formData.get('instrument_role') as string
        const body = {
          name: formData.get('name') as string,
          model: (formData.get('model') as string) || null,
          manufacturer: (formData.get('manufacturer') as string) || null,
          serial_number: (formData.get('serial_number') as string) || null,
          connection_type: connType === NONE_SENTINEL ? null : connType || null,
          connection_address: (formData.get('connection_address') as string) || null,
          cal_due_date: (formData.get('cal_due_date') as string) || null,
          instrument_role: role === NONE_SENTINEL ? null : role || null,
          is_active: 1,
        }
        await api.post<Equipment>('/equipment', body)
        await fetchEquipment()
        setAddDialogOpen(false)
        return { success: true, message: 'Equipment added successfully' }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Failed to add equipment' }
      }
    },
    null,
  )

  // ------ Edit Equipment form action ------

  const [editResult, editAction] = useActionState<FormResult, FormData>(
    async (_prev, formData) => {
      try {
        const id = formData.get('equipment_id') as string
        const connType = formData.get('connection_type') as string
        const role = formData.get('instrument_role') as string
        const body = {
          name: formData.get('name') as string,
          model: (formData.get('model') as string) || null,
          manufacturer: (formData.get('manufacturer') as string) || null,
          serial_number: (formData.get('serial_number') as string) || null,
          connection_type: connType === NONE_SENTINEL ? null : connType || null,
          connection_address: (formData.get('connection_address') as string) || null,
          cal_due_date: (formData.get('cal_due_date') as string) || null,
          instrument_role: role === NONE_SENTINEL ? null : role || null,
        }
        await api.request<Equipment>(`/equipment/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        await fetchEquipment()
        setEditDialogOpen(false)
        setEditingEquipment(null)
        return { success: true, message: 'Equipment updated successfully' }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Failed to update equipment' }
      }
    },
    null,
  )

  // ------ Delete (soft-delete) handler ------

  async function handleDelete(id: number, name: string) {
    if (!window.confirm(`Are you sure you want to deactivate "${name}"?`)) return
    try {
      await api.request(`/equipment/${id}`, { method: 'DELETE' })
      await fetchEquipment()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete equipment')
    }
  }

  // ------ Test Connection handler ------

  async function handleTestConnection(id: number) {
    setTestResults((prev) => ({ ...prev, [id]: 'loading' }))
    try {
      const result = await api.post<TestConnectionResult>(`/equipment/${id}/test-connection`, {})
      setTestResults((prev) => ({ ...prev, [id]: result }))
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          success: false,
          message: e instanceof Error ? e.message : 'Connection test failed',
        },
      }))
    }
  }

  // ------ Open Edit dialog ------

  function openEditDialog(eq: Equipment) {
    setEditingEquipment(eq)
    setEditDialogOpen(true)
  }

  // ------ Discovery handlers ------

  function discoveryKey(d: DiscoveredInstrument): string {
    return d.serial?.trim() ? `sn:${d.serial.trim()}` : `res:${d.resource}`
  }

  async function openDiscoverDialog() {
    setDiscoverDialogOpen(true)
    setDiscoverError(null)
    setRegisterNotice(null)
    setDiscoverLoading(true)
    setDiscovered([])
    setSelectedDiscoveryKeys(new Set())
    try {
      const data = await api.post<DiscoveredInstrument[]>('/equipment/discover', {})
      setDiscovered(data)
      // Pre-select every entry that is not already registered
      const initial = new Set<string>()
      for (const entry of data) {
        if (!entry.already_registered) initial.add(discoveryKey(entry))
      }
      setSelectedDiscoveryKeys(initial)
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : 'Discovery failed')
    } finally {
      setDiscoverLoading(false)
    }
  }

  function toggleDiscoverySelection(key: string) {
    setSelectedDiscoveryKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleRegisterSelected() {
    setRegistering(true)
    setRegisterNotice(null)
    setDiscoverError(null)
    try {
      const accepted = discovered.filter(
        (d) => selectedDiscoveryKeys.has(discoveryKey(d)) && !d.already_registered,
      )
      if (accepted.length === 0) {
        setDiscoverError('No instruments selected to register')
        return
      }
      const created = await api.post<Equipment[]>('/equipment/auto-register', {
        instruments: accepted,
      })
      await fetchEquipment()
      setRegisterNotice(
        `Registered ${created.length} instrument${created.length === 1 ? '' : 's'}`,
      )
      setDiscoverDialogOpen(false)
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : 'Failed to register equipment')
    } finally {
      setRegistering(false)
    }
  }

  async function handleRegisterOne(entry: DiscoveredInstrument) {
    const key = discoveryKey(entry)
    setRegisteringKey(key)
    setDiscoverError(null)
    setRegisterNotice(null)
    try {
      if (entry.already_registered) {
        setDiscoverError('Already registered')
        return
      }
      const created = await api.post<Equipment[]>('/equipment/auto-register', {
        instruments: [entry],
      })
      await fetchEquipment()
      const fallbackName =
        [entry.manufacturer, entry.model].filter(Boolean).join(' ').trim() ||
        entry.resource
      const label = created[0]?.name ?? fallbackName
      setRegisterNotice(`Registered ${label}`)
      // Flip the row's status locally so the user sees the change without re-scanning.
      setDiscovered((prev) =>
        prev.map((d) =>
          discoveryKey(d) === key ? { ...d, already_registered: true } : d,
        ),
      )
      setSelectedDiscoveryKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : 'Failed to register equipment')
    } finally {
      setRegisteringKey(null)
    }
  }

  // ------ Network reconcile (heal cached IPs on the local network) ------

  async function handleReconcile() {
    setReconcileLoading(true)
    setReconcileError(null)
    setReconcileNotice(null)
    try {
      const stats = await api.post<{
        discovered: number
        healed: number
        inserted: number
        deactivated: number
      }>('/equipment/reconcile', {})
      setReconcileNotice(
        `Rescan complete — discovered ${stats.discovered}, healed ${stats.healed}, ` +
          `added ${stats.inserted}, deactivated ${stats.deactivated}.`,
      )
      await fetchEquipment()
    } catch (e) {
      setReconcileError(e instanceof Error ? e.message : 'Rescan failed')
    } finally {
      setReconcileLoading(false)
    }
  }

  // ------ Equipment form fields (shared between Add and Edit) ------

  function EquipmentFormFields({ defaults }: { defaults?: Equipment | null }) {
    const [connType, setConnType] = useState(defaults?.connection_type ?? NONE_SENTINEL)
    const [role, setRole] = useState(defaults?.instrument_role ?? NONE_SENTINEL)

    return (
      <div className="space-y-4">
        {defaults && <input type="hidden" name="equipment_id" value={defaults.id} />}

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Name <span className="text-red-500">*</span>
          </label>
          <Input name="name" required defaultValue={defaults?.name ?? ''} placeholder="e.g., HP 8563E Spectrum Analyzer" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Model</label>
            <Input name="model" defaultValue={defaults?.model ?? ''} placeholder="Model number" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Manufacturer</label>
            <Input name="manufacturer" defaultValue={defaults?.manufacturer ?? ''} placeholder="Manufacturer" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Serial Number</label>
          <Input name="serial_number" defaultValue={defaults?.serial_number ?? ''} placeholder="Test equipment serial number" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Connection Type</label>
            <Select name="connection_type" value={connType} onValueChange={setConnType}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SENTINEL}>None</SelectItem>
                {CONNECTION_TYPES.map((ct) => (
                  <SelectItem key={ct.value} value={ct.value}>
                    {ct.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="connection_type" value={connType} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Connection Address</label>
            <Input
              name="connection_address"
              defaultValue={defaults?.connection_address ?? ''}
              placeholder="e.g., GPIB0::18::INSTR or 192.168.1.10:5025"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Instrument Role</label>
            <Select name="instrument_role" value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select role..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SENTINEL}>None</SelectItem>
                {INSTRUMENT_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="instrument_role" value={role} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Calibration Due Date</label>
            <Input
              type="date"
              name="cal_due_date"
              defaultValue={defaults?.cal_due_date ?? ''}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <title>Test Equipment - TPS-703 ATP</title>

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Wrench className="h-7 w-7 text-blue-600" />
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Test Equipment</h1>
          </div>
          <p className="text-sm text-muted-foreground ml-10">Manage test equipment inventory and instrument connections</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleReconcile}
            disabled={reconcileLoading}
            title="Rescan the local network and heal stale IP addresses by instrument serial number"
          >
            {reconcileLoading ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <PlugZap className="h-4 w-4 mr-1.5" />
            )}
            Rescan Network
          </Button>
          <Button variant="outline" onClick={openDiscoverDialog} disabled={discoverLoading}>
            {discoverLoading ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Radar className="h-4 w-4 mr-1.5" />
            )}
            Discover
          </Button>

        {/* Add Equipment Dialog */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Equipment
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-blue-600" />
                Add Test Equipment
              </DialogTitle>
              <DialogDescription>
                Register a new piece of test equipment for use in acceptance tests
              </DialogDescription>
            </DialogHeader>
            <form action={addAction}>
              <EquipmentFormFields />
              {addResult && !addResult.success && (
                <Alert variant="destructive" className="mt-4">
                  <AlertDescription>{addResult.error}</AlertDescription>
                </Alert>
              )}
              <DialogFooter className="mt-4">
                <SubmitButton>Add Equipment</SubmitButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Reconcile feedback */}
      {reconcileError && (
        <Alert variant="destructive">
          <AlertTitle>Rescan failed</AlertTitle>
          <AlertDescription>{reconcileError}</AlertDescription>
        </Alert>
      )}
      {reconcileNotice && (
        <Alert>
          <AlertTitle>Network rescan</AlertTitle>
          <AlertDescription>{reconcileNotice}</AlertDescription>
        </Alert>
      )}

      {/* Test Equipment Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cable className="h-4 w-4 text-slate-500" />
            <CardTitle className="text-base">Equipment Inventory</CardTitle>
          </div>
          <CardDescription>
            {equipment.length} equipment record{equipment.length !== 1 ? 's' : ''} registered
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {equipment.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <PackageSearch className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-500">No test equipment registered</p>
              <p className="text-xs mt-1.5 text-slate-400">
                Click "Add Equipment" to register your first instrument
              </p>
            </div>
          ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="min-w-[180px]">Name</TableHead>
                <TableHead className="w-[120px]">Model</TableHead>
                <TableHead className="w-[120px]">Manufacturer</TableHead>
                <TableHead className="w-[120px]">Serial No.</TableHead>
                <TableHead className="w-[140px]">Role</TableHead>
                <TableHead className="w-[100px]">Connection</TableHead>
                <TableHead className="w-[180px]">Address</TableHead>
                <TableHead className="w-[110px]">Cal Due</TableHead>
                <TableHead className="w-[80px]">Status</TableHead>
                <TableHead className="w-[160px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipment.map((eq) => {
                const testResult = testResults[eq.id]
                return (
                  <TableRow key={eq.id} className={cn(
                    'transition-colors hover:bg-slate-50/50',
                    eq.is_active === 0 && 'opacity-50',
                  )}>
                    <TableCell className="font-medium text-sm">{eq.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{eq.model ?? '--'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{eq.manufacturer ?? '--'}</TableCell>
                    <TableCell className="text-sm font-mono tabular-nums text-slate-600">{eq.serial_number ?? '--'}</TableCell>
                    <TableCell>
                      {eq.instrument_role ? (
                        <Badge variant="secondary" className="text-xs">
                          {roleLabel(eq.instrument_role)}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {eq.connection_type ? (
                        <Badge className={cn('text-xs', connectionBadgeClass(eq.connection_type))}>
                          {connectionLabel(eq.connection_type)}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono max-w-[180px] truncate">
                      {eq.connection_address ?? '--'}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {eq.cal_due_date ? (
                        <span
                          className={cn(
                            new Date(eq.cal_due_date) < new Date()
                              ? 'text-red-600 font-medium'
                              : 'text-muted-foreground',
                          )}
                        >
                          {eq.cal_due_date}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {eq.is_active ? (
                        <Badge className="bg-emerald-500 text-white text-xs">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Test connection"
                          onClick={() => handleTestConnection(eq.id)}
                          disabled={testResult === 'loading'}
                        >
                          {testResult === 'loading'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <PlugZap className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50 hover:border-blue-200"
                          title="Open in Instrument Bench"
                          onClick={() => navigate(`/instrument-bench/${eq.id}`)}
                          disabled={eq.is_active === 0}
                        >
                          <Activity className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Edit equipment"
                          onClick={() => openEditDialog(eq)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
                          title="Delete equipment"
                          onClick={() => handleDelete(eq.id, eq.name)}
                          disabled={eq.is_active === 0}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {/* Test connection result */}
                      {testResult && testResult !== 'loading' && (
                        <div
                          className={cn(
                            'mt-2 text-xs text-left rounded-md px-2.5 py-1.5 border',
                            testResult.success
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-red-50 text-red-700 border-red-200',
                          )}
                        >
                          <p className="flex items-center gap-1.5">
                            {testResult.success
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                              : <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                            {testResult.message}
                          </p>
                          {testResult.idn_string && (
                            <p className="font-mono mt-1 text-[11px] pl-5">IDN: {testResult.idn_string}</p>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center justify-center py-4">
          <p className="text-muted-foreground">Loading test equipment...</p>
        </div>
      )}

      {/* Edit Test Equipment Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => {
        setEditDialogOpen(open)
        if (!open) setEditingEquipment(null)
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-blue-600" />
              Edit Test Equipment
            </DialogTitle>
            <DialogDescription>
              Update details for <span className="font-medium text-foreground">{editingEquipment?.name}</span>
            </DialogDescription>
          </DialogHeader>
          {editingEquipment && (
            <form action={editAction}>
              <EquipmentFormFields defaults={editingEquipment} />
              {editResult && !editResult.success && (
                <Alert variant="destructive" className="mt-4">
                  <AlertDescription>{editResult.error}</AlertDescription>
                </Alert>
              )}
              <DialogFooter className="mt-4">
                <SubmitButton>Save Changes</SubmitButton>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Register notice */}
      {registerNotice && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <AlertTitle>Registered</AlertTitle>
          <AlertDescription>{registerNotice}</AlertDescription>
        </Alert>
      )}

      {/* Discover Equipment Dialog */}
      <Dialog open={discoverDialogOpen} onOpenChange={setDiscoverDialogOpen}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radar className="h-5 w-5 text-blue-600" />
              Discover Test Equipment
            </DialogTitle>
            <DialogDescription>
              Scan VISA resources and listen for LAN instruments advertised over mDNS
            </DialogDescription>
          </DialogHeader>

          {discoverError && (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription>{discoverError}</AlertDescription>
            </Alert>
          )}

          {discoverLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-3 text-blue-500" />
              <p className="text-sm">Scanning for instruments...</p>
              <p className="text-xs mt-1 text-slate-400">This usually takes a few seconds</p>
            </div>
          ) : discovered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <PackageSearch className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-500">No instruments found</p>
              <p className="text-xs mt-1.5 text-slate-400">
                Make sure instruments are powered on and reachable on the LAN
              </p>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto overflow-x-hidden rounded-md border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="w-[44px]"></TableHead>
                    <TableHead className="w-[170px]">Manufacturer</TableHead>
                    <TableHead className="w-[110px]">Model</TableHead>
                    <TableHead className="w-[120px]">Serial</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead className="w-[150px] pr-4">Role</TableHead>
                    <TableHead className="w-[140px] pl-2">Status</TableHead>
                    <TableHead className="w-[60px] text-right pr-4">Add</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {discovered.map((d) => {
                    const key = discoveryKey(d)
                    const checked = selectedDiscoveryKeys.has(key)
                    const rowBusy = registeringKey === key
                    const anyBusy = registeringKey !== null || registering
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <Checkbox
                            checked={checked}
                            disabled={d.already_registered}
                            onCheckedChange={() => toggleDiscoverySelection(key)}
                          />
                        </TableCell>
                        <TableCell className="text-sm">{d.manufacturer ?? '--'}</TableCell>
                        <TableCell className="text-sm font-medium">{d.model ?? '--'}</TableCell>
                        <TableCell className="text-xs font-mono">{d.serial ?? '--'}</TableCell>
                        <TableCell
                          className="text-xs font-mono truncate"
                          title={d.host && d.port ? `${d.host}:${d.port}` : d.resource}
                        >
                          {d.host && d.port ? `${d.host}:${d.port}` : d.resource}
                        </TableCell>
                        <TableCell>
                          {d.instrument_type ? (
                            <Badge variant="secondary" className="text-xs">
                              {roleLabel(d.instrument_type)}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">unknown</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {d.already_registered ? (
                            <Badge variant="secondary" className="text-xs">Already registered</Badge>
                          ) : (
                            <Badge className="bg-emerald-500 text-white text-xs">New</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right pr-3">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={d.already_registered || anyBusy}
                            onClick={() => { void handleRegisterOne(d) }}
                            title={d.already_registered ? 'Already registered' : 'Register this instrument'}
                            className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 disabled:text-slate-300"
                          >
                            {rowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDiscoverDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const unregistered = discovered.filter((d) => !d.already_registered)
                const unregisteredKeys = unregistered.map(discoveryKey)
                const allSelected =
                  unregisteredKeys.length > 0 &&
                  unregisteredKeys.every((k) => selectedDiscoveryKeys.has(k))
                setSelectedDiscoveryKeys(allSelected ? new Set() : new Set(unregisteredKeys))
              }}
              disabled={
                discoverLoading ||
                discovered.length === 0 ||
                discovered.every((d) => d.already_registered)
              }
            >
              <CheckSquare className="h-4 w-4 mr-1.5" />
              Select all
            </Button>
            {(() => {
              const selectedCount = discovered.filter(
                (d) => selectedDiscoveryKeys.has(discoveryKey(d)) && !d.already_registered,
              ).length
              return (
                <Button
                  onClick={handleRegisterSelected}
                  disabled={registering || discoverLoading || registeringKey !== null || selectedCount === 0}
                >
                  {registering
                    ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    : <Plus className="h-4 w-4 mr-1.5" />}
                  Register selected
                  {selectedCount > 0 && ` (${selectedCount})`}
                </Button>
              )
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

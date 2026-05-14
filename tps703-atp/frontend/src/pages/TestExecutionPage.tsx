import { useState, useEffect, useCallback, useRef, useDeferredValue, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import TestControlBar from '@/components/test/TestControlBar'
import TestHeaderStrip from '@/components/test/TestHeaderStrip'
import DataSheetPreview from '@/components/test/DataSheetPreview'
import PowerMeterPanel from '@/components/instruments/PowerMeterPanel'
import SpectrumAnalyzerPanel from '@/components/instruments/SpectrumAnalyzerPanel'
import OscilloscopePanel from '@/components/instruments/OscilloscopePanel'
import MultimeterPanel from '@/components/instruments/MultimeterPanel'
import PhaseMeterPanel from '@/components/instruments/PhaseMeterPanel'
import NetworkAnalyzerPanel from '@/components/instruments/NetworkAnalyzerPanel'
import FFTDisplayPanel from '@/components/instruments/FFTDisplayPanel'
import CommonBusPanel, { type BusTransaction } from '@/components/instruments/CommonBusPanel'
import SignalGeneratorPanel from '@/components/instruments/SignalGeneratorPanel'
import { api } from '@/lib/api'
import { useEquipmentLiveReading } from '@/hooks/useEquipmentLiveReading'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ChevronDown } from 'lucide-react'

type TestStatus = 'pending' | 'running' | 'paused' | 'passed' | 'failed' | 'aborted'
type StepStatus = 'pass' | 'fail' | 'warning' | 'running' | 'pending' | 'skipped'
type ExecutionMode = 'manual' | 'auto'

interface StepData {
  id: number
  step_number: number
  name: string
  step_type: string
  instrument: string | null
  frequency_mhz: number | null
  input_power_dbm: number | null
  pulse_width_us: number | null
  limit_type: string | null
  limit_min: number | null
  limit_max: number | null
  limit_nominal: number | null
  limit_tolerance: number | null
  unit: string | null
  instructions: string | null
  safety_warning: string | null
  is_optional: boolean
  is_record_only: boolean
  measured_value: number | null
  pass_fail: StepStatus | null
  bus_address: string | null
  bus_data: string | null
}

interface RunStateResponse {
  run_id: number
  procedure_id: number
  uut_id: number
  execution_mode: 'simulator' | 'live' | string
  status: TestStatus
  current_step_index: number
  total_steps: number
  completed_steps: number
  started_at: string | null
  completed_at: string | null
  steps: StepData[]
  // Joined metadata for display
  subsystem_drawing_no: string | null
  subsystem_name: string | null
  procedure_code: string | null
  procedure_name: string | null
  serial_number: string | null
  operator_name: string | null
}

// ---------------------------------------------------------------------------
// Test equipment panel definitions
// ---------------------------------------------------------------------------

// Inputs (stimulus) appear on the left, outputs (measurement) on the right.
// New roles should be tagged accordingly so the dropdowns + columns split
// them automatically.
const EQUIPMENT_PANELS = [
  { key: 'signal_generator', label: 'Signal Generator', group: 'input'  },
  { key: 'power_meter',      label: 'Power Meter',       group: 'output' },
  { key: 'spectrum_analyzer', label: 'Spectrum Analyzer', group: 'output' },
  { key: 'oscilloscope',     label: 'Oscilloscope',      group: 'output' },
  { key: 'multimeter',       label: 'Multimeter',        group: 'output' },
  { key: 'phase_meter',      label: 'Phase Meter',       group: 'output' },
  { key: 'network_analyzer', label: 'Network Analyzer',  group: 'output' },
  { key: 'fft_display',      label: 'FFT Display',       group: 'output' },
  { key: 'common_bus',       label: 'Common Bus',        group: 'output' },
] as const

type EquipmentKey = typeof EQUIPMENT_PANELS[number]['key']

// Lightweight slice of the equipment record we need for panel binding
interface BoundEquipment {
  id: number
  name: string
  model: string | null
  manufacturer: string | null
  serial_number: string | null
  connection_type: string | null
  connection_address: string | null
  is_active: number
  instrument_role: string | null
}

/** Dropdown selector for one equipment group (input or output). Lists only
 *  registered + active roles in that group; shows binding metadata + IN-USE
 *  + CONNECTED tags per row. */
function EquipmentDropdown({
  group,
  equipmentByRole,
  visiblePanels,
  togglePanel,
  bindingSublabel,
  usedRoles,
  currentInstrument,
}: {
  group: 'input' | 'output'
  equipmentByRole: Partial<Record<EquipmentKey, BoundEquipment>>
  visiblePanels: Set<EquipmentKey>
  togglePanel: (k: EquipmentKey) => void
  bindingSublabel: (k: EquipmentKey) => string
  usedRoles: Set<EquipmentKey>
  currentInstrument: string | null
}) {
  const groupVisible = Array.from(visiblePanels).filter(
    k => EQUIPMENT_PANELS.find(p => p.key === k && p.group === group),
  ).length
  const connected = EQUIPMENT_PANELS.filter(
    p => p.group === group && !!equipmentByRole[p.key],
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="outline"
            className="w-full justify-between"
          >
            <span>
              {connected.length === 0
                ? 'No instruments'
                : groupVisible === 0
                  ? 'Select instruments…'
                  : `${groupVisible} instrument${groupVisible === 1 ? '' : 's'} shown`}
            </span>
            <ChevronDown className="h-4 w-4 opacity-60" />
          </Button>
        )}
      />
      <DropdownMenuContent align="start" className="w-[440px]">
        {connected.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            No {group} instruments registered.
          </div>
        ) : (
          connected.map(({ key, label }) => {
            const isActive = currentInstrument === key
            const isUsed = usedRoles.has(key)
            return (
              <DropdownMenuCheckboxItem
                key={key}
                checked={visiblePanels.has(key)}
                onCheckedChange={() => togglePanel(key)}
                className="gap-2 pr-2"
              >
                <div className="flex flex-col items-start min-w-0 mr-auto">
                  <span className="text-[12px] font-medium truncate">{label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[300px]">
                    {bindingSublabel(key)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isUsed && (
                    <span className="text-[9px] font-bold rounded px-1 bg-emerald-100 text-emerald-700">
                      IN USE
                    </span>
                  )}
                  <span
                    className={`text-[9px] font-bold rounded px-1 ${
                      isActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    CONNECTED
                  </span>
                </div>
              </DropdownMenuCheckboxItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Tiny strip rendered above each visible panel showing the registered
 *  equipment bound to the panel's role (or "No equipment registered" when
 *  none is active). Makes the role -> equipment binding visible at a glance. */
function BindingStrip({
  role,
  eq,
}: {
  role: string
  eq: BoundEquipment | undefined
}) {
  if (!eq) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 mb-1 rounded bg-rose-50 border border-rose-200 text-rose-800 text-[10px] font-mono">
        <span className="font-semibold uppercase tracking-wider">{role}</span>
        <span className="text-rose-600">No equipment registered</span>
      </div>
    )
  }
  const left = eq.model || eq.manufacturer || eq.name
  const addr = eq.connection_address || ''
  return (
    <div className="flex items-center gap-2 px-2 py-1 mb-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-[10px] font-mono">
      <span className="font-semibold uppercase tracking-wider text-emerald-700">{role}</span>
      <span className="font-semibold">{left}</span>
      {addr && <span className="text-emerald-700/80 truncate">{addr}</span>}
      {eq.serial_number && <span className="text-emerald-600/80 ml-auto">SN {eq.serial_number}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DMM streaming helper — pick the driver step_type to use for live readings
// based on the current procedure step. Defaults to mux_voltage (VDC) so the
// meter sits on a sensible function when nothing's running. Switching back
// to a non-DMM step keeps the meter on VDC rather than churning its config.
// ---------------------------------------------------------------------------

function dmmStreamStepType(currentStep: StepData | null): string {
  if (!currentStep) return 'mux_voltage'
  if (currentStep.instrument !== 'multimeter') return 'mux_voltage'
  switch (currentStep.step_type) {
    case 'current':
    case 'input_current':
      return 'current'
    case 'resistance':
      return 'resistance'
    case 'mux_voltage':
    case 'voltage_dc':
    default:
      return 'mux_voltage' // VDC
  }
}

/** Parse `OUTP?` text ("1\n", "0\n", "ON", "OFF") to a boolean. */
function parseOnOff(raw: string | null): boolean {
  if (!raw) return false
  const v = raw.trim().toUpperCase()
  return v === '1' || v === 'ON' || v === 'TRUE'
}

/** Extract the third pipe-separated value from `_measure_sg_status` raw_data. */
function sgOutputState(rawData: string | null): boolean {
  if (!rawData) return false
  const parts = rawData.split('|')
  return parseOnOff(parts[2] ?? null)
}

export default function TestExecutionPage() {
  const { runId } = useParams<{ runId: string }>()
  const wsRef = useRef<WebSocket | null>(null)

  const [testStatus, setTestStatus] = useState<TestStatus>('pending')
  const [executionModeRun, setExecutionModeRun] = useState<'simulator' | 'live' | null>(null)
  const [steps, setSteps] = useState<StepData[]>([])
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [subsystemName, setSubsystemName] = useState('')
  const [procedureName, setProcedureName] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [drawingNo, setDrawingNo] = useState('')
  const [procedureCode, setProcedureCode] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Measure the height of the sticky Inputs/Outputs panel so the data sheet
  // table header can stick BELOW it instead of overlapping. Updated via
  // ResizeObserver whenever instruments are added/removed or the panel wraps.
  const benchPanelRef = useRef<HTMLDivElement | null>(null)
  const [benchPanelHeight, setBenchPanelHeight] = useState(0)
  useEffect(() => {
    const el = benchPanelRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setBenchPanelHeight(Math.round(entry.contentRect.height))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Active equipment indexed by instrument_role for binding display.
  const [equipmentByRole, setEquipmentByRole] = useState<Partial<Record<EquipmentKey, BoundEquipment>>>({})

  // Which test equipment panels to show (users can toggle any on/off)
  const [visiblePanels, setVisiblePanels] = useState<Set<EquipmentKey>>(new Set())

  const togglePanel = useCallback((key: EquipmentKey) => {
    setVisiblePanels(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Auto-add the current step's instrument to visible panels — only if a
  // connected (registered) instrument exists for that role.
  useEffect(() => {
    const inst = steps[currentStepIndex]?.instrument as EquipmentKey | null
    if (inst && equipmentByRole[inst] && !visiblePanels.has(inst)) {
      setVisiblePanels(prev => new Set(prev).add(inst))
    }
  }, [currentStepIndex, steps, equipmentByRole])

  // When the equipment list first loads, default to showing every connected
  // instrument so the rack is populated without the operator having to open
  // the dropdown. Only fires once equipmentByRole has at least one entry and
  // visiblePanels is still empty.
  const equipmentLoadedRef = useRef(false)
  useEffect(() => {
    if (equipmentLoadedRef.current) return
    if (Object.keys(equipmentByRole).length === 0) return
    equipmentLoadedRef.current = true
    setVisiblePanels(prev => {
      if (prev.size > 0) return prev
      const next = new Set<EquipmentKey>()
      for (const role of Object.keys(equipmentByRole) as EquipmentKey[]) {
        next.add(role)
      }
      return next
    })
  }, [equipmentByRole])
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('manual')
  const [executionDelay, setExecutionDelay] = useState(0)
  const [waitingForTrigger, setWaitingForTrigger] = useState(false)

  // Deferred instrument data to avoid blocking UI
  const deferredSteps = useDeferredValue(steps)

  // Load registered equipment once so we can show what's bound to each role
  useEffect(() => {
    api.get<BoundEquipment[]>('/equipment?is_active=1')
      .then(rows => {
        const map: Partial<Record<EquipmentKey, BoundEquipment>> = {}
        for (const row of rows) {
          if (!row.instrument_role) continue
          // Only keep one active equipment per role — the first wins, which
          // matches the backend's `_resolve_driver_for_step` behaviour
          // (`ORDER BY id LIMIT 1`).
          const role = row.instrument_role as EquipmentKey
          if (!map[role]) map[role] = row
        }
        setEquipmentByRole(map)
      })
      .catch(() => {
        // Don't block the page on equipment load failure; the panels just
        // won't show binding metadata.
        setEquipmentByRole({})
      })
  }, [])

  // Load initial run state via REST
  useEffect(() => {
    if (!runId) return
    api.get<RunStateResponse>(`/test-runs/${runId}/state`)
      .then(data => {
        setTestStatus(data.status)
        setExecutionModeRun(data.execution_mode === 'live' ? 'live' : 'simulator')
        setSteps(data.steps || [])
        setCurrentStepIndex(data.current_step_index)
        setStartedAt(data.started_at)
        setDrawingNo(data.subsystem_drawing_no ?? '')
        setSubsystemName(data.subsystem_name ?? '')
        setProcedureCode(data.procedure_code ?? '')
        setProcedureName(data.procedure_name ?? '')
        setSerialNumber(data.serial_number ?? '')
        setOperatorName(data.operator_name ?? '')
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load test run'))
  }, [runId])

  // WebSocket connection
  useEffect(() => {
    if (!runId) return

    // Construct WebSocket URL.
    // In production (same origin), use the page host directly.
    // In dev, connect to the backend directly since Vite 8's WS proxy
    // conflicts with its own HMR WebSocket.
    const apiUrl = import.meta.env.VITE_API_URL as string | undefined
    let wsBase: string
    if (apiUrl) {
      wsBase = apiUrl.replace(/^http/, 'ws')
    } else if (import.meta.env.DEV) {
      wsBase = `ws://${window.location.hostname}:8005`
    } else {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      wsBase = `${wsProtocol}//${window.location.host}`
    }
    const ws = new WebSocket(`${wsBase}/ws/test/${runId}`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      switch (msg.type) {
        case 'state_change':
          setTestStatus(msg.status)
          break

        case 'step_start':
          setCurrentStepIndex(msg.step_index)
          setWaitingForTrigger(false)
          setSteps(prev => prev.map((s, i) =>
            i === msg.step_index ? { ...s, pass_fail: 'running' as const } : s
          ))
          break

        case 'step_result':
          setWaitingForTrigger(false)
          setSteps(prev => prev.map((s, i) =>
            i === msg.step_index
              ? { ...s, measured_value: msg.measured_value, pass_fail: msg.pass_fail }
              : s
          ))
          break

        case 'progress':
          // Progress is derived from steps, no separate state needed
          break

        case 'waiting_for_trigger':
          setWaitingForTrigger(true)
          break

        case 'mode_change':
          setExecutionMode(msg.mode ?? 'manual')
          setExecutionDelay(msg.delay ?? 0)
          break

        case 'error':
          setError(msg.message)
          break
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [runId])

  const sendCommand = useCallback((action: string, extra?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'command', action, ...extra }))
    }
  }, [])

  const sendTake = useCallback(() => {
    sendCommand('take')
  }, [sendCommand])

  const sendRetake = useCallback(() => {
    sendCommand('retake')
  }, [sendCommand])

  const sendRestart = useCallback(() => {
    sendCommand('restart')
    setCurrentStepIndex(0)
    setSteps(prev => prev.map(s => ({ ...s, measured_value: null, pass_fail: null })))
  }, [sendCommand])

  const sendSetMode = useCallback((mode: ExecutionMode, delay: number) => {
    sendCommand('set_mode', { mode, delay })
    setExecutionMode(mode)
    setExecutionDelay(delay)
  }, [sendCommand])

  // Accumulate bus transactions for CommonBusPanel
  const [busTransactions, setBusTransactions] = useState<BusTransaction[]>([])

  // Track bus transactions from step results
  useEffect(() => {
    const txns: BusTransaction[] = []
    for (const s of steps) {
      if ((s.step_type === 'bus_write' || s.step_type === 'bus_read') && s.pass_fail && s.pass_fail !== 'pending') {
        txns.push({
          rw: s.step_type === 'bus_write' ? 'W' : 'R',
          address: s.bus_address ?? '0x0000',
          expected: s.bus_data ?? '0x0000',
          actual: s.measured_value != null ? `0x${Math.round(s.measured_value).toString(16).toUpperCase().padStart(4, '0')}` : '—',
          passFail: (s.pass_fail === 'pass' || s.pass_fail === 'record_only') ? 'pass' : 'fail',
        })
      }
    }
    setBusTransactions(txns)
  }, [steps])

  const currentStep = steps[currentStepIndex] ?? null
  const currentResult = currentStep?.measured_value != null
    ? { measured_value: currentStep.measured_value, pass_fail: currentStep.pass_fail }
    : null

  // ---------------------------------------------------------------------------
  // Live equipment streams — open one bench WebSocket per *connected* role and
  // route the readings into the panels. This replaces the previous demo /
  // preview value synthesis: when a stream is down (or no equipment is bound),
  // the panel shows dashes rather than a fake number.
  //
  // Streams are only active in simulator-mode runs. In live mode the test
  // execution loop owns the driver, so we don't open a competing connection.
  // ---------------------------------------------------------------------------

  const streamsEnabled = executionModeRun === 'simulator'
  const dmmStepType = useMemo(() => dmmStreamStepType(currentStep), [currentStep])

  const dmmStream = useEquipmentLiveReading({
    equipmentId: equipmentByRole.multimeter?.id ?? null,
    enabled: streamsEnabled && !!equipmentByRole.multimeter,
    stepType: dmmStepType,
    intervalMs: 500,
  })
  const sgStream = useEquipmentLiveReading({
    equipmentId: equipmentByRole.signal_generator?.id ?? null,
    enabled: streamsEnabled && !!equipmentByRole.signal_generator,
    stepType: 'sg_status',
    intervalMs: 1000,
  })
  const pmStream = useEquipmentLiveReading({
    equipmentId: equipmentByRole.power_meter?.id ?? null,
    enabled: streamsEnabled && !!equipmentByRole.power_meter,
    stepType: 'pmeter_dual',
    intervalMs: 500,
  })

  /** Latest live reading for a given role (null when nothing is streaming or
   *  no equipment is connected). The Test Execution page never synthesises. */
  const liveValue = (role: EquipmentKey): number | null => {
    switch (role) {
      case 'multimeter':       return dmmStream.value
      case 'signal_generator': return sgStream.value
      case 'power_meter':      return pmStream.value
      default:                 return null
    }
  }

  /** Build a one-line sublabel showing the registered equipment bound to a role
   *  (e.g. "Keysight 34465A · 169.254.4.61") or "Not registered" when nothing
   *  is active for that role. */
  const bindingSublabel = (role: EquipmentKey): string => {
    const eq = equipmentByRole[role]
    if (!eq) return 'Not registered'
    const left = eq.model || eq.manufacturer || eq.name
    return eq.connection_address ? `${left} · ${eq.connection_address}` : left
  }

  /** Procedures used by the current run reference these roles (incl. the SG
   *  setup step we always insert at the top of RF-driving procedures). */
  const usedRoles = useMemo(() => {
    const roles = new Set<EquipmentKey>()
    for (const s of steps) {
      if (s.instrument && (EQUIPMENT_PANELS.find(p => p.key === s.instrument))) {
        roles.add(s.instrument as EquipmentKey)
      }
    }
    return roles
  }, [steps])

  if (!runId) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <title>Test Execution - TPS-703 ATP</title>
        <h2 className="text-2xl font-bold text-slate-900">Test Execution</h2>
        <p className="mt-2 text-slate-500">No test run selected. Start a test from the Test Setup page.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <title>Test Execution - TPS-703 ATP</title>
        <h2 className="text-2xl font-bold text-red-600">Error</h2>
        <p className="mt-2 text-slate-500">{error}</p>
      </div>
    )
  }

  const passedCount = deferredSteps.filter(s => s.pass_fail === 'pass').length
  const failedCount = deferredSteps.filter(s => s.pass_fail === 'fail').length
  const completedCount = deferredSteps.filter(
    s => s.pass_fail === 'pass' || s.pass_fail === 'fail' || s.pass_fail === 'warning' || s.pass_fail === 'skipped',
  ).length

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-3rem)]">
      <title>Test Execution - TPS-703 ATP</title>

      {/* Top context strip with action buttons embedded INSIDE the header.
          Subsystem/procedure/serial/operator/status/timer/progress + the
          Start / Pause / Abort / mode / Take buttons all live in one card. */}
      <div className="shrink-0">
        <TestHeaderStrip
          subsystemName={subsystemName || '—'}
          drawingNo={drawingNo || ''}
          procedureName={procedureName || '—'}
          procedureCode={procedureCode || ''}
          serialNumber={serialNumber || '—'}
          operatorName={operatorName || '—'}
          startedAt={startedAt}
          status={testStatus}
          executionMode={executionModeRun}
          completedSteps={completedCount}
          totalSteps={deferredSteps.length}
          passedCount={passedCount}
          failedCount={failedCount}
          controls={
            <TestControlBar
              status={testStatus}
              onStart={() => sendCommand('start')}
              onPause={() => sendCommand('pause')}
              onResume={() => sendCommand('resume')}
              onAbort={() => sendCommand('abort')}
              onTake={sendTake}
              onRetake={sendRetake}
              onRestart={sendRestart}
              onSetMode={sendSetMode}
              executionMode={executionMode}
              executionDelay={executionDelay}
              waitingForTrigger={waitingForTrigger}
              canRetake={currentStepIndex > 0 && testStatus === 'running'}
            />
          }
        />
      </div>

      {/* Row-based layout — Steps span full width at the top, then a
          left/right pair below for Inputs and Outputs (so the two instrument
          racks live where the operator's eyes naturally land: stimulus on
          the left of the bench, measurement on the right). Data sheet
          collapses at the bottom.
            (1) STEPS (full width)
            (2) [ INPUTS (bottom-left) | OUTPUTS (bottom-right) ]
            (3) DATA SHEET (collapsible) */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-3">

        {/* (1) Inputs + Outputs as a 2-column grid. Sticky so the live
            instrument readouts stay visible while the operator scrolls the
            data sheet below. The data sheet's column-header bar then sticks
            BELOW this panel using the measured height. */}
        <div
          ref={benchPanelRef}
          className="sticky top-0 z-20 bg-background pb-1 grid grid-cols-1 lg:grid-cols-2 gap-3"
        >

        {/* (2a) INPUTS — bottom left. */}
        <section className="rounded-lg border border-blue-200 bg-blue-50/30 p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex flex-col leading-tight">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                Inputs
              </span>
              <span className="text-[10px] text-slate-500">Stimulus instruments</span>
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {Array.from(visiblePanels).filter(k => EQUIPMENT_PANELS.find(p => p.key === k && p.group === 'input')).length}
              {' / '}
              {EQUIPMENT_PANELS.filter(p => p.group === 'input' && !!equipmentByRole[p.key]).length}
              {' shown'}
              {connected && <span className="ml-2 text-emerald-600">Test WS connected</span>}
            </div>
            <div className="w-[260px] shrink-0">
              <EquipmentDropdown
                group="input"
                equipmentByRole={equipmentByRole}
                visiblePanels={visiblePanels}
                togglePanel={togglePanel}
                bindingSublabel={bindingSublabel}
                usedRoles={usedRoles}
                currentInstrument={currentStep?.instrument ?? null}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {visiblePanels.has('signal_generator') && equipmentByRole.signal_generator && (
              <div className="flex flex-col w-[420px] shrink-0">
                <BindingStrip role="signal_generator" eq={equipmentByRole.signal_generator} />
                <SignalGeneratorPanel
                  frequencyHz={sgStream.value}
                  amplitudeDbm={sgStream.secondaryValue}
                  rfOn={sgOutputState(sgStream.rawData)}
                  pulseOn={
                    currentStep?.instrument === 'signal_generator' &&
                    currentStep.pulse_width_us != null
                  }
                  label={currentStep?.instrument === 'signal_generator' ? currentStep.name : 'Signal Generator'}
                  sublabel={bindingSublabel('signal_generator')}
                />
              </div>
            )}
            {Array.from(visiblePanels).filter(
              k => EQUIPMENT_PANELS.find(p => p.key === k && p.group === 'input'),
            ).length === 0 && (
              <div className="w-full text-center py-6 text-xs text-muted-foreground">
                No input instrument selected
              </div>
            )}
          </div>
        </section>

        {/* (2b) OUTPUTS — bottom right. */}
        <section className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex flex-col leading-tight">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                Outputs
              </span>
              <span className="text-[10px] text-slate-500">Measurement instruments</span>
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {Array.from(visiblePanels).filter(k => EQUIPMENT_PANELS.find(p => p.key === k && p.group === 'output')).length}
              {' / '}
              {EQUIPMENT_PANELS.filter(p => p.group === 'output' && !!equipmentByRole[p.key]).length}
              {' shown'}
            </div>
            <div className="w-[260px] shrink-0">
              <EquipmentDropdown
                group="output"
                equipmentByRole={equipmentByRole}
                visiblePanels={visiblePanels}
                togglePanel={togglePanel}
                bindingSublabel={bindingSublabel}
                usedRoles={usedRoles}
                currentInstrument={currentStep?.instrument ?? null}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {visiblePanels.has('power_meter') && equipmentByRole.power_meter && (
              <div className="flex flex-col w-[420px] shrink-0">
                <BindingStrip role="power_meter" eq={equipmentByRole.power_meter} />
                <PowerMeterPanel
                  value={pmStream.value}
                  unit={currentStep?.instrument === 'power_meter' ? (currentStep.unit ?? 'dBm') : 'dBm'}
                  limitMin={currentStep?.instrument === 'power_meter' ? currentStep.limit_min : null}
                  limitMax={currentStep?.instrument === 'power_meter' ? currentStep.limit_max : null}
                  frequency={currentStep?.instrument === 'power_meter' ? currentStep.frequency_mhz : null}
                  label={currentStep?.instrument === 'power_meter' ? currentStep.name : 'Power Meter'}
                />
              </div>
            )}
            {visiblePanels.has('multimeter') && equipmentByRole.multimeter && (
              <div className="flex flex-col w-[420px] shrink-0">
                <BindingStrip role="multimeter" eq={equipmentByRole.multimeter} />
                <MultimeterPanel
                  value={dmmStream.value}
                  unit={
                    dmmStepType === 'current' ? 'A'
                      : dmmStepType === 'resistance' ? 'Ω'
                      : 'V'
                  }
                  mode={
                    dmmStepType === 'current' ? 'current'
                      : dmmStepType === 'resistance' ? 'resistance'
                      : 'voltage'
                  }
                  limitMin={currentStep?.instrument === 'multimeter' ? currentStep.limit_min : null}
                  limitMax={currentStep?.instrument === 'multimeter' ? currentStep.limit_max : null}
                  limitNominal={currentStep?.instrument === 'multimeter' ? currentStep.limit_nominal : null}
                  limitTolerance={currentStep?.instrument === 'multimeter' ? currentStep.limit_tolerance : null}
                  limitType={currentStep?.instrument === 'multimeter' ? currentStep.limit_type : null}
                  label={currentStep?.instrument === 'multimeter' ? currentStep.name : 'Digital Multimeter'}
                />
              </div>
            )}
            {visiblePanels.has('spectrum_analyzer') && equipmentByRole.spectrum_analyzer && (
              <div className="flex flex-col w-[420px] shrink-0">
                <BindingStrip role="spectrum_analyzer" eq={equipmentByRole.spectrum_analyzer} />
                <SpectrumAnalyzerPanel
                  value={liveValue('spectrum_analyzer')}
                  frequency={currentStep?.instrument === 'spectrum_analyzer' ? currentStep.frequency_mhz : null}
                  label={currentStep?.instrument === 'spectrum_analyzer' ? currentStep.name : 'Spectrum Analyzer'}
                />
              </div>
            )}
            {visiblePanels.has('oscilloscope') && equipmentByRole.oscilloscope && (
              <div className="flex flex-col w-[420px] shrink-0">
                <BindingStrip role="oscilloscope" eq={equipmentByRole.oscilloscope} />
                <OscilloscopePanel
                  value={liveValue('oscilloscope')}
                  unit={currentStep?.instrument === 'oscilloscope' ? (currentStep.unit ?? 'V') : 'V'}
                  stepType={currentStep?.instrument === 'oscilloscope' ? currentStep.step_type : 'pulse_width'}
                  limitNominal={currentStep?.instrument === 'oscilloscope' ? currentStep.limit_nominal : null}
                  limitTolerance={currentStep?.instrument === 'oscilloscope' ? currentStep.limit_tolerance : null}
                  limitMin={currentStep?.instrument === 'oscilloscope' ? currentStep.limit_min : null}
                  limitMax={currentStep?.instrument === 'oscilloscope' ? currentStep.limit_max : null}
                  label={currentStep?.instrument === 'oscilloscope' ? currentStep.name : 'Oscilloscope'}
                />
              </div>
            )}
            {visiblePanels.has('phase_meter') && equipmentByRole.phase_meter && (
              <div className="flex flex-col w-[420px] shrink-0">
                <BindingStrip role="phase_meter" eq={equipmentByRole.phase_meter} />
                <PhaseMeterPanel
                  value={liveValue('phase_meter')}
                  unit={currentStep?.instrument === 'phase_meter' ? (currentStep.unit ?? 'deg') : 'deg'}
                  frequency={currentStep?.instrument === 'phase_meter' ? currentStep.frequency_mhz : null}
                  limitNominal={currentStep?.instrument === 'phase_meter' ? currentStep.limit_nominal : null}
                  limitTolerance={currentStep?.instrument === 'phase_meter' ? currentStep.limit_tolerance : null}
                  label={currentStep?.instrument === 'phase_meter' ? currentStep.name : 'Phase Meter'}
                />
              </div>
            )}
            {visiblePanels.has('network_analyzer') && equipmentByRole.network_analyzer && (
              <div className="flex flex-col w-[420px] shrink-0">
                <BindingStrip role="network_analyzer" eq={equipmentByRole.network_analyzer} />
                <NetworkAnalyzerPanel
                  value={liveValue('network_analyzer')}
                  frequency={currentStep?.instrument === 'network_analyzer' ? currentStep.frequency_mhz : null}
                  limitMax={currentStep?.instrument === 'network_analyzer' ? currentStep.limit_max : null}
                  label={currentStep?.instrument === 'network_analyzer' ? currentStep.name : 'Network Analyzer'}
                />
              </div>
            )}
            {visiblePanels.has('fft_display') && equipmentByRole.fft_display && (
              <div className="flex flex-col w-[420px] shrink-0">
                <BindingStrip role="fft_display" eq={equipmentByRole.fft_display} />
                <FFTDisplayPanel
                  value={liveValue('fft_display')}
                  stepType={currentStep?.instrument === 'fft_display' ? currentStep.step_type : undefined}
                  unit={currentStep?.instrument === 'fft_display' ? (currentStep.unit ?? 'dBSat') : 'dBSat'}
                  limitMin={currentStep?.instrument === 'fft_display' ? currentStep.limit_min : null}
                  limitMax={currentStep?.instrument === 'fft_display' ? currentStep.limit_max : null}
                  limitNominal={currentStep?.instrument === 'fft_display' ? currentStep.limit_nominal : null}
                  limitTolerance={currentStep?.instrument === 'fft_display' ? currentStep.limit_tolerance : null}
                  label={currentStep?.instrument === 'fft_display' ? currentStep.name : 'FFT Display'}
                />
              </div>
            )}
            {visiblePanels.has('common_bus') && equipmentByRole.common_bus && (
              <div className="flex flex-col w-[420px] shrink-0">
                <BindingStrip role="common_bus" eq={equipmentByRole.common_bus} />
                <CommonBusPanel
                  transactions={busTransactions}
                  label="Common Bus Monitor"
                />
              </div>
            )}
            {Array.from(visiblePanels).filter(
              k => EQUIPMENT_PANELS.find(p => p.key === k && p.group === 'output'),
            ).length === 0 && (
              <div className="w-full text-center py-6 text-xs text-muted-foreground">
                No output instrument selected
              </div>
            )}
          </div>
        </section>

        </div>{/* /grid Inputs+Outputs */}

        {/* (3) FULL DATA SHEET — collapsible at the bottom, full page width. */}
        <details className="group rounded-lg border bg-white shadow-sm open:shadow-md transition-shadow">
          <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg">
            <span className="flex items-center gap-2">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              Full Data Sheet
              <span className="text-xs font-normal text-muted-foreground">
                ({deferredSteps.length} step{deferredSteps.length === 1 ? '' : 's'})
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {passedCount} pass · {failedCount} fail
            </span>
          </summary>
          <div className="border-t p-3">
            <DataSheetPreview
              subsystemDrawingNo={drawingNo || '—'}
              subsystemName={subsystemName || '—'}
              procedureCode={procedureCode || '—'}
              procedureName={procedureName || '—'}
              serialNumber={serialNumber || '—'}
              operatorName={operatorName || '—'}
              startedAt={startedAt}
              stickyHeaderTop={benchPanelHeight}
              steps={deferredSteps.map(s => ({
                ...s,
                pass_fail: s.pass_fail ?? 'pending',
              }))}
            />
          </div>
        </details>

      </div>
    </div>
  )
}

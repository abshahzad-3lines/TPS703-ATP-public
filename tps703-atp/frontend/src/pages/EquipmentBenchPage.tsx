import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Loader2, Play, Send, Square } from 'lucide-react'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatSiValue } from '@/lib/units'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MultimeterPanel } from '@/components/instruments/MultimeterPanel'
import { PowerMeterPanel } from '@/components/instruments/PowerMeterPanel'
import { OscilloscopePanel } from '@/components/instruments/OscilloscopePanel'
import PhaseMeterPanel from '@/components/instruments/PhaseMeterPanel'
import NetworkAnalyzerPanel from '@/components/instruments/NetworkAnalyzerPanel'
import SpectrumAnalyzerPanel from '@/components/instruments/SpectrumAnalyzerPanel'
import FFTDisplayPanel from '@/components/instruments/FFTDisplayPanel'

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

interface MeasureResponse {
  value: number | null
  secondary_value: number | null
  raw_data: unknown
  source: 'live' | 'simulator'
  timestamp: string
}

interface ScpiResponse {
  response: string | null
  error: string | null
}

interface LastTransaction {
  label: string
  command: string
  response: string | null
  error: string | null
}

interface ParameterInputDef {
  name: string
  placeholder?: string
  unit?: string
  default?: string
}

type Preset =
  | { kind: 'action'; label: string; command: string; isQuery: boolean }
  | { kind: 'measure'; label: string; stepType: string; params?: Record<string, number> }
  | { kind: 'parameter'; label: string; inputs: ParameterInputDef[]; commandTemplate: string }

const COMMON_PRESETS: Preset[] = [
  { kind: 'action', label: 'Identify', command: '*IDN?', isQuery: true },
  { kind: 'action', label: 'Reset', command: '*RST', isQuery: false },
]

const PRESETS_BY_ROLE: Record<string, Preset[]> = {
  multimeter: [
    { kind: 'action', label: 'Read DC Voltage', command: 'MEAS:VOLT:DC?', isQuery: true },
    { kind: 'action', label: 'Read AC Voltage', command: 'MEAS:VOLT:AC?', isQuery: true },
    { kind: 'action', label: 'Read DC Current', command: 'MEAS:CURR:DC?', isQuery: true },
    { kind: 'action', label: 'Read Resistance', command: 'MEAS:RES?', isQuery: true },
    { kind: 'action', label: 'Auto-Range', command: 'SENS:VOLT:DC:RANG:AUTO ON', isQuery: false },
    ...COMMON_PRESETS,
  ],
  power_meter: [
    { kind: 'action', label: 'Read Power', command: 'READ?', isQuery: true },
    { kind: 'action', label: 'Zero', command: 'CAL:ZERO:AUTO ONCE', isQuery: false },
    ...COMMON_PRESETS,
  ],
  spectrum_analyzer: [
    { kind: 'action', label: 'Single Sweep', command: 'INIT:IMM', isQuery: false },
    { kind: 'action', label: 'Continuous', command: 'INIT:CONT ON', isQuery: false },
    { kind: 'action', label: 'Peak Search', command: 'CALC:MARK:MAX', isQuery: false },
    { kind: 'action', label: 'Auto-Tune', command: 'SENS:FREQ:TUN:IMM', isQuery: false },
    ...COMMON_PRESETS,
  ],
  oscilloscope: [
    { kind: 'action', label: 'Auto-Scale', command: 'AUT', isQuery: false },
    { kind: 'action', label: 'Run', command: 'RUN', isQuery: false },
    { kind: 'action', label: 'Stop', command: 'STOP', isQuery: false },
    { kind: 'action', label: 'Single', command: 'SING', isQuery: false },
    ...COMMON_PRESETS,
  ],
  network_analyzer: [
    { kind: 'action', label: 'Single Sweep', command: 'INIT:IMM', isQuery: false },
    { kind: 'action', label: 'Continuous', command: 'INIT:CONT ON', isQuery: false },
    ...COMMON_PRESETS,
  ],
  phase_meter: [
    { kind: 'action', label: 'Read Phase', command: 'MEAS:PHAS?', isQuery: true },
    ...COMMON_PRESETS,
  ],
  signal_generator: [
    {
      kind: 'parameter',
      label: 'Set Frequency',
      inputs: [{ name: 'freq', placeholder: '2.85', unit: 'GHz', default: '2.85' }],
      commandTemplate: 'FREQ {freq} GHZ',
    },
    {
      kind: 'parameter',
      label: 'Set Power',
      inputs: [{ name: 'power', placeholder: '0', unit: 'dBm', default: '0' }],
      commandTemplate: 'POW {power} DBM',
    },
    { kind: 'action', label: 'RF On', command: 'OUTP ON', isQuery: false },
    { kind: 'action', label: 'RF Off', command: 'OUTP OFF', isQuery: false },
    { kind: 'action', label: 'Pulse Mod On', command: 'PULM:SOUR INT;:PULM:STAT ON', isQuery: false },
    ...COMMON_PRESETS,
  ],
}

const ROLE_LABEL: Record<string, string> = {
  multimeter: 'Multimeter',
  power_meter: 'Power Meter',
  spectrum_analyzer: 'Spectrum Analyzer',
  oscilloscope: 'Oscilloscope',
  network_analyzer: 'Network Analyzer',
  phase_meter: 'Phase Meter',
  signal_generator: 'Signal Generator',
  fft_display: 'FFT Display',
  common_bus: 'Common Bus',
}

const STREAM_STEP_TYPE_BY_ROLE: Record<string, string> = {
  multimeter: 'mux_voltage',
  power_meter: 'output_power',
  spectrum_analyzer: 'spectrum',
  oscilloscope: 'pulse_width',
  network_analyzer: 'return_loss',
  phase_meter: 'phase_shift',
  fft_display: 'fft_peak',
  common_bus: 'bus_read',
}

// Base unit per role — drives auto-scaling and the "base" badge.
const BASE_UNIT_BY_ROLE: Record<string, string> = {
  multimeter: 'V',
  power_meter: 'dBm',
  spectrum_analyzer: 'dBm',
  oscilloscope: 's',
  network_analyzer: 'dB',
  phase_meter: '°',
  fft_display: 'dBm',
  signal_generator: '',
}

function buildWsUrl(equipmentId: number): string {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined
  let wsBase: string
  if (apiUrl) wsBase = apiUrl.replace(/^http/, 'ws')
  else if (import.meta.env.DEV) wsBase = `ws://${window.location.hostname}:8005`
  else {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    wsBase = `${wsProtocol}//${window.location.host}`
  }
  return `${wsBase}/ws/equipment/${equipmentId}`
}

function presetsForRole(role: string | null): Preset[] {
  if (role && PRESETS_BY_ROLE[role]) return PRESETS_BY_ROLE[role]
  return COMMON_PRESETS
}

function substituteTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '')
}

function LiveReadingPanel({ role, value, unit }: { role: string | null; value: number | null; unit: string }) {
  switch (role) {
    case 'power_meter':
      return <PowerMeterPanel value={value} unit={unit || 'dBm'} label="Power Meter" />
    case 'oscilloscope':
      return <OscilloscopePanel value={value} unit={unit || 'us'} label="Oscilloscope" />
    case 'phase_meter':
      return <PhaseMeterPanel value={value} unit={unit || 'deg'} label="Phase Meter" />
    case 'network_analyzer':
      return <NetworkAnalyzerPanel value={value} label="Network Analyzer" />
    case 'spectrum_analyzer':
      return <SpectrumAnalyzerPanel value={value} label="Spectrum Analyzer" />
    case 'fft_display':
      return <FFTDisplayPanel value={value} label="FFT Display" />
    case 'multimeter':
    default:
      return <MultimeterPanel value={value} unit={unit || 'V'} mode="voltage" label="Multimeter" />
  }
}

interface SignalGeneratorStatus {
  freq: string | null
  power: string | null
  output: string | null
}

function SignalGeneratorStatusCard({ status, lastTx }: { status: SignalGeneratorStatus; lastTx: LastTransaction | null }) {
  return (
    <div className="rounded-md border bg-slate-50 p-4">
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Frequency</div>
          <div className="font-mono text-lg text-slate-900">{status.freq ?? '--'}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Power</div>
          <div className="font-mono text-lg text-slate-900">{status.power ?? '--'}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Output</div>
          <div className="font-mono text-lg text-slate-900">{status.output ?? '--'}</div>
        </div>
      </div>
      <div className="mt-3 border-t pt-3 text-xs">
        <span className="text-slate-500">Last response: </span>
        <span className="font-mono text-slate-700">{lastTx?.response ?? lastTx?.error ?? '(none)'}</span>
      </div>
    </div>
  )
}

function ParameterPresetCard({
  preset,
  busy,
  onSend,
}: {
  preset: Extract<Preset, { kind: 'parameter' }>
  busy: boolean
  onSend: (label: string, command: string) => void | Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(preset.inputs.map((i) => [i.name, i.default ?? ''])),
  )
  const [sending, setSending] = useState(false)
  const disabled = busy || sending

  const handleSubmit = async () => {
    const command = substituteTemplate(preset.commandTemplate, values)
    setSending(true)
    try {
      await onSend(preset.label, command)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="col-span-2 rounded-md border bg-slate-50/50 p-3">
      <div className="text-sm font-medium mb-2">{preset.label}</div>
      <div className="flex flex-wrap items-end gap-2">
        {preset.inputs.map((input) => (
          <div key={input.name} className="flex flex-col gap-1 min-w-[120px]">
            <label className="text-xs text-muted-foreground">
              {input.name}
              {input.unit ? <span className="ml-1 text-slate-400">({input.unit})</span> : null}
            </label>
            <Input
              type="number"
              step="any"
              value={values[input.name] ?? ''}
              placeholder={input.placeholder}
              disabled={disabled}
              onChange={(e) => setValues((prev) => ({ ...prev, [input.name]: e.target.value }))}
              className="h-8 w-28"
            />
          </div>
        ))}
        <Button onClick={handleSubmit} disabled={disabled} size="sm" className="ml-auto">
          {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
          Send
        </Button>
      </div>
    </div>
  )
}

function LastResponseStrip({ lastTx, baseUnit }: { lastTx: LastTransaction | null; baseUnit: string }) {
  const formatted = useMemo(() => {
    if (!lastTx?.response) return null
    const trimmed = lastTx.response.trim()
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || trimmed === '') return null
    if (!baseUnit) return null
    const { display, unit } = formatSiValue(parsed, baseUnit)
    return `${display} ${unit}`
  }, [lastTx, baseUnit])

  return (
    <div
      className={cn(
        'mt-4 rounded-md border bg-slate-950 text-slate-100 px-3 py-2 font-mono text-xs truncate',
        lastTx?.error ? 'border-red-500/50' : 'border-slate-800',
      )}
    >
      {lastTx ? (
        <span>
          <span className="text-blue-300">{lastTx.label}</span>
          <span className="text-slate-500"> · </span>
          <span className="text-slate-400">{lastTx.command}</span>
          <span className="text-slate-500"> → </span>
          {lastTx.error ? (
            <span className="text-red-300">{lastTx.error}</span>
          ) : (
            <span className="text-emerald-300">
              {formatted ?? (lastTx.response === null || lastTx.response === '' ? '(ok)' : lastTx.response)}
            </span>
          )}
        </span>
      ) : (
        <span className="text-slate-500">No commands sent yet.</span>
      )}
    </div>
  )
}

export default function EquipmentBenchPage() {
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([])
  const [loadingEquipment, setLoadingEquipment] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [latestValue, setLatestValue] = useState<number | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastTx, setLastTx] = useState<LastTransaction | null>(null)
  const [sgStatus, setSgStatus] = useState<SignalGeneratorStatus>({ freq: null, power: null, output: null })

  const wsRef = useRef<WebSocket | null>(null)
  const sgPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setLoadingEquipment(true)
    api
      .get<Equipment[]>('/equipment?is_active=1')
      .then((data) => {
        setEquipmentList(data)
        if (data.length > 0) setSelectedId(data[0].id)
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load equipment'))
      .finally(() => setLoadingEquipment(false))
  }, [])

  const selected = useMemo(
    () => equipmentList.find((e) => e.id === selectedId) ?? null,
    [equipmentList, selectedId],
  )
  const role = selected?.instrument_role ?? null
  const presets = useMemo(() => presetsForRole(role), [role])
  const hasRolePresets = role !== null && PRESETS_BY_ROLE[role] !== undefined
  const baseUnit = (role && BASE_UNIT_BY_ROLE[role]) ?? ''
  const isSignalGenerator = role === 'signal_generator'

  const scaled = useMemo(() => {
    if (latestValue === null || baseUnit === '') return { display: '--', unit: baseUnit }
    return formatSiValue(latestValue, baseUnit)
  }, [latestValue, baseUnit])

  const panelValue = useMemo(() => {
    if (latestValue === null) return null
    if (baseUnit === '') return latestValue
    const parsed = Number(scaled.display)
    return Number.isFinite(parsed) ? parsed : latestValue
  }, [latestValue, baseUnit, scaled.display])

  const stopSgPoll = useCallback(() => {
    if (sgPollRef.current !== null) {
      clearInterval(sgPollRef.current)
      sgPollRef.current = null
    }
  }, [])

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: 'stop_stream' })) } catch { /* ignore */ }
      try { wsRef.current.close() } catch { /* ignore */ }
      wsRef.current = null
    }
    stopSgPoll()
    setStreaming(false)
  }, [stopSgPoll])

  useEffect(() => () => { closeWs() }, [closeWs])

  useEffect(() => {
    closeWs()
    setLatestValue(null)
    setStreamError(null)
    setLastTx(null)
    setSgStatus({ freq: null, power: null, output: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const dispatchScpi = useCallback(
    async (label: string, command: string, isQuery: boolean): Promise<ScpiResponse> => {
      if (!selected) return { response: null, error: 'No instrument selected' }
      setBusy(true)
      try {
        let result: ScpiResponse
        if (streaming && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const ws = wsRef.current
          result = await new Promise<ScpiResponse>((resolve) => {
            const onMessage = (event: MessageEvent) => {
              try {
                const msg = JSON.parse(event.data)
                if (msg.type === 'scpi_response') {
                  ws.removeEventListener('message', onMessage)
                  resolve({ response: msg.response ?? null, error: msg.error ?? null })
                }
              } catch { /* ignore */ }
            }
            ws.addEventListener('message', onMessage)
            ws.send(JSON.stringify({ type: 'scpi', command, is_query: isQuery }))
          })
        } else {
          result = await api.post<ScpiResponse>(`/equipment/${selected.id}/scpi`, { command, is_query: isQuery })
        }
        setLastTx({ label, command, response: result.response, error: result.error })
        return result
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Command failed'
        setLastTx({ label, command, response: null, error })
        return { response: null, error }
      } finally {
        setBusy(false)
      }
    },
    [selected, streaming],
  )

  const startStream = useCallback(() => {
    if (!selected) return
    setStreamError(null)
    setLatestValue(null)
    const ws = new WebSocket(buildWsUrl(selected.id))
    wsRef.current = ws

    const isSG = selected.instrument_role === 'signal_generator'
    const stepType = STREAM_STEP_TYPE_BY_ROLE[selected.instrument_role ?? ''] ?? 'mux_voltage'

    ws.onopen = () => {
      if (!isSG) {
        ws.send(JSON.stringify({
          type: 'start_stream', step_type: stepType, params: {}, interval_ms: 500, include_simulator: false,
        }))
      } else {
        setStreaming(true)
      }
    }
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'stream_state') setStreaming(Boolean(msg.running))
        else if (msg.type === 'reading' && msg.source === 'live' && typeof msg.value === 'number') setLatestValue(msg.value)
        else if (msg.type === 'error') setStreamError(String(msg.message ?? 'Stream error'))
      } catch { /* ignore */ }
    }
    ws.onerror = () => setStreamError('WebSocket connection error')
    ws.onclose = () => { setStreaming(false); stopSgPoll() }

    if (isSG) {
      const pollOnce = async () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
        const ws2 = wsRef.current
        const send = (cmd: string) => new Promise<string | null>((resolve) => {
          const onMessage = (event: MessageEvent) => {
            try {
              const msg = JSON.parse(event.data)
              if (msg.type === 'scpi_response') {
                ws2.removeEventListener('message', onMessage)
                resolve(msg.response ?? null)
              }
            } catch { /* ignore */ }
          }
          ws2.addEventListener('message', onMessage)
          try { ws2.send(JSON.stringify({ type: 'scpi', command: cmd, is_query: true })) }
          catch { ws2.removeEventListener('message', onMessage); resolve(null) }
        })
        const freq = await send('FREQ?')
        const output = await send('OUTP?')
        setSgStatus((prev) => ({ ...prev, freq, output }))
      }
      sgPollRef.current = setInterval(() => { void pollOnce() }, 2000)
    }
  }, [selected, stopSgPoll])

  const toggleStream = useCallback(() => {
    if (streaming) closeWs()
    else startStream()
  }, [streaming, startStream, closeWs])

  const runActionPreset = useCallback(
    async (preset: Extract<Preset, { kind: 'action' }>) => {
      await dispatchScpi(preset.label, preset.command, preset.isQuery)
    },
    [dispatchScpi],
  )

  const runMeasurePreset = useCallback(
    async (preset: Extract<Preset, { kind: 'measure' }>) => {
      if (!selected) return
      setBusy(true)
      try {
        const result = await api.post<MeasureResponse>(
          `/equipment/${selected.id}/measure`,
          { step_type: preset.stepType, params: preset.params ?? {} },
        )
        if (typeof result.value === 'number') setLatestValue(result.value)
        setLastTx({
          label: preset.label,
          command: preset.stepType,
          response: result.value !== null ? String(result.value) : '(no value)',
          error: null,
        })
      } catch (e) {
        setLastTx({
          label: preset.label,
          command: preset.stepType,
          response: null,
          error: e instanceof Error ? e.message : 'Measurement failed',
        })
      } finally {
        setBusy(false)
      }
    },
    [selected],
  )

  const runParameterPreset = useCallback(
    async (label: string, command: string) => {
      const result = await dispatchScpi(label, command, false)
      if (isSignalGenerator && result && !result.error) {
        if (label === 'Set Frequency') {
          setSgStatus((prev) => ({ ...prev, freq: command.replace(/^FREQ\s+/i, '') }))
        } else if (label === 'Set Power') {
          setSgStatus((prev) => ({ ...prev, power: command.replace(/^POW\s+/i, '') }))
        }
      }
    },
    [dispatchScpi, isSignalGenerator],
  )

  return (
    <div className="space-y-6">
      <title>Equipment Bench - TPS-703 ATP</title>

      <div className="flex items-center gap-3">
        <Activity className="h-7 w-7 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Equipment Bench</h1>
          <p className="text-sm text-muted-foreground">
            Pick an instrument, watch its live reading, and send canned commands.
          </p>
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Failed to load equipment</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instrument</CardTitle>
          <CardDescription>Choose an active instrument from the bench</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingEquipment ? (
            <div className="flex items-center gap-2 text-muted-foreground py-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading equipment...
            </div>
          ) : equipmentList.length === 0 ? (
            <Alert>
              <AlertTitle>No active equipment</AlertTitle>
              <AlertDescription>Register equipment on the Test Equipment page first.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <Select
                value={selectedId !== null ? String(selectedId) : ''}
                onValueChange={(v) => setSelectedId(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select equipment..." />
                </SelectTrigger>
                <SelectContent>
                  {equipmentList.map((eq) => (
                    <SelectItem key={eq.id} value={String(eq.id)}>
                      <div className="flex flex-col">
                        <span className="font-medium">{eq.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {[
                            eq.model,
                            eq.instrument_role ? ROLE_LABEL[eq.instrument_role] ?? eq.instrument_role : null,
                            eq.connection_address,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  {selected.instrument_role ? (
                    <Badge variant="secondary">
                      {ROLE_LABEL[selected.instrument_role] ?? selected.instrument_role}
                    </Badge>
                  ) : (
                    <Badge variant="outline">No role set</Badge>
                  )}
                  {baseUnit && (
                    <Badge variant="outline" className="font-mono">base: {baseUnit}</Badge>
                  )}
                  <span className="font-mono text-muted-foreground truncate">
                    {selected.connection_type ?? '?'}
                    {selected.connection_address ? ` · ${selected.connection_address}` : ''}
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">{isSignalGenerator ? 'Status' : 'Live Reading'}</CardTitle>
                <CardDescription>
                  {isSignalGenerator
                    ? 'Polled status (FREQ?/OUTP?) plus the last command response'
                    : 'Streaming from the selected instrument'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-3">
                {!isSignalGenerator && latestValue !== null && (
                  <span className="font-mono text-sm text-slate-700">
                    {scaled.display} {scaled.unit}
                  </span>
                )}
                {streaming && (
                  <Badge className="bg-blue-500 text-white">
                    <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse mr-1.5" />
                    Streaming
                  </Badge>
                )}
                <Button onClick={toggleStream} variant={streaming ? 'destructive' : 'default'} size="lg">
                  {streaming ? (<><Square className="h-4 w-4 mr-2" /> Stop</>) : (<><Play className="h-4 w-4 mr-2" /> Start</>)}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mx-auto max-w-3xl">
              {isSignalGenerator
                ? <SignalGeneratorStatusCard status={sgStatus} lastTx={lastTx} />
                : <LiveReadingPanel role={role} value={panelValue} unit={scaled.unit} />}
            </div>
            {streamError && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{streamError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Commands</CardTitle>
            <CardDescription>
              {hasRolePresets ? 'One-tap presets for this instrument role' : 'No presets defined for this role'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {presets.map((preset) => {
                if (preset.kind === 'parameter') {
                  return <ParameterPresetCard key={preset.label} preset={preset} busy={busy} onSend={runParameterPreset} />
                }
                if (preset.kind === 'measure') {
                  return (
                    <Button
                      key={preset.label}
                      variant="outline"
                      onClick={() => runMeasurePreset(preset)}
                      disabled={busy}
                      className="justify-start"
                    >
                      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      {preset.label}
                    </Button>
                  )
                }
                return (
                  <Button
                    key={preset.label}
                    variant="outline"
                    onClick={() => runActionPreset(preset)}
                    disabled={busy}
                    className="justify-start"
                  >
                    {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    {preset.label}
                  </Button>
                )
              })}
            </div>

            <LastResponseStrip lastTx={lastTx} baseUnit={baseUnit} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

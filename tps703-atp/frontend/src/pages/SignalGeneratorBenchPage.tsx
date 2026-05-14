/**
 * SignalGeneratorBenchPage — full Keysight MXG (N5181B) analog control.
 *
 * Mirrors InstrumentBenchPage / PowerMeterBenchPage in shape but exposes
 * controls that match how an SG operator actually works:
 *   - Frequency (CW + sweep start/stop/step)
 *   - Amplitude with offset
 *   - RF output On/Off + modulation master
 *   - Per-mode AM / FM / PM / Pulse subsystems with internal source params
 *   - Reference oscillator source
 *   - ALC On/Off
 *   - Sweep / list trigger source
 *   - Status polling at 1 Hz (FREQ?, POW?, OUTP?, OUTP:MOD?)
 *   - Diagnostics (self-test, error queue) + raw SCPI box.
 *
 * Uses HTTP /api/equipment/{id}/scpi for fire-and-forget commands and the
 * bench WebSocket with step_type='sg_status' for periodic status polling.
 *
 * No fake instruments and no synthesised values — only operates on
 * registered active equipment with instrument_role = 'signal_generator'.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Loader2, Play, Plug, PlugZap, Power, Radio, RotateCcw, Square, Zap,
} from 'lucide-react'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

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
  is_active: number
  instrument_role: string | null
}

type ConnectionState = 'idle' | 'connecting' | 'open' | 'error' | 'closed'

interface ScpiResp { response: string | null; error: string | null }

interface ScpiLogEntry {
  id: number
  command: string
  response: string | null
  error: string | null
  timestamp: string
}

type ModSource = 'INT' | 'EXT'
type RefSource = 'INT' | 'EXT'
type IntFunction = 'SINE' | 'SQU' | 'TRI' | 'RAMP' | 'NOIS'

const FREQ_UNITS = [
  { v: 'HZ',  l: 'Hz',  mult: 1 },
  { v: 'KHZ', l: 'kHz', mult: 1e3 },
  { v: 'MHZ', l: 'MHz', mult: 1e6 },
  { v: 'GHZ', l: 'GHz', mult: 1e9 },
] as const

type FreqUnit = (typeof FREQ_UNITS)[number]['v']

const FUNCTIONS: { v: IntFunction; l: string }[] = [
  { v: 'SINE', l: 'Sine' }, { v: 'SQU',  l: 'Square' },
  { v: 'TRI',  l: 'Triangle' }, { v: 'RAMP', l: 'Ramp' },
  { v: 'NOIS', l: 'Noise' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function formatHHMMSS(date = new Date()): string {
  return date.toTimeString().slice(0, 8)
}

function formatFreqHz(hz: number | null): string {
  if (hz === null || !Number.isFinite(hz)) return '—'
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(6)} GHz`
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(3)} kHz`
  return `${hz.toFixed(0)} Hz`
}

function freqToHz(value: string, unit: FreqUnit): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  const u = FREQ_UNITS.find((x) => x.v === unit)
  return u ? n * u.mult : null
}

function ConnectionBadge({ state, onReconnect }: { state: ConnectionState; onReconnect: () => void }) {
  const config: Record<ConnectionState, { label: string; cls: string; pulse?: boolean }> = {
    idle:       { label: 'Idle',             cls: 'bg-slate-200 text-slate-700' },
    connecting: { label: 'Connecting…',      cls: 'bg-amber-500 text-white', pulse: true },
    open:       { label: 'Connected',        cls: 'bg-emerald-500 text-white' },
    error:      { label: 'Connection error', cls: 'bg-red-500 text-white' },
    closed:     { label: 'Offline',          cls: 'bg-slate-500 text-white' },
  }
  const c = config[state]
  return (
    <div className="flex items-center gap-2">
      <Badge className={cn('inline-flex items-center gap-1.5', c.cls)}>
        <span className={cn('h-2 w-2 rounded-full bg-current opacity-80', c.pulse && 'animate-pulse')} />
        {c.label}
      </Badge>
      {(state === 'error' || state === 'closed') && (
        <Button size="sm" variant="outline" onClick={onReconnect} className="h-7">
          <PlugZap className="h-3.5 w-3.5 mr-1" /> Reconnect
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status panel — mirrors the front-panel display
// ---------------------------------------------------------------------------

interface StatusPanelProps {
  freqHz: number | null
  ampDbm: number | null
  rfOn: boolean
  modOn: boolean
  am: boolean
  fm: boolean
  pm: boolean
  pulse: boolean
  refExt: boolean
}

function StatusPanel({ freqHz, ampDbm, rfOn, modOn, am, fm, pm, pulse, refExt }: StatusPanelProps) {
  return (
    <div className="rounded-md border-2 border-slate-700 bg-[#0a0d12] text-slate-100 p-4 font-mono">
      <div className="flex items-center gap-2 text-[11px] tracking-wider text-cyan-400 pb-2 border-b border-slate-800">
        <span className="font-bold text-slate-100">Signal Generator</span>
        <span className="text-slate-700">|</span>
        <span>{refExt ? 'Ref EXT' : 'Ref INT'}</span>
        <span className="ml-auto">
          <span className={cn('px-1.5 py-px border rounded text-[10px] font-bold',
            rfOn ? 'text-red-400 border-red-400/40 bg-red-400/10' : 'text-slate-700 border-slate-800')}>
            RF {rfOn ? 'ON' : 'OFF'}
          </span>
        </span>
      </div>

      {/* Frequency + Amplitude */}
      <div className="grid grid-cols-2 gap-4 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Frequency</div>
          <div className="text-3xl font-extralight tabular-nums tracking-tight">
            {formatFreqHz(freqHz)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Amplitude</div>
          <div className="text-3xl font-extralight tabular-nums tracking-tight">
            {ampDbm === null || !Number.isFinite(ampDbm) ? '—' : `${ampDbm.toFixed(2)} dBm`}
          </div>
        </div>
      </div>

      {/* Modulation annunciators */}
      <div className="flex items-center gap-2 text-[10px] tracking-widest font-bold pt-2 border-t border-slate-800">
        <span className={cn('px-1.5 py-px border rounded',
          modOn ? 'text-cyan-400 border-cyan-400/40' : 'text-slate-700 border-slate-800')}>MOD</span>
        <span className={cn('px-1.5 py-px border rounded',
          am ? 'text-amber-400 border-amber-400/40' : 'text-slate-700 border-slate-800')}>AM</span>
        <span className={cn('px-1.5 py-px border rounded',
          fm ? 'text-amber-400 border-amber-400/40' : 'text-slate-700 border-slate-800')}>FM</span>
        <span className={cn('px-1.5 py-px border rounded',
          pm ? 'text-amber-400 border-amber-400/40' : 'text-slate-700 border-slate-800')}>ΦM</span>
        <span className={cn('px-1.5 py-px border rounded',
          pulse ? 'text-amber-400 border-amber-400/40' : 'text-slate-700 border-slate-800')}>PULSE</span>
        <span className="ml-auto text-slate-500">{formatHHMMSS()}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SignalGeneratorBenchPage() {
  const params = useParams<{ equipmentId?: string }>()
  const preselectedId = params.equipmentId ? Number(params.equipmentId) : null

  // Equipment list
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([])
  const [loadingEquipment, setLoadingEquipment] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Streaming / connection state
  const [streaming, setStreaming] = useState(false)
  const [connState, setConnState] = useState<ConnectionState>('idle')
  const [streamError, setStreamError] = useState<string | null>(null)

  // Live status read back from the SG
  const [freqHz, setFreqHz] = useState<number | null>(null)
  const [ampDbm, setAmpDbm] = useState<number | null>(null)
  const [rfOn, setRfOn] = useState<boolean>(false)
  const [modOn, setModOn] = useState<boolean>(false)
  const [amOn, setAmOn] = useState<boolean>(false)
  const [fmOn, setFmOn] = useState<boolean>(false)
  const [pmOn, setPmOn] = useState<boolean>(false)
  const [pulseOn, setPulseOn] = useState<boolean>(false)
  const [refSource, setRefSource] = useState<RefSource>('INT')

  // Frequency / amplitude inputs
  const [freqInput, setFreqInput] = useState<string>('1.0')
  const [freqUnit, setFreqUnit] = useState<FreqUnit>('GHZ')
  const [ampInput, setAmpInput] = useState<string>('-10.00')
  const [ampOffset, setAmpOffset] = useState<string>('0.00')

  // Sweep
  const [sweepStart, setSweepStart] = useState<string>('1.0')
  const [sweepStop, setSweepStop]   = useState<string>('2.0')
  const [sweepStep, setSweepStep]   = useState<string>('100')   // in MHz
  const [sweepUnit, setSweepUnit] = useState<FreqUnit>('GHZ')
  const [freqMode, setFreqMode] = useState<'CW' | 'LIST' | 'SWE'>('CW')

  // Modulation parameters
  const [amDepth, setAmDepth]   = useState<string>('30')   // %
  const [amFreq, setAmFreq]     = useState<string>('1000') // Hz
  const [amSrc, setAmSrc]       = useState<ModSource>('INT')
  const [amFunc, setAmFunc]     = useState<IntFunction>('SINE')

  const [fmDev, setFmDev]       = useState<string>('10000') // Hz
  const [fmFreq, setFmFreq]     = useState<string>('1000')
  const [fmSrc, setFmSrc]       = useState<ModSource>('INT')

  const [pmDev, setPmDev]       = useState<string>('1.0')   // radians
  const [pmFreq, setPmFreq]     = useState<string>('1000')
  const [pmSrc, setPmSrc]       = useState<ModSource>('INT')

  const [pulFreq, setPulFreq]   = useState<string>('1000')  // Hz
  const [pulWidth, setPulWidth] = useState<string>('100')   // µs
  const [pulSrc, setPulSrc]     = useState<ModSource>('INT')

  // ALC
  const [alcOn, setAlcOn] = useState<boolean>(true)

  // Acquisition (status polling)
  const [intervalMs, setIntervalMs] = useState<number>(1000)

  // SCPI box
  const [scpiInput, setScpiInput] = useState('')
  const [scpiLog, setScpiLog] = useState<ScpiLogEntry[]>([])
  const scpiLogIdRef = useRef(0)

  // Self-test / errors
  const [selfTestResult, setSelfTestResult] = useState<string>('—')
  const [errorQueue, setErrorQueue] = useState<string[]>([])

  const wsRef = useRef<WebSocket | null>(null)

  // ---------------------------------------------------------------------------
  // Load equipment — filter to signal_generator role
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setLoadingEquipment(true)
    api.get<Equipment[]>('/equipment?is_active=1')
      .then((data) => {
        setEquipmentList(data.filter((e) => e.instrument_role === 'signal_generator'))
        setLoadError(null)
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load equipment'))
      .finally(() => setLoadingEquipment(false))
  }, [])

  useEffect(() => {
    if (equipmentList.length === 0) { setSelectedId(null); return }
    if (preselectedId != null && equipmentList.some((e) => e.id === preselectedId)) {
      setSelectedId(preselectedId); return
    }
    if (selectedId == null) setSelectedId(equipmentList[0].id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentList, preselectedId])

  const selected = useMemo(
    () => equipmentList.find((e) => e.id === selectedId) ?? null,
    [equipmentList, selectedId],
  )

  // ---------------------------------------------------------------------------
  // SCPI plumbing
  // ---------------------------------------------------------------------------

  const sendScpi = useCallback(
    async (command: string, isQuery: boolean): Promise<ScpiResp> => {
      if (!selected) return { response: null, error: 'No instrument selected' }
      try {
        const result = await api.post<ScpiResp>(
          `/equipment/${selected.id}/scpi`,
          { command, is_query: isQuery },
        )
        setScpiLog((prev) => [
          { id: ++scpiLogIdRef.current, command, response: result.response, error: result.error, timestamp: formatHHMMSS() },
          ...prev,
        ].slice(0, 50))
        return result
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Command failed'
        setScpiLog((prev) => [
          { id: ++scpiLogIdRef.current, command, response: null, error, timestamp: formatHHMMSS() },
          ...prev,
        ].slice(0, 50))
        return { response: null, error }
      }
    },
    [selected],
  )

  // ---------------------------------------------------------------------------
  // Streaming via /ws/equipment/{id} — sg_status step type
  // ---------------------------------------------------------------------------

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: 'stop_stream' })) } catch { /* */ }
      try { wsRef.current.close() } catch { /* */ }
      wsRef.current = null
    }
    setStreaming(false)
    setConnState('closed')
  }, [])

  useEffect(() => {
    closeWs()
    setFreqHz(null); setAmpDbm(null); setRfOn(false); setModOn(false)
    setAmOn(false); setFmOn(false); setPmOn(false); setPulseOn(false)
    setStreamError(null); setConnState('idle'); setScpiLog([])
    scpiLogIdRef.current = 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => () => { closeWs() }, [closeWs])

  const startStream = useCallback(() => {
    if (!selected) return
    setStreamError(null); setConnState('connecting')

    const ws = new WebSocket(buildWsUrl(selected.id))
    wsRef.current = ws

    ws.onopen = () => {
      setConnState('open')
      ws.send(JSON.stringify({
        type: 'start_stream',
        step_type: 'sg_status',
        params: {},
        interval_ms: intervalMs,
        include_simulator: false,
      }))
    }
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.type === 'stream_state') setStreaming(Boolean(msg.running))
        else if (msg.type === 'reading' && msg.source === 'live') {
          if (typeof msg.value === 'number') setFreqHz(msg.value)
          if (typeof msg.secondary_value === 'number') setAmpDbm(msg.secondary_value)
          if (typeof msg.raw_data === 'string') {
            const parts = msg.raw_data.split('|')
            const outpRaw = parts[2] ?? ''
            const isOn = outpRaw.trim() === '1' || outpRaw.trim().toUpperCase() === 'ON'
            setRfOn(isOn)
          }
        } else if (msg.type === 'error') {
          setStreamError(String(msg.message ?? 'Stream error'))
        }
      } catch { /* */ }
    }
    ws.onerror = () => { setStreamError('WebSocket connection error'); setConnState('error') }
    ws.onclose = () => { setStreaming(false); setConnState((s) => (s === 'error' ? s : 'closed')) }
  }, [selected, intervalMs])

  useEffect(() => {
    if (!streaming) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: 'start_stream',
      step_type: 'sg_status',
      params: {},
      interval_ms: intervalMs,
      include_simulator: false,
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs])

  const toggleStream = useCallback(() => {
    if (streaming) closeWs(); else startStream()
  }, [streaming, startStream, closeWs])

  // ---------------------------------------------------------------------------
  // Action helpers
  // ---------------------------------------------------------------------------

  const applyFrequency = useCallback(async () => {
    const hz = freqToHz(freqInput, freqUnit)
    if (hz === null) return
    await sendScpi(`FREQ ${hz}`, false)
  }, [freqInput, freqUnit, sendScpi])

  const applyAmplitude = useCallback(async () => {
    const v = Number(ampInput)
    if (!Number.isFinite(v)) return
    await sendScpi(`POW ${v} DBM`, false)
  }, [ampInput, sendScpi])

  const applyAmpOffset = useCallback(async () => {
    const v = Number(ampOffset)
    if (!Number.isFinite(v)) return
    await sendScpi(`POW:OFFS ${v}`, false)
  }, [ampOffset, sendScpi])

  const toggleRf = useCallback(async () => {
    const next = !rfOn
    setRfOn(next)
    await sendScpi(`OUTP:STAT ${next ? 'ON' : 'OFF'}`, false)
  }, [rfOn, sendScpi])

  const toggleMod = useCallback(async () => {
    const next = !modOn
    setModOn(next)
    await sendScpi(`OUTP:MOD:STAT ${next ? 'ON' : 'OFF'}`, false)
  }, [modOn, sendScpi])

  const toggleAlc = useCallback(async () => {
    const next = !alcOn
    setAlcOn(next)
    await sendScpi(`POW:ALC ${next ? 'ON' : 'OFF'}`, false)
  }, [alcOn, sendScpi])

  const setRef = useCallback(async (src: RefSource) => {
    setRefSource(src)
    await sendScpi(`ROSC:SOUR ${src}`, false)
  }, [sendScpi])

  // AM
  const applyAm = useCallback(async () => {
    await sendScpi(`AM:SOUR ${amSrc}`, false)
    if (amSrc === 'INT') {
      await sendScpi(`AM:INT:FUNC:SHAP ${amFunc}`, false)
      const f = Number(amFreq)
      if (Number.isFinite(f)) await sendScpi(`AM:INT:FREQ ${f}`, false)
    }
    const d = Number(amDepth)
    if (Number.isFinite(d)) await sendScpi(`AM ${d}`, false)
  }, [amSrc, amFunc, amFreq, amDepth, sendScpi])

  const toggleAm = useCallback(async () => {
    const next = !amOn
    setAmOn(next)
    await sendScpi(`AM:STAT ${next ? 'ON' : 'OFF'}`, false)
  }, [amOn, sendScpi])

  // FM
  const applyFm = useCallback(async () => {
    await sendScpi(`FM:SOUR ${fmSrc}`, false)
    if (fmSrc === 'INT') {
      const f = Number(fmFreq)
      if (Number.isFinite(f)) await sendScpi(`FM:INT:FREQ ${f}`, false)
    }
    const d = Number(fmDev)
    if (Number.isFinite(d)) await sendScpi(`FM ${d}`, false)
  }, [fmSrc, fmFreq, fmDev, sendScpi])

  const toggleFm = useCallback(async () => {
    const next = !fmOn
    setFmOn(next)
    await sendScpi(`FM:STAT ${next ? 'ON' : 'OFF'}`, false)
  }, [fmOn, sendScpi])

  // PM
  const applyPm = useCallback(async () => {
    await sendScpi(`PM:SOUR ${pmSrc}`, false)
    if (pmSrc === 'INT') {
      const f = Number(pmFreq)
      if (Number.isFinite(f)) await sendScpi(`PM:INT:FREQ ${f}`, false)
    }
    const d = Number(pmDev)
    if (Number.isFinite(d)) await sendScpi(`PM ${d}`, false)
  }, [pmSrc, pmFreq, pmDev, sendScpi])

  const togglePm = useCallback(async () => {
    const next = !pmOn
    setPmOn(next)
    await sendScpi(`PM:STAT ${next ? 'ON' : 'OFF'}`, false)
  }, [pmOn, sendScpi])

  // Pulse
  const applyPulse = useCallback(async () => {
    await sendScpi(`PULM:SOUR ${pulSrc}`, false)
    if (pulSrc === 'INT') {
      const f = Number(pulFreq)
      if (Number.isFinite(f) && f > 0) {
        await sendScpi(`PULM:INT:FREQ ${f}`, false)
      }
      const w = Number(pulWidth)
      if (Number.isFinite(w) && w > 0) {
        // Width is in microseconds
        await sendScpi(`PULM:INT:PWID ${w}US`, false)
      }
    }
  }, [pulSrc, pulFreq, pulWidth, sendScpi])

  const togglePulse = useCallback(async () => {
    const next = !pulseOn
    setPulseOn(next)
    await sendScpi(`PULM:STAT ${next ? 'ON' : 'OFF'}`, false)
  }, [pulseOn, sendScpi])

  // Sweep
  const applySweep = useCallback(async () => {
    const start = freqToHz(sweepStart, sweepUnit)
    const stop  = freqToHz(sweepStop, sweepUnit)
    const step  = freqToHz(sweepStep, sweepUnit)
    if (start === null || stop === null) return
    await sendScpi(`FREQ:STAR ${start}`, false)
    await sendScpi(`FREQ:STOP ${stop}`, false)
    if (step !== null && step > 0) await sendScpi(`SWE:STEP ${step}`, false)
  }, [sweepStart, sweepStop, sweepStep, sweepUnit, sendScpi])

  const setMode = useCallback(async (mode: 'CW' | 'LIST' | 'SWE') => {
    setFreqMode(mode)
    await sendScpi(`FREQ:MODE ${mode}`, false)
  }, [sendScpi])

  // Reset
  const resetSg = useCallback(async () => {
    await sendScpi('*RST', false)
    await sendScpi('*CLS', false)
    setRfOn(false); setModOn(false); setAmOn(false); setFmOn(false); setPmOn(false); setPulseOn(false)
    setAlcOn(true); setRefSource('INT')
  }, [sendScpi])

  // Diagnostics
  const runSelfTest = useCallback(async () => {
    setSelfTestResult('Running…')
    const r = await sendScpi('*TST?', true)
    if (r.error) { setSelfTestResult(`ERROR: ${r.error}`); return }
    const code = (r.response ?? '').trim()
    setSelfTestResult(code === '0' ? 'PASS (0)' : `FAIL (${code})`)
  }, [sendScpi])

  const drainErrors = useCallback(async () => {
    const errors: string[] = []
    for (let i = 0; i < 20; i++) {
      const r = await sendScpi('SYST:ERR?', true)
      if (r.error) { errors.push(`!! ${r.error}`); break }
      const txt = (r.response ?? '').trim()
      if (!txt || txt.startsWith('+0,') || txt.startsWith('0,')) break
      errors.push(txt)
    }
    setErrorQueue(errors.length ? errors : ['(empty)'])
  }, [sendScpi])

  // Single-shot status fetch
  const refreshStatus = useCallback(async () => {
    if (!selected) return
    try {
      const r = await api.post<{ value: number | null; secondary_value: number | null; raw_data: unknown }>(
        `/equipment/${selected.id}/measure`,
        { step_type: 'sg_status', params: {} },
      )
      setFreqHz(typeof r.value === 'number' ? r.value : null)
      setAmpDbm(typeof r.secondary_value === 'number' ? r.secondary_value : null)
      if (typeof r.raw_data === 'string') {
        const outpRaw = (r.raw_data.split('|')[2] ?? '').trim()
        setRfOn(outpRaw === '1' || outpRaw.toUpperCase() === 'ON')
      }
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : 'Status refresh failed')
    }
  }, [selected])

  const handleScpiSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const cmd = scpiInput.trim()
    if (!cmd) return
    await sendScpi(cmd, cmd.endsWith('?'))
    setScpiInput('')
  }, [scpiInput, sendScpi])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <title>Signal Generator Bench - TPS-703 ATP</title>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Radio className="h-7 w-7 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Signal Generator Bench</h1>
            <p className="text-sm text-muted-foreground">
              Frequency, amplitude, RF on/off, AM/FM/ΦM/Pulse, sweep, reference, diagnostics, raw SCPI.
            </p>
          </div>
        </div>
        {selected && <ConnectionBadge state={connState} onReconnect={startStream} />}
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Failed to load equipment</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {loadingEquipment && (
        <Card><CardContent className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading equipment…
        </CardContent></Card>
      )}

      {!loadingEquipment && !loadError && equipmentList.length === 0 && (
        <Alert>
          <Plug className="h-4 w-4" />
          <AlertTitle>No signal generators registered</AlertTitle>
          <AlertDescription>
            Register a Keysight signal generator (e.g. N5181B MXG) on the <strong>Test Equipment</strong> page first.
          </AlertDescription>
        </Alert>
      )}

      {!loadingEquipment && equipmentList.length > 0 && (
        <>
          {/* Picker */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Instrument</CardTitle>
              <CardDescription>Choose any active signal generator</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedId != null ? String(selectedId) : ''}
                onValueChange={(v) => setSelectedId(Number(v))}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Select signal generator…" /></SelectTrigger>
                <SelectContent>
                  {equipmentList.map((eq) => (
                    <SelectItem key={eq.id} value={String(eq.id)}>
                      <div className="flex flex-col">
                        <span className="font-medium">{eq.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {[eq.model, eq.connection_address].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selected && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              {/* Left column: status + frequency / amplitude / sweep / modulation */}
              <div className="lg:col-span-3 space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">Live Status</CardTitle>
                        <CardDescription>FREQ?, POW?, OUTP? polled at the configured interval</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {streaming && (
                          <Badge className="bg-blue-500 text-white">
                            <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse mr-1.5" />
                            Polling
                          </Badge>
                        )}
                        <Button onClick={toggleStream} variant={streaming ? 'destructive' : 'default'} size="sm">
                          {streaming
                            ? (<><Square className="h-4 w-4 mr-1.5" /> Stop</>)
                            : (<><Play className="h-4 w-4 mr-1.5" /> Start</>)}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <StatusPanel
                      freqHz={freqHz}
                      ampDbm={ampDbm}
                      rfOn={rfOn}
                      modOn={modOn}
                      am={amOn}
                      fm={fmOn}
                      pm={pmOn}
                      pulse={pulseOn}
                      refExt={refSource === 'EXT'}
                    />
                    {streamError && (
                      <Alert variant="destructive">
                        <AlertDescription>{streamError}</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>

                {/* Frequency + amplitude */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">CW Frequency &amp; Amplitude</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <form className="grid grid-cols-[1fr_120px_auto] gap-2 items-end"
                      onSubmit={(e) => { e.preventDefault(); void applyFrequency() }}>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Frequency</label>
                        <Input value={freqInput} onChange={(e) => setFreqInput(e.target.value)}
                          placeholder="2.85" className="h-9 font-mono" />
                      </div>
                      <Select value={freqUnit} onValueChange={(v) => setFreqUnit(v as FreqUnit)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FREQ_UNITS.map((u) => (
                            <SelectItem key={u.v} value={u.v}>{u.l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="submit" size="sm" className="h-9">Set</Button>
                    </form>

                    <form className="grid grid-cols-[1fr_120px_auto] gap-2 items-end"
                      onSubmit={(e) => { e.preventDefault(); void applyAmplitude() }}>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Amplitude</label>
                        <Input value={ampInput} onChange={(e) => setAmpInput(e.target.value)}
                          placeholder="-10.00" className="h-9 font-mono" />
                      </div>
                      <div className="text-xs text-muted-foreground self-end pb-2 px-2">dBm</div>
                      <Button type="submit" size="sm" className="h-9">Set</Button>
                    </form>

                    <form className="grid grid-cols-[1fr_120px_auto] gap-2 items-end"
                      onSubmit={(e) => { e.preventDefault(); void applyAmpOffset() }}>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Amplitude offset</label>
                        <Input value={ampOffset} onChange={(e) => setAmpOffset(e.target.value)}
                          placeholder="0.00" className="h-9 font-mono" />
                      </div>
                      <div className="text-xs text-muted-foreground self-end pb-2 px-2">dB</div>
                      <Button type="submit" size="sm" variant="outline" className="h-9">Set</Button>
                    </form>

                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <Button size="sm" variant={rfOn ? 'destructive' : 'default'} onClick={() => void toggleRf()}>
                        <Power className="h-3.5 w-3.5 mr-1.5" />
                        RF {rfOn ? 'OFF' : 'ON'}
                      </Button>
                      <Button size="sm" variant={modOn ? 'default' : 'outline'} onClick={() => void toggleMod()}>
                        Modulation {modOn ? 'OFF' : 'ON'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Sweep */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Frequency Sweep</CardTitle>
                    <CardDescription>Step / list mode — set start, stop, step, then choose mode</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-[1fr_1fr_1fr_120px] gap-2 items-end">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Start</label>
                        <Input value={sweepStart} onChange={(e) => setSweepStart(e.target.value)}
                          className="h-9 font-mono" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Stop</label>
                        <Input value={sweepStop} onChange={(e) => setSweepStop(e.target.value)}
                          className="h-9 font-mono" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Step</label>
                        <Input value={sweepStep} onChange={(e) => setSweepStep(e.target.value)}
                          className="h-9 font-mono" />
                      </div>
                      <Select value={sweepUnit} onValueChange={(v) => setSweepUnit(v as FreqUnit)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FREQ_UNITS.map((u) => (
                            <SelectItem key={u.v} value={u.v}>{u.l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => void applySweep()}>Apply Range</Button>
                      <Button size="sm" variant={freqMode === 'CW' ? 'default' : 'outline'}
                        onClick={() => void setMode('CW')}>CW</Button>
                      <Button size="sm" variant={freqMode === 'SWE' ? 'default' : 'outline'}
                        onClick={() => void setMode('SWE')}>Sweep</Button>
                      <Button size="sm" variant={freqMode === 'LIST' ? 'default' : 'outline'}
                        onClick={() => void setMode('LIST')}>List</Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Modulation — AM / FM / PM / Pulse */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Modulation</CardTitle>
                    <CardDescription>Configure parameters, then apply &amp; toggle the subsystem</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* AM */}
                    <div className="space-y-2 border rounded-md p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">AM</div>
                        <Button size="sm" variant={amOn ? 'default' : 'outline'} className="h-7"
                          onClick={() => void toggleAm()}>{amOn ? 'ON' : 'OFF'}</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Depth %</label>
                          <Input value={amDepth} onChange={(e) => setAmDepth(e.target.value)} className="h-8 font-mono text-xs" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Int Hz</label>
                          <Input value={amFreq} onChange={(e) => setAmFreq(e.target.value)} className="h-8 font-mono text-xs" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Select value={amSrc} onValueChange={(v) => setAmSrc(v as ModSource)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="INT">Internal</SelectItem>
                            <SelectItem value="EXT">External</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={amFunc} onValueChange={(v) => setAmFunc(v as IntFunction)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FUNCTIONS.map((f) => (
                              <SelectItem key={f.v} value={f.v}>{f.l}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button size="sm" variant="outline" className="w-full h-8" onClick={() => void applyAm()}>Apply AM</Button>
                    </div>

                    {/* FM */}
                    <div className="space-y-2 border rounded-md p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">FM</div>
                        <Button size="sm" variant={fmOn ? 'default' : 'outline'} className="h-7"
                          onClick={() => void toggleFm()}>{fmOn ? 'ON' : 'OFF'}</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Dev Hz</label>
                          <Input value={fmDev} onChange={(e) => setFmDev(e.target.value)} className="h-8 font-mono text-xs" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Int Hz</label>
                          <Input value={fmFreq} onChange={(e) => setFmFreq(e.target.value)} className="h-8 font-mono text-xs" />
                        </div>
                      </div>
                      <Select value={fmSrc} onValueChange={(v) => setFmSrc(v as ModSource)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="INT">Internal</SelectItem>
                          <SelectItem value="EXT">External</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" className="w-full h-8" onClick={() => void applyFm()}>Apply FM</Button>
                    </div>

                    {/* PM */}
                    <div className="space-y-2 border rounded-md p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">ΦM (Phase)</div>
                        <Button size="sm" variant={pmOn ? 'default' : 'outline'} className="h-7"
                          onClick={() => void togglePm()}>{pmOn ? 'ON' : 'OFF'}</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Dev rad</label>
                          <Input value={pmDev} onChange={(e) => setPmDev(e.target.value)} className="h-8 font-mono text-xs" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Int Hz</label>
                          <Input value={pmFreq} onChange={(e) => setPmFreq(e.target.value)} className="h-8 font-mono text-xs" />
                        </div>
                      </div>
                      <Select value={pmSrc} onValueChange={(v) => setPmSrc(v as ModSource)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="INT">Internal</SelectItem>
                          <SelectItem value="EXT">External</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" className="w-full h-8" onClick={() => void applyPm()}>Apply ΦM</Button>
                    </div>

                    {/* Pulse */}
                    <div className="space-y-2 border rounded-md p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">Pulse</div>
                        <Button size="sm" variant={pulseOn ? 'default' : 'outline'} className="h-7"
                          onClick={() => void togglePulse()}>{pulseOn ? 'ON' : 'OFF'}</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">PRF Hz</label>
                          <Input value={pulFreq} onChange={(e) => setPulFreq(e.target.value)} className="h-8 font-mono text-xs" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Width µs</label>
                          <Input value={pulWidth} onChange={(e) => setPulWidth(e.target.value)} className="h-8 font-mono text-xs" />
                        </div>
                      </div>
                      <Select value={pulSrc} onValueChange={(v) => setPulSrc(v as ModSource)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="INT">Internal</SelectItem>
                          <SelectItem value="EXT">External</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" className="w-full h-8" onClick={() => void applyPulse()}>Apply Pulse</Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right column: reference / ALC / acquisition / diagnostics / SCPI */}
              <div className="lg:col-span-2 space-y-4">
                {/* Reference + ALC */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Reference / ALC</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">10 MHz reference</label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant={refSource === 'INT' ? 'default' : 'outline'}
                          onClick={() => void setRef('INT')}>Internal</Button>
                        <Button size="sm" variant={refSource === 'EXT' ? 'default' : 'outline'}
                          onClick={() => void setRef('EXT')}>External</Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Automatic Level Control</label>
                      <Button size="sm" variant={alcOn ? 'default' : 'outline'} className="w-full"
                        onClick={() => void toggleAlc()}>
                        ALC {alcOn ? 'ON' : 'OFF'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Acquisition */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Acquisition</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" onClick={() => void refreshStatus()}>
                        <Zap className="h-3.5 w-3.5 mr-1.5" /> Refresh
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void resetSg()}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
                      </Button>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-muted-foreground">Polling rate</label>
                      <Select value={String(intervalMs)} onValueChange={(v) => setIntervalMs(Number(v))}>
                        <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="500">2 Hz (500 ms)</SelectItem>
                          <SelectItem value="1000">1 Hz (1 s)</SelectItem>
                          <SelectItem value="2000">0.5 Hz (2 s)</SelectItem>
                          <SelectItem value="5000">0.2 Hz (5 s)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Diagnostics */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Diagnostics</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" onClick={() => void runSelfTest()}>Self-Test (*TST?)</Button>
                      <Button size="sm" variant="outline" onClick={() => void drainErrors()}>Drain Errors</Button>
                    </div>
                    <div className="text-xs font-mono bg-slate-50 border rounded p-2">
                      <div><span className="text-slate-500">*TST? </span>{selfTestResult}</div>
                      {errorQueue.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          <div className="text-slate-500">SYST:ERR? queue:</div>
                          {errorQueue.map((e, i) => (
                            <div key={i} className={cn(
                              e.startsWith('+0,') || e === '(empty)' ? 'text-emerald-700' : 'text-red-600',
                            )}>{e}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Raw SCPI */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Raw SCPI</CardTitle>
                    <CardDescription>Send arbitrary commands</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <form onSubmit={handleScpiSubmit} className="flex items-center gap-2">
                      <Input
                        value={scpiInput}
                        onChange={(e) => setScpiInput(e.target.value)}
                        placeholder="e.g. *IDN? or FREQ 2.85GHZ"
                        className="h-8 font-mono text-xs"
                      />
                      <Button type="submit" size="sm" className="h-8" disabled={!scpiInput.trim()}>Send</Button>
                    </form>
                    {scpiLog.length > 0 && (
                      <div className="rounded border bg-slate-50 max-h-60 overflow-y-auto p-2 space-y-1.5 font-mono text-[11px]">
                        {scpiLog.map((entry) => (
                          <div key={entry.id} className="border-b border-slate-200 pb-1.5 last:border-0">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-400">{entry.timestamp}</span>
                              <span className="text-blue-600">&gt;&gt;&gt; {entry.command}</span>
                            </div>
                            {entry.error ? (
                              <div className="text-red-600 break-all">!!! {entry.error}</div>
                            ) : (
                              <div className="text-emerald-700 break-all">
                                &lt;&lt;&lt; {entry.response ?? '(ok)'}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

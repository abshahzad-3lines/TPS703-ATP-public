/**
 * PowerMeterBenchPage — full Keysight P-Series (N1911A / N1912A) control.
 *
 * Mirrors the structure of InstrumentBenchPage but exposes the controls a
 * power meter operator actually uses:
 *   - Per-channel readouts (Ch A / Ch B), units (dBm / W), frequency,
 *     averaging, gain offset, math (single / ratio / difference), relative,
 *     zero & cal, continuous-trigger toggle.
 *   - Streaming both channels via the bench WebSocket using the new
 *     `pmeter_dual` step type (FETC1? + FETC2? per tick).
 *   - Stats + trend chart for the active channel.
 *   - Raw SCPI input box.
 *
 * SCPI is per the Keysight N1911A/N1912A Programming Guide. Channel index
 * suffixes (1|2) on SENS, UNIT, CALC, CAL and INIT make every command
 * channel-specific.
 *
 * No fake instruments and no synthesised values — the page only operates
 * on registered active equipment with instrument_role = 'power_meter'.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Activity, Loader2, Play, Plug, PlugZap, RotateCcw, Square, Trash2, Zap, Power,
} from 'lucide-react'
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis, Legend,
} from 'recharts'

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

type Channel = 1 | 2
type Unit = 'DBM' | 'W'
type MathMode = 'A' | 'B' | 'A_OVER_B' | 'A_MINUS_B' | 'B_OVER_A' | 'B_MINUS_A'

const MATH_EXPR: Record<MathMode, string> = {
  A: '(SENS1)',
  B: '(SENS2)',
  A_OVER_B: '(SENS1/SENS2)',
  B_OVER_A: '(SENS2/SENS1)',
  A_MINUS_B: '(SENS1-SENS2)',
  B_MINUS_A: '(SENS2-SENS1)',
}

const MATH_LABEL: Record<MathMode, string> = {
  A: 'Ch A only',
  B: 'Ch B only',
  A_OVER_B: 'A / B (ratio)',
  B_OVER_A: 'B / A (ratio)',
  A_MINUS_B: 'A − B',
  B_MINUS_A: 'B − A',
}

const INTERVAL_OPTIONS = [
  { value: 250,  label: '4 Hz (250 ms)' },
  { value: 500,  label: '2 Hz (500 ms)' },
  { value: 1000, label: '1 Hz (1 s)'    },
  { value: 2000, label: '0.5 Hz (2 s)'  },
]

const TREND_BUFFER_MAX = 600
const TREND_DISPLAY = 120

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

function formatPower(value: number | null, unit: Unit): string {
  if (value === null || !Number.isFinite(value)) return '--.------'
  if (unit === 'DBM') {
    if (Math.abs(value) >= 100) return value.toFixed(3)
    if (Math.abs(value) >= 10)  return value.toFixed(4)
    return value.toFixed(5)
  }
  // Watts — auto-prefix
  const abs = Math.abs(value)
  if (abs === 0) return '0.000 W'
  const log = Math.log10(abs)
  let prefix = '', scale = 1
  if (log >= 0)        { prefix = '';  scale = 1     }
  else if (log >= -3)  { prefix = 'm'; scale = 1e3   }
  else if (log >= -6)  { prefix = 'µ'; scale = 1e6   }
  else if (log >= -9)  { prefix = 'n'; scale = 1e9   }
  else                 { prefix = 'p'; scale = 1e12  }
  const scaled = value * scale
  return `${scaled.toFixed(3)} ${prefix}`
}

function unitSuffix(unit: Unit): string {
  return unit === 'DBM' ? 'dBm' : 'W'
}

function formatStat(value: number | null, unit: Unit): string {
  if (value === null || !Number.isFinite(value)) return '--'
  return `${formatPower(value, unit)} ${unit === 'DBM' ? 'dBm' : 'W'}`.trim()
}

// 9.91e37 = SCPI "no reading available" / Keysight overload sentinel
function isOverload(v: number | null): boolean {
  return v !== null && Number.isFinite(v) && Math.abs(v) >= 9.85e37
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConnectionBadge({ state, onReconnect }: { state: ConnectionState; onReconnect: () => void }) {
  const config: Record<ConnectionState, { label: string; cls: string; pulse?: boolean }> = {
    idle: { label: 'Idle', cls: 'bg-slate-200 text-slate-700' },
    connecting: { label: 'Connecting…', cls: 'bg-amber-500 text-white', pulse: true },
    open: { label: 'Connected', cls: 'bg-emerald-500 text-white' },
    error: { label: 'Connection error', cls: 'bg-red-500 text-white' },
    closed: { label: 'Offline', cls: 'bg-slate-500 text-white' },
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
          <PlugZap className="h-3.5 w-3.5 mr-1" />
          Reconnect
        </Button>
      )}
    </div>
  )
}

interface ChannelReadoutProps {
  label: string
  value: number | null
  unit: Unit
  freqHz: number | null
  averaging: boolean
  averagingCount: number
  offsetDb: number
  offsetEnabled: boolean
  active: boolean
  streaming: boolean
}

function ChannelReadout({
  label, value, unit, freqHz, averaging, averagingCount, offsetDb, offsetEnabled, active, streaming,
}: ChannelReadoutProps) {
  const overload = isOverload(value)
  const display = overload ? 'OL' : formatPower(value, unit)
  return (
    <div className={cn(
      'rounded-md border-2 bg-[#0a0d12] text-slate-100 p-3 font-mono',
      active ? 'border-cyan-500/70' : 'border-slate-700',
    )}>
      <div className="flex items-center gap-2 text-[11px] tracking-wider text-cyan-400 pb-2 border-b border-slate-800">
        <span className="font-bold text-slate-100">{label}</span>
        <span className="text-slate-700">|</span>
        <span>{freqHz != null ? `${(freqHz / 1e6).toFixed(3)} MHz` : '— MHz'}</span>
        {averaging && (
          <>
            <span className="text-slate-700">|</span>
            <span className="text-slate-500">AVG×{averagingCount}</span>
          </>
        )}
        {offsetEnabled && (
          <>
            <span className="text-slate-700">|</span>
            <span className="text-amber-400">OFFS {offsetDb.toFixed(2)} dB</span>
          </>
        )}
        {active && <span className="ml-auto text-cyan-400">SEL</span>}
      </div>
      <div className="flex items-baseline justify-end gap-2 py-4 px-1">
        {overload ? (
          <span className="text-5xl font-light text-red-400 tabular-nums">OL</span>
        ) : (
          <>
            <span className="text-5xl font-extralight tracking-tight tabular-nums leading-none">
              {display}
            </span>
            <span className="text-xl font-light text-cyan-400 pl-1">{unitSuffix(unit)}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] tracking-widest font-bold pt-2 border-t border-slate-800">
        <span className={cn('px-1.5 py-px border rounded',
          streaming ? 'text-cyan-400 border-cyan-400/40' : 'text-slate-700 border-slate-800',
        )}>RMT</span>
        <span className={cn('px-1.5 py-px border rounded',
          streaming ? 'text-cyan-400 border-cyan-400/40' : 'text-slate-700 border-slate-800',
        )}>TRIG</span>
        <span className={cn('px-1.5 py-px border rounded',
          overload ? 'text-red-400 border-red-400/40' : 'text-slate-700 border-slate-800',
        )}>OVLD</span>
        <span className="ml-auto text-slate-500">{formatHHMMSS()}</span>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-slate-900 truncate" title={value}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PowerMeterBenchPage() {
  const params = useParams<{ equipmentId?: string }>()
  const preselectedId = params.equipmentId ? Number(params.equipmentId) : null

  // Equipment list
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([])
  const [loadingEquipment, setLoadingEquipment] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Stream / value state
  const [streaming, setStreaming] = useState(false)
  const [chA, setChA] = useState<number | null>(null)
  const [chB, setChB] = useState<number | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [connState, setConnState] = useState<ConnectionState>('idle')

  // Per-channel meter state — mirrors what's set on the meter
  const [activeChannel, setActiveChannel] = useState<Channel>(1)
  const [unitA, setUnitA] = useState<Unit>('DBM')
  const [unitB, setUnitB] = useState<Unit>('DBM')
  const [freqAMHz, setFreqAMHz] = useState<string>('1000')
  const [freqBMHz, setFreqBMHz] = useState<string>('1000')
  const [avgAOn, setAvgAOn] = useState<boolean>(true)
  const [avgACount, setAvgACount] = useState<string>('16')
  const [avgAuto, setAvgAuto] = useState<boolean>(false)
  const [avgBOn, setAvgBOn] = useState<boolean>(true)
  const [avgBCount, setAvgBCount] = useState<string>('16')
  const [offsetADb, setOffsetADb] = useState<string>('0.00')
  const [offsetAOn, setOffsetAOn] = useState<boolean>(false)
  const [offsetBDb, setOffsetBDb] = useState<string>('0.00')
  const [offsetBOn, setOffsetBOn] = useState<boolean>(false)
  const [mathMode, setMathMode] = useState<MathMode>('A')
  const [continuousA, setContinuousA] = useState<boolean>(true)
  const [continuousB, setContinuousB] = useState<boolean>(true)

  // Acquisition control
  const [intervalMs, setIntervalMs] = useState<number>(500)

  // SCPI box
  const [scpiInput, setScpiInput] = useState('')
  const [scpiLog, setScpiLog] = useState<ScpiLogEntry[]>([])
  const scpiLogIdRef = useRef(0)

  // Trend buffer (per channel)
  const [trendA, setTrendA] = useState<{ t: number; v: number }[]>([])
  const [trendB, setTrendB] = useState<{ t: number; v: number }[]>([])

  const wsRef = useRef<WebSocket | null>(null)

  // Load equipment list, filtered to power meters only
  useEffect(() => {
    setLoadingEquipment(true)
    api.get<Equipment[]>('/equipment?is_active=1')
      .then((data) => {
        setEquipmentList(data.filter((e) => e.instrument_role === 'power_meter'))
        setLoadError(null)
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load equipment'))
      .finally(() => setLoadingEquipment(false))
  }, [])

  useEffect(() => {
    if (equipmentList.length === 0) { setSelectedId(null); return }
    if (preselectedId != null && equipmentList.some((e) => e.id === preselectedId)) {
      setSelectedId(preselectedId)
      return
    }
    if (selectedId == null) setSelectedId(equipmentList[0].id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentList, preselectedId])

  const selected = useMemo(
    () => equipmentList.find((e) => e.id === selectedId) ?? null,
    [equipmentList, selectedId],
  )

  const activeUnit = activeChannel === 1 ? unitA : unitB
  const activeTrend = activeChannel === 1 ? trendA : trendB

  // Stats — for the active channel
  const stats = useMemo(() => {
    const arr = activeTrend.map((p) => p.v).filter((v) => Number.isFinite(v) && !isOverload(v))
    const n = arr.length
    if (n === 0) return { n: 0, avg: null as number | null, min: null as number | null, max: null as number | null, pp: null as number | null, sd: null as number | null }
    let sum = 0, mn = Infinity, mx = -Infinity
    for (const v of arr) { sum += v; if (v < mn) mn = v; if (v > mx) mx = v }
    const avg = sum / n
    let varSum = 0
    for (const v of arr) { const d = v - avg; varSum += d * d }
    const sd = n > 1 ? Math.sqrt(varSum / (n - 1)) : 0
    return { n, avg, min: mn, max: mx, pp: mx - mn, sd }
  }, [activeTrend])

  const trendChartData = useMemo(() => {
    const a = trendA.slice(-TREND_DISPLAY)
    const b = trendB.slice(-TREND_DISPLAY)
    const len = Math.max(a.length, b.length)
    return Array.from({ length: len }).map((_, i) => ({
      idx: i,
      a: a[i]?.v ?? null,
      b: b[i]?.v ?? null,
    }))
  }, [trendA, trendB])

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
  // Channel-aware command helpers
  // ---------------------------------------------------------------------------

  const setUnit = useCallback(async (ch: Channel, u: Unit) => {
    if (ch === 1) setUnitA(u); else setUnitB(u)
    await sendScpi(`UNIT${ch}:POW ${u}`, false)
    setTrendA([]); setTrendB([])
  }, [sendScpi])

  const setFrequency = useCallback(async (ch: Channel, mhzStr: string) => {
    const mhz = Number(mhzStr)
    if (!Number.isFinite(mhz) || mhz <= 0) return
    const hz = Math.round(mhz * 1e6)
    await sendScpi(`SENS${ch}:FREQ ${hz}`, false)
  }, [sendScpi])

  const setAveraging = useCallback(async (ch: Channel, on: boolean, count: string, auto: boolean) => {
    await sendScpi(`SENS${ch}:AVER:STAT ${on ? 'ON' : 'OFF'}`, false)
    if (on) {
      await sendScpi(`SENS${ch}:AVER:COUN:AUTO ${auto ? 'ON' : 'OFF'}`, false)
      if (!auto) {
        const n = parseInt(count, 10)
        if (Number.isFinite(n) && n > 0) {
          await sendScpi(`SENS${ch}:AVER:COUN ${n}`, false)
        }
      }
    }
  }, [sendScpi])

  const setOffset = useCallback(async (ch: Channel, db: string, on: boolean) => {
    const v = Number(db)
    if (Number.isFinite(v)) {
      await sendScpi(`SENS${ch}:CORR:GAIN2 ${v}`, false)
    }
    await sendScpi(`SENS${ch}:CORR:GAIN2:STAT ${on ? 'ON' : 'OFF'}`, false)
  }, [sendScpi])

  const applyMath = useCallback(async (mode: MathMode) => {
    setMathMode(mode)
    // Apply to active window so the front-panel display matches.
    await sendScpi(`CALC${activeChannel}:MATH "${MATH_EXPR[mode]}"`, false)
  }, [sendScpi, activeChannel])

  const relativeOn = useCallback(async (ch: Channel) => {
    await sendScpi(`CALC${ch}:REL:AUTO ONCE`, false)
    await sendScpi(`CALC${ch}:REL:STAT ON`, false)
  }, [sendScpi])

  const relativeOff = useCallback(async (ch: Channel) => {
    await sendScpi(`CALC${ch}:REL:STAT OFF`, false)
  }, [sendScpi])

  const zeroChannel = useCallback(async (ch: Channel) => {
    await sendScpi(`CAL${ch}:ZERO:AUTO ONCE`, false)
  }, [sendScpi])

  const calChannel = useCallback(async (ch: Channel) => {
    await sendScpi(`CAL${ch}:AUTO ONCE`, false)
  }, [sendScpi])

  const toggleContinuous = useCallback(async (ch: Channel, on: boolean) => {
    if (ch === 1) setContinuousA(on); else setContinuousB(on)
    await sendScpi(`INIT${ch}:CONT ${on ? 'ON' : 'OFF'}`, false)
  }, [sendScpi])

  // ---------------------------------------------------------------------------
  // Streaming via /ws/equipment/{id}
  // ---------------------------------------------------------------------------

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: 'stop_stream' })) } catch { /* ignore */ }
      try { wsRef.current.close() } catch { /* ignore */ }
      wsRef.current = null
    }
    setStreaming(false)
    setConnState('closed')
  }, [])

  // Reset state when equipment changes
  useEffect(() => {
    closeWs()
    setChA(null); setChB(null)
    setStreamError(null)
    setConnState('idle')
    setTrendA([]); setTrendB([])
    setScpiLog([])
    scpiLogIdRef.current = 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => () => { closeWs() }, [closeWs])

  const startStream = useCallback(() => {
    if (!selected) return
    setStreamError(null)
    setChA(null); setChB(null)
    setConnState('connecting')

    const ws = new WebSocket(buildWsUrl(selected.id))
    wsRef.current = ws

    ws.onopen = () => {
      setConnState('open')
      ws.send(JSON.stringify({
        type: 'start_stream',
        step_type: 'pmeter_dual',  // FETC1? + FETC2? per tick
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
          const a = typeof msg.value === 'number' ? msg.value : null
          const b = typeof msg.secondary_value === 'number' ? msg.secondary_value : null
          setChA(a)
          setChB(b)
          if (a !== null && Number.isFinite(a) && !isOverload(a)) {
            setTrendA((prev) => {
              const next = prev.length >= TREND_BUFFER_MAX ? prev.slice(1) : prev.slice()
              next.push({ t: Date.now(), v: a })
              return next
            })
          }
          if (b !== null && Number.isFinite(b) && !isOverload(b)) {
            setTrendB((prev) => {
              const next = prev.length >= TREND_BUFFER_MAX ? prev.slice(1) : prev.slice()
              next.push({ t: Date.now(), v: b })
              return next
            })
          }
        } else if (msg.type === 'error') {
          setStreamError(String(msg.message ?? 'Stream error'))
        }
      } catch { /* ignore */ }
    }
    ws.onerror = () => { setStreamError('WebSocket connection error'); setConnState('error') }
    ws.onclose = () => { setStreaming(false); setConnState((s) => (s === 'error' ? s : 'closed')) }
  }, [selected, intervalMs])

  // Restart stream when interval changes mid-flight
  useEffect(() => {
    if (!streaming) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: 'start_stream',
      step_type: 'pmeter_dual',
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
  // Single-shot + reset
  // ---------------------------------------------------------------------------

  const singleShot = useCallback(async () => {
    if (!selected) return
    try {
      const r = await api.post<{ value: number | null; secondary_value: number | null }>(
        `/equipment/${selected.id}/measure`,
        { step_type: 'pmeter_dual', params: {} },
      )
      setChA(typeof r.value === 'number' ? r.value : null)
      setChB(typeof r.secondary_value === 'number' ? r.secondary_value : null)
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : 'Measurement failed')
    }
  }, [selected])

  const resetMeter = useCallback(async () => {
    await sendScpi('*RST', false)
    await sendScpi('*CLS', false)
    setUnitA('DBM'); setUnitB('DBM')
    setAvgAOn(true); setAvgBOn(true); setAvgAuto(false)
    setOffsetAOn(false); setOffsetBOn(false)
    setMathMode('A')
    setContinuousA(true); setContinuousB(true)
    setTrendA([]); setTrendB([])
    setChA(null); setChB(null)
  }, [sendScpi])

  const clearStats = useCallback(() => {
    setTrendA([]); setTrendB([])
  }, [])

  // ---------------------------------------------------------------------------
  // Raw SCPI
  // ---------------------------------------------------------------------------

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
      <title>Power Meter Bench - TPS-703 ATP</title>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className="h-7 w-7 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Power Meter Bench</h1>
            <p className="text-sm text-muted-foreground">
              Dual-channel control: frequency, units, averaging, offsets, math, zero/cal, raw SCPI.
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
          <AlertTitle>No power meters registered</AlertTitle>
          <AlertDescription>
            Register a Keysight power meter (e.g. N1912A) on the <strong>Test Equipment</strong> page first.
          </AlertDescription>
        </Alert>
      )}

      {!loadingEquipment && equipmentList.length > 0 && (
        <>
          {/* Picker */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Instrument</CardTitle>
              <CardDescription>Choose any active power meter</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedId != null ? String(selectedId) : ''}
                onValueChange={(v) => setSelectedId(Number(v))}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Select power meter…" /></SelectTrigger>
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
              {/* Left column: readouts + stats + trend */}
              <div className="lg:col-span-3 space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">Live Readings</CardTitle>
                        <CardDescription>FETC1? + FETC2? streamed at the configured interval</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {streaming && (
                          <Badge className="bg-blue-500 text-white">
                            <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse mr-1.5" />
                            Streaming
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <ChannelReadout
                        label="Channel A"
                        value={chA}
                        unit={unitA}
                        freqHz={Number(freqAMHz) ? Number(freqAMHz) * 1e6 : null}
                        averaging={avgAOn}
                        averagingCount={Number(avgACount) || 1}
                        offsetDb={Number(offsetADb) || 0}
                        offsetEnabled={offsetAOn}
                        active={activeChannel === 1}
                        streaming={streaming}
                      />
                      <ChannelReadout
                        label="Channel B"
                        value={chB}
                        unit={unitB}
                        freqHz={Number(freqBMHz) ? Number(freqBMHz) * 1e6 : null}
                        averaging={avgBOn}
                        averagingCount={Number(avgBCount) || 1}
                        offsetDb={Number(offsetBDb) || 0}
                        offsetEnabled={offsetBOn}
                        active={activeChannel === 2}
                        streaming={streaming}
                      />
                    </div>
                    {streamError && (
                      <Alert variant="destructive">
                        <AlertDescription>{streamError}</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>

                {/* Stats — for active channel */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Statistics — {activeChannel === 1 ? 'Channel A' : 'Channel B'}</CardTitle>
                      <Button size="sm" variant="ghost" className="h-7" onClick={clearStats}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
                      </Button>
                    </div>
                    <CardDescription>Last {Math.min(activeTrend.length, TREND_BUFFER_MAX)} samples</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 font-mono">
                      <Stat label="Avg" value={formatStat(stats.avg, activeUnit)} />
                      <Stat label="Min" value={formatStat(stats.min, activeUnit)} />
                      <Stat label="Max" value={formatStat(stats.max, activeUnit)} />
                      <Stat label="Pk-Pk" value={formatStat(stats.pp, activeUnit)} />
                      <Stat label="σ" value={formatStat(stats.sd, activeUnit)} />
                      <Stat label="Samples" value={String(stats.n)} />
                    </div>
                  </CardContent>
                </Card>

                {/* Trend chart — both channels overlaid */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Trend</CardTitle>
                    <CardDescription>Last {TREND_DISPLAY} samples (Ch A blue, Ch B amber)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-44 -mx-2">
                      {trendChartData.length < 2 ? (
                        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                          No data yet — press Start to begin streaming
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trendChartData} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="idx" hide />
                            <YAxis tick={{ fontSize: 10 }} width={70} domain={['auto', 'auto']} />
                            <ReferenceLine y={stats.avg ?? 0} stroke="#94a3b8" strokeDasharray="4 4" />
                            <Line type="monotone" dataKey="a" name="Ch A" stroke="#2563eb" strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />
                            <Line type="monotone" dataKey="b" name="Ch B" stroke="#f59e0b" strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right column: controls */}
              <div className="lg:col-span-2 space-y-4">
                {/* Active channel + units */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Active Channel</CardTitle>
                    <CardDescription>Controls below target this channel</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant={activeChannel === 1 ? 'default' : 'outline'} onClick={() => setActiveChannel(1)}>Channel A</Button>
                      <Button size="sm" variant={activeChannel === 2 ? 'default' : 'outline'} onClick={() => setActiveChannel(2)}>Channel B</Button>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Units</label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm"
                          variant={(activeChannel === 1 ? unitA : unitB) === 'DBM' ? 'default' : 'outline'}
                          onClick={() => setUnit(activeChannel, 'DBM')}>dBm</Button>
                        <Button size="sm"
                          variant={(activeChannel === 1 ? unitA : unitB) === 'W' ? 'default' : 'outline'}
                          onClick={() => setUnit(activeChannel, 'W')}>Watts</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Frequency */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Frequency</CardTitle>
                    <CardDescription>Sensor calibration frequency</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => { e.preventDefault(); setFrequency(activeChannel, activeChannel === 1 ? freqAMHz : freqBMHz) }}
                    >
                      <Input
                        value={activeChannel === 1 ? freqAMHz : freqBMHz}
                        onChange={(e) => activeChannel === 1 ? setFreqAMHz(e.target.value) : setFreqBMHz(e.target.value)}
                        placeholder="2850"
                        className="h-9 font-mono"
                      />
                      <span className="text-xs text-muted-foreground">MHz</span>
                      <Button type="submit" size="sm" className="h-9">Set</Button>
                    </form>
                  </CardContent>
                </Card>

                {/* Averaging */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Averaging</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <Button size="sm"
                        variant={(activeChannel === 1 ? avgAOn : avgBOn) ? 'default' : 'outline'}
                        onClick={() => {
                          const on = !(activeChannel === 1 ? avgAOn : avgBOn)
                          if (activeChannel === 1) setAvgAOn(on); else setAvgBOn(on)
                          void setAveraging(activeChannel, on, activeChannel === 1 ? avgACount : avgBCount, avgAuto)
                        }}>
                        {(activeChannel === 1 ? avgAOn : avgBOn) ? 'On' : 'Off'}
                      </Button>
                      <Button size="sm" variant={avgAuto ? 'default' : 'outline'}
                        onClick={() => {
                          const next = !avgAuto
                          setAvgAuto(next)
                          void setAveraging(activeChannel, activeChannel === 1 ? avgAOn : avgBOn,
                            activeChannel === 1 ? avgACount : avgBCount, next)
                        }}>
                        Auto
                      </Button>
                      <Input
                        value={activeChannel === 1 ? avgACount : avgBCount}
                        onChange={(e) => activeChannel === 1 ? setAvgACount(e.target.value) : setAvgBCount(e.target.value)}
                        onBlur={() => void setAveraging(activeChannel, activeChannel === 1 ? avgAOn : avgBOn,
                          activeChannel === 1 ? avgACount : avgBCount, avgAuto)}
                        placeholder="16"
                        className="h-9 font-mono text-center"
                        disabled={avgAuto}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">Filter count, 1–1024 (Auto picks based on power level).</p>
                  </CardContent>
                </Card>

                {/* Offset */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Gain Offset</CardTitle>
                    <CardDescription>External attenuator / cable loss compensation</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={activeChannel === 1 ? offsetADb : offsetBDb}
                        onChange={(e) => activeChannel === 1 ? setOffsetADb(e.target.value) : setOffsetBDb(e.target.value)}
                        placeholder="0.00"
                        className="h-9 font-mono"
                      />
                      <span className="text-xs text-muted-foreground w-12">dB</span>
                      <Button size="sm" variant={(activeChannel === 1 ? offsetAOn : offsetBOn) ? 'default' : 'outline'}
                        className="w-20"
                        onClick={() => {
                          const on = !(activeChannel === 1 ? offsetAOn : offsetBOn)
                          if (activeChannel === 1) setOffsetAOn(on); else setOffsetBOn(on)
                          void setOffset(activeChannel, activeChannel === 1 ? offsetADb : offsetBDb, on)
                        }}>
                        {(activeChannel === 1 ? offsetAOn : offsetBOn) ? 'On' : 'Off'}
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => void setOffset(activeChannel,
                          activeChannel === 1 ? offsetADb : offsetBDb,
                          activeChannel === 1 ? offsetAOn : offsetBOn)}>
                        Set
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Math */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Math (CALC)</CardTitle>
                    <CardDescription>Combine Ch A and Ch B</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(MATH_LABEL) as MathMode[]).map((m) => (
                        <Button key={m} size="sm" variant={mathMode === m ? 'default' : 'outline'}
                          onClick={() => void applyMath(m)} className="justify-start text-xs">
                          {MATH_LABEL[m]}
                        </Button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <Button size="sm" variant="outline" onClick={() => void relativeOn(activeChannel)}>Set Relative</Button>
                      <Button size="sm" variant="outline" onClick={() => void relativeOff(activeChannel)}>Clear Relative</Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Zero / Cal */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Zero / Cal</CardTitle>
                    <CardDescription>Disconnect the sensor before zeroing</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" onClick={() => void zeroChannel(activeChannel)}>
                        Zero Ch {activeChannel === 1 ? 'A' : 'B'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void calChannel(activeChannel)}>
                        Cal Ch {activeChannel === 1 ? 'A' : 'B'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Trigger / acquisition */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Acquisition</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" onClick={singleShot}>
                        <Zap className="h-3.5 w-3.5 mr-1.5" /> Single
                      </Button>
                      <Button size="sm" variant="outline" onClick={resetMeter}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
                      </Button>
                    </div>
                    <Button size="sm" variant={(activeChannel === 1 ? continuousA : continuousB) ? 'default' : 'outline'}
                      className="w-full"
                      onClick={() => void toggleContinuous(activeChannel, !(activeChannel === 1 ? continuousA : continuousB))}>
                      <Power className="h-3.5 w-3.5 mr-1.5" />
                      {(activeChannel === 1 ? continuousA : continuousB) ? 'Continuous: ON' : 'Continuous: OFF'}
                    </Button>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-muted-foreground">Refresh rate</label>
                      <Select value={String(intervalMs)} onValueChange={(v) => setIntervalMs(Number(v))}>
                        <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {INTERVAL_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Raw SCPI */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Raw SCPI</CardTitle>
                    <CardDescription>Send arbitrary commands to the meter</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <form onSubmit={handleScpiSubmit} className="flex items-center gap-2">
                      <Input
                        value={scpiInput}
                        onChange={(e) => setScpiInput(e.target.value)}
                        placeholder="e.g. *IDN? or FETC1?"
                        className="h-8 font-mono text-xs"
                      />
                      <Button type="submit" size="sm" className="h-8" disabled={!scpiInput.trim()}>
                        Send
                      </Button>
                    </form>
                    {scpiLog.length > 0 && (
                      <div className="rounded border bg-slate-50 max-h-48 overflow-y-auto p-2 space-y-1.5 font-mono text-[11px]">
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

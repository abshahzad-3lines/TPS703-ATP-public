/**
 * InstrumentBenchPage — full DMM control + readout in the dashboard's theme.
 *
 * Functional parity with the standalone /Test app (function/range/NPLC
 * pickers, single shot, reset, stats, bargraph, trend chart, raw SCPI box),
 * styled with shadcn/ui Cards/Buttons/Selects to match the rest of the
 * TPS-703 dashboard.
 *
 * Architecture:
 *   • Function / range / NPLC selection sends CONF:* / SENS:*:NPLC commands
 *     via the existing REST /api/equipment/{id}/scpi endpoint.
 *   • Streaming uses the bench WebSocket with step_type='raw_read', which
 *     just calls READ? against whatever the meter is currently configured
 *     for. Configuration state lives entirely on the meter.
 *   • Single-shot uses POST /api/equipment/{id}/measure with the same
 *     step_type.
 *
 * No fake instruments and no synthesised values — the page only operates on
 * registered active equipment.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Activity, Loader2, Play, Plug, PlugZap, RotateCcw, Square, Trash2, Zap,
} from 'lucide-react'
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis,
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

// ---------------------------------------------------------------------------
// DMM constants — mirrors Test/backend/dmm_driver.py + frontend/app.js
// ---------------------------------------------------------------------------

const FUNCTIONS: { scpi: string; label: string }[] = [
  { scpi: 'VOLT:DC', label: 'DC Voltage' },
  { scpi: 'VOLT:AC', label: 'AC Voltage' },
  { scpi: 'CURR:DC', label: 'DC Current' },
  { scpi: 'CURR:AC', label: 'AC Current' },
  { scpi: 'RES',     label: '2-Wire Ohms' },
  { scpi: 'FRES',    label: '4-Wire Ohms' },
  { scpi: 'FREQ',    label: 'Frequency' },
  { scpi: 'PER',     label: 'Period' },
  { scpi: 'CAP',     label: 'Capacitance' },
  { scpi: 'DIOD',    label: 'Diode' },
  { scpi: 'CONT',    label: 'Continuity' },
  { scpi: 'TEMP',    label: 'Temperature' },
]

const FUNCTION_UNIT: Record<string, string> = {
  'VOLT:DC': 'V', 'VOLT:AC': 'V',
  'CURR:DC': 'A', 'CURR:AC': 'A',
  'RES': 'Ω', 'FRES': 'Ω',
  'FREQ': 'Hz', 'PER': 's',
  'CAP': 'F', 'DIOD': 'V',
  'CONT': 'Ω', 'TEMP': '°C',
}

const RANGES: Record<string, string[]> = {
  'VOLT:DC': ['AUTO', '0.1', '1', '10', '100', '1000'],
  'VOLT:AC': ['AUTO', '0.1', '1', '10', '100', '750'],
  'CURR:DC': ['AUTO', '0.0001', '0.001', '0.01', '0.1', '1', '3', '10'],
  'CURR:AC': ['AUTO', '0.0001', '0.001', '0.01', '0.1', '1', '3', '10'],
  'RES':    ['AUTO', '100', '1E3', '10E3', '100E3', '1E6', '10E6', '100E6', '1E9'],
  'FRES':   ['AUTO', '100', '1E3', '10E3', '100E3', '1E6', '10E6', '100E6', '1E9'],
  'FREQ':   ['AUTO'],
  'PER':    ['AUTO'],
  'CAP':    ['AUTO', '1E-9', '10E-9', '100E-9', '1E-6', '10E-6', '100E-6'],
  'DIOD':   ['AUTO'],
  'CONT':   ['AUTO'],
  'TEMP':   ['AUTO'],
}

const NPLC_OPTIONS = ['0.02', '0.2', '1', '10', '100']
const NPLC_SUPPORTED = new Set(['VOLT:DC', 'CURR:DC', 'RES', 'FRES', 'TEMP', 'DIOD'])

const INTERVAL_OPTIONS = [
  { value: 100,  label: '10 Hz (100 ms)' },
  { value: 250,  label: '4 Hz (250 ms)'  },
  { value: 500,  label: '2 Hz (500 ms)'  },
  { value: 1000, label: '1 Hz (1 s)'     },
  { value: 2000, label: '0.5 Hz (2 s)'   },
]

const TREND_BUFFER_MAX = 600  // ~5 min @ 2 Hz
const TREND_DISPLAY = 120     // points shown on the chart

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

interface SiScaled { display: string; sign: string; prefix: string }

const SI_PREFIXES = [
  { p: 'T', e: 12 }, { p: 'G', e: 9 }, { p: 'M', e: 6 },
  { p: 'k', e: 3 },  { p: '',  e: 0 }, { p: 'm', e: -3 },
  { p: 'µ', e: -6 }, { p: 'n', e: -9 },{ p: 'p', e: -12 },
  { p: 'f', e: -15 },
]

function siScale(value: number | null, baseUnit: string): SiScaled {
  if (value === null || !Number.isFinite(value)) {
    return { display: '--.------', sign: ' ', prefix: '' }
  }
  const sign = value < 0 ? '-' : ' '
  const abs = Math.abs(value)
  if (abs === 0) return { display: '0.000000', sign: ' ', prefix: '' }

  const noScale = baseUnit === '°C'
  let chosen = SI_PREFIXES[4]
  if (!noScale) {
    for (const cand of SI_PREFIXES) {
      const scaled = abs / Math.pow(10, cand.e)
      if (scaled >= 1 && scaled < 1000) { chosen = cand; break }
    }
  }
  const scaled = abs / Math.pow(10, chosen.e)
  let str: string
  if (scaled >= 100) str = scaled.toFixed(4)
  else if (scaled >= 10) str = scaled.toFixed(5)
  else str = scaled.toFixed(6)

  return { display: str, sign, prefix: chosen.p }
}

function formatStat(value: number | null, baseUnit: string): string {
  if (value === null || !Number.isFinite(value)) return '--'
  const s = siScale(value, baseUnit)
  return `${s.sign === '-' ? '-' : ''}${s.display} ${s.prefix}${baseUnit}`
}

function prettyRange(r: string, fn: string): string {
  if (r === 'AUTO') return 'Auto'
  const num = Number(r)
  if (!Number.isFinite(num)) return r
  const s = siScale(num, FUNCTION_UNIT[fn] ?? '')
  return `${s.display.replace(/\.?0+$/, '')} ${s.prefix}${FUNCTION_UNIT[fn] ?? ''}`
}

function formatHHMMSS(date = new Date()): string {
  return date.toTimeString().slice(0, 8)
}

function unitLabel(fn: string): string {
  switch (fn) {
    case 'VOLT:DC': return 'V DC'
    case 'VOLT:AC': return 'V AC'
    case 'CURR:DC': return 'A DC'
    case 'CURR:AC': return 'A AC'
    case 'RES':     return 'Ω'
    case 'FRES':    return 'Ω 4W'
    case 'FREQ':    return 'Hz'
    case 'PER':     return 's'
    case 'CAP':     return 'F'
    case 'DIOD':    return 'V'
    case 'CONT':    return 'Ω'
    case 'TEMP':    return '°C'
    default:        return FUNCTION_UNIT[fn] ?? ''
  }
}

// 9.9e37 = Truevolt overload sentinel.
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

interface PrimaryReadoutProps {
  fn: string
  value: number | null
  range: string
  nplc: string
  streaming: boolean
}

function PrimaryReadout({ fn, value, range, nplc, streaming }: PrimaryReadoutProps) {
  const overload = isOverload(value)
  const baseUnit = FUNCTION_UNIT[fn] ?? ''
  const scaled = overload ? null : siScale(value, baseUnit)
  const label = FUNCTIONS.find((f) => f.scpi === fn)?.label ?? fn

  return (
    <div className="rounded-md border-2 border-slate-700 bg-[#0a0d12] text-slate-100 p-4 font-mono">
      {/* Top status strip */}
      <div className="flex items-center gap-2 text-[11px] tracking-wider text-cyan-400 pb-2 border-b border-slate-800">
        <span className="font-bold text-slate-100">{label}</span>
        <span className="text-slate-700">|</span>
        <span>{range === 'AUTO' ? 'Auto Range' : `Range ${prettyRange(range, fn)}`}</span>
        {NPLC_SUPPORTED.has(fn) && (
          <>
            <span className="text-slate-700">|</span>
            <span className="text-slate-500">{nplc} NPLC</span>
          </>
        )}
        <span className="ml-auto text-slate-500">IMM</span>
      </div>

      {/* Primary readout */}
      <div className="flex items-baseline justify-end gap-2 py-6 px-1">
        {overload ? (
          <span className="text-6xl font-light text-red-400 tabular-nums">OL</span>
        ) : (
          <>
            <span className="text-5xl font-extralight w-[0.55em] text-center">{scaled?.sign ?? ' '}</span>
            <span className="text-7xl font-extralight tracking-tight tabular-nums leading-none">
              {scaled?.display ?? '--.------'}
            </span>
            <span className="flex items-baseline gap-1 pl-2 text-2xl font-light text-cyan-400">
              <span>{scaled?.prefix ?? ''}</span>
              <span dangerouslySetInnerHTML={{ __html: unitHtml(fn) }} />
            </span>
          </>
        )}
      </div>

      {/* Bottom annunciator strip */}
      <div className="flex items-center gap-2 text-[10px] tracking-widest font-bold pt-2 border-t border-slate-800">
        <span className={cn('px-1.5 py-px border rounded', streaming ? 'text-cyan-400 border-cyan-400/40' : 'text-slate-600 border-slate-800')}>
          RMT
        </span>
        <span className={cn('px-1.5 py-px border rounded', streaming ? 'text-cyan-400 border-cyan-400/40' : 'text-slate-700 border-slate-800')}>
          TRIG
        </span>
        <span className={cn('px-1.5 py-px border rounded', overload ? 'text-red-400 border-red-400/40' : 'text-slate-700 border-slate-800')}>
          OVLD
        </span>
        <span className="ml-auto text-slate-500">{formatHHMMSS()}</span>
      </div>
    </div>
  )
}

function unitHtml(fn: string): string {
  const sub: Record<string, string> = {
    'VOLT:DC': 'V<small>DC</small>',
    'VOLT:AC': 'V<small>AC</small>',
    'CURR:DC': 'A<small>DC</small>',
    'CURR:AC': 'A<small>AC</small>',
    'RES':     'Ω',
    'FRES':    'Ω<small>4W</small>',
    'FREQ':    'Hz',
    'PER':     's',
    'CAP':     'F',
    'TEMP':    '°C',
    'DIOD':    'V',
    'CONT':    'Ω',
  }
  return sub[fn] ?? FUNCTION_UNIT[fn] ?? ''
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InstrumentBenchPage() {
  const params = useParams<{ equipmentId?: string }>()
  const preselectedId = params.equipmentId ? Number(params.equipmentId) : null

  // Equipment list
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([])
  const [loadingEquipment, setLoadingEquipment] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Stream / value state
  const [streaming, setStreaming] = useState(false)
  const [latestValue, setLatestValue] = useState<number | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [connState, setConnState] = useState<ConnectionState>('idle')

  // DMM configuration state (mirrors what's set on the meter)
  const [fn, setFn] = useState<string>('VOLT:DC')
  const [range, setRange] = useState<string>('AUTO')
  const [nplc, setNplc] = useState<string>('1')

  // Acquisition control
  const [intervalMs, setIntervalMs] = useState<number>(250)

  // SCPI box
  const [scpiInput, setScpiInput] = useState('')
  const [scpiLog, setScpiLog] = useState<ScpiLogEntry[]>([])
  const scpiLogIdRef = useRef(0)

  // Stats / trend buffer
  const [trendBuffer, setTrendBuffer] = useState<{ t: number; v: number }[]>([])

  // WS
  const wsRef = useRef<WebSocket | null>(null)

  // ---------------------------------------------------------------------------
  // Load equipment
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setLoadingEquipment(true)
    api.get<Equipment[]>('/equipment?is_active=1')
      .then((data) => { setEquipmentList(data); setLoadError(null) })
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
  const baseUnit = FUNCTION_UNIT[fn] ?? ''
  const overload = isOverload(latestValue)

  // ---------------------------------------------------------------------------
  // Stats — derived from buffer
  // ---------------------------------------------------------------------------

  const stats = useMemo(() => {
    const arr = trendBuffer.map((p) => p.v).filter((v) => Number.isFinite(v) && !isOverload(v))
    const n = arr.length
    if (n === 0) return { n: 0, avg: null as number | null, min: null as number | null, max: null as number | null, pp: null as number | null, sd: null as number | null }
    let sum = 0, mn = Infinity, mx = -Infinity
    for (const v of arr) { sum += v; if (v < mn) mn = v; if (v > mx) mx = v }
    const avg = sum / n
    let varSum = 0
    for (const v of arr) { const d = v - avg; varSum += d * d }
    const sd = n > 1 ? Math.sqrt(varSum / (n - 1)) : 0
    return { n, avg, min: mn, max: mx, pp: mx - mn, sd }
  }, [trendBuffer])

  // Bargraph % of full scale (auto-derived when AUTO range)
  const bargraphPct = useMemo(() => {
    if (latestValue == null || overload) return 0
    let full = Number(range)
    if (!Number.isFinite(full) || full <= 0) {
      // AUTO: derive from recent peak
      let m = 0
      for (const p of trendBuffer) if (Math.abs(p.v) > m) m = Math.abs(p.v)
      full = m * 1.1 || 1
    }
    return Math.max(-1, Math.min(1, latestValue / full))
  }, [latestValue, overload, range, trendBuffer])

  // Trend chart data — last N points
  const trendChartData = useMemo(() => {
    const slice = trendBuffer.slice(-TREND_DISPLAY)
    return slice.map((p, i) => ({ idx: i, v: p.v }))
  }, [trendBuffer])

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
  // Configuration commands (CONF + NPLC)
  // ---------------------------------------------------------------------------

  const applyConfiguration = useCallback(
    async (newFn: string, newRange: string, newNplc: string) => {
      const rangeArg = newRange === 'AUTO' ? 'AUTO' : newRange
      await sendScpi(`CONF:${newFn} ${rangeArg}`, false)
      if (NPLC_SUPPORTED.has(newFn) && newNplc) {
        await sendScpi(`SENS:${newFn}:NPLC ${newNplc}`, false)
      }
      await sendScpi('TRIG:SOUR IMM', false)
      await sendScpi('SAMP:COUN 1', false)
      // Clear stats — different function/range = different scale
      setTrendBuffer([])
      setLatestValue(null)
    },
    [sendScpi],
  )

  const selectFn = useCallback((newFn: string) => {
    setFn(newFn)
    setRange('AUTO')
    void applyConfiguration(newFn, 'AUTO', nplc)
  }, [applyConfiguration, nplc])

  const selectRange = useCallback((newRange: string) => {
    setRange(newRange)
    void applyConfiguration(fn, newRange, nplc)
  }, [applyConfiguration, fn, nplc])

  const selectNplc = useCallback((newNplc: string) => {
    setNplc(newNplc)
    void applyConfiguration(fn, range, newNplc)
  }, [applyConfiguration, fn, range])

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
    setLatestValue(null)
    setStreamError(null)
    setConnState('idle')
    setTrendBuffer([])
    setScpiLog([])
    scpiLogIdRef.current = 0
    setFn('VOLT:DC')
    setRange('AUTO')
    setNplc('1')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => () => { closeWs() }, [closeWs])

  const startStream = useCallback(() => {
    if (!selected) return
    setStreamError(null)
    setLatestValue(null)
    setConnState('connecting')

    const ws = new WebSocket(buildWsUrl(selected.id))
    wsRef.current = ws

    ws.onopen = () => {
      setConnState('open')
      ws.send(JSON.stringify({
        type: 'start_stream',
        step_type: 'raw_read',     // stream pulls READ? against current config
        params: {},
        interval_ms: intervalMs,
        include_simulator: false,
      }))
    }
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.type === 'stream_state') setStreaming(Boolean(msg.running))
        else if (msg.type === 'reading' && msg.source === 'live' && typeof msg.value === 'number') {
          setLatestValue(msg.value)
          if (Number.isFinite(msg.value) && !isOverload(msg.value)) {
            const v = msg.value as number
            setTrendBuffer((prev) => {
              const next = prev.length >= TREND_BUFFER_MAX ? prev.slice(1) : prev.slice()
              next.push({ t: Date.now(), v })
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
      step_type: 'raw_read',
      params: {},
      interval_ms: intervalMs,
      include_simulator: false,
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs])

  const toggleStream = useCallback(() => {
    if (streaming) closeWs()
    else startStream()
  }, [streaming, startStream, closeWs])

  // ---------------------------------------------------------------------------
  // Single-shot + reset
  // ---------------------------------------------------------------------------

  const singleShot = useCallback(async () => {
    if (!selected) return
    try {
      const r = await api.post<{ value: number | null; raw_data: unknown }>(
        `/equipment/${selected.id}/measure`,
        { step_type: 'raw_read', params: {} },
      )
      if (typeof r.value === 'number') {
        setLatestValue(r.value)
        if (Number.isFinite(r.value) && !isOverload(r.value)) {
          setTrendBuffer((prev) => {
            const next = prev.length >= TREND_BUFFER_MAX ? prev.slice(1) : prev.slice()
            next.push({ t: Date.now(), v: r.value as number })
            return next
          })
        }
      }
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : 'Measurement failed')
    }
  }, [selected])

  const resetMeter = useCallback(async () => {
    await sendScpi('*RST', false)
    await sendScpi('*CLS', false)
    setFn('VOLT:DC')
    setRange('AUTO')
    setNplc('1')
    setTrendBuffer([])
    setLatestValue(null)
  }, [sendScpi])

  const clearStats = useCallback(() => {
    setTrendBuffer([])
  }, [])

  // ---------------------------------------------------------------------------
  // Raw SCPI submit
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

  const ranges = RANGES[fn] ?? ['AUTO']
  const showNplc = NPLC_SUPPORTED.has(fn)

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <title>Instrument Bench - TPS-703 ATP</title>

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className="h-7 w-7 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Instrument Bench</h1>
            <p className="text-sm text-muted-foreground">
              Full multimeter control: function, range, NPLC, stats, trend, raw SCPI.
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
          <AlertTitle>No active instruments registered</AlertTitle>
          <AlertDescription>
            Register a multimeter on the <strong>Test Equipment</strong> page first.
          </AlertDescription>
        </Alert>
      )}

      {!loadingEquipment && equipmentList.length > 0 && (
        <>
          {/* Picker */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Instrument</CardTitle>
              <CardDescription>Choose any active instrument; commands route to it via SCPI</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedId != null ? String(selectedId) : ''}
                onValueChange={(v) => setSelectedId(Number(v))}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Select equipment…" /></SelectTrigger>
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
              {/* Left column: readout + stats + trend */}
              <div className="lg:col-span-3 space-y-4">
                {/* Primary readout */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">Live Reading</CardTitle>
                        <CardDescription>Streaming READ? against the meter's current configuration</CardDescription>
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
                    <PrimaryReadout fn={fn} value={latestValue} range={range} nplc={nplc} streaming={streaming} />

                    {/* Bargraph */}
                    <div className="px-2">
                      <div className="text-[10px] font-mono text-muted-foreground flex justify-between mb-1">
                        <span>-100%</span><span>-50%</span><span>0</span><span>+50%</span><span>+100%</span>
                      </div>
                      <div className="relative h-2.5 bg-slate-100 border border-slate-200 rounded overflow-hidden">
                        <div
                          className="absolute top-0 bottom-0 bg-gradient-to-r from-blue-400 to-cyan-400 transition-all duration-200"
                          style={{
                            left: bargraphPct >= 0 ? '50%' : `${50 + bargraphPct * 50}%`,
                            width: `${Math.abs(bargraphPct) * 50}%`,
                          }}
                        />
                        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-400" />
                      </div>
                    </div>

                    {streamError && (
                      <Alert variant="destructive">
                        <AlertDescription>{streamError}</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>

                {/* Stats */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Statistics</CardTitle>
                      <Button size="sm" variant="ghost" className="h-7" onClick={clearStats}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
                      </Button>
                    </div>
                    <CardDescription>Last {Math.min(trendBuffer.length, TREND_BUFFER_MAX)} samples</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 font-mono">
                      <Stat label="Avg" value={formatStat(stats.avg, baseUnit)} />
                      <Stat label="Min" value={formatStat(stats.min, baseUnit)} />
                      <Stat label="Max" value={formatStat(stats.max, baseUnit)} />
                      <Stat label="Pk-Pk" value={formatStat(stats.pp, baseUnit)} />
                      <Stat label="σ" value={formatStat(stats.sd, baseUnit)} />
                      <Stat label="Samples" value={String(stats.n)} />
                    </div>
                  </CardContent>
                </Card>

                {/* Trend chart */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Trend</CardTitle>
                    <CardDescription>Last {TREND_DISPLAY} samples ({unitLabel(fn)})</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-40 -mx-2">
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
                            <Line type="monotone" dataKey="v" stroke="#2563eb" strokeWidth={1.4} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right column: controls */}
              <div className="lg:col-span-2 space-y-4">
                {/* Function */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Function</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2">
                      {FUNCTIONS.map((f) => (
                        <Button
                          key={f.scpi}
                          size="sm"
                          variant={f.scpi === fn ? 'default' : 'outline'}
                          onClick={() => selectFn(f.scpi)}
                          className="justify-start"
                        >
                          {f.label}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Range */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Range</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-2">
                      {ranges.map((r) => (
                        <Button
                          key={r}
                          size="sm"
                          variant={r === range ? 'default' : 'outline'}
                          onClick={() => selectRange(r)}
                          className="font-mono"
                        >
                          {prettyRange(r, fn)}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* NPLC */}
                {showNplc && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Integration time (NPLC)</CardTitle>
                      <CardDescription>Lower = faster, less accurate</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-2">
                        {NPLC_OPTIONS.map((v) => (
                          <Button
                            key={v}
                            size="sm"
                            variant={v === nplc ? 'default' : 'outline'}
                            onClick={() => selectNplc(v)}
                            className="font-mono"
                          >
                            {v}
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Acquisition */}
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
                        placeholder="e.g. *IDN?"
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

// ---------------------------------------------------------------------------
// Stat helper
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-slate-900 truncate" title={value}>{value}</span>
    </div>
  )
}

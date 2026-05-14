import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FrequencyEntry {
  frequency: number // MHz
  phase: number     // degrees
}

interface PhaseMeterPanelProps {
  /** Measured phase in degrees */
  value: number | null
  /** Display unit (default "deg") */
  unit?: string
  /** Current frequency in MHz */
  frequency?: number | null
  /** Nominal phase value for acceptance arc */
  limitNominal?: number | null
  /** Phase tolerance (+/-) for acceptance arc */
  limitTolerance?: number | null
  /** Calculated phase offset */
  phaseOffset?: number | null
  /** Instrument label */
  label?: string
  /** Multi-frequency measurement history */
  frequencyTable?: FrequencyEntry[]
  /** Selected cable ID for 110K243 (G01-G11) */
  selectedCable?: string | null
  /** Callback when cable selection changes */
  onCableChange?: (cable: string) => void
  /** React 19: ref as regular prop */
  ref?: React.Ref<HTMLDivElement>
}

// ---------------------------------------------------------------------------
// Cable constants for 110K243 RF Output Panel Assembly
// ---------------------------------------------------------------------------

const CABLES = [
  'G01', 'G02', 'G03', 'G04', 'G05', 'G06',
  'G07', 'G08', 'G09', 'G10', 'G11',
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize angle to [-180, 180) */
function normalizeAngle(deg: number): number {
  let a = deg % 360
  if (a >= 180) a -= 360
  if (a < -180) a += 360
  return a
}

/** Convert degrees to radians */
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Format a phase value with 2 decimal places */
function fmtPhase(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '----.--'
  return v.toFixed(2)
}

/** Check if a measured value is within nominal +/- tolerance (wrapping at 360) */
function isWithinTolerance(
  measured: number,
  nominal: number,
  tolerance: number,
): boolean {
  const diff = Math.abs(normalizeAngle(measured - nominal))
  return diff <= tolerance
}

// ---------------------------------------------------------------------------
// Canvas semicircular gauge drawing
// ---------------------------------------------------------------------------

/** Map a value to a canvas angle on the 270-degree gauge arc */
function valueToAngle(v: number, displayMin: number, displayRange: number): number {
  const GAUGE_START = 0.75 * Math.PI
  const SWEEP = 1.5 * Math.PI
  const frac = Math.max(0, Math.min(1, (v - displayMin) / displayRange))
  return GAUGE_START + frac * SWEEP
}

function drawPhaseGauge(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  value: number | null,
  limitNominal: number | null | undefined,
  limitTolerance: number | null | undefined,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  // --- Gauge geometry ---
  const cx = width / 2
  const cy = height * 0.7
  const outerR = Math.min(width * 0.42, height * 0.55)
  const innerR = outerR * 0.82
  const midR = (outerR + innerR) / 2
  const trackWidth = outerR - innerR

  const GAUGE_START = 0.75 * Math.PI
  const SWEEP = 1.5 * Math.PI
  const GAUGE_END = GAUGE_START + SWEEP // 0.25 * Math.PI

  // --- Display range: auto-center on nominal +/- 3x tolerance ---
  const nom = limitNominal ?? 0
  const tol = (limitTolerance != null && limitTolerance > 0) ? limitTolerance : 30
  const displayMin = nom - 3 * tol
  const displayMax = nom + 3 * tol
  const displayRange = displayMax - displayMin

  // 1. Dark background
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, width, height)

  // 2. Gauge track arc
  ctx.beginPath()
  ctx.arc(cx, cy, midR, GAUGE_START, GAUGE_END)
  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = trackWidth
  ctx.lineCap = 'butt'
  ctx.stroke()

  // 3. Green acceptance zone
  if (limitNominal != null && limitTolerance != null && limitTolerance > 0) {
    const greenStart = valueToAngle(limitNominal - limitTolerance, displayMin, displayRange)
    const greenEnd = valueToAngle(limitNominal + limitTolerance, displayMin, displayRange)
    ctx.beginPath()
    ctx.arc(cx, cy, midR, greenStart, greenEnd)
    ctx.strokeStyle = 'rgba(16,185,129,0.35)'
    ctx.lineWidth = trackWidth
    ctx.lineCap = 'butt'
    ctx.stroke()

    // 4. Red warning zones on each side (extend ~tolerance width beyond green)
    const redLowStart = valueToAngle(limitNominal - 2 * limitTolerance, displayMin, displayRange)
    const redLowEnd = greenStart
    ctx.beginPath()
    ctx.arc(cx, cy, midR, redLowStart, redLowEnd)
    ctx.strokeStyle = 'rgba(239,68,68,0.18)'
    ctx.lineWidth = trackWidth
    ctx.lineCap = 'butt'
    ctx.stroke()

    const redHighStart = greenEnd
    const redHighEnd = valueToAngle(limitNominal + 2 * limitTolerance, displayMin, displayRange)
    ctx.beginPath()
    ctx.arc(cx, cy, midR, redHighStart, redHighEnd)
    ctx.strokeStyle = 'rgba(239,68,68,0.18)'
    ctx.lineWidth = trackWidth
    ctx.lineCap = 'butt'
    ctx.stroke()
  }

  // 5. Tick marks: major every 10 degrees, minor every 5 degrees
  const tickOuterR = outerR + 2
  const majorTickInnerR = outerR - trackWidth * 0.5
  const minorTickInnerR = outerR - trackWidth * 0.25
  const labelR = outerR + 14

  // Determine tick stepping based on display range
  const majorStep = 10
  const minorStep = 5

  // Round display boundaries to nearest minor step
  const tickStart = Math.ceil(displayMin / minorStep) * minorStep
  const tickEnd = Math.floor(displayMax / minorStep) * minorStep

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let deg = tickStart; deg <= tickEnd; deg += minorStep) {
    const angle = valueToAngle(deg, displayMin, displayRange)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const isMajor = deg % majorStep === 0

    // Tick line
    const tInner = isMajor ? majorTickInnerR : minorTickInnerR
    ctx.beginPath()
    ctx.moveTo(cx + tInner * cos, cy + tInner * sin)
    ctx.lineTo(cx + tickOuterR * cos, cy + tickOuterR * sin)
    ctx.strokeStyle = isMajor ? '#94a3b8' : '#475569'
    ctx.lineWidth = isMajor ? 1.5 : 1
    ctx.stroke()

    // Major tick label
    if (isMajor) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText(`${deg}\u00B0`, cx + labelR * cos, cy + labelR * sin)
    }
  }

  // 6. Nominal line (dashed green from pivot to nominal position)
  if (limitNominal != null) {
    const nomAngle = valueToAngle(limitNominal, displayMin, displayRange)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + outerR * Math.cos(nomAngle), cy + outerR * Math.sin(nomAngle))
    ctx.strokeStyle = 'rgba(16,185,129,0.55)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 7 & 8 & 9. Needle + tip + value label
  if (value != null && !isNaN(value)) {
    const isPass =
      limitNominal != null &&
      limitTolerance != null &&
      isWithinTolerance(value, limitNominal, limitTolerance)
    const isFail =
      limitNominal != null &&
      limitTolerance != null &&
      !isPass
    const needleColor = isFail ? '#ef4444' : '#22d3ee'

    const needleAngle = valueToAngle(value, displayMin, displayRange)
    const nx = cx + outerR * 0.95 * Math.cos(needleAngle)
    const ny = cy + outerR * 0.95 * Math.sin(needleAngle)

    // Needle shadow
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(nx, ny)
    ctx.strokeStyle = needleColor
    ctx.lineWidth = 4
    ctx.globalAlpha = 0.3
    ctx.stroke()
    ctx.globalAlpha = 1.0

    // Needle line
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(nx, ny)
    ctx.strokeStyle = needleColor
    ctx.lineWidth = 2.5
    ctx.stroke()

    // Needle tip (filled circle)
    ctx.beginPath()
    ctx.arc(nx, ny, 4, 0, Math.PI * 2)
    ctx.fillStyle = needleColor
    ctx.fill()

    // Value label near needle tip
    const vlR = outerR * 0.95 + 18
    const vlx = cx + vlR * Math.cos(needleAngle)
    const vly = cy + vlR * Math.sin(needleAngle)
    ctx.fillStyle = needleColor
    ctx.font = 'bold 11px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${value.toFixed(1)}\u00B0`, vlx, vly)
  }

  // 10. Pivot dot (layered circles)
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.fillStyle = '#64748b'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, 3, 0, Math.PI * 2)
  ctx.fillStyle = '#cbd5e1'
  ctx.fill()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PhaseMeterPanel({
  value,
  unit = 'deg',
  frequency,
  limitNominal,
  limitTolerance,
  phaseOffset,
  label = 'Phase Meter',
  frequencyTable = [],
  selectedCable,
  onCableChange,
  ref,
}: PhaseMeterPanelProps) {
  // --- Canvas ref with cleanup (React 19 convention) ---
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef<number>(0)

  const [cableDropdownOpen, setCableDropdownOpen] = useState(false)

  // Determine pass/fail
  const passStatus = useMemo(() => {
    if (value == null || limitNominal == null || limitTolerance == null) return null
    return isWithinTolerance(value, limitNominal, limitTolerance) ? 'pass' : 'fail'
  }, [value, limitNominal, limitTolerance])

  // --- Draw phase gauge ---
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }

    drawPhaseGauge(ctx, w, h, dpr, value, limitNominal, limitTolerance)
  }, [value, limitNominal, limitTolerance])

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [draw])

  // Canvas ref callback that returns cleanup (React 19)
  const canvasRefCallback = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node
      if (node) {
        const dpr = window.devicePixelRatio || 1
        const rect = node.getBoundingClientRect()
        node.width = Math.round(rect.width * dpr)
        node.height = Math.round(rect.height * dpr)
        const ctx = node.getContext('2d')
        if (ctx) {
          drawPhaseGauge(ctx, rect.width, rect.height, dpr, value, limitNominal, limitTolerance)
        }
      }
      // React 19 cleanup function from ref callback
      return () => {
        canvasRef.current = null
      }
    },
    // intentionally empty — we re-draw via useEffect on value changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // --- Render ---
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col rounded-lg border-2 overflow-hidden',
        'bg-[#e5e7eb]', // light gray bezel
      )}
    >
      {/* ---- Header / bezel label ---- */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#d1d5db] border-b border-[#c2c7cc]">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          {label}
        </span>
        {frequency != null && (
          <span className="text-xs font-mono text-slate-500">
            {frequency.toFixed(1)} MHz
          </span>
        )}
      </div>

      {/* ---- Numeric readout ---- */}
      <div className="bg-[#0f172a] mx-2 mt-2 rounded px-3 py-2 flex items-baseline justify-between">
        <span
          className={cn(
            'font-mono text-3xl tracking-wide',
            passStatus === 'fail' ? 'text-red-500' : 'text-cyan-400',
          )}
        >
          {fmtPhase(value)}
        </span>
        <span className="text-sm font-mono text-slate-400 ml-2">
          {unit === 'deg' ? '\u00B0' : unit}
        </span>
      </div>

      {/* ---- Pass/Fail indicator ---- */}
      {passStatus && (
        <div className="mx-2 mt-1 flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block h-2.5 w-2.5 rounded-full',
              passStatus === 'pass' ? 'bg-emerald-500' : 'bg-red-500',
            )}
          />
          <span
            className={cn(
              'text-xs font-semibold uppercase',
              passStatus === 'pass' ? 'text-emerald-600' : 'text-red-600',
            )}
          >
            {passStatus === 'pass' ? 'PASS' : 'FAIL'}
          </span>
          {limitNominal != null && limitTolerance != null && (
            <span className="text-xs text-slate-500 ml-auto font-mono">
              {limitNominal.toFixed(1)}&deg; &plusmn; {limitTolerance.toFixed(1)}&deg;
            </span>
          )}
        </div>
      )}

      {/* ---- Phase gauge canvas ---- */}
      <div className="mx-2 mt-2 rounded overflow-hidden" style={{ aspectRatio: '4 / 3' }}>
        <canvas
          ref={canvasRefCallback}
          className="w-full h-full"
          style={{ display: 'block' }}
        />
      </div>

      {/* ---- Phase Offset calculator ---- */}
      {phaseOffset != null && (
        <div className="mx-2 mt-2 rounded bg-slate-100 px-3 py-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">Phase Offset</span>
          <span className="font-mono text-sm text-slate-800">
            {phaseOffset.toFixed(2)}&deg;
          </span>
        </div>
      )}

      {/* ---- Cable selection helper (110K243) ---- */}
      {onCableChange && (
        <div className="mx-2 mt-2 rounded bg-slate-100 px-3 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Ref Cable</span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setCableDropdownOpen(!cableDropdownOpen)}
                className={cn(
                  'flex items-center gap-1 rounded border border-slate-300 bg-white',
                  'px-2 py-0.5 text-xs font-mono text-slate-700',
                  'hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400',
                )}
              >
                {selectedCable ?? 'Select'}
                <svg
                  className={cn('h-3 w-3 text-slate-400 transition-transform', cableDropdownOpen && 'rotate-180')}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {cableDropdownOpen && (
                <div className="absolute right-0 z-10 mt-1 w-20 rounded border border-slate-200 bg-white shadow-md max-h-40 overflow-y-auto">
                  {CABLES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        onCableChange(c)
                        setCableDropdownOpen(false)
                      }}
                      className={cn(
                        'block w-full px-2 py-1 text-left text-xs font-mono hover:bg-cyan-50',
                        selectedCable === c && 'bg-cyan-100 font-bold',
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- Frequency table (multi-frequency measurements) ---- */}
      {frequencyTable.length > 0 && (
        <div className="mx-2 mt-2 mb-2 rounded overflow-hidden border border-slate-300">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-slate-200 hover:bg-slate-200">
                <TableHead className="h-7 px-2 text-xs font-semibold text-slate-600">
                  Freq (MHz)
                </TableHead>
                <TableHead className="h-7 px-2 text-xs font-semibold text-slate-600 text-right">
                  Phase (&deg;)
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {frequencyTable.map((entry) => {
                const isCurrent = frequency != null && entry.frequency === frequency
                return (
                  <TableRow
                    key={entry.frequency}
                    className={cn(
                      'hover:bg-slate-100',
                      isCurrent && 'bg-cyan-50 font-semibold',
                    )}
                  >
                    <TableCell className="px-2 py-1 font-mono">
                      {entry.frequency.toFixed(1)}
                    </TableCell>
                    <TableCell className="px-2 py-1 font-mono text-right">
                      {entry.phase.toFixed(2)}&deg;
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Bottom padding when no frequency table */}
      {frequencyTable.length === 0 && <div className="h-2" />}
    </div>
  )
}

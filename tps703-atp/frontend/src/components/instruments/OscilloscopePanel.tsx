import { useCallback, useEffect, useRef, useState, useDeferredValue } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OscilloscopePanelProps {
  value: number | null
  unit?: string
  stepType?: string
  limitNominal?: number | null
  limitTolerance?: number | null
  limitMin?: number | null
  limitMax?: number | null
  label?: string
  ref?: React.Ref<HTMLDivElement>
}

interface CursorState {
  x1: number // 0-1 normalised position
  x2: number
  dragging: 'none' | 'cursor1' | 'cursor2'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRID_COLS = 10
const GRID_ROWS = 8
const PHOSPHOR_GREEN = '#22c55e'
const DARK_GREEN_GRID = '#1a3a1a'
const BACKGROUND = '#0a1a0a'
const CURSOR_COLOR = '#ffffff'
const BEZEL_COLOR = '#e5e7eb'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a value from [inMin, inMax] to [outMin, outMax] */
function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  return outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin)
}

/** Generate a continuous sine wave — the primary oscilloscope waveform.
 *  Shows ~3 full cycles scrolling across the screen with per-frame phase
 *  advance, slight frequency drift, harmonic distortion and realistic noise. */
function generateSineWaveform(
  _pulseWidth: number, // kept for API compat (ignored)
  _timePerDiv: number,
  _totalDivs: number,
  animSeed: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  const numPoints = 600
  const cycles = 3 + Math.sin(animSeed * 0.13) * 0.15 // ~3 cycles with slight drift

  // Phase advances each frame → wave scrolls across the screen
  const phase = animSeed * 0.35

  for (let i = 0; i < numPoints; i++) {
    const x = i / (numPoints - 1)
    const theta = x * cycles * 2 * Math.PI + phase

    // Fundamental + small 3rd-harmonic distortion
    let amplitude = Math.sin(theta) * 0.42
    amplitude += Math.sin(theta * 3) * 0.012 // subtle harmonic

    // Centre at 0.5 so the wave swings symmetrically on screen
    amplitude += 0.5

    // Deterministic per-frame noise
    const noise = (Math.sin(i * 47.3 + animSeed * 13.7) * 0.4 +
                   Math.sin(i * 91.7 + animSeed * 5.3) * 0.6) * 0.008
    amplitude += noise

    points.push({ x, y: amplitude })
  }

  return points
}

/** Generate BITE signal waveform — pulsed envelope matching the radar pulse timing.
 *  During the pulse, the BITE voltage is at its measured level. Between pulses
 *  it drops to a low baseline. This gives a realistic time-domain view of the
 *  BITE monitor output on an oscilloscope. */
function generateBiteWaveform(
  voltage: number,
  voltsPerDiv: number,
  totalDivs: number,
  animSeed: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  const numPoints = 800
  const totalV = voltsPerDiv * totalDivs
  const peakNorm = voltage / totalV          // normalised peak amplitude
  const baselineNorm = peakNorm * 0.05       // baseline between pulses (~5% of peak)

  // Simulated pulse timing: 2 complete pulses visible on screen
  // Typical TPS-703 timing: ~255 µs pulse width, ~1 ms PRI
  const pulseDuty = 0.25   // fraction of PRI that is "pulse on"
  const numPulses = 2
  const pulseSpacing = 1 / numPulses
  const riseNorm = 0.008   // rise/fall time as fraction of screen

  for (let i = 0; i < numPoints; i++) {
    const x = i / (numPoints - 1)
    let amplitude = baselineNorm

    for (let p = 0; p < numPulses; p++) {
      const pulseCenter = pulseSpacing * (p + 0.5)
      const pulseHalfW = (pulseSpacing * pulseDuty) / 2
      const pulseStart = pulseCenter - pulseHalfW
      const pulseEnd = pulseCenter + pulseHalfW

      if (x >= pulseStart - riseNorm && x < pulseStart) {
        // Rising edge (smoothstep)
        const f = (x - (pulseStart - riseNorm)) / riseNorm
        const s = f * f * (3 - 2 * f)
        amplitude = baselineNorm + (peakNorm - baselineNorm) * s
      } else if (x >= pulseStart && x <= pulseEnd) {
        // Pulse top with slight droop and ripple
        const frac = (x - pulseStart) / (pulseEnd - pulseStart)
        const droop = peakNorm * 0.015 * frac
        const ripple = Math.sin(frac * Math.PI * 12 + animSeed) * peakNorm * 0.008
        amplitude = peakNorm - droop + ripple
      } else if (x > pulseEnd && x < pulseEnd + riseNorm) {
        // Falling edge
        const f = (x - pulseEnd) / riseNorm
        const s = f * f * (3 - 2 * f)
        amplitude = peakNorm * (1 - 0.015) * (1 - s) + baselineNorm * s
      }
    }

    // Add realistic oscilloscope noise
    const noise = (Math.sin(i * 73.13 + animSeed * 17.3) * 0.3 + Math.sin(i * 31.7 + animSeed * 7.1) * 0.7) * peakNorm * 0.012
    amplitude += noise

    points.push({ x, y: Math.max(0, amplitude) })
  }

  return points
}

/** Generate a generic time-domain signal: resistance or current measurement shown
 *  as a fluctuating analog readout with realistic scope noise. */
function generateAnalogWaveform(
  voltage: number,
  voltsPerDiv: number,
  totalDivs: number,
  animSeed: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  const numPoints = 800
  const totalV = voltsPerDiv * totalDivs
  const normV = voltage / totalV

  for (let i = 0; i < numPoints; i++) {
    const x = i / (numPoints - 1)
    // Low-frequency drift
    const drift = Math.sin(x * Math.PI * 3 + animSeed * 0.7) * normV * 0.01
    // Mains hum (50/60 Hz ripple visible at ms timescales)
    const hum = Math.sin(x * Math.PI * 8 + animSeed * 1.3) * normV * 0.006
    // High-frequency noise
    const hfNoise = (Math.sin(i * 47.7 + animSeed * 11.3) * 0.4 +
                     Math.sin(i * 91.1 + animSeed * 3.7) * 0.6) * normV * 0.015
    points.push({ x, y: normV + drift + hum + hfNoise })
  }

  return points
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = DARK_GREEN_GRID
  ctx.lineWidth = 1

  // Main grid
  for (let col = 0; col <= GRID_COLS; col++) {
    const x = Math.round((col / GRID_COLS) * w) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  for (let row = 0; row <= GRID_ROWS; row++) {
    const y = Math.round((row / GRID_ROWS) * h) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  // Centre cross-hair tick marks (small dots along centre lines)
  ctx.strokeStyle = '#2a5a2a'
  ctx.lineWidth = 1
  const cx = w / 2
  const cy = h / 2

  // Horizontal centre ticks
  const tickLen = 4
  for (let col = 0; col <= GRID_COLS; col++) {
    for (let sub = 1; sub < 5; sub++) {
      const x = Math.round(((col + sub / 5) / GRID_COLS) * w) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, cy - tickLen)
      ctx.lineTo(x, cy + tickLen)
      ctx.stroke()
    }
  }
  // Vertical centre ticks
  for (let row = 0; row <= GRID_ROWS; row++) {
    for (let sub = 1; sub < 5; sub++) {
      const y = Math.round(((row + sub / 5) / GRID_ROWS) * h) + 0.5
      ctx.beginPath()
      ctx.moveTo(cx - tickLen, y)
      ctx.lineTo(cx + tickLen, y)
      ctx.stroke()
    }
  }
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  points: { x: number; y: number }[],
  isPulse: boolean,
) {
  if (points.length === 0) return

  // Glow effect
  ctx.save()
  ctx.shadowColor = PHOSPHOR_GREEN
  ctx.shadowBlur = 8
  ctx.strokeStyle = PHOSPHOR_GREEN
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Map y: 0→bottom, 1→top of the canvas trace area
  const yBottom = isPulse ? h * 0.90 : h * 0.85
  const yTop    = isPulse ? h * 0.10 : h * 0.15

  ctx.beginPath()
  for (let i = 0; i < points.length; i++) {
    const px = points[i].x * w
    const py = mapRange(points[i].y, 0, 1, yBottom, yTop)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()

  // Second pass without glow for sharper core
  ctx.shadowBlur = 0
  ctx.strokeStyle = '#4ade80'
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  for (let i = 0; i < points.length; i++) {
    const px = points[i].x * w
    const py = mapRange(points[i].y, 0, 1, yBottom, yTop)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
  ctx.restore()
}

function drawCursors(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cursor1X: number,
  cursor2X: number,
  deltaLabel: string,
) {
  ctx.save()

  // Cursor lines
  const drawCursorLine = (normX: number, label: string) => {
    const x = normX * w
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = CURSOR_COLOR
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.8
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    ctx.setLineDash([])

    // Cursor handle triangle at top
    ctx.fillStyle = CURSOR_COLOR
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.moveTo(x - 5, 0)
    ctx.lineTo(x + 5, 0)
    ctx.lineTo(x, 10)
    ctx.closePath()
    ctx.fill()

    // Label
    ctx.font = '10px monospace'
    ctx.fillStyle = CURSOR_COLOR
    ctx.globalAlpha = 1
    ctx.fillText(label, x - 4, h - 4)
  }

  drawCursorLine(cursor1X, 'C1')
  drawCursorLine(cursor2X, 'C2')

  // Delta-T readout at top centre
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000000'
  ctx.fillRect(w / 2 - 70, 2, 140, 18)
  ctx.strokeStyle = CURSOR_COLOR
  ctx.lineWidth = 1
  ctx.strokeRect(w / 2 - 70, 2, 140, 18)
  ctx.font = 'bold 12px monospace'
  ctx.fillStyle = '#fbbf24' // amber readout
  ctx.textAlign = 'center'
  ctx.fillText(deltaLabel, w / 2, 16)
  ctx.textAlign = 'start'

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OscilloscopePanel({
  value,
  unit = 'usec',
  stepType = 'pulse_width',
  limitNominal,
  limitTolerance,
  limitMin,
  limitMax,
  label,
  ref,
}: OscilloscopePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animFrameRef = useRef<number>(0)
  const [cursors, setCursors] = useState<CursorState>({ x1: 0.3, x2: 0.7, dragging: 'none' })
  const deferredValue = useDeferredValue(value)

  // User-override state for display scaling (null = auto)
  const [userTimePerDiv, setUserTimePerDiv] = useState<number | null>(null)
  const [userVoltsPerDiv, setUserVoltsPerDiv] = useState<number | null>(null)

  // Reset user overrides when step type changes
  useEffect(() => { setUserTimePerDiv(null); setUserVoltsPerDiv(null) }, [stepType])

  const isPulse = stepType === 'pulse_width'
  const displayValue = typeof deferredValue === 'number' ? deferredValue : 0

  // Compute scale settings (auto)
  const safeDisplay = displayValue || 1
  const autoTimePerDiv = isPulse
    ? Math.max(1, Math.ceil((safeDisplay * 1.5) / GRID_COLS))
    : 1 // 1 ms/div for BITE
  const autoVoltsPerDiv = isPulse ? 1 : Math.max(0.5, Math.ceil((safeDisplay * 1.5) / (GRID_ROWS / 2) * 2) / 2)

  // Effective values: user override or auto
  const timePerDiv = userTimePerDiv ?? autoTimePerDiv
  const voltsPerDiv = userVoltsPerDiv ?? autoVoltsPerDiv

  // Compute limits for display (all guaranteed number | null, never undefined)
  const nominalDisplay: number | null = typeof limitNominal === 'number' ? limitNominal : (typeof displayValue === 'number' ? displayValue : null)
  const minLimit: number | null = typeof limitMin === 'number' ? limitMin : (typeof limitNominal === 'number' && typeof limitTolerance === 'number' ? limitNominal - limitTolerance : null)
  const maxLimit: number | null = typeof limitMax === 'number' ? limitMax : (typeof limitNominal === 'number' && typeof limitTolerance === 'number' ? limitNominal + limitTolerance : null)

  // Determine pass/fail
  let status: 'pass' | 'fail' | 'idle' = 'idle'
  if (typeof value === 'number' && typeof minLimit === 'number' && typeof maxLimit === 'number') {
    status = value >= minLimit && value <= maxLimit ? 'pass' : 'fail'
  }

  // Format the measurement display
  const formatMeasurement = (v: number | null): string => {
    if (typeof v !== 'number') return '---'
    if (unit === 'usec' || unit === 'us') return `${v.toFixed(2)} \u00b5s`
    if (unit === 'V') return `${v.toFixed(3)} V`
    return `${v.toFixed(3)} ${unit}`
  }

  // Cursor delta calculation
  const totalTime = timePerDiv * GRID_COLS
  const cursorDeltaTime = Math.abs(cursors.x2 - cursors.x1) * totalTime
  const cursorDeltaLabel = isPulse
    ? `\u0394T = ${cursorDeltaTime.toFixed(2)} \u00b5s`
    : `\u0394T = ${(cursorDeltaTime * 1000).toFixed(1)} ms`

  // -----------------------------------------------------------------------
  // Canvas rendering via ref callback with cleanup (React 19 pattern)
  // -----------------------------------------------------------------------

  const canvasRefCallback = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      // Store ref for cursor interaction
      canvasRef.current = canvas
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      let running = true
      let frameCount = 0

      const render = () => {
        if (!running) return
        frameCount++

        const dpr = window.devicePixelRatio || 1
        const rect = canvas.getBoundingClientRect()
        const w = rect.width
        const h = rect.height

        // Resize backing store if needed
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr
          canvas.height = h * dpr
        }

        ctx.save()
        ctx.scale(dpr, dpr)

        // Clear
        ctx.fillStyle = BACKGROUND
        ctx.fillRect(0, 0, w, h)

        // Grid
        drawGrid(ctx, w, h)

        // Generate waveform based on step type
        const isBite = stepType === 'bite_signal'
        let waveform: { x: number; y: number }[]
        if (isPulse) {
          waveform = generateSineWaveform(displayValue, timePerDiv, GRID_COLS, frameCount)
        } else if (isBite) {
          waveform = generateBiteWaveform(displayValue, voltsPerDiv, GRID_ROWS, frameCount)
        } else {
          waveform = generateAnalogWaveform(displayValue, voltsPerDiv, GRID_ROWS, frameCount)
        }

        // Draw trace
        drawTrace(ctx, w, h, waveform, isPulse)

        // Draw cursors (only for pulse_width mode)
        if (isPulse) {
          drawCursors(ctx, w, h, cursors.x1, cursors.x2, cursorDeltaLabel)
        }

        // Trigger level marker on right edge
        const trigY = isPulse ? h * 0.50 : mapRange(displayValue / (voltsPerDiv * GRID_ROWS), 0, 1, h * 0.85, h * 0.15)
        ctx.save()
        ctx.fillStyle = '#ef4444'
        ctx.beginPath()
        ctx.moveTo(w, trigY - 5)
        ctx.lineTo(w - 8, trigY)
        ctx.lineTo(w, trigY + 5)
        ctx.closePath()
        ctx.fill()
        ctx.restore()

        // Ground reference marker on left edge (centre for sine, bottom for others)
        const groundY = isPulse ? h * 0.50 : h * 0.85
        ctx.save()
        ctx.strokeStyle = PHOSPHOR_GREEN
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, groundY)
        ctx.lineTo(8, groundY - 4)
        ctx.lineTo(8, groundY + 4)
        ctx.closePath()
        ctx.stroke()
        ctx.restore()

        ctx.restore()

        // Animate at ~8 fps for live oscilloscope feel
        animFrameRef.current = requestAnimationFrame(() => {
          setTimeout(() => {
            if (running) render()
          }, 120)
        })
      }

      render()

      // React 19: return cleanup from ref callback
      return () => {
        running = false
        cancelAnimationFrame(animFrameRef.current)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayValue, isPulse, stepType, timePerDiv, voltsPerDiv, cursors.x1, cursors.x2, cursorDeltaLabel],
  )

  // -----------------------------------------------------------------------
  // Cursor drag interaction
  // -----------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !isPulse) return

    const getRelativeX = (e: MouseEvent): number => {
      const rect = canvas.getBoundingClientRect()
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    }

    const SNAP_DIST = 0.03

    const onMouseDown = (e: MouseEvent) => {
      const relX = getRelativeX(e)
      const d1 = Math.abs(relX - cursors.x1)
      const d2 = Math.abs(relX - cursors.x2)

      if (d1 < SNAP_DIST && d1 <= d2) {
        setCursors((c) => ({ ...c, dragging: 'cursor1' }))
      } else if (d2 < SNAP_DIST) {
        setCursors((c) => ({ ...c, dragging: 'cursor2' }))
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      setCursors((prev) => {
        if (prev.dragging === 'none') return prev
        const relX = getRelativeX(e)
        if (prev.dragging === 'cursor1') return { ...prev, x1: relX }
        if (prev.dragging === 'cursor2') return { ...prev, x2: relX }
        return prev
      })
    }

    const onMouseUp = () => {
      setCursors((prev) => (prev.dragging !== 'none' ? { ...prev, dragging: 'none' } : prev))
    }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isPulse, cursors.x1, cursors.x2])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const unitLabel = unit === 'usec' || unit === 'us' ? '\u00b5s' : unit ?? ''

  return (
    <div ref={ref} className="flex flex-col gap-0">
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 rounded-t-lg"
        style={{ backgroundColor: '#374151' }}
      >
        <span className="text-xs font-semibold tracking-wider text-gray-200 uppercase">
          Oscilloscope
        </span>
        {label && (
          <span className="text-xs text-gray-400 truncate max-w-[200px]">{label}</span>
        )}
      </div>

      {/* Control strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-[10px] font-mono" style={{ backgroundColor: '#0d1230' }}>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">TIME/DIV</span>
          {isPulse
            ? [1, 5, 10, 25, 50, 100].map(v => (
                <button key={v} onClick={() => setUserTimePerDiv(v)}
                  className={cn("px-1.5 py-0.5 rounded transition-colors",
                    userTimePerDiv === v ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  )}
                >{v}{'\u00b5s'}</button>
              ))
            : [0.5, 1, 2, 5].map(v => (
                <button key={v} onClick={() => setUserTimePerDiv(v)}
                  className={cn("px-1.5 py-0.5 rounded transition-colors",
                    userTimePerDiv === v ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  )}
                >{v}ms</button>
              ))
          }
          <button onClick={() => setUserTimePerDiv(null)}
            className={cn("px-1.5 py-0.5 rounded transition-colors",
              userTimePerDiv === null ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            )}
          >Auto</button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">V/DIV</span>
          {[0.5, 1, 2, 5, 10].map(v => (
            <button key={v} onClick={() => setUserVoltsPerDiv(v)}
              className={cn("px-1.5 py-0.5 rounded transition-colors",
                userVoltsPerDiv === v ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              )}
            >{v}V</button>
          ))}
          <button onClick={() => setUserVoltsPerDiv(null)}
            className={cn("px-1.5 py-0.5 rounded transition-colors",
              userVoltsPerDiv === null ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            )}
          >Auto</button>
        </div>
        {isPulse && (
          <div className="flex items-center gap-1">
            <span className="text-gray-500">CURSORS</span>
            <button onClick={() => setCursors({ x1: 0.3, x2: 0.7, dragging: 'none' })}
              className="px-1.5 py-0.5 rounded transition-colors bg-gray-600 text-gray-200 hover:bg-gray-500"
            >Reset</button>
          </div>
        )}
      </div>

      {/* Bezel */}
      <div
        className="p-3 rounded-b-lg"
        style={{ backgroundColor: BEZEL_COLOR }}
        ref={containerRef}
      >
        {/* Readout strip above canvas */}
        <div className="flex items-center justify-between px-2 py-1 mb-1 text-xs font-mono rounded"
          style={{ backgroundColor: '#1f2937', color: '#d1d5db' }}
        >
          <span>
            {isPulse ? `${timePerDiv} ${unitLabel}/div` : `${(timePerDiv).toFixed(1)} ms/div`}
          </span>
          <span>
            {isPulse ? '5.0 V/div' : `${voltsPerDiv.toFixed(1)} V/div`}
          </span>
          <span className="text-amber-400">
            Trig: {isPulse ? '2.5 V' : `${((displayValue || 0) * 0.5).toFixed(2)} V`}
          </span>
        </div>

        {/* Canvas display */}
        <div className="relative border-2 border-gray-700 rounded overflow-hidden"
          style={{ aspectRatio: '10 / 8' }}
        >
          <canvas
            ref={canvasRefCallback}
            className="w-full h-full block"
            style={{ cursor: isPulse ? 'crosshair' : 'default' }}
          />

          {/* No-signal indicator */}
          {value === null && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-green-500/40 font-mono text-sm tracking-widest">
                NO SIGNAL
              </span>
            </div>
          )}
        </div>

        {/* Measurement readout strip below canvas */}
        <div className="flex items-center justify-between px-2 py-1.5 mt-1 rounded text-xs font-mono"
          style={{ backgroundColor: '#111827' }}
        >
          {/* Measurement value */}
          <div className="flex items-center gap-2">
            <span className="text-gray-500">MEAS:</span>
            <span
              className={cn(
                'font-bold text-sm',
                status === 'pass' && 'text-emerald-400',
                status === 'fail' && 'text-red-400',
                status === 'idle' && 'text-amber-300',
              )}
            >
              {formatMeasurement(value)}
            </span>
          </div>

          {/* Limits */}
          <div className="flex items-center gap-3 text-gray-400">
            {typeof minLimit === 'number' && (
              <span>
                MIN: <span className="text-gray-300">
                  {minLimit.toFixed(2)} {unitLabel}
                </span>
              </span>
            )}
            {typeof nominalDisplay === 'number' && typeof limitNominal === 'number' && (
              <span>
                NOM: <span className="text-gray-300">
                  {nominalDisplay.toFixed(2)} {unitLabel}
                </span>
              </span>
            )}
            {typeof maxLimit === 'number' && (
              <span>
                MAX: <span className="text-gray-300">
                  {maxLimit.toFixed(2)} {unitLabel}
                </span>
              </span>
            )}
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-block w-2 h-2 rounded-full',
                status === 'pass' && 'bg-emerald-500',
                status === 'fail' && 'bg-red-500',
                status === 'idle' && 'bg-gray-500',
              )}
            />
            <span
              className={cn(
                'uppercase text-[10px] font-bold',
                status === 'pass' && 'text-emerald-400',
                status === 'fail' && 'text-red-400',
                status === 'idle' && 'text-gray-500',
              )}
            >
              {status === 'idle' ? 'READY' : status.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Cursor readout (pulse mode only) */}
        {isPulse && (
          <div className="flex items-center justify-center gap-4 px-2 py-1 mt-1 text-[10px] font-mono rounded"
            style={{ backgroundColor: '#1f2937', color: '#9ca3af' }}
          >
            <span>C1: {(cursors.x1 * totalTime).toFixed(2)} {unitLabel}</span>
            <span className="text-amber-300 font-bold">
              {cursorDeltaLabel}
            </span>
            <span>C2: {(cursors.x2 * totalTime).toFixed(2)} {unitLabel}</span>
            <span className="text-gray-600 text-[9px]">Drag cursors to measure</span>
          </div>
        )}

        {/* Model plate */}
        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-[9px] text-gray-500 font-mono tracking-wider">
            TPS-703 VIRTUAL OSCILLOSCOPE
          </span>
          <span className="text-[9px] text-gray-400 font-mono">
            {isPulse ? 'PULSE' : stepType === 'bite_signal' ? 'BITE PULSED' : 'ANALOG'} MODE
          </span>
        </div>
      </div>
    </div>
  )
}

export default OscilloscopePanel

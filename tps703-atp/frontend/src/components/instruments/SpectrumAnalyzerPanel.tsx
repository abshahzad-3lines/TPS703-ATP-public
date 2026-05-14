import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpectrumAnalyzerPanelProps {
  /** Peak power reading in dBm (null = no signal) */
  value: number | null
  /** Center frequency in MHz */
  frequency?: number | null
  /** Top-of-screen reference level in dBm (default -10) */
  refLevel?: number
  /** Frequency span in MHz (default 100) */
  span?: number
  /** Resolution bandwidth label */
  rbw?: string
  /** Video bandwidth label */
  vbw?: string
  /** Instrument label */
  label?: string
  /** React 19 ref — accepted as a regular prop */
  ref?: React.Ref<HTMLDivElement>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BG_COLOR = '#0a0e27'
const GRID_COLOR = 'rgba(40, 60, 120, 0.45)'
const GRID_TEXT_COLOR = 'rgba(160, 180, 220, 0.7)'
const TRACE_COLOR = '#fbbf24'
const TRACE_GLOW_COLOR = 'rgba(251, 191, 36, 0.55)'
const MAX_HOLD_COLOR = '#f97316'
const MARKER_COLOR = '#22d3ee'
const REF_LINE_COLOR = 'rgba(239, 68, 68, 0.5)'
const Y_DIVISIONS = 10 // 10 dB per division by default
const X_DIVISIONS = 10
const DB_PER_DIV = 10
const TRACE_POINTS = 512

// Padding around the plotting area (pixels)
const PAD_LEFT = 52
const PAD_RIGHT = 16
const PAD_TOP = 8
const PAD_BOTTOM = 28

// ---------------------------------------------------------------------------
// Seeded PRNG (simple xorshift32 — deterministic noise texture)
// ---------------------------------------------------------------------------

function xorshift32(seed: number): () => number {
  let state = seed | 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >> 17
    state ^= state << 5
    return (state >>> 0) / 0xffffffff
  }
}

// ---------------------------------------------------------------------------
// Spectrum trace generation
// ---------------------------------------------------------------------------

/** Generate a realistic spectrum trace array (dBm values). */
function generateTrace(
  peakDbm: number | null,
  _centerFreqMHz: number,
  _spanMHz: number,
  refLevel: number,
  noiseSeed: number,
): number[] {
  const rand = xorshift32(noiseSeed)
  const noiseFloor = refLevel - Y_DIVISIONS * DB_PER_DIV // bottom of display
  const trace = new Array<number>(TRACE_POINTS)

  for (let i = 0; i < TRACE_POINTS; i++) {
    // Frequency offset from center, normalised to half-span
    const normOffset = (i / (TRACE_POINTS - 1) - 0.5) * 2 // -1 … +1

    // Noise floor with texture
    const noise = noiseFloor + 4 + (rand() - 0.5) * 6

    if (peakDbm == null) {
      trace[i] = noise
      continue
    }

    // Main carrier: Gaussian-shaped main lobe
    // Interpolate from noise floor up to peak — avoids negative-dBm multiplication bug
    const sigmaMain = 0.04 // narrow main lobe
    const mainLobe =
      noiseFloor + (peakDbm - noiseFloor) * Math.exp(-0.5 * (normOffset / sigmaMain) ** 2)

    // Wider spectral skirts (e.g., phase noise shoulders)
    const sigmaSkirt = 0.18
    const skirtLevel = peakDbm - 25
    const skirt =
      noiseFloor + (skirtLevel - noiseFloor) * Math.exp(-0.5 * (normOffset / sigmaSkirt) ** 2)

    // Third-harmonic spur (small bump offset from center)
    const spurOffset = 0.35
    const spurLevel = peakDbm - 45
    const spurSigma = 0.025
    const spur =
      noiseFloor + (spurLevel - noiseFloor) *
      Math.exp(-0.5 * ((Math.abs(normOffset) - spurOffset) / spurSigma) ** 2)

    // Combine: take the highest of the components, plus noise texture
    const signal = Math.max(mainLobe, skirt, spur)
    const combined = signal + (rand() - 0.5) * 2.5

    // Never go below noise floor
    trace[i] = Math.max(combined, noise)
  }

  return trace
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  trace: number[],
  maxHold: number[],
  refLevel: number,
  spanMHz: number,
  centerFreqMHz: number,
  peakDbm: number | null,
) {
  const plotW = width - PAD_LEFT - PAD_RIGHT
  const plotH = height - PAD_TOP - PAD_BOTTOM
  const dbRange = Y_DIVISIONS * DB_PER_DIV // total dB visible

  // Helpers: value -> pixel
  const xOfIndex = (i: number) => PAD_LEFT + (i / (TRACE_POINTS - 1)) * plotW
  const yOfDbm = (dbm: number) =>
    PAD_TOP + ((refLevel - dbm) / dbRange) * plotH

  // ---- Background ----
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, width, height)

  // ---- Grid lines ----
  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1

  // Horizontal (dB) divisions
  ctx.font = '10px "JetBrains Mono", "Cascadia Code", "Consolas", monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let d = 0; d <= Y_DIVISIONS; d++) {
    const dbm = refLevel - d * DB_PER_DIV
    const y = Math.round(yOfDbm(dbm)) + 0.5
    ctx.beginPath()
    ctx.moveTo(PAD_LEFT, y)
    ctx.lineTo(PAD_LEFT + plotW, y)
    ctx.stroke()
    // Label
    ctx.fillStyle = GRID_TEXT_COLOR
    ctx.fillText(`${dbm}`, PAD_LEFT - 4, y)
  }

  // Vertical (freq) divisions
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const freqStart = centerFreqMHz - spanMHz / 2
  for (let d = 0; d <= X_DIVISIONS; d++) {
    const x = Math.round(PAD_LEFT + (d / X_DIVISIONS) * plotW) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, PAD_TOP)
    ctx.lineTo(x, PAD_TOP + plotH)
    ctx.stroke()
    // Frequency label (bottom)
    const freq = freqStart + (d / X_DIVISIONS) * spanMHz
    ctx.fillStyle = GRID_TEXT_COLOR
    ctx.fillText(freq.toFixed(1), x, PAD_TOP + plotH + 4)
  }

  // ---- Reference level line ----
  ctx.strokeStyle = REF_LINE_COLOR
  ctx.lineWidth = 1
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  const refY = yOfDbm(refLevel)
  ctx.moveTo(PAD_LEFT, refY)
  ctx.lineTo(PAD_LEFT + plotW, refY)
  ctx.stroke()
  ctx.setLineDash([])

  // ---- Clip to plot area for traces ----
  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD_LEFT, PAD_TOP, plotW, plotH)
  ctx.clip()

  // ---- Max Hold trace (orange, no glow) ----
  ctx.strokeStyle = MAX_HOLD_COLOR
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.7
  ctx.beginPath()
  for (let i = 0; i < TRACE_POINTS; i++) {
    const x = xOfIndex(i)
    const y = yOfDbm(maxHold[i])
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.globalAlpha = 1.0

  // ---- Main trace (yellow with glow) ----
  // Glow pass
  ctx.shadowColor = TRACE_GLOW_COLOR
  ctx.shadowBlur = 8
  ctx.strokeStyle = TRACE_COLOR
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i < TRACE_POINTS; i++) {
    const x = xOfIndex(i)
    const y = yOfDbm(trace[i])
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Sharp pass (on top of glow)
  ctx.shadowBlur = 0
  ctx.strokeStyle = TRACE_COLOR
  ctx.lineWidth = 1.2
  ctx.beginPath()
  for (let i = 0; i < TRACE_POINTS; i++) {
    const x = xOfIndex(i)
    const y = yOfDbm(trace[i])
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  ctx.restore() // un-clip

  // ---- Center-frequency marker ----
  if (peakDbm != null) {
    const mkrIdx = Math.floor(TRACE_POINTS / 2)
    const mkrX = xOfIndex(mkrIdx)
    const mkrY = yOfDbm(trace[mkrIdx])

    // Vertical dashed line
    ctx.strokeStyle = MARKER_COLOR
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(mkrX, PAD_TOP)
    ctx.lineTo(mkrX, PAD_TOP + plotH)
    ctx.stroke()
    ctx.setLineDash([])

    // Marker diamond
    ctx.fillStyle = MARKER_COLOR
    ctx.beginPath()
    ctx.moveTo(mkrX, mkrY - 5)
    ctx.lineTo(mkrX + 4, mkrY)
    ctx.lineTo(mkrX, mkrY + 5)
    ctx.lineTo(mkrX - 4, mkrY)
    ctx.closePath()
    ctx.fill()

    // Marker readout box
    const readoutText = `MKR1  ${centerFreqMHz.toFixed(1)} MHz  ${trace[mkrIdx].toFixed(1)} dBm`
    ctx.font =
      '11px "JetBrains Mono", "Cascadia Code", "Consolas", monospace'
    const tm = ctx.measureText(readoutText)
    const boxW = tm.width + 12
    const boxH = 18
    const boxX = Math.min(mkrX + 8, PAD_LEFT + plotW - boxW - 4)
    const boxY = Math.max(PAD_TOP + 4, mkrY - boxH - 4)

    ctx.fillStyle = 'rgba(10, 14, 39, 0.85)'
    ctx.strokeStyle = MARKER_COLOR
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(boxX, boxY, boxW, boxH, 3)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = MARKER_COLOR
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(readoutText, boxX + 6, boxY + boxH / 2)
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SpectrumAnalyzerPanel({
  value,
  frequency = null,
  refLevel = -10,
  span = 100,
  rbw = '1 MHz',
  vbw = '300 kHz',
  label = 'Spectrum Analyzer',
  ref,
}: SpectrumAnalyzerPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const maxHoldRef = useRef<number[] | null>(null)
  const animFrameRef = useRef<number>(0)
  const noiseSeedRef = useRef<number>(1)

  const centerFreq = frequency ?? 2950 // default S-band center

  // Generate trace and update max hold
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // DPR scaling
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Animate noise seed so the trace "shimmers"
    noiseSeedRef.current += 1

    const trace = generateTrace(value, centerFreq, span, refLevel, noiseSeedRef.current)

    // Max hold envelope
    if (!maxHoldRef.current || maxHoldRef.current.length !== TRACE_POINTS) {
      maxHoldRef.current = [...trace]
    } else {
      for (let i = 0; i < TRACE_POINTS; i++) {
        if (trace[i] > maxHoldRef.current[i]) {
          maxHoldRef.current[i] = trace[i]
        }
      }
    }

    drawSpectrum(ctx, w, h, trace, maxHoldRef.current, refLevel, span, centerFreq, value)

    animFrameRef.current = requestAnimationFrame(render)
  }, [value, centerFreq, refLevel, span])

  // Reset max hold only when frequency changes (not on value fluctuations)
  useEffect(() => {
    maxHoldRef.current = null
  }, [centerFreq])

  // Canvas ref callback with React 19 cleanup
  const canvasRefCallback = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (!node) {
        // Cleanup on unmount
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current)
          animFrameRef.current = 0
        }
        canvasRef.current = null
        return
      }
      canvasRef.current = node

      // Kick off render loop
      animFrameRef.current = requestAnimationFrame(render)

      // React 19 ref cleanup function
      return () => {
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current)
          animFrameRef.current = 0
        }
        canvasRef.current = null
      }
    },
    [render],
  )

  // Restart animation when render callback changes (due to prop changes)
  useEffect(() => {
    if (canvasRef.current) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
      animFrameRef.current = requestAnimationFrame(render)
    }
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = 0
      }
    }
  }, [render])

  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border-2 border-gray-300 bg-gray-200 p-3 shadow-md',
        'flex flex-col gap-1',
      )}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold tracking-wide text-gray-600 uppercase">
          {label}
        </span>
        <span className="text-[10px] font-mono text-gray-500">
          {value != null ? 'SWEEP' : 'NO SIGNAL'}
        </span>
      </div>

      {/* Info strip: RBW / VBW / Ref / Center / Span */}
      <div className="flex items-center justify-between rounded bg-[#0d1230] px-2 py-0.5 text-[10px] font-mono">
        <span className="text-amber-400">RBW {rbw}</span>
        <span className="text-amber-400">VBW {vbw}</span>
        <span className="text-red-400">Ref {refLevel} dBm</span>
        <span className="text-cyan-400">CF {centerFreq.toFixed(1)} MHz</span>
        <span className="text-cyan-400">Span {span} MHz</span>
      </div>

      {/* Canvas display */}
      <div className="relative overflow-hidden rounded border border-gray-400" style={{ background: BG_COLOR }}>
        <canvas
          ref={canvasRefCallback}
          className="block w-full"
          style={{ height: 280, width: '100%' }}
        />
      </div>

      {/* Bottom readout strip */}
      <div className="flex items-center justify-between px-1 text-[10px] font-mono text-gray-500">
        <span>
          Start {(centerFreq - span / 2).toFixed(1)} MHz
        </span>
        <span>
          Center {centerFreq.toFixed(1)} MHz
        </span>
        <span>
          Stop {(centerFreq + span / 2).toFixed(1)} MHz
        </span>
      </div>

      {/* Marker readout */}
      {value != null && (
        <div className="flex items-center gap-3 rounded bg-gray-100 px-2 py-0.5 text-[10px] font-mono text-gray-700">
          <span className="text-cyan-600 font-semibold">MKR1</span>
          <span>{centerFreq.toFixed(3)} MHz</span>
          <span className="font-bold text-amber-600">{value.toFixed(2)} dBm</span>
        </div>
      )}
    </div>
  )
}

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ThemeContext, type ThemeState } from '@/contexts/ThemeContext'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FFTDisplayPanelProps {
  value: number | null
  stepType?: string
  unit?: string
  limitMin?: number | null
  limitMax?: number | null
  limitNominal?: number | null
  limitTolerance?: number | null
  channel?: 'A' | 'B'
  label?: string
  ref?: React.Ref<HTMLDivElement>
}

interface SpectrumData {
  bins: Float64Array
  peakLevel: number
  peakBin: number
  noiseFloor: number
  sfdr: number
  largestSpurBin: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_SAT_MAX = 0
const DEFAULT_DB_SAT_MIN = -80
const NUM_BINS = 512
const TARGET_LEVEL = -4.0 // dBSat target line
const NOISE_FLOOR_SPEC = -60.0 // dBSat noise floor spec

const COLORS = {
  background: '#0f172a',
  gridLine: '#1e293b',
  gridLineMajor: '#334155',
  trace: '#22c55e',
  traceGlow: 'rgba(34, 197, 94, 0.35)',
  targetLine: '#facc15',
  noiseFloorLine: '#ef4444',
  axisText: '#94a3b8',
  labelText: '#cbd5e1',
  peakMarker: '#f97316',
  spurMarker: '#a78bfa',
} as const

// ---------------------------------------------------------------------------
// Spectrum generation helpers
// ---------------------------------------------------------------------------

/** Deterministic-seeded PRNG (xorshift32) for reproducible noise */
function makeRng(seed: number) {
  let s = seed | 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >> 17
    s ^= s << 5
    return ((s >>> 0) / 4294967296)
  }
}

function generateSpectrum(
  peakLevel: number,
  noiseFloor: number,
  channel: 'A' | 'B',
  animFrame: number,
): SpectrumData {
  const bins = new Float64Array(NUM_BINS)
  const rng = makeRng(animFrame * 7 + (channel === 'B' ? 9999 : 0))

  // Fill with noise floor + random texture
  for (let i = 0; i < NUM_BINS; i++) {
    const noiseVariation = (rng() - 0.5) * 8 // +/- 4 dB noise texture
    bins[i] = noiseFloor + noiseVariation
  }

  // Main signal peak at center (bin 256) with a realistic shape
  const centerBin = Math.floor(NUM_BINS / 2)
  const peakWidth = 6
  for (let i = -20; i <= 20; i++) {
    const bin = centerBin + i
    if (bin < 0 || bin >= NUM_BINS) continue
    const dist = Math.abs(i)
    if (dist <= peakWidth) {
      // Main lobe: raised cosine shape
      const shape = 0.5 * (1 + Math.cos((Math.PI * dist) / peakWidth))
      bins[bin] = noiseFloor + (peakLevel - noiseFloor) * shape
    } else {
      // Side lobes: decaying sinc-like
      const sinc = Math.sin(Math.PI * dist / peakWidth) / (Math.PI * dist / peakWidth)
      const sideLobeLevel = peakLevel + 20 * Math.log10(Math.abs(sinc) + 1e-10) - 15
      if (sideLobeLevel > bins[bin]) {
        bins[bin] = sideLobeLevel
      }
    }
  }

  // Add spurious signals (2-4 spurs)
  const spurCount = 2 + Math.floor(rng() * 3)
  let largestSpurLevel = -Infinity
  let largestSpurBin = 0
  const spurPositions: number[] = []
  for (let s = 0; s < spurCount; s++) {
    const spurBin = Math.floor(rng() * (NUM_BINS - 40)) + 20
    // Keep spurs away from the main peak
    if (Math.abs(spurBin - centerBin) < 30) continue
    spurPositions.push(spurBin)
    const spurLevel = noiseFloor + 5 + rng() * 15 // Spurs 5-20 dB above noise floor
    // Give the spur a narrow shape
    for (let i = -3; i <= 3; i++) {
      const b = spurBin + i
      if (b < 0 || b >= NUM_BINS) continue
      const shape = 0.5 * (1 + Math.cos((Math.PI * Math.abs(i)) / 3))
      const level = noiseFloor + (spurLevel - noiseFloor) * shape
      if (level > bins[b]) {
        bins[b] = level
      }
    }
    if (spurLevel > largestSpurLevel) {
      largestSpurLevel = spurLevel
      largestSpurBin = spurBin
    }
  }

  // Find actual peak
  let measuredPeak = -Infinity
  let peakBin = 0
  for (let i = 0; i < NUM_BINS; i++) {
    if (bins[i] > measuredPeak) {
      measuredPeak = bins[i]
      peakBin = i
    }
  }

  // Calculate noise floor (average of bins away from peaks)
  let noiseSum = 0
  let noiseCount = 0
  for (let i = 0; i < NUM_BINS; i++) {
    if (Math.abs(i - centerBin) > 30 && !spurPositions.some(sp => Math.abs(i - sp) < 10)) {
      noiseSum += bins[i]
      noiseCount++
    }
  }
  const measuredNoiseFloor = noiseCount > 0 ? noiseSum / noiseCount : noiseFloor

  // SFDR = peak - largest spur (in dBc)
  const sfdr = largestSpurLevel > -Infinity ? measuredPeak - largestSpurLevel : 70

  return { bins, peakLevel: measuredPeak, peakBin, noiseFloor: measuredNoiseFloor, sfdr, largestSpurBin }
}

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------

function drawFFT(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spectrum: SpectrumData,
  _theme: ThemeState,
  dpr: number,
  dbSatMin: number = DEFAULT_DB_SAT_MIN,
  zoomLevel: number = 1,
) {
  const DB_SAT_RANGE = DB_SAT_MAX - dbSatMin
  const displayBins = Math.floor(NUM_BINS / zoomLevel)
  const binOffset = Math.floor((NUM_BINS - displayBins) / 2)
  const marginLeft = 58 * dpr
  const marginRight = 16 * dpr
  const marginTop = 12 * dpr
  const marginBottom = 32 * dpr

  const plotW = width - marginLeft - marginRight
  const plotH = height - marginTop - marginBottom

  // ---- Background ----
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, width, height)

  // ---- Grid ----
  ctx.strokeStyle = COLORS.gridLine
  ctx.lineWidth = 1 * dpr

  // Horizontal grid lines (every 10 dB)
  for (let dB = DB_SAT_MAX; dB >= dbSatMin; dB -= 10) {
    const y = marginTop + ((DB_SAT_MAX - dB) / DB_SAT_RANGE) * plotH
    ctx.strokeStyle = dB === 0 || dB === -40 ? COLORS.gridLineMajor : COLORS.gridLine
    ctx.beginPath()
    ctx.moveTo(marginLeft, y)
    ctx.lineTo(marginLeft + plotW, y)
    ctx.stroke()

    // Y-axis labels
    ctx.fillStyle = COLORS.axisText
    ctx.font = `${10 * dpr}px "Courier New", monospace`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${dB}`, marginLeft - 6 * dpr, y)
  }

  // Vertical grid lines (every 64 bins, adjusted for zoom)
  const gridBinStep = Math.max(16, Math.floor(64 / zoomLevel))
  for (let bi = 0; bi <= displayBins; bi += gridBinStep) {
    const actualBin = binOffset + bi
    const x = marginLeft + (bi / displayBins) * plotW
    ctx.strokeStyle = actualBin === Math.floor(NUM_BINS / 2) ? COLORS.gridLineMajor : COLORS.gridLine
    ctx.beginPath()
    ctx.moveTo(x, marginTop)
    ctx.lineTo(x, marginTop + plotH)
    ctx.stroke()
  }

  // X-axis labels
  ctx.fillStyle = COLORS.axisText
  ctx.font = `${10 * dpr}px "Courier New", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const labelBinStep = Math.max(32, Math.floor(128 / zoomLevel))
  for (let bi = 0; bi <= displayBins; bi += labelBinStep) {
    const actualBin = binOffset + bi
    const x = marginLeft + (bi / displayBins) * plotW
    const normalized = (actualBin / NUM_BINS).toFixed(2)
    ctx.fillText(normalized, x, marginTop + plotH + 6 * dpr)
  }

  // ---- Target line (-4.0 dBSat) ----
  const targetY = marginTop + ((DB_SAT_MAX - TARGET_LEVEL) / DB_SAT_RANGE) * plotH
  ctx.setLineDash([8 * dpr, 5 * dpr])
  ctx.strokeStyle = COLORS.targetLine
  ctx.lineWidth = 1.5 * dpr
  ctx.beginPath()
  ctx.moveTo(marginLeft, targetY)
  ctx.lineTo(marginLeft + plotW, targetY)
  ctx.stroke()

  // Target label
  ctx.fillStyle = COLORS.targetLine
  ctx.font = `bold ${10 * dpr}px "Courier New", monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`TARGET ${TARGET_LEVEL.toFixed(1)} dBSat`, marginLeft + 4 * dpr, targetY - 3 * dpr)

  // ---- Noise floor spec line (-60 dBSat) ----
  const noiseSpecY = marginTop + ((DB_SAT_MAX - NOISE_FLOOR_SPEC) / DB_SAT_RANGE) * plotH
  ctx.strokeStyle = COLORS.noiseFloorLine
  ctx.lineWidth = 1.5 * dpr
  ctx.beginPath()
  ctx.moveTo(marginLeft, noiseSpecY)
  ctx.lineTo(marginLeft + plotW, noiseSpecY)
  ctx.stroke()
  ctx.setLineDash([])

  // Noise floor label
  ctx.fillStyle = COLORS.noiseFloorLine
  ctx.font = `bold ${10 * dpr}px "Courier New", monospace`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(`NOISE FLOOR ${NOISE_FLOOR_SPEC.toFixed(1)} dBSat`, marginLeft + plotW - 4 * dpr, noiseSpecY + 3 * dpr)

  // ---- FFT Trace (glow + solid) ----
  // Glow pass
  ctx.save()
  ctx.shadowColor = COLORS.traceGlow
  ctx.shadowBlur = 6 * dpr
  ctx.strokeStyle = COLORS.trace
  ctx.lineWidth = 1.5 * dpr
  ctx.beginPath()
  for (let di = 0; di < displayBins; di++) {
    const i = binOffset + di
    if (i < 0 || i >= NUM_BINS) continue
    const x = marginLeft + (di / displayBins) * plotW
    const clamped = Math.max(dbSatMin, Math.min(DB_SAT_MAX, spectrum.bins[i]))
    const y = marginTop + ((DB_SAT_MAX - clamped) / DB_SAT_RANGE) * plotH
    if (di === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()

  // Solid pass (sharper on top of glow)
  ctx.strokeStyle = COLORS.trace
  ctx.lineWidth = 1.2 * dpr
  ctx.beginPath()
  for (let di = 0; di < displayBins; di++) {
    const i = binOffset + di
    if (i < 0 || i >= NUM_BINS) continue
    const x = marginLeft + (di / displayBins) * plotW
    const clamped = Math.max(dbSatMin, Math.min(DB_SAT_MAX, spectrum.bins[i]))
    const y = marginTop + ((DB_SAT_MAX - clamped) / DB_SAT_RANGE) * plotH
    if (di === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // ---- Peak marker ----
  const peakBinDisplay = spectrum.peakBin - binOffset
  const peakX = marginLeft + (peakBinDisplay / displayBins) * plotW
  const peakY = marginTop + ((DB_SAT_MAX - Math.min(DB_SAT_MAX, spectrum.peakLevel)) / DB_SAT_RANGE) * plotH
  const peakInView = peakBinDisplay >= 0 && peakBinDisplay <= displayBins
  if (peakInView) {
    ctx.fillStyle = COLORS.peakMarker
    ctx.beginPath()
    // Downward triangle marker
    ctx.moveTo(peakX, peakY - 8 * dpr)
    ctx.lineTo(peakX - 5 * dpr, peakY - 14 * dpr)
    ctx.lineTo(peakX + 5 * dpr, peakY - 14 * dpr)
    ctx.closePath()
    ctx.fill()

    ctx.font = `bold ${9 * dpr}px "Courier New", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`${spectrum.peakLevel.toFixed(1)}`, peakX, peakY - 15 * dpr)
  }

  // ---- Largest spur marker ----
  if (spectrum.largestSpurBin > 0) {
    const spurBinDisplay = spectrum.largestSpurBin - binOffset
    const spurInView = spurBinDisplay >= 0 && spurBinDisplay <= displayBins
    const spurX = marginLeft + (spurBinDisplay / displayBins) * plotW
    const spurLevel = spectrum.bins[spectrum.largestSpurBin]
    const spurY = marginTop + ((DB_SAT_MAX - Math.max(dbSatMin, spurLevel)) / DB_SAT_RANGE) * plotH
    if (spurInView) {
    ctx.fillStyle = COLORS.spurMarker
    ctx.beginPath()
    ctx.moveTo(spurX, spurY - 6 * dpr)
    ctx.lineTo(spurX - 4 * dpr, spurY - 12 * dpr)
    ctx.lineTo(spurX + 4 * dpr, spurY - 12 * dpr)
    ctx.closePath()
    ctx.fill()

    ctx.font = `${8 * dpr}px "Courier New", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText('SPUR', spurX, spurY - 13 * dpr)
    }
  }

  // ---- Y-axis title ----
  ctx.save()
  ctx.translate(14 * dpr, marginTop + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = COLORS.labelText
  ctx.font = `bold ${11 * dpr}px "Courier New", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Amplitude (dBSat)', 0, 0)
  ctx.restore()

  // ---- X-axis title ----
  ctx.fillStyle = COLORS.labelText
  ctx.font = `bold ${11 * dpr}px "Courier New", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('Frequency (normalized)', marginLeft + plotW / 2, marginTop + plotH + 18 * dpr)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function FFTDisplayPanel({
  value,
  stepType,
  unit,
  limitMin,
  limitMax,
  limitNominal: _limitNominal,
  limitTolerance: _limitTolerance,
  channel: channelProp,
  label,
  ref,
}: FFTDisplayPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef(0)
  const [activeChannel, setActiveChannel] = useState<'A' | 'B'>(channelProp ?? 'A')
  const [spectrum, setSpectrum] = useState<SpectrumData | null>(null)
  const [displayDbMin, setDisplayDbMin] = useState(DEFAULT_DB_SAT_MIN)
  const [zoomLevel, setZoomLevel] = useState(1)

  // Sync channel prop
  useEffect(() => {
    if (channelProp) setActiveChannel(channelProp)
  }, [channelProp])

  // Reset display state when props change (new step)
  useEffect(() => {
    setDisplayDbMin(DEFAULT_DB_SAT_MIN)
    setZoomLevel(1)
  }, [value, stepType])

  // Derive peak and noise floor from value/stepType
  const peakLevel = stepType === 'fft_peak' && value != null ? value : -4.0
  const noiseFloor = stepType === 'fft_noise' && value != null ? value : -67.0

  // Generate spectrum data on value/channel change with animation
  useEffect(() => {
    let running = true
    let frame = 0

    const update = () => {
      if (!running) return
      frame++
      animFrameRef.current = frame
      const data = generateSpectrum(peakLevel, noiseFloor, activeChannel, frame)
      setSpectrum(data)
    }

    // Initial draw
    update()

    // Slow animation to simulate live noise movement (4 fps)
    const interval = setInterval(update, 250)

    return () => {
      running = false
      clearInterval(interval)
    }
  }, [peakLevel, noiseFloor, activeChannel])

  // Canvas ref callback with cleanup (React 19 pattern)
  const canvasRefCallback = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node
    if (!node) return

    // Return cleanup function — React 19 ref cleanup
    return () => {
      canvasRef.current = null
    }
  }, [])

  // React 19 use() — reads ThemeContext conditionally. use() is not subject
  // to rules-of-hooks ordering and can appear after early returns.
  const theme = use(ThemeContext)

  // Draw on canvas whenever spectrum changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !spectrum) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = rect.width * dpr
    const h = rect.height * dpr

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    drawFFT(ctx, w, h, spectrum, theme, dpr, displayDbMin, zoomLevel)
  }, [spectrum, theme, displayDbMin, zoomLevel])

  // Determine SFDR value: use provided value if stepType is fft_sfdr, else from spectrum
  const sfdrValue = stepType === 'fft_sfdr' && value != null ? value : spectrum?.sfdr ?? null
  const sfdrPass = sfdrValue != null && (limitMin != null ? sfdrValue >= limitMin : sfdrValue >= 60)

  // Measurement readouts
  const displayPeak = spectrum?.peakLevel ?? peakLevel
  const displayNoise = spectrum?.noiseFloor ?? noiseFloor
  const displaySfdr = sfdrValue

  // Determine pass/fail for noise floor
  const noisePass = limitMax != null ? displayNoise <= limitMax : displayNoise <= NOISE_FLOOR_SPEC

  return (
    <div ref={ref} className="flex flex-col rounded-lg overflow-hidden shadow-lg" style={{ border: `3px solid ${theme.bezelColor}` }}>
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ backgroundColor: theme.bezelColor }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700 tracking-wider uppercase">
            FFT Analyzer
          </span>
          {label && (
            <span className="text-xs text-slate-500 font-mono">{label}</span>
          )}
        </div>

        {/* Channel A/B toggle */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveChannel('A')}
            className={cn(
              'px-2.5 py-0.5 text-xs font-bold rounded transition-colors',
              activeChannel === 'A'
                ? 'bg-cyan-500 text-white shadow-inner'
                : 'bg-slate-300 text-slate-600 hover:bg-slate-400'
            )}
          >
            CH A
          </button>
          <button
            type="button"
            onClick={() => setActiveChannel('B')}
            className={cn(
              'px-2.5 py-0.5 text-xs font-bold rounded transition-colors',
              activeChannel === 'B'
                ? 'bg-cyan-500 text-white shadow-inner'
                : 'bg-slate-300 text-slate-600 hover:bg-slate-400'
            )}
          >
            CH B
          </button>
        </div>
      </div>

      {/* Control strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-[10px] font-mono" style={{ backgroundColor: '#0d1230' }}>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">CHANNEL</span>
          {(['A', 'B'] as const).map(ch => (
            <button key={ch} onClick={() => setActiveChannel(ch)}
              className={cn("px-1.5 py-0.5 rounded transition-colors",
                activeChannel === ch ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              )}
            >{ch}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">Y SCALE</span>
          {([[-40, "0 to -40"], [-60, "0 to -60"], [-80, "0 to -80"]] as const).map(([v, lbl]) => (
            <button key={v} onClick={() => setDisplayDbMin(v)}
              className={cn("px-1.5 py-0.5 rounded transition-colors",
                displayDbMin === v ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              )}
            >{lbl}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">ZOOM</span>
          {([1, 2, 4] as const).map(z => (
            <button key={z} onClick={() => setZoomLevel(z)}
              className={cn("px-1.5 py-0.5 rounded transition-colors",
                zoomLevel === z ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              )}
            >{z}x</button>
          ))}
        </div>
      </div>

      {/* Canvas display */}
      <div className="relative" style={{ backgroundColor: COLORS.background }}>
        <canvas
          ref={canvasRefCallback}
          className="w-full"
          style={{ height: 280, display: 'block' }}
        />

        {/* SFDR badge overlay */}
        {displaySfdr != null && (
          <div
            className={cn(
              'absolute top-2 right-2 px-3 py-1.5 rounded font-mono text-sm font-bold shadow-md',
              sfdrPass ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
            )}
          >
            SFDR: {displaySfdr.toFixed(1)} dBc
          </div>
        )}

        {/* Channel indicator overlay */}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-slate-800/80 text-cyan-400 font-mono text-xs font-bold">
          CH {activeChannel}
        </div>
      </div>

      {/* Measurement readouts */}
      <div
        className="grid grid-cols-3 gap-px"
        style={{ backgroundColor: theme.bezelColor }}
      >
        {/* Peak Level */}
        <div className="flex flex-col items-center py-2 px-2" style={{ backgroundColor: '#1e293b' }}>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            Peak Level
          </span>
          <span className="text-lg font-mono font-bold text-amber-400">
            {displayPeak.toFixed(1)}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">
            {unit === 'dBc' ? 'dBc' : 'dBSat'}
          </span>
        </div>

        {/* Noise Floor */}
        <div className="flex flex-col items-center py-2 px-2" style={{ backgroundColor: '#1e293b' }}>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            Noise Floor
          </span>
          <span className={cn(
            'text-lg font-mono font-bold',
            noisePass ? 'text-emerald-400' : 'text-red-400'
          )}>
            {displayNoise.toFixed(1)}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">dBSat</span>
        </div>

        {/* SFDR */}
        <div className="flex flex-col items-center py-2 px-2" style={{ backgroundColor: '#1e293b' }}>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            SFDR
          </span>
          <span className={cn(
            'text-lg font-mono font-bold',
            sfdrPass ? 'text-emerald-400' : 'text-red-400'
          )}>
            {displaySfdr != null ? displaySfdr.toFixed(1) : '---'}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">dBc</span>
        </div>
      </div>

      {/* Bottom bezel with step info */}
      <div
        className="flex items-center justify-between px-3 py-1"
        style={{ backgroundColor: theme.bezelColor }}
      >
        <span className="text-[10px] font-mono text-slate-500">
          {stepType ? stepType.toUpperCase().replace('_', ' ') : 'FFT ANALYSIS'}
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          {NUM_BINS} pts | IF Receiver
        </span>
      </div>
    </div>
  )
}

export default FFTDisplayPanel

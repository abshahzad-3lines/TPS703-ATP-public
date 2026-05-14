import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MultimeterPanelProps {
  value: number | null
  unit?: string               // "A", "ohms", "V"
  mode?: string               // "current", "resistance", "voltage"
  limitMin?: number | null
  limitMax?: number | null
  limitNominal?: number | null
  limitTolerance?: number | null
  limitType?: string | null   // "min", "max", "range", "nominal"
  label?: string
  ref?: React.Ref<HTMLDivElement>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mode label shown on the display bezel (VDC, A DC, etc.) */
function getModeLabel(mode?: string, unit?: string): string {
  // Mode is authoritative; fall back to unit-based inference only when mode
  // is unset. Without this ordering, an SI-scaled unit like "mV" or "mA"
  // could hit the wrong OR branch and flip the readout back to VDC after the
  // page had already switched modes.
  if (mode === 'voltage') return 'VDC'
  if (mode === 'current') return 'A DC'
  if (mode === 'resistance') return 'Ω'
  if (unit === 'V') return 'VDC'
  if (unit === 'A') return 'A DC'
  if (unit === 'ohms' || unit === 'Ω') return 'Ω'
  if (unit) return unit
  return 'VDC'
}

/** Format the unit for display under the readout */
function getUnitLabel(unit?: string): string {
  if (unit === 'ohms') return '\u03A9'
  if (unit) return unit
  return ''
}

/**
 * Format a numeric value as 5.5 digits for the 7-segment display.
 *
 * 5.5 digits means the most-significant digit can only be 0 or 1 (half digit)
 * while the remaining 5 digits span 0-9, giving a max reading of 199999 counts.
 * In practice we format to 5-6 significant characters including the decimal
 * point so the display always shows a fixed-width string.
 */
function formatDisplayValue(value: number | null, digitMode: '5.5' | '4.5' = '5.5'): string {
  if (value === null || value === undefined) return digitMode === '4.5' ? '-----' : '------'

  // Truevolt overload sentinel — show as "OL" rather than 9.91E+37.
  const abs = Math.abs(value)
  if (abs >= 1e36) return ' OL'

  // Per user spec: always show two decimal places. A real DMM would use 5.5
  // digits, but the operator wants a stable two-decimal readout that matches
  // the data sheet's recorded value.
  const sign = value < 0 ? '-' : ' '
  return sign + abs.toFixed(2)
}

/**
 * Resolve effective min/max limits from the various limit props.
 * Returns [min, max] or [null, null] if limits cannot be determined.
 */
function resolveMinMax(
  limitType?: string | null,
  limitMin?: number | null,
  limitMax?: number | null,
  limitNominal?: number | null,
  limitTolerance?: number | null,
): [number | null, number | null] {
  if (limitType === 'range' && limitMin != null && limitMax != null) {
    return [limitMin, limitMax]
  }
  if (limitType === 'nominal' && limitNominal != null && limitTolerance != null) {
    return [limitNominal - limitTolerance, limitNominal + limitTolerance]
  }
  if (limitType === 'min' && limitMin != null) {
    return [limitMin, null]
  }
  if (limitType === 'max' && limitMax != null) {
    return [null, limitMax]
  }
  // Fallback: try to infer
  if (limitMin != null && limitMax != null) return [limitMin, limitMax]
  if (limitNominal != null && limitTolerance != null) {
    return [limitNominal - limitTolerance, limitNominal + limitTolerance]
  }
  if (limitMin != null) return [limitMin, null]
  if (limitMax != null) return [null, limitMax]
  return [null, null]
}

/** Determine pass / fail status */
function getStatus(
  value: number | null,
  min: number | null,
  max: number | null,
): 'pass' | 'fail' | 'idle' {
  if (value === null) return 'idle'
  if (min != null && value < min) return 'fail'
  if (max != null && value > max) return 'fail'
  if (min != null || max != null) return 'pass'
  return 'idle'
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** CSS-styled 7-segment digit display */
function SevenSegmentDisplay({ text }: { text: string }) {
  return (
    <div
      className="flex items-center justify-end gap-0 px-4 py-3 select-none"
      aria-label={`Readout: ${text.trim()}`}
    >
      {text.split('').map((ch, i) => (
        <span
          key={i}
          className={cn(
            'inline-block text-center',
            // Decimal point gets narrower width
            ch === '.'
              ? 'w-[0.35em]'
              : ch === '-'
                ? 'w-[0.65em]'
                : ch === ' '
                  ? 'w-[0.55em]'
                  : 'w-[0.65em]',
          )}
          style={{
            fontFamily: "'DSEG7 Classic', 'Courier New', 'Consolas', monospace",
            fontSize: '2.75rem',
            lineHeight: 1,
            color: ch === ' ' ? 'transparent' : '#f8fafc',
            // Subtle glow effect on active segments
            textShadow:
              ch !== ' '
                ? '0 0 8px rgba(248,250,252,0.35), 0 0 2px rgba(248,250,252,0.5)'
                : 'none',
          }}
        >
          {ch === ' ' ? '8' : ch}
        </span>
      ))}
    </div>
  )
}

/**
 * Tolerance bar – horizontal bar showing acceptable (green) zone with red
 * out-of-spec regions on each side and a marker for the current value.
 */
function ToleranceBar({
  value,
  min,
  max,
  status,
}: {
  value: number | null
  min: number | null
  max: number | null
  status: 'pass' | 'fail' | 'idle'
}) {
  // We need at least one bound to draw anything meaningful
  const hasMin = min != null
  const hasMax = max != null

  if (!hasMin && !hasMax) return null

  // Build a visual range: we extend 20 % beyond the limits on each side
  const effectiveMin = hasMin ? min : hasMax ? max - Math.abs(max) * 0.5 - 1 : 0
  const effectiveMax = hasMax ? max : hasMin ? min + Math.abs(min) * 0.5 + 1 : 1
  const span = effectiveMax - effectiveMin || 1
  const margin = span * 0.25
  const barMin = effectiveMin - margin
  const barMax = effectiveMax + margin
  const barSpan = barMax - barMin

  // Calculate positions as percentages
  const greenLeft = ((effectiveMin - barMin) / barSpan) * 100
  const greenRight = ((effectiveMax - barMin) / barSpan) * 100

  let markerPct: number | null = null
  if (value != null) {
    markerPct = Math.max(0, Math.min(100, ((value - barMin) / barSpan) * 100))
  }

  // Format limit label with sensible precision
  const fmtLimit = (v: number) => {
    const abs = Math.abs(v)
    if (abs >= 1000) return v.toFixed(0)
    if (abs >= 100) return v.toFixed(1)
    if (abs >= 10) return v.toFixed(2)
    if (abs >= 1) return v.toFixed(3)
    return v.toFixed(4)
  }

  return (
    <div className="px-4 pb-3 pt-1">
      {/* Limit labels */}
      <div className="relative h-4 text-[10px] font-mono text-slate-400 mb-0.5">
        {hasMin && (
          <span
            className="absolute -translate-x-1/2"
            style={{ left: `${greenLeft}%` }}
          >
            {fmtLimit(effectiveMin)}
          </span>
        )}
        {hasMax && (
          <span
            className="absolute -translate-x-1/2"
            style={{ left: `${greenRight}%` }}
          >
            {fmtLimit(effectiveMax)}
          </span>
        )}
      </div>

      {/* Bar */}
      <div className="relative h-3 w-full rounded-sm overflow-hidden bg-red-900/70">
        {/* Green zone */}
        <div
          className="absolute inset-y-0 bg-emerald-600/80"
          style={{
            left: `${greenLeft}%`,
            width: `${greenRight - greenLeft}%`,
          }}
        />

        {/* Value marker */}
        {markerPct != null && (
          <div
            className="absolute top-0 h-full w-0.5"
            style={{
              left: `${markerPct}%`,
              transform: 'translateX(-50%)',
            }}
          >
            {/* Tall marker line */}
            <div
              className={cn(
                'w-0.5 h-full',
                status === 'fail' ? 'bg-red-400' : 'bg-white',
              )}
            />
            {/* Triangular pointer on top */}
            <div
              className={cn(
                'absolute -top-1.5 left-1/2 -translate-x-1/2',
                'w-0 h-0',
                'border-l-[4px] border-l-transparent',
                'border-r-[4px] border-r-transparent',
                status === 'fail'
                  ? 'border-t-[5px] border-t-red-400'
                  : 'border-t-[5px] border-t-white',
              )}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MultimeterPanel({
  value,
  unit,
  mode,
  limitMin,
  limitMax,
  limitNominal,
  limitTolerance,
  limitType,
  label,
  ref,
}: MultimeterPanelProps) {
  const [rangeLabel, setRangeLabel] = useState('AUTO')
  const [digitMode, setDigitMode] = useState<'5.5' | '4.5'>('5.5')

  // Reset display state when props change (new step)
  useEffect(() => {
    setRangeLabel('AUTO')
    setDigitMode('5.5')
  }, [value, limitMin, limitMax, limitNominal, limitTolerance])

  const displayText = useMemo(() => formatDisplayValue(value, digitMode), [value, digitMode])

  const [min, max] = useMemo(
    () => resolveMinMax(limitType, limitMin, limitMax, limitNominal, limitTolerance),
    [limitType, limitMin, limitMax, limitNominal, limitTolerance],
  )

  const status = useMemo(() => getStatus(value, min, max), [value, min, max])

  const modeLabel = getModeLabel(mode, unit)
  const unitLabel = getUnitLabel(unit)

  return (
    <div
      ref={ref}
      className={cn(
        // Outer bezel
        'rounded-lg border-2 bg-[#e5e7eb] p-1.5 shadow-md',
        'flex flex-col',
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label ?? 'Digital Multimeter'}
        </span>
        <span className="text-[10px] font-mono text-slate-400">34401A</span>
      </div>

      {/* Display window — dark inset */}
      <div
        className="mx-1 rounded-md border border-slate-700"
        style={{ backgroundColor: '#111827' }}
      >
        {/* Top info row inside display */}
        <div className="flex items-center justify-between px-4 pt-2">
          {/* Mode indicator */}
          <span
            className="text-xs font-bold tracking-wider"
            style={{ color: '#94a3b8' }}
          >
            {modeLabel}
          </span>

          {/* Range / unit */}
          {unitLabel && (
            <span
              className="text-xs font-mono"
              style={{ color: '#64748b' }}
            >
              {unitLabel}
            </span>
          )}
        </div>

        {/* 7-segment readout */}
        <SevenSegmentDisplay text={displayText} />

        {/* Status line */}
        <div className="flex items-center justify-between px-4 pb-2">
          {/* Range label */}
          <span
            className="text-[10px] font-mono"
            style={{ color: '#475569' }}
          >
            {rangeLabel}
          </span>

          {/* Pass / Fail indicator */}
          {status !== 'idle' && (
            <span
              className={cn(
                'text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded',
                status === 'pass'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/20 text-red-400',
              )}
            >
              {status === 'pass' ? 'PASS' : 'FAIL'}
            </span>
          )}
        </div>

        {/* ── Display controls ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-[10px] font-mono" style={{ backgroundColor: '#0d1230' }}>
          <div className="flex items-center gap-1">
            <span className="text-gray-500">RANGE</span>
            {(['AUTO', '100', '10', '1', '0.1'] as const).map(r => (
              <button key={r} onClick={() => setRangeLabel(r)}
                className={cn("px-1.5 py-0.5 rounded transition-colors",
                  rangeLabel === r ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                )}
              >{r}</button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-500">DIGITS</span>
            {(['5.5', '4.5'] as const).map(d => (
              <button key={d} onClick={() => setDigitMode(d)}
                className={cn("px-1.5 py-0.5 rounded transition-colors",
                  digitMode === d ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                )}
              >{d}</button>
            ))}
          </div>
        </div>

        {/* Tolerance bar */}
        <ToleranceBar value={value} min={min} max={max} status={status} />
      </div>

      {/* Bottom bezel detail — screw holes and branding */}
      <div className="flex items-center justify-between px-3 py-1 mt-0.5">
        <div className="flex gap-1">
          {/* Decorative screw dots */}
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400/60" />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400/60" />
        </div>
        <span className="text-[8px] text-slate-400 tracking-widest">KEYSIGHT</span>
        <div className="flex gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400/60" />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400/60" />
        </div>
      </div>
    </div>
  )
}

export default MultimeterPanel

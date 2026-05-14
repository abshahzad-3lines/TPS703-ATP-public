import { useEffect, useDeferredValue, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  ReferenceLine,
  Cell,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

// ─── Props ────────────────────────────────────────────────────────────────────

interface PowerMeterPanelProps {
  value: number | null
  unit?: string
  limitMin?: number | null
  limitMax?: number | null
  frequency?: number | null
  label?: string
  ref?: React.Ref<HTMLDivElement>
}

// ─── Seven-segment digit mapping ──────────────────────────────────────────────
//
//  Segment layout:
//     ─ a ─
//   |       |
//   f       b
//   |       |
//     ─ g ─
//   |       |
//   e       c
//   |       |
//     ─ d ─
//
const SEGMENT_MAP: Record<string, boolean[]> = {
  //         a      b      c      d      e      f      g
  '0': [  true,  true,  true,  true,  true,  true, false],
  '1': [ false,  true,  true, false, false, false, false],
  '2': [  true,  true, false,  true,  true, false,  true],
  '3': [  true,  true,  true,  true, false, false,  true],
  '4': [ false,  true,  true, false, false,  true,  true],
  '5': [  true, false,  true,  true, false,  true,  true],
  '6': [  true, false,  true,  true,  true,  true,  true],
  '7': [  true,  true,  true, false, false, false, false],
  '8': [  true,  true,  true,  true,  true,  true,  true],
  '9': [  true,  true,  true,  true, false,  true,  true],
  '-': [ false, false, false, false, false, false,  true],
  ' ': [ false, false, false, false, false, false, false],
}

// ─── Segment component ───────────────────────────────────────────────────────

function Segment({ on, type }: { on: boolean; type: 'h' | 'v' }) {
  const isH = type === 'h'
  return (
    <span
      className={cn(
        'block absolute transition-opacity duration-150',
        isH ? 'h-[3px] rounded-full' : 'w-[3px] rounded-full',
      )}
      style={{
        width: isH ? '14px' : undefined,
        height: !isH ? '14px' : undefined,
        backgroundColor: on ? '#f59e0b' : '#2a2520',
        opacity: on ? 1 : 0.12,
        boxShadow: on ? '0 0 6px 1px rgba(245,158,11,0.45)' : 'none',
      }}
    />
  )
}

// ─── Single digit with 7-segment display ─────────────────────────────────────

function SevenSegDigit({ char }: { char: string }) {
  const segs = SEGMENT_MAP[char] ?? SEGMENT_MAP[' ']
  // positions for each segment relative to a 22x32 bounding box
  return (
    <span className="relative inline-block" style={{ width: 22, height: 32 }}>
      {/* a - top horizontal */}
      <span className="absolute" style={{ top: 0, left: 4 }}>
        <Segment on={segs[0]} type="h" />
      </span>
      {/* b - top-right vertical */}
      <span className="absolute" style={{ top: 3, left: 18 }}>
        <Segment on={segs[1]} type="v" />
      </span>
      {/* c - bottom-right vertical */}
      <span className="absolute" style={{ top: 17, left: 18 }}>
        <Segment on={segs[2]} type="v" />
      </span>
      {/* d - bottom horizontal */}
      <span className="absolute" style={{ top: 29, left: 4 }}>
        <Segment on={segs[3]} type="h" />
      </span>
      {/* e - bottom-left vertical */}
      <span className="absolute" style={{ top: 17, left: 1 }}>
        <Segment on={segs[4]} type="v" />
      </span>
      {/* f - top-left vertical */}
      <span className="absolute" style={{ top: 3, left: 1 }}>
        <Segment on={segs[5]} type="v" />
      </span>
      {/* g - middle horizontal */}
      <span className="absolute" style={{ top: 14.5, left: 4 }}>
        <Segment on={segs[6]} type="h" />
      </span>
    </span>
  )
}

// ─── Decimal-point dot ───────────────────────────────────────────────────────

function DecimalDot({ on }: { on: boolean }) {
  return (
    <span
      className="inline-block relative"
      style={{ width: 6, height: 32, verticalAlign: 'top' }}
    >
      <span
        className="absolute rounded-full"
        style={{
          width: 4,
          height: 4,
          bottom: 1,
          left: 1,
          backgroundColor: on ? '#f59e0b' : '#2a2520',
          opacity: on ? 1 : 0.12,
          boxShadow: on ? '0 0 5px 1px rgba(245,158,11,0.45)' : 'none',
        }}
      />
    </span>
  )
}

// ─── Full seven-segment readout ──────────────────────────────────────────────

function SevenSegReadout({ text }: { text: string }) {
  const elements: React.ReactNode[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '.') {
      elements.push(<DecimalDot key={`dot-${i}`} on />)
    } else {
      elements.push(<SevenSegDigit key={`d-${i}`} char={ch} />)
    }
  }
  return <span className="inline-flex items-end gap-[2px]">{elements}</span>
}

// ─── Chart value clamping helpers ────────────────────────────────────────────

function computeRange(
  value: number | null,
  limitMin: number | null | undefined,
  limitMax: number | null | undefined,
) {
  const points: number[] = []
  if (value != null) points.push(value)
  if (limitMin != null) points.push(limitMin)
  if (limitMax != null) points.push(limitMax)
  if (points.length === 0) return { min: 0, max: 100 }

  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const span = hi - lo || 10
  return {
    min: Math.floor(lo - span * 0.25),
    max: Math.ceil(hi + span * 0.25),
  }
}

// ─── Determine pass/fail ─────────────────────────────────────────────────────

function getStatus(
  value: number | null,
  limitMin: number | null | undefined,
  limitMax: number | null | undefined,
): 'pass' | 'fail' | 'none' {
  if (value == null) return 'none'
  if (limitMin != null && value < limitMin) return 'fail'
  if (limitMax != null && value > limitMax) return 'fail'
  return 'pass'
}

// ─── Main component ──────────────────────────────────────────────────────────

export function PowerMeterPanel({
  value,
  unit = 'dBm',
  limitMin = null,
  limitMax = null,
  frequency = null,
  label = 'RF Output Power',
  ref,
}: PowerMeterPanelProps) {
  // Display scaling state
  const [displayUnit, setDisplayUnit] = useState<'dBm' | 'W'>('dBm')
  const [rangeMax, setRangeMax] = useState<number | null>(null) // null = Auto

  // Reset display state when props change (new step)
  useEffect(() => {
    setDisplayUnit('dBm')
    setRangeMax(null)
  }, [value, limitMin, limitMax])

  // React 19: useDeferredValue for smooth transitions
  const deferredValue = useDeferredValue(value)

  // Convert value based on display unit
  const convertedValue = useMemo(() => {
    if (deferredValue == null) return null
    if (displayUnit === 'W') {
      return Math.pow(10, deferredValue / 10) / 1000
    }
    return deferredValue
  }, [deferredValue, displayUnit])

  const displayText = useMemo(() => {
    if (convertedValue == null) return '-- --'
    if (displayUnit === 'W') {
      if (convertedValue >= 100) return convertedValue.toFixed(1)
      if (convertedValue >= 10) return convertedValue.toFixed(2)
      if (convertedValue >= 1) return convertedValue.toFixed(3)
      return convertedValue.toFixed(4)
    }
    return convertedValue.toFixed(2)
  }, [convertedValue, displayUnit])

  const status = getStatus(deferredValue, limitMin, limitMax)

  // Chart range: use rangeMax override or auto-compute
  const range = useMemo(() => {
    if (rangeMax != null && deferredValue != null) {
      // Fixed range from 0 to rangeMax (dBm), with some padding below
      return { min: 0, max: rangeMax }
    }
    return computeRange(deferredValue, limitMin, limitMax)
  }, [deferredValue, limitMin, limitMax, rangeMax])

  const chartData = useMemo(() => {
    if (deferredValue == null) return []
    return [{ name: 'Power', value: deferredValue }]
  }, [deferredValue])

  const barColor = status === 'fail' ? '#ef4444' : '#10b981'
  const activeUnit = displayUnit === 'W' ? 'W' : unit

  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border-2 bg-[#e5e7eb] p-[6px] shadow-md',
        'select-none',
      )}
      style={{
        borderColor: '#d1d5db',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.7), 0 2px 6px rgba(0,0,0,0.15)',
      }}
    >
      {/* ── Inner instrument face ── */}
      <div className="rounded-md overflow-hidden" style={{ backgroundColor: '#1a1814' }}>
        {/* ── Header strip ── */}
        <div
          className="flex items-center justify-between px-3 py-1.5"
          style={{ backgroundColor: '#252220' }}
        >
          <span
            className="text-[10px] font-semibold tracking-widest uppercase"
            style={{ color: '#a8a29e' }}
          >
            {label}
          </span>
          {frequency != null && (
            <span
              className="text-[10px] font-mono"
              style={{ color: '#78716c' }}
            >
              {frequency.toFixed(1)} MHz
            </span>
          )}
        </div>

        {/* ── Seven-segment readout area ── */}
        <div
          className="flex items-center justify-center gap-3 py-4 px-4"
          style={{ backgroundColor: '#0f0d0a' }}
        >
          <SevenSegReadout text={displayText} />
          <span
            className="text-sm font-mono font-semibold ml-1"
            style={{
              color: deferredValue != null ? '#f59e0b' : '#2a2520',
              textShadow:
                deferredValue != null
                  ? '0 0 6px rgba(245,158,11,0.4)'
                  : 'none',
            }}
          >
            {activeUnit}
          </span>
        </div>

        {/* ── Status indicator strip ── */}
        <div
          className="flex items-center justify-between px-3 py-1"
          style={{ backgroundColor: '#1a1814' }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className={cn('inline-block w-2 h-2 rounded-full', {
                'bg-emerald-500': status === 'pass',
                'bg-red-500': status === 'fail',
                'bg-slate-600': status === 'none',
              })}
              style={{
                boxShadow:
                  status === 'pass'
                    ? '0 0 4px #10b981'
                    : status === 'fail'
                      ? '0 0 4px #ef4444'
                      : 'none',
              }}
            />
            <span
              className="text-[9px] font-mono uppercase tracking-wider"
              style={{
                color:
                  status === 'pass'
                    ? '#10b981'
                    : status === 'fail'
                      ? '#ef4444'
                      : '#57534e',
              }}
            >
              {status === 'pass' ? 'IN SPEC' : status === 'fail' ? 'OUT OF SPEC' : 'NO DATA'}
            </span>
          </div>

          {/* Limits readout */}
          <div className="flex items-center gap-2">
            {limitMin != null && (
              <span className="text-[9px] font-mono" style={{ color: '#78716c' }}>
                MIN {limitMin.toFixed(2)}
              </span>
            )}
            {limitMax != null && (
              <span className="text-[9px] font-mono" style={{ color: '#78716c' }}>
                MAX {limitMax.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {/* ── Display controls ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-[10px] font-mono" style={{ backgroundColor: '#0d1117' }}>
          <div className="flex items-center gap-1">
            <span className="text-gray-500">UNITS</span>
            {(['dBm', 'W'] as const).map(u => (
              <button key={u} onClick={() => setDisplayUnit(u)}
                className={cn("px-1.5 py-0.5 rounded transition-colors",
                  displayUnit === u ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                )}
              >{u}</button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-500">RANGE</span>
            {([[null, 'Auto'], [60, '60 dBm'], [50, '50 dBm'], [40, '40 dBm']] as const).map(([v, lbl]) => (
              <button key={lbl} onClick={() => setRangeMax(v)}
                className={cn("px-1.5 py-0.5 rounded transition-colors",
                  rangeMax === v ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                )}
              >{lbl}</button>
            ))}
          </div>
        </div>

        {/* ── Horizontal bar chart ── */}
        <div className="px-3 pb-3 pt-1">
          <div
            className="rounded"
            style={{
              backgroundColor: '#141210',
              border: '1px solid #2a2520',
              height: 52,
            }}
          >
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={50}>
                <ComposedChart
                  layout="vertical"
                  data={chartData}
                  margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="#2a2520"
                    strokeDasharray="2 4"
                  />
                  <XAxis
                    type="number"
                    domain={[range.min, range.max]}
                    tick={{ fill: '#57534e', fontSize: 9, fontFamily: 'monospace' }}
                    axisLine={{ stroke: '#2a2520' }}
                    tickLine={{ stroke: '#2a2520' }}
                  />
                  <YAxis type="category" dataKey="name" hide />

                  {/* Limit min reference line */}
                  {limitMin != null && (
                    <ReferenceLine
                      x={limitMin}
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      label={{
                        value: `MIN`,
                        position: 'top',
                        fill: '#f59e0b',
                        fontSize: 8,
                        fontFamily: 'monospace',
                      }}
                    />
                  )}

                  {/* Limit max reference line */}
                  {limitMax != null && (
                    <ReferenceLine
                      x={limitMax}
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      label={{
                        value: `MAX`,
                        position: 'top',
                        fill: '#f59e0b',
                        fontSize: 8,
                        fontFamily: 'monospace',
                      }}
                    />
                  )}

                  <Bar
                    dataKey="value"
                    barSize={14}
                    radius={[0, 3, 3, 0]}
                    isAnimationActive
                    animationDuration={300}
                  >
                    {chartData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={barColor} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full">
                <span
                  className="text-[10px] font-mono"
                  style={{ color: '#57534e' }}
                >
                  AWAITING MEASUREMENT
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom bezel label ── */}
      <div className="flex items-center justify-center pt-1 pb-0.5">
        <span
          className="text-[8px] font-semibold tracking-[0.15em] uppercase"
          style={{ color: '#9ca3af' }}
        >
          POWER METER
        </span>
      </div>
    </div>
  )
}

export default PowerMeterPanel

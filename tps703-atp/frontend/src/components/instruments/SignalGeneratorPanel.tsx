import { useDeferredValue, useMemo } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SignalGeneratorPanelProps {
  /** Frequency in Hz (preferred — auto-scales to MHz/GHz). When null the readout shows dashes. */
  frequencyHz?: number | null
  /** Frequency in MHz, used as a fallback when frequencyHz is null. */
  frequencyMhz?: number | null
  /** Output amplitude in dBm. */
  amplitudeDbm?: number | null
  /** RF output state — true lights the orange RF ON annunciator. */
  rfOn?: boolean
  /** Internal pulse modulation enabled — lights the PULSE annunciator. */
  pulseOn?: boolean
  /** Label rendered top-left of the bezel. */
  label?: string
  /** Sub-label (e.g. registered model + connection address). */
  sublabel?: string | null
  /** React 19: ref as a regular prop. */
  ref?: React.Ref<HTMLDivElement>
}

// ---------------------------------------------------------------------------
// Seven-segment glyphs (orange-on-dark, matches PowerMeter / Multimeter)
// ---------------------------------------------------------------------------

const SEG: Record<string, boolean[]> = {
  //         a      b      c      d      e      f      g
  '0': [ true,  true,  true,  true,  true,  true,  false ],
  '1': [ false, true,  true,  false, false, false, false ],
  '2': [ true,  true,  false, true,  true,  false, true  ],
  '3': [ true,  true,  true,  true,  false, false, true  ],
  '4': [ false, true,  true,  false, false, true,  true  ],
  '5': [ true,  false, true,  true,  false, true,  true  ],
  '6': [ true,  false, true,  true,  true,  true,  true  ],
  '7': [ true,  true,  true,  false, false, false, false ],
  '8': [ true,  true,  true,  true,  true,  true,  true  ],
  '9': [ true,  true,  true,  true,  false, true,  true  ],
  '-': [ false, false, false, false, false, false, true  ],
  ' ': [ false, false, false, false, false, false, false ],
}

function Bar({ on, type }: { on: boolean; type: 'h' | 'v' }) {
  const isH = type === 'h'
  return (
    <span
      className="block absolute transition-opacity duration-150 rounded-full"
      style={{
        width: isH ? 14 : 3,
        height: isH ? 3 : 14,
        backgroundColor: on ? '#f59e0b' : '#2a2520',
        opacity: on ? 1 : 0.12,
        boxShadow: on ? '0 0 6px 1px rgba(245,158,11,0.45)' : 'none',
      }}
    />
  )
}

function Digit({ ch }: { ch: string }) {
  const segs = SEG[ch] ?? SEG[' ']
  return (
    <span className="relative inline-block" style={{ width: 22, height: 32 }}>
      <span className="absolute" style={{ top: 0,    left: 4 }}><Bar on={segs[0]} type="h" /></span>
      <span className="absolute" style={{ top: 3,    left: 18 }}><Bar on={segs[1]} type="v" /></span>
      <span className="absolute" style={{ top: 17,   left: 18 }}><Bar on={segs[2]} type="v" /></span>
      <span className="absolute" style={{ top: 29,   left: 4 }}><Bar on={segs[3]} type="h" /></span>
      <span className="absolute" style={{ top: 17,   left: 1 }}><Bar on={segs[4]} type="v" /></span>
      <span className="absolute" style={{ top: 3,    left: 1 }}><Bar on={segs[5]} type="v" /></span>
      <span className="absolute" style={{ top: 14.5, left: 4 }}><Bar on={segs[6]} type="h" /></span>
    </span>
  )
}

function Dot({ on }: { on: boolean }) {
  return (
    <span className="inline-block relative" style={{ width: 6, height: 32, verticalAlign: 'top' }}>
      <span
        className="absolute rounded-full"
        style={{
          width: 4, height: 4, bottom: 1, left: 1,
          backgroundColor: on ? '#f59e0b' : '#2a2520',
          opacity: on ? 1 : 0.12,
          boxShadow: on ? '0 0 5px 1px rgba(245,158,11,0.45)' : 'none',
        }}
      />
    </span>
  )
}

function Readout({ text }: { text: string }) {
  const elements: React.ReactNode[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '.') elements.push(<Dot key={`d-${i}`} on />)
    else elements.push(<Digit key={`g-${i}`} ch={c} />)
  }
  return <span className="inline-flex items-end gap-[2px]">{elements}</span>
}

// ---------------------------------------------------------------------------
// Frequency scaling — pick Hz / kHz / MHz / GHz so |mantissa| stays in [1, 1000)
// ---------------------------------------------------------------------------

function scaleFrequency(hz: number | null): { value: string; unit: string } {
  if (hz == null || !isFinite(hz)) return { value: '----.--', unit: 'MHz' }
  const abs = Math.abs(hz)
  // Per user spec: always two decimal places on the readout.
  if (abs >= 1e9)  return { value: (hz / 1e9).toFixed(2),  unit: 'GHz' }
  if (abs >= 1e6)  return { value: (hz / 1e6).toFixed(2),  unit: 'MHz' }
  if (abs >= 1e3)  return { value: (hz / 1e3).toFixed(2),  unit: 'kHz' }
  return { value: hz.toFixed(2), unit: 'Hz' }
}

function fmtAmp(dbm: number | null): string {
  if (dbm == null || !isFinite(dbm)) return '---.--'
  const sign = dbm < 0 ? '-' : ' '
  return sign + Math.abs(dbm).toFixed(2)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SignalGeneratorPanel({
  frequencyHz = null,
  frequencyMhz = null,
  amplitudeDbm = null,
  rfOn = false,
  pulseOn = false,
  label = 'Signal Generator',
  sublabel = null,
  ref,
}: SignalGeneratorPanelProps) {
  const hz = frequencyHz != null
    ? frequencyHz
    : (frequencyMhz != null ? frequencyMhz * 1e6 : null)

  const deferredHz = useDeferredValue(hz)
  const deferredAmp = useDeferredValue(amplitudeDbm)

  const freq = useMemo(() => scaleFrequency(deferredHz), [deferredHz])
  const amp = useMemo(() => fmtAmp(deferredAmp), [deferredAmp])

  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border-2 bg-[#e5e7eb] p-[6px] shadow-md select-none',
      )}
      style={{
        borderColor: '#d1d5db',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7), 0 2px 6px rgba(0,0,0,0.15)',
      }}
    >
      <div className="rounded-md overflow-hidden" style={{ backgroundColor: '#1a1814' }}>
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-1.5"
          style={{ backgroundColor: '#252220' }}
        >
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: '#a8a29e' }}>
              {label}
            </span>
            {sublabel && (
              <span className="text-[9px] font-mono" style={{ color: '#78716c' }}>
                {sublabel}
              </span>
            )}
          </div>
          {/* Annunciators */}
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-bold tracking-wider rounded px-1.5 py-[1px]"
              style={{
                color: rfOn ? '#fef3c7' : '#3f3a35',
                backgroundColor: rfOn ? '#b91c1c' : '#1a1814',
                border: `1px solid ${rfOn ? '#dc2626' : '#3f3a35'}`,
              }}
            >
              RF
            </span>
            <span
              className="text-[9px] font-bold tracking-wider rounded px-1.5 py-[1px]"
              style={{
                color: pulseOn ? '#fef3c7' : '#3f3a35',
                backgroundColor: pulseOn ? '#a16207' : '#1a1814',
                border: `1px solid ${pulseOn ? '#ca8a04' : '#3f3a35'}`,
              }}
            >
              PULSE
            </span>
          </div>
        </div>

        {/* Frequency readout */}
        <div className="px-4 py-3 flex items-baseline justify-between" style={{ backgroundColor: '#0d0c0a' }}>
          <span className="text-[9px] font-semibold tracking-wider uppercase" style={{ color: '#78716c' }}>
            Freq
          </span>
          <Readout text={freq.value} />
          <span className="text-[10px] font-mono ml-2" style={{ color: '#a8a29e', minWidth: 28 }}>
            {freq.unit}
          </span>
        </div>

        {/* Amplitude readout */}
        <div
          className="px-4 py-3 flex items-baseline justify-between border-t"
          style={{ backgroundColor: '#0d0c0a', borderColor: '#252220' }}
        >
          <span className="text-[9px] font-semibold tracking-wider uppercase" style={{ color: '#78716c' }}>
            Ampl
          </span>
          <Readout text={amp} />
          <span className="text-[10px] font-mono ml-2" style={{ color: '#a8a29e', minWidth: 28 }}>
            dBm
          </span>
        </div>
      </div>
    </div>
  )
}

export default SignalGeneratorPanel

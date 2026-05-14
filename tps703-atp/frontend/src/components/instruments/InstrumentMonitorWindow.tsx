import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import PowerMeterPanel from '@/components/instruments/PowerMeterPanel'
import SpectrumAnalyzerPanel from '@/components/instruments/SpectrumAnalyzerPanel'
import OscilloscopePanel from '@/components/instruments/OscilloscopePanel'
import MultimeterPanel from '@/components/instruments/MultimeterPanel'
import PhaseMeterPanel from '@/components/instruments/PhaseMeterPanel'
import NetworkAnalyzerPanel from '@/components/instruments/NetworkAnalyzerPanel'
import FFTDisplayPanel from '@/components/instruments/FFTDisplayPanel'
import CommonBusPanel, { type BusTransaction } from '@/components/instruments/CommonBusPanel'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InstrumentMonitorWindowProps {
  open: boolean
  onClose: () => void
  instrumentValue: number | null
  currentStep: {
    instrument: string | null
    measured_value: number | null
    unit: string | null
    frequency_mhz: number | null
    input_power_dbm: number | null
    step_type: string
    name: string
    limit_min: number | null
    limit_max: number | null
    limit_nominal: number | null
    limit_tolerance: number | null
    limit_type: string | null
    bus_address: string | null
    bus_data: string | null
  } | null
  busTransactions: BusTransaction[]
  lightMode?: boolean
  onToggleLightMode?: () => void
}

// ---------------------------------------------------------------------------
// Instrument definitions
// ---------------------------------------------------------------------------

type InstrumentKey =
  | 'power_meter'
  | 'spectrum_analyzer'
  | 'oscilloscope'
  | 'multimeter'
  | 'phase_meter'
  | 'network_analyzer'
  | 'fft_display'
  | 'common_bus'

interface InstrumentDef {
  key: InstrumentKey
  label: string
}

const INSTRUMENTS: InstrumentDef[] = [
  { key: 'power_meter', label: 'Power Meter' },
  { key: 'spectrum_analyzer', label: 'Spectrum Analyzer' },
  { key: 'oscilloscope', label: 'Oscilloscope' },
  { key: 'multimeter', label: 'Digital Multimeter' },
  { key: 'phase_meter', label: 'Phase Meter' },
  { key: 'network_analyzer', label: 'Network Analyzer' },
  { key: 'fft_display', label: 'FFT Display' },
  { key: 'common_bus', label: 'Common Bus Monitor' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InstrumentMonitorWindow({
  open,
  onClose,
  instrumentValue,
  currentStep,
  busTransactions,
  lightMode,
  onToggleLightMode,
}: InstrumentMonitorWindowProps) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Prevent body scroll when overlay is open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  const activeInstrument = currentStep?.instrument ?? null

  function valueFor(key: InstrumentKey): number | null {
    return activeInstrument === key ? instrumentValue : null
  }

  function renderPanel(key: InstrumentKey) {
    const val = valueFor(key)

    switch (key) {
      case 'power_meter':
        return (
          <PowerMeterPanel
            value={val}
            unit={activeInstrument === key ? (currentStep?.unit ?? 'dBm') : 'dBm'}
            limitMin={activeInstrument === key ? currentStep?.limit_min : null}
            limitMax={activeInstrument === key ? currentStep?.limit_max : null}
            frequency={activeInstrument === key ? currentStep?.frequency_mhz : null}
            label={activeInstrument === key ? currentStep?.name : undefined}
          />
        )
      case 'spectrum_analyzer':
        return (
          <SpectrumAnalyzerPanel
            value={val}
            frequency={activeInstrument === key ? currentStep?.frequency_mhz : null}
            label={activeInstrument === key ? currentStep?.name : undefined}
          />
        )
      case 'oscilloscope':
        return (
          <OscilloscopePanel
            value={val}
            unit={activeInstrument === key ? (currentStep?.unit ?? 'V') : 'V'}
            stepType={activeInstrument === key ? currentStep?.step_type : undefined}
            limitNominal={activeInstrument === key ? currentStep?.limit_nominal : null}
            limitTolerance={activeInstrument === key ? currentStep?.limit_tolerance : null}
            limitMin={activeInstrument === key ? currentStep?.limit_min : null}
            limitMax={activeInstrument === key ? currentStep?.limit_max : null}
            label={activeInstrument === key ? currentStep?.name : undefined}
          />
        )
      case 'multimeter':
        return (
          <MultimeterPanel
            value={val}
            unit={activeInstrument === key ? (currentStep?.unit ?? 'V') : 'V'}
            mode={
              activeInstrument === key
                ? currentStep?.step_type === 'resistance'
                  ? 'resistance'
                  : currentStep?.step_type === 'current' || currentStep?.step_type === 'input_current'
                    ? 'current'
                    : 'voltage'
                : 'voltage'
            }
            limitMin={activeInstrument === key ? currentStep?.limit_min : null}
            limitMax={activeInstrument === key ? currentStep?.limit_max : null}
            limitNominal={activeInstrument === key ? currentStep?.limit_nominal : null}
            limitTolerance={activeInstrument === key ? currentStep?.limit_tolerance : null}
            limitType={activeInstrument === key ? currentStep?.limit_type : null}
            label={activeInstrument === key ? currentStep?.name : undefined}
          />
        )
      case 'phase_meter':
        return (
          <PhaseMeterPanel
            value={val}
            unit={activeInstrument === key ? (currentStep?.unit ?? 'deg') : 'deg'}
            frequency={activeInstrument === key ? currentStep?.frequency_mhz : null}
            limitNominal={activeInstrument === key ? currentStep?.limit_nominal : null}
            limitTolerance={activeInstrument === key ? currentStep?.limit_tolerance : null}
            label={activeInstrument === key ? currentStep?.name : undefined}
          />
        )
      case 'network_analyzer':
        return (
          <NetworkAnalyzerPanel
            value={val}
            frequency={activeInstrument === key ? currentStep?.frequency_mhz : null}
            limitMax={activeInstrument === key ? currentStep?.limit_max : null}
            label={activeInstrument === key ? currentStep?.name : undefined}
          />
        )
      case 'fft_display':
        return (
          <FFTDisplayPanel
            value={val}
            stepType={activeInstrument === key ? currentStep?.step_type : undefined}
            unit={activeInstrument === key ? (currentStep?.unit ?? 'dBSat') : 'dBSat'}
            limitMin={activeInstrument === key ? currentStep?.limit_min : null}
            limitMax={activeInstrument === key ? currentStep?.limit_max : null}
            limitNominal={activeInstrument === key ? currentStep?.limit_nominal : null}
            limitTolerance={activeInstrument === key ? currentStep?.limit_tolerance : null}
            label={activeInstrument === key ? currentStep?.name : undefined}
          />
        )
      case 'common_bus':
        return (
          <CommonBusPanel
            transactions={busTransactions}
            label="Common Bus Monitor"
          />
        )
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700" style={{ backgroundColor: '#0d1117' }}>
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-cyan-500 animate-pulse" />
          <h2 className="text-sm font-mono font-bold tracking-widest text-gray-200 uppercase">
            Test Equipment Monitor
          </h2>
          {activeInstrument && (
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded">
              Active: {activeInstrument.replace('_', ' ').toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onToggleLightMode && (
            <button
              type="button"
              onClick={onToggleLightMode}
              className={cn(
                "px-3 py-1 rounded text-xs font-medium transition-colors",
                lightMode ? "bg-amber-100 text-amber-800" : "bg-gray-700 text-gray-200 hover:bg-gray-600"
              )}
            >
              {lightMode ? '\u2600 Light' : '\uD83C\uDF19 Dark'}
            </button>
          )}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center w-8 h-8 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          aria-label="Close test equipment monitor"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        </div>
      </div>

      {/* Test equipment grid */}
      <div className={cn("flex-1 grid grid-cols-2 xl:grid-cols-3 gap-3 p-4 overflow-y-auto", lightMode && 'instrument-light-mode')}>
        {INSTRUMENTS.map(({ key, label }) => {
          const isActive = activeInstrument === key
          return (
            <div
              key={key}
              className={cn(
                'rounded-lg overflow-hidden',
                isActive ? 'ring-2 ring-cyan-500' : 'opacity-70'
              )}
            >
              <div
                className="flex items-center justify-between px-2 py-1"
                style={{ backgroundColor: '#1a1e30' }}
              >
                <span className="text-[10px] font-mono font-bold text-gray-300 uppercase tracking-wider">
                  {label}
                </span>
                {isActive && (
                  <span className="text-[9px] font-mono text-cyan-400 animate-pulse">
                    ACTIVE
                  </span>
                )}
              </div>
              {renderPanel(key)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

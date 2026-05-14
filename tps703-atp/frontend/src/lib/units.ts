// SI-prefix auto-scaling for instrument readings.
//
// formatSiValue(value, baseUnit, decimals?) picks the prefix that puts the
// magnitude in [1, 1000) and returns { display, unit } so callers can show a
// readable string like "928.4528 µV" instead of "+9.28452662E-13 V".
//
// Only base units that have a natural metric scaling are rescaled. Units that
// are intrinsically logarithmic ("dBm") or angular ("°", "deg") and any unit
// not on the allow-list pass through unchanged.

interface SiPrefix {
  symbol: string
  factor: number
}

// Ordered from largest to smallest factor so the first match wins.
const SI_PREFIXES: SiPrefix[] = [
  { symbol: 'T', factor: 1e12 },
  { symbol: 'G', factor: 1e9 },
  { symbol: 'M', factor: 1e6 },
  { symbol: 'k', factor: 1e3 },
  { symbol: '', factor: 1 },
  { symbol: 'm', factor: 1e-3 },
  { symbol: 'µ', factor: 1e-6 },
  { symbol: 'n', factor: 1e-9 },
  { symbol: 'p', factor: 1e-12 },
  { symbol: 'f', factor: 1e-15 },
]

const SCALABLE_UNITS = new Set(['V', 'A', 'Hz', 'W', 's', 'Ω', 'ohm', 'ohms'])

function normalizeBaseUnit(baseUnit: string): string {
  if (baseUnit === 'ohm' || baseUnit === 'ohms') return 'Ω'
  return baseUnit
}

function isScalable(baseUnit: string): boolean {
  return SCALABLE_UNITS.has(baseUnit)
}

export interface FormattedSiValue {
  display: string
  unit: string
}

export function formatSiValue(
  value: number,
  baseUnit: string,
  decimals = 4,
): FormattedSiValue {
  const normalised = normalizeBaseUnit(baseUnit)

  if (!Number.isFinite(value)) {
    return { display: '--', unit: normalised }
  }

  if (value === 0) {
    return { display: (0).toFixed(decimals), unit: normalised }
  }

  if (!isScalable(baseUnit)) {
    return { display: value.toFixed(decimals), unit: normalised }
  }

  const sign = value < 0 ? -1 : 1
  const magnitude = Math.abs(value)

  let chosen = SI_PREFIXES[SI_PREFIXES.length - 1]
  for (const prefix of SI_PREFIXES) {
    if (magnitude >= prefix.factor) {
      chosen = prefix
      break
    }
  }

  const scaled = (sign * magnitude) / chosen.factor
  return {
    display: scaled.toFixed(decimals),
    unit: `${chosen.symbol}${normalised}`,
  }
}

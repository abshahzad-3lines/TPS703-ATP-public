import { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface ParameterInputProps {
  label: string
  name: string
  value: number | string
  onChange: (value: number) => void
  unit?: string
  limitMin?: number | null
  limitMax?: number | null
  limitNominal?: number | null
  limitTolerance?: number | null
  limitType?: 'min' | 'max' | 'range' | 'nominal' | null
  step?: number
  disabled?: boolean
  readOnly?: boolean
}

export default function ParameterInput({
  label,
  name,
  value,
  onChange,
  unit,
  limitMin,
  limitMax,
  limitNominal,
  limitTolerance,
  limitType,
  step = 0.01,
  disabled = false,
  readOnly = false,
}: ParameterInputProps) {
  const numericValue = typeof value === 'string' ? parseFloat(value) : value

  const validation = useMemo(() => {
    if (isNaN(numericValue) || limitType == null) return null

    if (limitType === 'min' && limitMin != null) {
      return numericValue >= limitMin ? 'valid' : 'invalid'
    }
    if (limitType === 'max' && limitMax != null) {
      return numericValue <= limitMax ? 'valid' : 'invalid'
    }
    if (limitType === 'range' && limitMin != null && limitMax != null) {
      return numericValue >= limitMin && numericValue <= limitMax ? 'valid' : 'invalid'
    }
    if (limitType === 'nominal' && limitNominal != null && limitTolerance != null) {
      return Math.abs(numericValue - limitNominal) <= limitTolerance ? 'valid' : 'invalid'
    }
    return null
  }, [numericValue, limitType, limitMin, limitMax, limitNominal, limitTolerance])

  // Compute effective min/max for the limit bar
  const effectiveMin = limitType === 'nominal' && limitNominal != null && limitTolerance != null
    ? limitNominal - limitTolerance * 2
    : limitMin != null ? limitMin - Math.abs(limitMin) * 0.2 : 0
  const effectiveMax = limitType === 'nominal' && limitNominal != null && limitTolerance != null
    ? limitNominal + limitTolerance * 2
    : limitMax != null ? limitMax + Math.abs(limitMax) * 0.2 : 100

  const range = effectiveMax - effectiveMin || 1
  const greenStart = limitType === 'nominal' && limitNominal != null && limitTolerance != null
    ? ((limitNominal - limitTolerance - effectiveMin) / range) * 100
    : limitMin != null ? ((limitMin - effectiveMin) / range) * 100 : 0
  const greenEnd = limitType === 'nominal' && limitNominal != null && limitTolerance != null
    ? ((limitNominal + limitTolerance - effectiveMin) / range) * 100
    : limitMax != null ? ((limitMax - effectiveMin) / range) * 100 : 100
  const markerPos = !isNaN(numericValue) ? Math.max(0, Math.min(100, ((numericValue - effectiveMin) / range) * 100)) : null

  const warningMessage = useMemo(() => {
    if (validation !== 'invalid' || isNaN(numericValue)) return null
    if (limitType === 'min' && limitMin != null) return `Value ${numericValue} is below minimum ${limitMin} ${unit ?? ''}`
    if (limitType === 'max' && limitMax != null) return `Value ${numericValue} exceeds maximum ${limitMax} ${unit ?? ''}`
    if (limitType === 'range' && limitMin != null && limitMax != null) return `Value ${numericValue} is outside range ${limitMin}–${limitMax} ${unit ?? ''}`
    if (limitType === 'nominal' && limitNominal != null && limitTolerance != null) return `Value ${numericValue} is outside ${limitNominal} ± ${limitTolerance} ${unit ?? ''}`
    return null
  }, [validation, numericValue, limitType, limitMin, limitMax, limitNominal, limitTolerance, unit])

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={name}
          name={name}
          type="number"
          step={step}
          value={value}
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v)) onChange(v)
          }}
          disabled={disabled}
          readOnly={readOnly}
          className={cn(
            'font-mono',
            validation === 'valid' && 'border-emerald-500 focus-visible:ring-emerald-500',
            validation === 'invalid' && 'border-red-500 focus-visible:ring-red-500',
          )}
        />
        {unit && <span className="text-sm text-muted-foreground whitespace-nowrap">{unit}</span>}
      </div>

      {/* Limit bar */}
      {limitType && (
        <div className="relative h-2 rounded-full bg-red-100 overflow-hidden">
          <div
            className="absolute top-0 h-full bg-emerald-200 rounded-full"
            style={{
              left: `${Math.max(0, greenStart)}%`,
              width: `${Math.min(100, greenEnd) - Math.max(0, greenStart)}%`,
            }}
          />
          {markerPos !== null && (
            <div
              className={cn(
                'absolute top-0 h-full w-0.5',
                validation === 'invalid' ? 'bg-red-600' : 'bg-emerald-700',
              )}
              style={{ left: `${markerPos}%` }}
            />
          )}
        </div>
      )}

      {warningMessage && (
        <p className="text-xs text-red-600">{warningMessage}</p>
      )}
    </div>
  )
}

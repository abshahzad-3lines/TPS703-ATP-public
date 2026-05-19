import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { paramColor } from '@/lib/sparam'

interface Series {
  name: string
  values: number[]
  color?: string
}

interface MaskBand {
  f_start_hz: number
  f_stop_hz: number
  min?: number | null
  max?: number | null
}

export default function SparamLineChart({
  freq_hz,
  series,
  yLabel,
  height = 320,
  maskBands,
}: {
  freq_hz: number[]
  series: Series[]
  yLabel: string
  height?: number
  maskBands?: MaskBand[]
}) {
  if (freq_hz.length === 0) return null
  // Recharts wants an array of row objects keyed by series name.
  const rows = freq_hz.map((f, i) => {
    const obj: Record<string, number> = { f_ghz: f / 1e9 }
    for (const s of series) {
      const v = s.values[i]
      if (Number.isFinite(v)) obj[s.name] = v
    }
    return obj
  })

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="f_ghz" tick={{ fontSize: 11 }}
          label={{ value: 'Frequency (GHz)', position: 'insideBottom', offset: -5, style: { fontSize: 11 } }} />
        <YAxis tick={{ fontSize: 11 }}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
        <Tooltip
          contentStyle={{ fontSize: 11, padding: '4px 8px' }}
          formatter={(v: number) => (typeof v === 'number' ? v.toFixed(2) : v)}
          labelFormatter={(v: number) => `${typeof v === 'number' ? v.toFixed(3) : v} GHz`}
        />
        {maskBands?.map((b, idx) => (
          <ReferenceArea
            key={idx}
            x1={b.f_start_hz / 1e9}
            x2={b.f_stop_hz / 1e9}
            y1={b.min ?? undefined}
            y2={b.max ?? undefined}
            fill="#fef3c7"
            stroke="#f59e0b"
            strokeOpacity={0.4}
            fillOpacity={0.25}
          />
        ))}
        {series.map(s => (
          <Line key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color ?? paramColor(s.name)}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

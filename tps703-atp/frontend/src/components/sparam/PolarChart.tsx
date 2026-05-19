import { useEffect, useRef } from 'react'
import { paramColor } from '@/lib/sparam'

interface Trace {
  name: string
  mag: number[]      // |S| (0..1 for typical reflection/transmission)
  phase_rad: number[]
  color?: string
}

export default function PolarChart({
  traces, size = 360, maxMag,
}: { traces: Trace[]; size?: number; maxMag?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    draw(ctx, size, traces, maxMag)
  }, [size, traces, maxMag])

  return <canvas ref={ref} className="bg-white rounded border" />
}

function draw(
  ctx: CanvasRenderingContext2D,
  size: number,
  traces: Trace[],
  maxMagProp?: number,
) {
  const cx = size / 2
  const cy = size / 2
  const r = (size - 40) / 2

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  // Auto-scale
  let maxMag = maxMagProp
  if (maxMag == null) {
    let m = 0
    for (const t of traces) for (const v of t.mag) if (v > m) m = v
    maxMag = m > 0 ? m * 1.05 : 1
  }

  // Concentric circles
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 1
  for (let frac = 0.25; frac <= 1.0; frac += 0.25) {
    ctx.beginPath()
    ctx.arc(cx, cy, r * frac, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Spokes every 30°
  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg * Math.PI) / 180
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(rad) * r, cy - Math.sin(rad) * r)
    ctx.stroke()
  }

  // Angle labels
  ctx.fillStyle = '#475569'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg * Math.PI) / 180
    const x = cx + Math.cos(rad) * (r + 14)
    const y = cy - Math.sin(rad) * (r + 14) + 4
    ctx.fillText(`${deg}°`, x, y)
  }

  // Traces
  for (const t of traces) {
    ctx.strokeStyle = t.color ?? paramColor(t.name)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i < t.mag.length; i++) {
      const rho = (t.mag[i] / maxMag) * r
      const phi = t.phase_rad[i]
      const x = cx + Math.cos(phi) * rho
      const y = cy - Math.sin(phi) * rho
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

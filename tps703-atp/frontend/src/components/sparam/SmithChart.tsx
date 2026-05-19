import { useEffect, useRef } from 'react'
import { paramColor } from '@/lib/sparam'

interface Trace {
  name: string
  real: number[]
  imag: number[]
  color?: string
}

export default function SmithChart({
  traces,
  size = 480,
}: {
  traces: Trace[]
  size?: number
}) {
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
    drawSmith(ctx, size, traces)
  }, [size, traces])

  return <canvas ref={ref} className="bg-white rounded border" />
}

function drawSmith(ctx: CanvasRenderingContext2D, size: number, traces: Trace[]) {
  const cx = size / 2
  const cy = size / 2
  const r = (size - 30) / 2

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  // ---- Grid ----
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 1

  // Outer circle (|Γ|=1)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  // Resistance circles — normalized resistance r ∈ {0.2, 0.5, 1, 2, 5}
  // Each becomes a circle in Γ-plane centered at (r/(r+1), 0) with radius 1/(r+1)
  for (const rNorm of [0.2, 0.5, 1, 2, 5]) {
    const center = rNorm / (rNorm + 1)
    const radius = 1 / (rNorm + 1)
    ctx.beginPath()
    ctx.arc(cx + center * r, cy, radius * r, 0, Math.PI * 2)
    ctx.strokeStyle = rNorm === 1 ? '#94a3b8' : '#e2e8f0'
    ctx.stroke()
  }

  // Reactance arcs — normalized reactance x ∈ {±0.2, ±0.5, ±1, ±2, ±5}
  // Centered at (1, 1/x) with radius |1/x|, clipped to the |Γ|=1 disk
  for (const xNorm of [0.2, 0.5, 1, 2, 5]) {
    for (const sign of [+1, -1] as const) {
      const yc = sign / xNorm
      const radius = 1 / Math.abs(xNorm)
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx + r, cy - yc * r, radius * r, 0, Math.PI * 2)
      // Clip to outer circle
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()
      ctx.beginPath()
      ctx.arc(cx + r, cy - yc * r, radius * r, 0, Math.PI * 2)
      ctx.strokeStyle = xNorm === 1 ? '#94a3b8' : '#e2e8f0'
      ctx.stroke()
      ctx.restore()
      ctx.restore()
    }
  }

  // Real axis
  ctx.strokeStyle = '#94a3b8'
  ctx.beginPath()
  ctx.moveTo(cx - r, cy)
  ctx.lineTo(cx + r, cy)
  ctx.stroke()

  // Labels
  ctx.fillStyle = '#475569'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('0', cx - r + 4, cy + 12)
  ctx.fillText('1', cx + r - 4, cy + 12)
  ctx.fillText('∞', cx + r + 8, cy + 4)

  // ---- Traces ----
  for (const t of traces) {
    ctx.strokeStyle = t.color ?? paramColor(t.name)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i < t.real.length; i++) {
      const gx = cx + t.real[i] * r
      const gy = cy - t.imag[i] * r
      if (i === 0) ctx.moveTo(gx, gy)
      else ctx.lineTo(gx, gy)
    }
    ctx.stroke()

    // End-point markers (start = circle, end = square)
    if (t.real.length > 0) {
      const sx = cx + t.real[0] * r
      const sy = cy - t.imag[0] * r
      ctx.fillStyle = t.color ?? paramColor(t.name)
      ctx.beginPath()
      ctx.arc(sx, sy, 3, 0, Math.PI * 2)
      ctx.fill()

      const ex = cx + t.real[t.real.length - 1] * r
      const ey = cy - t.imag[t.imag.length - 1] * r
      ctx.fillRect(ex - 3, ey - 3, 6, 6)
    }
  }
}

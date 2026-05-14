/**
 * useEquipmentLiveReading — open `/ws/equipment/{id}` for a registered
 * instrument, send `start_stream` with a step_type appropriate for the panel,
 * and expose the latest reading.
 *
 * The hook is intentionally thin: it does not configure the meter via SCPI —
 * the driver's `_measure_*` handlers (e.g. `_measure_mux_voltage`,
 * `_measure_sg_status`, `_measure_pmeter_dual`) take care of any
 * `CONF:VOLT:DC` / `INIT:CONT ON` setup on the first read. Switching the
 * step_type re-opens the stream so the driver can re-CONFigure.
 *
 * No fake instruments and no synthesised values — when the connection is
 * down or no reading has arrived yet, every output is `null`.
 */

import { useEffect, useRef, useState } from 'react'

export interface LiveReading {
  /** Latest primary value (e.g. DMM voltage, SG frequency in Hz, PM Ch A dBm). */
  value: number | null
  /** Optional secondary value (e.g. SG amplitude in dBm, PM Ch B). */
  secondaryValue: number | null
  /** Driver-supplied raw payload (e.g. `"FREQ_HZ|POW_DBM|OUTP"` for `sg_status`). */
  rawData: string | null
  /** WebSocket connected and stream running. */
  connected: boolean
  /** Last error text from the server (or local socket failure). */
  error: string | null
}

interface UseEquipmentLiveReadingArgs {
  /** Equipment id, or null to disable. */
  equipmentId: number | null
  /** Whether the stream is enabled. Disable when the panel is hidden or in live test mode. */
  enabled: boolean
  /** Driver-side step_type to start streaming. Changing this restarts the stream. */
  stepType: string
  /** Stream interval in ms (default 500). */
  intervalMs?: number
  /** Optional driver params forwarded to `start_stream`. */
  params?: Record<string, unknown>
}

function buildBenchWsUrl(equipmentId: number): string {
  const apiUrl = (import.meta as { env: Record<string, string | undefined> }).env.VITE_API_URL
  let base: string
  if (apiUrl) {
    base = apiUrl.replace(/^http/, 'ws')
  } else if (import.meta.env.DEV) {
    base = `ws://${window.location.hostname}:8005`
  } else {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    base = `${wsProtocol}//${window.location.host}`
  }
  return `${base}/ws/equipment/${equipmentId}`
}

export function useEquipmentLiveReading({
  equipmentId,
  enabled,
  stepType,
  intervalMs = 500,
  params,
}: UseEquipmentLiveReadingArgs): LiveReading {
  const [value, setValue] = useState<number | null>(null)
  const [secondaryValue, setSecondaryValue] = useState<number | null>(null)
  const [rawData, setRawData] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Snapshot params for the effect — JSON.stringify so the dependency is stable
  const paramsKey = params ? JSON.stringify(params) : ''
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!enabled || !equipmentId || !stepType) {
      setValue(null); setSecondaryValue(null); setRawData(null)
      setConnected(false); setError(null)
      return
    }

    const ws = new WebSocket(buildBenchWsUrl(equipmentId))
    wsRef.current = ws

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({
          type: 'start_stream',
          step_type: stepType,
          params: params || {},
          interval_ms: intervalMs,
          include_simulator: false,
        }))
      } catch (err) {
        setError(`Failed to start stream: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    ws.onmessage = (ev) => {
      let msg: { type?: string; value?: number | null; secondary_value?: number | null; raw_data?: string | null; running?: boolean; message?: string }
      try { msg = JSON.parse(ev.data) } catch { return }

      switch (msg.type) {
        case 'reading':
          setValue(msg.value ?? null)
          setSecondaryValue(msg.secondary_value ?? null)
          setRawData(msg.raw_data ?? null)
          setError(null)
          break
        case 'stream_state':
          setConnected(!!msg.running)
          break
        case 'error':
          setError(msg.message ?? 'Stream error')
          break
      }
    }

    ws.onerror = () => {
      setError('WebSocket error')
      setConnected(false)
    }

    ws.onclose = () => {
      setConnected(false)
    }

    return () => {
      try { ws.send(JSON.stringify({ type: 'stop_stream' })) } catch { /* noop */ }
      try { ws.close() } catch { /* noop */ }
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, equipmentId, stepType, intervalMs, paramsKey])

  return { value, secondaryValue, rawData, connected, error }
}

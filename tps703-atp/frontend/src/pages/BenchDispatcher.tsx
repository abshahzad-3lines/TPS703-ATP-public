/**
 * BenchDispatcher — entry point for /instrument-bench/:equipmentId?
 *
 * Looks up the selected equipment's `instrument_role` and renders the
 * matching bench page (DMM, Power Meter, or Signal Generator). Without an
 * equipment ID it shows a role-grouped picker so the operator can choose
 * which instrument they want to bench.
 *
 * Each child bench page is self-contained — it loads its own equipment
 * list filtered to its role — so this component is purely for dispatch.
 *
 * No fake instruments and no synthesised values.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Activity, Loader2, Plug, Radio, Zap } from 'lucide-react'

import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import InstrumentBenchPage from '@/pages/InstrumentBenchPage'
import PowerMeterBenchPage from '@/pages/PowerMeterBenchPage'
import SignalGeneratorBenchPage from '@/pages/SignalGeneratorBenchPage'

interface Equipment {
  id: number
  name: string
  model: string | null
  manufacturer: string | null
  serial_number: string | null
  connection_type: string | null
  connection_address: string | null
  is_active: number
  instrument_role: string | null
}

const ROLE_META: Record<string, { label: string; icon: typeof Activity; description: string }> = {
  multimeter: {
    label: 'Multimeter',
    icon: Activity,
    description: 'Function / range / NPLC / stats / trend / raw SCPI',
  },
  power_meter: {
    label: 'Power Meter',
    icon: Zap,
    description: 'Dual channel, units, averaging, offsets, math, zero/cal',
  },
  signal_generator: {
    label: 'Signal Generator',
    icon: Radio,
    description: 'Frequency / amplitude / RF on / AM / FM / ΦM / Pulse / Sweep',
  },
}

export default function BenchDispatcher() {
  const { equipmentId } = useParams<{ equipmentId?: string }>()
  const navigate = useNavigate()

  const [equipmentList, setEquipmentList] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.get<Equipment[]>('/equipment?is_active=1')
      .then((data) => { setEquipmentList(data); setLoadError(null) })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load equipment'))
      .finally(() => setLoading(false))
  }, [])

  // When an equipmentId is in the URL, dispatch to the role-specific bench.
  const selectedRole = useMemo(() => {
    if (!equipmentId) return null
    const eq = equipmentList.find((e) => e.id === Number(equipmentId))
    return eq?.instrument_role ?? null
  }, [equipmentId, equipmentList])

  if (equipmentId) {
    if (loading) {
      return (
        <Card><CardContent className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading instrument…
        </CardContent></Card>
      )
    }

    switch (selectedRole) {
      case 'power_meter':      return <PowerMeterBenchPage />
      case 'signal_generator': return <SignalGeneratorBenchPage />
      case 'multimeter':       return <InstrumentBenchPage />
      default:
        // Unknown / unsupported role — fall back to DMM bench so raw SCPI is
        // still available, but show a small banner.
        return (
          <div className="space-y-3">
            <Alert>
              <AlertTitle>No dedicated bench for this instrument role</AlertTitle>
              <AlertDescription>
                Falling back to the multimeter bench. The raw SCPI box still works for any registered instrument.
              </AlertDescription>
            </Alert>
            <InstrumentBenchPage />
          </div>
        )
    }
  }

  // No equipment ID in the URL — render a picker grouped by role.
  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <title>Instrument Bench - TPS-703 ATP</title>

      <div className="flex items-center gap-3">
        <Activity className="h-7 w-7 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Instrument Bench</h1>
          <p className="text-sm text-muted-foreground">
            Pick a registered instrument — each role has a dedicated bench page.
          </p>
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Failed to load equipment</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <Card><CardContent className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading equipment…
        </CardContent></Card>
      )}

      {!loading && !loadError && equipmentList.length === 0 && (
        <Alert>
          <Plug className="h-4 w-4" />
          <AlertTitle>No active instruments registered</AlertTitle>
          <AlertDescription>
            Register an instrument on the <strong>Test Equipment</strong> page first.
          </AlertDescription>
        </Alert>
      )}

      {!loading && equipmentList.length > 0 && (
        <div className="space-y-4">
          {Object.entries(ROLE_META).map(([role, meta]) => {
            const items = equipmentList.filter((e) => e.instrument_role === role)
            if (items.length === 0) return null
            const Icon = meta.icon
            return (
              <Card key={role}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icon className="h-5 w-5 text-blue-600" />
                    {meta.label}
                  </CardTitle>
                  <CardDescription>{meta.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {items.map((eq) => (
                      <Button
                        key={eq.id}
                        variant="outline"
                        onClick={() => navigate(`/instrument-bench/${eq.id}`)}
                        className="justify-start h-auto py-3"
                      >
                        <div className="flex flex-col items-start text-left">
                          <span className="font-medium">{eq.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {[eq.model, eq.connection_address].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {/* Instruments without a recognised role */}
          {(() => {
            const others = equipmentList.filter(
              (e) => !e.instrument_role || !ROLE_META[e.instrument_role],
            )
            if (others.length === 0) return null
            return (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Other instruments</CardTitle>
                  <CardDescription>No dedicated bench — opens the multimeter bench with raw SCPI</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {others.map((eq) => (
                      <Button
                        key={eq.id}
                        variant="outline"
                        onClick={() => navigate(`/instrument-bench/${eq.id}`)}
                        className="justify-start h-auto py-3"
                      >
                        <div className="flex flex-col items-start text-left">
                          <span className="font-medium">{eq.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {[eq.model, eq.connection_address].filter(Boolean).join(' · ')}
                            {eq.instrument_role ? ` · role: ${eq.instrument_role}` : ' · no role'}
                          </span>
                        </div>
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })()}
        </div>
      )}
    </div>
  )
}

import { useActionState, useEffect, useOptimistic, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SubmitButton } from '@/components/layout/SubmitButton'
import { api } from '@/lib/api'

interface UUT {
  id: number
  subsystem_id: number
  serial_number: string
  part_number?: string
  status: string
  created_at: string
  subsystem_name?: string
  drawing_no?: string
}

const SUBSYSTEMS = [
  { id: 1, name: 'Power Module Assembly', drawing_no: '110K245' },
  { id: 2, name: 'Preamplifier Panel Assembly', drawing_no: '110K244' },
  { id: 3, name: 'RF Output Panel Assembly', drawing_no: '110K243' },
  { id: 4, name: 'Digital IF Receiver Assembly', drawing_no: 'IF_RECVR' },
] as const

function getSubsystemLabel(id: number): string {
  const sub = SUBSYSTEMS.find((s) => s.id === id)
  return sub ? `${sub.drawing_no} - ${sub.name}` : `Subsystem ${id}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function UUTRegistrationForm() {
  const [uuts, setUUTs] = useState<UUT[]>([])
  const [selectedSubsystem, setSelectedSubsystem] = useState<number | null>(null)

  const [optimisticUUTs, addOptimisticUUT] = useOptimistic(
    uuts,
    (currentUUTs: UUT[], newUUT: UUT) => [...currentUUTs, { ...newUUT, status: 'saving' }]
  )

  useEffect(() => {
    let cancelled = false
    api
      .get<UUT[]>('/uuts')
      .then((data) => {
        if (!cancelled) setUUTs(data)
      })
      .catch(() => {
        // API not available yet — show empty list
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [error, registerAction] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      const subsystemId = Number(formData.get('subsystem_id'))
      const serialNumber = formData.get('serial_number') as string
      const partNumber = (formData.get('part_number') as string) || undefined

      if (!subsystemId || !serialNumber?.trim()) {
        return 'Subsystem and serial number are required'
      }

      const newUUT: UUT = {
        id: Date.now(),
        subsystem_id: subsystemId,
        serial_number: serialNumber.trim(),
        part_number: partNumber?.trim(),
        status: 'saving',
        created_at: new Date().toISOString(),
        subsystem_name: SUBSYSTEMS.find((s) => s.id === subsystemId)?.name,
        drawing_no: SUBSYSTEMS.find((s) => s.id === subsystemId)?.drawing_no,
      }

      addOptimisticUUT(newUUT)

      try {
        const created = await api.post<UUT>('/uuts', {
          subsystem_id: subsystemId,
          serial_number: serialNumber.trim(),
          part_number: partNumber?.trim(),
        })
        setUUTs((prev) => [...prev.filter((u) => u.status !== 'saving'), created])
        setSelectedSubsystem(null)
        return null
      } catch (e) {
        setUUTs((prev) => prev.filter((u) => u.status !== 'saving'))
        return e instanceof Error ? e.message : 'Registration failed'
      }
    },
    null
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Register Unit Under Test</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={registerAction} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="subsystem_id" className="text-sm font-medium">
                Subsystem
              </label>
              <Select
                name="subsystem_id"
                value={selectedSubsystem ?? undefined}
                onValueChange={(val) => setSelectedSubsystem(val)}
                required
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a subsystem" />
                </SelectTrigger>
                <SelectContent>
                  {SUBSYSTEMS.map((sub) => (
                    <SelectItem key={sub.id} value={sub.id}>
                      {sub.drawing_no} &mdash; {sub.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="serial_number" className="text-sm font-medium">
                Serial Number
              </label>
              <Input
                id="serial_number"
                name="serial_number"
                placeholder="e.g., SN-2024-001"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="part_number" className="text-sm font-medium">
                Part Number{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                id="part_number"
                name="part_number"
                placeholder="e.g., 100K517"
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <SubmitButton>Register UUT</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered Units</CardTitle>
        </CardHeader>
        <CardContent>
          {optimisticUUTs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No units registered yet. Use the form above to register a UUT.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serial Number</TableHead>
                  <TableHead>Subsystem</TableHead>
                  <TableHead>Part Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Registered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {optimisticUUTs.map((uut) => (
                  <TableRow
                    key={uut.id}
                    className={uut.status === 'saving' ? 'opacity-60' : ''}
                  >
                    <TableCell className="font-mono font-medium">
                      {uut.serial_number}
                    </TableCell>
                    <TableCell>{getSubsystemLabel(uut.subsystem_id)}</TableCell>
                    <TableCell>{uut.part_number || '\u2014'}</TableCell>
                    <TableCell>
                      {uut.status === 'saving' ? (
                        <Badge variant="secondary">Saving...</Badge>
                      ) : (
                        <Badge variant="outline">{uut.status || 'Registered'}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(uut.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

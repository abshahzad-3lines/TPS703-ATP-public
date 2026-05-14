import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export interface SubsystemSummary {
  id: number
  drawing_no: string
  name: string
  assembly_no: string
  description: string
  nominal_output_watts: number | null
  procedure_count?: number
  last_test_status?: string | null
  last_test_date?: string | null
}

const statusColors: Record<string, string> = {
  passed: 'bg-emerald-500 text-white',
  failed: 'bg-red-500 text-white',
  warning: 'bg-amber-500 text-white',
  running: 'bg-blue-500 text-white',
  pending: 'bg-slate-500 text-white',
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface ModuleStatusCardProps {
  subsystem: SubsystemSummary
}

export default function ModuleStatusCard({ subsystem }: ModuleStatusCardProps) {
  const status = subsystem.last_test_status?.toLowerCase() ?? null
  const badgeClass = status ? statusColors[status] ?? 'bg-slate-400 text-white' : ''

  return (
    <Card>
      <CardHeader>
        <CardTitle>{subsystem.drawing_no}</CardTitle>
        <CardDescription>{subsystem.name}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Assembly</span>
          <span className="font-medium">{subsystem.assembly_no}</span>
        </div>
        <div className="text-sm text-muted-foreground">{subsystem.description}</div>
        {subsystem.nominal_output_watts != null && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Nominal Output</span>
            <span className="font-medium">{subsystem.nominal_output_watts}W</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Procedures</span>
          <span className="font-medium">{subsystem.procedure_count ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Last Test</span>
          {status ? (
            <Badge className={badgeClass}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground italic">No tests</span>
          )}
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Date</span>
          <span className="font-medium">
            {subsystem.last_test_date ? formatDate(subsystem.last_test_date) : '\u2014'}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

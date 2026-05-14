import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StepStatusBadge } from '@/components/test/StatusBadge'
import { cn } from '@/lib/utils'
import { CheckCircle2, XCircle, AlertCircle, ClipboardList } from 'lucide-react'

interface DataSheetStep {
  step_number: number
  name: string
  step_type: string
  instrument: string | null
  frequency_mhz: number | null
  input_power_dbm: number | null
  unit: string | null
  limit_type: string | null
  limit_min: number | null
  limit_max: number | null
  limit_nominal: number | null
  limit_tolerance: number | null
  measured_value: number | null
  pass_fail: 'pass' | 'fail' | 'warning' | 'running' | 'pending' | null
  is_record_only: boolean
}

interface DataSheetPreviewProps {
  subsystemDrawingNo: string
  subsystemName: string
  procedureCode: string
  procedureName: string
  serialNumber: string
  operatorName: string
  startedAt: string | null
  steps: DataSheetStep[]
  /** Pixel offset for the sticky table header — usually the height of the
   *  Inputs/Outputs sticky panel above the data sheet. Defaults to 0. */
  stickyHeaderTop?: number
}

function formatLimit(step: DataSheetStep): string {
  switch (step.limit_type) {
    case 'min': return `≥ ${step.limit_min}`
    case 'max': return `≤ ${step.limit_max}`
    case 'range': return `${step.limit_min} – ${step.limit_max}`
    case 'nominal': return `${step.limit_nominal} ± ${step.limit_tolerance}`
    case 'exact': return `= ${step.limit_nominal ?? ''}`
    case 'passfail': return 'Record'
    default: return '—'
  }
}

const valueColor: Record<string, string> = {
  pass: 'text-emerald-600 font-bold',
  fail: 'text-red-600 font-bold',
  warning: 'text-amber-600 font-bold',
  running: 'text-blue-500 italic',
  pending: 'text-slate-400 italic',
}

export default function DataSheetPreview({
  subsystemDrawingNo,
  subsystemName,
  procedureCode,
  procedureName,
  serialNumber,
  operatorName,
  startedAt,
  steps,
  stickyHeaderTop = 0,
}: DataSheetPreviewProps) {
  const passed = steps.filter(s => s.pass_fail === 'pass').length
  const failed = steps.filter(s => s.pass_fail === 'fail').length
  const warnings = steps.filter(s => s.pass_fail === 'warning').length
  const pending = steps.filter(s => !s.pass_fail || s.pass_fail === 'pending').length

  return (
    <Card className="flex flex-col flex-1 min-h-0 overflow-visible print:shadow-none print:border">
      {/* Print-only header — kept so PDF/print exports still include the
          drawing / subsystem / procedure / serial / operator / date block.
          On screen this metadata is in TestHeaderStrip so we don't repeat it. */}
      <CardHeader className="hidden print:block pb-3 shrink-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          Acceptance Test Procedure -- Data Sheet
        </CardTitle>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm border rounded-lg p-4 bg-white">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider min-w-[72px]">Drawing</span>
            <span className="font-medium font-mono">{subsystemDrawingNo}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider min-w-[72px]">Subsystem</span>
            <span className="font-medium">{subsystemName}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider min-w-[72px]">Procedure</span>
            <span className="font-medium">{procedureCode} -- {procedureName}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider min-w-[72px]">Serial #</span>
            <span className="font-mono font-medium">{serialNumber}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider min-w-[72px]">Operator</span>
            <span className="font-medium">{operatorName}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider min-w-[72px]">Date</span>
            <span className="font-medium">
              {startedAt ? new Date(startedAt).toLocaleString() : '--'}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col flex-1 min-h-0 gap-4 pt-4">
        <div className="rounded-md border [&_[data-slot=table-container]]:!overflow-visible">
        <Table className="table-fixed">
          <TableHeader
            className="sticky z-10 bg-slate-50 shadow-[0_1px_0_0_theme(colors.border)]"
            style={{ top: stickyHeaderTop }}
          >
            <TableRow className="bg-slate-50">
              <TableHead className="w-12 text-center">Step</TableHead>
              <TableHead className="whitespace-normal">Parameter</TableHead>
              <TableHead className="w-20 text-right">Freq (MHz)</TableHead>
              <TableHead className="w-20 text-right">Input (dBm)</TableHead>
              <TableHead className="w-28 text-right">Limit</TableHead>
              <TableHead className="w-24 text-right">Measured</TableHead>
              <TableHead className="w-14 text-center">Unit</TableHead>
              <TableHead className="w-[72px] text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {steps.map(step => {
              const isRunning = step.pass_fail === 'running'
              return (
                <TableRow
                  key={step.step_number}
                  className={cn(
                    isRunning && 'bg-blue-50',
                    step.pass_fail === 'fail' && 'bg-red-50/40',
                  )}
                >
                  <TableCell className="font-mono text-xs text-center tabular-nums">{step.step_number}</TableCell>
                  <TableCell className="text-sm whitespace-normal">{step.name}</TableCell>
                  <TableCell className="font-mono text-xs text-right tabular-nums text-muted-foreground">
                    {step.frequency_mhz ?? '--'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right tabular-nums text-muted-foreground">
                    {step.input_power_dbm ?? '--'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right tabular-nums">
                    {formatLimit(step)}
                  </TableCell>
                  <TableCell className={cn('font-mono text-sm text-right tabular-nums', valueColor[step.pass_fail ?? 'pending'])}>
                    {step.measured_value != null ? Number(step.measured_value).toFixed(2) : '--'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground text-center">
                    {step.unit ?? ''}
                  </TableCell>
                  <TableCell className="text-center">
                    {step.pass_fail && step.pass_fail !== 'pending' ? (
                      <StepStatusBadge
                        status={step.pass_fail as 'pass' | 'fail' | 'warning' | 'running' | 'pending'}
                        size="sm"
                      />
                    ) : (
                      <span className="text-xs text-slate-400">--</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-5 text-sm border-t pt-3 shrink-0">
          <span className="text-muted-foreground font-medium">
            Total: <span className="text-foreground tabular-nums">{steps.length}</span>
          </span>
          <span className="flex items-center gap-1 text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Passed: <span className="font-semibold tabular-nums">{passed}</span>
          </span>
          <span className="flex items-center gap-1 text-red-600">
            <XCircle className="h-3.5 w-3.5" />
            Failed: <span className="font-semibold tabular-nums">{failed}</span>
          </span>
          <span className="flex items-center gap-1 text-amber-600">
            <AlertCircle className="h-3.5 w-3.5" />
            Warnings: <span className="font-semibold tabular-nums">{warnings}</span>
          </span>
          <span className="text-muted-foreground">
            Pending: <span className="font-medium tabular-nums">{pending}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

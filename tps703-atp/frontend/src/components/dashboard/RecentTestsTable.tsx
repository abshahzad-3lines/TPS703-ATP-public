import { Suspense, use, useMemo } from 'react'
import { api } from '@/lib/api'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

interface TestRun {
  id: number
  subsystem_name: string
  drawing_no: string
  serial_number: string
  procedure_name: string
  status: string
  started_at: string
  operator_name: string
}

const statusStyles: Record<string, string> = {
  passed: 'bg-emerald-500 text-white hover:bg-emerald-500',
  failed: 'bg-red-500 text-white hover:bg-red-500',
  running: 'bg-blue-500 text-white hover:bg-blue-500',
  pending: 'bg-slate-500 text-white hover:bg-slate-500',
  paused: 'bg-amber-500 text-white hover:bg-amber-500',
  aborted: 'bg-red-300 text-white hover:bg-red-300',
}

function fetchRecentTests(): Promise<TestRun[]> {
  return api.get<TestRun[]>('/test-runs/recent').catch(() => [])
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function RecentTestsContent({ promise }: { promise: Promise<TestRun[]> }) {
  const tests = use(promise)

  if (tests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">No recent test runs</p>
        <p className="text-xs mt-1">Test runs will appear here once started</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run ID</TableHead>
          <TableHead>Subsystem</TableHead>
          <TableHead>Serial #</TableHead>
          <TableHead>Procedure</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Operator</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tests.map((test) => (
          <TableRow key={test.id}>
            <TableCell className="font-mono font-medium">
              #{test.id}
            </TableCell>
            <TableCell>
              <div>
                <span className="font-medium">{test.subsystem_name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {test.drawing_no}
                </span>
              </div>
            </TableCell>
            <TableCell className="font-mono">{test.serial_number}</TableCell>
            <TableCell>{test.procedure_name}</TableCell>
            <TableCell>
              <Badge
                className={
                  statusStyles[test.status] ??
                  'bg-slate-400 text-white hover:bg-slate-400'
                }
              >
                {test.status.charAt(0).toUpperCase() + test.status.slice(1)}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(test.started_at)}
            </TableCell>
            <TableCell>{test.operator_name}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function RecentTestsSkeleton() {
  return (
    <div className="space-y-3 p-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-12 animate-pulse rounded bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

export default function RecentTestsTable() {
  const testsPromise = useMemo(() => fetchRecentTests(), [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Test Runs</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<RecentTestsSkeleton />}>
          <RecentTestsContent promise={testsPromise} />
        </Suspense>
      </CardContent>
    </Card>
  )
}

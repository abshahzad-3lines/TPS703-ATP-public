import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export interface BusTransaction {
  rw: 'R' | 'W'
  address: string
  expected: string
  actual: string
  passFail: 'pass' | 'fail'
}

interface CommonBusPanelProps {
  transactions: BusTransaction[]
  label?: string
  ref?: React.Ref<HTMLDivElement>
}

function CommonBusPanel({ transactions, label, ref }: CommonBusPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const totalCount = transactions.length
  const passCount = transactions.filter((t) => t.passFail === 'pass').length
  const failCount = transactions.filter((t) => t.passFail === 'fail').length

  // Auto-scroll to latest transaction
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [transactions.length])

  return (
    <div
      ref={ref}
      className="rounded-lg border-4 p-1"
      style={{ borderColor: '#e5e7eb', backgroundColor: '#e5e7eb' }}
    >
      <Card className="h-full overflow-hidden rounded-md border-0">
        <CardHeader className="border-b pb-3 pt-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase">
              {label ?? 'Common Bus Monitor'}
            </CardTitle>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-muted-foreground">
                Total:{' '}
                <span className="font-semibold text-foreground">
                  {totalCount}
                </span>
              </span>
              <span className="text-emerald-600">
                Pass:{' '}
                <span className="font-semibold">{passCount}</span>
              </span>
              <span className="text-red-600">
                Fail:{' '}
                <span className="font-semibold">{failCount}</span>
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={scrollRef}
            className="max-h-72 overflow-y-auto"
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-100 hover:bg-slate-100">
                  <TableHead className="w-14 text-center text-xs font-bold">
                    R/W
                  </TableHead>
                  <TableHead className="text-xs font-bold">Address</TableHead>
                  <TableHead className="text-xs font-bold">Expected</TableHead>
                  <TableHead className="text-xs font-bold">Actual</TableHead>
                  <TableHead className="w-16 text-center text-xs font-bold">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No bus transactions recorded
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((txn, idx) => {
                    const isMismatch = txn.passFail === 'fail'
                    const isWrite = txn.rw === 'W'

                    return (
                      <TableRow
                        key={idx}
                        className={cn(
                          'border-b transition-colors',
                          isMismatch
                            ? 'bg-red-50 hover:bg-red-100'
                            : isWrite
                              ? 'bg-blue-50 hover:bg-blue-100'
                              : 'bg-green-50 hover:bg-green-100'
                        )}
                      >
                        <TableCell
                          className={cn(
                            'text-center font-mono text-xs font-bold',
                            isMismatch
                              ? 'text-red-700'
                              : isWrite
                                ? 'text-blue-700'
                                : 'text-green-700'
                          )}
                        >
                          {txn.rw}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'font-mono text-xs',
                            isMismatch && 'text-red-700'
                          )}
                        >
                          {txn.address}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'font-mono text-xs',
                            isMismatch && 'text-red-700'
                          )}
                        >
                          {txn.expected}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'font-mono text-xs font-semibold',
                            isMismatch && 'text-red-700'
                          )}
                        >
                          {txn.actual}
                        </TableCell>
                        <TableCell className="text-center">
                          {isMismatch ? (
                            <span
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white"
                              aria-label="Fail"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                                className="h-3 w-3"
                              >
                                <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                              </svg>
                            </span>
                          ) : (
                            <span
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"
                              aria-label="Pass"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                                className="h-3 w-3"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default CommonBusPanel

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { StatusDot } from '@/components/test/StatusBadge'
import { cn } from '@/lib/utils'

type StepStatus = 'pass' | 'fail' | 'warning' | 'running' | 'pending' | 'skipped'

interface ProgressStep {
  id: number
  step_number: number
  name: string
  status: StepStatus
}

interface TestProgressBarProps {
  steps: ProgressStep[]
  currentStepIndex: number
  onStepClick?: (index: number) => void
}

const completedStatuses = new Set<StepStatus>(['pass', 'fail', 'warning', 'skipped'])

export default function TestProgressBar({ steps, currentStepIndex, onStepClick }: TestProgressBarProps) {
  const total = steps.length
  const completed = steps.filter(s => completedStatuses.has(s.status)).length
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Step Progress</CardTitle>
        <div className="space-y-2">
          <Progress
            value={percent}
            className="[&_[data-slot=progress-indicator]]:bg-emerald-500"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Step {Math.min(currentStepIndex + 1, total)} of {total}</span>
            <span>{completed} completed</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto pt-0">
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200" />

          <div className="space-y-1">
            {steps.map((step, idx) => {
              const isCurrent = idx === currentStepIndex
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => onStepClick?.(idx)}
                  disabled={!onStepClick}
                  className={cn(
                    'relative flex items-center gap-3 w-full rounded-md px-2 py-1.5 text-left transition-colors',
                    isCurrent && 'bg-blue-50 ring-1 ring-blue-200',
                    !isCurrent && onStepClick && 'hover:bg-slate-50',
                    !onStepClick && 'cursor-default',
                  )}
                >
                  <div className="relative z-10">
                    <StatusDot status={step.status} size="sm" pulse={isCurrent && step.status === 'running'} />
                  </div>
                  <span className="font-mono text-xs text-muted-foreground w-5 shrink-0">
                    {step.step_number}
                  </span>
                  <span className={cn(
                    'text-xs truncate',
                    step.status === 'pending' && 'text-muted-foreground',
                    step.status === 'pass' && 'text-emerald-700',
                    step.status === 'fail' && 'text-red-700',
                    step.status === 'warning' && 'text-amber-700',
                    step.status === 'running' && 'text-blue-700 font-medium',
                  )}>
                    {step.name}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

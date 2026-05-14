import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Play,
  Check,
  X,
  Square,
  Pause,
  Minus,
  AlertTriangle,
  Clock,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// --- Test Run Status Badge (6 states) ---

const testStatusConfig: Record<string, { label: string; className: string; icon: LucideIcon }> = {
  pending: { label: 'Pending', className: 'bg-slate-500 text-white hover:bg-slate-500', icon: Clock },
  running: { label: 'Running', className: 'bg-blue-500 text-white hover:bg-blue-500', icon: Play },
  paused: { label: 'Paused', className: 'bg-amber-500 text-white hover:bg-amber-500', icon: Pause },
  passed: { label: 'Passed', className: 'bg-emerald-500 text-white hover:bg-emerald-500', icon: Check },
  failed: { label: 'Failed', className: 'bg-red-500 text-white hover:bg-red-500', icon: X },
  aborted: { label: 'Aborted', className: 'bg-red-300 text-white hover:bg-red-300', icon: Square },
}

const sizeClasses = {
  sm: 'text-xs h-5 px-1.5',
  md: 'text-sm h-6 px-2',
  lg: 'text-base h-7 px-3',
}

const iconSizes = {
  sm: 12,
  md: 14,
  lg: 16,
}

interface TestStatusBadgeProps {
  status: 'pending' | 'running' | 'paused' | 'passed' | 'failed' | 'aborted'
  size?: 'sm' | 'md' | 'lg'
  showIcon?: boolean
  pulse?: boolean
}

export function TestStatusBadge({ status, size = 'md', showIcon = false, pulse = false }: TestStatusBadgeProps) {
  const config = testStatusConfig[status] ?? testStatusConfig.pending
  const shouldPulse = pulse && status === 'running'
  const Icon = config.icon
  const iconSize = iconSizes[size]

  return (
    <Badge className={cn(config.className, sizeClasses[size], shouldPulse && 'animate-pulse', 'inline-flex items-center gap-1')}>
      {showIcon && <Icon className="shrink-0" size={iconSize} />}
      {config.label}
    </Badge>
  )
}

// --- Step Status Badge (5 states) ---

const stepStatusConfig: Record<string, { label: string; className: string; icon: LucideIcon }> = {
  pass: { label: 'Pass', className: 'bg-emerald-500 text-white hover:bg-emerald-500', icon: Check },
  fail: { label: 'Fail', className: 'bg-red-500 text-white hover:bg-red-500', icon: X },
  warning: { label: 'Warning', className: 'bg-amber-500 text-white hover:bg-amber-500', icon: AlertTriangle },
  running: { label: 'Running', className: 'bg-blue-500 text-white hover:bg-blue-500', icon: Play },
  pending: { label: 'Pending', className: 'bg-slate-500 text-white hover:bg-slate-500', icon: Minus },
}

interface StepStatusBadgeProps {
  status: 'pass' | 'fail' | 'warning' | 'running' | 'pending'
  size?: 'sm' | 'md' | 'lg'
  showIcon?: boolean
}

export function StepStatusBadge({ status, size = 'md', showIcon = false }: StepStatusBadgeProps) {
  const config = stepStatusConfig[status] ?? stepStatusConfig.pending
  const Icon = config.icon
  const iconSize = iconSizes[size]

  return (
    <Badge className={cn(config.className, sizeClasses[size], 'inline-flex items-center gap-1')}>
      {showIcon && <Icon className="shrink-0" size={iconSize} />}
      {config.label}
    </Badge>
  )
}

// --- Status Dot ---

const dotColors: Record<string, string> = {
  pass: 'bg-emerald-500',
  fail: 'bg-red-500',
  warning: 'bg-amber-500',
  running: 'bg-blue-500',
  pending: 'bg-slate-400',
  skipped: 'bg-slate-300',
}

const dotSizes = {
  sm: 'h-2 w-2',
  md: 'h-3 w-3',
}

interface StatusDotProps {
  status: 'pass' | 'fail' | 'warning' | 'running' | 'pending' | 'skipped'
  size?: 'sm' | 'md'
  pulse?: boolean
}

export function StatusDot({ status, size = 'md', pulse = false }: StatusDotProps) {
  const color = dotColors[status] ?? dotColors.pending
  const shouldPulse = pulse || status === 'running'

  return (
    <span
      className={cn(
        'inline-block rounded-full',
        color,
        dotSizes[size],
        shouldPulse && 'animate-pulse'
      )}
    />
  )
}

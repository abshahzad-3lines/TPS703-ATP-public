import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Play, Pause, RotateCcw, XCircle, Crosshair, Hand, Zap, Timer, RefreshCw, Redo2,
} from 'lucide-react'

type TestStatus = 'pending' | 'running' | 'paused' | 'passed' | 'failed' | 'aborted'
type ExecutionMode = 'manual' | 'auto'

interface TestControlBarProps {
  status: TestStatus
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onAbort: () => void
  onTake: () => void
  onRetake: () => void
  onRestart: () => void
  onSetMode: (mode: ExecutionMode, delay: number) => void
  executionMode: ExecutionMode
  executionDelay: number
  waitingForTrigger: boolean
  canRetake: boolean
  disabled?: boolean
  subsystemName?: string
  procedureName?: string
}

export default function TestControlBar({
  status,
  onStart,
  onPause,
  onResume,
  onAbort,
  onTake,
  onRetake,
  onRestart,
  onSetMode,
  executionMode,
  executionDelay,
  waitingForTrigger,
  canRetake,
  disabled = false,
  subsystemName,
  procedureName,
}: TestControlBarProps) {
  const [confirmAbort, setConfirmAbort] = useState(false)
  const [delayInput, setDelayInput] = useState(String(executionDelay))

  const handleAbort = () => {
    if (confirmAbort) {
      setConfirmAbort(false)
      onAbort()
    } else {
      setConfirmAbort(true)
      setTimeout(() => setConfirmAbort(false), 5000)
    }
  }

  const MIN_DELAY = 3

  /** Clamp the delay to the minimum settling time for both manual and auto. */
  const clampDelay = (raw: number) => Math.max(MIN_DELAY, raw)

  const handleModeToggle = () => {
    const newMode: ExecutionMode = executionMode === 'manual' ? 'auto' : 'manual'
    const raw = parseFloat(delayInput) || 0
    onSetMode(newMode, clampDelay(raw))
  }

  const handleDelayChange = (val: string) => {
    // Keep the raw text in the input so the user can finish typing,
    // but only push to the backend when the value is at or above the
    // minimum. Below-minimum values are clamped on blur (see below).
    setDelayInput(val)
    const parsed = parseFloat(val)
    if (!isNaN(parsed) && parsed >= MIN_DELAY) {
      onSetMode(executionMode, parsed)
    }
  }

  const handleDelayBlur = () => {
    // Snap any sub-minimum or empty input up to the floor when the user
    // leaves the field, and push the clamped value through.
    const parsed = parseFloat(delayInput)
    const clamped = isNaN(parsed) ? MIN_DELAY : clampDelay(parsed)
    setDelayInput(String(clamped))
    onSetMode(executionMode, clamped)
  }

  const isTerminal = status === 'passed' || status === 'failed' || status === 'aborted'
  const isRunning = status === 'running'

  return (
    <div className="flex flex-col gap-2">
      {/* Lifecycle buttons row. Outer wrapper has no border/padding because
          this control bar is rendered inside the TestHeaderStrip's own card
          (so we don't want a card-in-card visual). */}
      <div className="flex items-center justify-between">
        {/* Optional caption — only shows if explicit names were passed. */}
        <div className="flex items-center gap-3 min-w-0">
          {subsystemName && (
            <span className="text-sm font-medium truncate">{subsystemName}</span>
          )}
          {procedureName && (
            <span className="text-sm text-muted-foreground truncate">{procedureName}</span>
          )}
        </div>

        {/* Right: lifecycle buttons */}
        <div className="flex items-center gap-2">
          {status === 'pending' && (
            <Button
              onClick={onStart}
              disabled={disabled}
              className="bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5"
            >
              <Play className="h-4 w-4" />
              Start
            </Button>
          )}

          {status === 'running' && (
            <>
              <Button
                onClick={onPause}
                disabled={disabled}
                className="bg-amber-500 hover:bg-amber-600 text-white gap-1.5"
              >
                <Pause className="h-4 w-4" />
                Pause
              </Button>
              <Button
                variant="outline"
                onClick={onRestart}
                disabled={disabled}
                className="gap-1.5"
              >
                <RefreshCw className="h-4 w-4" />
                Restart
              </Button>
              <Button
                variant="outline"
                onClick={handleAbort}
                disabled={disabled}
                className={`gap-1.5 ${confirmAbort ? 'border-red-600 bg-red-500 text-white hover:bg-red-600' : 'border-red-500 text-red-500 hover:bg-red-50'}`}
              >
                <XCircle className="h-4 w-4" />
                {confirmAbort ? 'Confirm Abort?' : 'Abort'}
              </Button>
            </>
          )}

          {status === 'paused' && (
            <>
              <Button
                onClick={onResume}
                disabled={disabled}
                className="bg-blue-500 hover:bg-blue-600 text-white gap-1.5"
              >
                <RotateCcw className="h-4 w-4" />
                Resume
              </Button>
              <Button
                variant="outline"
                onClick={handleAbort}
                disabled={disabled}
                className={`gap-1.5 ${confirmAbort ? 'border-red-600 bg-red-500 text-white hover:bg-red-600' : 'border-red-500 text-red-500 hover:bg-red-50'}`}
              >
                <XCircle className="h-4 w-4" />
                {confirmAbort ? 'Confirm Abort?' : 'Abort'}
              </Button>
            </>
          )}

          {isTerminal && (
            <span className="text-sm text-muted-foreground italic">Test complete</span>
          )}
        </div>
      </div>

      {/* Row 2: Execution mode controls (visible when running or paused) */}
      {(isRunning || status === 'paused') && (
        <div className="flex items-center gap-4 border-t pt-2">
          {/* Mode toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium mr-0.5">Mode:</span>
            <div className="inline-flex rounded-md border overflow-hidden">
              <button
                type="button"
                onClick={() => onSetMode('manual', clampDelay(parseFloat(delayInput) || 0))}
                className={`inline-flex items-center gap-1 h-7 px-3 text-xs font-medium transition-colors ${
                  executionMode === 'manual'
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-muted-foreground hover:bg-slate-50'
                }`}
              >
                <Hand className="h-3 w-3" />
                Manual
              </button>
              <button
                type="button"
                onClick={() => onSetMode('auto', clampDelay(parseFloat(delayInput) || 0))}
                className={`inline-flex items-center gap-1 h-7 px-3 text-xs font-medium transition-colors border-l ${
                  executionMode === 'auto'
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-muted-foreground hover:bg-slate-50'
                }`}
              >
                <Zap className="h-3 w-3" />
                Auto
              </button>
            </div>
          </div>

          {/* Step delay — applies to both manual and auto. In manual mode
              it's the settling pause AFTER the operator clicks Take; in
              auto mode it's the inter-step wait. Minimum 3s so the SG /
              DUT have time to settle between back-to-back measurements. */}
          <div className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Delay:</span>
            <Input
              type="number"
              min="3"
              step="0.5"
              value={delayInput}
              onChange={(e) => handleDelayChange(e.target.value)}
              onBlur={handleDelayBlur}
              className="h-7 w-20 text-xs font-mono"
            />
            <span className="text-xs text-muted-foreground">3 sec min</span>
          </div>

          {/* Separator */}
          <div className="h-5 w-px bg-slate-200" />

          {/* Take Measurement button */}
          <Button
            onClick={onTake}
            disabled={disabled || !waitingForTrigger}
            size="sm"
            className="h-8 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold px-5 gap-1.5 shadow-sm"
          >
            <Crosshair className="h-4 w-4" />
            Take Measurement
          </Button>

          {/* Re-take button — visible when current step already has a result */}
          {canRetake && (
            <Button
              onClick={onRetake}
              disabled={disabled}
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-orange-400 text-orange-600 hover:bg-orange-50"
            >
              <Redo2 className="h-3.5 w-3.5" />
              Re-take
            </Button>
          )}

          {/* Waiting indicator */}
          {waitingForTrigger && executionMode === 'manual' && (
            <div className="flex items-center gap-1.5 animate-pulse">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-500"></span>
              </span>
              <span className="text-xs font-medium text-cyan-700">Waiting for trigger...</span>
            </div>
          )}
          {executionMode === 'auto' && (
            <Badge className="bg-emerald-500/15 text-emerald-700 text-xs gap-1">
              <Zap className="h-3 w-3" />
              Auto {executionDelay > 0 ? `(${executionDelay}s delay)` : '(no delay)'}
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}

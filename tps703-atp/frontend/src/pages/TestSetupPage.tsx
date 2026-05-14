import { useState, useEffect, useActionState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { SubmitButton } from '@/components/layout/SubmitButton'
import CalibrationForm from '@/components/dashboard/CalibrationForm'
import ConnectionSetup from '@/components/test/ConnectionSetup'
import { api } from '@/lib/api'
import {
  Check, ChevronRight, Cpu, FileText, Hash, ShieldCheck, Cable, Rocket,
  ArrowRight,
} from 'lucide-react'

interface Subsystem {
  id: number
  drawing_no: string
  name: string
  assembly_no: string
  description: string
  nominal_output_watts: number | null
  procedure_count?: number
}

interface Procedure {
  id: number
  code: string
  name: string
  section_ref: string
  sequence_order: number
  warmup_minutes: number
  step_count?: number
  requires_calibration?: boolean
}

interface CalibrationInfo {
  id: number
  subsystem_id: number
  performed_at: string
  expires_at: string
  status: string
  time_remaining_seconds: number
  time_remaining_human: string
}

type StartTestResult = { success: true; message: string } | { success: false; error: string } | null

export default function TestSetupPage() {
  // Step tracking
  const [currentStep, setCurrentStep] = useState(1)

  // Step 1: Subsystem selection
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [subsystemsError, setSubsystemsError] = useState<string | null>(null)
  const [selectedSubsystemId, setSelectedSubsystemId] = useState<string | null>(null)

  // Step 2: Procedure selection
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [proceduresError, setProceduresError] = useState<string | null>(null)
  const [selectedProcedureId, setSelectedProcedureId] = useState<string | null>(null)

  // Step 3: UUT info
  const [serialNumber, setSerialNumber] = useState('')
  const [partNumber, setPartNumber] = useState('')

  // Step 4: Calibration
  const [calibration, setCalibration] = useState<CalibrationInfo | null>(null)
  const [calibrationStatus, setCalibrationStatus] = useState<'loading' | 'valid' | 'expired' | 'none'>('loading')
  const [showCalForm, setShowCalForm] = useState(false)

  // URL pre-selection from Dashboard "Start Test" links
  const [searchParams] = useSearchParams()
  const preselectedSubsystemId = searchParams.get('subsystemId')
  const preselectedProcedureId = searchParams.get('procedureId')
  const didPreselectSubsystem = useRef(false)
  const didPreselectProcedure = useRef(false)

  // Derived values
  const selectedSubsystem = subsystems.find(s => s.id === Number(selectedSubsystemId)) ?? null
  const selectedProcedure = procedures.find(p => p.id === Number(selectedProcedureId)) ?? null
  const calRequired = selectedProcedure?.requires_calibration ?? false
  const calBlocked = calRequired && calibrationStatus !== 'valid'

  // Fetch subsystems on mount
  useEffect(() => {
    let cancelled = false
    async function fetchSubsystems() {
      try {
        const data = await api.get<Subsystem[]>('/subsystems')
        if (!cancelled) {
          setSubsystems(data)
          setSubsystemsError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setSubsystemsError(e instanceof Error ? e.message : 'Failed to load subsystems')
        }
      }
    }
    fetchSubsystems()
    return () => { cancelled = true }
  }, [])

  // Auto-select subsystem from URL param after subsystems load
  useEffect(() => {
    if (preselectedSubsystemId && subsystems.length > 0 && !didPreselectSubsystem.current) {
      const match = subsystems.find(s => s.id === Number(preselectedSubsystemId))
      if (match) {
        didPreselectSubsystem.current = true
        handleSubsystemChange(String(match.id))
      }
    }
  }, [subsystems, preselectedSubsystemId])

  // Auto-select procedure from URL param after procedures load
  useEffect(() => {
    if (preselectedProcedureId && procedures.length > 0 && !didPreselectProcedure.current) {
      const match = procedures.find(p => p.id === Number(preselectedProcedureId))
      if (match) {
        didPreselectProcedure.current = true
        handleProcedureChange(String(match.id))
      }
    }
  }, [procedures, preselectedProcedureId])

  // Fetch procedures when subsystem changes
  useEffect(() => {
    if (!selectedSubsystemId) {
      setProcedures([])
      return
    }
    let cancelled = false
    async function fetchProcedures() {
      try {
        const data = await api.get<Procedure[]>(`/subsystems/${selectedSubsystemId}/procedures`)
        if (!cancelled) {
          setProcedures(data)
          setProceduresError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setProceduresError(e instanceof Error ? e.message : 'Failed to load procedures')
        }
      }
    }
    fetchProcedures()
    return () => { cancelled = true }
  }, [selectedSubsystemId])

  // Fetch calibration — extracted as a callback so it can be re-triggered
  const fetchCalibration = useCallback(async () => {
    if (!selectedSubsystemId) {
      setCalibration(null)
      setCalibrationStatus('loading')
      return
    }
    setCalibrationStatus('loading')
    try {
      const data = await api.get<CalibrationInfo>(`/calibrations/valid/${selectedSubsystemId}`)
      setCalibration(data)
      setCalibrationStatus('valid')
      setShowCalForm(false)
    } catch {
      setCalibration(null)
      setCalibrationStatus('none')
    }
  }, [selectedSubsystemId])

  // Fetch calibration when subsystem changes (for step 4)
  useEffect(() => {
    fetchCalibration()
  }, [fetchCalibration])

  // Handle subsystem selection
  function handleSubsystemChange(value: string | null) {
    setSelectedSubsystemId(value)
    setSelectedProcedureId(null)
    setProcedures([])
    setSerialNumber('')
    setPartNumber('')
    if (value) {
      setCurrentStep(2)
    }
  }

  // Handle procedure selection
  function handleProcedureChange(value: string | null) {
    setSelectedProcedureId(value)
    if (value) {
      setCurrentStep(3)
    }
  }

  // Handle serial number confirmation
  function handleSerialConfirm() {
    if (serialNumber.trim()) {
      setCurrentStep(4)
    }
  }

  // Handle calibration acknowledgment
  function handleCalibrationContinue() {
    setCurrentStep(5)
  }

  function handleConnectionContinue() {
    setCurrentStep(6)
  }

  // Step 6: Start test action
  const [startResult, startTestAction] = useActionState<StartTestResult, FormData>(
    async (_prev, formData) => {
      try {
        const subsystemId = formData.get('subsystem_id') as string
        const procedureId = formData.get('procedure_id') as string
        const serial = formData.get('serial_number') as string
        const part = formData.get('part_number') as string

        // Register/find UUT
        let uutId: number
        try {
          const uut = await api.post<{ id: number }>('/uuts', {
            subsystem_id: Number(subsystemId),
            serial_number: serial,
            part_number: part || null,
          })
          uutId = uut.id
        } catch {
          // UUT may already exist — look it up
          const uuts = await api.get<Array<{ id: number; serial_number: string; subsystem_id: number }>>('/uuts?subsystem_id=' + subsystemId)
          const existing = uuts.find(u => u.serial_number === serial)
          if (!existing) throw new Error('Failed to register UUT')
          uutId = existing.id
        }

        // Create test run via Phase 3 API
        const run = await api.post<{ id: number }>('/test-runs', {
          procedure_id: Number(procedureId),
          uut_id: uutId,
        })
        window.location.href = `/test-execution/${run.id}`
        return { success: true, message: 'Test run created. Navigating to test execution...' }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Failed to start test' }
      }
    },
    null,
  )

  // Step icons for each wizard step
  const stepIcons = [Cpu, FileText, Hash, ShieldCheck, Cable, Rocket]

  // Step indicator component
  function StepIndicator({ step, label }: { step: number; label: string }) {
    const isActive = currentStep === step
    const isComplete = currentStep > step
    const StepIcon = stepIcons[step - 1]
    return (
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
            isComplete
              ? 'bg-emerald-500 text-white shadow-sm'
              : isActive
                ? 'bg-blue-500 text-white ring-4 ring-blue-500/20 shadow-sm'
                : 'bg-slate-100 text-slate-400 border border-slate-200'
          }`}
        >
          {isComplete ? <Check className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
        </div>
        <div className="flex flex-col">
          <span className={`text-[11px] uppercase tracking-wider ${isActive ? 'text-blue-500' : 'text-muted-foreground'}`}>
            Step {step}
          </span>
          <span
            className={`text-sm font-medium leading-tight ${
              isActive ? 'text-foreground' : isComplete ? 'text-emerald-600' : 'text-muted-foreground'
            }`}
          >
            {label}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <title>Test Setup - TPS-703 ATP</title>

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Test Setup</h1>
        <p className="text-muted-foreground">Configure and start a new acceptance test procedure</p>
      </div>

      {/* Step indicators */}
      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { step: 1, label: 'Select Subsystem' },
            { step: 2, label: 'Select Procedure' },
            { step: 3, label: 'Enter UUT Info' },
            { step: 4, label: 'Verify Calibration' },
            { step: 5, label: 'Equipment Connections' },
            { step: 6, label: 'Confirm & Start' },
          ].map(({ step, label }, i) => (
            <div key={step} className="flex items-center gap-2">
              <StepIndicator step={step} label={label} />
              {i < 5 && (
                <ChevronRight className={`h-4 w-4 mx-1 ${currentStep > step ? 'text-emerald-400' : 'text-slate-300'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Select Subsystem */}
      <Card>
        <CardHeader>
          <CardTitle>Step 1: Select Subsystem</CardTitle>
          <CardDescription>Choose the radar subsystem to test</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {subsystemsError && (
            <Alert variant="destructive">
              <AlertDescription>{subsystemsError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Subsystem</label>
            <Select value={selectedSubsystemId} onValueChange={handleSubsystemChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a subsystem...">
                  {selectedSubsystem ? `${selectedSubsystem.drawing_no} - ${selectedSubsystem.name}` : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {subsystems.map(sub => (
                  <SelectItem key={sub.id} value={String(sub.id)}>
                    {sub.drawing_no} - {sub.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedSubsystem && (
            <div className="rounded-lg border bg-slate-50 p-4 space-y-2">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Drawing No:</span>{' '}
                  <span className="font-medium">{selectedSubsystem.drawing_no}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Assembly No:</span>{' '}
                  <span className="font-medium">{selectedSubsystem.assembly_no}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Description:</span>{' '}
                  <span className="font-medium">{selectedSubsystem.description}</span>
                </div>
                {selectedSubsystem.nominal_output_watts != null && (
                  <div>
                    <span className="text-muted-foreground">Nominal Output:</span>{' '}
                    <span className="font-medium">{selectedSubsystem.nominal_output_watts}W</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Select Procedure */}
      {currentStep >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Step 2: Select Procedure</CardTitle>
            <CardDescription>Choose the test procedure to execute</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {proceduresError && (
              <Alert variant="destructive">
                <AlertDescription>{proceduresError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Procedure</label>
              <Select value={selectedProcedureId} onValueChange={handleProcedureChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a procedure...">
                    {selectedProcedure ? `${selectedProcedure.code} - ${selectedProcedure.name}` : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {procedures.map(proc => (
                    <SelectItem key={proc.id} value={String(proc.id)}>
                      {proc.code} - {proc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedProcedure && (
              <div className="rounded-lg border bg-slate-50 p-4 space-y-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Section Ref:</span>{' '}
                    <span className="font-medium">{selectedProcedure.section_ref}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Sequence:</span>{' '}
                    <span className="font-medium">#{selectedProcedure.sequence_order}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Warmup Time:</span>{' '}
                    <span className="font-medium">{selectedProcedure.warmup_minutes} min</span>
                  </div>
                  {selectedProcedure.step_count != null && (
                    <div>
                      <span className="text-muted-foreground">Steps:</span>{' '}
                      <span className="font-medium">{selectedProcedure.step_count}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Enter UUT Serial Number */}
      {currentStep >= 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Step 3: Unit Under Test Information</CardTitle>
            <CardDescription>Enter the serial number for the unit being tested</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="serial_number" className="text-sm font-medium">
                Serial Number <span className="text-red-500">*</span>
              </label>
              <Input
                id="serial_number"
                value={serialNumber}
                onChange={e => setSerialNumber(e.target.value)}
                placeholder="Enter unit serial number"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="part_number" className="text-sm font-medium">
                Part Number <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="part_number"
                value={partNumber}
                onChange={e => setPartNumber(e.target.value)}
                placeholder="Enter part number"
              />
            </div>
            {currentStep === 3 && (
              <button
                type="button"
                onClick={handleSerialConfirm}
                disabled={!serialNumber.trim()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4: Verify Calibration */}
      {currentStep >= 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Step 4: Calibration Status</CardTitle>
            <CardDescription>
              {calRequired
                ? 'A valid daily calibration is required before running this procedure'
                : 'Verify equipment calibration validity for the selected subsystem'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {calibrationStatus === 'loading' && (
              <p className="text-sm text-muted-foreground">Checking calibration status...</p>
            )}

            {/* ── Valid calibration ── */}
            {calibrationStatus === 'valid' && calibration && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-500 text-white">Valid</Badge>
                  <span className="text-sm text-muted-foreground">Calibration is current</span>
                </div>
                <div className="rounded-lg border bg-emerald-50 p-3 text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">Calibrated:</span>{' '}
                    <span className="font-medium">{new Date(calibration.performed_at + 'Z').toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Expires:</span>{' '}
                    <span className="font-medium">{new Date(calibration.expires_at + 'Z').toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Time Remaining:</span>{' '}
                    <span className="font-medium">{calibration.time_remaining_human}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── No valid calibration — required ── */}
            {calibrationStatus !== 'loading' && calibrationStatus !== 'valid' && calRequired && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge className="bg-red-500 text-white">
                    {calibrationStatus === 'expired' ? 'Expired' : 'No Calibration'}
                  </Badge>
                  <span className="text-sm font-medium text-red-700">Calibration required</span>
                </div>
                <Alert variant="destructive">
                  <AlertTitle>Calibration Required</AlertTitle>
                  <AlertDescription>
                    Procedure <strong>{selectedProcedure?.code}</strong> requires a valid daily calibration.
                    {calibrationStatus === 'expired'
                      ? ' The previous calibration has expired. Perform a new calibration to continue.'
                      : ' No valid calibration was found for this subsystem. Perform a daily calibration below to continue.'}
                  </AlertDescription>
                </Alert>

                {!showCalForm ? (
                  <button
                    type="button"
                    onClick={() => setShowCalForm(true)}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Perform Daily Calibration
                  </button>
                ) : (
                  <CalibrationForm
                    subsystemId={Number(selectedSubsystemId)}
                    onCalibrationComplete={fetchCalibration}
                  />
                )}
              </div>
            )}

            {/* ── No valid calibration — not required ── */}
            {calibrationStatus !== 'loading' && calibrationStatus !== 'valid' && !calRequired && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-slate-500 text-white">Not Required</Badge>
                  <span className="text-sm text-muted-foreground">
                    This procedure does not require equipment calibration
                  </span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-sm text-muted-foreground">
                  Procedure <strong>{selectedProcedure?.code}</strong> ({selectedProcedure?.name}) can proceed without a
                  daily calibration. No RF measurements requiring calibrated equipment are performed.
                </div>
              </div>
            )}

            {/* ── Continue button — only enabled when allowed ── */}
            {currentStep === 4 && calibrationStatus !== 'loading' && (
              <div className="pt-1">
                {calBlocked ? (
                  <p className="text-sm text-red-600 font-medium">
                    Complete the daily calibration above before continuing.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleCalibrationContinue}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 5: Equipment Connections */}
      {currentStep >= 5 && selectedSubsystem && selectedProcedure && (
        <Card>
          <CardHeader>
            <CardTitle>Step 5: Equipment Connection Setup</CardTitle>
            <CardDescription>
              Connect test equipment to the {selectedSubsystem.drawing_no} as shown below before starting the test
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ConnectionSetup
              subsystemDrawingNo={selectedSubsystem.drawing_no}
              subsystemName={selectedSubsystem.name}
              procedureCode={selectedProcedure.code}
            />
            {currentStep === 5 && (
              <button
                type="button"
                onClick={handleConnectionContinue}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Check className="h-4 w-4" />
                Connections Verified -- Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 6: Confirm & Start */}
      {currentStep >= 6 && (
        <Card>
          <CardHeader>
            <CardTitle>Step 6: Confirm & Start Test</CardTitle>
            <CardDescription>Review your selections and start the test procedure</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary */}
            <div className="rounded-lg border bg-slate-50 p-4 space-y-3">
              <h3 className="flex items-center gap-2 font-semibold text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Test Configuration Summary
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Subsystem:</span>{' '}
                  <span className="font-medium">{selectedSubsystem?.drawing_no} - {selectedSubsystem?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Assembly:</span>{' '}
                  <span className="font-medium">{selectedSubsystem?.assembly_no}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Procedure:</span>{' '}
                  <span className="font-medium">{selectedProcedure?.code} - {selectedProcedure?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Section:</span>{' '}
                  <span className="font-medium">{selectedProcedure?.section_ref}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Serial Number:</span>{' '}
                  <span className="font-medium">{serialNumber}</span>
                </div>
                {partNumber && (
                  <div>
                    <span className="text-muted-foreground">Part Number:</span>{' '}
                    <span className="font-medium">{partNumber}</span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Calibration:</span>{' '}
                  {calibrationStatus === 'valid' ? (
                    <Badge className="bg-emerald-500 text-white">Valid</Badge>
                  ) : calibrationStatus === 'expired' ? (
                    <Badge className="bg-red-500 text-white">Expired</Badge>
                  ) : (
                    <Badge className="bg-slate-500 text-white">None</Badge>
                  )}
                </div>
                {selectedProcedure && selectedProcedure.warmup_minutes > 0 && (
                  <div>
                    <span className="text-muted-foreground">Warmup Required:</span>{' '}
                    <span className="font-medium">{selectedProcedure.warmup_minutes} min</span>
                  </div>
                )}
              </div>
            </div>

            {/* Start form */}
            <form action={startTestAction} className="space-y-4">
              <input type="hidden" name="subsystem_id" value={selectedSubsystemId ?? ''} />
              <input type="hidden" name="procedure_id" value={selectedProcedureId ?? ''} />
              <input type="hidden" name="serial_number" value={serialNumber} />
              <input type="hidden" name="part_number" value={partNumber} />

              {startResult && startResult.success && (
                <Alert>
                  <AlertTitle>Success</AlertTitle>
                  <AlertDescription>{startResult.message}</AlertDescription>
                </Alert>
              )}
              {startResult && !startResult.success && (
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{startResult.error}</AlertDescription>
                </Alert>
              )}

              <SubmitButton>Start Test</SubmitButton>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

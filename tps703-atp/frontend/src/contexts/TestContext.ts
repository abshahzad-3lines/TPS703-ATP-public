import { createContext } from 'react'

export type TestStatus = 'pending' | 'running' | 'paused' | 'passed' | 'failed' | 'aborted'
export type StepStatus = 'pass' | 'fail' | 'warning' | 'running' | 'pending'

export interface TestStep {
  id: number
  step_number: number
  name: string
  status: StepStatus
  measured_value?: number
  limit_min?: number
  limit_max?: number
  unit?: string
}

export interface TestState {
  testRunId: number | null
  procedureId: number | null
  subsystemId: number | null
  status: TestStatus
  currentStepIndex: number
  steps: TestStep[]
  startedAt: string | null
}

export const TestContext = createContext<TestState | null>(null)

// Shared TypeScript types + tiny client helpers for the Phase-10 ATP
// authoring API. Keeps page components clean.

import { api } from '@/lib/api'

export type AtpState =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'published'
  | 'superseded'

export type AtpSource =
  | 'migrated'
  | 'authored'
  | 'imported_docx'
  | 'imported_pdf'
  | 'ai_extracted'

export interface AtpStep {
  id: number
  step_number: number
  name: string
  step_type: string
  instrument: string | null
  frequency_mhz: number | null
  input_power_dbm: number | null
  pulse_width_us: number | null
  mux_address: string | null
  mux_sample_time_us: number | null
  bus_address: string | null
  bus_data: string | null
  bus_rw: string | null
  limit_type: string | null
  limit_min: number | null
  limit_max: number | null
  limit_nominal: number | null
  limit_tolerance: number | null
  unit: string | null
  instructions: string | null
  safety_warning: string | null
  is_optional: boolean
  is_record_only: boolean
}

export interface AtpTransition {
  id: number
  from_state: AtpState | null
  to_state: AtpState
  user_id: number | null
  comment: string | null
  transitioned_at: string
}

export interface AtpApproval {
  id: number
  approver_id: number
  decision: 'approve' | 'reject'
  comment: string | null
  decided_at: string
}

export interface AtpDefinitionSummary {
  id: number
  subsystem_id: number
  code: string
  revision: string
  name: string
  section_ref: string | null
  sequence_order: number | null
  warmup_minutes: number | null
  state: AtpState
  source: AtpSource
  parent_definition_id: number | null
  created_by: number | null
  created_at: string | null
  updated_at: string | null
  published_at: string | null
  published_by: number | null
  superseded_at: string | null
  superseded_by_definition_id: number | null
  step_count: number
}

export interface AtpDefinitionDetail extends AtpDefinitionSummary {
  notes: string | null
  requires_calibration: boolean
  default_pulse_width_us: number | null
  legacy_procedure_id: number | null
  steps: AtpStep[]
  transitions: AtpTransition[]
  approvals: AtpApproval[]
}

export interface AtpDiffResponse {
  base: { id: number; code: string; revision: string; state: string }
  target: { id: number; code: string; revision: string; state: string }
  metadata_changes: { field: string; base: unknown; target: unknown }[]
  steps: {
    added: AtpStep[]
    removed: AtpStep[]
    modified: {
      step_number: number
      name: string
      changes: { field: string; base: unknown; target: unknown }[]
    }[]
    unchanged_count: number
  }
}

export interface SimulationSummary {
  simulation_id?: number
  pass_count: number
  fail_count: number
  skipped_count: number
  results?: {
    step_number: number
    name: string
    step_type?: string
    measured?: number | null
    unit?: string | null
    limit_min?: number | null
    limit_max?: number | null
    limit_nominal?: number | null
    limit_tolerance?: number | null
    status: 'pass' | 'fail' | 'skipped'
    reason?: string | null
  }[]
}

export interface UploadPreview {
  import_id: number
  filename: string
  source_type: 'docx' | 'pdf'
  text_preview: string
  guessed_metadata: { code?: string; name?: string }
  heuristic_steps: { step_number: number; name: string; instructions: string | null }[]
  status: string
}

export const STEP_TYPES = [
  'output_power', 'input_current', 'current', 'resistance', 'voltage',
  'mux_voltage', 'pulse_width', 'droop', 'spectrum', 'harmonic',
  'return_loss', 'vswr', 's11', 'phase_shift', 'frequency',
  'fft_peak', 'fft_noise', 'fft_sfdr',
  'bus_read', 'bus_write', 'bite_signal',
  'sg_setup',
  'visual_inspection', 'manual_record', 'warmup', 'settling',
] as const

/**
 * Per-step-type domain model — mirrors backend `services/atp_validator.py`.
 *
 * It tells the step editor which fields actually make sense for a given
 * step type, so a technician only sees (and can only fill) the values that
 * belong to that measurement. This is the single source of truth for:
 *   - `stimulus`  : what we DRIVE INTO the unit (signal-generator settings)
 *   - `measured`  : whether the step reads a value back (needs unit + limits)
 *   - `bus`/`mux` : digital-bus or multiplexer addressing fields
 *   - `role`      : which instrument performs it (informational)
 */
export type StimulusField = 'frequency' | 'power' | 'pulse'

export interface StepTypeSpec {
  label: string
  group: string
  role: string | null
  stimulus: StimulusField[]
  measured: boolean
  defaultUnit?: string
  bus?: boolean
  mux?: boolean
  hint: string
}

export const STEP_TYPE_SPECS: Record<string, StepTypeSpec> = {
  // ---- Power meter ----
  output_power: { label: 'Output power', group: 'Power meter', role: 'power_meter',
    stimulus: ['frequency', 'power'], measured: true, defaultUnit: 'W',
    hint: 'Drive the UUT at a set frequency/power and measure the RF output power it delivers.' },
  // ---- Multimeter ----
  input_current: { label: 'Input / supply current', group: 'Multimeter', role: 'multimeter',
    stimulus: [], measured: true, defaultUnit: 'A',
    hint: 'Measure the DC supply current the UUT draws.' },
  current: { label: 'Current', group: 'Multimeter', role: 'multimeter',
    stimulus: [], measured: true, defaultUnit: 'A', hint: 'Measure a current with the DMM.' },
  voltage: { label: 'Voltage', group: 'Multimeter', role: 'multimeter',
    stimulus: [], measured: true, defaultUnit: 'V', hint: 'Measure a DC voltage with the DMM.' },
  resistance: { label: 'Resistance', group: 'Multimeter', role: 'multimeter',
    stimulus: [], measured: true, defaultUnit: 'Ω', hint: 'Measure a resistance with the DMM.' },
  mux_voltage: { label: 'MUX voltage', group: 'Multimeter', role: 'multimeter',
    stimulus: [], measured: true, defaultUnit: 'V', mux: true,
    hint: 'Read a voltage through a multiplexer channel (set the MUX address).' },
  // ---- Oscilloscope ----
  pulse_width: { label: 'Pulse width', group: 'Oscilloscope', role: 'oscilloscope',
    stimulus: ['frequency', 'power', 'pulse'], measured: true, defaultUnit: 'µs',
    hint: 'Drive a pulsed RF input and measure the pulse width on the scope.' },
  droop: { label: 'Pulse droop', group: 'Oscilloscope', role: 'oscilloscope',
    stimulus: ['frequency', 'power', 'pulse'], measured: true, defaultUnit: 'dB',
    hint: 'Measure top-of-pulse droop on a pulsed RF input.' },
  // ---- Spectrum analyzer ----
  spectrum: { label: 'Spectrum level', group: 'Spectrum analyzer', role: 'spectrum_analyzer',
    stimulus: ['frequency'], measured: true, defaultUnit: 'dBm',
    hint: 'Measure a level at a frequency on the spectrum analyzer.' },
  harmonic: { label: 'Harmonic level', group: 'Spectrum analyzer', role: 'spectrum_analyzer',
    stimulus: ['frequency'], measured: true, defaultUnit: 'dBc',
    hint: 'Measure a harmonic/spurious level relative to the carrier.' },
  // ---- Network analyzer ----
  return_loss: { label: 'Return loss', group: 'Network analyzer', role: 'network_analyzer',
    stimulus: ['frequency', 'power'], measured: true, defaultUnit: 'dB',
    hint: 'Measure input/output return loss on the VNA.' },
  vswr: { label: 'VSWR', group: 'Network analyzer', role: 'network_analyzer',
    stimulus: ['frequency'], measured: true, defaultUnit: ':1',
    hint: 'Measure voltage standing-wave ratio on the VNA.' },
  s11: { label: 'S11 (input match)', group: 'Network analyzer', role: 'network_analyzer',
    stimulus: ['frequency'], measured: true, defaultUnit: 'dB',
    hint: 'Measure the S11 input reflection on the VNA.' },
  // ---- Phase meter ----
  phase_shift: { label: 'Phase shift', group: 'Phase meter', role: 'phase_meter',
    stimulus: ['frequency', 'power'], measured: true, defaultUnit: '°',
    hint: 'Measure phase shift through the UUT at a frequency/power.' },
  frequency: { label: 'Frequency', group: 'Phase meter', role: 'phase_meter',
    stimulus: [], measured: true, defaultUnit: 'MHz',
    hint: 'Measure a frequency.' },
  // ---- FFT / IF receiver ----
  fft_peak: { label: 'FFT peak', group: 'FFT / IF receiver', role: 'fft_display',
    stimulus: [], measured: true, defaultUnit: 'dB', hint: 'Measure the FFT peak level.' },
  fft_noise: { label: 'FFT noise floor', group: 'FFT / IF receiver', role: 'fft_display',
    stimulus: [], measured: true, defaultUnit: 'dB', hint: 'Measure the FFT noise floor.' },
  fft_sfdr: { label: 'FFT SFDR', group: 'FFT / IF receiver', role: 'fft_display',
    stimulus: [], measured: true, defaultUnit: 'dB',
    hint: 'Measure spurious-free dynamic range from the FFT.' },
  // ---- Common bus (IF receiver) ----
  bus_read: { label: 'Bus read', group: 'Common bus', role: 'common_bus',
    stimulus: [], measured: false, bus: true,
    hint: 'Read a register/address on the digital bus and verify the value (expected vs actual).' },
  bus_write: { label: 'Bus write', group: 'Common bus', role: 'common_bus',
    stimulus: [], measured: false, bus: true,
    hint: 'Write a value to a register/address on the digital bus.' },
  bite_signal: { label: 'BITE signal', group: 'Common bus', role: 'common_bus',
    stimulus: [], measured: false, bus: true,
    hint: 'Check a built-in-test (BITE) status signal over the bus.' },
  // ---- Signal generator stimulus (drives the UUT; not a measurement) ----
  sg_setup: { label: 'Signal-generator setup', group: 'Stimulus (no measurement)', role: 'signal_generator',
    stimulus: ['frequency', 'power', 'pulse'], measured: false,
    hint: 'Program the signal generator that drives the UUT. This is a stimulus — it has no pass/fail limits.' },
  // ---- Manual / procedural (no instrument, no measurement) ----
  visual_inspection: { label: 'Visual inspection', group: 'Manual / procedural', role: null,
    stimulus: [], measured: false,
    hint: 'Operator visually inspects the unit and records the result. No instrument.' },
  manual_record: { label: 'Manual record', group: 'Manual / procedural', role: null,
    stimulus: [], measured: false,
    hint: 'Operator records a value or observation by hand. No instrument.' },
  warmup: { label: 'Warm-up (timed)', group: 'Manual / procedural', role: null,
    stimulus: [], measured: false,
    hint: 'Timed warm-up before measurements begin. No measurement taken.' },
  settling: { label: 'Settling (timed)', group: 'Manual / procedural', role: null,
    stimulus: [], measured: false,
    hint: 'Allow the UUT/instruments to settle. No measurement taken.' },
}

/** Default bus_rw direction for the digital-bus step types. */
export const BUS_DEFAULT_RW: Record<string, 'R' | 'W'> = {
  bus_read: 'R', bus_write: 'W', bite_signal: 'R',
}

/** Step types grouped for an <optgroup> dropdown, preserving STEP_TYPES order. */
export const STEP_TYPE_GROUPS: { group: string; types: string[] }[] = (() => {
  const order: string[] = []
  const byGroup: Record<string, string[]> = {}
  for (const t of STEP_TYPES) {
    const g = STEP_TYPE_SPECS[t]?.group ?? 'Other'
    if (!byGroup[g]) { byGroup[g] = []; order.push(g) }
    byGroup[g].push(t)
  }
  return order.map(group => ({ group, types: byGroup[group] }))
})()

export const STATE_COLORS: Record<AtpState, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-300',
  in_review: 'bg-amber-100 text-amber-800 border-amber-300',
  approved: 'bg-blue-100 text-blue-800 border-blue-300',
  published: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  superseded: 'bg-zinc-100 text-zinc-500 border-zinc-300 line-through',
}

export const SOURCE_LABELS: Record<AtpSource, string> = {
  migrated: 'Migrated (v1)',
  authored: 'Authored',
  imported_docx: 'Imported (DOCX)',
  imported_pdf: 'Imported (PDF)',
  ai_extracted: 'AI-extracted',
}

// ----- client helpers --------------------------------------------------------

export function listDefinitions(params: {
  subsystem_id?: number
  state?: AtpState
  code?: string
} = {}): Promise<AtpDefinitionSummary[]> {
  const qs = new URLSearchParams()
  if (params.subsystem_id) qs.set('subsystem_id', String(params.subsystem_id))
  if (params.state) qs.set('state', params.state)
  if (params.code) qs.set('code', params.code)
  const suffix = qs.toString() ? `?${qs}` : ''
  return api.get(`/atp/definitions${suffix}`)
}

export function getDefinition(id: number): Promise<AtpDefinitionDetail> {
  return api.get(`/atp/definitions/${id}`)
}

export function createDraft(body: {
  subsystem_id: number
  code: string
  name: string
  revision?: string
  section_ref?: string | null
  sequence_order?: number | null
  warmup_minutes?: number | null
}): Promise<AtpDefinitionSummary> {
  return api.post('/atp/definitions', body)
}

export function cloneDefinition(id: number, body: { new_revision?: string; notes?: string } = {}) {
  return api.post<AtpDefinitionSummary>(`/atp/definitions/${id}/clone`, body)
}

export function updateMetadata(id: number, body: Partial<AtpDefinitionDetail>) {
  return api.request<AtpDefinitionSummary>(`/atp/definitions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteDefinition(id: number) {
  return api.request(`/atp/definitions/${id}`, { method: 'DELETE' })
}

export function addStep(definitionId: number, body: Partial<AtpStep>) {
  return api.post<AtpStep>(`/atp/definitions/${definitionId}/steps`, body)
}

export function updateStep(definitionId: number, stepId: number, body: Partial<AtpStep>) {
  return api.request<AtpStep>(`/atp/definitions/${definitionId}/steps/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteStep(definitionId: number, stepId: number) {
  return api.request(`/atp/definitions/${definitionId}/steps/${stepId}`, {
    method: 'DELETE',
  })
}

export function reorderSteps(definitionId: number, stepIds: number[]) {
  return api.post(`/atp/definitions/${definitionId}/steps/reorder`, {
    step_ids: stepIds,
  })
}

export function transition(definitionId: number, to_state: AtpState, comment?: string) {
  return api.post(`/atp/definitions/${definitionId}/transition`, { to_state, comment })
}

export function submitApproval(
  definitionId: number,
  decision: 'approve' | 'reject',
  comment?: string,
): Promise<AtpApproval> {
  return api.post(`/atp/definitions/${definitionId}/approvals`, { decision, comment })
}

export function validate(definitionId: number) {
  return api.get<{ valid: boolean; issues: string[] }>(
    `/atp/definitions/${definitionId}/validate`,
  )
}

export function diff(baseId: number, targetId: number) {
  return api.get<AtpDiffResponse>(`/atp/definitions/${baseId}/diff/${targetId}`)
}

export function simulate(definitionId: number) {
  return api.post<SimulationSummary>(`/atp/definitions/${definitionId}/simulate`, {})
}

export function listSimulations(definitionId: number) {
  return api.get<{ id: number; pass_count: number; fail_count: number; skipped_count: number; simulated_at: string; simulated_by: number | null }[]>(
    `/atp/definitions/${definitionId}/simulations`,
  )
}

export function exportBundleUrl(definitionId: number): string {
  return `/atp/definitions/${definitionId}/export`
}

export function importBundle(bundle: unknown) {
  return api.post<AtpDefinitionSummary>('/atp/import', bundle)
}

// ----- AI helpers ------------------------------------------------------------

export function aiExtractFromDoc(body: {
  import_id?: number
  text?: string
  subsystem_id: number
  code: string
  name: string
  revision?: string
  definition_id?: number
  replace_existing_steps?: boolean
}) {
  return api.post<AtpDefinitionSummary>('/atp/ai/extract-from-document', body)
}

export function aiSafetyWarning(definitionId: number, stepId: number) {
  return api.post<{ safety_warning: string | null }>(
    `/atp/definitions/${definitionId}/steps/${stepId}/ai/safety-warning`,
    {},
  )
}

export function aiOrderReview(definitionId: number) {
  return api.post<{ concerns: { severity: string; category: string; step_numbers: number[]; message: string }[] }>(
    `/atp/definitions/${definitionId}/ai/order-review`,
    {},
  )
}

export function aiImpactSummary(baseId: number, targetId: number) {
  return api.post<{ summary: string; diff: AtpDiffResponse }>(
    `/atp/definitions/${baseId}/diff/${targetId}/ai/summary`,
    {},
  )
}

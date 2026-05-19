// Phase 11 — S-parameter API + types.

import { api } from '@/lib/api'

export interface SparamSweep {
  id: number
  test_run_id: number | null
  uut_id: number | null
  subsystem_id: number | null
  source: 'uploaded' | 'captured' | 'de_embedded' | 'golden_ref'
  origin_sweep_id: number | null
  cal_set_id: number | null
  filename: string | null
  n_ports: number
  n_points: number
  f_start_hz: number
  f_stop_hz: number
  z0_ohm: number
  created_at: string | null
}

export interface SparamParam {
  mag_db: number[]
  phase_deg: number[]
  phase_unwrapped_deg: number[]
  real: number[]
  imag: number[]
  group_delay_s: number[]
}

export interface SparamViz {
  n_ports: number
  n_points: number
  f_start_hz: number
  f_stop_hz: number
  z0_ohm: number
  freq_hz: number[]
  params: Record<string, SparamParam>
}

export interface SparamDetail {
  summary: SparamSweep
  viz: SparamViz
}

export interface MaskBand {
  f_start_hz: number
  f_stop_hz: number
  param: string
  quantity: 'mag_db' | 'mag_linear' | 'phase_deg' | 'vswr' | 'return_loss_db'
  min: number | null
  max: number | null
}

export interface SparamMask {
  id: number
  name: string
  subsystem_id: number | null
  param: string
  quantity: string
  bands_json: string
  created_at: string
}

export interface MaskEvaluation {
  passed: boolean
  band_count: number
  failed_count: number
  bands: {
    band_index: number
    param: string
    quantity: string
    f_start_hz: number
    f_stop_hz: number
    min: number | null
    max: number | null
    worst_value: number
    worst_freq_hz: number
    status: 'pass' | 'fail' | 'skipped'
  }[]
  failures: MaskEvaluation['bands']
}

export interface GoldenRef {
  id: number
  name: string
  subsystem_id: number | null
  uut_family: string | null
  sweep_id: number
  notes: string | null
  created_at: string
}

export interface CalSet {
  id: number
  name: string
  description: string | null
  cal_type: string
  f_start_hz: number | null
  f_stop_hz: number | null
  open_sweep_id: number | null
  short_sweep_id: number | null
  load_sweep_id: number | null
  thru_sweep_id: number | null
  created_at: string
}

export interface CompareResult {
  measured: SparamViz
  golden: SparamViz
  deltas: Record<string, { mag_db: number[]; phase_deg: number[] }> | null
}

export interface Anomaly {
  severity: 'high' | 'medium' | 'low'
  kind: string
  param: string
  freq_ghz: number | null
  freq_range_ghz?: [number, number]
  description: string
}

// ----- API helpers ----------------------------------------------------------

export function listSweeps(params: Partial<{
  subsystem_id: number; uut_id: number; test_run_id: number; source: string; limit: number
}> = {}): Promise<SparamSweep[]> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  return api.get(`/sparam/sweeps${suffix}`)
}

export function getSweep(id: number): Promise<SparamDetail> {
  return api.get(`/sparam/sweeps/${id}`)
}

export function deleteSweep(id: number) {
  return api.request(`/sparam/sweeps/${id}`, { method: 'DELETE' })
}

export function listMasks(subsystem_id?: number): Promise<SparamMask[]> {
  const qs = subsystem_id != null ? `?subsystem_id=${subsystem_id}` : ''
  return api.get(`/sparam/masks${qs}`)
}

export function createMask(body: {
  name: string; subsystem_id?: number; param?: string; quantity?: string;
  bands: MaskBand[]
}): Promise<SparamMask> {
  return api.post('/sparam/masks', body)
}

export function evaluateMask(sweep_id: number, mask_id: number): Promise<MaskEvaluation> {
  return api.post(`/sparam/sweeps/${sweep_id}/evaluate`, { mask_id })
}

export function listGoldenRefs(subsystem_id?: number): Promise<GoldenRef[]> {
  const qs = subsystem_id != null ? `?subsystem_id=${subsystem_id}` : ''
  return api.get(`/sparam/golden-refs${qs}`)
}

export function createGoldenRef(body: {
  name: string; subsystem_id?: number; uut_family?: string;
  sweep_id: number; notes?: string;
}): Promise<GoldenRef> {
  return api.post('/sparam/golden-refs', body)
}

export function compareWithGolden(sweep_id: number, golden_id: number): Promise<CompareResult> {
  return api.get(`/sparam/sweeps/${sweep_id}/compare/${golden_id}`)
}

export function listCalSets(): Promise<CalSet[]> {
  return api.get('/sparam/cal-sets')
}

export function createCalSet(body: {
  name: string; description?: string; cal_type?: string;
  open_sweep_id?: number; short_sweep_id?: number;
  load_sweep_id?: number; thru_sweep_id?: number;
}): Promise<CalSet> {
  return api.post('/sparam/cal-sets', body)
}

export function deembed(sweep_id: number, cal_set_id: number): Promise<SparamSweep> {
  return api.post(`/sparam/sweeps/${sweep_id}/deembed`, { cal_set_id })
}

// AI
export function aiAnomalies(sweep_id: number) {
  return api.post<{ anomalies: Anomaly[]; history_count: number }>(`/sparam/sweeps/${sweep_id}/ai/anomalies`, {})
}
export function aiNarrate(sweep_id: number, golden_id: number) {
  return api.post<{ narrative: string }>(`/sparam/sweeps/${sweep_id}/ai/narrate/${golden_id}`, {})
}
export function aiSuggestCal(sweep_id: number) {
  return api.post<{ best_match_id: number | null; confidence: string; reason: string }>(
    `/sparam/sweeps/${sweep_id}/ai/suggest-cal`, {})
}
export function aiExplainFailures(sweep_id: number, mask_id: number) {
  return api.post<{ explanation: string; result: MaskEvaluation }>(
    `/sparam/sweeps/${sweep_id}/ai/explain-failures`, { mask_id })
}

// Utility — pick a colour for an S-parameter trace
export const SPARAM_COLORS: Record<string, string> = {
  s11: '#3b82f6',  // blue
  s12: '#10b981',  // emerald
  s21: '#f59e0b',  // amber
  s22: '#ef4444',  // red
  s13: '#8b5cf6',  // violet
  s31: '#ec4899',
  s33: '#14b8a6',
}

export function paramColor(p: string): string {
  return SPARAM_COLORS[p] ?? '#6b7280'
}

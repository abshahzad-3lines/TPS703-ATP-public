"""Phase 10 — AI features for ATP authoring.

Four endpoints, each backed by Grok via ``ai_grok.chat_json`` /
``chat_text``:

1. ``extract_steps_from_text`` — turn an uploaded ATP document into a
   structured list of step dicts ready to drop into ``atp_steps``.
2. ``draft_safety_warning`` — given a step's parameters, propose a
   safety-warning sentence.
3. ``review_step_ordering`` — scan a draft's step sequence for missing
   warm-up, missing settling time, dependency violations.
4. ``summarize_revision_impact`` — turn a ``atp_diff`` result into a
   plain-English engineering-change-record paragraph.

Every helper is a thin wrapper that builds a prompt, calls Grok, and
returns a typed dict. Routers add the audit_log entry + persist any
changes.
"""

from __future__ import annotations

import json

from services import ai_grok


# Step types the validator knows about — given to Grok so it doesn't
# invent new ones.
KNOWN_STEP_TYPES = [
    "output_power", "input_current", "current", "resistance", "voltage",
    "mux_voltage", "pulse_width", "droop", "spectrum", "harmonic",
    "return_loss", "vswr", "s11", "phase_shift", "frequency",
    "fft_peak", "fft_noise", "fft_sfdr",
    "bus_read", "bus_write", "bite_signal",
    "sg_setup",
    "visual_inspection", "manual_record", "warmup", "settling",
]

KNOWN_INSTRUMENT_ROLES = [
    "power_meter", "multimeter", "oscilloscope", "spectrum_analyzer",
    "network_analyzer", "phase_meter", "fft_display", "common_bus",
    "signal_generator",
]


# ---------------------------------------------------------------------------
# 1. Extract structured steps from uploaded document text
# ---------------------------------------------------------------------------


_EXTRACT_SYSTEM = """\
You convert customer-uploaded radar ATP (Acceptance Test Procedure)
documents into structured step JSON for a test-automation system.

You must return a JSON object with exactly one key ``steps`` whose value
is an array of objects. Each object MUST have these keys (use null for
absent values):

  step_number        : 1-based integer, contiguous
  name               : short title (<= 120 chars)
  step_type          : one of {step_types}
  instrument         : the model number or friendly name from the doc, or null
  frequency_mhz      : numeric MHz, or null
  input_power_dbm    : numeric dBm, or null
  pulse_width_us     : numeric microseconds, or null
  limit_min          : numeric, or null
  limit_max          : numeric, or null
  limit_nominal      : numeric, or null
  limit_tolerance    : numeric, or null
  unit               : SI unit string (V, A, dBm, W, MHz, deg, dB, etc.), or null
  instructions       : 1-3 sentence operator guidance copied/paraphrased from doc
  safety_warning     : copied warning text if the doc has one, else null

Rules:
- Never invent measurements that are not in the source text.
- If a step is purely manual (e.g. "verify LED is green"), use
  step_type = "visual_inspection".
- For RF stimulus rows ("set SG to 2900 MHz, 0 dBm") use step_type = "sg_setup".
- Re-number sequentially 1..N even if the document gaps numbering.
- Do not include any commentary outside the JSON.
"""


async def extract_steps_from_text(text: str) -> list[dict]:
    system = _EXTRACT_SYSTEM.format(step_types=KNOWN_STEP_TYPES)
    # Trim very long docs — Grok's context is generous but we don't need
    # the back half of a 400-page doc to extract steps.
    snippet = text[:60_000]
    payload = await ai_grok.chat_json(
        system=system,
        user=f"Document text:\n\n{snippet}",
        max_tokens=8000,
    )
    steps = payload.get("steps", [])
    if not isinstance(steps, list):
        raise ai_grok.GrokError(f"Grok returned non-list 'steps': {type(steps)}")

    # Defensive re-number
    out: list[dict] = []
    for idx, raw in enumerate(steps, start=1):
        if not isinstance(raw, dict):
            continue
        raw["step_number"] = idx
        raw.setdefault("step_type", "manual_record")
        out.append(raw)
    return out


# ---------------------------------------------------------------------------
# 2. Draft safety warning text from step parameters
# ---------------------------------------------------------------------------


_SAFETY_SYSTEM = """\
You write concise (1-2 sentence) safety warnings for radar test
procedures. Style: imperative, lab-engineer voice. No emoji, no
headlines, no bullet points.

Hazards to consider when applicable:
- RF radiation (>20 dBm output, missing dummy load)
- High DC voltage / current
- Hot surfaces during long pulse-width or high-duty-cycle tests
- ESD-sensitive electronics
- Pulse-modulated signals causing CRT/scope persistence misreads
- Lifting / heavy assemblies (Power Module Assembly = 41 lbs)

Return JSON: {"warning": "<text>"}. Use null if no safety concern.
"""


async def draft_safety_warning(step: dict) -> str | None:
    user = (
        "Step:\n" + json.dumps({
            k: step.get(k) for k in (
                "name", "step_type", "instrument", "frequency_mhz",
                "input_power_dbm", "pulse_width_us", "limit_min",
                "limit_max", "unit", "instructions",
            )
        }, indent=2)
    )
    payload = await ai_grok.chat_json(
        system=_SAFETY_SYSTEM, user=user, temperature=0.3, max_tokens=300,
    )
    warning = payload.get("warning")
    return warning if isinstance(warning, str) and warning.strip() else None


# ---------------------------------------------------------------------------
# 3. Review draft step ordering for common issues
# ---------------------------------------------------------------------------


_ORDER_SYSTEM = """\
You review the step sequence of a radar Acceptance Test Procedure for
common authoring mistakes. Return JSON with one key ``concerns`` whose
value is an array of objects:

  { "severity": "high"|"medium"|"low",
    "category": "<short slug>",
    "step_numbers": [<int>, ...],
    "message": "<one-sentence explanation>" }

Categories to look for:
- missing_warmup       — high-power RF measurements without a warm-up step first
- missing_settling     — SG retune followed immediately by measurement, no delay
- dependency_violation — a step references state set later (e.g. measures the
  output of a stage that has not been powered up)
- duplicate            — same measurement appears twice with conflicting limits
- safety_gap           — high-power step without a preceding dummy-load check
- limit_mismatch       — limit appears tighter than the subsystem's nominal
- redundant_stimulus   — two sg_setup steps with identical parameters in a row

If everything looks fine, return ``{"concerns": []}``.
"""


async def review_step_ordering(steps: list[dict]) -> list[dict]:
    user = "Steps:\n" + json.dumps([
        {k: s.get(k) for k in (
            "step_number", "name", "step_type", "frequency_mhz",
            "input_power_dbm", "limit_min", "limit_max", "unit",
        )} for s in steps
    ], indent=2)
    payload = await ai_grok.chat_json(
        system=_ORDER_SYSTEM, user=user, max_tokens=2000,
    )
    concerns = payload.get("concerns", [])
    return concerns if isinstance(concerns, list) else []


# ---------------------------------------------------------------------------
# 4. Plain-English revision-impact summary for the ECR
# ---------------------------------------------------------------------------


_IMPACT_SYSTEM = """\
You write engineering-change-record summaries for radar Acceptance Test
Procedures. Given a structured diff between two revisions, write 2-4
short paragraphs in plain English explaining WHAT changed and WHY IT
MATTERS to the operator and to the customer.

Voice: neutral, technical, no marketing words. Mention concrete
parameters (frequencies, limits, step counts) when they appear in the
diff. If the only changes are cosmetic (wording, notes), say so plainly.
Do not invent rationale that isn't justified by the diff.
"""


async def summarize_revision_impact(diff: dict) -> str:
    return await ai_grok.chat_text(
        system=_IMPACT_SYSTEM,
        user="Diff JSON:\n" + json.dumps(diff, indent=2),
        temperature=0.4,
        max_tokens=1200,
    )

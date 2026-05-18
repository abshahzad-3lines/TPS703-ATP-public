"""Phase 11 — AI helpers for S-parameter analysis (Groq-backed).

Four features:
1. ``detect_anomalies`` — flag unusual features in a sweep vs the
   tenant's historical sweeps for the same UUT family.
2. ``narrate_vs_golden`` — plain-English explanation of how a sweep
   differs from its golden-unit reference.
3. ``suggest_cal_set`` — recommend which stored OSLT cal set best
   matches a sweep based on header metadata + frequency span.
4. ``explain_mask_failures`` — one paragraph on which frequency band
   failed and the magnitude of the excursion.

Each helper feeds Groq a compressed numeric digest of the sweep — the
full point cloud would blow the prompt budget. We downsample to a
fixed grid of ~64 points across the sweep span and quote those.
"""

from __future__ import annotations

import json
import math

import numpy as np

from services import ai_groq


_MAX_POINTS_IN_PROMPT = 64


def _digest(viz: dict, params: list[str] | None = None) -> dict:
    """Downsample a visualisation dict to ~64 points per parameter and
    return only mag_db + phase_deg (the two quantities the model needs
    to reason about the sweep shape).
    """
    n = viz.get("n_points", 0)
    freq = viz.get("freq_hz", [])
    if not freq:
        return {}
    stride = max(1, n // _MAX_POINTS_IN_PROMPT)
    params = params or list(viz["params"].keys())
    out = {
        "n_ports": viz["n_ports"],
        "n_points": viz["n_points"],
        "f_start_ghz": round(viz["f_start_hz"] / 1e9, 4),
        "f_stop_ghz": round(viz["f_stop_hz"] / 1e9, 4),
        "freq_ghz": [round(f / 1e9, 4) for f in freq[::stride]],
        "params": {},
    }
    for p in params:
        if p not in viz["params"]:
            continue
        rec = viz["params"][p]
        out["params"][p] = {
            "mag_db": [round(v, 2) for v in rec["mag_db"][::stride]],
            "phase_deg": [round(v, 1) for v in rec["phase_deg"][::stride]],
        }
    return out


# ---------------------------------------------------------------------------
# 1. Anomaly detect
# ---------------------------------------------------------------------------


_ANOMALY_SYSTEM = """\
You analyse VNA S-parameter sweeps from radar subsystems and flag
unusual features compared to a fleet of historical sweeps. Return JSON
with one key ``anomalies`` whose value is an array of objects:

  { "severity": "high"|"medium"|"low",
    "kind": "<short slug>",
    "param": "<s21|s11|...>",
    "freq_ghz": <number or null if range>,
    "freq_range_ghz": [low, high]   (only if kind is band-wide),
    "description": "<one sentence>" }

Kinds to look for:
- resonance        — a dip or peak in mag_db that isn't present in the historical mean
- suckout          — narrow-band dip (>3 dB below local mean)
- ripple           — excessive periodic variation
- slope_deviation  — mag_db slope departs from historical trend
- phase_glitch     — sharp non-smooth phase transition
- in-band-loss     — total in-band insertion loss outside the typical range
- match_degrade    — return loss (s11) worse than historical

Be conservative. If nothing flags, return ``{"anomalies": []}``.
"""


async def detect_anomalies(
    current_viz: dict,
    history_digests: list[dict],
) -> list[dict]:
    user_payload = {
        "current": _digest(current_viz),
        "history_count": len(history_digests),
        "historical_mean_summary": _historical_summary(history_digests),
    }
    payload = await ai_groq.chat_json(
        system=_ANOMALY_SYSTEM,
        user="Sweep to analyse:\n" + json.dumps(user_payload, indent=2),
        max_tokens=1500,
    )
    out = payload.get("anomalies", [])
    return out if isinstance(out, list) else []


def _historical_summary(history_digests: list[dict]) -> dict:
    """Compress a list of historical sweeps into mean ± std for a handful of
    quantities that matter (s21 mag_db at band edges and centre, s11 at
    band centre). Keeps the prompt short.
    """
    if not history_digests:
        return {"available": False}
    pts = []
    for d in history_digests:
        params = d.get("params", {})
        if "s21" not in params:
            continue
        s21 = params["s21"]["mag_db"]
        if not s21:
            continue
        pts.append({
            "low":  s21[0],
            "mid":  s21[len(s21) // 2],
            "high": s21[-1],
        })
    if not pts:
        return {"available": False}
    arr = np.array([[p["low"], p["mid"], p["high"]] for p in pts])
    return {
        "available": True,
        "n_samples": len(pts),
        "s21_mag_db_mean": [round(float(arr[:, k].mean()), 2) for k in range(3)],
        "s21_mag_db_std":  [round(float(arr[:, k].std()),  2) for k in range(3)],
        "labels": ["band_low", "band_mid", "band_high"],
    }


# ---------------------------------------------------------------------------
# 2. Narrate vs golden
# ---------------------------------------------------------------------------


_NARRATIVE_SYSTEM = """\
You write 2-3 short paragraphs explaining how a measured radar
S-parameter sweep differs from its golden-unit reference. Voice:
neutral, technical, no marketing words. Cite specific frequencies
(in GHz) and dB values when relevant. If the sweep is within typical
unit-to-unit variation, say so plainly and stop.
"""


async def narrate_vs_golden(
    measured_viz: dict,
    golden_viz: dict,
    deltas: dict | None,
) -> str:
    user_payload = {
        "measured": _digest(measured_viz),
        "golden": _digest(golden_viz),
    }
    if deltas:
        # Convert delta arrays to a compact representation
        deltas_digest = {}
        for k, v in deltas.items():
            arr = v.get("mag_db", [])
            if arr:
                deltas_digest[k] = {
                    "max_abs_db": round(float(np.max(np.abs(arr))), 2),
                    "mean_db":    round(float(np.mean(arr)), 2),
                    "worst_idx":  int(np.argmax(np.abs(arr))),
                }
        user_payload["deltas_mag_db"] = deltas_digest

    return await ai_groq.chat_text(
        system=_NARRATIVE_SYSTEM,
        user="Comparison:\n" + json.dumps(user_payload, indent=2),
        temperature=0.4,
        max_tokens=1000,
    )


# ---------------------------------------------------------------------------
# 3. Suggest cal set
# ---------------------------------------------------------------------------


_CALSET_SYSTEM = """\
You match a raw uncalibrated VNA sweep to the best-fitting stored
calibration set based on metadata. Return JSON:

  { "best_match_id": <int or null>,
    "confidence": "high"|"medium"|"low",
    "reason": "<one sentence>" }

Score each candidate by frequency-span overlap and impedance match.
Reject candidates whose span doesn't contain the sweep's span.
If none fit, return ``best_match_id: null`` with confidence low.
"""


async def suggest_cal_set(
    raw_sweep_summary: dict,
    candidates: list[dict],
) -> dict:
    if not candidates:
        return {
            "best_match_id": None,
            "confidence": "low",
            "reason": "no calibration sets registered",
        }
    payload = await ai_groq.chat_json(
        system=_CALSET_SYSTEM,
        user=json.dumps({"sweep": raw_sweep_summary, "candidates": candidates}, indent=2),
        max_tokens=400,
    )
    return payload


# ---------------------------------------------------------------------------
# 4. Explain mask failures
# ---------------------------------------------------------------------------


_PASSFAIL_SYSTEM = """\
You write a single paragraph explaining a radar S-parameter mask
failure. Mention the parameter (e.g. S21), the frequency band where
the violation occurred (in GHz), the magnitude of the excursion
(actual vs limit, in dB), and a plausible root cause in lab terms
(e.g. "consistent with a tuning issue on the output match" or
"suggests excessive cable loss"). Keep it factual; do not invent
specific component names.
"""


async def explain_mask_failures(mask_result: dict) -> str:
    failures = mask_result.get("failures", [])
    if not failures:
        return "All mask bands pass."
    return await ai_groq.chat_text(
        system=_PASSFAIL_SYSTEM,
        user="Mask result:\n" + json.dumps(mask_result, indent=2),
        temperature=0.3,
        max_tokens=500,
    )

"""Phase 11 — VNA auto-archive hook.

When the execution runner records a step that captured raw S-parameter
data from a network analyzer driver, it calls ``archive_capture()`` to
persist a ``.s2p`` to ``sparam_sweeps`` automatically. The data is
tagged with ``source='captured'`` and back-references the
``test_run_id`` so the Results page can offer a "View S-parameter
sweep" deep link.

The driver layer is responsible for returning either a Touchstone
string (``raw_data`` field) or an ``s_matrix`` numpy array — the
helper accepts both.
"""

from __future__ import annotations

import json
import logging

import aiosqlite
import numpy as np
import skrf

from config import settings
from services import sparam_io


logger = logging.getLogger(__name__)


async def archive_capture(
    *,
    test_run_id: int | None,
    uut_id: int | None,
    subsystem_id: int | None,
    touchstone_text: str | None = None,
    s_matrix: "np.ndarray | None" = None,
    freq_hz: "np.ndarray | None" = None,
    z0_ohm: float = 50.0,
    filename: str | None = None,
    metadata: dict | None = None,
) -> int | None:
    """Persist a captured sweep. Returns the new ``sparam_sweeps.id`` or
    ``None`` on failure (failures are logged but never raised — auto-
    archive must not break the test run).

    Provide EITHER ``touchstone_text`` OR (``s_matrix`` + ``freq_hz``).
    """
    try:
        if touchstone_text:
            ntwk = sparam_io.parse_touchstone(touchstone_text, filename or "")
        elif s_matrix is not None and freq_hz is not None:
            freq = skrf.Frequency.from_f(np.asarray(freq_hz), unit="hz")
            ntwk = skrf.Network(frequency=freq, s=np.asarray(s_matrix), z0=z0_ohm,
                                name=filename or "capture")
        else:
            logger.warning("archive_capture called without payload")
            return None

        body = sparam_io.write_touchstone_v2(ntwk)
        summ = sparam_io.summarize(ntwk)

        async with aiosqlite.connect(settings.DB_PATH) as db:
            cur = await db.execute(
                """
                INSERT INTO sparam_sweeps (
                    test_run_id, uut_id, subsystem_id, source, filename,
                    n_ports, n_points, f_start_hz, f_stop_hz, z0_ohm,
                    format, touchstone_v2, metadata_json
                ) VALUES (?, ?, ?, 'captured', ?, ?, ?, ?, ?, ?, 'MA', ?, ?)
                """,
                (
                    test_run_id, uut_id, subsystem_id, filename or f"run-{test_run_id}.s2p",
                    summ["n_ports"], summ["n_points"],
                    summ["f_start_hz"], summ["f_stop_hz"], summ["z0_ohm"],
                    body, json.dumps(metadata) if metadata else None,
                ),
            )
            new_id = cur.lastrowid
            await db.commit()
            logger.info(
                "Archived captured sweep id=%s test_run_id=%s n_ports=%s n_points=%s",
                new_id, test_run_id, summ["n_ports"], summ["n_points"],
            )
            return new_id
    except Exception as e:  # noqa: BLE001
        logger.exception("auto-archive failed: %s", e)
        return None

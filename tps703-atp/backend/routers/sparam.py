"""S-parameter workflow API — Phase 11.

Endpoints:
- POST   /api/sparam/sweeps/upload           — upload .sNp file
- GET    /api/sparam/sweeps                  — list (filterable)
- GET    /api/sparam/sweeps/{id}             — full visualisation payload
- GET    /api/sparam/sweeps/{id}/touchstone  — raw v2 download
- GET    /api/sparam/sweeps/{id}/export      — .mat/.npz/.csv
- DELETE /api/sparam/sweeps/{id}
- POST   /api/sparam/cal-sets                — create OSLT cal set
- GET    /api/sparam/cal-sets
- POST   /api/sparam/sweeps/{id}/deembed     — apply cal, store result
- POST   /api/sparam/masks                   — create pass/fail mask
- GET    /api/sparam/masks
- POST   /api/sparam/sweeps/{id}/evaluate    — run mask against sweep
- POST   /api/sparam/golden-refs             — register golden sweep
- GET    /api/sparam/golden-refs
- GET    /api/sparam/sweeps/{id}/compare/{golden_id}
- POST   /api/sparam/sweeps/{id}/ai/anomalies
- POST   /api/sparam/sweeps/{id}/ai/narrate/{golden_id}
- POST   /api/sparam/sweeps/{id}/ai/suggest-cal
- POST   /api/sparam/sweeps/{id}/ai/explain-failures
"""

from __future__ import annotations

import json

import skrf
from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user, require_role
from auth.models import UserInDB
from database import get_db_connection
from services import (
    ai_groq, ai_sparam, rate_limit,
    sparam_compare, sparam_deembed, sparam_export, sparam_io,
)
from services.audit import log_audit


router = APIRouter(
    prefix="/api/sparam",
    tags=["sparam"],
    dependencies=[Depends(get_current_user)],
)


# ============================================================================
# Pydantic models
# ============================================================================


class SweepSummary(BaseModel):
    id: int
    test_run_id: int | None = None
    uut_id: int | None = None
    subsystem_id: int | None = None
    source: str
    origin_sweep_id: int | None = None
    cal_set_id: int | None = None
    filename: str | None = None
    n_ports: int
    n_points: int
    f_start_hz: float
    f_stop_hz: float
    z0_ohm: float
    created_at: str | None = None


class MaskBand(BaseModel):
    f_start_hz: float
    f_stop_hz: float
    param: str = "s21"
    quantity: str = "mag_db"
    min: float | None = None
    max: float | None = None


class MaskCreate(BaseModel):
    name: str
    subsystem_id: int | None = None
    param: str = "s21"
    quantity: str = "mag_db"
    bands: list[MaskBand]


class CalSetCreate(BaseModel):
    name: str
    description: str | None = None
    cal_type: str = "OSLT"
    open_sweep_id: int | None = None
    short_sweep_id: int | None = None
    load_sweep_id: int | None = None
    thru_sweep_id: int | None = None


class GoldenRefCreate(BaseModel):
    name: str
    subsystem_id: int | None = None
    uut_family: str | None = None
    sweep_id: int
    notes: str | None = None


class DeembedRequest(BaseModel):
    cal_set_id: int


class EvaluateRequest(BaseModel):
    mask_id: int


# ============================================================================
# Helpers
# ============================================================================


def _row_to_summary(row) -> SweepSummary:
    return SweepSummary(
        id=row["id"],
        test_run_id=row["test_run_id"],
        uut_id=row["uut_id"],
        subsystem_id=row["subsystem_id"],
        source=row["source"],
        origin_sweep_id=row["origin_sweep_id"],
        cal_set_id=row["cal_set_id"],
        filename=row["filename"],
        n_ports=row["n_ports"],
        n_points=row["n_points"],
        f_start_hz=row["f_start_hz"],
        f_stop_hz=row["f_stop_hz"],
        z0_ohm=row["z0_ohm"],
        created_at=row["created_at"],
    )


async def _load_network(db, sweep_id: int) -> "skrf.Network":
    cur = await db.execute(
        "SELECT touchstone_v2, filename FROM sparam_sweeps WHERE id = ?", (sweep_id,)
    )
    row = await cur.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sweep not found")
    return sparam_io.parse_touchstone(row["touchstone_v2"], row["filename"] or "")


async def _insert_sweep(
    db,
    *,
    ntwk: "skrf.Network",
    source: str,
    filename: str | None = None,
    test_run_id: int | None = None,
    uut_id: int | None = None,
    subsystem_id: int | None = None,
    origin_sweep_id: int | None = None,
    cal_set_id: int | None = None,
    uploaded_by: int | str | None = None,
    metadata: dict | None = None,
) -> int:
    summ = sparam_io.summarize(ntwk)
    body = sparam_io.write_touchstone_v2(ntwk)
    cur = await db.execute(
        """
        INSERT INTO sparam_sweeps (
            test_run_id, uut_id, subsystem_id, source, origin_sweep_id,
            cal_set_id, filename, n_ports, n_points, f_start_hz, f_stop_hz,
            z0_ohm, format, touchstone_v2, metadata_json, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MA', ?, ?, ?)
        """,
        (
            test_run_id, uut_id, subsystem_id, source, origin_sweep_id,
            cal_set_id, filename,
            summ["n_ports"], summ["n_points"], summ["f_start_hz"],
            summ["f_stop_hz"], summ["z0_ohm"],
            body,
            json.dumps(metadata) if metadata else None,
            uploaded_by,
        ),
    )
    return cur.lastrowid


# ============================================================================
# Sweeps — upload / list / detail / delete
# ============================================================================


@router.post(
    "/sweeps/upload",
    response_model=SweepSummary,
    dependencies=[Depends(require_role("technician"))],
)
async def upload_sweep(
    file: UploadFile = File(...),
    test_run_id: int | None = None,
    uut_id: int | None = None,
    subsystem_id: int | None = None,
    user: UserInDB = Depends(get_current_user),
):
    raw = await file.read()
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "file is not UTF-8 text")

    try:
        ntwk = sparam_io.parse_touchstone(text, file.filename or "")
    except sparam_io.TouchstoneError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            {"message": str(e), "line": e.line, "column": e.column},
        )

    db = await get_db_connection()
    try:
        sweep_id = await _insert_sweep(
            db, ntwk=ntwk, source="uploaded",
            filename=file.filename,
            test_run_id=test_run_id, uut_id=uut_id, subsystem_id=subsystem_id,
            uploaded_by=user.id,
        )
        await db.commit()
        cur = await db.execute(
            "SELECT * FROM sparam_sweeps WHERE id = ?", (sweep_id,)
        )
        row = await cur.fetchone()
    finally:
        await db.close()

    await log_audit(
        user.id, "sparam_upload", "sparam_sweep", sweep_id,
        f"{file.filename} npoints={ntwk.n_points if hasattr(ntwk, 'n_points') else len(ntwk.f)}",
    )
    return _row_to_summary(row)


@router.get("/sweeps", response_model=list[SweepSummary])
async def list_sweeps(
    subsystem_id: int | None = None,
    uut_id: int | None = None,
    test_run_id: int | None = None,
    source: str | None = None,
    limit: int = 100,
):
    conds = []
    params: list = []
    for col, val in (
        ("subsystem_id", subsystem_id),
        ("uut_id", uut_id),
        ("test_run_id", test_run_id),
        ("source", source),
    ):
        if val is not None:
            conds.append(f"{col} = ?")
            params.append(val)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    params.append(limit)

    db = await get_db_connection()
    try:
        cur = await db.execute(
            f"SELECT * FROM sparam_sweeps {where} ORDER BY id DESC LIMIT ?",
            params,
        )
        rows = await cur.fetchall()
        return [_row_to_summary(r) for r in rows]
    finally:
        await db.close()


@router.get("/sweeps/{sweep_id}")
async def get_sweep(sweep_id: int):
    db = await get_db_connection()
    try:
        cur = await db.execute("SELECT * FROM sparam_sweeps WHERE id = ?", (sweep_id,))
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "sweep not found")
        ntwk = sparam_io.parse_touchstone(row["touchstone_v2"], row["filename"] or "")
        viz = sparam_io.to_visualisation(ntwk)
        return {"summary": _row_to_summary(row).model_dump(), "viz": viz}
    finally:
        await db.close()


@router.get("/sweeps/{sweep_id}/touchstone")
async def get_touchstone(sweep_id: int):
    db = await get_db_connection()
    try:
        cur = await db.execute(
            "SELECT touchstone_v2, filename, n_ports FROM sparam_sweeps WHERE id = ?",
            (sweep_id,),
        )
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "sweep not found")
        ext = f".s{row['n_ports']}p"
        base = (row["filename"] or f"sweep-{sweep_id}").rsplit(".", 1)[0]
        return Response(
            content=row["touchstone_v2"],
            media_type="text/plain",
            headers={"Content-Disposition": f'attachment; filename="{base}{ext}"'},
        )
    finally:
        await db.close()


@router.get("/sweeps/{sweep_id}/export")
async def export_sweep(sweep_id: int, fmt: str = "csv"):
    db = await get_db_connection()
    try:
        cur = await db.execute(
            "SELECT touchstone_v2, filename FROM sparam_sweeps WHERE id = ?",
            (sweep_id,),
        )
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "sweep not found")
        ntwk = sparam_io.parse_touchstone(row["touchstone_v2"], row["filename"] or "")
    finally:
        await db.close()

    basename = (row["filename"] or f"sweep-{sweep_id}").rsplit(".", 1)[0]
    fmt = fmt.lower()
    if fmt == "mat":
        data, mime, name = sparam_export.export_mat(ntwk, basename)
    elif fmt == "npz":
        data, mime, name = sparam_export.export_npz(ntwk, basename)
    elif fmt == "csv":
        data, mime, name = sparam_export.export_csv(ntwk, basename)
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "fmt must be csv|mat|npz")

    return Response(
        content=data, media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.delete(
    "/sweeps/{sweep_id}",
    dependencies=[Depends(require_role("engineer"))],
)
async def delete_sweep(sweep_id: int, user: UserInDB = Depends(get_current_user)):
    db = await get_db_connection()
    try:
        await db.execute("DELETE FROM sparam_sweeps WHERE id = ?", (sweep_id,))
        await db.commit()
    finally:
        await db.close()
    await log_audit(user.id, "sparam_delete", "sparam_sweep", sweep_id)
    return {"deleted": sweep_id}


# ============================================================================
# Cal sets
# ============================================================================


@router.post(
    "/cal-sets",
    dependencies=[Depends(require_role("engineer"))],
)
async def create_cal_set(body: CalSetCreate, user: UserInDB = Depends(get_current_user)):
    db = await get_db_connection()
    try:
        # Compute span from open sweep if available
        f_start = f_stop = None
        if body.open_sweep_id:
            cur = await db.execute(
                "SELECT f_start_hz, f_stop_hz FROM sparam_sweeps WHERE id = ?",
                (body.open_sweep_id,),
            )
            srow = await cur.fetchone()
            if srow:
                f_start, f_stop = srow["f_start_hz"], srow["f_stop_hz"]
        cur = await db.execute(
            """
            INSERT INTO sparam_cal_sets (
                name, description, cal_type, f_start_hz, f_stop_hz,
                open_sweep_id, short_sweep_id, load_sweep_id, thru_sweep_id, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                body.name, body.description, body.cal_type, f_start, f_stop,
                body.open_sweep_id, body.short_sweep_id, body.load_sweep_id,
                body.thru_sweep_id, user.id,
            ),
        )
        new_id = cur.lastrowid
        await db.commit()
        cur = await db.execute("SELECT * FROM sparam_cal_sets WHERE id = ?", (new_id,))
        row = await cur.fetchone()
    finally:
        await db.close()
    await log_audit(user.id, "sparam_cal_create", "sparam_cal_set", new_id, body.name)
    return dict(row)


@router.get("/cal-sets")
async def list_cal_sets():
    db = await get_db_connection()
    try:
        cur = await db.execute("SELECT * FROM sparam_cal_sets ORDER BY id DESC")
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@router.post(
    "/sweeps/{sweep_id}/deembed",
    response_model=SweepSummary,
    dependencies=[Depends(require_role("engineer"))],
)
async def deembed_sweep(
    sweep_id: int,
    body: DeembedRequest,
    user: UserInDB = Depends(get_current_user),
):
    db = await get_db_connection()
    try:
        cur = await db.execute("SELECT * FROM sparam_cal_sets WHERE id = ?", (body.cal_set_id,))
        cal = await cur.fetchone()
        if cal is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "cal set not found")

        raw = await _load_network(db, sweep_id)

        async def load(id_):
            return None if id_ is None else await _load_network(db, id_)
        open_n = await load(cal["open_sweep_id"])
        short_n = await load(cal["short_sweep_id"])
        load_n = await load(cal["load_sweep_id"])
        thru_n = await load(cal["thru_sweep_id"])

        missing = [n for n, v in [("open", open_n), ("short", short_n), ("load", load_n)] if v is None]
        if missing:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"cal set is missing required sweep(s): {', '.join(missing)}",
            )

        try:
            calibrated = sparam_deembed.deembed(
                raw,
                cal_type=cal["cal_type"],
                open_sweep=open_n,
                short_sweep=short_n,
                load_sweep=load_n,
                thru_sweep=thru_n,
            )
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"de-embed failed: {e}")

        new_id = await _insert_sweep(
            db, ntwk=calibrated, source="de_embedded",
            filename=f"deembed-of-{sweep_id}",
            origin_sweep_id=sweep_id,
            cal_set_id=body.cal_set_id,
            uploaded_by=user.id,
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM sparam_sweeps WHERE id = ?", (new_id,))
        row = await cur.fetchone()
    finally:
        await db.close()

    await log_audit(
        user.id, "sparam_deembed", "sparam_sweep", new_id,
        f"raw={sweep_id} cal={body.cal_set_id}",
    )
    return _row_to_summary(row)


# ============================================================================
# Masks
# ============================================================================


@router.post(
    "/masks",
    dependencies=[Depends(require_role("engineer"))],
)
async def create_mask(body: MaskCreate, user: UserInDB = Depends(get_current_user)):
    db = await get_db_connection()
    try:
        cur = await db.execute(
            """
            INSERT INTO sparam_masks (name, subsystem_id, param, quantity, bands_json, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                body.name, body.subsystem_id, body.param, body.quantity,
                json.dumps([b.model_dump() for b in body.bands]),
                user.id,
            ),
        )
        new_id = cur.lastrowid
        await db.commit()
        cur = await db.execute("SELECT * FROM sparam_masks WHERE id = ?", (new_id,))
        row = await cur.fetchone()
    finally:
        await db.close()
    await log_audit(user.id, "sparam_mask_create", "sparam_mask", new_id, body.name)
    return dict(row)


@router.get("/masks")
async def list_masks(subsystem_id: int | None = None):
    db = await get_db_connection()
    try:
        if subsystem_id is not None:
            cur = await db.execute(
                "SELECT * FROM sparam_masks WHERE subsystem_id = ? OR subsystem_id IS NULL ORDER BY id DESC",
                (subsystem_id,),
            )
        else:
            cur = await db.execute("SELECT * FROM sparam_masks ORDER BY id DESC")
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@router.post("/sweeps/{sweep_id}/evaluate")
async def evaluate_against_mask(sweep_id: int, body: EvaluateRequest):
    db = await get_db_connection()
    try:
        cur = await db.execute("SELECT bands_json FROM sparam_masks WHERE id = ?", (body.mask_id,))
        mrow = await cur.fetchone()
        if mrow is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "mask not found")
        bands = json.loads(mrow["bands_json"])
        ntwk = await _load_network(db, sweep_id)
    finally:
        await db.close()
    return sparam_compare.evaluate_mask(ntwk, bands)


# ============================================================================
# Golden references + compare
# ============================================================================


@router.post(
    "/golden-refs",
    dependencies=[Depends(require_role("engineer"))],
)
async def create_golden_ref(
    body: GoldenRefCreate, user: UserInDB = Depends(get_current_user),
):
    db = await get_db_connection()
    try:
        try:
            cur = await db.execute(
                """
                INSERT INTO sparam_golden_refs
                    (name, subsystem_id, uut_family, sweep_id, notes, created_by)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (body.name, body.subsystem_id, body.uut_family, body.sweep_id, body.notes, user.id),
            )
            new_id = cur.lastrowid
            await db.commit()
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status.HTTP_409_CONFLICT, str(e))
        cur = await db.execute("SELECT * FROM sparam_golden_refs WHERE id = ?", (new_id,))
        row = await cur.fetchone()
    finally:
        await db.close()
    await log_audit(user.id, "sparam_golden_create", "sparam_golden_ref", new_id, body.name)
    return dict(row)


@router.get("/golden-refs")
async def list_golden_refs(subsystem_id: int | None = None):
    db = await get_db_connection()
    try:
        if subsystem_id is not None:
            cur = await db.execute(
                "SELECT * FROM sparam_golden_refs WHERE subsystem_id = ? ORDER BY id DESC",
                (subsystem_id,),
            )
        else:
            cur = await db.execute("SELECT * FROM sparam_golden_refs ORDER BY id DESC")
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@router.get("/sweeps/{sweep_id}/compare/{golden_id}")
async def compare_with_golden(sweep_id: int, golden_id: int):
    db = await get_db_connection()
    try:
        cur = await db.execute(
            "SELECT sweep_id FROM sparam_golden_refs WHERE id = ?", (golden_id,)
        )
        gref = await cur.fetchone()
        if gref is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "golden ref not found")
        measured = await _load_network(db, sweep_id)
        golden = await _load_network(db, gref["sweep_id"])
    finally:
        await db.close()
    return sparam_compare.overlay(measured, golden)


# ============================================================================
# AI helpers
# ============================================================================


def _ai_error_to_http(exc: Exception) -> HTTPException:
    if isinstance(exc, ai_groq.GroqNotConfigured):
        return HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI feature requires GROQ_API_KEY.",
        )
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Groq error: {exc}")


@router.post(
    "/sweeps/{sweep_id}/ai/anomalies",
    dependencies=[Depends(require_role("engineer"))],
)
async def ai_anomalies(sweep_id: int, user: UserInDB = Depends(get_current_user)):
    rate_limit.check_and_record(user)
    db = await get_db_connection()
    try:
        ntwk = await _load_network(db, sweep_id)
        viz = sparam_io.to_visualisation(ntwk)

        # Build a small history digest from the same uut/subsystem
        cur = await db.execute(
            "SELECT subsystem_id, uut_id FROM sparam_sweeps WHERE id = ?", (sweep_id,)
        )
        meta = await cur.fetchone()
        cur = await db.execute(
            """
            SELECT touchstone_v2, filename FROM sparam_sweeps
            WHERE (subsystem_id = ? OR ? IS NULL)
              AND id != ?
              AND source IN ('uploaded','captured','de_embedded')
            ORDER BY id DESC LIMIT 10
            """,
            (meta["subsystem_id"], meta["subsystem_id"], sweep_id),
        )
        history = []
        for r in await cur.fetchall():
            try:
                hn = sparam_io.parse_touchstone(r["touchstone_v2"], r["filename"] or "")
                history.append(sparam_io.to_visualisation(hn))
            except Exception:
                continue
    finally:
        await db.close()

    try:
        anomalies = await ai_sparam.detect_anomalies(viz, history)
    except Exception as e:  # noqa: BLE001
        raise _ai_error_to_http(e)

    await log_audit(
        user.id, "sparam_ai_anomalies", "sparam_sweep", sweep_id,
        f"{len(anomalies)} flagged",
    )
    return {"anomalies": anomalies, "history_count": len(history)}


@router.post(
    "/sweeps/{sweep_id}/ai/narrate/{golden_id}",
    dependencies=[Depends(require_role("engineer"))],
)
async def ai_narrate(sweep_id: int, golden_id: int, user: UserInDB = Depends(get_current_user)):
    rate_limit.check_and_record(user)
    db = await get_db_connection()
    try:
        cur = await db.execute(
            "SELECT sweep_id FROM sparam_golden_refs WHERE id = ?", (golden_id,)
        )
        gref = await cur.fetchone()
        if gref is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "golden ref not found")
        measured = await _load_network(db, sweep_id)
        golden = await _load_network(db, gref["sweep_id"])
    finally:
        await db.close()

    overlay = sparam_compare.overlay(measured, golden)
    try:
        text = await ai_sparam.narrate_vs_golden(
            overlay["measured"], overlay["golden"], overlay["deltas"],
        )
    except Exception as e:  # noqa: BLE001
        raise _ai_error_to_http(e)
    await log_audit(
        user.id, "sparam_ai_narrate", "sparam_sweep", sweep_id,
        f"golden={golden_id}",
    )
    return {"narrative": text}


@router.post(
    "/sweeps/{sweep_id}/ai/suggest-cal",
    dependencies=[Depends(require_role("engineer"))],
)
async def ai_suggest_cal(sweep_id: int, user: UserInDB = Depends(get_current_user)):
    rate_limit.check_and_record(user)
    db = await get_db_connection()
    try:
        cur = await db.execute("SELECT * FROM sparam_sweeps WHERE id = ?", (sweep_id,))
        s = await cur.fetchone()
        if s is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "sweep not found")
        cur = await db.execute("SELECT * FROM sparam_cal_sets")
        cals = [dict(c) for c in await cur.fetchall()]
    finally:
        await db.close()

    sweep_summary = {
        "n_ports": s["n_ports"],
        "f_start_hz": s["f_start_hz"], "f_stop_hz": s["f_stop_hz"],
        "z0_ohm": s["z0_ohm"], "filename": s["filename"],
    }
    try:
        out = await ai_sparam.suggest_cal_set(sweep_summary, cals)
    except Exception as e:  # noqa: BLE001
        raise _ai_error_to_http(e)
    return out


@router.post(
    "/sweeps/{sweep_id}/ai/explain-failures",
    dependencies=[Depends(require_role("engineer"))],
)
async def ai_explain_failures(
    sweep_id: int,
    body: EvaluateRequest,
    user: UserInDB = Depends(get_current_user),
):
    rate_limit.check_and_record(user)
    # Run the evaluation
    db = await get_db_connection()
    try:
        cur = await db.execute("SELECT bands_json FROM sparam_masks WHERE id = ?", (body.mask_id,))
        mrow = await cur.fetchone()
        if mrow is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "mask not found")
        bands = json.loads(mrow["bands_json"])
        ntwk = await _load_network(db, sweep_id)
    finally:
        await db.close()

    result = sparam_compare.evaluate_mask(ntwk, bands)
    try:
        explanation = await ai_sparam.explain_mask_failures(result)
    except Exception as e:  # noqa: BLE001
        raise _ai_error_to_http(e)
    return {"explanation": explanation, "result": result}

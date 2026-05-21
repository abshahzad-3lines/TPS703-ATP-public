"""PDF test certificate generator for TPS-703 ATP system.

Uses reportlab to produce a professional Acceptance Test Procedure
certificate with header block, results table, summary, and signature area.
"""

import io
from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    PageBreak,
)

import dbx
from config import settings

# Colours used in the certificate
PASS_BG = colors.Color(0.85, 0.95, 0.85)  # light green
FAIL_BG = colors.Color(0.95, 0.85, 0.85)  # light red
WARNING_BG = colors.Color(0.98, 0.95, 0.80)  # light amber
HEADER_BG = colors.Color(0.15, 0.22, 0.35)  # dark navy
HEADER_FG = colors.white
BORDER_COLOR = colors.Color(0.3, 0.3, 0.3)
CAGE_CODE = "97942"


async def _fetch_run_data(run_id: int) -> dict[str, Any] | None:
    """Fetch all data needed for the certificate from the database."""
    async with dbx.connect() as db:

        # Test run
        cursor = await db.execute("SELECT * FROM test_runs WHERE id = ?", (run_id,))
        run = await cursor.fetchone()
        if run is None:
            return None

        # Procedure
        cursor = await db.execute(
            "SELECT * FROM test_procedures WHERE id = ?", (run["procedure_id"],)
        )
        procedure = await cursor.fetchone()

        # Subsystem
        cursor = await db.execute(
            "SELECT * FROM subsystems WHERE id = ?", (procedure["subsystem_id"],)
        )
        subsystem = await cursor.fetchone()

        # UUT
        cursor = await db.execute(
            "SELECT * FROM units_under_test WHERE id = ?", (run["uut_id"],)
        )
        uut = await cursor.fetchone()

        # Operator
        cursor = await db.execute(
            "SELECT * FROM users WHERE id = ?", (run["started_by"],)
        )
        operator = await cursor.fetchone()

        # Signing engineer (if signed)
        signer = None
        if run["signed_by"]:
            cursor = await db.execute(
                "SELECT * FROM users WHERE id = ?", (run["signed_by"],)
            )
            signer = await cursor.fetchone()

        # Steps and results
        cursor = await db.execute(
            """
            SELECT ts.*, tr.measured_value, tr.secondary_value,
                   tr.pass_fail AS result_status, tr.measured_at
            FROM test_steps ts
            LEFT JOIN test_results tr
                ON tr.step_id = ts.id AND tr.test_run_id = ?
            WHERE ts.procedure_id = ?
            ORDER BY ts.step_number
            """,
            (run_id, run["procedure_id"]),
        )
        steps = await cursor.fetchall()

    return {
        "run": dict(run),
        "procedure": dict(procedure),
        "subsystem": dict(subsystem),
        "uut": dict(uut),
        "operator": dict(operator),
        "signer": dict(signer) if signer else None,
        "steps": [dict(s) for s in steps],
    }


def _status_label(status: str) -> str:
    """Return a display-friendly status label."""
    return status.upper() if status else "UNKNOWN"


def _format_limit(step: dict) -> str:
    """Format the limit specification for display."""
    lt = step.get("limit_type")
    if lt == "min_max":
        lo = step.get("limit_min")
        hi = step.get("limit_max")
        parts = []
        if lo is not None:
            parts.append(f">= {lo}")
        if hi is not None:
            parts.append(f"<= {hi}")
        return " & ".join(parts) if parts else "-"
    elif lt == "tolerance":
        nom = step.get("limit_nominal")
        tol = step.get("limit_tolerance")
        if nom is not None and tol is not None:
            return f"{nom} +/- {tol}"
        return str(nom) if nom is not None else "-"
    elif lt == "min":
        lo = step.get("limit_min")
        return f">= {lo}" if lo is not None else "-"
    elif lt == "max":
        hi = step.get("limit_max")
        return f"<= {hi}" if hi is not None else "-"
    elif lt == "exact":
        nom = step.get("limit_nominal")
        return str(nom) if nom is not None else "-"
    return "-"


def _result_color(status: str | None) -> colors.Color:
    """Return the row background colour based on result status."""
    if status == "pass":
        return PASS_BG
    elif status == "fail":
        return FAIL_BG
    elif status == "warning":
        return WARNING_BG
    return colors.white


def _build_pdf(data: dict[str, Any]) -> bytes:
    """Build the PDF certificate and return the raw bytes."""
    buf = io.BytesIO()
    page_size = landscape(letter)
    doc = SimpleDocTemplate(
        buf,
        pagesize=page_size,
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.5 * inch,
    )

    styles = getSampleStyleSheet()
    elements: list = []

    # Custom styles
    title_style = ParagraphStyle(
        "CertTitle",
        parent=styles["Title"],
        fontSize=16,
        leading=20,
        spaceAfter=4,
        alignment=1,  # centre
    )
    subtitle_style = ParagraphStyle(
        "CertSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        alignment=1,
        textColor=colors.gray,
    )
    section_style = ParagraphStyle(
        "SectionHead",
        parent=styles["Heading2"],
        fontSize=12,
        leading=14,
        spaceBefore=12,
        spaceAfter=6,
        textColor=colors.Color(0.15, 0.22, 0.35),
    )
    small_style = ParagraphStyle(
        "SmallText",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
    )
    footer_style = ParagraphStyle(
        "FooterText",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
        alignment=1,
        textColor=colors.gray,
    )

    run = data["run"]
    proc = data["procedure"]
    sub = data["subsystem"]
    uut = data["uut"]
    op = data["operator"]
    signer = data["signer"]
    steps = data["steps"]

    # ------------------------------------------------------------------
    # Title
    # ------------------------------------------------------------------
    elements.append(Paragraph(
        "ACCEPTANCE TEST PROCEDURE &mdash; TEST CERTIFICATE",
        title_style,
    ))
    elements.append(Paragraph(
        f"CAGE Code {CAGE_CODE} &bull; Northrop Grumman",
        subtitle_style,
    ))
    elements.append(Spacer(1, 12))

    # ------------------------------------------------------------------
    # Header info table
    # ------------------------------------------------------------------
    status_text = _status_label(run.get("status"))
    status_color = (
        colors.Color(0.0, 0.55, 0.0) if status_text == "PASSED"
        else colors.Color(0.75, 0.0, 0.0) if status_text == "FAILED"
        else colors.Color(0.7, 0.5, 0.0)
    )

    header_data = [
        [
            Paragraph(f"<b>Drawing No:</b> {sub.get('drawing_no', '-')}", small_style),
            Paragraph(f"<b>Subsystem:</b> {sub.get('name', '-')}", small_style),
            Paragraph(f"<b>Assembly No:</b> {sub.get('assembly_no', '-')}", small_style),
        ],
        [
            Paragraph(f"<b>Procedure:</b> {proc.get('code', '-')}", small_style),
            Paragraph(f"<b>Procedure Name:</b> {proc.get('name', '-')}", small_style),
            Paragraph(f"<b>Section Ref:</b> {proc.get('section_ref', '-')}", small_style),
        ],
        [
            Paragraph(f"<b>Serial Number:</b> {uut.get('serial_number', '-')}", small_style),
            Paragraph(f"<b>Operator:</b> {op.get('full_name', '-')}", small_style),
            Paragraph(f"<b>Test Run ID:</b> {run.get('id', '-')}", small_style),
        ],
        [
            Paragraph(f"<b>Test Date:</b> {run.get('started_at', '-')}", small_style),
            Paragraph(f"<b>Completed:</b> {run.get('completed_at', '-') or 'In progress'}", small_style),
            Paragraph(
                f"<b>Status:</b> <font color='{'#008800' if status_text == 'PASSED' else '#CC0000' if status_text == 'FAILED' else '#B08000'}'>"
                f"{status_text}</font>",
                small_style,
            ),
        ],
    ]

    col_width = (page_size[0] - 1.0 * inch) / 3
    header_table = Table(header_data, colWidths=[col_width] * 3)
    header_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1, BORDER_COLOR),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.Color(0.7, 0.7, 0.7)),
        ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.92, 0.94, 0.97)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 14))

    # ------------------------------------------------------------------
    # Results table
    # ------------------------------------------------------------------
    elements.append(Paragraph("Test Results", section_style))

    table_header = [
        "Step #", "Parameter", "Freq (MHz)", "Input (dBm)",
        "Limit", "Measured", "Unit", "Result",
    ]

    table_data = [table_header]
    for s in steps:
        freq = s.get("frequency_mhz")
        freq_str = f"{freq}" if freq is not None else "-"
        inp = s.get("input_power_dbm")
        inp_str = f"{inp}" if inp is not None else "-"
        meas = s.get("measured_value")
        meas_str = f"{meas}" if meas is not None else "-"
        unit = s.get("unit") or "-"
        result_status = s.get("result_status") or "pending"

        table_data.append([
            str(s.get("step_number", "")),
            s.get("name", ""),
            freq_str,
            inp_str,
            _format_limit(s),
            meas_str,
            unit,
            result_status.upper(),
        ])

    # Calculate column widths — landscape letter is ~10" usable
    usable = page_size[0] - 1.0 * inch
    col_widths = [
        usable * 0.06,   # Step #
        usable * 0.28,   # Parameter
        usable * 0.09,   # Freq
        usable * 0.09,   # Input
        usable * 0.16,   # Limit
        usable * 0.12,   # Measured
        usable * 0.08,   # Unit
        usable * 0.12,   # Result
    ]

    results_table = Table(table_data, colWidths=col_widths, repeatRows=1)

    # Build style commands
    style_cmds: list = [
        # Header row
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), HEADER_FG),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),   # Step #
        ("ALIGN", (2, 0), (3, -1), "CENTER"),    # Freq, Input
        ("ALIGN", (5, 0), (5, -1), "CENTER"),    # Measured
        ("ALIGN", (7, 0), (7, -1), "CENTER"),    # Result
        ("BOX", (0, 0), (-1, -1), 1, BORDER_COLOR),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.Color(0.75, 0.75, 0.75)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]

    # Alternating row colours based on pass/fail
    for idx, s in enumerate(steps):
        row = idx + 1  # account for header
        bg = _result_color(s.get("result_status"))
        style_cmds.append(("BACKGROUND", (0, row), (-1, row), bg))

    results_table.setStyle(TableStyle(style_cmds))
    elements.append(results_table)
    elements.append(Spacer(1, 14))

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    elements.append(Paragraph("Summary", section_style))

    total = len(steps)
    passed = sum(1 for s in steps if s.get("result_status") == "pass")
    failed = sum(1 for s in steps if s.get("result_status") == "fail")
    warnings = sum(1 for s in steps if s.get("result_status") == "warning")
    pending = total - passed - failed - warnings

    summary_data = [
        ["Total Steps", "Passed", "Failed", "Warnings", "Pending"],
        [str(total), str(passed), str(failed), str(warnings), str(pending)],
    ]

    summary_width = usable * 0.12
    summary_table = Table(summary_data, colWidths=[summary_width] * 5)
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), HEADER_FG),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BOX", (0, 0), (-1, -1), 1, BORDER_COLOR),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.Color(0.75, 0.75, 0.75)),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        # Colour-code the counts row
        ("BACKGROUND", (1, 1), (1, 1), PASS_BG),
        ("BACKGROUND", (2, 1), (2, 1), FAIL_BG if failed > 0 else colors.white),
        ("BACKGROUND", (3, 1), (3, 1), WARNING_BG if warnings > 0 else colors.white),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 20))

    # ------------------------------------------------------------------
    # Signature block
    # ------------------------------------------------------------------
    elements.append(Paragraph("Sign-off", section_style))

    sig_hash = run.get("signature_hash") or "Not signed"
    signer_name = signer.get("full_name") if signer else "________________"
    signer_badge = signer.get("badge_id") if signer else ""

    sig_data = [
        [
            Paragraph(f"<b>Engineer Sign-off:</b> {signer_name}", small_style),
            Paragraph(f"<b>Badge ID:</b> {signer_badge}", small_style),
            Paragraph(f"<b>Signature Hash:</b> {sig_hash}", small_style),
        ],
    ]
    sig_table = Table(sig_data, colWidths=[col_width] * 3)
    sig_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1, BORDER_COLOR),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.Color(0.75, 0.75, 0.75)),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(sig_table)
    elements.append(Spacer(1, 24))

    # ------------------------------------------------------------------
    # Footer
    # ------------------------------------------------------------------
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    elements.append(Paragraph(
        f"Generated by TPS-703 ATP System &bull; {now_utc}",
        footer_style,
    ))

    # Build the PDF
    doc.build(elements)
    return buf.getvalue()


async def generate_test_certificate(run_id: int) -> bytes | None:
    """Generate a PDF test certificate for the given run_id.

    Returns the raw PDF bytes, or None if the run_id does not exist.
    """
    data = await _fetch_run_data(run_id)
    if data is None:
        return None
    return _build_pdf(data)

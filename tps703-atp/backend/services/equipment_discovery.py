"""Equipment discovery service: enumerate VISA resources and mDNS-advertised LAN instruments.

Provides three primary entry points:

* :func:`discover_visa` — uses PyVISA's :class:`ResourceManager` to enumerate every
  VISA resource the local installation can see (GPIB, USB-TMC, VXI-11, raw TCPIP).
  Each resource is opened with a short timeout, queried with ``*IDN?``, and
  classified.
* :func:`discover_lan_mdns` — listens on the local network for the ``_lxi``,
  ``_scpi-raw``, and ``_vxi-11`` mDNS service types using the ``zeroconf``
  package, then probes each advertised host:port with a TCP ``*IDN?`` query.
* :func:`discover_all` — runs both, dedups, and annotates each entry with
  ``already_registered`` based on the ``equipment`` table.

The model lookup table in :func:`infer_instrument_type` is intentionally small
and easy to extend — add another row whenever a new instrument family appears.
"""

from __future__ import annotations

import asyncio
import logging
import socket
from typing import Any

import aiosqlite

import dbx
from config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# *IDN? parsing and instrument-type inference
# ---------------------------------------------------------------------------


def _normalize_manufacturer(name: str) -> str:
    """Map legacy / pre-rebrand vendor names to their current identity.

    Agilent's Test & Measurement business spun off as Keysight Technologies
    in 2014.  Older instruments shipped before then return the literal
    ``Agilent Technologies`` in ``*IDN?`` even though the modern part is
    Keysight-branded.  Normalize so the UI is consistent with what's printed
    on the chassis today.
    """
    cleaned = name.strip()
    upper = cleaned.upper()
    if upper in ("AGILENT TECHNOLOGIES", "AGILENT", "HEWLETT-PACKARD", "HP", "HEWLETT PACKARD"):
        return "Keysight Technologies"
    return cleaned


def parse_idn(idn: str) -> dict:
    """Split a SCPI ``*IDN?`` response into its four canonical fields.

    The standard form is ``"manufacturer,model,serial,firmware"`` but real
    instruments produce variants such as extra spaces, trailing newlines,
    or fewer than four comma-separated fields.  This helper is tolerant of
    all of these.

    The ``manufacturer`` field is normalized via :func:`_normalize_manufacturer`
    so legacy ``Agilent Technologies`` / ``Hewlett-Packard`` strings come back
    as ``Keysight Technologies``.

    Args:
        idn: The raw ``*IDN?`` response string from an instrument.

    Returns:
        A dict with string keys ``manufacturer``, ``model``, ``serial``,
        and ``firmware``.  Missing fields are returned as empty strings.
    """
    if idn is None:
        return {"manufacturer": "", "model": "", "serial": "", "firmware": ""}

    # Strip surrounding whitespace / newlines and split on commas
    parts = [p.strip() for p in idn.strip().split(",")]
    while len(parts) < 4:
        parts.append("")
    return {
        "manufacturer": _normalize_manufacturer(parts[0]),
        "model": parts[1],
        "serial": parts[2],
        "firmware": parts[3],
    }


# Small lookup table of common instrument models -> ATP instrument role.
# The matcher uses a case-insensitive substring test so an entry like "DSO-X"
# matches "DSO-X 3034A".  Extend this table as new instrument families are
# encountered in the field.
_MODEL_TO_TYPE: list[tuple[str, str]] = [
    # Multimeters
    ("34461A", "multimeter"),
    ("34401A", "multimeter"),
    ("34411A", "multimeter"),
    ("34465A", "multimeter"),
    ("34470A", "multimeter"),
    ("3458A", "multimeter"),
    # Power meters
    ("E4419B", "power_meter"),
    ("E4418B", "power_meter"),
    ("N1911A", "power_meter"),
    ("N1912A", "power_meter"),
    ("N1913A", "power_meter"),
    ("N1914A", "power_meter"),
    # Spectrum analyzers
    ("N9020A", "spectrum_analyzer"),
    ("N9010A", "spectrum_analyzer"),
    ("N9030A", "spectrum_analyzer"),
    ("8563E", "spectrum_analyzer"),
    ("8566B", "spectrum_analyzer"),
    ("8593E", "spectrum_analyzer"),
    # Oscilloscopes
    ("DSO-X", "oscilloscope"),
    ("MSO-X", "oscilloscope"),
    ("DSOX", "oscilloscope"),
    ("MSOX", "oscilloscope"),
    ("54845A", "oscilloscope"),
    ("DPO", "oscilloscope"),
    ("TDS", "oscilloscope"),
    # Network analyzers
    ("E5071C", "network_analyzer"),
    ("E5061B", "network_analyzer"),
    ("N5230A", "network_analyzer"),
    ("8753E", "network_analyzer"),
    ("ZNB", "network_analyzer"),
    # Phase meters
    ("3575A", "phase_meter"),
    # Signal generators (Keysight/Agilent MXG, EXG, PSG; R&S SMA/SMW).
    # Starter set — extend as new families show up.
    ("N5181B", "signal_generator"),
    ("N5182B", "signal_generator"),
    ("N5183B", "signal_generator"),
    ("N5172B", "signal_generator"),
    ("E8257D", "signal_generator"),
    ("E4438C", "signal_generator"),
    ("SMA100B", "signal_generator"),
    ("SMW200A", "signal_generator"),
]

_VALID_ROLES: tuple[str, ...] = (
    "multimeter",
    "power_meter",
    "spectrum_analyzer",
    "oscilloscope",
    "network_analyzer",
    "phase_meter",
    "fft_display",
    "common_bus",
    "signal_generator",
)


def infer_instrument_type(model: str, manufacturer: str) -> str | None:
    """Classify an instrument into one of the ATP instrument roles.

    Args:
        model: The model string (typically the second field of ``*IDN?``).
        manufacturer: The manufacturer string (first field of ``*IDN?``).

    Returns:
        One of ``"multimeter"``, ``"power_meter"``, ``"spectrum_analyzer"``,
        ``"oscilloscope"``, ``"network_analyzer"``, ``"phase_meter"``,
        ``"signal_generator"``, ``"fft_display"``, ``"common_bus"``, or
        ``None`` when no entry in the lookup table matches.
    """
    if not model and not manufacturer:
        return None

    haystack = f"{manufacturer} {model}".upper()
    for needle, role in _MODEL_TO_TYPE:
        if needle.upper() in haystack:
            return role
    return None


# ---------------------------------------------------------------------------
# VISA discovery
# ---------------------------------------------------------------------------


def _classify_visa_resource(resource: str) -> str:
    """Map a VISA resource string to a connection_type column value."""
    upper = resource.upper()
    if upper.startswith("GPIB"):
        return "gpib"
    if upper.startswith("USB"):
        return "usb_tmc"
    if upper.startswith("TCPIP"):
        return "vxi11"
    return "vxi11"


def _probe_visa_resources(timeout_ms: int = 1500) -> list[dict]:
    """Synchronous helper that opens each VISA resource and queries ``*IDN?``.

    Runs entirely in a worker thread (called from :func:`discover_visa`).
    Errors are caught per-resource so one stuck device does not abort the scan.
    """
    try:
        import pyvisa
        from pyvisa import errors as visa_errors
    except ImportError:
        logger.warning("PyVISA not installed — VISA discovery skipped")
        return []

    out: list[dict] = []
    try:
        rm = pyvisa.ResourceManager()
    except Exception as exc:
        logger.warning("Could not create VISA ResourceManager: %s", exc)
        return []

    try:
        try:
            resources = list(rm.list_resources())
        except Exception as exc:
            logger.warning("ResourceManager.list_resources() failed: %s", exc)
            resources = []

        for resource in resources:
            entry: dict[str, Any] = {
                "resource": resource,
                "connection_type": _classify_visa_resource(resource),
                "manufacturer": "",
                "model": "",
                "serial": "",
                "idn": "",
                "instrument_type": None,
            }
            try:
                instr = rm.open_resource(resource)
                instr.timeout = timeout_ms
                try:
                    idn = instr.query("*IDN?").strip()
                    parsed = parse_idn(idn)
                    entry["idn"] = idn
                    entry["manufacturer"] = parsed["manufacturer"]
                    entry["model"] = parsed["model"]
                    entry["serial"] = parsed["serial"]
                    entry["instrument_type"] = infer_instrument_type(
                        parsed["model"], parsed["manufacturer"]
                    )
                finally:
                    try:
                        instr.close()
                    except Exception:
                        pass
            except visa_errors.VisaIOError as exc:
                logger.debug("VISA timeout / error on %s: %s", resource, exc)
                continue
            except Exception as exc:
                logger.debug("Unexpected error probing %s: %s", resource, exc)
                continue
            out.append(entry)
    finally:
        try:
            rm.close()
        except Exception:
            pass
    return out


async def discover_visa() -> list[dict]:
    """Asynchronously enumerate VISA resources and identify each one.

    Returns:
        A list of dicts with keys ``resource``, ``connection_type``,
        ``manufacturer``, ``model``, ``serial``, ``idn``, and
        ``instrument_type``.  Resources that fail to respond to ``*IDN?``
        are skipped silently.
    """
    return await asyncio.to_thread(_probe_visa_resources)


# ---------------------------------------------------------------------------
# mDNS LAN discovery
# ---------------------------------------------------------------------------


_MDNS_SERVICE_TYPES = (
    "_lxi._tcp.local.",
    "_scpi-raw._tcp.local.",
    "_vxi-11._tcp.local.",
)


async def _tcp_idn_probe(host: str, port: int, timeout: float = 1.0) -> str:
    """Send ``*IDN?\\n`` over a raw TCP socket and read one line back.

    Returns the stripped response, or an empty string on any error.
    """
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
    except (asyncio.TimeoutError, OSError):
        return ""

    try:
        writer.write(b"*IDN?\n")
        await writer.drain()
        try:
            data = await asyncio.wait_for(reader.readline(), timeout=timeout)
        except asyncio.TimeoutError:
            return ""
        return data.decode("ascii", errors="replace").strip()
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


def _mdns_collect(timeout: float) -> list[tuple[str, int, str]]:
    """Synchronously collect ``(host, port, service_type)`` tuples via zeroconf.

    Returns the list found within *timeout* seconds.  If zeroconf is not
    installed, returns an empty list.
    """
    try:
        from zeroconf import Zeroconf, ServiceBrowser
    except ImportError:
        logger.warning("zeroconf not installed — mDNS discovery skipped")
        return []

    found: list[tuple[str, int, str]] = []

    class _Listener:
        def add_service(self, zc, type_, name):  # type: ignore[no-redef]
            try:
                info = zc.get_service_info(type_, name, timeout=int(timeout * 1000))
            except Exception:
                return
            if info is None:
                return
            port = info.port
            if not port:
                return
            for addr in info.parsed_addresses() if hasattr(info, "parsed_addresses") else []:
                found.append((addr, int(port), type_))
                return
            # Fallback for older zeroconf versions
            for raw in info.addresses or []:
                try:
                    addr = socket.inet_ntoa(raw)
                except OSError:
                    continue
                found.append((addr, int(port), type_))
                return

        def update_service(self, zc, type_, name):  # type: ignore[no-redef]
            return

        def remove_service(self, zc, type_, name):  # type: ignore[no-redef]
            return

    zc = Zeroconf()
    try:
        listener = _Listener()
        browsers = [ServiceBrowser(zc, st, listener) for st in _MDNS_SERVICE_TYPES]
        # Block this worker thread for the configured period to give services time
        # to advertise.  zeroconf callbacks fire on its internal threads.
        import time as _time

        _time.sleep(timeout)
        for b in browsers:
            try:
                b.cancel()
            except Exception:
                pass
    finally:
        try:
            zc.close()
        except Exception:
            pass
    return found


async def discover_lan_mdns(timeout: float = 3.0) -> list[dict]:
    """Discover LAN-connected SCPI instruments advertised over mDNS.

    Listens on the local network for ``_lxi``, ``_scpi-raw``, and ``_vxi-11``
    service types for *timeout* seconds, then emits *one entry per host*
    (a single instrument can advertise on all three service types) and probes
    its raw-SCPI port with a 2.5-second TCP ``*IDN?`` query.

    Probing is only done against the ``_scpi-raw._tcp.local.`` service (port
    5025).  The other service types use binary protocols (HTTP for ``_lxi``,
    ONC RPC for ``_vxi-11``) that don't respond to a raw ``*IDN?\\n`` query —
    probing them just produces empty rows after a 1-second timeout.

    Args:
        timeout: How long (seconds) to wait for mDNS announcements.

    Returns:
        A list of dicts in the same shape as :func:`discover_visa`.
    """
    services = await asyncio.to_thread(_mdns_collect, timeout)

    # Group all advertised services by host so a single instrument that
    # announces on _scpi-raw + _lxi + _vxi-11 only produces one row.
    by_host: dict[str, list[tuple[int, str]]] = {}
    for host, port, service_type in services:
        by_host.setdefault(host, []).append((port, service_type))

    out: list[dict] = []
    for host, advertised in by_host.items():
        # Prefer the _scpi-raw advertisement (port 5025) for the *IDN? probe.
        # Only that protocol will answer a raw "*IDN?\n" — _lxi (HTTP) and
        # _vxi-11 (ONC RPC) just hold the connection open until timeout.
        scpi_entry = next(
            (
                (port, service_type)
                for port, service_type in advertised
                if service_type == "_scpi-raw._tcp.local."
            ),
            None,
        )
        if scpi_entry is not None:
            probe_port, primary_service = scpi_entry
            idn = await _tcp_idn_probe(host, probe_port, timeout=2.5)
        else:
            # No raw SCPI port advertised — emit the row anyway, just without IDN.
            probe_port, primary_service = advertised[0]
            idn = ""

        parsed = parse_idn(idn) if idn else {
            "manufacturer": "", "model": "", "serial": "", "firmware": "",
        }
        out.append({
            "resource": f"TCPIP::{host}::{probe_port}::SOCKET",
            "connection_type": "tcp_scpi",
            "host": host,
            "port": probe_port,
            "service_type": primary_service,
            "manufacturer": parsed["manufacturer"],
            "model": parsed["model"],
            "serial": parsed["serial"],
            "idn": idn,
            "instrument_type": infer_instrument_type(
                parsed["model"], parsed["manufacturer"]
            ),
        })
    return out


# ---------------------------------------------------------------------------
# Combined discovery + dedup against existing equipment table
# ---------------------------------------------------------------------------


def _dedup_key(entry: dict) -> str:
    """Pick a stable dedup key — serial number when present, else the resource."""
    serial = (entry.get("serial") or "").strip()
    if serial:
        return f"sn:{serial}"
    return f"res:{entry.get('resource', '')}"


async def _registered_serials_and_resources() -> tuple[set[str], set[str]]:
    """Return the set of serial numbers and connection_addresses for ACTIVE equipment.

    Soft-deleted rows (``is_active = 0``) are intentionally excluded so a previously
    deleted instrument can be rediscovered and re-registered without manual cleanup.
    """
    try:
        async with dbx.connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT serial_number, connection_address FROM equipment WHERE is_active = 1"
            )
            rows = await cursor.fetchall()
    except Exception as exc:
        logger.warning("Could not read equipment table for dedup: %s", exc)
        return set(), set()

    serials = {r["serial_number"].strip() for r in rows if r["serial_number"]}
    addrs = {r["connection_address"].strip() for r in rows if r["connection_address"]}
    return serials, addrs


async def discover_all(mdns_timeout: float = 3.0) -> list[dict]:
    """Run both VISA and mDNS discovery, dedup, and annotate with DB state.

    The returned list is suitable for direct rendering in the discovery UI.
    Each entry includes an ``already_registered`` boolean indicating whether
    the equipment table already contains a row with the same serial number
    (or connection address, when no serial is available).
    """
    visa_task = asyncio.create_task(discover_visa())
    mdns_task = asyncio.create_task(discover_lan_mdns(timeout=mdns_timeout))
    visa_results, mdns_results = await asyncio.gather(visa_task, mdns_task)

    by_key: dict[str, dict] = {}
    for entry in list(visa_results) + list(mdns_results):
        key = _dedup_key(entry)
        if key in by_key:
            continue
        by_key[key] = entry

    serials, addrs = await _registered_serials_and_resources()
    out: list[dict] = []
    for entry in by_key.values():
        serial = (entry.get("serial") or "").strip()
        resource = entry.get("resource") or ""
        already = (serial in serials) if serial else (resource in addrs)
        entry["already_registered"] = bool(already)
        out.append(entry)
    return out

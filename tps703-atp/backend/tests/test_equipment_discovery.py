"""Tests for the equipment auto-discovery service and its integration points."""

from __future__ import annotations

import os
import sys
from typing import Any

import aiosqlite
import pytest
import pytest_asyncio

# Ensure bare imports resolve when running from backend/
_backend_dir = os.path.join(os.path.dirname(__file__), os.pardir)
sys.path.insert(0, os.path.abspath(_backend_dir))


# ===================================================================
# parse_idn — many variants
# ===================================================================


class TestParseIdn:
    """Cover normal and degenerate ``*IDN?`` responses."""

    def test_canonical_four_fields(self):
        from services.equipment_discovery import parse_idn

        result = parse_idn("Keysight,34461A,MY12345,A.02.17")
        assert result == {
            "manufacturer": "Keysight",
            "model": "34461A",
            "serial": "MY12345",
            "firmware": "A.02.17",
        }

    def test_extra_whitespace(self):
        from services.equipment_discovery import parse_idn

        result = parse_idn("  Agilent ,  34401A , US12345 , 11-5-2 \n")
        assert result["manufacturer"] == "Agilent"
        assert result["model"] == "34401A"
        assert result["serial"] == "US12345"
        assert result["firmware"] == "11-5-2"

    def test_three_fields_only(self):
        from services.equipment_discovery import parse_idn

        result = parse_idn("Tektronix,DPO4054,C012345")
        assert result["manufacturer"] == "Tektronix"
        assert result["model"] == "DPO4054"
        assert result["serial"] == "C012345"
        assert result["firmware"] == ""

    def test_empty_string(self):
        from services.equipment_discovery import parse_idn

        result = parse_idn("")
        assert result == {
            "manufacturer": "",
            "model": "",
            "serial": "",
            "firmware": "",
        }

    def test_none_input(self):
        from services.equipment_discovery import parse_idn

        result = parse_idn(None)  # type: ignore[arg-type]
        assert result["manufacturer"] == ""
        assert result["model"] == ""

    def test_extra_commas_in_firmware(self):
        from services.equipment_discovery import parse_idn

        # Some instruments include commas inside the firmware field.  We treat
        # the first three commas as separators and let the rest fall into firmware.
        result = parse_idn("HP,8563E,3623A00123,Rev 2.0,Build 5")
        assert result["manufacturer"] == "HP"
        assert result["model"] == "8563E"
        assert result["serial"] == "3623A00123"
        assert result["firmware"] == "Rev 2.0"


# ===================================================================
# infer_instrument_type — every supported role + unknown
# ===================================================================


class TestInferInstrumentType:
    """Verify the lookup table maps each known model to the right role."""

    def test_keysight_multimeter(self):
        from services.equipment_discovery import infer_instrument_type

        assert infer_instrument_type("34461A", "Keysight") == "multimeter"

    def test_legacy_3458a(self):
        from services.equipment_discovery import infer_instrument_type

        assert infer_instrument_type("3458A", "HP") == "multimeter"

    def test_power_meter(self):
        from services.equipment_discovery import infer_instrument_type

        assert infer_instrument_type("E4419B", "Agilent") == "power_meter"
        assert infer_instrument_type("N1911A", "Keysight") == "power_meter"

    def test_spectrum_analyzer(self):
        from services.equipment_discovery import infer_instrument_type

        assert infer_instrument_type("N9020A", "Keysight") == "spectrum_analyzer"
        assert infer_instrument_type("8563E", "HP") == "spectrum_analyzer"

    def test_oscilloscope_substring(self):
        from services.equipment_discovery import infer_instrument_type

        # DSO-X 3034A — model contains "DSO-X"
        assert infer_instrument_type("DSO-X 3034A", "Keysight") == "oscilloscope"
        assert infer_instrument_type("54845A", "Agilent") == "oscilloscope"

    def test_network_analyzer(self):
        from services.equipment_discovery import infer_instrument_type

        assert infer_instrument_type("E5071C", "Keysight") == "network_analyzer"

    def test_unknown_returns_none(self):
        from services.equipment_discovery import infer_instrument_type

        assert infer_instrument_type("FooBar 9000", "Acme Corp") is None

    def test_empty_returns_none(self):
        from services.equipment_discovery import infer_instrument_type

        assert infer_instrument_type("", "") is None


# ===================================================================
# discover_all — dedup by serial number with a monkey-patched discover_visa
# ===================================================================


@pytest.mark.asyncio
async def test_discover_all_dedups_by_serial(monkeypatch):
    """Two scanners reporting the same serial yield only one result."""
    from services import equipment_discovery

    fake_visa = [
        {
            "resource": "TCPIP::192.168.1.10::5025::SOCKET",
            "connection_type": "vxi11",
            "manufacturer": "Keysight",
            "model": "34461A",
            "serial": "MY53000123",
            "idn": "Keysight,34461A,MY53000123,A.02.17",
            "instrument_type": "multimeter",
        },
        {
            "resource": "GPIB0::18::INSTR",
            "connection_type": "gpib",
            "manufacturer": "HP",
            "model": "8563E",
            "serial": "3623A00001",
            "idn": "HP,8563E,3623A00001,Rev 1.0",
            "instrument_type": "spectrum_analyzer",
        },
    ]
    fake_mdns = [
        # Same serial as the first VISA entry — should be deduped out
        {
            "resource": "TCPIP::192.168.1.10::5025::SOCKET",
            "connection_type": "tcp_scpi",
            "host": "192.168.1.10",
            "port": 5025,
            "service_type": "_lxi._tcp.local.",
            "manufacturer": "Keysight",
            "model": "34461A",
            "serial": "MY53000123",
            "idn": "Keysight,34461A,MY53000123,A.02.17",
            "instrument_type": "multimeter",
        },
        # Unique mDNS-only device
        {
            "resource": "TCPIP::192.168.1.20::5025::SOCKET",
            "connection_type": "tcp_scpi",
            "host": "192.168.1.20",
            "port": 5025,
            "service_type": "_scpi-raw._tcp.local.",
            "manufacturer": "Keysight",
            "model": "N1911A",
            "serial": "MY99000222",
            "idn": "Keysight,N1911A,MY99000222,A.01.00",
            "instrument_type": "power_meter",
        },
    ]

    async def _fake_discover_visa() -> list[dict]:
        return fake_visa

    async def _fake_discover_lan(timeout: float = 3.0) -> list[dict]:
        return fake_mdns

    monkeypatch.setattr(equipment_discovery, "discover_visa", _fake_discover_visa)
    monkeypatch.setattr(equipment_discovery, "discover_lan_mdns", _fake_discover_lan)

    results = await equipment_discovery.discover_all(mdns_timeout=0.0)

    serials = sorted(r.get("serial") for r in results)
    assert serials == ["3623A00001", "MY53000123", "MY99000222"]
    assert len(results) == 3
    for entry in results:
        assert "already_registered" in entry
        # Nothing has been registered in the seed DB yet
        assert entry["already_registered"] is False


@pytest.mark.asyncio
async def test_discover_all_marks_already_registered(temp_db, monkeypatch):
    """An entry whose serial is already in the equipment table is flagged."""
    from services import equipment_discovery

    # Pre-insert a row with the target serial number
    async with aiosqlite.connect(temp_db) as db:
        await db.execute(
            """INSERT INTO equipment
                (name, model, manufacturer, serial_number,
                 connection_type, connection_address, is_active, instrument_role)
               VALUES (?, ?, ?, ?, ?, ?, 1, ?)""",
            (
                "Existing DMM",
                "34461A",
                "Keysight",
                "MY53000123",
                "tcp_scpi",
                "192.168.1.10:5025",
                "multimeter",
            ),
        )
        await db.commit()

    fake_visa = [
        {
            "resource": "TCPIP::192.168.1.10::5025::SOCKET",
            "connection_type": "vxi11",
            "manufacturer": "Keysight",
            "model": "34461A",
            "serial": "MY53000123",
            "idn": "Keysight,34461A,MY53000123,A.02.17",
            "instrument_type": "multimeter",
        },
    ]

    async def _fake_visa() -> list[dict]:
        return fake_visa

    async def _fake_lan(timeout: float = 3.0) -> list[dict]:
        return []

    monkeypatch.setattr(equipment_discovery, "discover_visa", _fake_visa)
    monkeypatch.setattr(equipment_discovery, "discover_lan_mdns", _fake_lan)

    results = await equipment_discovery.discover_all(mdns_timeout=0.0)
    assert len(results) == 1
    assert results[0]["already_registered"] is True


# ===================================================================
# auto-register endpoint — happy path through the FastAPI app
# ===================================================================


@pytest_asyncio.fixture
async def auth_app(temp_db):
    """Build a FastAPI app exposing only the equipment router with seeded user."""
    from fastapi import FastAPI

    from routers import equipment as equipment_router

    app = FastAPI()
    app.include_router(equipment_router.router)
    yield app


def _auth_header() -> dict[str, str]:
    """Mint a Bearer token for the seeded test user (role=engineer)."""
    from auth.utils import create_access_token

    token = create_access_token({"sub": "testuser"})
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_auto_register_happy_path(temp_db, auth_app, monkeypatch):
    """POSTing a discovery payload creates rows and returns them."""
    from httpx import ASGITransport, AsyncClient

    payload = {
        "instruments": [
            {
                "resource": "TCPIP::192.168.1.55::5025::SOCKET",
                "connection_type": "tcp_scpi",
                "host": "192.168.1.55",
                "port": 5025,
                "manufacturer": "Keysight",
                "model": "34461A",
                "serial": "MY99NEW001",
                "idn": "Keysight,34461A,MY99NEW001,A.02.17",
                "instrument_type": "multimeter",
                "already_registered": False,
            },
        ]
    }

    transport = ASGITransport(app=auth_app)
    headers = _auth_header()
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/equipment/auto-register", json=payload, headers=headers
        )

    assert resp.status_code == 201, resp.text
    rows = resp.json()
    assert len(rows) == 1
    inserted = rows[0]
    assert inserted["name"] == "Keysight 34461A"
    assert inserted["serial_number"] == "MY99NEW001"
    assert inserted["connection_type"] == "tcp_scpi"
    assert inserted["connection_address"] == "192.168.1.55:5025"
    assert inserted["instrument_role"] == "multimeter"

    # POSTing the same serial again should skip the duplicate
    transport = ASGITransport(app=auth_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/equipment/auto-register", json=payload, headers=headers
        )
    assert resp.status_code == 201
    assert resp.json() == []


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))

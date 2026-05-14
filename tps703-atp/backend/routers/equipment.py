"""Equipment management API — CRUD operations, connection testing, and auto-discovery."""

import logging
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

from auth.dependencies import get_current_user, require_role
from auth.models import UserInDB
from config import settings
from services.audit import log_audit
from services.equipment_autoregister import reconcile_equipment_with_network
from services.equipment_discovery import discover_all


router = APIRouter(prefix="/api/equipment", tags=["equipment"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

CONNECTION_TYPES = ("simulator", "gpib", "usb_tmc", "vxi11", "tcp_scpi", "lan")

INSTRUMENT_ROLE_PATTERN = (
    r"^(multimeter|power_meter|spectrum_analyzer|oscilloscope|"
    r"network_analyzer|phase_meter|signal_generator|fft_display|common_bus)$"
)


class EquipmentCreate(BaseModel):
    """Request body for creating a new equipment record."""

    name: str = Field(..., min_length=1, description="Equipment name")
    model: Optional[str] = None
    manufacturer: Optional[str] = None
    serial_number: Optional[str] = None
    connection_type: Optional[str] = Field(
        None,
        pattern="^(simulator|gpib|usb_tmc|vxi11|tcp_scpi|lan)$",
        description="Connection type: simulator, gpib, usb_tmc, vxi11, tcp_scpi, or lan",
    )
    connection_address: Optional[str] = None
    cal_due_date: Optional[str] = None
    is_active: int = Field(default=1, ge=0, le=1)
    instrument_role: Optional[str] = Field(
        None,
        pattern=INSTRUMENT_ROLE_PATTERN,
        description="Instrument role used to route test steps to this equipment",
    )


class EquipmentUpdate(BaseModel):
    """Request body for updating an equipment record (all fields optional)."""

    name: Optional[str] = Field(None, min_length=1)
    model: Optional[str] = None
    manufacturer: Optional[str] = None
    serial_number: Optional[str] = None
    connection_type: Optional[str] = Field(
        None,
        pattern="^(simulator|gpib|usb_tmc|vxi11|tcp_scpi|lan)$",
    )
    connection_address: Optional[str] = None
    cal_due_date: Optional[str] = None
    is_active: Optional[int] = Field(None, ge=0, le=1)
    instrument_role: Optional[str] = Field(
        None,
        pattern=INSTRUMENT_ROLE_PATTERN,
    )


class EquipmentResponse(BaseModel):
    """Equipment record returned by the API."""

    id: int
    name: str
    model: Optional[str] = None
    manufacturer: Optional[str] = None
    serial_number: Optional[str] = None
    connection_type: Optional[str] = None
    connection_address: Optional[str] = None
    cal_due_date: Optional[str] = None
    is_active: int
    instrument_role: Optional[str] = None


class DiscoveredInstrument(BaseModel):
    """A single instrument returned by the discovery scan."""

    resource: str
    connection_type: str
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial: Optional[str] = None
    idn: Optional[str] = None
    instrument_type: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    service_type: Optional[str] = None
    already_registered: bool = False


class AutoRegisterRequest(BaseModel):
    """Body for /auto-register: a list of accepted discovery entries."""

    instruments: list[DiscoveredInstrument]


class TestConnectionResponse(BaseModel):
    """Result of a connection test."""

    success: bool
    message: str
    idn_string: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_response(row: aiosqlite.Row) -> EquipmentResponse:
    """Convert an aiosqlite Row to an EquipmentResponse."""
    # ``instrument_role`` is added by an idempotent migration; older snapshots
    # of the row may not include the key.
    try:
        role = row["instrument_role"]
    except (IndexError, KeyError):
        role = None
    return EquipmentResponse(
        id=row["id"],
        name=row["name"],
        model=row["model"],
        manufacturer=row["manufacturer"],
        serial_number=row["serial_number"],
        connection_type=row["connection_type"],
        connection_address=row["connection_address"],
        cal_due_date=row["cal_due_date"],
        is_active=row["is_active"],
        instrument_role=role,
    )


# ---------------------------------------------------------------------------
# GET /api/equipment — List all equipment
# ---------------------------------------------------------------------------

@router.get("", response_model=list[EquipmentResponse])
async def list_equipment(
    is_active: Optional[int] = Query(None, ge=0, le=1, description="Filter by active status"),
    connection_type: Optional[str] = Query(None, description="Filter by connection type"),
    current_user: UserInDB = Depends(get_current_user),
) -> list[EquipmentResponse]:
    """List all equipment records with optional filtering."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        conditions: list[str] = []
        params: list = []

        if is_active is not None:
            conditions.append("is_active = ?")
            params.append(is_active)

        if connection_type is not None:
            if connection_type not in CONNECTION_TYPES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid connection_type. Must be one of: {', '.join(CONNECTION_TYPES)}",
                )
            conditions.append("connection_type = ?")
            params.append(connection_type)

        where_clause = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f"SELECT * FROM equipment{where_clause} ORDER BY name"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()

    return [_row_to_response(r) for r in rows]


# ---------------------------------------------------------------------------
# POST /api/equipment — Create new equipment
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=EquipmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_equipment(
    data: EquipmentCreate,
    current_user: UserInDB = Depends(require_role("technician")),
) -> EquipmentResponse:
    """Create a new equipment record. Requires technician role or higher."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            """
            INSERT INTO equipment
                (name, model, manufacturer, serial_number,
                 connection_type, connection_address, cal_due_date, is_active,
                 instrument_role)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.name,
                data.model,
                data.manufacturer,
                data.serial_number,
                data.connection_type,
                data.connection_address,
                data.cal_due_date,
                data.is_active,
                data.instrument_role,
            ),
        )
        equipment_id = cursor.lastrowid
        await db.commit()

        # Fetch the newly created row
        cursor = await db.execute(
            "SELECT * FROM equipment WHERE id = ?", (equipment_id,)
        )
        row = await cursor.fetchone()

    await log_audit(
        user_id=current_user.id,
        action="create",
        entity_type="equipment",
        entity_id=equipment_id,
        details=f"name={data.name} connection_type={data.connection_type}",
    )

    return _row_to_response(row)


# ---------------------------------------------------------------------------
# GET /api/equipment/{id} — Get single equipment record
# ---------------------------------------------------------------------------

@router.get("/{equipment_id}", response_model=EquipmentResponse)
async def get_equipment(
    equipment_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> EquipmentResponse:
    """Get a single equipment record by ID."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM equipment WHERE id = ?", (equipment_id,)
        )
        row = await cursor.fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Equipment with id {equipment_id} not found",
        )

    return _row_to_response(row)


# ---------------------------------------------------------------------------
# PUT /api/equipment/{id} — Update equipment
# ---------------------------------------------------------------------------

@router.put("/{equipment_id}", response_model=EquipmentResponse)
async def update_equipment(
    equipment_id: int,
    data: EquipmentUpdate,
    current_user: UserInDB = Depends(require_role("engineer")),
) -> EquipmentResponse:
    """Update an existing equipment record. Requires engineer role or higher."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Check equipment exists
        cursor = await db.execute(
            "SELECT * FROM equipment WHERE id = ?", (equipment_id,)
        )
        existing = await cursor.fetchone()
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Equipment with id {equipment_id} not found",
            )

        # Build dynamic SET clause from provided fields
        updates: list[str] = []
        params: list = []
        update_data = data.model_dump(exclude_unset=True)

        if not update_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No fields to update",
            )

        for field, value in update_data.items():
            updates.append(f"{field} = ?")
            params.append(value)

        params.append(equipment_id)
        set_clause = ", ".join(updates)

        await db.execute(
            f"UPDATE equipment SET {set_clause} WHERE id = ?",
            params,
        )
        await db.commit()

        # Fetch updated row
        cursor = await db.execute(
            "SELECT * FROM equipment WHERE id = ?", (equipment_id,)
        )
        row = await cursor.fetchone()

    changed_fields = ", ".join(f"{k}={v}" for k, v in update_data.items())
    await log_audit(
        user_id=current_user.id,
        action="update",
        entity_type="equipment",
        entity_id=equipment_id,
        details=f"updated: {changed_fields}",
    )

    return _row_to_response(row)


# ---------------------------------------------------------------------------
# DELETE /api/equipment/{id} — Soft-delete (set is_active=0)
# ---------------------------------------------------------------------------

@router.delete("/{equipment_id}", status_code=status.HTTP_200_OK)
async def delete_equipment(
    equipment_id: int,
    current_user: UserInDB = Depends(require_role("admin")),
) -> dict:
    """Soft-delete an equipment record (set is_active=0). Requires admin role."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            "SELECT * FROM equipment WHERE id = ?", (equipment_id,)
        )
        existing = await cursor.fetchone()
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Equipment with id {equipment_id} not found",
            )

        await db.execute(
            "UPDATE equipment SET is_active = 0 WHERE id = ?",
            (equipment_id,),
        )
        await db.commit()

    await log_audit(
        user_id=current_user.id,
        action="delete",
        entity_type="equipment",
        entity_id=equipment_id,
        details=f"soft-deleted name={existing['name']}",
    )

    return {"detail": f"Equipment {equipment_id} deactivated"}


# ---------------------------------------------------------------------------
# POST /api/equipment/{id}/test-connection — Test connectivity
# ---------------------------------------------------------------------------

@router.post(
    "/{equipment_id}/test-connection",
    response_model=TestConnectionResponse,
)
async def test_connection(
    equipment_id: int,
    current_user: UserInDB = Depends(require_role("technician")),
) -> TestConnectionResponse:
    """Test connectivity to the equipment.

    For 'simulator' connection type, returns immediate success.
    For other types, attempts to instantiate the appropriate driver,
    call connect() + identify(), and returns the IDN string or error.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM equipment WHERE id = ?", (equipment_id,)
        )
        row = await cursor.fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Equipment with id {equipment_id} not found",
        )

    connection_type = row["connection_type"]
    connection_address = row["connection_address"]
    name = row["name"]

    # Simulator always succeeds
    if connection_type == "simulator":
        return TestConnectionResponse(
            success=True,
            message=f"Simulator connection to '{name}' successful",
            idn_string=f"SIMULATED,{name},{row['model'] or 'N/A'},{row['serial_number'] or 'N/A'}",
        )

    if not connection_type:
        return TestConnectionResponse(
            success=False,
            message=f"No connection type configured for '{name}'. Set a valid connection type first.",
        )

    # Delegate to the driver factory so address parsing (host:port split, VISA
    # resource validation, etc.) lives in exactly one place.
    from drivers import driver_factory

    try:
        driver = driver_factory.create_from_equipment(dict(row))
    except NotImplementedError as exc:
        return TestConnectionResponse(success=False, message=str(exc))
    except ValueError as exc:
        return TestConnectionResponse(success=False, message=str(exc))

    try:
        await driver.connect()
        idn = await driver.identify()
        await driver.disconnect()
    except Exception as exc:
        logger.warning(
            "Test-connection failed for equipment id=%s name=%r: %s",
            equipment_id,
            name,
            exc,
        )
        return TestConnectionResponse(
            success=False,
            message=f"Connection failed for '{name}'. Please configure the instrument.",
        )

    return TestConnectionResponse(
        success=True,
        message=f"{connection_type.upper()} connection to '{name}' successful",
        idn_string=idn,
    )


# ---------------------------------------------------------------------------
# POST /api/equipment/discover — Auto-detect VISA + LAN instruments
# ---------------------------------------------------------------------------


@router.post("/discover", response_model=list[DiscoveredInstrument])
async def discover_equipment(
    mdns_timeout: float = Query(3.0, ge=0.5, le=10.0),
    current_user: UserInDB = Depends(require_role("technician")),
) -> list[DiscoveredInstrument]:
    """Run a one-shot discovery scan over VISA and mDNS.

    Returns the list of detected instruments, each annotated with
    ``already_registered`` based on the existing equipment inventory.
    """
    raw = await discover_all(mdns_timeout=mdns_timeout)
    return [DiscoveredInstrument(**entry) for entry in raw]


class ReconcileResponse(BaseModel):
    """Counts returned by /reconcile."""

    discovered: int
    healed: int
    inserted: int
    deactivated: int


@router.post("/reconcile", response_model=ReconcileResponse)
async def reconcile_equipment(
    mdns_timeout: float = Query(3.0, ge=0.5, le=10.0),
    current_user: UserInDB = Depends(require_role("technician")),
) -> ReconcileResponse:
    """Re-discover instruments and heal the equipment table to match.

    Same routine that runs at backend startup — exposed for the Equipment
    page so an operator who plugs the EXE into a new bench can trigger a
    rescan without restarting. Heals stale ``connection_address`` values
    by serial number, inserts brand new instruments, and deactivates
    active rows whose serials weren't seen on the network.
    """
    stats = await reconcile_equipment_with_network(mdns_timeout=mdns_timeout)
    await log_audit(
        user_id=current_user.id,
        action="reconcile",
        entity_type="equipment",
        entity_id=None,
        details=(
            f"discovered={stats['discovered']} healed={stats['healed']} "
            f"inserted={stats['inserted']} deactivated={stats['deactivated']}"
        ),
    )
    return ReconcileResponse(**stats)


# ---------------------------------------------------------------------------
# POST /api/equipment/auto-register — Bulk-register accepted discovery entries
# ---------------------------------------------------------------------------


def _resolve_address(entry: DiscoveredInstrument) -> str:
    """Pick a sensible connection_address value for an inserted equipment row."""
    if entry.connection_type == "tcp_scpi" and entry.host and entry.port:
        return f"{entry.host}:{entry.port}"
    return entry.resource


@router.post(
    "/auto-register",
    response_model=list[EquipmentResponse],
    status_code=status.HTTP_201_CREATED,
)
async def auto_register_equipment(
    body: AutoRegisterRequest,
    current_user: UserInDB = Depends(require_role("technician")),
) -> list[EquipmentResponse]:
    """Insert equipment rows for each accepted discovery entry.

    Skips any entry whose serial number is already registered.  Each new
    equipment row is created with:

    * ``connection_type`` and ``connection_address`` from the discovery entry
    * ``manufacturer``, ``model``, ``serial_number`` from ``*IDN?``
    * ``name = "{manufacturer} {model}"``
    * ``instrument_role`` from the inferred type
    """
    created: list[EquipmentResponse] = []

    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            "SELECT serial_number FROM equipment WHERE serial_number IS NOT NULL AND is_active = 1"
        )
        existing_serials = {
            r["serial_number"].strip()
            for r in await cursor.fetchall()
            if r["serial_number"]
        }

        for entry in body.instruments:
            serial = (entry.serial or "").strip() or None
            if serial and serial in existing_serials:
                continue

            name = (
                f"{(entry.manufacturer or '').strip()} {(entry.model or '').strip()}"
            ).strip()
            if not name:
                name = entry.resource

            address = _resolve_address(entry)
            cursor = await db.execute(
                """
                INSERT INTO equipment
                    (name, model, manufacturer, serial_number,
                     connection_type, connection_address, cal_due_date, is_active,
                     instrument_role)
                VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?)
                """,
                (
                    name,
                    entry.model or None,
                    entry.manufacturer or None,
                    serial,
                    entry.connection_type,
                    address,
                    entry.instrument_type,
                ),
            )
            new_id = cursor.lastrowid
            await db.commit()

            cursor = await db.execute(
                "SELECT * FROM equipment WHERE id = ?", (new_id,)
            )
            row = await cursor.fetchone()
            created.append(_row_to_response(row))

            await log_audit(
                user_id=current_user.id,
                action="auto_register",
                entity_type="equipment",
                entity_id=new_id,
                details=(
                    f"name={name} role={entry.instrument_type} "
                    f"connection_type={entry.connection_type} "
                    f"address={address} serial={serial}"
                ),
            )

            if serial:
                existing_serials.add(serial)

    return created

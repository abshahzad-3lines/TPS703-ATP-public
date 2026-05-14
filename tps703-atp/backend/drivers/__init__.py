"""Instrument driver package with DriverFactory for selecting drivers by connection type."""

from __future__ import annotations

from drivers.base import InstrumentDriver
from drivers.simulator import SimulatorDriver

# Optional driver imports — these modules may not exist yet on main
try:
    from drivers.visa_driver import VisaDriver
    _HAS_VISA = True
except ImportError:
    _HAS_VISA = False

try:
    from drivers.tcp_scpi_driver import TcpScpiDriver
    _HAS_TCP = True
except ImportError:
    _HAS_TCP = False


class DriverFactory:
    """Factory that creates instrument drivers based on mode or equipment records.

    Supports three driver backends:
      - ``simulator`` (always available)
      - ``visa`` (available when ``drivers.visa_driver`` is importable)
      - ``tcp_scpi`` / ``tcp`` / ``lan`` (available when ``drivers.tcp_scpi_driver`` is importable)
    """

    # Mapping from connection_type values to driver categories
    _VISA_TYPES = {"gpib", "usb_tmc", "vxi11"}
    _TCP_TYPES = {"tcp_scpi", "tcp", "lan"}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_from_mode(self, mode: str, **kwargs) -> InstrumentDriver:
        """Create a driver by explicit mode string.

        Args:
            mode: One of ``"simulator"``, ``"visa"``, ``"tcp_scpi"``, or ``"tcp"``.
            **kwargs: Forwarded to the driver constructor.  ``visa`` mode requires
                ``resource_string``; ``tcp_scpi``/``tcp`` modes require ``host``
                and optionally ``port`` (default 5025).

        Returns:
            An ``InstrumentDriver`` instance.

        Raises:
            NotImplementedError: If *mode* is unknown or its driver is unavailable.
        """
        mode_lower = mode.lower()

        if mode_lower == "simulator":
            return SimulatorDriver(**kwargs)

        if mode_lower == "visa":
            if not _HAS_VISA:
                raise NotImplementedError(
                    "VisaDriver is not available — install pyvisa and drivers.visa_driver"
                )
            return VisaDriver(resource_string=kwargs["resource_string"], **kwargs)  # type: ignore[possibly-undefined]

        if mode_lower in ("tcp_scpi", "tcp"):
            if not _HAS_TCP:
                raise NotImplementedError(
                    "TcpScpiDriver is not available — install drivers.tcp_scpi_driver"
                )
            return TcpScpiDriver(  # type: ignore[possibly-undefined]
                host=kwargs["host"],
                port=kwargs.get("port", 5025),
                **kwargs,
            )

        raise NotImplementedError(f"Driver mode '{mode}' is not yet supported")

    def create_from_equipment(self, equipment_row: dict) -> InstrumentDriver:
        """Create a driver from a database equipment record.

        The ``connection_type`` column determines which driver is instantiated,
        and ``connection_address`` supplies the addressing information.

        Supported ``connection_type`` values:
          - ``"simulator"`` — ``SimulatorDriver``
          - ``"gpib"``, ``"usb_tmc"``, ``"vxi11"`` — ``VisaDriver`` (uses
            ``connection_address`` as the VISA resource string)
          - ``"tcp_scpi"``, ``"lan"`` — ``TcpScpiDriver`` (parses
            ``connection_address`` as ``"host:port"`` or ``"host"``, defaulting
            to port 5025)

        Args:
            equipment_row: A dict-like row from the ``equipment`` table.

        Returns:
            An ``InstrumentDriver`` instance.

        Raises:
            NotImplementedError: If the connection type is unknown or its driver
                is unavailable.
            ValueError: If required fields are missing from the equipment row.
        """
        conn_type = (equipment_row.get("connection_type") or "").lower()
        conn_addr = equipment_row.get("connection_address") or ""

        if conn_type == "simulator":
            return SimulatorDriver()

        if conn_type in self._VISA_TYPES:
            if not _HAS_VISA:
                raise NotImplementedError(
                    f"VisaDriver is not available for connection_type '{conn_type}'"
                )
            if not conn_addr:
                raise ValueError(
                    f"Equipment '{equipment_row.get('name', '?')}' has connection_type "
                    f"'{conn_type}' but no connection_address"
                )
            return VisaDriver(resource_string=conn_addr)  # type: ignore[possibly-undefined]

        if conn_type in self._TCP_TYPES:
            if not _HAS_TCP:
                raise NotImplementedError(
                    f"TcpScpiDriver is not available for connection_type '{conn_type}'"
                )
            if not conn_addr:
                raise ValueError(
                    f"Equipment '{equipment_row.get('name', '?')}' has connection_type "
                    f"'{conn_type}' but no connection_address"
                )
            host, port = self._parse_host_port(conn_addr)
            return TcpScpiDriver(host=host, port=port)  # type: ignore[possibly-undefined]

        raise NotImplementedError(
            f"No driver available for connection_type '{conn_type}'"
        )

    @staticmethod
    def list_available_drivers() -> list[str]:
        """Return driver type names whose backing modules are importable.

        Always includes ``"simulator"``.  ``"visa"`` and ``"tcp_scpi"`` are
        included only when their respective driver modules are present.
        """
        drivers: list[str] = ["simulator"]
        if _HAS_VISA:
            drivers.append("visa")
        if _HAS_TCP:
            drivers.append("tcp_scpi")
        return drivers

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_host_port(address: str, default_port: int = 5025) -> tuple[str, int]:
        """Parse ``"host:port"`` or ``"host"`` into a ``(host, port)`` tuple."""
        if ":" in address:
            host_part, port_part = address.rsplit(":", 1)
            try:
                return host_part, int(port_part)
            except ValueError:
                # Port segment is not numeric — treat whole string as host
                return address, default_port
        return address, default_port


# Module-level singleton
driver_factory = DriverFactory()


def get_driver(mode: str = "simulator", **kwargs) -> InstrumentDriver:
    """Return an instrument driver for the given mode.

    This is the original entry-point preserved for backward compatibility.
    It delegates to :pymethod:`DriverFactory.create_from_mode`.
    """
    return driver_factory.create_from_mode(mode, **kwargs)

"""VISA instrument driver wrapping PyVISA for GPIB/USB-TMC/VXI-11 instruments."""

import asyncio
import logging
from typing import Any, Optional

from drivers.base import InstrumentDriver

# Graceful handling when pyvisa is not installed
try:
    import pyvisa
    from pyvisa import errors as visa_errors

    PYVISA_AVAILABLE = True
except ImportError:
    pyvisa = None  # type: ignore[assignment]
    visa_errors = None  # type: ignore[assignment]
    PYVISA_AVAILABLE = False

logger = logging.getLogger(__name__)


class VisaDriver(InstrumentDriver):
    """Instrument driver using PyVISA for GPIB, USB-TMC, and VXI-11 connections.

    Supports any VISA-compatible resource string, for example:
        - "GPIB0::1::INSTR"
        - "USB0::0x2A8D::0x0101::MY12345678::INSTR"
        - "TCPIP0::192.168.1.100::inst0::INSTR"
    """

    def __init__(self, resource_string: str, timeout_ms: int = 5000) -> None:
        """Initialize the VISA driver.

        Args:
            resource_string: VISA resource address (e.g. "GPIB0::1::INSTR").
            timeout_ms: Communication timeout in milliseconds (default 5000).
        """
        self._resource_string = resource_string
        self._timeout_ms = timeout_ms
        self._rm: Optional[Any] = None  # pyvisa.ResourceManager
        self._instrument: Optional[Any] = None  # pyvisa.Resource
        self._connected = False
        # Track whether the dual-channel power meter has been pre-armed for
        # this session.  ``FETC?`` requires a triggered measurement to fetch
        # so we send ``INIT:CONT ON`` once on the first read of a session.
        self._pmeter_armed = False
        # Whether Channel B is usable for this session.  Cleared after the
        # first FETC2? failure so single-channel sensor configs don't repeat
        # the timeout cost on every tick.
        self._pmeter_b_available = True
        # Tracks the multimeter function the driver has already configured the
        # instrument for.  Set on the first measurement of a given function so
        # subsequent ``READ?`` calls skip the reconfigure step and run at the
        # meter's natural rate (matches the front-panel display update cadence).
        self._configured_function: Optional[str] = None

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    async def connect(self) -> None:
        """Open the VISA resource and configure the timeout.

        Wraps the open with a single retry: pyvisa-py on Windows occasionally
        returns ``VI_ERROR_RSRC_NFOUND`` on the first ``open_resource`` after
        a previous teardown, but a second attempt (after a brief pause and a
        ``list_resources()`` to refresh the RM cache) succeeds.
        """
        if not PYVISA_AVAILABLE:
            raise RuntimeError(
                "PyVISA is not installed. Install it with: pip install pyvisa>=1.13.0"
            )

        def _open(refresh: bool) -> None:
            try:
                self._rm = pyvisa.ResourceManager()
                if refresh:
                    # Force RM to re-enumerate; clears stale negative-cache entries.
                    try:
                        self._rm.list_resources()
                    except Exception:
                        pass
                logger.debug(
                    "Opening VISA resource: %s (timeout=%dms)",
                    self._resource_string,
                    self._timeout_ms,
                )
                self._instrument = self._rm.open_resource(self._resource_string)
                self._instrument.timeout = self._timeout_ms
                # Best-effort: clear the SCPI error queue / event registers.
                # If a previous session left the instrument with a pending
                # error or a half-parsed command, *CLS gets it ready for new
                # queries.  Errors here are non-fatal — some instruments may
                # still be booting and refuse *CLS, in which case we just
                # log and let the first real query catch the issue.
                try:
                    self._instrument.write("*CLS")
                except Exception as cls_exc:
                    logger.debug("*CLS after open failed (non-fatal): %s", cls_exc)
                self._connected = True
                logger.info("Connected to VISA resource: %s", self._resource_string)
            except Exception as exc:
                self._connected = False
                raise ConnectionError(
                    f"Failed to open VISA resource '{self._resource_string}': {exc}"
                ) from exc

        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, _open, False)
        except ConnectionError as exc:
            msg = str(exc).lower()
            if "vi_error_rsrc_nfound" not in msg and "resource is not present" not in msg:
                raise
            logger.warning(
                "open_resource %s failed with RSRC_NFOUND — retrying once with refresh",
                self._resource_string,
            )
            # Tear down whatever the half-open RM left behind, then retry.
            if self._rm is not None:
                try:
                    self._rm.close()
                except Exception:
                    pass
                self._rm = None
            await asyncio.sleep(0.3)
            await loop.run_in_executor(None, _open, True)

    async def disconnect(self) -> None:
        """Close the VISA resource gracefully."""

        # Forget any per-session config flags so the next session re-arms.
        self._pmeter_armed = False
        self._pmeter_b_available = True
        self._configured_function = None

        def _close() -> None:
            try:
                if self._instrument is not None:
                    self._instrument.close()
                    logger.info(
                        "Disconnected from VISA resource: %s", self._resource_string
                    )
            except Exception as exc:
                logger.warning("Error closing VISA resource: %s", exc)
            finally:
                self._instrument = None
                self._connected = False
                if self._rm is not None:
                    try:
                        self._rm.close()
                    except Exception:
                        pass
                    self._rm = None

        await asyncio.get_event_loop().run_in_executor(None, _close)

    async def _reconnect(self) -> None:
        """Tear down and re-open the VISA session.

        Used as a recovery path when an existing session goes invalid mid-stream
        (e.g. after a timeout the VXI-11 server has invalidated the handle).
        """
        logger.info("Reconnecting VISA resource: %s", self._resource_string)
        try:
            await self.disconnect()
        except Exception:
            pass
        await self.connect()

    @staticmethod
    def _is_session_invalid(exc: BaseException) -> bool:
        """True if *exc* indicates the underlying VISA session is gone.

        Catches PyVISA's typed errors (``VI_ERROR_INV_SESSION``,
        ``VI_ERROR_IO``, ``VI_ERROR_CONN_LOST``) and the Windows socket
        errors that pyvisa-py's VXI-11 client raises when its underlying TCP
        socket has been closed but the client still holds the FD:
          - WinError 10038 (WSAENOTSOCK)  — operation on closed socket
          - WinError 10053 (WSAECONNABORTED)
          - WinError 10054 (WSAECONNRESET)
          - WinError 10057 (WSAENOTCONN)
          - WinError 10060 (WSAETIMEDOUT)
        Recovery in all of these cases is the same: tear down and re-open.
        """
        msg = str(exc).lower()
        signatures = (
            "invalid session handle",
            "vi_error_inv_session",
            "resource might be closed",
            "vi_error_io",
            "could not perform operation because of i/o error",
            "vi_error_conn_lost",
            "vi_error_invalid_object",
            "vi_error_tmo",
            "[winerror 10038]",
            "[winerror 10053]",
            "[winerror 10054]",
            "[winerror 10057]",
            "[winerror 10060]",
            "not a socket",
            "an existing connection was forcibly closed",
            "an established connection was aborted",
            "socket is not connected",
            # Self-heal trigger: a prior reconnect cycle left _connected=False.
            "instrument is not connected",
            "call connect() first",
        )
        return any(sig in msg for sig in signatures)

    # ------------------------------------------------------------------
    # Low-level I/O
    # ------------------------------------------------------------------

    def _ensure_connected(self) -> None:
        """Raise if the instrument is not connected."""
        if not self._connected or self._instrument is None:
            raise ConnectionError(
                "Instrument is not connected. Call connect() first."
            )

    async def send(self, command: str) -> None:
        """Write a SCPI command string to the instrument (no response expected).

        On a dropped session ("Invalid session handle", "not a socket",
        "Instrument is not connected", etc.), reconnects once and retries
        before propagating the failure.
        """
        try:
            await self._send_once(command)
        except (IOError, ConnectionError) as exc:
            if not self._is_session_invalid(exc):
                raise
            logger.warning("VISA session invalid on SEND %r — reconnecting", command)
            await self._reconnect()
            await self._send_once(command)

    async def _send_once(self, command: str) -> None:
        self._ensure_connected()

        def _write() -> None:
            try:
                logger.debug("VISA SEND >> %s", command)
                self._instrument.write(command)
            except Exception as exc:
                raise IOError(
                    f"Failed to send command '{command}' to "
                    f"'{self._resource_string}': {exc}"
                ) from exc

        await asyncio.get_event_loop().run_in_executor(None, _write)

    async def query(self, command: str) -> str:
        """Write a SCPI query and read the response string.

        On a dropped session (any of the recoverable signatures, including
        "Instrument is not connected"), reconnects once and retries.
        """
        try:
            return await self._query_once(command)
        except (IOError, ConnectionError) as exc:
            if not self._is_session_invalid(exc):
                raise
            logger.warning("VISA session invalid on QUERY %r — reconnecting", command)
            await self._reconnect()
            return await self._query_once(command)

    async def _query_once(self, command: str) -> str:
        self._ensure_connected()

        def _query() -> str:
            try:
                logger.debug("VISA QUERY >> %s", command)
                response = self._instrument.query(command).strip()
                logger.debug("VISA QUERY << %s", response)
                return response
            except Exception as exc:
                raise IOError(
                    f"Failed to query '{command}' from "
                    f"'{self._resource_string}': {exc}"
                ) from exc

        return await asyncio.get_event_loop().run_in_executor(None, _query)

    # ------------------------------------------------------------------
    # High-level instrument operations
    # ------------------------------------------------------------------

    async def identify(self) -> str:
        """Send *IDN? and return the instrument identification string."""
        try:
            return await self.query("*IDN?")
        except Exception as exc:
            raise IOError(
                f"Failed to identify instrument at "
                f"'{self._resource_string}': {exc}"
            ) from exc

    async def measure(self, step_type: str, params: dict) -> dict:
        """Take a measurement based on step type and parameters.

        Dispatches to type-specific handlers. Falls back to a generic
        single-value query if no specific handler is found.

        Args:
            step_type: The measurement type (e.g. "output_power", "current").
            params: Step parameters including SCPI overrides if needed.

        Returns:
            dict with keys: value (float), secondary_value (float|None),
            raw_data (str|None)
        """
        handler = getattr(self, f"_measure_{step_type}", None)
        if handler is not None:
            return await handler(params)

        logger.warning(
            "No specific handler for step_type '%s', using generic query",
            step_type,
        )
        return await self._measure_generic(params)

    # ------------------------------------------------------------------
    # Measurement handlers
    # ------------------------------------------------------------------

    async def _measure_output_power(self, params: dict) -> dict:
        """Measure output power on Channel 1 of a power meter.

        Uses the same ``FETC1?`` command the bench-WS stream uses so the
        recorded step measurement matches what the operator sees live on
        the Test Execution power-meter panel. On the first call of a
        session we send ``INIT1:CONT ON`` so subsequent ``FETC1?`` calls
        return the meter's most recent triggered reading.

        Falls back to the caller-supplied ``scpi_command`` parameter if
        provided (used by older calibration paths that explicitly want
        ``MEAS:POW?``).
        """
        if "scpi_command" in params:
            raw = await self.query(params["scpi_command"])
            return {
                "value": self._parse_float(raw, "output_power"),
                "secondary_value": None,
                "raw_data": raw,
            }

        if not self._pmeter_armed:
            try:
                await self.send("INIT1:CONT ON")
            except Exception:  # noqa: BLE001 — meter may already be armed
                pass
            self._pmeter_armed = True

        raw = await self.query("FETC1?")
        return {
            "value": self._parse_float(raw, "output_power"),
            "secondary_value": None,
            "raw_data": raw,
        }

    async def _measure_return_loss(self, params: dict) -> dict:
        """Measure return loss via network analyzer marker.

        SCPI: CALC:MARK:Y? (or custom command from params).
        """
        # Optionally set marker frequency first
        marker_freq = params.get("marker_frequency")
        if marker_freq is not None:
            await self.send(f"CALC:MARK:X {marker_freq}")

        command = params.get("scpi_command", "CALC:MARK:Y?")
        raw = await self.query(command)
        value = self._parse_float(raw, "return_loss")
        return {"value": value, "secondary_value": None, "raw_data": raw}

    # ------------------------------------------------------------------
    # Multimeter — continuous-mode handlers
    #
    # Mirrors TcpScpiDriver: configure the meter once per function, then sip
    # ``READ?`` on every subsequent call. Without this dispatch, a bench-WS
    # stream sending ``step_type='mux_voltage'`` to a vxi11 DMM (e.g.
    # Keysight 34465A) would fall through to ``_measure_generic`` and never
    # configure the meter, so the meter would stay on whatever function it
    # was previously on (Ohms, AC, etc.) and the panel would show readings
    # in the wrong mode.
    # ------------------------------------------------------------------

    _MULTIMETER_CONF: dict[str, str] = {
        "voltage_dc": "CONF:VOLT:DC AUTO",
        "voltage_ac": "CONF:VOLT:AC AUTO",
        "current_dc": "CONF:CURR:DC AUTO",
        "current_ac": "CONF:CURR:AC AUTO",
        "resistance": "CONF:RES AUTO",
    }

    async def _ensure_continuous(self, function: str) -> None:
        """Configure the multimeter for *function* once per change.

        See ``TcpScpiDriver._ensure_continuous`` for the rationale (use
        ``CONF:* AUTO`` + ``READ?`` rather than ``INIT`` + ``DATA:LAST?``
        because the Truevolt 34465A can return its ``9.91E+37`` "no reading
        available" sentinel for surprisingly long after a function switch).
        """
        if self._configured_function == function:
            return

        conf_cmd = self._MULTIMETER_CONF.get(function)
        if conf_cmd is None:
            return

        await self.send("ABOR")
        await self.send(conf_cmd)
        await self.send("TRIG:SOUR IMM")
        await self.send("SAMP:COUN 1")
        self._configured_function = function

    async def _read_continuous(self, function: str) -> dict:
        """Configure if needed, then trigger one measurement and return it.

        If the underlying VISA session drops mid-query, ``self.query()``
        already reconnects once and retries — but that retry hits a fresh
        session that hasn't been configured for *function* yet (because
        ``disconnect()`` cleared ``_configured_function``).  So if a
        recoverable I/O / session error still propagates here, we explicitly
        re-arm the meter and retry ``READ?`` one more time before giving up.
        """
        await self._ensure_continuous(function)
        try:
            raw = await self.query("READ?")
        except (IOError, ConnectionError) as exc:
            if not self._is_session_invalid(exc):
                raise
            logger.warning(
                "Session blip during READ? on %s — re-arming for %s and retrying",
                self._resource_string,
                function,
            )
            if not self._connected:
                await self._reconnect()
            await self._ensure_continuous(function)
            raw = await self.query("READ?")
        value = self._parse_float(raw, function)
        return {"value": value, "secondary_value": None, "raw_data": raw}

    async def _measure_mux_voltage(self, params: dict) -> dict:
        """Multimeter DC voltage in continuous mode (matches front panel)."""
        return await self._read_continuous("voltage_dc")

    async def _measure_voltage_ac(self, params: dict) -> dict:
        """Multimeter AC voltage in continuous mode."""
        return await self._read_continuous("voltage_ac")

    async def _measure_current(self, params: dict) -> dict:
        """Multimeter DC current in continuous mode."""
        return await self._read_continuous("current_dc")

    async def _measure_current_ac(self, params: dict) -> dict:
        """Multimeter AC current in continuous mode."""
        return await self._read_continuous("current_ac")

    async def _measure_resistance(self, params: dict) -> dict:
        """Multimeter resistance in continuous mode."""
        return await self._read_continuous("resistance")

    async def _measure_phase_shift(self, params: dict) -> dict:
        """Measure phase shift via network analyzer formatted data.

        SCPI: CALC:DATA:FDAT? (or custom command from params).
        The response may contain comma-separated real/imaginary pairs;
        the first value is taken as the phase in degrees.
        """
        command = params.get("scpi_command", "CALC:DATA:FDAT?")
        raw = await self.query(command)
        # FDAT? may return comma-separated values; take the first element
        first_token = raw.split(",")[0].strip()
        value = self._parse_float(first_token, "phase_shift")
        return {"value": value, "secondary_value": None, "raw_data": raw}

    async def _measure_raw_read(self, params: dict) -> dict:
        """Trigger one ``READ?`` against the instrument's current configuration.

        Lets the bench page drive the instrument with raw SCPI and just sip
        readings out via this step type. Used by the DMM dashboard.
        """
        # Reset our cached continuous-mode function so the next call to a
        # role-specific handler reconfigures from scratch (the user may have
        # changed the function via raw SCPI in the meantime).
        self._configured_function = None
        raw = await self.query("READ?")
        try:
            value = float(raw.strip().split(",")[-1])
        except (ValueError, AttributeError):
            value = 0.0
        return {"value": value, "secondary_value": None, "raw_data": raw}

    async def _measure_pmeter_dual(self, params: dict) -> dict:
        """Read both channels of a dual-channel power meter (e.g. N1912A).

        ``FETC?`` returns the meter's last triggered reading, so on the first
        call of a session we send ``INIT:CONT ON`` to (only) the channels
        that look usable.  The first ``FETC2?`` is probed with a 1.5 s
        timeout — if it fails (no Ch B sensor, common case) we mark Ch B
        unavailable for the rest of the session and drain the meter's error
        queue so the next ``FETC1?`` isn't blocked by a stale error.
        """
        if not self._pmeter_armed:
            try:
                await self.send("INIT1:CONT ON")
            except Exception:  # noqa: BLE001 — Ch A always present; log + continue
                logger.warning("INIT1:CONT ON failed; continuing")
            if self._pmeter_b_available:
                try:
                    await self.send("INIT2:CONT ON")
                except Exception:  # noqa: BLE001 — single-channel meter on Ch 2
                    self._pmeter_b_available = False
            self._pmeter_armed = True

        ch1_raw = await self.query("FETC1?")
        try:
            ch1 = float(ch1_raw.strip().split(",")[-1])
        except (ValueError, AttributeError):
            ch1 = 0.0

        ch2: Optional[float] = None
        ch2_raw = ""
        if self._pmeter_b_available:
            # First-call probe: short 800 ms timeout, bypass auto-reconnect so a
            # missing-Ch-B doesn't pay the multi-second VXI-11 rebuild cost.
            # Once Ch B has answered at least once we use the normal query path.
            probing = not getattr(self, "_pmeter_b_proven", False)
            original_timeout = self._timeout_ms
            try:
                if probing and self._instrument is not None:
                    self._instrument.timeout = 800
                if probing:
                    ch2_raw = await self._query_once("FETC2?")
                else:
                    ch2_raw = await self.query("FETC2?")
                try:
                    ch2 = float(ch2_raw.strip().split(",")[-1])
                except (ValueError, AttributeError):
                    ch2 = None
                self._pmeter_b_proven = True
            except Exception as exc:  # noqa: BLE001 — Ch B not connected
                logger.info("FETC2? failed — disabling Ch B for this session: %s", exc)
                self._pmeter_b_available = False
                # Drain SYST:ERR? with the same short-timeout, no-reconnect
                # path we used for the FETC2? probe. Without this, the meter's
                # error state poisons subsequent FETC1? calls and every tick
                # ends up paying a reconnect cost.
                try:
                    if self._instrument is not None:
                        self._instrument.timeout = 800
                    for _ in range(8):
                        err = await self._query_once("SYST:ERR?")
                        if err.startswith("+0,") or err.startswith("0,"):
                            break
                except Exception:  # noqa: BLE001
                    pass
            finally:
                if self._instrument is not None:
                    try:
                        self._instrument.timeout = original_timeout
                    except Exception:  # noqa: BLE001
                        pass

        return {
            "value": ch1,
            "secondary_value": ch2,
            "raw_data": f"{ch1_raw}|{ch2_raw}" if ch2_raw else ch1_raw,
        }

    async def _measure_pmeter_single(self, params: dict) -> dict:
        """Read one channel of a power meter via ``FETC{N}?``."""
        ch = int(params.get("channel", 1))
        if ch not in (1, 2):
            ch = 1
        raw = await self.query(f"FETC{ch}?")
        try:
            value = float(raw.strip().split(",")[-1])
        except (ValueError, AttributeError):
            value = 0.0
        return {"value": value, "secondary_value": None, "raw_data": raw}

    async def _measure_sg_setup(self, params: dict) -> dict:
        """Program a signal generator: set frequency, set power, enable RF output.

        Mirrors :meth:`TcpScpiDriver._measure_sg_setup`. Sends ``FREQ``,
        ``POW``, optionally ``PULM:STAT ON`` (when ``pulse_width_us`` is set),
        and ``OUTP ON``, then reads back each setting and returns the readback
        in the standard measurement-result shape.
        """
        freq_mhz = params.get("frequency_mhz") or 0.0
        pow_dbm = params.get("input_power_dbm") or 0.0
        pulsed = params.get("pulse_width_us") is not None

        await self.send(f"FREQ {float(freq_mhz) * 1e6:.0f} HZ")
        await self.send(f"POW {float(pow_dbm):.2f} DBM")
        if pulsed:
            await self.send("PULM:SOUR INT")
            await self.send("PULM:STAT ON")
        await self.send("OUTP ON")

        freq_raw = pow_raw = outp_raw = ""
        freq_back: Optional[float] = None
        pow_back: Optional[float] = None
        try:
            freq_raw = await self.query("FREQ?")
            freq_back = float(freq_raw.strip())
        except Exception:
            freq_back = None
        try:
            pow_raw = await self.query("POW?")
            pow_back = float(pow_raw.strip())
        except Exception:
            pow_back = None
        try:
            outp_raw = await self.query("OUTP?")
        except Exception:
            outp_raw = ""
        return {
            "value": freq_back if freq_back is not None else float(freq_mhz) * 1e6,
            "secondary_value": pow_back if pow_back is not None else float(pow_dbm),
            "raw_data": f"FREQ={freq_raw};POW={pow_raw};OUTP={outp_raw}",
        }

    async def _measure_sg_status(self, params: dict) -> dict:
        """Poll a signal generator's frequency / amplitude / RF-output state."""
        freq_raw = ""
        pow_raw = ""
        outp_raw = ""
        freq: Optional[float] = None
        amp: Optional[float] = None
        try:
            freq_raw = await self.query("FREQ?")
            freq = float(freq_raw.strip())
        except Exception:
            freq = None
        try:
            pow_raw = await self.query("POW?")
            amp = float(pow_raw.strip())
        except Exception:
            amp = None
        try:
            outp_raw = await self.query("OUTP?")
        except Exception:
            outp_raw = ""
        return {
            "value": freq,
            "secondary_value": amp,
            "raw_data": f"{freq_raw}|{pow_raw}|{outp_raw}",
        }

    async def _measure_generic(self, params: dict) -> dict:
        """Generic measurement using a caller-supplied SCPI command.

        Falls back to READ? if no command is provided.
        """
        command = params.get("scpi_command", "READ?")
        raw = await self.query(command)
        value = self._parse_float(raw, "generic")
        return {"value": value, "secondary_value": None, "raw_data": raw}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_float(raw: str, context: str) -> float:
        """Parse a float from a raw instrument response string.

        Args:
            raw: The raw string from the instrument.
            context: Description for error messages.

        Returns:
            The parsed float value.

        Raises:
            ValueError: If the string cannot be parsed as a float.
        """
        try:
            return float(raw.strip())
        except (ValueError, AttributeError) as exc:
            raise ValueError(
                f"Could not parse '{raw}' as float for {context} measurement"
            ) from exc

    def __repr__(self) -> str:
        status = "connected" if self._connected else "disconnected"
        return (
            f"VisaDriver(resource='{self._resource_string}', "
            f"timeout={self._timeout_ms}ms, {status})"
        )

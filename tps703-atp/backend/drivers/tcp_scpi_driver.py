"""TCP SCPI instrument driver for LAN-connected instruments.

Uses asyncio raw TCP sockets to communicate with instruments
that support SCPI commands over a direct TCP connection (port 5025).
"""

import asyncio
import logging
from typing import Optional

from drivers.base import InstrumentDriver

logger = logging.getLogger(__name__)


class TcpScpiDriver(InstrumentDriver):
    """Driver for LAN-connected SCPI instruments using raw TCP sockets.

    Communicates via asyncio.StreamReader/StreamWriter using the standard
    SCPI raw socket port (5025). Supports automatic reconnection on
    connection failures.
    """

    def __init__(
        self,
        host: str,
        port: int = 5025,
        timeout: float = 5.0,
        terminator: str = "\n",
    ):
        self._host = host
        self._port = port
        self._timeout = timeout
        self._terminator = terminator
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._connected = False
        # Tracks the multimeter function the driver has already configured the
        # instrument for. Set once on the first measurement of a given function
        # so subsequent ticks just sip the latest sample out of the meter's
        # circular buffer instead of re-CONFiguring on every poll.
        self._configured_function: Optional[str] = None

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    async def connect(self) -> None:
        """Open an asyncio TCP connection to the instrument."""
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self._host, self._port),
                timeout=self._timeout,
            )
            self._connected = True
            logger.info("Connected to %s:%d", self._host, self._port)
        except asyncio.TimeoutError:
            self._connected = False
            raise ConnectionError(
                f"Timeout connecting to {self._host}:{self._port} "
                f"after {self._timeout}s"
            )
        except OSError as exc:
            self._connected = False
            raise ConnectionError(
                f"Failed to connect to {self._host}:{self._port}: {exc}"
            ) from exc

    async def disconnect(self) -> None:
        """Close the TCP connection gracefully."""
        # Forget any cached "this function is configured" state so the next
        # connection re-configures from scratch.
        self._configured_function = None
        self._pmeter_armed = False
        if self._writer is not None:
            try:
                self._writer.close()
                await self._writer.wait_closed()
                logger.info("Disconnected from %s:%d", self._host, self._port)
            except Exception as exc:
                logger.warning("Error during disconnect: %s", exc)
            finally:
                self._writer = None
                self._reader = None
                self._connected = False

    async def _reconnect(self) -> None:
        """Attempt a single reconnection cycle."""
        logger.info("Attempting reconnect to %s:%d", self._host, self._port)
        await self.disconnect()
        await self.connect()

    # ------------------------------------------------------------------
    # Low-level I/O
    # ------------------------------------------------------------------

    async def send(self, command: str) -> None:
        """Write a command to the instrument (no response expected).

        If the connection is broken, attempts one automatic reconnect
        before raising.
        """
        try:
            await self._send_raw(command)
        except (ConnectionError, OSError, AttributeError):
            await self._reconnect()
            await self._send_raw(command)

    async def _send_raw(self, command: str) -> None:
        """Write command bytes to the stream."""
        if self._writer is None:
            raise ConnectionError("Not connected")
        data = (command + self._terminator).encode("ascii")
        self._writer.write(data)
        await self._writer.drain()
        logger.debug("SEND >>> %s", command)

    async def query(self, command: str) -> str:
        """Send a command and read the response.

        Returns the stripped response string. Automatically retries once
        on a broken connection.
        """
        try:
            return await self._query_raw(command)
        except (ConnectionError, OSError, AttributeError, asyncio.TimeoutError):
            await self._reconnect()
            return await self._query_raw(command)

    async def _query_raw(self, command: str) -> str:
        """Send command and read until terminator, with timeout."""
        if self._writer is None or self._reader is None:
            raise ConnectionError("Not connected")

        # Send
        data = (command + self._terminator).encode("ascii")
        self._writer.write(data)
        await self._writer.drain()
        logger.debug("QUERY >>> %s", command)

        # Read with timeout
        terminator_bytes = self._terminator.encode("ascii")
        try:
            response_bytes = await asyncio.wait_for(
                self._reader.readuntil(terminator_bytes),
                timeout=self._timeout,
            )
        except asyncio.IncompleteReadError as exc:
            # Connection closed mid-read; return whatever was received
            response_bytes = exc.partial
            if not response_bytes:
                self._connected = False
                raise ConnectionError("Connection closed during read") from exc

        response = response_bytes.decode("ascii").strip()
        logger.debug("RECV <<< %s", response)
        return response

    # ------------------------------------------------------------------
    # InstrumentDriver interface
    # ------------------------------------------------------------------

    async def identify(self) -> str:
        """Send *IDN? and return the instrument identification string."""
        return await self.query("*IDN?")

    async def measure(self, step_type: str, params: dict) -> dict:
        """Dispatch a measurement based on step_type.

        Returns:
            dict with keys: value (float), secondary_value (float|None),
            raw_data (str|None)
        """
        handler = getattr(self, f"_measure_{step_type}", None)
        if handler is not None:
            return await handler(params)

        # Fallback: generic MEAS? for unrecognised step types
        logger.warning(
            "No specific handler for step_type '%s'; using generic MEAS?",
            step_type,
        )
        raw = await self.query("MEAS?")
        return {
            "value": _parse_float(raw),
            "secondary_value": None,
            "raw_data": raw,
        }

    # ------------------------------------------------------------------
    # Measurement dispatchers
    # ------------------------------------------------------------------

    async def _measure_output_power(self, params: dict) -> dict:
        """Read RF output power on Channel 1 of a power meter.

        Uses ``FETC1?`` (continuous-mode read) so the recorded step
        measurement matches what the operator sees live on the Test
        Execution power-meter panel — which streams via ``pmeter_dual``
        using the same FETC commands. We arm the meter with
        ``INIT1:CONT ON`` once per session so subsequent FETC calls always
        return the latest triggered reading.

        Honours an explicit ``scpi_command`` param (used by older
        calibration paths that want ``MEAS:POW?`` instead).
        """
        if "scpi_command" in params:
            raw = await self.query(params["scpi_command"])
            return {
                "value": _parse_float(raw),
                "secondary_value": None,
                "raw_data": raw,
            }

        if not getattr(self, "_pmeter_armed", False):
            try:
                await self.send("INIT1:CONT ON")
            except Exception:
                pass
            self._pmeter_armed = True

        raw = await self.query("FETC1?")
        return {
            "value": _parse_float(raw),
            "secondary_value": None,
            "raw_data": raw,
        }

    async def _measure_return_loss(self, params: dict) -> dict:
        """Read return loss from the network analyzer marker."""
        marker = params.get("marker", 1)
        raw = await self.query(f"CALC1:MARK{marker}:Y?")
        return {
            "value": _parse_float(raw),
            "secondary_value": None,
            "raw_data": raw,
        }

    # ------------------------------------------------------------------
    # Multimeter — continuous-mode handlers
    #
    # These configure the meter once per function and then sip the latest
    # sample out of its FIFO buffer with DATA:LAST? on every subsequent call.
    # That mirrors what the front panel display does, so the on-screen
    # readout updates at the meter's natural rate (typically ~10 Hz at the
    # default NPLC) instead of being throttled to one full re-configure per
    # poll. Pattern recommended in Keysight's "How to continuously obtain
    # readings while still measuring" support note for the Truevolt series.
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

        The meter holds the configuration between calls so subsequent ``READ?``
        queries skip the configure step and run at the meter's natural rate
        (typically ~3 Hz at default NPLC), matching the front-panel display.

        We intentionally do NOT use ``INITiate`` + ``DATA:LAST?`` here. On the
        Truevolt 34465A that pattern can race the meter's internal state
        machine right after a function-switch and keep returning the
        ``9.91E+37`` "no reading available" sentinel for surprisingly long.
        ``READ?`` is more reliable and gives the same effective update rate
        as the front panel.
        """
        if self._configured_function == function:
            return

        conf_cmd = self._MULTIMETER_CONF.get(function)
        if conf_cmd is None:
            # Unknown function — leave the meter alone.
            return

        await self.send("ABOR")
        await self.send(conf_cmd)
        await self.send("TRIG:SOUR IMM")
        await self.send("SAMP:COUN 1")
        self._configured_function = function

    async def _read_continuous(self, function: str) -> dict:
        """Configure if needed, then trigger one measurement and return it.

        ``READ?`` is ``INITiate`` + ``FETCh?`` in one round-trip; with the
        function already configured it just times the next integration cycle.
        On a 34465A at default NPLC this is ~340 ms — exactly the rate the
        front panel updates.

        The meter's ``+9.9E+37`` overload sentinel (e.g. open-circuit on
        resistance) is returned as-is so callers can render it as "OL".
        """
        await self._ensure_continuous(function)
        raw = await self.query("READ?")
        value = _parse_float(raw)
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

    async def _measure_raw_read(self, params: dict) -> dict:
        """Trigger one ``READ?`` against whatever the meter is currently
        configured for (set via the REST ``/api/equipment/{id}/scpi`` endpoint
        with ``CONF:*``, ``SENS:*:NPLC``, etc.).

        Lets the frontend manage function/range/NPLC entirely with raw SCPI
        and just sip readings out via this step type. Used by the DMM
        dashboard page where the user can drive every front-panel control.
        """
        # Reset our cached function flag so the multimeter handlers know
        # they need to reconfigure if the user later switches back to one
        # of the role-specific step types.
        self._configured_function = None
        raw = await self.query("READ?")
        value = _parse_float(raw)
        return {"value": value, "secondary_value": None, "raw_data": raw}

    async def _measure_phase_shift(self, params: dict) -> dict:
        """Read phase data from a network/phase analyzer.

        The FDAT response may contain comma-separated real,imag pairs;
        the first real value is taken as the phase in degrees.
        """
        raw = await self.query("CALC1:DATA:FDAT?")
        parts = raw.split(",")
        value = _parse_float(parts[0]) if parts else 0.0
        secondary = _parse_float(parts[1]) if len(parts) > 1 else None
        return {
            "value": value,
            "secondary_value": secondary,
            "raw_data": raw,
        }

    async def _measure_pmeter_dual(self, params: dict) -> dict:
        """Read both channels of a dual-channel power meter (e.g. N1912A).

        Issues ``FETC1?`` and ``FETC2?`` on each tick. On the first call of a
        session, sends ``INIT:CONT ON`` to both channels so ``FETC?`` always
        has a fresh triggered reading available. Channel B reads are wrapped
        in a try/except so single-channel meters still return Ch A.
        """
        if not getattr(self, "_pmeter_armed", False):
            for ch in (1, 2):
                try:
                    await self.send(f"INIT{ch}:CONT ON")
                except Exception:  # noqa: BLE001 — single-channel meter on Ch 2
                    pass
            self._pmeter_armed = True

        ch1_raw = await self.query("FETC1?")
        ch1 = _parse_float(ch1_raw)
        ch2: Optional[float] = None
        ch2_raw = ""
        try:
            ch2_raw = await self.query("FETC2?")
            ch2 = _parse_float(ch2_raw)
        except Exception:  # noqa: BLE001 — single-channel meter
            ch2 = None
        return {
            "value": ch1,
            "secondary_value": ch2,
            "raw_data": f"{ch1_raw}|{ch2_raw}" if ch2_raw else ch1_raw,
        }

    async def _measure_pmeter_single(self, params: dict) -> dict:
        """Read one channel of a power meter via ``FETC{N}?``.

        ``params['channel']`` selects channel 1 or 2 (default 1).
        """
        ch = int(params.get("channel", 1))
        if ch not in (1, 2):
            ch = 1
        raw = await self.query(f"FETC{ch}?")
        return {"value": _parse_float(raw), "secondary_value": None, "raw_data": raw}

    async def _measure_sg_setup(self, params: dict) -> dict:
        """Program a signal generator: set frequency, set power, enable RF output.

        params:
          - frequency_mhz: float — CW frequency in MHz
          - input_power_dbm: float — output power in dBm
          - pulse_width_us: float | None — non-None enables internal pulse
            modulation (``PULM:SOUR INT;:PULM:STAT ON``)

        Sends ``FREQ {Hz}``, ``POW {dBm} DBM``, ``OUTP ON``, then reads each
        back with ``FREQ?`` / ``POW?`` / ``OUTP?`` to confirm. Returns the
        readback frequency (Hz) in ``value`` and amplitude (dBm) in
        ``secondary_value``; ``raw_data`` is ``"FREQ=…;POW=…;OUTP=…"``.
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
            freq_back = _parse_float(freq_raw)
        except Exception:
            freq_back = None
        try:
            pow_raw = await self.query("POW?")
            pow_back = _parse_float(pow_raw)
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
        """Poll a signal generator's frequency, amplitude, and RF-output state.

        Returns frequency (Hz) in ``value``, amplitude (dBm) in
        ``secondary_value``, and ``raw_data`` is ``"freq|pow|outp"`` for the
        UI to parse.
        """
        freq_raw = ""
        pow_raw = ""
        outp_raw = ""
        freq: Optional[float] = None
        amp: Optional[float] = None
        try:
            freq_raw = await self.query("FREQ?")
            freq = _parse_float(freq_raw)
        except Exception:
            freq = None
        try:
            pow_raw = await self.query("POW?")
            amp = _parse_float(pow_raw)
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


# ------------------------------------------------------------------
# Utilities
# ------------------------------------------------------------------


def _parse_float(raw: str) -> float:
    """Safely parse a float from an instrument response string.

    Handles common instrument quirks such as trailing whitespace,
    status prefixes, and non-numeric responses.
    """
    cleaned = raw.strip()
    # Some instruments prepend a status code, e.g. "0,+1.23456E+01"
    if "," in cleaned:
        cleaned = cleaned.split(",")[-1].strip()
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        # DATA:LAST? on a Truevolt DMM can return "value units", e.g.
        # "+1.234E+00 VDC". Try the first whitespace-separated token.
        first = cleaned.split()[0] if cleaned.split() else cleaned
        try:
            return float(first)
        except (ValueError, TypeError):
            logger.warning("Could not parse float from instrument response: %r", raw)
            return 0.0

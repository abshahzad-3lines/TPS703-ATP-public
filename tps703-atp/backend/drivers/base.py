"""Abstract instrument driver interface for TPS-703 ATP system."""

from abc import ABC, abstractmethod


class InstrumentDriver(ABC):
    """Abstract base class for all instrument drivers."""

    @abstractmethod
    async def connect(self) -> None:
        """Establish connection to the instrument."""

    @abstractmethod
    async def disconnect(self) -> None:
        """Close connection to the instrument."""

    @abstractmethod
    async def identify(self) -> str:
        """Return instrument identification string."""

    @abstractmethod
    async def send(self, command: str) -> None:
        """Send a raw SCPI/GPIB command to the instrument (write-only, no response expected).

        Args:
            command: The SCPI or GPIB command string to send.
        """

    @abstractmethod
    async def query(self, command: str) -> str:
        """Send a command and return the instrument's response string.

        Args:
            command: The SCPI or GPIB command string to send.

        Returns:
            The instrument's response as a string.
        """

    @abstractmethod
    async def measure(self, step_type: str, params: dict) -> dict:
        """Take a measurement based on step type and parameters.

        Returns:
            dict with keys: value (float), secondary_value (float|None), raw_data (str|None)
        """

    # ------------------------------------------------------------------
    # Convenience methods (concrete) built on send() / query()
    # ------------------------------------------------------------------

    async def reset(self) -> None:
        """Send the IEEE 488.2 *RST command to reset the instrument."""
        await self.send("*RST")

    async def clear_status(self) -> None:
        """Send the IEEE 488.2 *CLS command to clear the status registers."""
        await self.send("*CLS")

    async def wait_for_completion(self) -> None:
        """Send *OPC? and wait for the instrument to signal operation complete."""
        await self.query("*OPC?")

    async def get_error(self) -> str:
        """Query the instrument's error queue.

        Returns:
            The error string from the instrument (e.g. '0,"No error"').
        """
        return await self.query("SYST:ERR?")

"""Seed data for TPS-703 ATP system: subsystems, procedures, and test steps.

Populates the database with all 4 subsystem definitions, their test procedures,
and representative test steps from the ATP documents. Uses INSERT OR IGNORE to
allow safe re-runs without duplicating data.
"""

import aiosqlite


# ---------------------------------------------------------------------------
# Subsystem definitions
# ---------------------------------------------------------------------------

SUBSYSTEMS = [
    {
        "drawing_no": "110K245",
        "name": "Power Module Assembly",
        "assembly_no": "100K517",
        "revision": "E",
        "description": "Amplifies 42.5 dBm to 58.6 dBm minimum (724W)",
        "rf_band_start_mhz": 2800,
        "rf_band_stop_mhz": 3100,
        "nominal_output_dbm": 58.60,
        "nominal_output_watts": 724,
    },
    {
        "drawing_no": "110K244",
        "name": "Preamplifier Panel Assembly",
        "assembly_no": "100K520",
        "revision": "M",
        "description": "Amplifies 16.0 dBm to 61.85-62.85 dBm (1531-1928W)",
        "rf_band_start_mhz": 2800,
        "rf_band_stop_mhz": 3100,
        "nominal_output_dbm": 61.85,
        "nominal_output_watts": 1531,
    },
    {
        "drawing_no": "110K243",
        "name": "RF Output Panel Assembly",
        "assembly_no": "100K515",
        "revision": "F",
        "description": "Amplifies 49.50 dBm to 64.0 dBm minimum (2512W)",
        "rf_band_start_mhz": 2800,
        "rf_band_stop_mhz": 3100,
        "nominal_output_dbm": 64.00,
        "nominal_output_watts": 2512,
    },
    {
        "drawing_no": "IF_RECVR",
        "name": "Digital IF Receiver Assembly",
        "assembly_no": "810R349G01",
        "revision": None,
        "description": "Receives 25-35 MHz IF, digitizes to 16-bit IQ",
        "rf_band_start_mhz": 25,
        "rf_band_stop_mhz": 35,
        "nominal_output_dbm": None,
        "nominal_output_watts": None,
    },
]


# ---------------------------------------------------------------------------
# Procedure definitions (keyed by subsystem drawing_no)
# ---------------------------------------------------------------------------

PROCEDURES = {
    "110K245": [
        {"code": "K245-DCAL", "name": "Daily Calibration", "section_ref": "4.2.1", "sequence_order": 1, "warmup_minutes": 0, "default_pulse_width_us": 255.0, "requires_calibration": 0},
        {"code": "K245-PRECHECK", "name": "Pre-Test Circuit Check", "section_ref": "4.2.2", "sequence_order": 2, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 0},
        {"code": "K245-Q1TUNE", "name": "Tuning Q1", "section_ref": "4.3", "sequence_order": 3, "warmup_minutes": 0, "default_pulse_width_us": 255.0, "requires_calibration": 1},
        {"code": "K245-Q1DRV", "name": "Driver Test Q1", "section_ref": "4.4", "sequence_order": 4, "warmup_minutes": 0, "default_pulse_width_us": 255.0, "requires_calibration": 1},
        {"code": "K245-Q23TUNE", "name": "Tuning Q2/Q3", "section_ref": "4.5", "sequence_order": 5, "warmup_minutes": 0, "default_pulse_width_us": 255.0, "requires_calibration": 1},
        {"code": "K245-FINAL", "name": "Final Test ATP", "section_ref": "4.6", "sequence_order": 6, "warmup_minutes": 5, "default_pulse_width_us": 255.0, "requires_calibration": 1},
    ],
    "110K244": [
        {"code": "K244-PRECHECK", "name": "Pre-Test Circuit Check", "section_ref": "4.1", "sequence_order": 1, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 0},
        {"code": "K244-SETUP", "name": "Preamp Initial Setup", "section_ref": "4.2", "sequence_order": 2, "warmup_minutes": 0, "default_pulse_width_us": 259.0, "requires_calibration": 1},
        {"code": "K244-DCYLIM", "name": "Duty Cycle Limit Test", "section_ref": "4.3", "sequence_order": 3, "warmup_minutes": 0, "default_pulse_width_us": 259.0, "requires_calibration": 1},
        {"code": "K244-DRVVOLT", "name": "Driver Regulator Voltage Setup", "section_ref": "4.4", "sequence_order": 4, "warmup_minutes": 0, "default_pulse_width_us": 259.0, "requires_calibration": 1},
        {"code": "K244-DRVTUNE", "name": "Driver Amplifier Tuning", "section_ref": "4.5", "sequence_order": 5, "warmup_minutes": 0, "default_pulse_width_us": 259.0, "requires_calibration": 1},
        {"code": "K244-FINAL", "name": "Final Data Preamp", "section_ref": "4.6", "sequence_order": 6, "warmup_minutes": 0, "default_pulse_width_us": 259.0, "requires_calibration": 1},
    ],
    "110K243": [
        {"code": "K243-DCAL", "name": "Daily Calibration", "section_ref": "4.2.1", "sequence_order": 1, "warmup_minutes": 0, "default_pulse_width_us": 253.0, "requires_calibration": 0},
        {"code": "K243-PRECHECK", "name": "Pre-Test Circuit Check", "section_ref": "4.2.2", "sequence_order": 2, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 0},
        {"code": "K243-FINAL", "name": "Final Test", "section_ref": "4.3", "sequence_order": 3, "warmup_minutes": 10, "default_pulse_width_us": 253.0, "requires_calibration": 1},
    ],
    "IF_RECVR": [
        {"code": "IFRCV-FPGA", "name": "FPGA Programming", "section_ref": "3.2", "sequence_order": 1, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 0},
        {"code": "IFRCV-CURR", "name": "Input Current", "section_ref": "3.3.1", "sequence_order": 2, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 0},
        {"code": "IFRCV-COMM", "name": "Communications Test", "section_ref": "3.3.2", "sequence_order": 3, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 0},
        {"code": "IFRCV-GAIN", "name": "Gain Test", "section_ref": "3.3.3", "sequence_order": 4, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 1},
        {"code": "IFRCV-NAGC", "name": "NAGC Level Test", "section_ref": "3.3.4", "sequence_order": 5, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 1},
        {"code": "IFRCV-DYN", "name": "Dynamic Range", "section_ref": "3.3.5", "sequence_order": 6, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 1},
        {"code": "IFRCV-STC", "name": "STC Level Test", "section_ref": "3.3.6", "sequence_order": 7, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 1},
        {"code": "IFRCV-BW", "name": "Bandwidth Test", "section_ref": "3.3.7", "sequence_order": 8, "warmup_minutes": 0, "default_pulse_width_us": None, "requires_calibration": 1},
    ],
}


# ---------------------------------------------------------------------------
# Calibration parameter templates per subsystem
# ---------------------------------------------------------------------------

CALIBRATION_PARAMETERS: dict[str, list[dict]] = {
    "110K245": [
        {"name": "Return Loss at 2800 MHz", "unit": "dB", "limit_type": "max", "limit_max": -18.0},
        {"name": "Return Loss at 2900 MHz", "unit": "dB", "limit_type": "max", "limit_max": -18.0},
        {"name": "Return Loss at 3000 MHz", "unit": "dB", "limit_type": "max", "limit_max": -18.0},
        {"name": "Return Loss at 3100 MHz", "unit": "dB", "limit_type": "max", "limit_max": -18.0},
        {"name": "Power Meter Reference", "unit": "dBm", "limit_type": "nominal", "limit_nominal": 0.0, "limit_tolerance": 0.05},
        {"name": "Cable Insertion Loss", "unit": "dB", "limit_type": "max", "limit_max": -0.50},
    ],
    "110K244": [
        {"name": "Return Loss at 2800 MHz", "unit": "dB", "limit_type": "max", "limit_max": -18.0},
        {"name": "Return Loss at 2900 MHz", "unit": "dB", "limit_type": "max", "limit_max": -18.0},
        {"name": "Return Loss at 3000 MHz", "unit": "dB", "limit_type": "max", "limit_max": -18.0},
        {"name": "Return Loss at 3100 MHz", "unit": "dB", "limit_type": "max", "limit_max": -18.0},
        {"name": "Power Meter Reference", "unit": "dBm", "limit_type": "nominal", "limit_nominal": 0.0, "limit_tolerance": 0.05},
        {"name": "Cable Insertion Loss", "unit": "dB", "limit_type": "max", "limit_max": -0.50},
    ],
    "110K243": [
        {"name": "Return Loss at 2800 MHz", "unit": "dB", "limit_type": "max", "limit_max": -10.0},
        {"name": "Return Loss at 2900 MHz", "unit": "dB", "limit_type": "max", "limit_max": -10.0},
        {"name": "Return Loss at 3000 MHz", "unit": "dB", "limit_type": "max", "limit_max": -10.0},
        {"name": "Return Loss at 3100 MHz", "unit": "dB", "limit_type": "max", "limit_max": -10.0},
        {"name": "Power Meter Reference", "unit": "dBm", "limit_type": "nominal", "limit_nominal": 0.0, "limit_tolerance": 0.05},
        {"name": "Cable Insertion Loss", "unit": "dB", "limit_type": "max", "limit_max": -0.50},
    ],
    "IF_RECVR": [
        {"name": "Signal Generator Level", "unit": "dBm", "limit_type": "nominal", "limit_nominal": -10.0, "limit_tolerance": 0.5},
        {"name": "IF Input Level Verification", "unit": "dBm", "limit_type": "nominal", "limit_nominal": -20.0, "limit_tolerance": 1.0},
    ],
}


# ---------------------------------------------------------------------------
# Test step definitions (keyed by procedure code)
# ---------------------------------------------------------------------------

def _k245_final_steps() -> list[dict]:
    """Generate test steps for K245-FINAL (110K245 Final Test ATP)."""
    steps = []
    sn = 0  # step number counter

    freqs = [2800, 2900, 3000, 3100]

    # Phase Shift measurements at 42.50 dBm
    sn += 1
    steps.append({
        "step_number": sn, "name": "Phase Shift at 2800 MHz",
        "step_type": "phase_shift", "instrument": "phase_meter",
        "frequency_mhz": 2800, "input_power_dbm": 42.50,
        "limit_type": "nominal", "limit_nominal": -125.0, "limit_tolerance": 20.0,
        "unit": "deg", "instructions": "Measure phase shift at 2800 MHz, 42.50 dBm input.",
    })
    sn += 1
    steps.append({
        "step_number": sn, "name": "Phase Shift at 3100 MHz",
        "step_type": "phase_shift", "instrument": "phase_meter",
        "frequency_mhz": 3100, "input_power_dbm": 42.50,
        "limit_type": "nominal", "limit_nominal": -12.0, "limit_tolerance": 20.0,
        "unit": "deg", "instructions": "Measure phase shift at 3100 MHz, 42.50 dBm input.",
    })

    # Phase Offset
    sn += 1
    steps.append({
        "step_number": sn, "name": "Phase Offset",
        "step_type": "phase_shift", "instrument": "phase_meter",
        "input_power_dbm": 42.50,
        "limit_type": "nominal", "limit_nominal": 0.0, "limit_tolerance": 2.0,
        "unit": "deg", "instructions": "Calculate phase offset at 42.50 dBm.",
    })

    # Return Loss at each frequency (42.50 dBm)
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Return Loss at {freq} MHz",
            "step_type": "return_loss", "instrument": "network_analyzer",
            "frequency_mhz": freq, "input_power_dbm": 42.50,
            "limit_type": "max", "limit_max": -11.0,
            "unit": "dB", "instructions": f"Measure return loss (S11) at {freq} MHz, 42.50 dBm.",
        })

    # Output Power at each frequency, 42.50 dBm drive
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Output Power at {freq} MHz (42.50 dBm)",
            "step_type": "output_power", "instrument": "power_meter",
            "frequency_mhz": freq, "input_power_dbm": 42.50,
            "limit_type": "min", "limit_min": 58.60,
            "unit": "dBm", "instructions": f"Measure output power at {freq} MHz, 42.50 dBm input.",
        })

    # Output Power at each frequency, 41.50 dBm drive (low drive)
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Output Power at {freq} MHz (41.50 dBm)",
            "step_type": "output_power", "instrument": "power_meter",
            "frequency_mhz": freq, "input_power_dbm": 41.50,
            "limit_type": "min", "limit_min": 58.60,
            "unit": "dBm", "instructions": f"Measure output power at {freq} MHz, 41.50 dBm input (low drive).",
        })

    # Output Power at each frequency, 43.50 dBm drive (high drive)
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Output Power at {freq} MHz (43.50 dBm)",
            "step_type": "output_power", "instrument": "power_meter",
            "frequency_mhz": freq, "input_power_dbm": 43.50,
            "limit_type": "min", "limit_min": 58.60,
            "unit": "dBm", "instructions": f"Measure output power at {freq} MHz, 43.50 dBm input (high drive).",
        })

    # Total Current at each frequency, 43.50 dBm drive
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Total Current at {freq} MHz (43.50 dBm)",
            "step_type": "current", "instrument": "multimeter",
            "frequency_mhz": freq, "input_power_dbm": 43.50,
            "limit_type": "max", "limit_max": 9.0,
            "unit": "A", "instructions": f"Measure total current at {freq} MHz, 43.50 dBm input.",
        })

    # Spectrum at each frequency
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Spectrum at {freq} MHz",
            "step_type": "spectrum", "instrument": "spectrum_analyzer",
            "frequency_mhz": freq, "input_power_dbm": 42.50,
            "limit_type": "passfail",
            "unit": "dBm", "instructions": f"Capture spectrum at {freq} MHz. Verify no spurious emissions.",
            "is_record_only": 1,
        })

    # BITE P1/P2 Between Pulse
    for probe in ["P1", "P2"]:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"BITE {probe} Between Pulse",
            "step_type": "bite_signal", "instrument": "oscilloscope",
            "limit_type": "max", "limit_max": 0.50,
            "unit": "V", "instructions": f"Measure BITE {probe} voltage between pulses.",
        })

    # BITE P1/P2 During Pulse
    for probe in ["P1", "P2"]:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"BITE {probe} During Pulse",
            "step_type": "bite_signal", "instrument": "oscilloscope",
            "limit_type": "nominal", "limit_nominal": 6.50, "limit_tolerance": 1.00,
            "unit": "V", "instructions": f"Measure BITE {probe} voltage during pulse.",
        })

    # Spring Finger Contact Resistance (4 contacts)
    for contact_idx in range(1, 5):
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Spring Finger Contact Resistance #{contact_idx}",
            "step_type": "resistance", "instrument": "multimeter",
            "limit_type": "nominal", "limit_nominal": 50.0, "limit_tolerance": 1.0,
            "unit": "ohms",
            "instructions": f"Measure spring finger contact resistance for contact #{contact_idx}.",
        })

    return steps


def _k243_final_steps() -> list[dict]:
    """Generate test steps for K243-FINAL (110K243 Final Test)."""
    steps = []
    sn = 0

    freqs = [2800, 2900, 3000, 3100]

    # MUX Testing — addresses 1–8 at 27us and 600us sample times
    for addr in range(1, 9):
        for sample_time in [27, 600]:
            sn += 1
            steps.append({
                "step_number": sn,
                "name": f"MUX Addr {addr} at {sample_time}us",
                "step_type": "mux_voltage", "instrument": "multimeter",
                "mux_address": str(addr), "mux_sample_time_us": float(sample_time),
                "limit_type": "passfail",
                "unit": "V",
                "instructions": f"Read MUX address {addr} at {sample_time}us sample time.",
                "is_record_only": 1,
            })

    # Pulse Shaping
    sn += 1
    steps.append({
        "step_number": sn, "name": "Pulse Shaping Width",
        "step_type": "pulse_width", "instrument": "oscilloscope",
        "limit_type": "nominal", "limit_nominal": 251.0, "limit_tolerance": 5.0,
        "unit": "usec", "instructions": "Measure shaped pulse width on oscilloscope.",
    })

    # PSS Pulse
    sn += 1
    steps.append({
        "step_number": sn, "name": "PSS Pulse Width",
        "step_type": "pulse_width", "instrument": "oscilloscope",
        "limit_type": "nominal", "limit_nominal": 200.0, "limit_tolerance": 5.0,
        "unit": "usec", "instructions": "Measure PSS pulse width on oscilloscope.",
    })

    # Phase Length at 3100 MHz
    sn += 1
    steps.append({
        "step_number": sn, "name": "Phase Length at 3100 MHz",
        "step_type": "phase_shift", "instrument": "phase_meter",
        "frequency_mhz": 3100, "input_power_dbm": 49.50,
        "limit_type": "nominal", "limit_nominal": -112.0, "limit_tolerance": 10.0,
        "unit": "deg", "instructions": "Measure phase length at 3100 MHz, 49.50 dBm input.",
    })

    # Return Loss at each frequency (49.50 dBm)
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Return Loss at {freq} MHz",
            "step_type": "return_loss", "instrument": "network_analyzer",
            "frequency_mhz": freq, "input_power_dbm": 49.50,
            "limit_type": "max", "limit_max": -10.0,
            "unit": "dB", "instructions": f"Measure return loss (S11) at {freq} MHz, 49.50 dBm.",
        })

    # Output Power at each frequency, 49.50 dBm drive
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Output Power at {freq} MHz (49.50 dBm)",
            "step_type": "output_power", "instrument": "power_meter",
            "frequency_mhz": freq, "input_power_dbm": 49.50,
            "limit_type": "min", "limit_min": 64.00,
            "unit": "dBm", "instructions": f"Measure output power at {freq} MHz, 49.50 dBm input.",
        })

    # Output Power at each frequency, 50.50 dBm drive (high drive)
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Output Power at {freq} MHz (50.50 dBm)",
            "step_type": "output_power", "instrument": "power_meter",
            "frequency_mhz": freq, "input_power_dbm": 50.50,
            "limit_type": "min", "limit_min": 64.00,
            "unit": "dBm", "instructions": f"Measure output power at {freq} MHz, 50.50 dBm input (high drive).",
        })

    # Short Pulse Stress BITE at selected frequencies
    stress_freqs = [3100, 3000, 2900, 2850, 2800]
    for freq in stress_freqs:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Short Pulse Stress BITE at {freq} MHz",
            "step_type": "bite_signal", "instrument": "oscilloscope",
            "frequency_mhz": freq,
            "limit_type": "min", "limit_min": 8.5,
            "unit": "V", "instructions": f"Measure BITE during short pulse stress at {freq} MHz.",
        })

    # P2 Resistance
    sn += 1
    steps.append({
        "step_number": sn, "name": "P2 Resistance",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "nominal", "limit_nominal": 3.15, "limit_tolerance": 0.10,
        "unit": "ohms", "instructions": "Measure P2 resistance with multimeter.",
    })

    # Plunger Switch
    sn += 1
    steps.append({
        "step_number": sn, "name": "Plunger Switch Resistance",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "nominal", "limit_nominal": 10.0, "limit_tolerance": 5.0,
        "unit": "ohms", "instructions": "Measure plunger switch resistance.",
    })

    return steps


def _ifrcv_comm_steps() -> list[dict]:
    """Generate test steps for IFRCV-COMM (IF Receiver Communications Test)."""
    steps = []
    sn = 0

    # Write 0x0000 to test register
    sn += 1
    steps.append({
        "step_number": sn, "name": "Write 0x0000 to Test Register",
        "step_type": "bus_write", "instrument": "common_bus",
        "bus_address": "0x0000", "bus_data": "0x0000", "bus_rw": "W",
        "limit_type": "passfail",
        "unit": "hex", "instructions": "Write 0x0000 to test register.",
    })

    # Read back 0x0000
    sn += 1
    steps.append({
        "step_number": sn, "name": "Read Back 0x0000",
        "step_type": "bus_read", "instrument": "common_bus",
        "bus_address": "0x0000", "bus_data": "0x0000", "bus_rw": "R",
        "limit_type": "exact",
        "unit": "hex", "instructions": "Read back test register, expect 0x0000.",
    })

    # Write 0xFFFF to test register
    sn += 1
    steps.append({
        "step_number": sn, "name": "Write 0xFFFF to Test Register",
        "step_type": "bus_write", "instrument": "common_bus",
        "bus_address": "0x0000", "bus_data": "0xFFFF", "bus_rw": "W",
        "limit_type": "passfail",
        "unit": "hex", "instructions": "Write 0xFFFF to test register.",
    })

    # Read back 0xFFFF
    sn += 1
    steps.append({
        "step_number": sn, "name": "Read Back 0xFFFF",
        "step_type": "bus_read", "instrument": "common_bus",
        "bus_address": "0x0000", "bus_data": "0xFFFF", "bus_rw": "R",
        "limit_type": "exact",
        "unit": "hex", "instructions": "Read back test register, expect 0xFFFF.",
    })

    # Read Firmware ID
    sn += 1
    steps.append({
        "step_number": sn, "name": "Read Firmware ID",
        "step_type": "bus_read", "instrument": "common_bus",
        "bus_address": "0x8BC0", "bus_data": "0x0101", "bus_rw": "R",
        "limit_type": "exact",
        "unit": "hex", "instructions": "Read Firmware ID register 0x8BC0, expect 0x0101.",
    })

    # STC profile registers (representative sample)
    stc_registers = [
        ("0x880B", "0x00B0"),
        ("0x8822", "0x0220"),
    ]
    for addr, expected in stc_registers:
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Read STC Register {addr}",
            "step_type": "bus_read", "instrument": "common_bus",
            "bus_address": addr, "bus_data": expected, "bus_rw": "R",
            "limit_type": "exact",
            "unit": "hex", "instructions": f"Read STC profile register {addr}, expect {expected}.",
        })

    # Read UNIQUE_CTRLS_A
    sn += 1
    steps.append({
        "step_number": sn, "name": "Read UNIQUE_CTRLS_A",
        "step_type": "bus_read", "instrument": "common_bus",
        "bus_address": "0x8C00", "bus_data": "0x00FF", "bus_rw": "R",
        "limit_type": "exact",
        "unit": "hex", "instructions": "Read UNIQUE_CTRLS_A register 0x8C00, expect 0x00FF.",
    })

    # Read BROADCAST_CONTROLS
    sn += 1
    steps.append({
        "step_number": sn, "name": "Read BROADCAST_CONTROLS",
        "step_type": "bus_read", "instrument": "common_bus",
        "bus_address": "0x8FC0", "bus_data": "0x0000", "bus_rw": "R",
        "limit_type": "exact",
        "unit": "hex", "instructions": "Read BROADCAST_CONTROLS register 0x8FC0, expect 0x0000.",
    })

    return steps


def _ifrcv_gain_steps() -> list[dict]:
    """Generate test steps for IFRCV-GAIN (IF Receiver Gain Test)."""
    steps = []
    sn = 0

    for channel in ["A", "B"]:
        # Peak Output
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Peak Output Channel {channel}",
            "step_type": "fft_peak", "instrument": "fft_display",
            "limit_type": "nominal", "limit_nominal": -4.0, "limit_tolerance": 3.0,
            "unit": "dBSat",
            "instructions": f"Measure peak output level for Channel {channel}.",
        })

        # Noise Floor
        sn += 1
        steps.append({
            "step_number": sn, "name": f"Noise Floor Channel {channel}",
            "step_type": "fft_noise", "instrument": "fft_display",
            "limit_type": "max", "limit_max": -60.0,
            "unit": "dBSat",
            "instructions": f"Measure noise floor for Channel {channel}.",
        })

        # SFDR
        sn += 1
        steps.append({
            "step_number": sn, "name": f"SFDR Channel {channel}",
            "step_type": "fft_sfdr", "instrument": "fft_display",
            "limit_type": "min", "limit_min": 60.0,
            "unit": "dBc",
            "instructions": f"Measure Spurious Free Dynamic Range for Channel {channel}.",
        })

    return steps


def _ifrcv_curr_steps() -> list[dict]:
    """Generate test steps for IFRCV-CURR (IF Receiver Input Current)."""
    steps = []
    sn = 0

    current_specs = [
        ("+3.3V Current", 1.00, 3.00, "A"),
        ("+5V Current",   None, 1.35, "A"),
        ("+9V Current",   0.60, 1.50, "A"),
        ("+18V Current",  0.30, 0.70, "A"),
        ("-8V Current",   0.05, 0.40, "A"),
    ]

    for name, lmin, lmax, unit in current_specs:
        sn += 1
        step = {
            "step_number": sn, "name": name,
            "step_type": "input_current", "instrument": "multimeter",
            "limit_type": "range",
            "unit": unit,
            "instructions": f"Measure {name} with multimeter.",
        }
        if lmin is not None:
            step["limit_min"] = lmin
        step["limit_max"] = lmax
        steps.append(step)

    return steps


# ---------------------------------------------------------------------------
# 110K245 — Power Module Assembly step generators
# ---------------------------------------------------------------------------

def _k245_dcal_steps() -> list[dict]:
    """K245-DCAL: Daily Calibration (section 4.2.1).

    Return loss calibration at -18.0 dB spec across 2800-3100 MHz using
    the network analyzer, plus power reference calibration on the power meter.
    """
    steps = []
    sn = 0

    freqs = [2800, 2900, 3000, 3100]

    # Return loss calibration check at each frequency
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Return Loss Cal Check at {freq} MHz",
            "step_type": "return_loss", "instrument": "network_analyzer",
            "frequency_mhz": freq,
            "limit_type": "max", "limit_max": -18.0,
            "unit": "dB",
            "instructions": (
                f"Verify daily calibration return loss at {freq} MHz using reference load. "
                "Must be better than -18.0 dB."
            ),
        })

    # Power meter reference calibration
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Power Meter Reference Cal",
        "step_type": "output_power", "instrument": "power_meter",
        "frequency_mhz": 2950,
        "limit_type": "nominal", "limit_nominal": 0.0, "limit_tolerance": 0.05,
        "unit": "dBm",
        "instructions": (
            "Calibrate power meter using internal 50 MHz reference. "
            "Zero and calibrate, then verify reference reads 0.00 dBm ±0.05."
        ),
    })

    # Network analyzer cable loss verification
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Cable Loss Verification",
        "step_type": "return_loss", "instrument": "network_analyzer",
        "frequency_mhz": 2950,
        "limit_type": "max", "limit_max": -0.50,
        "unit": "dB",
        "instructions": (
            "Verify test cable insertion loss is within acceptable limits. "
            "Connect thru and measure at band center."
        ),
    })

    return steps


def _k245_precheck_steps() -> list[dict]:
    """K245-PRECHECK: Pre-Test Circuit Check (section 4.2.2).

    Spring finger contact resistance checks (50 +/- 1 ohms) and continuity.
    """
    steps = []
    sn = 0

    # Spring finger contact resistance — 4 contacts
    for contact_idx in range(1, 5):
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Spring Finger Contact #{contact_idx} Resistance",
            "step_type": "resistance", "instrument": "multimeter",
            "limit_type": "nominal", "limit_nominal": 50.0, "limit_tolerance": 1.0,
            "unit": "ohms",
            "instructions": (
                f"Measure spring finger contact #{contact_idx} resistance. "
                "Expected 50 ±1 ohms."
            ),
        })

    # RF connector center pin continuity
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "RF Input Connector Continuity",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "max", "limit_max": 1.0,
        "unit": "ohms",
        "instructions": "Verify RF input connector center pin continuity. Must be < 1 ohm.",
    })

    # RF output connector continuity
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "RF Output Connector Continuity",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "max", "limit_max": 1.0,
        "unit": "ohms",
        "instructions": "Verify RF output connector center pin continuity. Must be < 1 ohm.",
    })

    # Ground continuity
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Chassis Ground Continuity",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "max", "limit_max": 0.5,
        "unit": "ohms",
        "instructions": "Verify chassis ground continuity from input to output. Must be < 0.5 ohms.",
    })

    return steps


def _k245_q1tune_steps() -> list[dict]:
    """K245-Q1TUNE: Tuning Q1 (section 4.3).

    Return loss tuning at 2800-3100 MHz, output power at 45.0-47.40 dBm range.
    """
    steps = []
    sn = 0

    freqs = [2800, 2900, 3000, 3100]

    # Return loss tuning at each frequency
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Q1 Return Loss at {freq} MHz",
            "step_type": "return_loss", "instrument": "network_analyzer",
            "frequency_mhz": freq, "input_power_dbm": 16.0,
            "limit_type": "max", "limit_max": -11.0,
            "unit": "dB",
            "instructions": f"Tune Q1 for return loss at {freq} MHz. Must be better than -11.0 dB.",
        })

    # Output power at each frequency — range 45.0 to 47.40 dBm
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Q1 Output Power at {freq} MHz",
            "step_type": "output_power", "instrument": "power_meter",
            "frequency_mhz": freq, "input_power_dbm": 16.0,
            "limit_type": "range", "limit_min": 45.0, "limit_max": 47.40,
            "unit": "dBm",
            "instructions": (
                f"Measure Q1 output power at {freq} MHz, 16.0 dBm drive. "
                "Must be 45.0 to 47.40 dBm."
            ),
        })

    # Q1 current draw
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Q1 Current Draw",
        "step_type": "current", "instrument": "multimeter",
        "frequency_mhz": 2950, "input_power_dbm": 16.0,
        "limit_type": "max", "limit_max": 3.5,
        "unit": "A",
        "instructions": "Measure Q1 DC current draw at band center. Must be < 3.5 A.",
    })

    return steps


def _k245_q1drv_steps() -> list[dict]:
    """K245-Q1DRV: Driver Test Q1 (section 4.4).

    RF output power at multiple drive levels through Q1.
    """
    steps = []
    sn = 0

    freqs = [2800, 2900, 3000, 3100]
    drive_levels = [
        (14.0, 43.0, 46.0, "low drive"),
        (16.0, 45.0, 47.40, "nominal drive"),
        (18.0, 46.0, 48.50, "high drive"),
    ]

    for drive_dbm, pmin, pmax, label in drive_levels:
        for freq in freqs:
            sn += 1
            steps.append({
                "step_number": sn,
                "name": f"Q1 Output at {freq} MHz ({drive_dbm} dBm {label})",
                "step_type": "output_power", "instrument": "power_meter",
                "frequency_mhz": freq, "input_power_dbm": drive_dbm,
                "limit_type": "range", "limit_min": pmin, "limit_max": pmax,
                "unit": "dBm",
                "instructions": (
                    f"Measure Q1 output power at {freq} MHz, {drive_dbm} dBm input ({label}). "
                    f"Must be {pmin} to {pmax} dBm."
                ),
            })

    # Current at high drive
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Q1 Current at {freq} MHz (18.0 dBm)",
            "step_type": "current", "instrument": "multimeter",
            "frequency_mhz": freq, "input_power_dbm": 18.0,
            "limit_type": "max", "limit_max": 4.0,
            "unit": "A",
            "instructions": f"Measure Q1 current at {freq} MHz, 18.0 dBm drive. Must be < 4.0 A.",
        })

    return steps


def _k245_q23tune_steps() -> list[dict]:
    """K245-Q23TUNE: Tuning Q2/Q3 (section 4.5).

    Output power, insertion phase, and return loss for Q2/Q3 stages.
    """
    steps = []
    sn = 0

    freqs = [2800, 2900, 3000, 3100]

    # Q2 return loss tuning
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Q2 Return Loss at {freq} MHz",
            "step_type": "return_loss", "instrument": "network_analyzer",
            "frequency_mhz": freq, "input_power_dbm": 42.50,
            "limit_type": "max", "limit_max": -11.0,
            "unit": "dB",
            "instructions": f"Tune Q2 input return loss at {freq} MHz. Must be better than -11.0 dB.",
        })

    # Q2/Q3 combined output power
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Q2/Q3 Output Power at {freq} MHz",
            "step_type": "output_power", "instrument": "power_meter",
            "frequency_mhz": freq, "input_power_dbm": 42.50,
            "limit_type": "min", "limit_min": 58.60,
            "unit": "dBm",
            "instructions": (
                f"Measure Q2/Q3 combined output power at {freq} MHz, 42.50 dBm drive. "
                "Must be >= 58.60 dBm (724W)."
            ),
        })

    # Insertion phase for Q2/Q3
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Q2/Q3 Phase Shift at 2800 MHz",
        "step_type": "phase_shift", "instrument": "phase_meter",
        "frequency_mhz": 2800, "input_power_dbm": 42.50,
        "limit_type": "nominal", "limit_nominal": -125.0, "limit_tolerance": 20.0,
        "unit": "deg",
        "instructions": "Measure Q2/Q3 insertion phase at 2800 MHz, 42.50 dBm.",
    })
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Q2/Q3 Phase Shift at 3100 MHz",
        "step_type": "phase_shift", "instrument": "phase_meter",
        "frequency_mhz": 3100, "input_power_dbm": 42.50,
        "limit_type": "nominal", "limit_nominal": -12.0, "limit_tolerance": 20.0,
        "unit": "deg",
        "instructions": "Measure Q2/Q3 insertion phase at 3100 MHz, 42.50 dBm.",
    })

    # Q3 return loss
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Q3 Return Loss at {freq} MHz",
            "step_type": "return_loss", "instrument": "network_analyzer",
            "frequency_mhz": freq, "input_power_dbm": 42.50,
            "limit_type": "max", "limit_max": -11.0,
            "unit": "dB",
            "instructions": f"Tune Q3 output return loss at {freq} MHz. Must be better than -11.0 dB.",
        })

    # Current at nominal drive
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Q2/Q3 Total Current",
        "step_type": "current", "instrument": "multimeter",
        "frequency_mhz": 2950, "input_power_dbm": 42.50,
        "limit_type": "max", "limit_max": 9.0,
        "unit": "A",
        "instructions": "Measure Q2/Q3 total current at band center, 42.50 dBm. Must be < 9.0 A.",
    })

    return steps


# ---------------------------------------------------------------------------
# 110K244 — Preamplifier Panel Assembly step generators
# ---------------------------------------------------------------------------

def _k244_precheck_steps() -> list[dict]:
    """K244-PRECHECK: Pre-Test Circuit Check (section 4.1).

    P2 resistance 6.27 +/- 0.20 ohms and basic continuity checks.
    """
    steps = []
    sn = 0

    # P2 resistance
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "P2 Resistance",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "nominal", "limit_nominal": 6.27, "limit_tolerance": 0.20,
        "unit": "ohms",
        "instructions": "Measure P2 resistance at connector P2. Expected 6.27 ±0.20 ohms.",
    })

    # RF input connector continuity
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "RF Input Connector Continuity",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "max", "limit_max": 1.0,
        "unit": "ohms",
        "instructions": "Verify RF input connector center pin continuity. Must be < 1 ohm.",
    })

    # RF output connector continuity
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "RF Output Connector Continuity",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "max", "limit_max": 1.0,
        "unit": "ohms",
        "instructions": "Verify RF output connector center pin continuity. Must be < 1 ohm.",
    })

    # Chassis ground
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Chassis Ground Continuity",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "max", "limit_max": 0.5,
        "unit": "ohms",
        "instructions": "Verify chassis ground continuity. Must be < 0.5 ohms.",
    })

    # Interlock circuit
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Interlock Circuit Resistance",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "max", "limit_max": 2.0,
        "unit": "ohms",
        "instructions": "Verify interlock circuit resistance. Must be < 2.0 ohms.",
    })

    return steps


def _k244_setup_steps() -> list[dict]:
    """K244-SETUP: Preamp Initial Setup (section 4.2).

    Power-on verification, signal assertions, initial bias setup.
    """
    steps = []
    sn = 0

    # Supply voltage verification
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "+28V Supply Voltage",
        "step_type": "mux_voltage", "instrument": "multimeter",
        "limit_type": "nominal", "limit_nominal": 28.0, "limit_tolerance": 1.0,
        "unit": "V",
        "instructions": "Verify +28V supply voltage at power input. Expected 28.0 ±1.0 V.",
    })

    # BITE signal verification (power on)
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "BITE Signal Power-On",
        "step_type": "bite_signal", "instrument": "oscilloscope",
        "limit_type": "min", "limit_min": 4.0,
        "unit": "V",
        "instructions": "Verify BITE signal asserts high (>4.0V) after power-on.",
    })

    # Quiescent current (no RF)
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Quiescent Current (No RF)",
        "step_type": "current", "instrument": "multimeter",
        "limit_type": "range", "limit_min": 2.0, "limit_max": 5.0,
        "unit": "A",
        "instructions": "Measure quiescent DC current with no RF input. Expected 2.0 to 5.0 A.",
    })

    # Gate bias voltage
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Driver Gate Bias Voltage",
        "step_type": "mux_voltage", "instrument": "multimeter",
        "limit_type": "range", "limit_min": -1.50, "limit_max": -0.50,
        "unit": "V",
        "instructions": "Measure driver gate bias voltage. Expected -1.50 to -0.50 V.",
    })

    # Pulse input verification
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Pulse Input Verification",
        "step_type": "pulse_width", "instrument": "oscilloscope",
        "limit_type": "nominal", "limit_nominal": 259.0, "limit_tolerance": 5.0,
        "unit": "usec",
        "instructions": "Verify input pulse width on oscilloscope. Expected 259 ±5 usec.",
    })

    return steps


def _k244_dcylim_steps() -> list[dict]:
    """K244-DCYLIM: Duty Cycle Limit Test (section 4.3).

    Duty cycle limiting verification at various pulse repetition rates.
    """
    steps = []
    sn = 0

    # Nominal duty cycle check
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Nominal Duty Cycle BITE",
        "step_type": "bite_signal", "instrument": "oscilloscope",
        "limit_type": "min", "limit_min": 4.0,
        "unit": "V",
        "instructions": (
            "At nominal duty cycle (259 usec pulse, 1 ms PRI), verify BITE remains asserted (>4.0V)."
        ),
    })

    # Increased duty cycle — should trip limiter
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Over-Duty Cycle Limit Trip",
        "step_type": "bite_signal", "instrument": "oscilloscope",
        "limit_type": "max", "limit_max": 1.0,
        "unit": "V",
        "instructions": (
            "Increase duty cycle above limit. Verify BITE de-asserts (<1.0V) indicating "
            "duty cycle limiter tripped."
        ),
        "safety_warning": "Do not exceed maximum duty cycle for more than 5 seconds.",
    })

    # Recovery check — BITE re-asserts
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Duty Cycle Limiter Recovery",
        "step_type": "bite_signal", "instrument": "oscilloscope",
        "limit_type": "min", "limit_min": 4.0,
        "unit": "V",
        "instructions": (
            "Return to nominal duty cycle. Verify BITE re-asserts (>4.0V) within 2 seconds."
        ),
    })

    # Output power at nominal duty cycle
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Output Power at Nominal Duty Cycle",
        "step_type": "output_power", "instrument": "power_meter",
        "frequency_mhz": 2950, "input_power_dbm": 16.0,
        "limit_type": "min", "limit_min": 55.0,
        "unit": "dBm",
        "instructions": "Verify output power at nominal duty cycle, band center. Must be >= 55.0 dBm.",
    })

    return steps


def _k244_drvvolt_steps() -> list[dict]:
    """K244-DRVVOLT: Driver Regulator Voltage Setup (section 4.4).

    Driver regulator voltage measurement and adjustment.
    """
    steps = []
    sn = 0

    # Driver regulator voltage
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Driver Regulator Voltage",
        "step_type": "mux_voltage", "instrument": "multimeter",
        "limit_type": "nominal", "limit_nominal": 10.0, "limit_tolerance": 0.50,
        "unit": "V",
        "instructions": (
            "Measure driver regulator output voltage. Adjust R-trim if needed. "
            "Expected 10.0 ±0.50 V."
        ),
    })

    # Driver drain voltage
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Driver Drain Voltage",
        "step_type": "mux_voltage", "instrument": "multimeter",
        "limit_type": "nominal", "limit_nominal": 28.0, "limit_tolerance": 1.0,
        "unit": "V",
        "instructions": "Measure driver drain supply voltage. Expected 28.0 ±1.0 V.",
    })

    # Driver current at idle
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Driver Idle Current",
        "step_type": "current", "instrument": "multimeter",
        "limit_type": "range", "limit_min": 0.5, "limit_max": 2.0,
        "unit": "A",
        "instructions": "Measure driver idle current (no RF). Expected 0.5 to 2.0 A.",
    })

    # Driver output with RF applied
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Driver Output Power Verify",
        "step_type": "output_power", "instrument": "power_meter",
        "frequency_mhz": 2950, "input_power_dbm": 16.0,
        "limit_type": "range", "limit_min": 42.0, "limit_max": 46.0,
        "unit": "dBm",
        "instructions": (
            "Apply 16.0 dBm RF input at band center. "
            "Verify driver output is 42.0 to 46.0 dBm."
        ),
    })

    return steps


def _k244_drvtune_steps() -> list[dict]:
    """K244-DRVTUNE: Driver Amplifier Tuning (section 4.5).

    Driver amp tuning at multiple frequencies across 2800-3100 MHz.
    """
    steps = []
    sn = 0

    freqs = [2800, 2900, 2950, 3000, 3100]

    # Return loss at each frequency
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Driver Return Loss at {freq} MHz",
            "step_type": "return_loss", "instrument": "network_analyzer",
            "frequency_mhz": freq, "input_power_dbm": 16.0,
            "limit_type": "max", "limit_max": -11.0,
            "unit": "dB",
            "instructions": (
                f"Tune driver amplifier input match at {freq} MHz. "
                "Must be better than -11.0 dB."
            ),
        })

    # Output power at each frequency
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Driver Output Power at {freq} MHz",
            "step_type": "output_power", "instrument": "power_meter",
            "frequency_mhz": freq, "input_power_dbm": 16.0,
            "limit_type": "range", "limit_min": 42.0, "limit_max": 46.0,
            "unit": "dBm",
            "instructions": (
                f"Measure driver output power at {freq} MHz, 16.0 dBm drive. "
                "Expected 42.0 to 46.0 dBm."
            ),
        })

    # Driver current at each band edge
    for freq in [2800, 3100]:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Driver Current at {freq} MHz",
            "step_type": "current", "instrument": "multimeter",
            "frequency_mhz": freq, "input_power_dbm": 16.0,
            "limit_type": "max", "limit_max": 3.0,
            "unit": "A",
            "instructions": f"Measure driver current at {freq} MHz, 16.0 dBm. Must be < 3.0 A.",
        })

    return steps


def _k244_final_steps() -> list[dict]:
    """K244-FINAL: Final Data Preamp (section 4.6).

    Full output power at 13 frequencies (2800-3100 MHz every 25 MHz),
    return loss, phase shift, total current, and spectrum analysis.
    Output range: 61.85-62.85 dBm (1531-1928W).
    """
    steps = []
    sn = 0

    # 13 frequencies from 2800 to 3100 MHz every 25 MHz
    freqs_13 = list(range(2800, 3101, 25))  # [2800, 2825, ..., 3100]

    # Output power at all 13 frequencies, nominal drive 16.0 dBm
    for freq in freqs_13:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Output Power at {freq} MHz",
            "step_type": "output_power", "instrument": "power_meter",
            "frequency_mhz": freq, "input_power_dbm": 16.0,
            "limit_type": "range", "limit_min": 61.85, "limit_max": 62.85,
            "unit": "dBm",
            "instructions": (
                f"Measure preamplifier output power at {freq} MHz, 16.0 dBm input. "
                "Must be 61.85 to 62.85 dBm (1531-1928W)."
            ),
        })

    # Return loss at band edges and center
    rl_freqs = [2800, 2900, 2950, 3000, 3100]
    for freq in rl_freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Return Loss at {freq} MHz",
            "step_type": "return_loss", "instrument": "network_analyzer",
            "frequency_mhz": freq, "input_power_dbm": 16.0,
            "limit_type": "max", "limit_max": -11.0,
            "unit": "dB",
            "instructions": f"Measure input return loss at {freq} MHz. Must be better than -11.0 dB.",
        })

    # Phase shift at band edges
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Phase Shift at 2800 MHz",
        "step_type": "phase_shift", "instrument": "phase_meter",
        "frequency_mhz": 2800, "input_power_dbm": 16.0,
        "limit_type": "nominal", "limit_nominal": -200.0, "limit_tolerance": 30.0,
        "unit": "deg",
        "instructions": "Measure preamplifier insertion phase at 2800 MHz.",
    })
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Phase Shift at 3100 MHz",
        "step_type": "phase_shift", "instrument": "phase_meter",
        "frequency_mhz": 3100, "input_power_dbm": 16.0,
        "limit_type": "nominal", "limit_nominal": -45.0, "limit_tolerance": 30.0,
        "unit": "deg",
        "instructions": "Measure preamplifier insertion phase at 3100 MHz.",
    })

    # Total current at all 13 frequencies
    for freq in freqs_13:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Total Current at {freq} MHz",
            "step_type": "current", "instrument": "multimeter",
            "frequency_mhz": freq, "input_power_dbm": 16.0,
            "limit_type": "max", "limit_max": 25.0,
            "unit": "A",
            "instructions": f"Measure total DC current at {freq} MHz. Must be < 25.0 A.",
        })

    # Spectrum at band edges and center
    for freq in [2800, 2950, 3100]:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Spectrum at {freq} MHz",
            "step_type": "spectrum", "instrument": "spectrum_analyzer",
            "frequency_mhz": freq, "input_power_dbm": 16.0,
            "limit_type": "passfail",
            "unit": "dBm",
            "instructions": f"Capture spectrum at {freq} MHz. Verify no spurious emissions.",
            "is_record_only": 1,
        })

    # BITE during pulse
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "BITE During Pulse",
        "step_type": "bite_signal", "instrument": "oscilloscope",
        "limit_type": "nominal", "limit_nominal": 6.50, "limit_tolerance": 1.50,
        "unit": "V",
        "instructions": "Measure BITE voltage during pulse. Expected 6.50 ±1.50 V.",
    })

    # BITE between pulses
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "BITE Between Pulses",
        "step_type": "bite_signal", "instrument": "oscilloscope",
        "limit_type": "max", "limit_max": 0.50,
        "unit": "V",
        "instructions": "Measure BITE voltage between pulses. Must be < 0.50 V.",
    })

    return steps


# ---------------------------------------------------------------------------
# 110K243 — RF Output Panel Assembly step generators
# ---------------------------------------------------------------------------

def _k243_dcal_steps() -> list[dict]:
    """K243-DCAL: Daily Calibration (section 4.2.1).

    Return loss calibration at -18.0 dB spec across 2800-3100 MHz.
    """
    steps = []
    sn = 0

    freqs = [2800, 2900, 3000, 3100]

    # Return loss calibration check at each frequency
    for freq in freqs:
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Return Loss Cal Check at {freq} MHz",
            "step_type": "return_loss", "instrument": "network_analyzer",
            "frequency_mhz": freq,
            "limit_type": "max", "limit_max": -18.0,
            "unit": "dB",
            "instructions": (
                f"Verify daily calibration return loss at {freq} MHz using reference load. "
                "Must be better than -18.0 dB."
            ),
        })

    # Power meter reference calibration
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Power Meter Reference Cal",
        "step_type": "output_power", "instrument": "power_meter",
        "frequency_mhz": 2950,
        "limit_type": "nominal", "limit_nominal": 0.0, "limit_tolerance": 0.05,
        "unit": "dBm",
        "instructions": (
            "Calibrate power meter using internal 50 MHz reference. "
            "Zero and calibrate, then verify reference reads 0.00 dBm ±0.05."
        ),
    })

    # Cable loss verification
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Cable Loss Verification",
        "step_type": "return_loss", "instrument": "network_analyzer",
        "frequency_mhz": 2950,
        "limit_type": "max", "limit_max": -0.50,
        "unit": "dB",
        "instructions": (
            "Verify test cable insertion loss is within acceptable limits. "
            "Connect thru and measure at band center."
        ),
    })

    return steps


def _k243_precheck_steps() -> list[dict]:
    """K243-PRECHECK: Pre-Test Circuit Check (section 4.2.2).

    Pre-test resistance and continuity checks for RF Output Panel.
    """
    steps = []
    sn = 0

    # P2 resistance
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "P2 Resistance",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "nominal", "limit_nominal": 3.15, "limit_tolerance": 0.10,
        "unit": "ohms",
        "instructions": "Measure P2 resistance. Expected 3.15 ±0.10 ohms.",
    })

    # RF input connector continuity
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "RF Input Connector Continuity",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "max", "limit_max": 1.0,
        "unit": "ohms",
        "instructions": "Verify RF input connector center pin continuity. Must be < 1 ohm.",
    })

    # RF output connector continuity
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "RF Output Connector Continuity",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "max", "limit_max": 1.0,
        "unit": "ohms",
        "instructions": "Verify RF output connector center pin continuity. Must be < 1 ohm.",
    })

    # Chassis ground
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Chassis Ground Continuity",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "max", "limit_max": 0.5,
        "unit": "ohms",
        "instructions": "Verify chassis ground continuity. Must be < 0.5 ohms.",
    })

    # Plunger switch resistance
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Plunger Switch Resistance",
        "step_type": "resistance", "instrument": "multimeter",
        "limit_type": "nominal", "limit_nominal": 10.0, "limit_tolerance": 5.0,
        "unit": "ohms",
        "instructions": "Measure plunger switch resistance. Expected 10.0 ±5.0 ohms.",
    })

    return steps


# ---------------------------------------------------------------------------
# IF Receiver step generators
# ---------------------------------------------------------------------------

def _ifrcv_fpga_steps() -> list[dict]:
    """IFRCV-FPGA: FPGA Programming (section 3.2).

    FPGA load verification and firmware ID check.
    """
    steps = []
    sn = 0

    # Write FPGA load command
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "FPGA Load Command",
        "step_type": "bus_write", "instrument": "common_bus",
        "bus_address": "0x8BC0", "bus_data": "0x0001", "bus_rw": "W",
        "limit_type": "passfail",
        "unit": "hex",
        "instructions": "Write FPGA load command to register 0x8BC0.",
    })

    # Verify FPGA loaded status
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "FPGA Load Status",
        "step_type": "bus_read", "instrument": "common_bus",
        "bus_address": "0x8BC1", "bus_data": "0x0001", "bus_rw": "R",
        "limit_type": "exact",
        "unit": "hex",
        "instructions": "Read FPGA load status register 0x8BC1. Expect 0x0001 (loaded).",
    })

    # Read firmware ID
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "Firmware ID Check",
        "step_type": "bus_read", "instrument": "common_bus",
        "bus_address": "0x8BC0", "bus_data": "0x0101", "bus_rw": "R",
        "limit_type": "exact",
        "unit": "hex",
        "instructions": "Read Firmware ID register 0x8BC0. Expect 0x0101 (version 1.01).",
    })

    # Read FPGA revision register
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "FPGA Revision Register",
        "step_type": "bus_read", "instrument": "common_bus",
        "bus_address": "0x8BC2", "bus_data": "0x0200", "bus_rw": "R",
        "limit_type": "exact",
        "unit": "hex",
        "instructions": "Read FPGA revision register 0x8BC2. Expect 0x0200 (rev 2.00).",
    })

    # Verify BITE register (self-test pass)
    sn += 1
    steps.append({
        "step_number": sn,
        "name": "FPGA Self-Test BITE",
        "step_type": "bus_read", "instrument": "common_bus",
        "bus_address": "0x8BC3", "bus_data": "0x0000", "bus_rw": "R",
        "limit_type": "exact",
        "unit": "hex",
        "instructions": "Read FPGA BITE register 0x8BC3. Expect 0x0000 (no faults).",
    })

    return steps


def _ifrcv_nagc_steps() -> list[dict]:
    """IFRCV-NAGC: NAGC Level Test (section 3.3.4).

    NAGC (Noise Automatic Gain Control) attenuation levels at multiple settings.
    """
    steps = []
    sn = 0

    # NAGC attenuation settings and expected output levels (dBSat)
    nagc_settings = [
        ("0x0000", 0,  -4.0,  3.0, "No attenuation"),
        ("0x0001", 1,  -7.0,  3.0, "1 dB atten"),
        ("0x0002", 2,  -10.0, 3.0, "2 dB atten"),
        ("0x0004", 4,  -16.0, 3.0, "4 dB atten"),
        ("0x0008", 8,  -20.0, 3.0, "8 dB atten"),
        ("0x000F", 15, -31.0, 3.0, "15 dB atten"),
    ]

    for channel in ["A", "B"]:
        for bus_data, atten_db, expected, tol, label in nagc_settings:
            # Write NAGC register
            sn += 1
            steps.append({
                "step_number": sn,
                "name": f"Set NAGC Ch{channel} {label}",
                "step_type": "bus_write", "instrument": "common_bus",
                "bus_address": "0x8C10" if channel == "A" else "0x8C11",
                "bus_data": bus_data, "bus_rw": "W",
                "limit_type": "passfail",
                "unit": "hex",
                "instructions": f"Set NAGC Channel {channel} to {atten_db} dB attenuation.",
            })

            # Measure FFT peak level
            sn += 1
            steps.append({
                "step_number": sn,
                "name": f"NAGC Ch{channel} Level at {atten_db} dB",
                "step_type": "fft_peak", "instrument": "fft_display",
                "limit_type": "nominal", "limit_nominal": expected, "limit_tolerance": tol,
                "unit": "dBSat",
                "instructions": (
                    f"Measure FFT peak level for Channel {channel} at {atten_db} dB "
                    f"NAGC attenuation. Expected {expected} ±{tol} dBSat."
                ),
            })

    return steps


def _ifrcv_dyn_steps() -> list[dict]:
    """IFRCV-DYN: Dynamic Range (section 3.3.5).

    Dynamic range verification across input levels.
    """
    steps = []
    sn = 0

    # Input levels and expected FFT peak outputs
    input_levels = [
        (-10.0, -4.0,  3.0, "Full scale"),
        (-20.0, -14.0, 3.0, "-10 dB"),
        (-30.0, -24.0, 3.0, "-20 dB"),
        (-40.0, -34.0, 3.0, "-30 dB"),
        (-50.0, -44.0, 3.0, "-40 dB"),
        (-60.0, -54.0, 4.0, "-50 dB"),
    ]

    for channel in ["A", "B"]:
        for input_dbm, expected_dbsat, tol, label in input_levels:
            sn += 1
            steps.append({
                "step_number": sn,
                "name": f"Dynamic Range Ch{channel} {label}",
                "step_type": "fft_peak", "instrument": "fft_display",
                "input_power_dbm": input_dbm,
                "limit_type": "nominal",
                "limit_nominal": expected_dbsat, "limit_tolerance": tol,
                "unit": "dBSat",
                "instructions": (
                    f"Set input to {input_dbm} dBm. Measure FFT peak for Channel {channel}. "
                    f"Expected {expected_dbsat} ±{tol} dBSat."
                ),
            })

        # Noise floor check at minimum input
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Noise Floor Ch{channel}",
            "step_type": "fft_noise", "instrument": "fft_display",
            "limit_type": "max", "limit_max": -60.0,
            "unit": "dBSat",
            "instructions": (
                f"With no input signal, measure noise floor for Channel {channel}. "
                "Must be below -60.0 dBSat."
            ),
        })

        # SFDR at full scale
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"SFDR Ch{channel}",
            "step_type": "fft_sfdr", "instrument": "fft_display",
            "input_power_dbm": -10.0,
            "limit_type": "min", "limit_min": 60.0,
            "unit": "dBc",
            "instructions": (
                f"Measure SFDR for Channel {channel} at full-scale input. "
                "Must be >= 60.0 dBc."
            ),
        })

    return steps


def _ifrcv_stc_steps() -> list[dict]:
    """IFRCV-STC: STC Level Test (section 3.3.6).

    Sensitivity Time Control (STC) attenuation verification at multiple profiles.
    """
    steps = []
    sn = 0

    # STC profile register addresses and expected attenuation values
    stc_profiles = [
        ("0x880B", "0x00B0", 0,   "Range bin 0 (no atten)"),
        ("0x880C", "0x00A0", 3,   "Range bin 1 (3 dB)"),
        ("0x880D", "0x0090", 6,   "Range bin 2 (6 dB)"),
        ("0x8810", "0x0060", 12,  "Range bin 5 (12 dB)"),
        ("0x8818", "0x0020", 24,  "Range bin 13 (24 dB)"),
        ("0x8822", "0x0220", 31,  "Range bin 23 (31 dB max)"),
    ]

    for addr, data, atten_db, label in stc_profiles:
        # Write STC profile value
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Write STC {label}",
            "step_type": "bus_write", "instrument": "common_bus",
            "bus_address": addr, "bus_data": data, "bus_rw": "W",
            "limit_type": "passfail",
            "unit": "hex",
            "instructions": f"Write STC profile: {label} to register {addr}.",
        })

        # Verify readback
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"Verify STC {label}",
            "step_type": "bus_read", "instrument": "common_bus",
            "bus_address": addr, "bus_data": data, "bus_rw": "R",
            "limit_type": "exact",
            "unit": "hex",
            "instructions": f"Read back STC register {addr}. Expect {data}.",
        })

    # Verify STC attenuation with FFT at two levels
    for channel in ["A", "B"]:
        # No STC (full output)
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"STC Off Peak Ch{channel}",
            "step_type": "fft_peak", "instrument": "fft_display",
            "limit_type": "nominal", "limit_nominal": -4.0, "limit_tolerance": 3.0,
            "unit": "dBSat",
            "instructions": f"With STC disabled, measure FFT peak for Channel {channel}.",
        })

        # Max STC (31 dB attenuation)
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"STC Max Atten Peak Ch{channel}",
            "step_type": "fft_peak", "instrument": "fft_display",
            "limit_type": "nominal", "limit_nominal": -35.0, "limit_tolerance": 5.0,
            "unit": "dBSat",
            "instructions": (
                f"With STC at max attenuation (31 dB), measure FFT peak for Channel {channel}. "
                "Expected -35.0 ±5.0 dBSat."
            ),
        })

    return steps


def _ifrcv_bw_steps() -> list[dict]:
    """IFRCV-BW: Bandwidth Test (section 3.3.7).

    3 dB bandwidth measurement at 25-35 MHz IF band.
    """
    steps = []
    sn = 0

    # IF frequency sweep points for bandwidth characterization
    if_freqs = [25.0, 27.0, 28.0, 29.0, 30.0, 31.0, 32.0, 33.0, 35.0]

    for channel in ["A", "B"]:
        # FFT peak at each IF frequency
        for if_freq in if_freqs:
            sn += 1
            steps.append({
                "step_number": sn,
                "name": f"BW Ch{channel} at {if_freq} MHz IF",
                "step_type": "fft_peak", "instrument": "fft_display",
                "frequency_mhz": if_freq, "input_power_dbm": -10.0,
                "limit_type": "max", "limit_max": 0.0,
                "unit": "dBSat",
                "instructions": (
                    f"Measure FFT peak for Channel {channel} at {if_freq} MHz IF input. "
                    "Record level for bandwidth calculation."
                ),
                "is_record_only": 1,
            })

        # 3 dB bandwidth check (center to edge)
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"3 dB Bandwidth Ch{channel}",
            "step_type": "fft_peak", "instrument": "fft_display",
            "frequency_mhz": 30.0, "input_power_dbm": -10.0,
            "limit_type": "range", "limit_min": 25.0, "limit_max": 35.0,
            "unit": "MHz",
            "instructions": (
                f"Verify 3 dB bandwidth for Channel {channel}. "
                "The -3 dB points must be within 25-35 MHz IF band (10 MHz minimum BW)."
            ),
        })

        # Noise floor within band
        sn += 1
        steps.append({
            "step_number": sn,
            "name": f"In-Band Noise Floor Ch{channel}",
            "step_type": "fft_noise", "instrument": "fft_display",
            "frequency_mhz": 30.0,
            "limit_type": "max", "limit_max": -60.0,
            "unit": "dBSat",
            "instructions": (
                f"Measure in-band noise floor for Channel {channel} at 30 MHz center. "
                "Must be below -60.0 dBSat."
            ),
        })

    return steps


# Map procedure codes to their step generators
STEP_GENERATORS: dict[str, callable] = {
    "K245-FINAL": _k245_final_steps,
    "K245-DCAL": _k245_dcal_steps,
    "K245-PRECHECK": _k245_precheck_steps,
    "K245-Q1TUNE": _k245_q1tune_steps,
    "K245-Q1DRV": _k245_q1drv_steps,
    "K245-Q23TUNE": _k245_q23tune_steps,
    "K244-PRECHECK": _k244_precheck_steps,
    "K244-SETUP": _k244_setup_steps,
    "K244-DCYLIM": _k244_dcylim_steps,
    "K244-DRVVOLT": _k244_drvvolt_steps,
    "K244-DRVTUNE": _k244_drvtune_steps,
    "K244-FINAL": _k244_final_steps,
    "K243-FINAL": _k243_final_steps,
    "K243-DCAL": _k243_dcal_steps,
    "K243-PRECHECK": _k243_precheck_steps,
    "IFRCV-FPGA": _ifrcv_fpga_steps,
    "IFRCV-COMM": _ifrcv_comm_steps,
    "IFRCV-GAIN": _ifrcv_gain_steps,
    "IFRCV-CURR": _ifrcv_curr_steps,
    "IFRCV-NAGC": _ifrcv_nagc_steps,
    "IFRCV-DYN": _ifrcv_dyn_steps,
    "IFRCV-STC": _ifrcv_stc_steps,
    "IFRCV-BW": _ifrcv_bw_steps,
}



# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

# Columns in test_steps that we insert (excluding id which is auto-incremented)
_STEP_COLUMNS = [
    "procedure_id", "step_number", "name", "step_type", "instrument",
    "frequency_mhz", "input_power_dbm", "pulse_width_us",
    "mux_address", "mux_sample_time_us",
    "bus_address", "bus_data", "bus_rw",
    "limit_type", "limit_min", "limit_max", "limit_nominal", "limit_tolerance",
    "unit", "instructions", "safety_warning",
    "is_optional", "is_record_only",
]


async def _seed_subsystems(db: aiosqlite.Connection) -> dict[str, int]:
    """Insert subsystem rows and return {drawing_no: id} mapping."""
    mapping: dict[str, int] = {}

    for sub in SUBSYSTEMS:
        await db.execute(
            """INSERT OR IGNORE INTO subsystems
               (drawing_no, name, assembly_no, revision, description,
                rf_band_start_mhz, rf_band_stop_mhz,
                nominal_output_dbm, nominal_output_watts)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                sub["drawing_no"], sub["name"], sub["assembly_no"],
                sub["revision"], sub["description"],
                sub["rf_band_start_mhz"], sub["rf_band_stop_mhz"],
                sub["nominal_output_dbm"], sub["nominal_output_watts"],
            ),
        )

    # Fetch ids (may already exist from a previous run)
    async with db.execute("SELECT id, drawing_no FROM subsystems") as cursor:
        async for row in cursor:
            mapping[row[1]] = row[0]

    return mapping


async def _seed_procedures(
    db: aiosqlite.Connection, subsystem_map: dict[str, int]
) -> dict[str, int]:
    """Insert procedure rows and return {code: id} mapping."""
    mapping: dict[str, int] = {}

    for drawing_no, procs in PROCEDURES.items():
        subsystem_id = subsystem_map[drawing_no]
        for proc in procs:
            await db.execute(
                """INSERT OR IGNORE INTO test_procedures
                   (subsystem_id, code, name, section_ref, sequence_order,
                    warmup_minutes, default_pulse_width_us, requires_calibration)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    subsystem_id, proc["code"], proc["name"],
                    proc["section_ref"], proc["sequence_order"],
                    proc["warmup_minutes"], proc["default_pulse_width_us"],
                    proc.get("requires_calibration", 0),
                ),
            )

    # Update requires_calibration for any procedures that already existed
    for _drawing_no, procs in PROCEDURES.items():
        for proc in procs:
            await db.execute(
                "UPDATE test_procedures SET requires_calibration = ? WHERE code = ?",
                (proc.get("requires_calibration", 0), proc["code"]),
            )

    # Fetch ids
    async with db.execute("SELECT id, code FROM test_procedures") as cursor:
        async for row in cursor:
            mapping[row[1]] = row[0]

    return mapping


async def _seed_steps(
    db: aiosqlite.Connection, procedure_map: dict[str, int]
) -> int:
    """Insert test steps for procedures that have step generators.

    Returns the total number of steps inserted.
    """
    total = 0
    placeholders = ", ".join(["?"] * len(_STEP_COLUMNS))
    col_names = ", ".join(_STEP_COLUMNS)

    for proc_code, generator in STEP_GENERATORS.items():
        proc_id = procedure_map.get(proc_code)
        if proc_id is None:
            print(f"  WARNING: procedure {proc_code} not found — skipping steps")
            continue

        # Check if steps already exist for this procedure
        async with db.execute(
            "SELECT COUNT(*) FROM test_steps WHERE procedure_id = ?", (proc_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row[0] > 0:
                print(f"  Steps for {proc_code} already exist ({row[0]} steps) — skipping")
                continue

        step_defs = generator()
        for step in step_defs:
            values = [proc_id]  # procedure_id first
            for col in _STEP_COLUMNS[1:]:  # skip procedure_id (already added)
                values.append(step.get(col))

            await db.execute(
                f"INSERT OR IGNORE INTO test_steps ({col_names}) VALUES ({placeholders})",
                values,
            )
            total += 1

        print(f"  Seeded {len(step_defs)} steps for {proc_code}")

    return total


# ---------------------------------------------------------------------------
# Signal-generator stimulus binding
# ---------------------------------------------------------------------------
# Every procedure that drives an RF UUT needs the signal generator programmed
# before the first measurement step. _SG_SETUP_PROCEDURES enumerates which
# procedures need a stimulus step and what to set the SG to. _seed_sg_setup
# below runs after _seed_steps and idempotently prepends a single
# ``sg_setup`` step (instrument='signal_generator') so the signal generator
# auto-binds via equipment.instrument_role just like the multimeter and power
# meter do.

_SG_SETUP_PROCEDURES: dict[str, dict] = {
    # Power Module Assembly (110K245, 2.8-3.1 GHz, pulsed)
    "K245-DCAL":    {"frequency_mhz": 2800.0, "input_power_dbm": 0.0, "pulsed": True,  "comment": "Daily cal sweep"},
    "K245-Q1TUNE":  {"frequency_mhz": 2800.0, "input_power_dbm": 0.0, "pulsed": True,  "comment": "Q1 tuning input"},
    "K245-Q1DRV":   {"frequency_mhz": 2800.0, "input_power_dbm": 0.0, "pulsed": True,  "comment": "Q1 driver test"},
    "K245-Q23TUNE": {"frequency_mhz": 2800.0, "input_power_dbm": 0.0, "pulsed": True,  "comment": "Q2/Q3 tuning input"},
    "K245-FINAL":   {"frequency_mhz": 2800.0, "input_power_dbm": 0.0, "pulsed": True,  "comment": "Final ATP"},
    # Preamplifier Panel (110K244, 2.8-3.1 GHz, pulsed)
    "K244-DCYLIM":  {"frequency_mhz": 2800.0, "input_power_dbm": 0.0, "pulsed": True,  "comment": "Duty-cycle limit test"},
    "K244-DRVTUNE": {"frequency_mhz": 2800.0, "input_power_dbm": 0.0, "pulsed": True,  "comment": "Driver tuning"},
    "K244-FINAL":   {"frequency_mhz": 2800.0, "input_power_dbm": 0.0, "pulsed": True,  "comment": "Final preamp data"},
    # RF Output Panel (110K243, 2.8-3.1 GHz, pulsed)
    "K243-DCAL":    {"frequency_mhz": 2800.0, "input_power_dbm": 0.0, "pulsed": True,  "comment": "Daily cal sweep"},
    "K243-FINAL":   {"frequency_mhz": 2800.0, "input_power_dbm": 0.0, "pulsed": True,  "comment": "Final test"},
    # Digital IF Receiver (25-35 MHz IF, CW)
    "IFRCV-GAIN":   {"frequency_mhz": 30.0, "input_power_dbm": -10.0, "pulsed": False, "comment": "Gain test"},
    "IFRCV-NAGC":   {"frequency_mhz": 30.0, "input_power_dbm": -10.0, "pulsed": False, "comment": "NAGC level"},
    "IFRCV-DYN":    {"frequency_mhz": 30.0, "input_power_dbm": -10.0, "pulsed": False, "comment": "Dynamic range"},
    "IFRCV-STC":    {"frequency_mhz": 30.0, "input_power_dbm": -10.0, "pulsed": False, "comment": "STC level"},
    "IFRCV-BW":     {"frequency_mhz": 30.0, "input_power_dbm": -10.0, "pulsed": False, "comment": "Bandwidth sweep"},
}


def _build_sg_setup_step(
    step_number: int,
    freq_mhz: float,
    power_dbm: float,
    pulsed: bool,
    comment: str,
) -> dict:
    """Build a single ``sg_setup`` step that programs the signal generator."""
    pulse_note = " Enable internal pulse modulation." if pulsed else ""
    return {
        "step_number": step_number,
        "name": f"SG Setup ({comment})",
        "step_type": "sg_setup",
        "instrument": "signal_generator",
        "frequency_mhz": freq_mhz,
        "input_power_dbm": power_dbm,
        # pulse_width_us non-None signals the driver to enable PULM
        "pulse_width_us": 1.0 if pulsed else None,
        "limit_type": "passfail",
        "unit": "Hz",
        "instructions": (
            f"Program the signal generator to {freq_mhz:.1f} MHz CW at "
            f"{power_dbm:+.1f} dBm and enable RF output."
            + pulse_note
        ),
        "is_record_only": 1,
    }


async def _seed_sg_setup(
    db: aiosqlite.Connection, procedure_map: dict[str, int],
) -> int:
    """Idempotently prepend an ``sg_setup`` step to every RF-driving procedure.

    For each procedure listed in :data:`_SG_SETUP_PROCEDURES`:

    * Skip if it already has an ``sg_setup`` step (either freshly seeded or
      previously migrated).
    * Otherwise, shift every existing step's ``step_number`` up by 1 to make
      room at position 1, then INSERT the SG setup step at ``step_number=1``.

    Step IDs are preserved (only ``step_number`` is updated), so historical
    ``test_results`` rows keep referencing the same steps.
    """
    placeholders = ", ".join(["?"] * len(_STEP_COLUMNS))
    col_names = ", ".join(_STEP_COLUMNS)
    inserted = 0

    for proc_code, sg_params in _SG_SETUP_PROCEDURES.items():
        proc_id = procedure_map.get(proc_code)
        if proc_id is None:
            continue

        async with db.execute(
            "SELECT COUNT(*) FROM test_steps WHERE procedure_id = ? AND step_type = 'sg_setup'",
            (proc_id,),
        ) as cursor:
            row = await cursor.fetchone()
            if row[0] > 0:
                continue

        await db.execute(
            "UPDATE test_steps SET step_number = step_number + 1 WHERE procedure_id = ?",
            (proc_id,),
        )

        sg_step = _build_sg_setup_step(
            step_number=1,
            freq_mhz=sg_params["frequency_mhz"],
            power_dbm=sg_params["input_power_dbm"],
            pulsed=sg_params["pulsed"],
            comment=sg_params["comment"],
        )
        values = [proc_id]
        for col in _STEP_COLUMNS[1:]:
            values.append(sg_step.get(col))
        await db.execute(
            f"INSERT INTO test_steps ({col_names}) VALUES ({placeholders})",
            values,
        )
        inserted += 1
        print(f"  + SG setup prepended to {proc_code}")

    return inserted


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def seed_all(db: aiosqlite.Connection) -> None:
    """Seed all subsystem definitions, procedures, test steps, and equipment.

    Safe to call on every startup — uses INSERT OR IGNORE to avoid duplicates.
    """
    print("Seeding database...")

    subsystem_map = await _seed_subsystems(db)
    print(f"  Subsystems: {len(subsystem_map)} ({', '.join(subsystem_map.keys())})")

    procedure_map = await _seed_procedures(db, subsystem_map)
    print(f"  Procedures: {len(procedure_map)}")

    step_count = await _seed_steps(db, procedure_map)
    print(f"  Test steps inserted: {step_count}")

    sg_count = await _seed_sg_setup(db, procedure_map)
    print(f"  SG setup steps prepended: {sg_count}")

    await db.commit()
    print("Seed complete.")

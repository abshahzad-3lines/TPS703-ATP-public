import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionPoint {
  id: string
  equipment: string
  model: string
  port: string
  uutPoint: string
  cable: string
  signal: 'rf' | 'dc' | 'digital' | 'measurement' | 'control'
  direction: 'to-uut' | 'from-uut' | 'bidirectional'
  notes?: string
  critical?: boolean
}

interface SafetyWarning {
  text: string
  severity: 'danger' | 'caution' | 'info'
}

interface SubsystemSetup {
  drawingNo: string
  name: string
  connections: ConnectionPoint[]
  safetyWarnings: SafetyWarning[]
  setupNotes: string[]
  powerSequence: string[]
}

interface ConnectionSetupProps {
  subsystemDrawingNo: string
  subsystemName: string
  procedureCode: string
}

// ---------------------------------------------------------------------------
// Signal type styling
// ---------------------------------------------------------------------------

const signalColors: Record<string, { bg: string; stroke: string; label: string }> = {
  rf:          { bg: '#dbeafe', stroke: '#3b82f6', label: 'RF Signal' },
  dc:          { bg: '#fee2e2', stroke: '#ef4444', label: 'DC Power' },
  digital:     { bg: '#d1fae5', stroke: '#10b981', label: 'Digital/Bus' },
  measurement: { bg: '#fef3c7', stroke: '#f59e0b', label: 'Measurement' },
  control:     { bg: '#e0e7ff', stroke: '#6366f1', label: 'Control' },
}

const directionLabel: Record<string, string> = {
  'to-uut': '\u2192 To UUT',
  'from-uut': '\u2190 From UUT',
  'bidirectional': '\u2194 Bidirectional',
}

// ---------------------------------------------------------------------------
// Connection data per subsystem
// ---------------------------------------------------------------------------

const SETUPS: Record<string, SubsystemSetup> = {
  '110K245': {
    drawingNo: '110K245',
    name: 'Power Module Assembly',
    connections: [
      { id: 'sig-gen', equipment: 'Signal Generator', model: 'N5182B MXG', port: 'RF OUT (50\u03A9)', uutPoint: 'J1 RF INPUT', cable: 'N-Type to N-Type, 2ft', signal: 'rf', direction: 'to-uut', notes: 'Set output to 42.50 dBm pulsed. Verify cable loss is calibrated.', critical: true },
      { id: 'pwr-meter', equipment: 'Power Meter + Sensor', model: 'N1914A + N8487A', port: 'SENSOR INPUT', uutPoint: 'J2 RF OUTPUT (via 30 dB attenuator)', cable: 'N-Type to N-Type, thru 30 dB fixed attenuator (50W)', signal: 'measurement', direction: 'from-uut', notes: 'Attenuator MUST be rated for 1kW peak pulse power. Verify attenuator cal factor.', critical: true },
      { id: 'net-anlz', equipment: 'Network Analyzer', model: 'E5071C', port: 'PORT 1', uutPoint: 'J1 RF INPUT (via directional coupler, -20 dB)', cable: 'N-Type to SMA adapter + SMA cable', signal: 'rf', direction: 'bidirectional', notes: 'Coupler coupled port to E5071C Port 1. Thru port remains in signal path.' },
      { id: 'spec-anlz', equipment: 'Signal Analyzer', model: 'N9020B MXA', port: 'RF INPUT (50\u03A9)', uutPoint: 'J2 RF OUTPUT (via coupler, -40 dB tap)', cable: 'N-Type to N-Type, 3ft', signal: 'measurement', direction: 'from-uut', notes: 'Coupled port of output directional coupler. -40 dB coupling + 30 dB attenuator = safe input level.' },
      { id: 'scope', equipment: 'Oscilloscope', model: 'DSOX3054T', port: 'CH1 + CH2 (1M\u03A9)', uutPoint: 'TP1 (BITE P1) + TP2 (BITE P2)', cable: '10x passive probes (2)', signal: 'measurement', direction: 'from-uut', notes: 'CH1 = BITE P1, CH2 = BITE P2. Set coupling to DC, 2V/div.' },
      { id: 'dmm', equipment: 'Digital Multimeter', model: '34461A', port: 'INPUT HI / LO', uutPoint: 'Current shunt / Spring finger contacts', cable: 'Banana to clip leads', signal: 'measurement', direction: 'from-uut', notes: 'For current: measure across calibrated shunt resistor. For resistance: connect directly to spring finger contacts.' },
      { id: 'phase', equipment: 'Phase Noise Analyzer', model: 'E5052B', port: 'RF INPUT A + REF IN', uutPoint: 'J1 coupler sample (REF) + J2 coupler sample (MEAS)', cable: 'SMA to SMA, phase-matched pair', signal: 'measurement', direction: 'from-uut', notes: 'Use phase-matched cable pair for accurate phase measurement. REF from input coupler, MEAS from output coupler.' },
      { id: 'dc-psu', equipment: 'DC Power Supply', model: 'E36234A', port: 'OUTPUT+ / OUTPUT\u2212', uutPoint: 'J3 DC POWER (+28V)', cable: '12 AWG power leads with Anderson connectors', signal: 'dc', direction: 'to-uut', notes: 'Set to +28.0V, current limit 12A. Do NOT exceed 32V.', critical: true },
    ],
    safetyWarnings: [
      { text: 'HIGH VOLTAGE: The UUT output can produce 724W peak pulse power (58.6 dBm). Never disconnect RF cables while transmitting.', severity: 'danger' },
      { text: 'RF EXPOSURE: Maintain 30 dB minimum attenuation on the output path at all times. Unterminated output connectors radiate hazardous RF levels.', severity: 'danger' },
      { text: 'Ensure the 30 dB output attenuator is properly rated for 1 kW peak power before applying DC power.', severity: 'caution' },
      { text: 'Allow 5 minutes warmup after applying DC power before starting measurements per ATP Section 4.6.', severity: 'info' },
    ],
    setupNotes: [
      'Verify all N-Type connectors are torqued to 12 in-lbs using a calibrated torque wrench.',
      'Ensure all attenuators and couplers are properly terminated on unused ports with 50\u03A9 loads.',
      'Confirm the daily calibration is valid before proceeding (calibration data is referenced to these cable/attenuator paths).',
      'Route the BITE probe cables away from RF cables to avoid coupling.',
    ],
    powerSequence: [
      '1. Verify all RF connections are secure and attenuators are in place.',
      '2. Set signal generator output to OFF (RF disabled).',
      '3. Apply DC power (+28V) from E36234A. Verify current draw is < 0.5A (quiescent).',
      '4. Wait 5 minutes for thermal stabilization.',
      '5. Enable signal generator RF output at 42.50 dBm.',
      '6. Verify power meter reads expected output level before proceeding with test steps.',
    ],
  },

  '110K244': {
    drawingNo: '110K244',
    name: 'Preamplifier Panel Assembly',
    connections: [
      { id: 'sig-gen', equipment: 'Signal Generator', model: 'N5182B MXG', port: 'RF OUT (50\u03A9)', uutPoint: 'J1 RF INPUT', cable: 'N-Type to N-Type, 2ft', signal: 'rf', direction: 'to-uut', notes: 'Set output to 16.0 dBm pulsed (259 \u00B5s pulse width). This is the nominal drive level.', critical: true },
      { id: 'pwr-meter', equipment: 'Power Meter + Sensor', model: 'N1914A + U2049XA', port: 'SENSOR INPUT', uutPoint: 'J2 RF OUTPUT (via 40 dB attenuator)', cable: 'N-Type to N-Type, thru 40 dB high-power attenuator', signal: 'measurement', direction: 'from-uut', notes: 'Output reaches 1531W (61.85 dBm). Attenuator MUST be rated for 2kW peak. Use wideband sensor U2049XA.', critical: true },
      { id: 'net-anlz', equipment: 'Network Analyzer', model: 'E5071C', port: 'PORT 1 + PORT 2', uutPoint: 'J1 RF INPUT coupler + J2 RF OUTPUT coupler', cable: 'N-Type to SMA, phase-stable pair', signal: 'rf', direction: 'bidirectional', notes: 'S11 measurement via input coupler port. S21 for gain measurement. Keep coupler thru-ports in signal path.' },
      { id: 'spec-anlz', equipment: 'Signal Analyzer', model: 'N9020B MXA', port: 'RF INPUT (50\u03A9)', uutPoint: 'J2 RF OUTPUT (via \u221260 dB coupler chain)', cable: 'N-Type to N-Type, 3ft', signal: 'measurement', direction: 'from-uut', notes: 'Total coupling must reduce output to < +10 dBm at analyzer input. Verify with power meter first.' },
      { id: 'scope', equipment: 'Oscilloscope', model: 'DSOX3054T', port: 'CH1 (1M\u03A9)', uutPoint: 'TP1 Duty Cycle Monitor', cable: '10x passive probe', signal: 'measurement', direction: 'from-uut', notes: 'Monitor duty cycle limit circuit output. Set trigger to rising edge.' },
      { id: 'dmm', equipment: 'Digital Multimeter', model: '34461A', port: 'INPUT HI / LO', uutPoint: 'Driver regulator voltage test points', cable: 'Banana to clip leads', signal: 'measurement', direction: 'from-uut', notes: 'For voltage: measure driver regulator setpoints. For current: use calibrated shunt.' },
      { id: 'dc-psu', equipment: 'DC Power Supply', model: 'E36234A', port: 'OUTPUT+ / OUTPUT\u2212', uutPoint: 'J3 DC POWER (+28V)', cable: '10 AWG power leads with Anderson connectors', signal: 'dc', direction: 'to-uut', notes: 'Set to +28.0V, current limit 20A. This assembly draws up to 15A under full drive.', critical: true },
      { id: 'load', equipment: 'Electronic Load', model: 'N3300A', port: 'INPUT TERMINALS', uutPoint: 'J4 BIAS OUTPUT (if applicable)', cable: '12 AWG power leads', signal: 'dc', direction: 'from-uut', notes: 'Used during driver regulator voltage setup to simulate load conditions.' },
    ],
    safetyWarnings: [
      { text: 'EXTREME RF POWER: Output exceeds 1500W peak pulse power. 40 dB high-power attenuator is MANDATORY on the output path.', severity: 'danger' },
      { text: 'HIGH CURRENT: Assembly draws up to 15A DC. Verify all power cable connections are secure and properly rated.', severity: 'danger' },
      { text: 'Do not remove or reconnect any RF cables while the signal generator is enabled. Disable RF output first.', severity: 'caution' },
      { text: 'The duty cycle limit circuit must be verified functional before applying full drive power.', severity: 'caution' },
    ],
    setupNotes: [
      'Use the wideband power sensor (U2049XA) rated to 18 GHz for this assembly due to harmonic content.',
      'Verify all high-power attenuators are rated for the expected peak power before connecting.',
      'Double-check the coupler coupling factors and compensate in measurements.',
      'The N3300A electronic load is only needed for the K244-DRVVOLT procedure.',
    ],
    powerSequence: [
      '1. Verify all RF connections and attenuators are in place.',
      '2. Set signal generator to 16.0 dBm, RF output OFF.',
      '3. Apply +28V DC. Verify quiescent current < 1.0A.',
      '4. Enable signal generator at low power (\u221210 dBm) first. Verify output path is intact.',
      '5. Increase signal generator to 16.0 dBm nominal drive.',
      '6. Verify power meter reads expected output (61.85 dBm \u00B1 1 dB) before proceeding.',
    ],
  },

  '110K243': {
    drawingNo: '110K243',
    name: 'RF Output Panel Assembly',
    connections: [
      { id: 'sig-gen', equipment: 'Signal Generator', model: 'N5182B MXG', port: 'RF OUT (50\u03A9)', uutPoint: 'J1 RF INPUT', cable: 'N-Type to N-Type, 2ft (phase-calibrated)', signal: 'rf', direction: 'to-uut', notes: 'Set output to 49.50 dBm pulsed (253 \u00B5s). Input requires a preceding driver amplifier or external high-power source.', critical: true },
      { id: 'pwr-meter', equipment: 'Power Meter + Sensor', model: 'N1914A + U2049XA', port: 'SENSOR INPUT', uutPoint: 'J2 RF OUTPUT (via 40 dB atten + 10 dB coupler)', cable: 'N-Type to N-Type, thru high-power attenuator chain', signal: 'measurement', direction: 'from-uut', notes: 'Output reaches 2512W (64.0 dBm). Total attenuation must be \u2265 50 dB. All components rated for 3 kW peak.', critical: true },
      { id: 'net-anlz', equipment: 'Network Analyzer', model: 'E5071C', port: 'PORT 1', uutPoint: 'J1 RF INPUT coupler (\u221220 dB port)', cable: 'N-Type to SMA adapter', signal: 'rf', direction: 'bidirectional', notes: 'Return loss spec is \u2264 \u221210.0 dB for this assembly (different from K245).' },
      { id: 'spec-anlz', equipment: 'Signal Analyzer', model: 'N9020B MXA', port: 'RF INPUT (50\u03A9)', uutPoint: 'J2 RF OUTPUT (via coupler chain, \u221260 dB total)', cable: 'N-Type to N-Type, 3ft', signal: 'measurement', direction: 'from-uut', notes: 'Verify total attenuation provides < +5 dBm at analyzer input.' },
      { id: 'scope', equipment: 'Oscilloscope', model: 'DSOX3054T', port: 'CH1 + CH2 + CH3', uutPoint: 'TP1 (Pulse Shaping) + TP2 (PSS Pulse) + TP3 (BITE)', cable: '10x passive probes (3)', signal: 'measurement', direction: 'from-uut', notes: 'CH1 = Shaped pulse width measurement. CH2 = PSS pulse. CH3 = BITE during short pulse stress.' },
      { id: 'dmm', equipment: 'Digital Multimeter', model: '34461A', port: 'INPUT HI / LO', uutPoint: 'MUX addresses 1\u20138 + P2 resistance + Plunger switch', cable: 'Banana to clip leads', signal: 'measurement', direction: 'from-uut', notes: 'MUX testing requires addressing via control bus. P2 resistance nominal 3.15\u03A9. Plunger switch nominal 10\u03A9.' },
      { id: 'phase', equipment: 'Phase Noise Analyzer', model: 'E5052B', port: 'RF INPUT A + REF IN', uutPoint: 'J1 coupler sample + J2 coupler sample', cable: 'SMA cable, phase-calibrated pair (select G01\u2013G11)', signal: 'measurement', direction: 'from-uut', notes: 'Cable selection (G01\u2013G11) affects phase offset. Use the cable specified in the ATP data sheet. Phase spec is \u221212\u00B0 \u00B1 10\u00B0 at 3100 MHz.', critical: true },
      { id: 'dc-psu', equipment: 'DC Power Supply', model: 'E36234A', port: 'OUTPUT+ / OUTPUT\u2212', uutPoint: 'J3 DC POWER (+28V)', cable: '8 AWG power leads, Anderson PP45', signal: 'dc', direction: 'to-uut', notes: 'Set to +28.0V, current limit 30A. This is the highest-power assembly. Use heavy-gauge cabling.', critical: true },
      { id: 'freq-ctr', equipment: 'Frequency Counter', model: '53230A', port: 'CH1 INPUT (50\u03A9)', uutPoint: 'J2 RF OUTPUT coupler (\u221240 dB tap)', cable: 'SMA to BNC adapter + BNC cable', signal: 'measurement', direction: 'from-uut', notes: 'Verify operating frequency is within 2800\u20133100 MHz band. Gate time 100 ms.' },
    ],
    safetyWarnings: [
      { text: 'MAXIMUM RF HAZARD: Output exceeds 2500W (64 dBm) peak pulse power. This is a Class IV RF hazard. All personnel must be cleared from the RF enclosure.', severity: 'danger' },
      { text: 'HIGH CURRENT: Assembly draws up to 25A DC at full power. Use 8 AWG minimum cabling. Verify all Anderson connectors are fully seated.', severity: 'danger' },
      { text: 'THERMAL: Allow 10 minutes warmup per ATP Section 4.3. Module surface temperature may exceed 80\u00B0C during test.', severity: 'caution' },
      { text: 'Select the correct phase cable (G01\u2013G11) as specified in the ATP before starting phase measurements.', severity: 'info' },
    ],
    setupNotes: [
      'This assembly requires the highest-power test setup. Verify ALL attenuators are rated for 3 kW peak.',
      'The MUX test (addresses 1\u20138) requires the control bus to be connected for address selection.',
      'For short pulse stress testing, the oscilloscope must capture BITE levels at multiple frequencies.',
      'Phase cable selection (G01\u2013G11) is critical. Incorrect cable selection invalidates phase measurements.',
      'The plunger switch resistance test verifies mechanical interlock engagement.',
    ],
    powerSequence: [
      '1. Verify all RF connections, attenuators rated for 3 kW, and high-power loads are in place.',
      '2. Verify RF enclosure is secured and interlock is engaged (plunger switch).',
      '3. Apply +28V DC. Verify quiescent current < 2.0A.',
      '4. Allow 10 minutes thermal stabilization.',
      '5. Enable RF drive at 49.50 dBm. Monitor BITE levels on oscilloscope.',
      '6. Verify power meter reads \u2265 64.0 dBm before proceeding with ATP steps.',
    ],
  },

  'IF_RECVR': {
    drawingNo: 'IF_RECVR',
    name: 'Digital IF Receiver Assembly',
    connections: [
      { id: 'sig-gen', equipment: 'Signal Generator', model: 'N5182B MXG', port: 'RF OUT (50\u03A9)', uutPoint: 'J1 IF INPUT (25\u201335 MHz)', cable: 'BNC to BNC, 50\u03A9, 3ft', signal: 'rf', direction: 'to-uut', notes: 'Set to IF frequency (30 MHz center). Level: \u221210.0 dBm nominal for gain test. Modulation OFF for CW tests.', critical: true },
      { id: 'dmm', equipment: 'Digital Multimeter', model: '34461A', port: 'INPUT HI / LO (A DC mode)', uutPoint: 'J5 power connector (current measurement points)', cable: 'Banana to clip leads across current shunts', signal: 'measurement', direction: 'from-uut', notes: 'Measure +3.3V, +5V, +9V, +18V, \u22128V supply currents sequentially. Use appropriate shunt for each rail.' },
      { id: 'dc-psu-5', equipment: 'DC Power Supply', model: 'E36234A', port: 'CH1: +5V, CH2: +3.3V', uutPoint: 'J5 Pin 1 (+5V), Pin 3 (+3.3V)', cable: 'Banana to Molex connector harness', signal: 'dc', direction: 'to-uut', notes: 'CH1: +5.0V / 3A limit. CH2: +3.3V / 5A limit. Apply these first.', critical: true },
      { id: 'dc-psu-hv', equipment: 'DC Power Supply #2', model: 'E36234A', port: 'CH1: +9V, CH2: +18V', uutPoint: 'J5 Pin 5 (+9V), Pin 7 (+18V)', cable: 'Banana to Molex connector harness', signal: 'dc', direction: 'to-uut', notes: 'CH1: +9.0V / 2A limit. CH2: +18.0V / 1A limit. Apply after +5V and +3.3V are stable.' },
      { id: 'dc-neg', equipment: 'DC Power Supply #3', model: 'E36234A', port: 'CH1: \u22128V (inverted)', uutPoint: 'J5 Pin 9 (\u22128V)', cable: 'Banana to Molex (observe polarity)', signal: 'dc', direction: 'to-uut', notes: 'Negative supply: \u22128.0V / 0.5A limit. Connect OUTPUT+ to GND and OUTPUT\u2212 to \u22128V pin.' },
      { id: 'bus', equipment: 'Common Bus Interface', model: 'Custom / FPGA Dev Board', port: 'DATA[15:0] + ADDR + R/W + CLK', uutPoint: 'J2 COMMON BUS CONNECTOR (40-pin)', cable: '40-pin ribbon cable with IDC connectors', signal: 'digital', direction: 'bidirectional', notes: 'Directly connects to FPGA common bus. Used for register read/write tests, STC profiles, and NAGC programming.', critical: true },
      { id: 'scope', equipment: 'Oscilloscope', model: 'DSOX3054T', port: 'CH1 + CH2', uutPoint: 'J3 IQ DATA OUTPUT (Channel A + B)', cable: 'SMA to BNC, 50\u03A9 matched pair', signal: 'measurement', direction: 'from-uut', notes: 'CH1 = Channel A (I/Q). CH2 = Channel B (I/Q). Used for FFT analysis, gain verification, and dynamic range testing.' },
      { id: 'freq-ctr', equipment: 'Frequency Counter', model: '53230A', port: 'CH1 INPUT (50\u03A9)', uutPoint: 'J3 IQ CLK OUTPUT', cable: 'SMA to BNC', signal: 'measurement', direction: 'from-uut', notes: 'Verify sampling clock frequency. Expected: 80 MHz \u00B1 100 ppm.' },
    ],
    safetyWarnings: [
      { text: 'ESD SENSITIVE: The IF Receiver contains FPGA and high-speed ADC devices. Use ESD wrist strap and grounded mat at all times.', severity: 'danger' },
      { text: 'POWER SEQUENCING: Apply +5V and +3.3V BEFORE +9V, +18V, and \u22128V. Incorrect sequencing may damage the FPGA.', severity: 'danger' },
      { text: 'Do not exceed \u221210.0 dBm at the IF input. The receiver front-end will saturate and may be damaged above 0 dBm.', severity: 'caution' },
    ],
    setupNotes: [
      'The common bus interface requires a custom adapter or FPGA development board to generate bus transactions.',
      'For FPGA programming (IFRCV-FPGA), the JTAG header J4 must also be connected to the programming tool.',
      'IQ data output is differential LVDS. Use 50\u03A9 SMA cables for proper impedance matching.',
      'The \u22128V supply uses an inverted connection on the E36234A. Double-check polarity before enabling.',
    ],
    powerSequence: [
      '1. Connect all signal and measurement cables first. Leave DC power off.',
      '2. Verify ESD protection is in place (wrist strap, grounded mat).',
      '3. Apply +5.0V and +3.3V supplies. Verify current draw: +5V < 1.35A, +3.3V < 3.0A.',
      '4. Apply +9.0V and +18.0V. Verify: +9V = 0.6\u20131.5A, +18V = 0.3\u20130.7A.',
      '5. Apply \u22128.0V. Verify: \u22128V = 0.05\u20130.4A.',
      '6. Wait 10 seconds for power-on initialization. Verify FPGA DONE LED is illuminated.',
      '7. Apply IF signal at \u221220 dBm. Verify IQ output on oscilloscope before increasing to test level.',
    ],
  },
}

// ---------------------------------------------------------------------------
// SVG Diagram Component
// ---------------------------------------------------------------------------

function ConnectionDiagram({ setup }: { setup: SubsystemSetup }) {
  const conns = setup.connections
  const leftConns = conns.filter(c => c.direction === 'to-uut')
  const rightConns = conns.filter(c => c.direction !== 'to-uut')

  // Build a numbered reference list: P1, P2, ... for all connections in order
  const allOrdered = [...leftConns, ...rightConns]
  const refMap = new Map<string, number>()
  allOrdered.forEach((c, i) => refMap.set(c.id, i + 1))

  // Layout constants
  const W = 960
  const uutX = 360, uutW = 240
  const rowH = 72
  const leftCount = Math.max(leftConns.length, 1)
  const rightCount = Math.max(rightConns.length, 1)
  const maxRows = Math.max(leftCount, rightCount)
  const H = Math.max(maxRows * rowH + 100, 320)
  const uutY = 30, uutH = H - 60

  const eqW = 160, eqH = 50

  function signalStyle(sig: string) {
    return signalColors[sig] || signalColors.rf
  }

  return (
    <div className="space-y-4">
      {/* SVG Diagram */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
      >
        <defs>
          <marker id="arrow-r" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#475569" />
          </marker>
          <marker id="arrow-l" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
            <polygon points="8 0, 0 3, 8 6" fill="#475569" />
          </marker>
        </defs>

        {/* Background */}
        <rect x={0} y={0} width={W} height={H} rx={8} fill="#ffffff" />

        {/* UUT Block */}
        <rect x={uutX} y={uutY} width={uutW} height={uutH} rx={8} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={2} />
        <text x={uutX + uutW / 2} y={uutY + 22} textAnchor="middle" fill="#0f172a" fontSize={13} fontWeight="bold">
          {setup.drawingNo}
        </text>
        <text x={uutX + uutW / 2} y={uutY + 38} textAnchor="middle" fill="#334155" fontSize={10}>
          {setup.name}
        </text>
        <text x={uutX + uutW / 2} y={uutY + 52} textAnchor="middle" fill="#64748b" fontSize={9}>
          UNIT UNDER TEST
        </text>

        {/* Left side: inputs to UUT */}
        {leftConns.map((c, i) => {
          const y = uutY + 70 + i * rowH
          const style = signalStyle(c.signal)
          const eqX = 10
          const eqY = y - eqH / 2
          const refNum = refMap.get(c.id) ?? 0
          const pinW = 28, pinH = 16
          const pinX = uutX + 4
          const pinY = y - pinH / 2

          return (
            <g key={c.id}>
              {/* Equipment block */}
              <rect x={eqX} y={eqY} width={eqW} height={eqH} rx={5} fill={style.bg} stroke={style.stroke} strokeWidth={1.5} />
              <text x={eqX + eqW / 2} y={eqY + 18} textAnchor="middle" fill="#1e293b" fontSize={11} fontWeight="bold">
                {c.equipment}
              </text>
              <text x={eqX + eqW / 2} y={eqY + 32} textAnchor="middle" fill="#475569" fontSize={9}>
                {c.model}
              </text>
              <text x={eqX + eqW / 2} y={eqY + 44} textAnchor="middle" fill="#64748b" fontSize={8}>
                {c.port}
              </text>

              {/* Connection line — ends at pin label edge */}
              <line
                x1={eqX + eqW} y1={y}
                x2={pinX - 2} y2={y}
                stroke={style.stroke} strokeWidth={2} strokeDasharray={c.signal === 'dc' ? '6,3' : undefined}
                markerEnd="url(#arrow-r)"
              />

              {/* Pin label centred on the connection line */}
              <rect x={pinX} y={pinY} width={pinW} height={pinH} rx={3} fill={style.stroke} />
              <text x={pinX + pinW / 2} y={y + 4} textAnchor="middle" fill="#ffffff" fontSize={9} fontWeight="bold">
                P{refNum}
              </text>

              {/* Critical indicator */}
              {c.critical && (
                <circle cx={eqX + eqW + 8} cy={eqY + 4} r={5} fill="#ef4444" />
              )}
            </g>
          )
        })}

        {/* Right side: outputs from UUT */}
        {rightConns.map((c, i) => {
          const y = uutY + 70 + i * rowH
          const style = signalStyle(c.signal)
          const eqX = W - eqW - 10
          const eqY = y - eqH / 2
          const refNum = refMap.get(c.id) ?? 0
          const pinW = 28, pinH = 16
          const pinX = uutX + uutW - pinW - 4
          const pinY = y - pinH / 2

          return (
            <g key={c.id}>
              {/* Equipment block */}
              <rect x={eqX} y={eqY} width={eqW} height={eqH} rx={5} fill={style.bg} stroke={style.stroke} strokeWidth={1.5} />
              <text x={eqX + eqW / 2} y={eqY + 18} textAnchor="middle" fill="#1e293b" fontSize={11} fontWeight="bold">
                {c.equipment}
              </text>
              <text x={eqX + eqW / 2} y={eqY + 32} textAnchor="middle" fill="#475569" fontSize={9}>
                {c.model}
              </text>
              <text x={eqX + eqW / 2} y={eqY + 44} textAnchor="middle" fill="#64748b" fontSize={8}>
                {c.port}
              </text>

              {/* Connection line — starts at pin label edge */}
              <line
                x1={pinX + pinW + 2} y1={y}
                x2={eqX} y2={y}
                stroke={style.stroke} strokeWidth={2} strokeDasharray={c.signal === 'dc' ? '6,3' : undefined}
                markerEnd={c.direction === 'from-uut' ? 'url(#arrow-r)' : undefined}
                markerStart={c.direction === 'bidirectional' ? 'url(#arrow-l)' : undefined}
              />

              {/* Pin label centred on the connection line */}
              <rect x={pinX} y={pinY} width={pinW} height={pinH} rx={3} fill={style.stroke} />
              <text x={pinX + pinW / 2} y={y + 4} textAnchor="middle" fill="#ffffff" fontSize={9} fontWeight="bold">
                P{refNum}
              </text>

              {/* Critical indicator */}
              {c.critical && (
                <circle cx={eqX - 8} cy={eqY + 4} r={5} fill="#ef4444" />
              )}
            </g>
          )
        })}

        {/* Legend */}
        {Object.entries(signalColors).map(([key, val], i) => (
          <g key={key} transform={`translate(${10 + i * 150}, ${H - 18})`}>
            <rect x={0} y={0} width={12} height={12} rx={2} fill={val.bg} stroke={val.stroke} strokeWidth={1} />
            <text x={16} y={10} fill="#64748b" fontSize={9}>{val.label}</text>
          </g>
        ))}
        <g transform={`translate(${10 + 5 * 150}, ${H - 18})`}>
          <circle cx={6} cy={6} r={5} fill="#ef4444" />
          <text x={16} y={10} fill="#64748b" fontSize={9}>Critical</text>
        </g>
      </svg>

      {/* Connection Point Reference Table */}
      <div className="rounded-lg border overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b-2 border-slate-200">
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-slate-500 w-14">Ref</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-slate-500">UUT Connection Point</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-slate-500">Equipment</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-slate-500">Cable / Adapter</th>
              <th className="text-center px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-slate-500 w-24">Direction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {allOrdered.map(c => {
              const refNum = refMap.get(c.id) ?? 0
              const style = signalColors[c.signal]
              return (
                <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-flex items-center justify-center h-6 w-8 rounded-md text-[10px] font-bold text-white shadow-sm"
                      style={{ backgroundColor: style.stroke }}
                    >
                      P{refNum}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">{c.uutPoint}</div>
                    {c.notes && (
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-snug max-w-xs group-hover:text-slate-500 transition-colors">{c.notes}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800">{c.equipment}</div>
                    <div className="text-xs text-muted-foreground font-mono">{c.model}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{c.cable}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full',
                        c.direction === 'to-uut' && 'bg-blue-50 text-blue-700',
                        c.direction === 'from-uut' && 'bg-amber-50 text-amber-700',
                        c.direction === 'bidirectional' && 'bg-purple-50 text-purple-700',
                      )}
                    >
                      {directionLabel[c.direction]}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ConnectionSetup({ subsystemDrawingNo, procedureCode }: ConnectionSetupProps) {
  const setup = SETUPS[subsystemDrawingNo]

  if (!setup) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p>No connection diagram available for {subsystemDrawingNo}.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test Equipment Connection Diagram</CardTitle>
          <CardDescription>
            {setup.drawingNo} — {setup.name} — Procedure {procedureCode}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <ConnectionDiagram setup={setup} />
          </div>
        </CardContent>
      </Card>

      {/* Safety Warnings */}
      {setup.safetyWarnings.length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-red-700">Safety Warnings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {setup.safetyWarnings.map((w, i) => (
              <Alert
                key={i}
                variant={w.severity === 'danger' ? 'destructive' : undefined}
                className={cn(
                  w.severity === 'caution' && 'border-amber-300 bg-amber-50',
                  w.severity === 'info' && 'border-blue-200 bg-blue-50',
                )}
              >
                <AlertDescription className={cn(
                  w.severity === 'danger' && 'text-red-800',
                  w.severity === 'caution' && 'text-amber-800',
                  w.severity === 'info' && 'text-blue-800',
                )}>
                  <span className="font-bold">
                    {w.severity === 'danger' && 'DANGER: '}
                    {w.severity === 'caution' && 'CAUTION: '}
                    {w.severity === 'info' && 'NOTE: '}
                  </span>
                  {w.text}
                </AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Connection Details Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Connection Details</CardTitle>
          <CardDescription>Step-by-step connection instructions for each piece of test equipment</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {setup.connections.map((c, i) => {
              const style = signalColors[c.signal]
              return (
                <div
                  key={c.id}
                  className={cn(
                    'rounded-lg border p-3',
                    c.critical && 'ring-1 ring-red-300 border-red-200',
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-slate-900">
                          {i + 1}. {c.equipment}
                        </span>
                        <Badge className="text-[10px] px-1.5 py-0" style={{ backgroundColor: style.bg, color: style.stroke, border: `1px solid ${style.stroke}` }}>
                          {style.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{directionLabel[c.direction]}</span>
                        {c.critical && <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0">Critical</Badge>}
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                        <div>
                          <span className="text-muted-foreground">Instrument: </span>
                          <span className="font-medium font-mono">{c.model}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Port: </span>
                          <span className="font-medium">{c.port}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">UUT Point: </span>
                          <span className="font-medium">{c.uutPoint}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Cable: </span>
                          <span className="font-medium">{c.cable}</span>
                        </div>
                      </div>
                      {c.notes && (
                        <p className="text-xs text-slate-600 mt-1.5 bg-slate-50 rounded px-2 py-1">
                          {c.notes}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Setup Notes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Setup Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            {setup.setupNotes.map((note, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-muted-foreground shrink-0">•</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Power-On Sequence */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Power-On Sequence</CardTitle>
          <CardDescription>Follow this exact sequence when applying power to the UUT</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {setup.powerSequence.map((step, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                  {i + 1}
                </div>
                <span className="pt-0.5">{step.replace(/^\d+\.\s*/, '')}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Separator />
    </div>
  )
}

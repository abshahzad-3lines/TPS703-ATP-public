import { useCallback, useEffect, useRef, useState, useDeferredValue } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TracePoint {
  frequency: number; // MHz
  value: number; // dB (negative)
}

interface NetworkAnalyzerPanelProps {
  /** Measured return loss in dB (negative, e.g. -14.5) */
  value: number | null;
  /** Current frequency in MHz */
  frequency?: number | null;
  /** Return loss spec limit in dB (e.g. -11.0 for 110K245) */
  limitMax?: number | null;
  /** Historical / swept trace data */
  traces?: TracePoint[];
  /** Panel label */
  label?: string;
  /** React 19 ref as regular prop */
  ref?: React.Ref<HTMLDivElement>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FREQ_MIN = 2800; // MHz
const DEFAULT_FREQ_MAX = 3100; // MHz
const DEFAULT_DB_MIN = -40; // dB (bottom of display)
const DB_MAX = 0; // dB (top of display)

// Grid lines
const DB_MAJOR_STEP = 5; // every 5 dB
const FREQ_MAJOR_STEP = 50; // every 50 MHz

// Display area margins inside the canvas (pixels, scaled by DPR later)
const MARGIN = { top: 28, right: 16, bottom: 32, left: 52 };

// Colors — Agilent / Rohde & Schwarz inspired
const COLOR_BG = "#050a1a";
const COLOR_GRID = "#0c1a3a";
const COLOR_GRID_MAJOR = "#132550";
const COLOR_AXIS_TEXT = "#6b8cbe";
const COLOR_TRACE_ACTIVE = "#06b6d4"; // cyan-500
const COLOR_TRACE_DIM = "rgba(6,182,212,0.30)";
const COLOR_SPEC_LINE = "#f97316"; // orange-500
const COLOR_MARKER = "#facc15"; // yellow-400

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a frequency value (MHz) to canvas x coordinate */
function freqToX(freq: number, plotW: number, fMin: number, fMax: number): number {
  return ((freq - fMin) / (fMax - fMin)) * plotW;
}

/** Map a dB value to canvas y coordinate (0 dB at top) */
function dbToY(db: number, plotH: number, dbMin: number): number {
  return ((DB_MAX - db) / (DB_MAX - dbMin)) * plotH;
}

/** Generate a realistic-looking S11 trace around a center value */
function generateSyntheticTrace(
  centerDb: number,
  centerFreq: number,
  fMin: number,
  fMax: number,
): TracePoint[] {
  const points: TracePoint[] = [];
  const numPoints = 301; // typical NA sweep point count
  const step = (fMax - fMin) / (numPoints - 1);

  for (let i = 0; i < numPoints; i++) {
    const f = fMin + i * step;

    // Model: a resonant dip near centerFreq, with gentle roll-off
    const offset = (f - centerFreq) / 80; // 80 MHz half-width
    const shapedDb = centerDb + 8 * (1 - Math.exp(-offset * offset));

    // Add small ripple to look realistic
    const ripple = 0.4 * Math.sin(f * 0.12) + 0.2 * Math.sin(f * 0.31);

    points.push({ frequency: f, value: Math.min(0, shapedDb + ripple) });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function NetworkAnalyzerPanel({
  value,
  frequency = null,
  limitMax = null,
  traces,
  label = "Network Analyzer",
  ref,
}: NetworkAnalyzerPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Display scaling state
  const [displayDbMin, setDisplayDbMin] = useState(DEFAULT_DB_MIN);
  const [displayFreqMin, setDisplayFreqMin] = useState(DEFAULT_FREQ_MIN);
  const [displayFreqMax, setDisplayFreqMax] = useState(DEFAULT_FREQ_MAX);

  // Reset display state when props change (new step)
  useEffect(() => {
    setDisplayDbMin(DEFAULT_DB_MIN);
    setDisplayFreqMin(DEFAULT_FREQ_MIN);
    setDisplayFreqMax(DEFAULT_FREQ_MAX);
  }, [value, frequency, limitMax]);

  // Defer heavy trace data so typing / parameter changes stay responsive
  const deferredValue = useDeferredValue(value);
  const deferredFreq = useDeferredValue(frequency);
  const deferredTraces = useDeferredValue(traces);

  // ------------------------------------------------------------------
  // Canvas drawing
  // ------------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Hi-DPI setup
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const plotW = w - MARGIN.left - MARGIN.right;
    const plotH = h - MARGIN.top - MARGIN.bottom;

    // ---- Background ----
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, w, h);

    // ---- Grid ----
    ctx.save();
    ctx.translate(MARGIN.left, MARGIN.top);

    // Horizontal grid lines (dB)
    for (let db = DB_MAX; db >= displayDbMin; db -= DB_MAJOR_STEP) {
      const y = dbToY(db, plotH, displayDbMin);
      ctx.strokeStyle = db % 10 === 0 ? COLOR_GRID_MAJOR : COLOR_GRID;
      ctx.lineWidth = db % 10 === 0 ? 0.8 : 0.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
      ctx.stroke();
    }

    // Vertical grid lines (frequency)
    for (let f = displayFreqMin; f <= displayFreqMax; f += FREQ_MAJOR_STEP) {
      const x = freqToX(f, plotW, displayFreqMin, displayFreqMax);
      ctx.strokeStyle = f % 100 === 0 ? COLOR_GRID_MAJOR : COLOR_GRID;
      ctx.lineWidth = f % 100 === 0 ? 0.8 : 0.4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotH);
      ctx.stroke();
    }

    // Plot border
    ctx.strokeStyle = COLOR_GRID_MAJOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, plotW, plotH);

    // ---- Spec limit line ----
    if (limitMax != null) {
      const specY = dbToY(limitMax, plotH, displayDbMin);
      ctx.strokeStyle = COLOR_SPEC_LINE;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, specY);
      ctx.lineTo(plotW, specY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label on right
      ctx.fillStyle = COLOR_SPEC_LINE;
      ctx.font = "bold 10px 'Consolas', 'Courier New', monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`SPEC ${limitMax.toFixed(1)} dB`, plotW - 4, specY - 3);
    }

    // ---- Traces ----
    const activeTrace =
      deferredTraces && deferredTraces.length > 0
        ? deferredTraces
        : deferredValue != null
          ? generateSyntheticTrace(
              deferredValue,
              deferredFreq ?? (displayFreqMin + displayFreqMax) / 2,
              displayFreqMin,
              displayFreqMax,
            )
          : null;

    // Draw a dimmer "previous" trace slightly offset if we have real traces
    // (simulates multi-trace overlay at different drive levels)
    if (activeTrace && activeTrace.length > 1) {
      // Dim overlay — shifted up by ~1.5 dB to simulate a different drive level
      ctx.strokeStyle = COLOR_TRACE_DIM;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < activeTrace.length; i++) {
        const pt = activeTrace[i];
        const x = freqToX(pt.frequency, plotW, displayFreqMin, displayFreqMax);
        const y = dbToY(pt.value + 1.5, plotH, displayDbMin);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Second dim overlay — shifted down by ~1 dB
      ctx.strokeStyle = "rgba(6,182,212,0.18)";
      ctx.beginPath();
      for (let i = 0; i < activeTrace.length; i++) {
        const pt = activeTrace[i];
        const x = freqToX(pt.frequency, plotW, displayFreqMin, displayFreqMax);
        const y = dbToY(pt.value - 1.0, plotH, displayDbMin);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Active trace (bright cyan with subtle glow)
    if (activeTrace && activeTrace.length > 1) {
      // Glow
      ctx.save();
      ctx.shadowColor = COLOR_TRACE_ACTIVE;
      ctx.shadowBlur = 4;
      ctx.strokeStyle = COLOR_TRACE_ACTIVE;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < activeTrace.length; i++) {
        const pt = activeTrace[i];
        const x = freqToX(pt.frequency, plotW, displayFreqMin, displayFreqMax);
        const y = dbToY(pt.value, plotH, displayDbMin);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ---- Marker at current frequency ----
    const markerFreq = deferredFreq ?? (displayFreqMin + displayFreqMax) / 2;
    if (deferredValue != null) {
      const mx = freqToX(markerFreq, plotW, displayFreqMin, displayFreqMax);
      const my = dbToY(deferredValue, plotH, displayDbMin);

      // Diamond marker
      ctx.fillStyle = COLOR_MARKER;
      ctx.beginPath();
      ctx.moveTo(mx, my - 6);
      ctx.lineTo(mx + 5, my);
      ctx.lineTo(mx, my + 6);
      ctx.lineTo(mx - 5, my);
      ctx.closePath();
      ctx.fill();

      // Vertical dashed line from marker to top
      ctx.strokeStyle = "rgba(250,204,21,0.35)";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, my - 7);
      ctx.stroke();
      ctx.setLineDash([]);

      // Marker readout box
      const readoutText = `MKR: ${markerFreq.toFixed(1)} MHz  ${deferredValue.toFixed(2)} dB`;
      ctx.font = "bold 10px 'Consolas', 'Courier New', monospace";
      const textW = ctx.measureText(readoutText).width;
      const boxX = Math.min(mx + 8, plotW - textW - 12);
      const boxY = Math.max(my - 22, 2);

      ctx.fillStyle = "rgba(5,10,26,0.85)";
      ctx.fillRect(boxX, boxY, textW + 8, 16);
      ctx.strokeStyle = COLOR_MARKER;
      ctx.lineWidth = 0.6;
      ctx.strokeRect(boxX, boxY, textW + 8, 16);
      ctx.fillStyle = COLOR_MARKER;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(readoutText, boxX + 4, boxY + 3);
    }

    ctx.restore(); // pop translate

    // ---- Axis labels ----
    // Y-axis (dB)
    ctx.fillStyle = COLOR_AXIS_TEXT;
    ctx.font = "10px 'Consolas', 'Courier New', monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let db = DB_MAX; db >= displayDbMin; db -= 10) {
      const y = MARGIN.top + dbToY(db, plotH, displayDbMin);
      ctx.fillText(`${db}`, MARGIN.left - 6, y);
    }

    // X-axis (MHz)
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const freqLabelStep = displayFreqMax - displayFreqMin <= 200 ? 50 : 100;
    for (let f = displayFreqMin; f <= displayFreqMax; f += freqLabelStep) {
      const x = MARGIN.left + freqToX(f, plotW, displayFreqMin, displayFreqMax);
      ctx.fillText(`${f}`, x, MARGIN.top + plotH + 4);
    }

    // Axis titles
    ctx.fillStyle = COLOR_AXIS_TEXT;
    ctx.font = "9px 'Consolas', 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("Frequency (MHz)", MARGIN.left + plotW / 2, h - 4);

    ctx.save();
    ctx.translate(10, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("Return Loss (dB)", 0, 0);
    ctx.restore();

    // ---- Title bar at top ----
    ctx.fillStyle = "#0e1b38";
    ctx.fillRect(MARGIN.left, 0, plotW, MARGIN.top - 2);
    ctx.fillStyle = "#94a9d0";
    ctx.font = "bold 11px 'Consolas', 'Courier New', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("S11  LOG MAG", MARGIN.left + 6, 6);

    // Trace identifier
    ctx.fillStyle = COLOR_TRACE_ACTIVE;
    ctx.fillText("Tr1", MARGIN.left + 140, 6);

    // Center frequency label
    const cf = ((displayFreqMin + displayFreqMax) / 2).toFixed(1);
    const span = (displayFreqMax - displayFreqMin).toFixed(0);
    ctx.fillStyle = "#94a9d0";
    ctx.textAlign = "right";
    ctx.fillText(`CF ${cf} MHz  SPAN ${span} MHz`, MARGIN.left + plotW - 6, 6);
  }, [deferredValue, deferredFreq, deferredTraces, limitMax, displayDbMin, displayFreqMin, displayFreqMax]);

  // ------------------------------------------------------------------
  // Canvas ref with cleanup (React 19 pattern)
  // ------------------------------------------------------------------
  const canvasRefCallback = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      if (!node) return;

      // Initial draw
      draw();

      // Observe resize to redraw
      const observer = new ResizeObserver(() => {
        draw();
      });
      observer.observe(node);

      // Cleanup function (React 19 ref cleanup)
      return () => {
        observer.disconnect();
      };
    },
    [draw],
  );

  // Re-draw when deferred values change
  useEffect(() => {
    draw();
  }, [draw]);

  // ------------------------------------------------------------------
  // Derived display values
  // ------------------------------------------------------------------
  const passesSpec =
    value != null && limitMax != null ? value < limitMax : null;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col rounded-lg border bg-[#e5e7eb] p-2 shadow-md",
        "select-none",
      )}
    >
      {/* Bezel label */}
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">
          {label}
        </span>
        <span className="text-[10px] font-medium text-gray-400">
          S-PARAMETER
        </span>
      </div>

      {/* Control strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-[10px] font-mono rounded-t" style={{ backgroundColor: '#0d1230' }}>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">dB RANGE</span>
          {([[-20, "0 to -20"], [-30, "0 to -30"], [-40, "0 to -40"], [-50, "0 to -50"]] as const).map(([v, lbl]) => (
            <button key={v} onClick={() => setDisplayDbMin(v)}
              className={cn("px-1.5 py-0.5 rounded transition-colors",
                displayDbMin === v ? "bg-cyan-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              )}
            >{lbl}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">FREQ</span>
          {([[2700, 3200, "2.7-3.2"], [2800, 3100, "2.8-3.1"], [2900, 3000, "2.9-3.0"]] as const).map(([fMin, fMax, lbl]) => (
            <button key={lbl} onClick={() => { setDisplayFreqMin(fMin); setDisplayFreqMax(fMax); }}
              className={cn("px-1.5 py-0.5 rounded transition-colors",
                displayFreqMin === fMin && displayFreqMax === fMax ? "bg-cyan-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              )}
            >{lbl}</button>
          ))}
        </div>
        <button
          onClick={() => { setDisplayDbMin(DEFAULT_DB_MIN); setDisplayFreqMin(DEFAULT_FREQ_MIN); setDisplayFreqMax(DEFAULT_FREQ_MAX); }}
          className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
        >AUTO</button>
      </div>

      {/* Canvas display */}
      <div className="relative overflow-hidden rounded-b border border-gray-400">
        <canvas
          ref={canvasRefCallback}
          className="h-[260px] w-full"
          style={{ display: "block" }}
        />
      </div>

      {/* Readout bar below canvas */}
      <div className="mt-1.5 flex items-center justify-between gap-2 rounded bg-[#0a0f24] px-3 py-1.5 font-mono text-[11px]">
        {/* Frequency */}
        <div className="text-cyan-400">
          <span className="mr-1 text-gray-500">FREQ</span>
          {frequency != null ? `${frequency.toFixed(1)} MHz` : "---.- MHz"}
        </div>

        {/* Return loss value */}
        <div className="text-cyan-300">
          <span className="mr-1 text-gray-500">S11</span>
          {value != null ? `${value.toFixed(2)} dB` : "---.-- dB"}
        </div>

        {/* Spec limit */}
        <div className="text-orange-400">
          <span className="mr-1 text-gray-500">LIMIT</span>
          {limitMax != null ? `${limitMax.toFixed(1)} dB` : "--- dB"}
        </div>

        {/* Pass / Fail */}
        {passesSpec != null && (
          <div
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-bold uppercase",
              passesSpec
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-red-500/20 text-red-400",
            )}
          >
            {passesSpec ? "PASS" : "FAIL"}
          </div>
        )}
      </div>
    </div>
  );
}

export default NetworkAnalyzerPanel;
export type { NetworkAnalyzerPanelProps, TracePoint };

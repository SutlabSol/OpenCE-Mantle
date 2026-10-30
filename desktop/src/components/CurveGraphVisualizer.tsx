import { useState, useRef, useEffect } from 'react';
import {
  evaluateBlamFunctionCurve,
  type BlamPeriodicFunctionType,
} from '../../../core/src/map/baboon-browser-utils';

export type HaloTransitionFunction =
  | 'linear'
  | 'early'
  | 'very early'
  | 'late'
  | 'very late'
  | 'cosine'
  | 'one'
  | 'zero';

export interface CurveParameters {
  transition: HaloTransitionFunction;
  frequency?: number;
  scale?: number;
  exponent?: number;
  minClamp?: number;
  maxClamp?: number;
}

interface Props {
  initialParameters?: Partial<CurveParameters>;
  title?: string;
  onParametersChange?: (params: CurveParameters) => void;
  compact?: boolean;
}

/**
 * Evaluates standard Halo transition function over normalized domain t in [0, 1].
 */
export function evaluateHaloFunction(t: number, transition: HaloTransitionFunction, exponent = 1.0): number {
  const clampedT = Math.max(0, Math.min(1, t));
  let baseVal = 0;

  switch (transition) {
    case 'linear':
      baseVal = clampedT;
      break;
    case 'early':
      baseVal = 1 - Math.pow(1 - clampedT, 2);
      break;
    case 'very early':
      baseVal = 1 - Math.pow(1 - clampedT, 3);
      break;
    case 'late':
      baseVal = Math.pow(clampedT, 2);
      break;
    case 'very late':
      baseVal = Math.pow(clampedT, 3);
      break;
    case 'cosine':
      baseVal = 0.5 * (1 - Math.cos(Math.PI * clampedT));
      break;
    case 'one':
      baseVal = 1.0;
      break;
    case 'zero':
      baseVal = 0.0;
      break;
    default:
      baseVal = clampedT;
  }

  if (exponent !== 1.0 && baseVal > 0) {
    return Math.pow(baseVal, exponent);
  }
  return baseVal;
}

export default function CurveGraphVisualizer({
  initialParameters,
  title = 'Guerilla Curve Graph Visualizer',
  onParametersChange,
  compact = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [transition, setTransition] = useState<HaloTransitionFunction>(
    initialParameters?.transition ?? 'cosine',
  );
  const [exponent, setExponent] = useState<number>(initialParameters?.exponent ?? 1.0);
  const [scale, setScale] = useState<number>(initialParameters?.scale ?? 1.0);
  const [frequency, setFrequency] = useState<number>(initialParameters?.frequency ?? 1.0);
  const [curveKind, setCurveKind] = useState<'transition' | 'periodic' | 'linear' | 'spline'>('transition');
  const [periodicFn, setPeriodicFn] = useState<BlamPeriodicFunctionType>('sine');
  const [phase, setPhase] = useState<number>(0);
  const [colorStopA, setColorStopA] = useState<string>('#0ea5e9');
  const [colorStopB, setColorStopB] = useState<string>('#22c55e');
  const [colorStopC, setColorStopC] = useState<string>('#f59e0b');
  const [colorStopD, setColorStopD] = useState<string>('#ef4444');

  // Hover cursor state
  const [hoverCoord, setHoverCoord] = useState<{ t: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    onParametersChange?.({
      transition,
      exponent,
      scale,
      frequency,
    });
  }, [transition, exponent, scale, frequency, onParametersChange]);

  // Draw Graph on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = compact ? 16 : 28;

    const plotW = width - padding * 2;
    const plotH = height - padding * 2;

    // Background
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;

    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      // Horizontal grid
      const y = padding + (plotH / steps) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      // Vertical grid
      const x = padding + (plotW / steps) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();

      // Axis labels
      if (!compact) {
        ctx.fillStyle = '#64748b';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(((steps - i) / steps).toFixed(2), padding - 4, y + 3);

        ctx.textAlign = 'center';
        ctx.fillText((i / steps).toFixed(2), x, height - padding + 14);
      }
    }

    // Outer bounding frame
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(padding, padding, plotW, plotH);

    // Plot Curve
    ctx.beginPath();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;

    const hexToRgb01 = (hex: string): [number, number, number] => {
      const clean = hex.replace('#', '');
      return [
        parseInt(clean.slice(0, 2), 16) / 255,
        parseInt(clean.slice(2, 4), 16) / 255,
        parseInt(clean.slice(4, 6), 16) / 255,
      ];
    };

    const evaluated = evaluateBlamFunctionCurve(
      {
        kind: curveKind,
        periodicFunction: periodicFn,
        transitionFunction: transition,
        frequency,
        phase,
        minBound: 0,
        maxBound: scale,
        colorStops: [
          hexToRgb01(colorStopA),
          hexToRgb01(colorStopB),
          hexToRgb01(colorStopC),
          hexToRgb01(colorStopD),
        ],
      },
      200,
    );

    const numPoints = 200;
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const val =
        curveKind === 'transition'
          ? Math.max(0, Math.min(1, evaluateHaloFunction((t * frequency) % 1.0, transition, exponent) * scale))
          : Math.max(0, Math.min(1, evaluated.samples[i]?.y ?? 0));

      const px = padding + t * plotW;
      const py = padding + (1.0 - val) * plotH;

      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    // Area fill under curve
    ctx.lineTo(width - padding, height - padding);
    ctx.lineTo(padding, height - padding);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.fill();

    // Hover Marker
    if (hoverCoord) {
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      // Crosshair to axes
      ctx.beginPath();
      ctx.moveTo(padding, hoverCoord.py);
      ctx.lineTo(width - padding, hoverCoord.py);
      ctx.moveTo(hoverCoord.px, padding);
      ctx.lineTo(hoverCoord.px, height - padding);
      ctx.stroke();
      ctx.setLineDash([]);

      // Point circle
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(hoverCoord.px, hoverCoord.py, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [transition, exponent, scale, frequency, curveKind, periodicFn, phase, colorStopA, colorStopB, colorStopC, colorStopD, hoverCoord, compact]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const padding = compact ? 16 : 28;
    const plotW = canvas.width - padding * 2;
    const plotH = canvas.height - padding * 2;

    const mouseX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const clampedX = Math.max(padding, Math.min(canvas.width - padding, mouseX));
    const t = (clampedX - padding) / plotW;

    const normT = (t * frequency) % 1.0;
    const rawVal = evaluateHaloFunction(normT, transition, exponent);
    const y = Math.max(0, Math.min(1, rawVal * scale));
    const py = padding + (1.0 - y) * plotH;

    setHoverCoord({ t, y, px: clampedX, py });
  };

  const handleMouseLeave = () => {
    setHoverCoord(null);
  };

  const transitions: HaloTransitionFunction[] = [
    'linear',
    'early',
    'very early',
    'late',
    'very late',
    'cosine',
    'one',
    'zero',
  ];

  return (
    <div
      data-testid="curve-graph-visualizer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 8 : 12,
        background: 'var(--bg-panel, #1e293b)',
        padding: compact ? 10 : 16,
        borderRadius: 6,
        border: '1px solid var(--border, #334155)',
        color: 'var(--text-primary, #f8fafc)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: compact ? 12 : 13, color: '#38bdf8' }}>
          📈 {title}
        </span>
        {hoverCoord && (
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#f43f5e' }}>
            t: {hoverCoord.t.toFixed(3)}, f(t): {hoverCoord.y.toFixed(3)}
          </span>
        )}
      </div>

      <div style={{ position: 'relative', width: '100%' }}>
        <canvas
          ref={canvasRef}
          width={compact ? 320 : 480}
          height={compact ? 160 : 220}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{
            width: '100%',
            height: compact ? 160 : 220,
            borderRadius: 4,
            cursor: 'crosshair',
            display: 'block',
          }}
        />
      </div>

      {/* Control sliders & selector */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(3, 1fr)',
          gap: 8,
          fontSize: 11,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ color: 'var(--text-dim, #94a3b8)' }}>Function Mode:</label>
          <select
            data-testid="curve-kind-select"
            value={curveKind}
            onChange={(e) => setCurveKind(e.target.value as any)}
            style={{
              background: '#0b0f19',
              color: '#fff',
              border: '1px solid #334155',
              borderRadius: 3,
              padding: '3px 6px',
              fontSize: 11,
            }}
          >
            <option value="transition">Transition (Ease / Exponent)</option>
            <option value="periodic">Periodic (12 Blam Waveforms)</option>
            <option value="linear">Linear Ramp</option>
            <option value="spline">Hermite Spline</option>
          </select>
        </div>

        {curveKind === 'periodic' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ color: 'var(--text-dim, #94a3b8)' }}>Periodic Waveform:</label>
            <select
              data-testid="curve-periodic-select"
              value={periodicFn}
              onChange={(e) => setPeriodicFn(e.target.value as BlamPeriodicFunctionType)}
              style={{
                background: '#0b0f19',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: 3,
                padding: '3px 6px',
                fontSize: 11,
              }}
            >
              {[
                'one',
                'zero',
                'cosine',
                'cosine (variable period)',
                'diagonal wave',
                'diagonal wave (variable period)',
                'slide',
                'slide (variable period)',
                'noise',
                'jitter',
                'wander',
                'spark',
              ].map((fn) => (
                <option key={fn} value={fn}>
                  {fn}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ color: 'var(--text-dim, #94a3b8)' }}>Transition:</label>
          <select
            data-testid="curve-transition-select"
            value={transition}
            onChange={(e) => setTransition(e.target.value as HaloTransitionFunction)}
            style={{
              background: '#0b0f19',
              color: '#fff',
              border: '1px solid #334155',
              borderRadius: 3,
              padding: '3px 6px',
              fontSize: 11,
            }}
          >
            {transitions.map((tr) => (
              <option key={tr} value={tr}>
                {tr}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <label style={{ color: 'var(--text-dim, #94a3b8)' }}>Exponent:</label>
            <span>{exponent.toFixed(2)}</span>
          </div>
          <input
            data-testid="curve-exponent-slider"
            type="range"
            min="0.2"
            max="4.0"
            step="0.05"
            value={exponent}
            onChange={(e) => setExponent(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <label style={{ color: 'var(--text-dim, #94a3b8)' }}>Scale:</label>
            <span>{scale.toFixed(2)}x</span>
          </div>
          <input
            data-testid="curve-scale-slider"
            type="range"
            min="0.1"
            max="2.0"
            step="0.05"
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <label style={{ color: 'var(--text-dim, #94a3b8)' }}>Frequency:</label>
            <span>{frequency.toFixed(1)}</span>
          </div>
          <input
            data-testid="curve-frequency-slider"
            type="range"
            min="1.0"
            max="5.0"
            step="0.5"
            value={frequency}
            onChange={(e) => setFrequency(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <label style={{ color: 'var(--text-dim, #94a3b8)' }}>Phase:</label>
            <span>{phase.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.0"
            max="1.0"
            step="0.05"
            value={phase}
            onChange={(e) => setPhase(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* 4-Stop Color Gradient Ramp (Baboon Function Color-Stop Preview) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
          <span style={{ color: 'var(--text-dim, #94a3b8)' }}>4-Stop Color Ramp Preview (Lower / Mid-Low / Mid-High / Upper):</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="color" value={colorStopA} onChange={(e) => setColorStopA(e.target.value)} title="Stop A (0%)" style={{ width: 24, height: 20, padding: 0, border: 'none', cursor: 'pointer' }} />
            <input type="color" value={colorStopB} onChange={(e) => setColorStopB(e.target.value)} title="Stop B (33%)" style={{ width: 24, height: 20, padding: 0, border: 'none', cursor: 'pointer' }} />
            <input type="color" value={colorStopC} onChange={(e) => setColorStopC(e.target.value)} title="Stop C (66%)" style={{ width: 24, height: 20, padding: 0, border: 'none', cursor: 'pointer' }} />
            <input type="color" value={colorStopD} onChange={(e) => setColorStopD(e.target.value)} title="Stop D (100%)" style={{ width: 24, height: 20, padding: 0, border: 'none', cursor: 'pointer' }} />
          </div>
        </div>
        <div
          data-testid="curve-color-ramp-bar"
          style={{
            height: 14,
            borderRadius: 3,
            border: '1px solid #334155',
            background: `linear-gradient(90deg, ${colorStopA} 0%, ${colorStopB} 33%, ${colorStopC} 66%, ${colorStopD} 100%)`,
          }}
        />
      </div>
    </div>
  );
}

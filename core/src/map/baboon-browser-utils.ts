/**
 * Pure browser-safe Baboon curve evaluation and HUD string markup utilities.
 * Contains zero Node.js (`fs`, `path`, `crypto`) dependencies so it can be imported
 * directly by both `core/` and Vite renderer components (`CurveGraphVisualizer.tsx`,
 * `UnicodeStringEditorPanel.tsx`).
 */

export type BlamPeriodicFunctionType =
  | 'one'
  | 'zero'
  | 'cosine'
  | 'cosine (variable period)'
  | 'diagonal wave'
  | 'diagonal wave (variable period)'
  | 'slide'
  | 'slide (variable period)'
  | 'noise'
  | 'jitter'
  | 'wander'
  | 'spark';

export type BlamTransitionFunctionType =
  | 'linear'
  | 'early'
  | 'very early'
  | 'late'
  | 'very late'
  | 'cosine';

export interface BlamFunctionCurveParams {
  kind: 'periodic' | 'transition' | 'linear' | 'spline';
  periodicFunction?: BlamPeriodicFunctionType | string;
  transitionFunction?: BlamTransitionFunctionType | string;
  frequency?: number;
  phase?: number;
  min?: number;
  max?: number;
  minBound?: number;
  maxBound?: number;
  controlPoints?: Array<{ x: number; y: number }>;
  colorStops?: Array<{ t: number; hex: string } | [number, number, number]>;
}

export interface BlamFunctionCurveEvaluation {
  samples: Array<{ x: number; y: number; colorHex?: string; rgbHex?: string }>;
  minY: number;
  maxY: number;
}

function evalPeriodicWave(fnName: string, t: number): number {
  const u = ((t % 1) + 1) % 1;
  switch (fnName.toLowerCase()) {
    case 'one':
      return 1;
    case 'zero':
      return 0;
    case 'cosine':
    case 'cosine (variable period)':
      return 0.5 * (1 + Math.cos(2 * Math.PI * u));
    case 'diagonal wave':
    case 'diagonal wave (variable period)':
      return u < 0.5 ? 2 * u : 2 * (1 - u);
    case 'slide':
    case 'slide (variable period)':
      return u;
    case 'noise':
    case 'jitter':
    case 'wander': {
      const s = Math.sin(u * 12.9898 * 43.758) * 43758.5453;
      return s - Math.floor(s);
    }
    case 'spark': {
      const s = Math.sin(u * 78.233) * 43758.5453;
      return s - Math.floor(s) > 0.8 ? 1 : 0;
    }
    default:
      return 0.5 * (1 + Math.cos(2 * Math.PI * u));
  }
}

function evalTransitionCurve(fnName: string, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  switch (fnName.toLowerCase()) {
    case 'early':
      return Math.sqrt(u);
    case 'very early':
      return Math.pow(u, 0.25);
    case 'late':
      return u * u;
    case 'very late':
      return u * u * u * u;
    case 'cosine':
      return 0.5 * (1 - Math.cos(Math.PI * u));
    case 'linear':
    default:
      return u;
  }
}

function interpolateHexColors(
  stops: Array<{ t: number; hex: string } | [number, number, number]>,
  u: number,
): string | undefined {
  if (!stops || stops.length === 0) return undefined;
  const normalizedStops: Array<{ t: number; hex: string }> = stops.map((stop, idx) => {
    if (Array.isArray(stop)) {
      const r = Math.max(0, Math.min(255, Math.round((stop[0] ?? 0) * 255)));
      const g = Math.max(0, Math.min(255, Math.round((stop[1] ?? 0) * 255)));
      const b = Math.max(0, Math.min(255, Math.round((stop[2] ?? 0) * 255)));
      const t = stops.length > 1 ? idx / (stops.length - 1) : 0;
      return {
        t,
        hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
      };
    }
    return stop;
  });
  if (normalizedStops.length === 1) return normalizedStops[0]!.hex;
  const sorted = [...normalizedStops].sort((a, b) => a.t - b.t);
  const clamped = Math.max(0, Math.min(1, u));
  let left = sorted[0]!;
  let right = sorted[sorted.length - 1]!;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (clamped >= sorted[i]!.t && clamped <= sorted[i + 1]!.t) {
      left = sorted[i]!;
      right = sorted[i + 1]!;
      break;
    }
  }
  const span = Math.max(1e-6, right.t - left.t);
  const alpha = Math.max(0, Math.min(1, (clamped - left.t) / span));
  const parseRgb = (hex: string): [number, number, number] => {
    const clean = hex.replace(/^#/, '');
    const n = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16) || 0;
    return [(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  };
  const [r1, g1, b1] = parseRgb(left.hex);
  const [r2, g2, b2] = parseRgb(right.hex);
  const r = Math.round(r1 + (r2 - r1) * alpha);
  const g = Math.round(g1 + (g2 - g1) * alpha);
  const b = Math.round(b1 + (b2 - b1) * alpha);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function evaluateBlamFunctionCurve(
  params: BlamFunctionCurveParams,
  sampleCount = 65,
): BlamFunctionCurveEvaluation {
  const n = Math.max(2, Math.min(512, sampleCount));
  const minVal = params.min ?? params.minBound ?? 0;
  const maxVal = params.max ?? params.maxBound ?? 1;
  const freq = params.frequency ?? 1;
  const phase = params.phase ?? 0;

  const samples: Array<{ x: number; y: number; colorHex?: string; rgbHex?: string }> = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let normY = x;
    if (params.kind === 'periodic') {
      normY = evalPeriodicWave(params.periodicFunction ?? 'cosine', x * freq + phase);
    } else if (params.kind === 'transition') {
      normY = evalTransitionCurve(params.transitionFunction ?? 'linear', x);
    } else if (params.kind === 'spline' && params.controlPoints && params.controlPoints.length >= 2) {
      const pts = [...params.controlPoints].sort((a, b) => a.x - b.x);
      let p1 = pts[0]!;
      let p2 = pts[pts.length - 1]!;
      for (let j = 0; j < pts.length - 1; j++) {
        if (x >= pts[j]!.x && x <= pts[j + 1]!.x) {
          p1 = pts[j]!;
          p2 = pts[j + 1]!;
          break;
        }
      }
      const u = (x - p1.x) / Math.max(1e-6, p2.x - p1.x);
      const smooth = u * u * (3 - 2 * u);
      normY = p1.y + (p2.y - p1.y) * smooth;
    } else {
      normY = x;
    }

    const y = minVal + (maxVal - minVal) * normY;
    const colorHex = interpolateHexColors(params.colorStops ?? [], normY);
    samples.push({ x, y, colorHex, rgbHex: colorHex });
  }

  return {
    samples,
    minY: Math.min(minVal, maxVal),
    maxY: Math.max(minVal, maxVal),
  };
}

export interface HaloStringMarkupToken {
  type: 'text' | 'button_token' | 'control_token';
  raw: string;
  start: number;
  end: number;
  description?: string;
}

export const HALO_HUD_MARKUP_TOKENS: Record<string, string> = {
  '%a-button': 'A Button',
  '%b-button': 'B Button',
  '%x-button': 'X Button',
  '%y-button': 'Y Button',
  '%black-button': 'Black Button',
  '%white-button': 'White Button',
  '%left-trigger': 'Left Trigger',
  '%right-trigger': 'Right Trigger',
  '%dpad-up': 'D-Pad Up',
  '%dpad-down': 'D-Pad Down',
  '%dpad-left': 'D-Pad Left',
  '%dpad-right': 'D-Pad Right',
  '%start-button': 'Start Button',
  '%back-button': 'Back Button',
  '%left-thumb': 'Left Thumbstick',
  '%right-thumb': 'Right Thumbstick',
  '%action': 'Action / Use Key',
  '%jump': 'Jump Key',
  '%accept': 'Accept Key',
  '%cancel': 'Cancel Key',
  '%reload': 'Reload Key',
  '%melee': 'Melee Key',
  '%throw-grenade': 'Throw Grenade Key',
  '%fire': 'Primary Fire Key',
  '%switch-weapon': 'Switch Weapon Key',
  '%switch-grenade': 'Switch Grenade Key',
  '%zoom': 'Zoom Key',
  '%crouch': 'Crouch Key',
  '%flashlight': 'Flashlight Key',
  '%scores': 'Scoreboard Key',
  '%chat': 'Chat Key',
  '%custom-1': 'Custom Bind 1',
  '%custom-2': 'Custom Bind 2',
  '%custom-3': 'Custom Bind 3',
  '%custom-4': 'Custom Bind 4',
  '|n': 'New Line',
  '|t': 'Tab',
  '|l': 'Align Left',
  '|r': 'Align Right',
  '|c': 'Align Center',
};

export function tokenizeHaloHudStringMarkup(text: string): HaloStringMarkupToken[] {
  const tokenRegex = /(%(?:[a-z0-9-]+)|&(?:[a-z0-9_]+)|\|[ntlrc])/gi;
  const tokens: HaloStringMarkupToken[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({
        type: 'text',
        raw: text.slice(lastIdx, match.index),
        start: lastIdx,
        end: match.index,
      });
    }
    const raw = match[0];
    const isControl = raw.startsWith('|');
    tokens.push({
      type: isControl ? 'control_token' : 'button_token',
      raw,
      start: match.index,
      end: match.index + raw.length,
      description: HALO_HUD_MARKUP_TOKENS[raw.toLowerCase()] ?? 'Halo Input / Control Token',
    });
    lastIdx = match.index + raw.length;
  }

  if (lastIdx < text.length) {
    tokens.push({
      type: 'text',
      raw: text.slice(lastIdx),
      start: lastIdx,
      end: text.length,
    });
  }

  return tokens;
}

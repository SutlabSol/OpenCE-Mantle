import { useEffect, useRef, useState } from 'react';
import type { AppThemeId, BspTopDownWireframeData } from '../../electron/shared-types';

export interface ThemeBlueprintColors {
  bg: string;
  grid: string;
  lowRgb: [number, number, number];
  highRgb: [number, number, number];
  border: string;
}

export const THEME_BLUEPRINT_PALETTES: Record<AppThemeId, ThemeBlueprintColors> = {
  dark: {
    bg: '#080d14',
    grid: 'rgba(56, 189, 248, 0.09)',
    lowRgb: [2, 132, 199],
    highRgb: [56, 189, 248],
    border: 'rgba(56, 189, 248, 0.25)',
  },
  light: {
    bg: '#f0f7ff',
    grid: 'rgba(2, 132, 199, 0.13)',
    lowRgb: [3, 105, 161],
    highRgb: [2, 132, 199],
    border: 'rgba(2, 132, 199, 0.28)',
  },
  forerunner: {
    bg: '#050c15',
    grid: 'rgba(0, 229, 255, 0.11)',
    lowRgb: [0, 151, 167],
    highRgb: [0, 229, 255],
    border: 'rgba(0, 229, 255, 0.32)',
  },
  'classic-ce': {
    bg: '#000812',
    grid: 'rgba(92, 196, 255, 0.11)',
    lowRgb: [29, 78, 216],
    highRgb: [92, 196, 255],
    border: 'rgba(92, 196, 255, 0.3)',
  },
  covenant: {
    bg: '#0c0714',
    grid: 'rgba(192, 132, 252, 0.11)',
    lowRgb: [126, 34, 206],
    highRgb: [232, 121, 249],
    border: 'rgba(192, 132, 252, 0.3)',
  },
  unsc: {
    bg: '#080d0a',
    grid: 'rgba(74, 222, 128, 0.11)',
    lowRgb: [21, 128, 61],
    highRgb: [74, 222, 128],
    border: 'rgba(74, 222, 128, 0.3)',
  },
};

interface BspWireframeCanvasProps {
  wireframe: BspTopDownWireframeData | null;
  scenarioName?: string;
  theme?: AppThemeId;
  width?: number;
  height?: number;
  compact?: boolean;
  style?: React.CSSProperties;
}

export default function BspWireframeCanvas({
  wireframe,
  scenarioName = 'map',
  theme = 'dark',
  width = 280,
  height = 156,
  compact = false,
  style,
}: BspWireframeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(width);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateWidth = () => {
      const w = canvas.parentElement?.clientWidth || canvas.clientWidth || width;
      if (w > 20) setMeasuredWidth(w);
    };
    updateWidth();
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      const ro = new ResizeObserver(updateWidth);
      ro.observe(canvas.parentElement);
      return () => ro.disconnect();
    }
  }, [width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const actualWidth = Math.max(60, measuredWidth || width);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(actualWidth * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    const palette = THEME_BLUEPRINT_PALETTES[theme] ?? THEME_BLUEPRINT_PALETTES.dark;

    // 1. Blueprint background
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, actualWidth, height);

    // 2. Subtle engineering blueprint grid
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    const step = 18;
    ctx.beginPath();
    for (let x = step; x < actualWidth; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(actualWidth, y + 0.5);
    }
    ctx.stroke();

    // 3. Corner reticles
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    const r = 6;
    const m = 6;
    ctx.beginPath();
    ctx.moveTo(m, m + r);
    ctx.lineTo(m, m);
    ctx.lineTo(m + r, m);
    ctx.moveTo(actualWidth - m - r, m);
    ctx.lineTo(actualWidth - m, m);
    ctx.lineTo(actualWidth - m, m + r);
    ctx.moveTo(m, height - m - r);
    ctx.lineTo(m, height - m);
    ctx.lineTo(m + r, height - m);
    ctx.moveTo(actualWidth - m - r, height - m);
    ctx.lineTo(actualWidth - m, height - m);
    ctx.lineTo(actualWidth - m, height - m - r);
    ctx.stroke();

    // 4. Render top-down 2D orthographic BSP wireframe mesh within safe clearance zone
    const padX = 16;
    const padTop = compact ? 28 : 33;
    const padBottom = compact ? 10 : 22;
    const availW = Math.max(20, actualWidth - padX * 2);
    const availH = Math.max(20, height - padTop - padBottom);

    if (wireframe && wireframe.segments.length > 0) {
      const aspect = Math.max(0.35, Math.min(2.8, wireframe.aspect || 1));
      let drawW = availW;
      let drawH = availW / aspect;
      if (drawH > availH) {
        drawH = availH;
        drawW = availH * aspect;
      }
      const offsetX = padX + (availW - drawW) * 0.5;
      const offsetY = padTop + (availH - drawH) * 0.5;

      const buckets: Array<Array<[number, number, number, number, number, number]>> = [[], [], [], []];
      for (const seg of wireframe.segments) {
        const zNorm = seg[6] ?? 0.5;
        const bIdx = Math.max(0, Math.min(3, Math.floor(zNorm * 3.99)));
        buckets[bIdx].push([
          offsetX + seg[0] * drawW,
          offsetY + (1 - seg[1]) * drawH,
          offsetX + seg[2] * drawW,
          offsetY + (1 - seg[3]) * drawH,
          offsetX + seg[4] * drawW,
          offsetY + (1 - seg[5]) * drawH,
        ]);
      }

      ctx.lineWidth = theme === 'light' ? 0.75 : 0.65;
      for (let b = 0; b < 4; b++) {
        const list = buckets[b];
        if (list.length === 0) continue;
        const t = b / 3;
        const cr = Math.round(palette.lowRgb[0] + (palette.highRgb[0] - palette.lowRgb[0]) * t);
        const cg = Math.round(palette.lowRgb[1] + (palette.highRgb[1] - palette.lowRgb[1]) * t);
        const cb = Math.round(palette.lowRgb[2] + (palette.highRgb[2] - palette.lowRgb[2]) * t);
        const alpha = theme === 'light' ? 0.42 + t * 0.42 : 0.36 + t * 0.52;
        ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha.toFixed(2)})`;
        ctx.beginPath();
        for (let i = 0; i < list.length; i++) {
          const [x0, y0, x1, y1, x2, y2] = list[i];
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineTo(x0, y0);
        }
        ctx.stroke();
      }
    } else {
      let seed = 0;
      for (let i = 0; i < scenarioName.length; i++) {
        seed = (seed * 31 + scenarioName.charCodeAt(i)) >>> 0;
      }
      const cx = actualWidth * 0.5;
      const cy = padTop + availH * 0.5;
      const rx = availW * 0.42;
      const ry = availH * 0.42;
      const rings = 5;
      const spokes = 18;
      const pts: Array<Array<[number, number]>> = [];
      for (let rIdx = 1; rIdx <= rings; rIdx++) {
        const ringPts: Array<[number, number]> = [];
        const frac = rIdx / rings;
        for (let s = 0; s < spokes; s++) {
          const angle = (s / spokes) * Math.PI * 2;
          const wobble =
            1 +
            0.15 * Math.sin(angle * (2 + (seed % 3)) + seed * 0.1) +
            0.08 * Math.cos(angle * 5 - rIdx);
          const px = cx + Math.cos(angle) * rx * frac * wobble;
          const py = cy + Math.sin(angle) * ry * frac * wobble;
          ringPts.push([px, py]);
        }
        pts.push(ringPts);
      }
      const [hr, hg, hb] = palette.highRgb;
      ctx.strokeStyle = `rgba(${hr}, ${hg}, ${hb}, ${theme === 'light' ? 0.55 : 0.6})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let rIdx = 0; rIdx < rings; rIdx++) {
        const ring = pts[rIdx];
        for (let s = 0; s < spokes; s++) {
          const nextS = (s + 1) % spokes;
          ctx.moveTo(ring[s][0], ring[s][1]);
          ctx.lineTo(ring[nextS][0], ring[nextS][1]);
          if (rIdx > 0) {
            const prevRing = pts[rIdx - 1];
            ctx.moveTo(prevRing[s][0], prevRing[s][1]);
            ctx.lineTo(ring[s][0], ring[s][1]);
            ctx.moveTo(prevRing[s][0], prevRing[s][1]);
            ctx.lineTo(ring[nextS][0], ring[nextS][1]);
          }
        }
      }
      ctx.stroke();
    }

    ctx.restore();
  }, [wireframe, scenarioName, theme, width, height, compact, measuredWidth]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height,
        display: 'block',
        borderBottom: '1px solid var(--border)',
        ...style,
      }}
    />
  );
}

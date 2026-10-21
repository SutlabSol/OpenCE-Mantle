import React, { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';

interface Props {
  tag: TagEntrySummary;
  onClose: () => void;
}

type HudAspectRatio = '16:9' | '4:3';
type HudColorPreset = 'default_blue' | 'plasma_green' | 'covenant_purple' | 'alert_red' | 'needler_pink';
type CrosshairMode = 'lowered' | 'centered';

interface WeaponStats {
  name: string;
  type: 'ar' | 'pistol' | 'shotgun' | 'sniper' | 'plasma_rifle' | 'plasma_pistol' | 'rocket' | 'needler' | 'generic';
  clipSize: number;
  maxReserve: number;
  hasHeat: boolean;
  canZoom: boolean;
  defaultTint: HudColorPreset;
}

function detectWeaponStats(path: string): WeaponStats {
  const p = path.toLowerCase();
  if (p.includes('assault rifle') || p.includes(' assault_rifle') || p.includes('ar')) {
    return { name: 'Assault Rifle', type: 'ar', clipSize: 60, maxReserve: 600, hasHeat: false, canZoom: false, defaultTint: 'default_blue' };
  }
  if (p.includes('pistol') || p.includes('magnum')) {
    return { name: 'M6D Pistol', type: 'pistol', clipSize: 12, maxReserve: 120, hasHeat: false, canZoom: true, defaultTint: 'default_blue' };
  }
  if (p.includes('shotgun')) {
    return { name: 'Shotgun', type: 'shotgun', clipSize: 8, maxReserve: 60, hasHeat: false, canZoom: false, defaultTint: 'default_blue' };
  }
  if (p.includes('sniper')) {
    return { name: 'Sniper Rifle', type: 'sniper', clipSize: 4, maxReserve: 68, hasHeat: false, canZoom: true, defaultTint: 'default_blue' };
  }
  if (p.includes('plasma rifle') || p.includes('plasma_rifle')) {
    return { name: 'Plasma Rifle', type: 'plasma_rifle', clipSize: 100, maxReserve: 100, hasHeat: true, canZoom: false, defaultTint: 'plasma_green' };
  }
  if (p.includes('plasma pistol') || p.includes('plasma_pistol')) {
    return { name: 'Plasma Pistol', type: 'plasma_pistol', clipSize: 100, maxReserve: 100, hasHeat: true, canZoom: false, defaultTint: 'plasma_green' };
  }
  if (p.includes('rocket') || p.includes('rocket_launcher')) {
    return { name: 'Rocket Launcher', type: 'rocket', clipSize: 2, maxReserve: 8, hasHeat: false, canZoom: true, defaultTint: 'default_blue' };
  }
  if (p.includes('needler')) {
    return { name: 'Needler', type: 'needler', clipSize: 30, maxReserve: 180, hasHeat: false, canZoom: false, defaultTint: 'needler_pink' };
  }
  return { name: 'Standard Weapon', type: 'generic', clipSize: 32, maxReserve: 256, hasHeat: false, canZoom: false, defaultTint: 'default_blue' };
}

export default function HudPreviewerDialog({ tag, onClose }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stats = detectWeaponStats(tag.path);

  // Canvas Settings
  const [aspectRatio, setAspectRatio] = useState<HudAspectRatio>('16:9');
  const [crosshairMode, setCrosshairMode] = useState<CrosshairMode>('lowered');
  const [showSafeFrames, setShowSafeFrames] = useState(false);
  const [showCrosshairGuide, setShowCrosshairGuide] = useState(false);
  const [hudTint, setHudTint] = useState<HudColorPreset>(stats.defaultTint);

  // Interactive Live HUD Simulation State
  const [shieldPercent, setShieldPercent] = useState(100);
  const [healthPercent, setHealthPercent] = useState(100);
  const [loadedAmmo, setLoadedAmmo] = useState(stats.clipSize);
  const [totalAmmo, setTotalAmmo] = useState(stats.maxReserve);
  const [fragGrenades, setFragGrenades] = useState(4);
  const [plasmaGrenades, setPlasmaGrenades] = useState(4);
  const [isZoomed, setIsZoomed] = useState(false);
  const [overheatPercent, setOverheatPercent] = useState(0);
  const [radarAngle, setRadarAngle] = useState(0);

  // Weapon Firing simulation
  const handleFire = () => {
    if (stats.hasHeat) {
      if (overheatPercent < 100) {
        setOverheatPercent((prev) => Math.min(100, prev + 12));
        setLoadedAmmo((prev) => Math.max(0, prev - 1));
      }
    } else if (loadedAmmo > 0) {
      setLoadedAmmo((prev) => prev - 1);
    }
  };

  const handleReload = () => {
    if (stats.hasHeat) {
      setOverheatPercent(0);
      return;
    }
    const needed = stats.clipSize - loadedAmmo;
    const available = Math.min(needed, totalAmmo);
    setLoadedAmmo((prev) => prev + available);
    setTotalAmmo((prev) => prev - available);
  };

  // Overheat decay & Radar sweep tick
  useEffect(() => {
    const timer = setInterval(() => {
      setOverheatPercent((prev) => Math.max(0, prev - 4));
      setRadarAngle((prev) => (prev + 0.08) % (Math.PI * 2));
    }, 50);
    return () => clearInterval(timer);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'f' || e.key === 'F') {
      handleFire();
    } else if (e.key === 'r' || e.key === 'R') {
      handleReload();
    } else if (e.key === 'z' || e.key === 'Z') {
      setIsZoomed((prev) => !prev);
    }
  };

  const getTintColor = useCallback((): { primary: string; glow: string; background: string } => {
    switch (hudTint) {
      case 'plasma_green':
        return { primary: '#34d399', glow: 'rgba(52, 211, 153, 0.4)', background: 'rgba(52, 211, 153, 0.15)' };
      case 'covenant_purple':
        return { primary: '#c084fc', glow: 'rgba(192, 132, 252, 0.4)', background: 'rgba(192, 132, 252, 0.15)' };
      case 'alert_red':
        return { primary: '#f87171', glow: 'rgba(248, 113, 113, 0.4)', background: 'rgba(248, 113, 113, 0.15)' };
      case 'needler_pink':
        return { primary: '#f472b6', glow: 'rgba(244, 114, 182, 0.4)', background: 'rgba(244, 114, 182, 0.15)' };
      case 'default_blue':
      default:
        return { primary: '#38bdf8', glow: 'rgba(56, 189, 248, 0.4)', background: 'rgba(56, 189, 248, 0.15)' };
    }
  }, [hudTint]);

  // Render authentic HUD on 2D Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const tint = getTintColor();

    // Base coordinate system scale (virtual 640x480 space)
    const scale = height / 480;

    // 1. First-person Background Viewport Scene
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, width, height);

    const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0, '#091322');
    skyGrad.addColorStop(0.55, '#121f35');
    skyGrad.addColorStop(1, '#070b14');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);

    // Subtle horizon terrain line
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.58);
    ctx.lineTo(width, height * 0.58);
    ctx.stroke();

    // 2. Safe Frames (80% Title Safe, 90% Action Safe)
    if (showSafeFrames) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      const asW = width * 0.9;
      const asH = height * 0.9;
      ctx.strokeRect((width - asW) / 2, (height - asH) / 2, asW, asH);

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      const tsW = width * 0.8;
      const tsH = height * 0.8;
      ctx.strokeRect((width - tsW) / 2, (height - tsH) / 2, tsW, tsH);
      ctx.setLineDash([]);
    }

    // 3. Crosshair Center Calculation (Lowered 58.3% classic vs Centered 50%)
    const cx = width / 2;
    const cy = crosshairMode === 'lowered' ? height * 0.583 : height * 0.5;

    if (showCrosshairGuide) {
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 20);
      ctx.lineTo(cx, cy + 20);
      ctx.moveTo(cx - 20, cy);
      ctx.lineTo(cx + 20, cy);
      ctx.stroke();
    }

    // 4. Weapon Reticle Rendering
    if (isZoomed) {
      // Zoom Overlay
      ctx.strokeStyle = tint.primary;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, 140 * scale, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 145 * scale, 0, Math.PI * 2);
      ctx.stroke();

      // Zoom level text
      ctx.font = `bold ${Math.round(12 * scale)}px monospace`;
      ctx.fillStyle = tint.primary;
      ctx.textAlign = 'center';
      ctx.fillText(stats.type === 'sniper' ? '10.0X' : '2.0X', cx, cy - 155 * scale);
    }

    ctx.strokeStyle = tint.primary;
    ctx.fillStyle = tint.primary;

    if (stats.type === 'ar') {
      // Assault Rifle circular spread reticle
      const arRadius = 24 * scale;
      ctx.lineWidth = 1.8 * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, arRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Cardinal tick marks
      const tick = 6 * scale;
      ctx.beginPath();
      ctx.moveTo(cx - arRadius - tick, cy);
      ctx.lineTo(cx - arRadius + tick, cy);
      ctx.moveTo(cx + arRadius - tick, cy);
      ctx.lineTo(cx + arRadius + tick, cy);
      ctx.moveTo(cx, cy - arRadius - tick);
      ctx.lineTo(cx, cy - arRadius + tick);
      ctx.moveTo(cx, cy + arRadius - tick);
      ctx.lineTo(cx, cy + arRadius + tick);
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(cx, cy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'pistol') {
      // M6D Pistol 3-notch box reticle
      const rW = 16 * scale;
      const rH = 14 * scale;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      // Left bracket
      ctx.moveTo(cx - rW, cy - rH);
      ctx.lineTo(cx - rW, cy + rH);
      // Right bracket
      ctx.moveTo(cx + rW, cy - rH);
      ctx.lineTo(cx + rW, cy + rH);
      // Bottom notch
      ctx.moveTo(cx - 6 * scale, cy + rH);
      ctx.lineTo(cx + 6 * scale, cy + rH);
      ctx.stroke();

      // Center aim dot
      ctx.beginPath();
      ctx.arc(cx, cy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'shotgun') {
      // Shotgun wide circular reticle
      const rRadius = 36 * scale;
      ctx.lineWidth = 2 * scale;
      // 4 segmented arcs
      for (let a = 0; a < 4; a++) {
        const start = (a * Math.PI) / 2 + 0.18;
        const end = ((a + 1) * Math.PI) / 2 - 0.18;
        ctx.beginPath();
        ctx.arc(cx, cy, rRadius, start, end);
        ctx.stroke();
      }
      // Center dot
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'sniper') {
      // Sniper rifle precision crosshair
      ctx.lineWidth = 1.5 * scale;
      const span = 45 * scale;
      ctx.beginPath();
      ctx.moveTo(cx - span, cy);
      ctx.lineTo(cx + span, cy);
      ctx.moveTo(cx, cy - span);
      ctx.lineTo(cx, cy + span);
      ctx.stroke();

      // Ballistic mil-dots
      for (let d = 1; d <= 3; d++) {
        const dist = d * 12 * scale;
        ctx.beginPath();
        ctx.arc(cx - dist, cy, 1.5 * scale, 0, Math.PI * 2);
        ctx.arc(cx + dist, cy, 1.5 * scale, 0, Math.PI * 2);
        ctx.arc(cx, cy + dist, 1.5 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (stats.type === 'plasma_rifle' || stats.type === 'plasma_pistol') {
      // Plasma dual split curved brackets
      const prR = 20 * scale;
      ctx.lineWidth = 2.5 * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, prR, Math.PI * 0.65, Math.PI * 1.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, prR, -Math.PI * 0.35, Math.PI * 0.35);
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(cx, cy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'rocket') {
      // Rocket launcher box brackets
      const bSize = 22 * scale;
      ctx.lineWidth = 2 * scale;
      ctx.strokeRect(cx - bSize, cy - bSize, bSize * 2, bSize * 2);
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'needler') {
      // Needler diamond reticle
      const dSize = 18 * scale;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(cx, cy - dSize);
      ctx.lineTo(cx + dSize, cy);
      ctx.lineTo(cx, cy + dSize);
      ctx.lineTo(cx - dSize, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Generic aim crosshair
      const rSize = 16 * scale;
      const rGap = 8 * scale;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(cx - rGap - rSize, cy);
      ctx.lineTo(cx - rGap, cy);
      ctx.moveTo(cx + rGap, cy);
      ctx.lineTo(cx + rGap + rSize, cy);
      ctx.moveTo(cx, cy - rGap - rSize);
      ctx.lineTo(cx, cy - rGap);
      ctx.moveTo(cx, cy + rGap);
      ctx.lineTo(cx, cy + rGap + rSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Shield & Health Bars (Top-Center)
    const barW = 200 * scale;
    const barH = 8 * scale;
    const barX = (width - barW) / 2;
    const barY = 22 * scale;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.strokeStyle = tint.primary;
    ctx.lineWidth = 1.2 * scale;
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.fillRect(barX, barY, barW, barH);

    const shieldFillW = (barW * shieldPercent) / 100;
    const isShieldLow = shieldPercent <= 25;
    ctx.fillStyle = isShieldLow ? '#f43f5e' : tint.primary;
    ctx.fillRect(barX, barY, shieldFillW, barH);

    // Health segments (under shield)
    const healthY = barY + barH + 3 * scale;
    const numHealthSegments = 8;
    const segGap = 2 * scale;
    const segW = (barW - (numHealthSegments - 1) * segGap) / numHealthSegments;
    const activeSegments = Math.round((numHealthSegments * healthPercent) / 100);

    for (let s = 0; s < numHealthSegments; s++) {
      const segX = barX + s * (segW + segGap);
      ctx.fillStyle = s < activeSegments ? '#ef4444' : 'rgba(30, 41, 59, 0.7)';
      ctx.fillRect(segX, healthY, segW, 5 * scale);
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 0.8 * scale;
      ctx.strokeRect(segX, healthY, segW, 5 * scale);
    }

    // 6. Ammo Counter / Battery Gauge (Top-Right)
    const ammoX = width - 110 * scale;
    const ammoY = 44 * scale;

    if (stats.hasHeat) {
      // Battery / Heat percentage display
      ctx.textAlign = 'right';
      ctx.font = `bold ${Math.round(24 * scale)}px monospace`;
      ctx.fillStyle = overheatPercent >= 80 ? '#f43f5e' : tint.primary;
      ctx.fillText(`${loadedAmmo}%`, ammoX, ammoY);

      ctx.font = `${Math.round(10 * scale)}px sans-serif`;
      ctx.fillStyle = 'var(--text-dim, #94a3b8)';
      ctx.fillText('BATTERY', ammoX, ammoY + 14 * scale);

      // Overheat warning meter
      if (overheatPercent > 0) {
        const heatW = 70 * scale;
        const heatX = ammoX - heatW;
        const heatY = ammoY + 20 * scale;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1 * scale;
        ctx.strokeRect(heatX, heatY, heatW, 4 * scale);
        ctx.fillStyle = overheatPercent >= 80 ? '#ef4444' : '#f59e0b';
        ctx.fillRect(heatX, heatY, (heatW * overheatPercent) / 100, 4 * scale);
      }
    } else {
      ctx.textAlign = 'right';
      ctx.font = `bold ${Math.round(26 * scale)}px monospace`;
      ctx.fillStyle = loadedAmmo <= 5 ? '#f43f5e' : tint.primary;
      ctx.fillText(loadedAmmo.toString().padStart(2, '0'), ammoX, ammoY);

      ctx.font = `${Math.round(15 * scale)}px monospace`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(`/${totalAmmo}`, ammoX + 42 * scale, ammoY);

      ctx.font = `${Math.round(10 * scale)}px sans-serif`;
      ctx.fillStyle = 'var(--text-dim, #94a3b8)';
      ctx.fillText(stats.name.toUpperCase(), ammoX + 42 * scale, ammoY + 15 * scale);
    }

    // 7. Grenade Inventory (Top-Left)
    const grenX = 40 * scale;
    const grenY = 38 * scale;
    ctx.fillStyle = tint.primary;
    ctx.font = `bold ${Math.round(13 * scale)}px monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(`FRAG: ${fragGrenades}`, grenX, grenY);
    ctx.fillText(`PLAS: ${plasmaGrenades}`, grenX, grenY + 16 * scale);

    // 8. Motion Sensor / Radar (Bottom-Left)
    const radarRadius = 48 * scale;
    const radarX = 72 * scale;
    const radarY = height - 72 * scale;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = tint.primary;
    ctx.lineWidth = 1.2 * scale;
    ctx.stroke();

    // Radar grid range circles (15m, 25m)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarRadius * 0.5, 0, Math.PI * 2);
    ctx.moveTo(radarX - radarRadius, radarY);
    ctx.lineTo(radarX + radarRadius, radarY);
    ctx.moveTo(radarX, radarY - radarRadius);
    ctx.lineTo(radarX, radarY + radarRadius);
    ctx.stroke();

    // Sweeping sensor line
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.moveTo(radarX, radarY);
    ctx.lineTo(radarX + Math.cos(radarAngle) * radarRadius, radarY + Math.sin(radarAngle) * radarRadius);
    ctx.stroke();

    // Player position
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(radarX, radarY, 2.5 * scale, 0, Math.PI * 2);
    ctx.fill();

    // Friendly blip
    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.arc(radarX + 18 * scale, radarY - 12 * scale, 2.5 * scale, 0, Math.PI * 2);
    ctx.fill();

    // Enemy blip
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(radarX - 24 * scale, radarY + 15 * scale, 2.5 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `${Math.round(8 * scale)}px sans-serif`;
    ctx.fillStyle = tint.primary;
    ctx.textAlign = 'center';
    ctx.fillText('MOTION SENSOR', radarX, radarY + radarRadius + 12 * scale);
  }, [
    aspectRatio,
    crosshairMode,
    showSafeFrames,
    showCrosshairGuide,
    getTintColor,
    shieldPercent,
    healthPercent,
    loadedAmmo,
    totalAmmo,
    fragGrenades,
    plasmaGrenades,
    isZoomed,
    overheatPercent,
    radarAngle,
    stats,
  ]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="hud-previewer-dialog"
      tabIndex={-1}
      ref={shellRef}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1050,
        backdropFilter: 'blur(5px)',
      }}
    >
      <div
        style={{
          width: '980px',
          maxWidth: '96vw',
          maxHeight: '94vh',
          background: 'var(--bg-canvas, #0f172a)',
          color: 'var(--text-primary, #f8fafc)',
          borderRadius: 8,
          border: '1px solid var(--border, #334155)',
          boxShadow: '0 25px 30px -5px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            borderBottom: '1px solid var(--border, #334155)',
            background: 'var(--bg-panel, #1e293b)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>🎯</span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>WYSIWYG HUD Previewer</span>
            <span
              style={{
                color: 'var(--text-dim, #94a3b8)',
                fontSize: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 480,
              }}
              title={tag.path}
            >
              {tag.path} ({stats.name})
            </span>
          </div>
          <button
            data-testid="hud-previewer-close"
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim, #94a3b8)',
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            ×
          </button>
        </div>

        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            padding: '8px 18px',
            background: 'var(--bg-sub, #131c2e)',
            borderBottom: '1px solid var(--border, #334155)',
            fontSize: 12,
          }}
        >
          {/* Aspect Ratio */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Aspect:</span>
            <button
              onClick={() => setAspectRatio('16:9')}
              style={{
                padding: '2px 8px',
                background: aspectRatio === '16:9' ? 'var(--accent-cyan, #38bdf8)' : '#1e293b',
                color: aspectRatio === '16:9' ? '#041d2f' : '#f8fafc',
                border: '1px solid #334155',
                borderRadius: 3,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              16:9
            </button>
            <button
              onClick={() => setAspectRatio('4:3')}
              style={{
                padding: '2px 8px',
                background: aspectRatio === '4:3' ? 'var(--accent-cyan, #38bdf8)' : '#1e293b',
                color: aspectRatio === '4:3' ? '#041d2f' : '#f8fafc',
                border: '1px solid #334155',
                borderRadius: 3,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              4:3
            </button>
          </div>

          {/* Crosshair Position */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Crosshair:</span>
            <button
              onClick={() => setCrosshairMode('lowered')}
              style={{
                padding: '2px 8px',
                background: crosshairMode === 'lowered' ? 'var(--accent-cyan, #38bdf8)' : '#1e293b',
                color: crosshairMode === 'lowered' ? '#041d2f' : '#f8fafc',
                border: '1px solid #334155',
                borderRadius: 3,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Classic Halo CE lowered crosshair position (58.3%)"
            >
              Classic (58%)
            </button>
            <button
              onClick={() => setCrosshairMode('centered')}
              style={{
                padding: '2px 8px',
                background: crosshairMode === 'centered' ? 'var(--accent-cyan, #38bdf8)' : '#1e293b',
                color: crosshairMode === 'centered' ? '#041d2f' : '#f8fafc',
                border: '1px solid #334155',
                borderRadius: 3,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Centered crosshair position (50% PC/MCC)"
            >
              Centered (50%)
            </button>
          </div>

          {/* Color Tint Presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Tint:</span>
            <select
              value={hudTint}
              onChange={(e) => setHudTint(e.target.value as HudColorPreset)}
              style={{
                background: '#0b0f19',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: 3,
                padding: '2px 6px',
                fontSize: 11,
              }}
            >
              <option value="default_blue">Halo Cyan</option>
              <option value="plasma_green">Plasma Green</option>
              <option value="covenant_purple">Covenant Purple</option>
              <option value="alert_red">Alert Red</option>
              <option value="needler_pink">Needler Pink</option>
            </select>
          </div>

          {/* Overlays */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showSafeFrames}
              onChange={(e) => setShowSafeFrames(e.target.checked)}
            />
            Safe Frames
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showCrosshairGuide}
              onChange={(e) => setShowCrosshairGuide(e.target.checked)}
            />
            Center Guide
          </label>
          {stats.canZoom && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isZoomed}
                onChange={(e) => setIsZoomed(e.target.checked)}
              />
              Zoom Overlay
            </label>
          )}
        </div>

        {/* Dialog Body */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            overflowY: 'auto',
            gap: 16,
          }}
        >
          {/* HUD Viewport Canvas */}
          <div
            style={{
              position: 'relative',
              width: aspectRatio === '16:9' ? 840 : 640,
              height: 472,
              boxShadow: '0 10px 20px rgba(0, 0, 0, 0.7)',
              borderRadius: 6,
              overflow: 'hidden',
              border: '2px solid #334155',
            }}
          >
            <canvas
              ref={canvasRef}
              width={aspectRatio === '16:9' ? 840 : 640}
              height={472}
              style={{ display: 'block', width: '100%', height: '100%' }}
            />
          </div>

          {/* Interactive Simulation Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: aspectRatio === '16:9' ? 840 : 640,
              padding: '10px 14px',
              background: 'var(--bg-sub, #131c2e)',
              border: '1px solid var(--border, #334155)',
              borderRadius: 6,
              fontSize: 12,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            {/* Firing & Reload */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={handleFire}
                style={{
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  padding: '5px 12px',
                  borderRadius: 4,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                title="Fire Weapon (F)"
              >
                Fire (F)
              </button>
              <button
                onClick={handleReload}
                style={{
                  background: '#0ea5e9',
                  color: '#fff',
                  border: 'none',
                  padding: '5px 12px',
                  borderRadius: 4,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                title="Reload Weapon (R)"
              >
                Reload (R)
              </button>
              {stats.canZoom && (
                <button
                  onClick={() => setIsZoomed((prev) => !prev)}
                  style={{
                    background: '#8b5cf6',
                    color: '#fff',
                    border: 'none',
                    padding: '5px 12px',
                    borderRadius: 4,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  title="Toggle Zoom (Z)"
                >
                  Zoom (Z)
                </button>
              )}
            </div>

            {/* Shield Slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Shield:</span>
              <input
                type="range"
                min="0"
                max="100"
                value={shieldPercent}
                onChange={(e) => setShieldPercent(Number(e.target.value))}
                style={{ width: 80, accentColor: '#38bdf8' }}
              />
              <span style={{ width: 28, textAlign: 'right', fontFamily: 'monospace' }}>{shieldPercent}%</span>
            </div>

            {/* Health Slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Health:</span>
              <input
                type="range"
                min="0"
                max="100"
                value={healthPercent}
                onChange={(e) => setHealthPercent(Number(e.target.value))}
                style={{ width: 80, accentColor: '#ef4444' }}
              />
              <span style={{ width: 28, textAlign: 'right', fontFamily: 'monospace' }}>{healthPercent}%</span>
            </div>

            {/* Grenades */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Frag:</span>
              <input
                type="number"
                min="0"
                max="4"
                value={fragGrenades}
                onChange={(e) => setFragGrenades(Number(e.target.value))}
                style={{ width: 38, background: '#0b0f19', color: '#fff', border: '1px solid #334155', borderRadius: 3, padding: 2 }}
              />
              <span style={{ color: 'var(--text-dim, #94a3b8)', marginLeft: 4 }}>Plasma:</span>
              <input
                type="number"
                min="0"
                max="4"
                value={plasmaGrenades}
                onChange={(e) => setPlasmaGrenades(Number(e.target.value))}
                style={{ width: 38, background: '#0b0f19', color: '#fff', border: '1px solid #334155', borderRadius: 3, padding: 2 }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

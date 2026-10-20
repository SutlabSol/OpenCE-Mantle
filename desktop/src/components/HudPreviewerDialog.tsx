import { useState, useRef, useEffect, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';

interface Props {
  tag: TagEntrySummary;
  onClose: () => void;
}

export type HudAspectRatio = '16:9' | '4:3';
export type HudColorPreset = 'default_blue' | 'plasma_green' | 'covenant_purple' | 'alert_red';

export default function HudPreviewerDialog({ tag, onClose }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Canvas Settings
  const [aspectRatio, setAspectRatio] = useState<HudAspectRatio>('16:9');
  const [showSafeFrames, setShowSafeFrames] = useState(true);
  const [showCrosshairGuide, setShowCrosshairGuide] = useState(true);
  const [hudTint, setHudTint] = useState<HudColorPreset>('default_blue');

  // Interactive Live HUD Simulation State
  const [shieldPercent, setShieldPercent] = useState(100);
  const [healthPercent, setHealthPercent] = useState(100);
  const [loadedAmmo, setLoadedAmmo] = useState(60);
  const [totalAmmo, setTotalAmmo] = useState(540);
  const [fragGrenades, setFragGrenades] = useState(4);
  const [plasmaGrenades, setPlasmaGrenades] = useState(4);
  const [isZoomed, setIsZoomed] = useState(false);
  const [overheatPercent, setOverheatPercent] = useState(0);

  // Weapon Firing simulation
  const handleFire = () => {
    if (loadedAmmo > 0) {
      setLoadedAmmo((prev) => prev - 1);
      setOverheatPercent((prev) => Math.min(100, prev + 8));
    }
  };

  const handleReload = () => {
    const needed = 60 - loadedAmmo;
    const available = Math.min(needed, totalAmmo);
    setLoadedAmmo((prev) => prev + available);
    setTotalAmmo((prev) => prev - available);
  };

  // Overheat decay tick
  useEffect(() => {
    const timer = setInterval(() => {
      setOverheatPercent((prev) => Math.max(0, prev - 4));
    }, 200);
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
      case 'default_blue':
      default:
        return { primary: '#38bdf8', glow: 'rgba(56, 189, 248, 0.4)', background: 'rgba(56, 189, 248, 0.15)' };
    }
  }, [hudTint]);

  // Render HUD on 2D Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const tint = getTintColor();

    // 1. Background scene (simulated viewport)
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, width, height);

    // Subtle horizon gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0, '#0c1527');
    skyGrad.addColorStop(0.6, '#0f172a');
    skyGrad.addColorStop(1, '#050a14');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Safe Frames (80% Title Safe, 90% Action Safe)
    if (showSafeFrames) {
      // Action Safe (90%)
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      const asW = width * 0.9;
      const asH = height * 0.9;
      ctx.strokeRect((width - asW) / 2, (height - asH) / 2, asW, asH);

      // Title Safe (80%)
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      const tsW = width * 0.8;
      const tsH = height * 0.8;
      ctx.strokeRect((width - tsW) / 2, (height - tsH) / 2, tsW, tsH);
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.font = '9px sans-serif';
      ctx.fillText('Action Safe (90%)', (width - asW) / 2 + 4, (height - asH) / 2 + 12);
      ctx.fillText('Title Safe (80%)', (width - tsW) / 2 + 4, (height - tsH) / 2 + 12);
    }

    // 3. Center Guide
    if (showCrosshairGuide) {
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width / 2, height / 2 - 20);
      ctx.lineTo(width / 2, height / 2 + 20);
      ctx.moveTo(width / 2 - 20, height / 2);
      ctx.lineTo(width / 2 + 20, height / 2);
      ctx.stroke();
    }

    // 4. Center Reticle & Crosshair
    const cx = width / 2;
    const cy = height / 2;

    if (isZoomed) {
      // 2x Zoom Overlay
      ctx.strokeStyle = tint.primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 140, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 145, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = '12px monospace';
      ctx.fillStyle = tint.primary;
      ctx.textAlign = 'center';
      ctx.fillText('2.0X', cx, cy - 155);
    }

    // Aim Crosshair brackets
    ctx.strokeStyle = tint.primary;
    ctx.lineWidth = 2;
    const rSize = 16;
    const rGap = 8;

    // Left bracket
    ctx.beginPath();
    ctx.moveTo(cx - rGap - rSize, cy);
    ctx.lineTo(cx - rGap, cy);
    ctx.stroke();

    // Right bracket
    ctx.beginPath();
    ctx.moveTo(cx + rGap, cy);
    ctx.lineTo(cx + rGap + rSize, cy);
    ctx.stroke();

    // Top bracket
    ctx.beginPath();
    ctx.moveTo(cx, cy - rGap - rSize);
    ctx.lineTo(cx, cy - rGap);
    ctx.stroke();

    // Bottom bracket
    ctx.beginPath();
    ctx.moveTo(cx, cy + rGap);
    ctx.lineTo(cx, cy + rGap + rSize);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = tint.primary;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();

    // 5. Shield & Health Bars (Top-Center)
    const barW = 240;
    const barH = 10;
    const barX = (width - barW) / 2;
    const barY = 32;

    // Shield Bar background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.strokeStyle = tint.primary;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.fillRect(barX, barY, barW, barH);

    // Shield Fill
    const shieldFillW = (barW * shieldPercent) / 100;
    const isShieldLow = shieldPercent <= 25;
    ctx.fillStyle = isShieldLow ? '#f43f5e' : tint.primary;
    ctx.fillRect(barX, barY, shieldFillW, barH);

    // Health segments (under shield)
    const healthY = barY + barH + 4;
    const numHealthSegments = 8;
    const segGap = 3;
    const segW = (barW - (numHealthSegments - 1) * segGap) / numHealthSegments;
    const activeSegments = Math.round((numHealthSegments * healthPercent) / 100);

    for (let s = 0; s < numHealthSegments; s++) {
      const segX = barX + s * (segW + segGap);
      ctx.fillStyle = s < activeSegments ? '#ef4444' : 'rgba(30, 41, 59, 0.7)';
      ctx.fillRect(segX, healthY, segW, 6);
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 1;
      ctx.strokeRect(segX, healthY, segW, 6);
    }

    // Shield / Health Label
    ctx.font = '10px sans-serif';
    ctx.fillStyle = tint.primary;
    ctx.textAlign = 'center';
    ctx.fillText('SHIELD', barX + barW / 2, barY - 4);

    // 6. Ammo Counter (Top-Right)
    const ammoX = width - 110;
    const ammoY = 50;

    ctx.textAlign = 'right';
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = loadedAmmo <= 10 ? '#f43f5e' : tint.primary;
    ctx.fillText(loadedAmmo.toString().padStart(2, '0'), ammoX, ammoY);

    ctx.font = '16px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(`/${totalAmmo}`, ammoX + 48, ammoY);

    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'var(--text-dim, #94a3b8)';
    ctx.fillText('AMMO', ammoX + 48, ammoY + 16);

    // Overheat Bar (if weapon generates heat)
    if (overheatPercent > 0) {
      const heatW = 80;
      const heatX = ammoX - 32;
      const heatY = ammoY + 22;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillRect(heatX, heatY, heatW, 6);
      ctx.fillStyle = overheatPercent > 80 ? '#f43f5e' : '#fbbf24';
      ctx.fillRect(heatX, heatY, (heatW * overheatPercent) / 100, 6);
      ctx.strokeStyle = '#334155';
      ctx.strokeRect(heatX, heatY, heatW, 6);
    }

    // 7. Grenades (Top-Left)
    const grenX = 60;
    const grenY = 44;

    ctx.fillStyle = tint.primary;
    ctx.font = '14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`FRAG: ${fragGrenades}`, grenX, grenY);
    ctx.fillText(`PLAS: ${plasmaGrenades}`, grenX, grenY + 18);

    // 8. Motion Sensor / Radar (Bottom-Left)
    const radarRadius = 55;
    const radarX = 90;
    const radarY = height - 90;

    // Radar ring
    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = tint.primary;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Radar grid lines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarRadius * 0.5, 0, Math.PI * 2);
    ctx.moveTo(radarX - radarRadius, radarY);
    ctx.lineTo(radarX + radarRadius, radarY);
    ctx.moveTo(radarX, radarY - radarRadius);
    ctx.lineTo(radarX, radarY + radarRadius);
    ctx.stroke();

    // Player position
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(radarX, radarY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Friendly blip
    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.arc(radarX + 22, radarY - 14, 3, 0, Math.PI * 2);
    ctx.fill();

    // Enemy blip
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(radarX - 30, radarY + 18, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '9px sans-serif';
    ctx.fillStyle = tint.primary;
    ctx.textAlign = 'center';
    ctx.fillText('NAV', radarX, radarY + radarRadius + 14);
  }, [
    aspectRatio,
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
              {tag.path}
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
            </select>
          </div>

          {/* Overlays */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showSafeFrames}
              onChange={(e) => setShowSafeFrames(e.target.checked)}
            />
            Safe Frames (80/90)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showCrosshairGuide}
              onChange={(e) => setShowCrosshairGuide(e.target.checked)}
            />
            Center Crosshair Guide
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isZoomed}
              onChange={(e) => setIsZoomed(e.target.checked)}
            />
            2x Zoom Overlay
          </label>
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
              width: '100%',
              maxWidth: 840,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              background: 'var(--bg-panel, #1e293b)',
              padding: '12px 16px',
              borderRadius: 6,
              border: '1px solid var(--border, #334155)',
              alignItems: 'center',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Shield:</span>
              <input
                type="range"
                min="0"
                max="100"
                value={shieldPercent}
                onChange={(e) => setShieldPercent(parseInt(e.target.value, 10))}
                style={{ width: 80 }}
              />
              <span>{shieldPercent}%</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Health:</span>
              <input
                type="range"
                min="0"
                max="100"
                value={healthPercent}
                onChange={(e) => setHealthPercent(parseInt(e.target.value, 10))}
                style={{ width: 80 }}
              />
              <span>{healthPercent}%</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                data-testid="hud-fire-btn"
                onClick={handleFire}
                style={{
                  padding: '4px 10px',
                  background: '#f43f5e',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Fire Weapon (F)
              </button>
              <button
                data-testid="hud-reload-btn"
                onClick={handleReload}
                style={{
                  padding: '4px 10px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Reload (R)
              </button>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, color: 'var(--text-dim, #94a3b8)' }}>
              <span>Frags: {fragGrenades}</span>
              <span>Plasmas: {plasmaGrenades}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

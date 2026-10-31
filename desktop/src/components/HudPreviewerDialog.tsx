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

interface LinkedHudBitmap {
  fieldPath: string;
  path: string;
  tagId: number;
  width: number;
  height: number;
  dataUrl: string;
}

function detectWeaponStats(path: string): WeaponStats {
  const p = path.toLowerCase();
  if (p.includes('assault rifle') || p.includes('assault_rifle') || p.endsWith('\\ar')) {
    return { name: 'MA5B Assault Rifle', type: 'ar', clipSize: 60, maxReserve: 600, hasHeat: false, canZoom: false, defaultTint: 'default_blue' };
  }
  if (p.includes('plasma pistol') || p.includes('plasma_pistol')) {
    return { name: 'Type-25 Plasma Pistol', type: 'plasma_pistol', clipSize: 100, maxReserve: 100, hasHeat: true, canZoom: false, defaultTint: 'default_blue' };
  }
  if (p.includes('plasma rifle') || p.includes('plasma_rifle') || p.includes('master plasma')) {
    return { name: 'Type-25 Plasma Rifle', type: 'plasma_rifle', clipSize: 100, maxReserve: 100, hasHeat: true, canZoom: false, defaultTint: 'default_blue' };
  }
  if (p.includes('pistol') || p.includes('magnum')) {
    return { name: 'M6D Magnum Pistol', type: 'pistol', clipSize: 12, maxReserve: 120, hasHeat: false, canZoom: true, defaultTint: 'default_blue' };
  }
  if (p.includes('shotgun')) {
    return { name: 'M90 Shotgun', type: 'shotgun', clipSize: 12, maxReserve: 60, hasHeat: false, canZoom: false, defaultTint: 'default_blue' };
  }
  if (p.includes('sniper')) {
    return { name: 'SRS99C-S2 AM Sniper Rifle', type: 'sniper', clipSize: 4, maxReserve: 24, hasHeat: false, canZoom: true, defaultTint: 'default_blue' };
  }
  if (p.includes('rocket') || p.includes('rocket_launcher')) {
    return { name: 'M19 SSM Rocket Launcher', type: 'rocket', clipSize: 2, maxReserve: 8, hasHeat: false, canZoom: true, defaultTint: 'default_blue' };
  }
  if (p.includes('needler')) {
    return { name: 'Type-33 Needler', type: 'needler', clipSize: 20, maxReserve: 80, hasHeat: false, canZoom: false, defaultTint: 'default_blue' };
  }
  return { name: 'UNSC Combat Weapon', type: 'ar', clipSize: 60, maxReserve: 600, hasHeat: false, canZoom: false, defaultTint: 'default_blue' };
}

export default function HudPreviewerDialog({ tag, onClose }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const initialStats = detectWeaponStats(tag.path);
  const [weaponPreset, setWeaponPreset] = useState<WeaponStats['type']>(initialStats.type);

  const stats: WeaponStats = React.useMemo(() => {
    switch (weaponPreset) {
      case 'ar':
        return { name: 'MA5B Assault Rifle', type: 'ar', clipSize: 60, maxReserve: 600, hasHeat: false, canZoom: false, defaultTint: 'default_blue' };
      case 'pistol':
        return { name: 'M6D Magnum Pistol', type: 'pistol', clipSize: 12, maxReserve: 120, hasHeat: false, canZoom: true, defaultTint: 'default_blue' };
      case 'shotgun':
        return { name: 'M90 Shotgun', type: 'shotgun', clipSize: 12, maxReserve: 60, hasHeat: false, canZoom: false, defaultTint: 'default_blue' };
      case 'sniper':
        return { name: 'SRS99C-S2 AM Sniper', type: 'sniper', clipSize: 4, maxReserve: 24, hasHeat: false, canZoom: true, defaultTint: 'default_blue' };
      case 'rocket':
        return { name: 'SPNKr Rocket Launcher', type: 'rocket', clipSize: 2, maxReserve: 8, hasHeat: false, canZoom: true, defaultTint: 'default_blue' };
      case 'plasma_rifle':
        return { name: 'Type-25 Plasma Rifle', type: 'plasma_rifle', clipSize: 100, maxReserve: 100, hasHeat: true, canZoom: false, defaultTint: 'default_blue' };
      case 'plasma_pistol':
        return { name: 'Type-25 Plasma Pistol', type: 'plasma_pistol', clipSize: 100, maxReserve: 100, hasHeat: true, canZoom: false, defaultTint: 'default_blue' };
      case 'needler':
        return { name: 'Type-33 Needler', type: 'needler', clipSize: 20, maxReserve: 80, hasHeat: false, canZoom: false, defaultTint: 'default_blue' };
      default:
        return initialStats;
    }
  }, [weaponPreset, initialStats]);

  // Canvas Settings
  const [aspectRatio, setAspectRatio] = useState<HudAspectRatio>('16:9');
  const [crosshairMode, setCrosshairMode] = useState<CrosshairMode>('centered');
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
  const [activeGrenadeType, setActiveGrenadeType] = useState<'frag' | 'plasma'>('frag');
  const [isZoomed, setIsZoomed] = useState(false);
  const [overheatPercent, setOverheatPercent] = useState(0);
  const [radarAngle, setRadarAngle] = useState(0);
  const [linkedBitmaps, setLinkedBitmaps] = useState<LinkedHudBitmap[]>([]);

  useEffect(() => {
    setLoadedAmmo(stats.clipSize);
    setTotalAmmo(stats.maxReserve);
    setOverheatPercent(0);
    setIsZoomed(false);
  }, [stats.type, stats.clipSize, stats.maxReserve]);

  // Load actual HUD bitmaps referenced by this HUD tag in the open map
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const depsRes = await window.opence.getDependencySlots(tag.index);
        if (!depsRes.ok || cancelled) return;
        const bitmSlots = depsRes.slots.filter((s) => {
          const grp = s.currentGroup ?? (s as any).group;
          const tid = s.currentTagId ?? (s as any).targetTagId;
          return grp === 'bitmap' && tid !== undefined && tid !== 0xffffffff;
        });
        const uniqueByTagId = new Map<number, typeof bitmSlots[0]>();
        for (const s of bitmSlots) {
          const tid = s.currentTagId ?? (s as any).targetTagId;
          if (!uniqueByTagId.has(tid)) uniqueByTagId.set(tid, s);
        }
        const decoded: LinkedHudBitmap[] = [];
        for (const slot of Array.from(uniqueByTagId.values()).slice(0, 8)) {
          const tid = slot.currentTagId ?? (slot as any).targetTagId;
          const tpath = slot.currentPath ?? (slot as any).targetPath ?? `0x${tid.toString(16)}`;
          const prev = await window.opence.getBitmapTexture(tid, 0);
          if (cancelled) return;
          if (prev.ok && prev.texture && prev.texture.width > 0 && prev.texture.height > 0) {
            const offCanvas = document.createElement('canvas');
            offCanvas.width = prev.texture.width;
            offCanvas.height = prev.texture.height;
            const octx = offCanvas.getContext('2d');
            if (octx) {
              const imgData = new ImageData(
                new Uint8ClampedArray(prev.texture.rgbaData),
                prev.texture.width,
                prev.texture.height,
              );
              octx.putImageData(imgData, 0, 0);
              decoded.push({
                fieldPath: slot.fieldPath.split('.').slice(-2).join('.'),
                path: tpath,
                tagId: tid,
                width: prev.texture.width,
                height: prev.texture.height,
                dataUrl: offCanvas.toDataURL(),
              });
            }
          }
        }
        if (!cancelled) setLinkedBitmaps(decoded);
      } catch {
        // Ignore if map or resource maps unavailable
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tag.index]);

  const handleFire = () => {
    if (stats.hasHeat) {
      if (overheatPercent < 100) {
        setOverheatPercent((prev) => Math.min(100, prev + 14));
        setLoadedAmmo((prev) => Math.max(0, prev - 1));
      }
    } else if (loadedAmmo > 0) {
      setLoadedAmmo((prev) => prev - 1);
    }
  };

  const handleReload = () => {
    if (stats.hasHeat) {
      setOverheatPercent(0);
      setLoadedAmmo(100);
      return;
    }
    const needed = stats.clipSize - loadedAmmo;
    const available = Math.min(needed, totalAmmo);
    setLoadedAmmo((prev) => prev + available);
    setTotalAmmo((prev) => prev - available);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setOverheatPercent((prev) => Math.max(0, prev - 3));
      setRadarAngle((prev) => (prev + 0.08) % (Math.PI * 2));
    }, 50);
    return () => clearInterval(timer);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'f' || e.key === 'F') {
      handleFire();
    } else if (e.key === 'r' || e.key === 'R') {
      handleReload();
    } else if (e.key === 'g' || e.key === 'G') {
      setActiveGrenadeType((prev) => (prev === 'frag' ? 'plasma' : 'frag'));
    } else if (e.key === 'z' || e.key === 'Z') {
      if (stats.canZoom) setIsZoomed((prev) => !prev);
    }
  };

  const getTintColor = useCallback((): { primary: string; bright: string; dim: string; glow: string; bg: string } => {
    switch (hudTint) {
      case 'plasma_green':
        return { primary: '#34d399', bright: '#a7f3d0', dim: 'rgba(52, 211, 153, 0.22)', glow: 'rgba(52, 211, 153, 0.55)', bg: 'rgba(6, 48, 35, 0.55)' };
      case 'covenant_purple':
        return { primary: '#c084fc', bright: '#e9d5ff', dim: 'rgba(192, 132, 252, 0.22)', glow: 'rgba(192, 132, 252, 0.55)', bg: 'rgba(42, 16, 68, 0.55)' };
      case 'alert_red':
        return { primary: '#f87171', bright: '#fecaca', dim: 'rgba(248, 113, 113, 0.22)', glow: 'rgba(248, 113, 113, 0.55)', bg: 'rgba(68, 14, 14, 0.55)' };
      case 'needler_pink':
        return { primary: '#f472b6', bright: '#fbcfe8', dim: 'rgba(244, 114, 182, 0.22)', glow: 'rgba(244, 114, 182, 0.55)', bg: 'rgba(68, 14, 44, 0.55)' };
      case 'default_blue':
      default:
        return { primary: '#4cc9f0', bright: '#bae6fd', dim: 'rgba(76, 201, 240, 0.2)', glow: 'rgba(76, 201, 240, 0.6)', bg: 'rgba(8, 32, 56, 0.58)' };
    }
  }, [hudTint]);

  // Render authentic Halo: Combat Evolved HUD on 2D Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const tint = getTintColor();
    const scale = height / 480;

    // ---------------------------------------------------------------------------
    // 1. Halo Ring / Blood Gulch First-Person Viewport Backdrop
    // ---------------------------------------------------------------------------
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.62);
    skyGrad.addColorStop(0, '#091526');
    skyGrad.addColorStop(0.55, '#162c46');
    skyGrad.addColorStop(1, '#27435e');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);

    // Subtle Halo installation ring band in the sky
    ctx.save();
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.12)';
    ctx.lineWidth = 22 * scale;
    ctx.beginPath();
    ctx.moveTo(width * 0.58, 0);
    ctx.quadraticCurveTo(width * 0.52, height * 0.3, width * 0.43, height * 0.58);
    ctx.stroke();
    ctx.restore();

    // Canyon walls & ground horizon
    const groundGrad = ctx.createLinearGradient(0, height * 0.56, 0, height);
    groundGrad.addColorStop(0, '#2a241e');
    groundGrad.addColorStop(0.3, '#1f261b');
    groundGrad.addColorStop(1, '#0e130e');
    ctx.fillStyle = groundGrad;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.58);
    ctx.lineTo(width * 0.22, height * 0.51);
    ctx.lineTo(width * 0.48, height * 0.57);
    ctx.lineTo(width * 0.78, height * 0.49);
    ctx.lineTo(width, height * 0.56);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    // Safe Frames
    if (showSafeFrames) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(width * 0.05, height * 0.05, width * 0.9, height * 0.9);
      ctx.strokeRect(width * 0.1, height * 0.1, width * 0.8, height * 0.8);
      ctx.setLineDash([]);
    }

    // ---------------------------------------------------------------------------
    // 2. TOP-RIGHT: Authentic Halo CE Shield Bar + 8-Wedge Health Meter
    //    (In Halo CE, Shield & Health are ALWAYS in the Top-Right corner!)
    // ---------------------------------------------------------------------------
    ctx.save();
    const trRight = width - 22 * scale;
    const trTop = 18 * scale;
    const shieldTotalW = 168 * scale;
    const shieldLeft = trRight - shieldTotalW;
    const topBarH = 15 * scale;
    const rightTabW = 64 * scale;
    const totalFrameH = 32 * scale;

    const isShieldCritical = shieldPercent <= 20;
    const shieldStroke = isShieldCritical ? '#f43f5e' : tint.primary;
    const shieldFillColor = isShieldCritical ? 'rgba(244, 63, 94, 0.85)' : tint.primary;

    // Outer stepped Halo CE shield housing polygon:
    // Top-left -> Top-right -> Bottom-right (stepped tab) -> step up -> Bottom-left of top bar
    const defineShieldPath = () => {
      ctx.beginPath();
      ctx.moveTo(shieldLeft + 6 * scale, trTop);
      ctx.lineTo(trRight - 4 * scale, trTop);
      ctx.quadraticCurveTo(trRight, trTop, trRight, trTop + 4 * scale);
      ctx.lineTo(trRight, trTop + totalFrameH - 4 * scale);
      ctx.quadraticCurveTo(trRight, trTop + totalFrameH, trRight - 4 * scale, trTop + totalFrameH);
      ctx.lineTo(trRight - rightTabW, trTop + totalFrameH);
      ctx.lineTo(trRight - rightTabW - 10 * scale, trTop + topBarH);
      ctx.lineTo(shieldLeft, trTop + topBarH);
      ctx.lineTo(shieldLeft + 6 * scale, trTop);
      ctx.closePath();
    };

    // Dark translucent backing
    defineShieldPath();
    ctx.fillStyle = tint.bg;
    ctx.fill();

    // Clipped Shield Fill (fills from right to left or left to right proportional to shieldPercent)
    if (shieldPercent > 0) {
      ctx.save();
      defineShieldPath();
      ctx.clip();
      const fillW = (shieldTotalW * shieldPercent) / 100;
      const grad = ctx.createLinearGradient(trRight - fillW, trTop, trRight, trTop);
      grad.addColorStop(0, shieldFillColor);
      grad.addColorStop(1, isShieldCritical ? '#fda4af' : tint.bright);
      ctx.fillStyle = grad;
      ctx.shadowColor = isShieldCritical ? '#f43f5e' : tint.glow;
      ctx.shadowBlur = 8 * scale;
      // Fill from the right side toward the left, matching Halo CE's shield depletion direction
      ctx.fillRect(trRight - fillW, trTop + 2 * scale, fillW - 2 * scale, totalFrameH - 4 * scale);
      ctx.restore();
    }

    // Outer glowing cyan border of the shield meter
    defineShieldPath();
    ctx.strokeStyle = shieldStroke;
    ctx.lineWidth = 1.8 * scale;
    ctx.shadowColor = isShieldCritical ? '#f43f5e' : tint.glow;
    ctx.shadowBlur = 6 * scale;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 8 Slanted Health Pips tucked directly underneath the left half of the Shield Bar
    // (In Halo CE, the 8 health bars sit in the notch under the left side of the shield bar)
    const healthAreaLeft = shieldLeft + 4 * scale;
    const healthAreaRight = trRight - rightTabW - 13 * scale;
    const healthAreaTop = trTop + topBarH + 4 * scale;
    const healthPipH = 11 * scale;
    const numHealthPips = 8;
    const pipGap = 2.5 * scale;
    const pipW = (healthAreaRight - healthAreaLeft - (numHealthPips - 1) * pipGap) / numHealthPips;
    const activeHealthPips = Math.ceil((numHealthPips * healthPercent) / 100);

    const healthColor =
      healthPercent <= 25
        ? '#ef4444'
        : healthPercent <= 50
          ? '#f59e0b'
          : tint.primary;

    for (let i = 0; i < numHealthPips; i++) {
      // Halo CE health bars deplete from left to right (rightmost bars remain closest to the shield tab)
      const isFilled = numHealthPips - i <= activeHealthPips && healthPercent > 0;
      const px = healthAreaLeft + i * (pipW + pipGap);
      const slant = 2.5 * scale;

      ctx.beginPath();
      ctx.moveTo(px + slant, healthAreaTop);
      ctx.lineTo(px + pipW + slant, healthAreaTop);
      ctx.lineTo(px + pipW, healthAreaTop + healthPipH);
      ctx.lineTo(px, healthAreaTop + healthPipH);
      ctx.closePath();

      ctx.fillStyle = isFilled ? healthColor : 'rgba(15, 23, 42, 0.55)';
      ctx.fill();
      ctx.strokeStyle = isFilled ? tint.bright : tint.dim;
      ctx.lineWidth = 1 * scale;
      ctx.stroke();
    }
    ctx.restore();

    // ---------------------------------------------------------------------------
    // 3. TOP-LEFT: Authentic Halo CE Grenade Counters + Reserve Ammo + Bullet Pip Grid
    //    (In Halo CE, Weapon Ammo, Bullet Pips, and Grenades are ALL in the Top-Left!)
    // ---------------------------------------------------------------------------
    ctx.save();
    const tlLeft = 22 * scale;
    const tlTop = 18 * scale;

    // 3A. Top-Left Grenade Bar (Frag & Plasma Grenade icons + counts)
    const drawGrenadeBox = (
      gx: number,
      gy: number,
      kind: 'frag' | 'plasma',
      count: number,
      isSelected: boolean,
    ) => {
      const boxW = 54 * scale;
      const boxH = 22 * scale;
      ctx.fillStyle = isSelected ? tint.bg : 'rgba(8, 20, 38, 0.35)';
      ctx.strokeStyle = isSelected ? tint.primary : tint.dim;
      ctx.lineWidth = (isSelected ? 1.6 : 1.0) * scale;
      ctx.beginPath();
      ctx.roundRect(gx, gy, boxW, boxH, 4 * scale);
      ctx.fill();
      ctx.stroke();

      // Grenade silhouette icon
      const icX = gx + 14 * scale;
      const icY = gy + boxH * 0.52;
      if (kind === 'frag') {
        ctx.fillStyle = isSelected ? tint.primary : 'rgba(148, 163, 184, 0.65)';
        ctx.beginPath();
        ctx.ellipse(icX, icY, 5 * scale, 6.5 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(icX - 2.5 * scale, icY - 8.5 * scale, 5 * scale, 2.5 * scale);
      } else {
        ctx.fillStyle = isSelected ? '#60a5fa' : 'rgba(96, 165, 250, 0.55)';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = isSelected ? 6 * scale : 0;
        ctx.beginPath();
        ctx.arc(icX, icY, 6 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Grenade count number
      ctx.font = `bold ${Math.round(15 * scale)}px "Orbitron", "Segoe UI", monospace`;
      ctx.fillStyle = count === 0 ? '#f43f5e' : isSelected ? tint.bright : tint.primary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(count), gx + 27 * scale, gy + boxH * 0.54);
    };

    drawGrenadeBox(tlLeft, tlTop, 'frag', fragGrenades, activeGrenadeType === 'frag');
    drawGrenadeBox(tlLeft + 60 * scale, tlTop, 'plasma', plasmaGrenades, activeGrenadeType === 'plasma');

    // 3B. Top-Left Ammo Readout & Individual Bullet Pip Grid (or Covenant Plasma Battery Meter)
    const ammoPanelTop = tlTop + 28 * scale;

    if (stats.hasHeat) {
      // Covenant Plasma Weapon Top-Left HUD: Battery Core Arc + Heat Bar + Battery %
      const panelW = 175 * scale;
      const panelH = 44 * scale;
      ctx.fillStyle = tint.bg;
      ctx.strokeStyle = tint.primary;
      ctx.lineWidth = 1.4 * scale;
      ctx.beginPath();
      ctx.roundRect(tlLeft, ammoPanelTop, panelW, panelH, 5 * scale);
      ctx.fill();
      ctx.stroke();

      // Digital Battery readout
      ctx.font = `bold ${Math.round(22 * scale)}px "Orbitron", monospace`;
      ctx.fillStyle = overheatPercent >= 85 ? '#f43f5e' : tint.bright;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(loadedAmmo).padStart(3, '0'), tlLeft + 10 * scale, ammoPanelTop + 6 * scale);

      ctx.font = `bold ${Math.round(9 * scale)}px sans-serif`;
      ctx.fillStyle = tint.primary;
      ctx.fillText('PLASMA CORE', tlLeft + 10 * scale, ammoPanelTop + 30 * scale);

      // Heat bar
      const barX = tlLeft + 74 * scale;
      const barY = ammoPanelTop + 12 * scale;
      const barW = 88 * scale;
      const barH = 12 * scale;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.strokeStyle = tint.primary;
      ctx.strokeRect(barX, barY, barW, barH);
      const heatFill = (barW * overheatPercent) / 100;
      ctx.fillStyle = overheatPercent >= 80 ? '#ef4444' : overheatPercent >= 45 ? '#f59e0b' : '#38bdf8';
      ctx.fillRect(barX, barY, heatFill, barH);
    } else {
      // UNSC / Needler Weapon Top-Left HUD:
      // Reserve Ammo Number on the left + Individual Bullet / Shell / Rocket Pips Grid!
      const rows = stats.clipSize > 20 ? 2 : 1;
      const cols = Math.ceil(stats.clipSize / rows);
      const pipW = stats.type === 'rocket' ? 28 * scale : stats.type === 'sniper' ? 14 * scale : stats.type === 'shotgun' || stats.type === 'pistol' ? 6.5 * scale : 3.4 * scale;
      const pipH = stats.type === 'rocket' ? 10 * scale : rows === 2 ? 9 * scale : 15 * scale;
      const pipGapX = stats.type === 'ar' ? 1.8 * scale : 3 * scale;
      const pipGapY = 3 * scale;

      const gridWidth = cols * pipW + (cols - 1) * pipGapX;
      const panelW = Math.max(165 * scale, 58 * scale + gridWidth + 16 * scale);
      const panelH = 42 * scale;

      // Halo CE Top-Left angled ammo bracket
      ctx.fillStyle = tint.bg;
      ctx.strokeStyle = tint.primary;
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.moveTo(tlLeft, ammoPanelTop);
      ctx.lineTo(tlLeft + panelW, ammoPanelTop);
      ctx.lineTo(tlLeft + panelW - 10 * scale, ammoPanelTop + panelH);
      ctx.lineTo(tlLeft, ammoPanelTop + panelH);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Reserve Ammo Counter (Top-Left inside ammo bracket, just like Halo CE!)
      ctx.font = `bold ${Math.round(18 * scale)}px "Orbitron", monospace`;
      ctx.fillStyle = totalAmmo === 0 && loadedAmmo === 0 ? '#f43f5e' : tint.bright;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(totalAmmo).padStart(3, '0'), tlLeft + 8 * scale, ammoPanelTop + 6 * scale);

      ctx.font = `bold ${Math.round(10 * scale)}px monospace`;
      ctx.fillStyle = loadedAmmo <= Math.ceil(stats.clipSize * 0.2) ? '#f43f5e' : tint.primary;
      ctx.fillText(`CLIP ${loadedAmmo}/${stats.clipSize}`, tlLeft + 8 * scale, ammoPanelTop + 26 * scale);

      // Individual Bullet / Shell / Rocket / Needle Pips Grid
      const gridStartX = tlLeft + 58 * scale;
      const gridStartY = ammoPanelTop + (panelH - (rows * pipH + (rows - 1) * pipGapY)) * 0.5;

      for (let i = 0; i < stats.clipSize; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const bx = gridStartX + c * (pipW + pipGapX);
        const by = gridStartY + r * (pipH + pipGapY);
        const isLoaded = i < loadedAmmo;

        ctx.fillStyle = isLoaded
          ? loadedAmmo <= Math.ceil(stats.clipSize * 0.2)
            ? '#f43f5e'
            : tint.primary
          : 'rgba(56, 189, 248, 0.16)';

        if (stats.type === 'rocket') {
          // Rocket silhouette
          ctx.beginPath();
          ctx.roundRect(bx, by, pipW, pipH, 3 * scale);
          ctx.fill();
        } else {
          // Bullet / shell pip with pointed tip
          ctx.beginPath();
          ctx.roundRect(bx, by, pipW, pipH, 1 * scale);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // ---------------------------------------------------------------------------
    // 4. BOTTOM-LEFT: Authentic Halo CE Circular Motion Tracker (Radar)
    // ---------------------------------------------------------------------------
    ctx.save();
    const radarRadius = 48 * scale;
    const radarX = 70 * scale;
    const radarY = height - 66 * scale;

    // Outer Halo CE radar ring & dark blue radar glass
    const radarGrad = ctx.createRadialGradient(radarX, radarY, 4 * scale, radarX, radarY, radarRadius);
    radarGrad.addColorStop(0, 'rgba(12, 52, 88, 0.72)');
    radarGrad.addColorStop(1, 'rgba(6, 22, 42, 0.85)');
    ctx.fillStyle = radarGrad;
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarRadius, 0, Math.PI * 2);
    ctx.fill();

    // Forward FOV cone wedge (pointing straight up = -PI/2)
    ctx.fillStyle = 'rgba(76, 201, 240, 0.14)';
    ctx.beginPath();
    ctx.moveTo(radarX, radarY);
    ctx.arc(radarX, radarY, radarRadius, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();

    // Outer ring border + inner 15m ring + crosshairs
    ctx.strokeStyle = tint.primary;
    ctx.lineWidth = 1.8 * scale;
    ctx.shadowColor = tint.glow;
    ctx.shadowBlur = 6 * scale;
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = tint.dim;
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarRadius * 0.52, 0, Math.PI * 2);
    ctx.moveTo(radarX - radarRadius, radarY);
    ctx.lineTo(radarX + radarRadius, radarY);
    ctx.moveTo(radarX, radarY - radarRadius);
    ctx.lineTo(radarX, radarY + radarRadius);
    ctx.stroke();

    // Radar sweep line
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.35)';
    ctx.lineWidth = 1.4 * scale;
    ctx.beginPath();
    ctx.moveTo(radarX, radarY);
    ctx.lineTo(radarX + Math.cos(radarAngle) * radarRadius, radarY + Math.sin(radarAngle) * radarRadius);
    ctx.stroke();

    // Center player blip (gold/amber) & Ally / Enemy blips
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(radarX, radarY, 2.8 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(radarX + 14 * scale, radarY - 16 * scale, 3 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ef4444';
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 5 * scale;
    ctx.beginPath();
    ctx.arc(radarX - 18 * scale, radarY - 22 * scale, 3.4 * scale, 0, Math.PI * 2);
    ctx.arc(radarX + 22 * scale, radarY + 12 * scale, 3.4 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Halo CE "15m" range indicator tucked at bottom-right of motion tracker
    ctx.font = `bold ${Math.round(10 * scale)}px "Orbitron", monospace`;
    ctx.fillStyle = tint.primary;
    ctx.textAlign = 'left';
    ctx.fillText('15m', radarX + radarRadius - 6 * scale, radarY + radarRadius - 2 * scale);
    ctx.restore();

    // ---------------------------------------------------------------------------
    // 5. CENTER: Authentic Halo CE Weapon Reticles & Scope Zoom Overlay
    // ---------------------------------------------------------------------------
    const cx = width / 2;
    const cy = crosshairMode === 'lowered' ? height * 0.583 : height * 0.5;

    if (showCrosshairGuide) {
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 24);
      ctx.lineTo(cx, cy + 24);
      ctx.moveTo(cx - 24, cy);
      ctx.lineTo(cx + 24, cy);
      ctx.stroke();
    }

    ctx.save();
    if (isZoomed) {
      // Darkened scope vignette outside zoom circle
      ctx.strokeStyle = tint.primary;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, 138 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 144 * scale, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = `bold ${Math.round(12 * scale)}px monospace`;
      ctx.fillStyle = tint.bright;
      ctx.textAlign = 'center';
      ctx.fillText(stats.type === 'sniper' ? '10X MAGNIFICATION' : '2X MAGNIFICATION', cx, cy + 162 * scale);
    }

    ctx.strokeStyle = tint.primary;
    ctx.fillStyle = tint.primary;
    ctx.shadowColor = tint.glow;
    ctx.shadowBlur = 4 * scale;

    if (stats.type === 'ar') {
      const arRadius = 22 * scale;
      ctx.lineWidth = 1.8 * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, arRadius, 0, Math.PI * 2);
      ctx.stroke();
      const tick = 5 * scale;
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
      ctx.beginPath();
      ctx.arc(cx, cy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'pistol') {
      const rW = 14 * scale;
      const rH = 12 * scale;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(cx - rW, cy - rH);
      ctx.lineTo(cx - rW, cy + rH);
      ctx.moveTo(cx + rW, cy - rH);
      ctx.lineTo(cx + rW, cy + rH);
      ctx.moveTo(cx - 5 * scale, cy + rH);
      ctx.lineTo(cx + 5 * scale, cy + rH);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'shotgun') {
      const rRadius = 34 * scale;
      ctx.lineWidth = 2 * scale;
      for (let a = 0; a < 4; a++) {
        const start = (a * Math.PI) / 2 + 0.18;
        const end = ((a + 1) * Math.PI) / 2 - 0.18;
        ctx.beginPath();
        ctx.arc(cx, cy, rRadius, start, end);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 2.2 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'sniper') {
      ctx.lineWidth = 1.5 * scale;
      const span = 28 * scale;
      ctx.beginPath();
      ctx.moveTo(cx - span, cy);
      ctx.lineTo(cx - 5 * scale, cy);
      ctx.moveTo(cx + 5 * scale, cy);
      ctx.lineTo(cx + span, cy);
      ctx.moveTo(cx, cy - span);
      ctx.lineTo(cx, cy - 5 * scale);
      ctx.moveTo(cx, cy + 5 * scale);
      ctx.lineTo(cx, cy + span);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 1.8 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'plasma_rifle' || stats.type === 'plasma_pistol') {
      const prR = 18 * scale;
      ctx.lineWidth = 2.2 * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, prR, Math.PI * 0.65, Math.PI * 1.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, prR, -Math.PI * 0.35, Math.PI * 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'rocket') {
      const bSize = 22 * scale;
      ctx.lineWidth = 2 * scale;
      ctx.strokeRect(cx - bSize, cy - bSize, bSize * 2, bSize * 2);
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (stats.type === 'needler') {
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
    }
    ctx.restore();
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
    activeGrenadeType,
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
          width: '1020px',
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
            padding: '10px 18px',
            borderBottom: '1px solid var(--border, #334155)',
            background: 'var(--bg-panel, #1e293b)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>🎯</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Halo CE Authentic HUD Previewer</span>
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
              <span>{tag.path}</span> ({stats.name})
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
            gap: 14,
            padding: '8px 18px',
            background: 'var(--bg-sub, #131c2e)',
            borderBottom: '1px solid var(--border, #334155)',
            fontSize: 12,
          }}
        >
          {/* Weapon HUD Preset Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Weapon HUD:</span>
            <select
              value={weaponPreset}
              onChange={(e) => setWeaponPreset(e.target.value as WeaponStats['type'])}
              style={{
                background: '#0b0f19',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: 3,
                padding: '3px 8px',
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              <option value="ar">MA5B Assault Rifle (60-Round Grid)</option>
              <option value="pistol">M6D Pistol (12-Round Strip)</option>
              <option value="shotgun">M90 Shotgun (12-Shell Strip)</option>
              <option value="sniper">Sniper Rifle (4-Round Strip)</option>
              <option value="rocket">Rocket Launcher (2-Rocket HUD)</option>
              <option value="plasma_rifle">Plasma Rifle (Battery & Heat Meter)</option>
              <option value="plasma_pistol">Plasma Pistol (Battery & Heat Meter)</option>
              <option value="needler">Needler (20-Needle Grid)</option>
            </select>
          </div>

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
            <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Reticle:</span>
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
            >
              Centered (PC)
            </button>
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
            >
              Lowered (58%)
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
              <option value="default_blue">Halo CE Cyan</option>
              <option value="plasma_green">Plasma Green</option>
              <option value="covenant_purple">Covenant Purple</option>
              <option value="alert_red">Alert Red</option>
              <option value="needler_pink">Needler Pink</option>
            </select>
          </div>

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
        </div>

        {/* Dialog Body */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: 14,
            overflowY: 'auto',
            gap: 12,
          }}
        >
          {/* HUD Viewport Canvas */}
          <div
            style={{
              position: 'relative',
              width: aspectRatio === '16:9' ? 840 : 640,
              height: 450,
              boxShadow: '0 10px 20px rgba(0, 0, 0, 0.7)',
              borderRadius: 6,
              overflow: 'hidden',
              border: '2px solid #334155',
              flexShrink: 0,
            }}
          >
            <canvas
              ref={canvasRef}
              width={aspectRatio === '16:9' ? 840 : 640}
              height={450}
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
              padding: '8px 14px',
              background: 'var(--bg-sub, #131c2e)',
              border: '1px solid var(--border, #334155)',
              borderRadius: 6,
              fontSize: 12,
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                data-testid="hud-fire-btn"
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
              >
                Fire (F)
              </button>
              <button
                data-testid="hud-reload-btn"
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
              >
                Reload (R)
              </button>
              <button
                onClick={() => setActiveGrenadeType((prev) => (prev === 'frag' ? 'plasma' : 'frag'))}
                style={{
                  background: '#334155',
                  color: '#f8fafc',
                  border: 'none',
                  padding: '5px 10px',
                  borderRadius: 4,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Switch Grenade (G)
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
                >
                  Zoom (Z)
                </button>
              )}
            </div>

            {/* Shield Slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Shield (Top-Right):</span>
              <input
                type="range"
                min="0"
                max="100"
                value={shieldPercent}
                onChange={(e) => setShieldPercent(Number(e.target.value))}
                style={{ width: 75, accentColor: '#38bdf8' }}
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
                style={{ width: 75, accentColor: '#38bdf8' }}
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
              <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Plasma:</span>
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

          {/* Decoded HUD Bitmap Sprites from the Open Map Tag */}
          {linkedBitmaps.length > 0 && (
            <div
              style={{
                width: aspectRatio === '16:9' ? 840 : 640,
                padding: '8px 12px',
                background: 'var(--bg-sub, #131c2e)',
                border: '1px solid var(--border, #334155)',
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8', marginBottom: 6 }}>
                Linked HUD Bitmap Sprites Decoded from Tag ({linkedBitmaps.length}):
              </div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                {linkedBitmaps.map((bm) => (
                  <div
                    key={bm.tagId}
                    style={{
                      background: '#090d16',
                      border: '1px solid #334155',
                      borderRadius: 4,
                      padding: 6,
                      minWidth: 110,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <img
                      src={bm.dataUrl}
                      alt={bm.path}
                      style={{ maxWidth: 96, maxHeight: 52, objectFit: 'contain' }}
                    />
                    <div style={{ fontSize: 9.5, color: '#cbd5e1', fontFamily: 'monospace', textAlign: 'center' }}>
                      {bm.path.split('\\').pop()} ({bm.width}×{bm.height})
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

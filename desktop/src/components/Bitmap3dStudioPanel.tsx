import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Paintbrush,
  SprayCan,
  Target,
  Hand,
  Sparkles,
  Stamp,
  PaintBucket,
  Minus,
  Square,
  Triangle,
  Layers,
  Scan,
  Pipette,
  Eraser,
  Move,
  Plus,
  Copy,
  ArrowDownToLine,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { ModelRenderGeometry, TagEntrySummary } from '../../electron/shared-types';

interface Props {
  allTags: TagEntrySummary[];
  onOpenTagEditor?: (tagIndexOrPath: number | string) => void;
}

type ToolKind =
  | 'orbit'
  | 'brush'
  | 'airbrush'
  | 'clone'
  | 'smudge'
  | 'blur-sharpen'
  | 'stamp'
  | 'bucket'
  | 'sharp-line'
  | 'sharp-rect'
  | 'tri-fill'
  | 'uv-island'
  | 'bbox-mask'
  | 'eyedropper'
  | 'eraser';

type BlendModeKind = 'source-over' | 'multiply' | 'overlay' | 'screen' | 'color';
type SymmetryMode = 'off' | 'x' | 'y' | 'xy';

type ItemCategory = 'vehicle' | 'weapon' | 'biped' | 'scenery' | 'equipment' | 'gbxmodel' | 'bitmap' | 'floating-bsp';

export interface FloatingBspObjectEntry {
  id: string;
  name: string;
  position: [number, number, number];
  rotationDeg: [number, number, number];
  scale: [number, number, number];
  vertices: Float32Array;
  indices: Uint32Array;
  shaderTagId: number;
  shaderPath: string;
  bitmapTagIndex: number;
  bitmapTagId: number;
  bitmapPath: string;
  textureDataUrl?: string;
  width: number;
  height: number;
}

declare global {
  interface Window {
    __openceFloatingBspObjects?: FloatingBspObjectEntry[];
  }
}

const ITEM_CATEGORIES: Array<{ id: ItemCategory; label: string }> = [
  { id: 'vehicle', label: 'Vehicles (vehicle)' },
  { id: 'weapon', label: 'Weapons (weapon)' },
  { id: 'biped', label: 'Bipeds / Characters (biped)' },
  { id: 'scenery', label: 'Scenery (scenery)' },
  { id: 'equipment', label: 'Equipment (equipment)' },
  { id: 'gbxmodel', label: '3D Models (gbxmodel)' },
  { id: 'bitmap', label: 'Bitmaps (bitmap)' },
  { id: 'floating-bsp', label: 'Floating BSP Objects (Unmerged)' },
];

interface PaintLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0..100
  blendMode: BlendModeKind;
  canvas: HTMLCanvasElement;
}

interface ShaderSlot {
  shaderTagId: number;
  shaderPath: string;
  bitmapTagIndex: number;
  bitmapTagId: number;
  bitmapPath: string;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  originalImageData: ImageData;
  threeTexture: THREE.CanvasTexture;
  layers: PaintLayer[];
  activeLayerIdx: number;
  undoStack: Array<{ layerIdx: number; imageData: ImageData }>;
  redoStack: Array<{ layerIdx: number; imageData: ImageData }>;
  dirty?: boolean;
  floatingObjectId?: string;
}

function createInitialLayersForCanvas(baseCanvas: HTMLCanvasElement, width: number, height: number): PaintLayer[] {
  const baseLayerCanvas = document.createElement('canvas');
  baseLayerCanvas.width = width;
  baseLayerCanvas.height = height;
  baseLayerCanvas.getContext('2d')!.drawImage(baseCanvas, 0, 0);

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = width;
  overlayCanvas.height = height;

  return [
    {
      id: 'layer-base',
      name: 'Base Texture',
      visible: true,
      opacity: 100,
      blendMode: 'source-over',
      canvas: baseLayerCanvas,
    },
    {
      id: 'layer-1',
      name: 'Paint Layer 1',
      visible: true,
      opacity: 100,
      blendMode: 'source-over',
      canvas: overlayCanvas,
    },
  ];
}

function getActiveLayerCanvas(slot: ShaderSlot): HTMLCanvasElement {
  return slot.layers[slot.activeLayerIdx]?.canvas ?? slot.canvas;
}

function compositeSlotLayers(slot: ShaderSlot): void {
  const ctx = slot.canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.clearRect(0, 0, slot.width, slot.height);
  for (const layer of slot.layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity / 100));
    ctx.globalCompositeOperation = layer.blendMode;
    ctx.drawImage(layer.canvas, 0, 0, slot.width, slot.height);
  }
  ctx.restore();
  slot.threeTexture.needsUpdate = true;
  slot.dirty = true;
}

const GIMP_TOOLS_META: Array<{ id: ToolKind; icon: React.ReactNode; name: string; hint: string }> = [
  { id: 'brush', icon: <Paintbrush size={15} />, name: 'Paint Brush', hint: 'Hard/soft freehand stroke on 3D model or 2D UV' },
  { id: 'airbrush', icon: <SprayCan size={15} />, name: 'Soft Airbrush', hint: 'Smooth radial gradient spray' },
  { id: 'clone', icon: <Target size={15} />, name: 'Clone Stamp', hint: 'Alt+Click (or first click) sets source ⊕, then paint copies pixels' },
  { id: 'smudge', icon: <Hand size={15} />, name: 'Smudge Brush', hint: 'Blend & pull surface pixels along stroke' },
  { id: 'blur-sharpen', icon: <Sparkles size={15} />, name: 'Blur / Sharpen', hint: '3×3 Gaussian blur or Unsharp sharpen (Hold Shift to sharpen)' },
  { id: 'stamp', icon: <Stamp size={15} />, name: 'Decal Stamp', hint: 'Stamp custom texture / emblem with scale & rotation' },
  { id: 'bucket', icon: <PaintBucket size={15} />, name: 'Bucket Fill', hint: 'Contiguous tolerance flood fill' },
  { id: 'sharp-line', icon: <Minus size={15} />, name: 'Sharp Line', hint: 'Click-drag crisp vector line' },
  { id: 'sharp-rect', icon: <Square size={15} />, name: 'Sharp Rectangle', hint: 'Click-drag filled or outlined rectangle' },
  { id: 'tri-fill', icon: <Triangle size={15} />, name: '3D Triangle Fill', hint: 'Click any 3D mesh face to fill its exact UV triangle' },
  { id: 'uv-island', icon: <Layers size={15} />, name: '3D UV Island Fill', hint: 'Click 3D face to fill entire contiguous UV island + 4px seam bleed' },
  { id: 'bbox-mask', icon: <Scan size={15} />, name: 'Region Clip Mask', hint: 'Drag box to restrict all painting inside region' },
  { id: 'eyedropper', icon: <Pipette size={15} />, name: 'Eyedropper', hint: 'Sample color from 3D surface or 2D texture' },
  { id: 'eraser', icon: <Eraser size={15} />, name: 'Layer Eraser', hint: 'Erase active paint layer to transparency' },
  { id: 'orbit', icon: <Move size={15} />, name: 'Orbit 3D Camera', hint: 'Rotate/pan/zoom 3D view without painting' },
];

interface CustomTextureEntry {
  name: string;
  filePath: string;
  dataUrl: string;
}

interface BoundingBoxMask {
  x: number;
  y: number;
  w: number;
  h: number;
}

const HALO_COLOR_SWATCHES = [
  '#4d5d3b', // UNSC Olive Drab
  '#38bdf8', // Forerunner Cyan
  '#6d28d9', // Covenant Royal Purple
  '#1d4ed8', // Covenant Plasma Blue
  '#ea580c', // Fuel Rod Orange
  '#eab308', // Gold Visor / Hazard Yellow
  '#dc2626', // Red Team Crimson
  '#22c55e', // Assault Green
  '#e2e8f0', // Titanium White
  '#475569', // Gunmetal Steel
  '#1e293b', // SpecOps Black
  '#a16207', // Desert Tan
];

export default function Bitmap3dStudioPanel({ allTags, onOpenTagEditor }: Props) {
  // --- Item Chooser Modal State ---
  const [chooserOpen, setChooserOpen] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory>('vehicle');
  const [itemSearch, setItemSearch] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<TagEntrySummary | null>(null);

  // --- Loaded Model & Shader Bitmap Slots ---
  const [isLoadingItem, setIsLoadingItem] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [shaderSlots, setShaderSlots] = useState<ShaderSlot[]>([]);
  const [activeSlotIdx, setActiveSlotIdx] = useState<number>(0);
  const [modelGeometry, setModelGeometry] = useState<ModelRenderGeometry | null>(null);

  // --- Viewport Layout & Paint Tool State ---
  const [show3dView, setShow3dView] = useState<boolean>(true);
  const [show2dView, setShow2dView] = useState<boolean>(true);
  const [splitPercent, setSplitPercent] = useState<number>(52);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState<boolean>(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [activeTool, setActiveTool] = useState<ToolKind>('brush');
  const [hoveredTool, setHoveredTool] = useState<ToolKind | null>(null);
  const [layerVersion, setLayerVersion] = useState<number>(0);
  const [fillMode, setFillMode] = useState<'color' | 'texture'>('color');
  const [blendMode, setBlendMode] = useState<BlendModeKind>('source-over');
  const [symmetryMode, setSymmetryMode] = useState<SymmetryMode>('off');
  const [bucketTolerance, setBucketTolerance] = useState<number>(32);
  const [brushColor, setBrushColor] = useState<string>('#38bdf8');
  const [brushSize, setBrushSize] = useState<number>(3);
  const [brushOpacity, setBrushOpacity] = useState<number>(100);
  const [brushHardness, setBrushHardness] = useState<number>(100);
  const [rectFilled, setRectFilled] = useState<boolean>(true);
  const [showWireframe3d, setShowWireframe3d] = useState<boolean>(false);
  const [showUvOverlay2d, setShowUvOverlay2d] = useState<boolean>(true);
  const [bboxMask, setBboxMask] = useState<BoundingBoxMask | null>(null);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [autoHdUpscale, setAutoHdUpscale] = useState<boolean>(true);
  const [cloneSourcePt, setCloneSourcePt] = useState<{ x: number; y: number } | null>(null);
  const cloneOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const smudgeBufferRef = useRef<{ r: number; g: number; b: number; a: number } | null>(null);
  const [convolveSharpen, setConvolveSharpen] = useState<boolean>(false);
  const [hsvHue, setHsvHue] = useState<number>(0);
  const [hsvSat, setHsvSat] = useState<number>(0);
  const [hsvVal, setHsvVal] = useState<number>(0);

  // --- 2D UV Viewport Zoom & Pan State ---
  const [zoom2d, setZoom2d] = useState<number>(1);
  const [pan2d, setPan2d] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const isPanning2dRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // --- Custom Textures from `<exe>/textures/` ---
  const [customTextures, setCustomTextures] = useState<CustomTextureEntry[]>([]);
  const [texturesDirPath, setTexturesDirPath] = useState<string>('');
  const [selectedPatternIdx, setSelectedPatternIdx] = useState<number>(0);
  const [patternScale, setPatternScale] = useState<number>(1);
  const [patternRotationDeg, setPatternRotationDeg] = useState<number>(0);
  const loadedPatternImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // --- Three.js & 2D Canvas Refs ---
  const threeContainerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const meshListRef = useRef<Array<{ mesh: THREE.Mesh; wire: THREE.LineSegments; shaderTagId: number }>>([]);
  const uvCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Painting interaction refs
  const isPaintingRef = useRef<boolean>(false);
  const lastUvPixelRef = useRef<{ x: number; y: number } | null>(null);
  const lastSlotIdxRef = useRef<number>(-1);
  const dragStartPixelRef = useRef<{ x: number; y: number } | null>(null);
  const dragCurrentPixelRef = useRef<{ x: number; y: number } | null>(null);
  const preStrokeSnapshotRef = useRef<ImageData | null>(null);
  const [floatingBspVersion, setFloatingBspVersion] = useState<number>(0);

  useEffect(() => {
    const onFloatingChanged = () => setFloatingBspVersion((v) => v + 1);
    window.addEventListener('opence:floating-bsp-objects-changed', onFloatingChanged);
    return () => window.removeEventListener('opence:floating-bsp-objects-changed', onFloatingChanged);
  }, []);

  // Filter items for the Item Chooser Popup
  const categoryItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (selectedCategory === 'floating-bsp') {
      const list = window.__openceFloatingBspObjects ?? [];
      return list
        .filter((f) => !q || f.name.toLowerCase().includes(q) || f.shaderPath.toLowerCase().includes(q))
        .map(
          (f, idx): TagEntrySummary => ({
            index: -1000 - idx,
            tagId: f.shaderTagId || 0xe0000000 + idx,
            path: `floating_bsp\\${f.name}`,
            primaryClassName: 'floating-bsp',
            isExternal: false,
            estimatedSize: null,
          }),
        );
    }
    return allTags.filter((t) => {
      if (t.primaryClassName !== selectedCategory) return false;
      if (!q) return true;
      return t.path.toLowerCase().includes(q);
    });
  }, [allTags, selectedCategory, itemSearch, floatingBspVersion]);

  // Load Custom Brush/Pattern Textures from `<exe>/textures/`
  const loadCustomTextures = useCallback(async () => {
    if (!window.opence.getCustomBrushTextures) return;
    const res = await window.opence.getCustomBrushTextures();
    if (res.ok) {
      setTexturesDirPath(res.texturesDir);
      setCustomTextures(res.textures);
      for (const tex of res.textures) {
        const img = new Image();
        img.src = tex.dataUrl;
        loadedPatternImagesRef.current.set(tex.dataUrl, img);
      }
    }
  }, []);

  useEffect(() => {
    loadCustomTextures();
  }, [loadCustomTextures]);

  // Auto-select a default category that has tags when map changes
  useEffect(() => {
    for (const cat of ITEM_CATEGORIES) {
      if (allTags.some((t) => t.primaryClassName === cat.id)) {
        setSelectedCategory(cat.id);
        break;
      }
    }
  }, [allTags]);

  const activeSlot = shaderSlots[activeSlotIdx] ?? null;

  // Render the 2D UV & Bounding-Box Canvas
  const redraw2dCanvas = useCallback(() => {
    const viewCanvas = uvCanvasRef.current;
    if (!viewCanvas || !activeSlot) return;
    const ctx = viewCanvas.getContext('2d');
    if (!ctx) return;

    const w = activeSlot.width;
    const h = activeSlot.height;
    if (viewCanvas.width !== w || viewCanvas.height !== h) {
      viewCanvas.width = w;
      viewCanvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(activeSlot.canvas, 0, 0);

    // Draw UV Wireframe Overlay for submeshes using this shader
    if (showUvOverlay2d && modelGeometry) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.38)';
      ctx.lineWidth = Math.max(1, w / 512);
      ctx.beginPath();
      for (const sub of modelGeometry.submeshes) {
        if (sub.shaderTagId !== activeSlot.shaderTagId && shaderSlots.length > 1) continue;
        const verts = sub.vertices;
        const idx = sub.indices;
        for (let i = 0; i + 2 < idx.length; i += 3) {
          const i0 = idx[i] * 8;
          const i1 = idx[i + 1] * 8;
          const i2 = idx[i + 2] * 8;
          const u0 = (((verts[i0 + 6] % 1) + 1) % 1) * w;
          const v0 = (((verts[i0 + 7] % 1) + 1) % 1) * h;
          const u1 = (((verts[i1 + 6] % 1) + 1) % 1) * w;
          const v1 = (((verts[i1 + 7] % 1) + 1) % 1) * h;
          const u2 = (((verts[i2 + 6] % 1) + 1) % 1) * w;
          const v2 = (((verts[i2 + 7] % 1) + 1) % 1) * h;
          ctx.moveTo(u0, v0);
          ctx.lineTo(u1, v1);
          ctx.lineTo(u2, v2);
          ctx.closePath();
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // Draw active Bounding-Box Layer Mask
    if (bboxMask) {
      ctx.save();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = Math.max(2, w / 256);
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(bboxMask.x, bboxMask.y, bboxMask.w, bboxMask.h);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.08)';
      ctx.fillRect(bboxMask.x, bboxMask.y, bboxMask.w, bboxMask.h);
      ctx.restore();
    }

    // Draw live preview for Sharp Line / Sharp Rect / BBox Mask while dragging
    if (isPaintingRef.current && dragStartPixelRef.current && dragCurrentPixelRef.current) {
      const s = dragStartPixelRef.current;
      const c = dragCurrentPixelRef.current;
      ctx.save();
      if (activeTool === 'sharp-line') {
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'square';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      } else if (activeTool === 'sharp-rect') {
        const rx = Math.min(s.x, c.x);
        const ry = Math.min(s.y, c.y);
        const rw = Math.abs(c.x - s.x);
        const rh = Math.abs(c.y - s.y);
        ctx.strokeStyle = brushColor;
        ctx.fillStyle = brushColor;
        ctx.lineWidth = Math.max(2, brushSize / 2);
        if (rectFilled) {
          ctx.globalAlpha = brushOpacity / 100;
          ctx.fillRect(rx, ry, rw, rh);
        } else {
          ctx.strokeRect(rx, ry, rw, rh);
        }
      } else if (activeTool === 'bbox-mask') {
        const rx = Math.min(s.x, c.x);
        const ry = Math.min(s.y, c.y);
        const rw = Math.abs(c.x - s.x);
        const rh = Math.abs(c.y - s.y);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(rx, ry, rw, rh);
      }
      ctx.restore();
    }

    // Draw Clone Stamp Source Indicator ⊕ when set
    if (cloneSourcePt) {
      ctx.save();
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = Math.max(2, w / 256);
      const r = Math.max(6, brushSize * 0.8);
      ctx.beginPath();
      ctx.arc(cloneSourcePt.x, cloneSourcePt.y, r, 0, Math.PI * 2);
      ctx.moveTo(cloneSourcePt.x - r * 1.4, cloneSourcePt.y);
      ctx.lineTo(cloneSourcePt.x + r * 1.4, cloneSourcePt.y);
      ctx.moveTo(cloneSourcePt.x, cloneSourcePt.y - r * 1.4);
      ctx.lineTo(cloneSourcePt.x, cloneSourcePt.y + r * 1.4);
      ctx.stroke();
      ctx.restore();
    }
  }, [activeSlot, showUvOverlay2d, modelGeometry, shaderSlots.length, bboxMask, activeTool, brushColor, brushSize, rectFilled, brushOpacity, cloneSourcePt]);

  useEffect(() => {
    redraw2dCanvas();
  }, [redraw2dCanvas]);

  // Helper to configure canvas context for fill/stroke (Solid Color or Custom Texture Pattern + Bounding Box Clip + Blend Mode)
  const preparePaintContext = useCallback(
    (ctx: CanvasRenderingContext2D, isOverlayLayer = false) => {
      ctx.save();
      if (bboxMask && bboxMask.w > 1 && bboxMask.h > 1) {
        ctx.beginPath();
        ctx.rect(bboxMask.x, bboxMask.y, bboxMask.w, bboxMask.h);
        ctx.clip();
      }
      ctx.globalAlpha = brushOpacity / 100;
      ctx.globalCompositeOperation =
        activeTool === 'eraser' ? (isOverlayLayer ? 'destination-out' : 'source-over') : blendMode;
      if (activeTool === 'eraser') {
        ctx.fillStyle = isOverlayLayer ? 'rgba(0,0,0,1)' : '#000000';
        ctx.strokeStyle = isOverlayLayer ? 'rgba(0,0,0,1)' : '#000000';
        return;
      }
      if (fillMode === 'texture' && customTextures[selectedPatternIdx]) {
        const texEntry = customTextures[selectedPatternIdx];
        const img = loadedPatternImagesRef.current.get(texEntry.dataUrl);
        if (img && img.complete && img.naturalWidth > 0) {
          const patternCanvas = document.createElement('canvas');
          const pw = Math.max(8, Math.round(img.naturalWidth * patternScale));
          const ph = Math.max(8, Math.round(img.naturalHeight * patternScale));
          patternCanvas.width = pw;
          patternCanvas.height = ph;
          const pctx = patternCanvas.getContext('2d');
          if (pctx) {
            pctx.drawImage(img, 0, 0, pw, ph);
            const pat = ctx.createPattern(patternCanvas, 'repeat');
            if (pat) {
              if (patternRotationDeg !== 0 && typeof DOMMatrix !== 'undefined' && pat.setTransform) {
                pat.setTransform(new DOMMatrix().rotate(patternRotationDeg));
              }
              ctx.fillStyle = pat;
              ctx.strokeStyle = pat;
              return;
            }
          }
        }
      }
      ctx.fillStyle = brushColor;
      ctx.strokeStyle = brushColor;
    },
    [bboxMask, brushOpacity, activeTool, blendMode, fillMode, customTextures, selectedPatternIdx, patternScale, patternRotationDeg, brushColor],
  );

  // Paint a brush dab or segment onto the active layer of a ShaderSlot (with optional X/Y UV Symmetry)
  const paintStrokeSegment = useCallback(
    (slot: ShaderSlot, fromPt: { x: number; y: number }, toPt: { x: number; y: number }) => {
      const layerCanvas = getActiveLayerCanvas(slot);
      const ctx = layerCanvas.getContext('2d');
      if (!ctx) return;
      const isOverlayLayer = slot.activeLayerIdx > 0;

      const drawSingleSegment = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        preparePaintContext(ctx, isOverlayLayer);
        ctx.lineWidth = brushSize;
        ctx.lineCap = brushHardness >= 80 ? 'square' : 'round';
        ctx.lineJoin = brushHardness >= 80 ? 'miter' : 'round';
        if (brushHardness < 80 && fillMode === 'color' && activeTool !== 'eraser') {
          ctx.shadowColor = brushColor;
          ctx.shadowBlur = Math.max(1, ((100 - brushHardness) / 100) * (brushSize * 0.6));
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
      };

      drawSingleSegment(fromPt, toPt);
      if (symmetryMode === 'x' || symmetryMode === 'xy') {
        drawSingleSegment({ x: slot.width - fromPt.x, y: fromPt.y }, { x: slot.width - toPt.x, y: toPt.y });
      }
      if (symmetryMode === 'y' || symmetryMode === 'xy') {
        drawSingleSegment({ x: fromPt.x, y: slot.height - fromPt.y }, { x: toPt.x, y: slot.height - toPt.y });
      }
      if (symmetryMode === 'xy') {
        drawSingleSegment(
          { x: slot.width - fromPt.x, y: slot.height - fromPt.y },
          { x: slot.width - toPt.x, y: slot.height - toPt.y },
        );
      }

      compositeSlotLayers(slot);
      redraw2dCanvas();
    },
    [preparePaintContext, brushSize, brushHardness, fillMode, activeTool, brushColor, symmetryMode, redraw2dCanvas],
  );

  // Soft Airbrush / Radial Gradient Spray segment
  const paintAirbrushSegment = useCallback(
    (slot: ShaderSlot, fromPt: { x: number; y: number }, toPt: { x: number; y: number }) => {
      const layerCanvas = getActiveLayerCanvas(slot);
      const ctx = layerCanvas.getContext('2d');
      if (!ctx) return;
      const radius = Math.max(2, brushSize * 1.4);
      const dist = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.25)));

      const hexToRgb = (hex: string): [number, number, number] => {
        const clean = hex.replace('#', '');
        if (clean.length !== 6) return [56, 189, 248];
        return [
          parseInt(clean.slice(0, 2), 16) || 0,
          parseInt(clean.slice(2, 4), 16) || 0,
          parseInt(clean.slice(4, 6), 16) || 0,
        ];
      };
      const [r, g, b] = hexToRgb(brushColor);
      const peakAlpha = Math.min(1, (brushOpacity / 100) * 0.35);

      const sprayAt = (cx: number, cy: number) => {
        ctx.save();
        if (bboxMask && bboxMask.w > 1 && bboxMask.h > 1) {
          ctx.beginPath();
          ctx.rect(bboxMask.x, bboxMask.y, bboxMask.w, bboxMask.h);
          ctx.clip();
        }
        ctx.globalCompositeOperation = blendMode;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${peakAlpha})`);
        grad.addColorStop(Math.max(0.15, brushHardness / 150), `rgba(${r}, ${g}, ${b}, ${peakAlpha * 0.45})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        const px = fromPt.x + (toPt.x - fromPt.x) * t;
        const py = fromPt.y + (toPt.y - fromPt.y) * t;
        sprayAt(px, py);
        if (symmetryMode === 'x' || symmetryMode === 'xy') sprayAt(slot.width - px, py);
        if (symmetryMode === 'y' || symmetryMode === 'xy') sprayAt(px, slot.height - py);
        if (symmetryMode === 'xy') sprayAt(slot.width - px, slot.height - py);
      }

      compositeSlotLayers(slot);
      redraw2dCanvas();
    },
    [brushSize, brushColor, brushOpacity, bboxMask, blendMode, brushHardness, symmetryMode, redraw2dCanvas],
  );

  // Stamp / Decal Placer: stamps selected custom texture (or emblem) centered at pt with rotation & scale
  const paintDecalStampOnSlot = useCallback(
    (slot: ShaderSlot, pt: { x: number; y: number }) => {
      const layerCanvas = getActiveLayerCanvas(slot);
      const ctx = layerCanvas.getContext('2d');
      if (!ctx) return;
      const snap = ctx.getImageData(0, 0, slot.width, slot.height);
      slot.undoStack.push({ layerIdx: slot.activeLayerIdx, imageData: snap });
      if (slot.undoStack.length > 20) slot.undoStack.shift();
      slot.redoStack = [];

      const stampSize = Math.max(8, brushSize * 6 * patternScale);
      const texEntry = customTextures[selectedPatternIdx];
      const img = texEntry ? loadedPatternImagesRef.current.get(texEntry.dataUrl) : undefined;

      const stampOnce = (cx: number, cy: number, flipX = false) => {
        ctx.save();
        if (bboxMask && bboxMask.w > 1 && bboxMask.h > 1) {
          ctx.beginPath();
          ctx.rect(bboxMask.x, bboxMask.y, bboxMask.w, bboxMask.h);
          ctx.clip();
        }
        ctx.globalAlpha = brushOpacity / 100;
        ctx.globalCompositeOperation = blendMode;
        ctx.translate(cx, cy);
        ctx.rotate((patternRotationDeg * Math.PI) / 180);
        if (flipX) ctx.scale(-1, 1);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, -stampSize / 2, -stampSize / 2, stampSize, stampSize);
        } else {
          ctx.fillStyle = brushColor;
          ctx.fillRect(-stampSize / 2, -stampSize / 2, stampSize, stampSize);
        }
        ctx.restore();
      };

      stampOnce(pt.x, pt.y, false);
      if (symmetryMode === 'x' || symmetryMode === 'xy') stampOnce(slot.width - pt.x, pt.y, true);
      if (symmetryMode === 'y' || symmetryMode === 'xy') stampOnce(pt.x, slot.height - pt.y, false);

      compositeSlotLayers(slot);
      redraw2dCanvas();
    },
    [brushSize, patternScale, customTextures, selectedPatternIdx, bboxMask, brushOpacity, blendMode, patternRotationDeg, brushColor, symmetryMode, redraw2dCanvas],
  );

  // Contiguous Tolerance-based Flood Fill (Bucket Tool)
  const floodFillOnSlot = useCallback(
    (slot: ShaderSlot, pt: { x: number; y: number }) => {
      const layerCanvas = getActiveLayerCanvas(slot);
      const ctx = layerCanvas.getContext('2d');
      if (!ctx) return;
      const w = slot.width;
      const h = slot.height;
      const startX = Math.max(0, Math.min(w - 1, Math.floor(pt.x)));
      const startY = Math.max(0, Math.min(h - 1, Math.floor(pt.y)));

      const snap = ctx.getImageData(0, 0, w, h);
      slot.undoStack.push({ layerIdx: slot.activeLayerIdx, imageData: snap });
      if (slot.undoStack.length > 20) slot.undoStack.shift();
      slot.redoStack = [];

      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      const startIdx = (startY * w + startX) * 4;
      const sr = data[startIdx];
      const sg = data[startIdx + 1];
      const sb = data[startIdx + 2];

      const clean = brushColor.replace('#', '');
      const tr = parseInt(clean.slice(0, 2), 16) || 0;
      const tg = parseInt(clean.slice(2, 4), 16) || 0;
      const tb = parseInt(clean.slice(4, 6), 16) || 0;
      const alphaMix = brushOpacity / 100;

      const minX = bboxMask ? Math.max(0, Math.floor(bboxMask.x)) : 0;
      const minY = bboxMask ? Math.max(0, Math.floor(bboxMask.y)) : 0;
      const maxX = bboxMask ? Math.min(w - 1, Math.floor(bboxMask.x + bboxMask.w - 1)) : w - 1;
      const maxY = bboxMask ? Math.min(h - 1, Math.floor(bboxMask.y + bboxMask.h - 1)) : h - 1;
      if (startX < minX || startX > maxX || startY < minY || startY > maxY) return;

      const visited = new Uint8Array(w * h);
      const queue = new Int32Array(w * h);
      let head = 0;
      let tail = 0;
      const startPos = startY * w + startX;
      visited[startPos] = 1;
      queue[tail++] = startPos;
      const tol = bucketTolerance;

      while (head < tail) {
        const pos = queue[head++];
        const cx = pos % w;
        const cy = (pos - cx) / w;
        const pOff = pos * 4;
        data[pOff] = Math.round(data[pOff] * (1 - alphaMix) + tr * alphaMix);
        data[pOff + 1] = Math.round(data[pOff + 1] * (1 - alphaMix) + tg * alphaMix);
        data[pOff + 2] = Math.round(data[pOff + 2] * (1 - alphaMix) + tb * alphaMix);
        data[pOff + 3] = 255;

        const neighbors = [
          cx > minX ? pos - 1 : -1,
          cx < maxX ? pos + 1 : -1,
          cy > minY ? pos - w : -1,
          cy < maxY ? pos + w : -1,
        ];
        for (const nPos of neighbors) {
          if (nPos < 0 || visited[nPos]) continue;
          const nOff = nPos * 4;
          const dr = Math.abs(data[nOff] - sr);
          const dg = Math.abs(data[nOff + 1] - sg);
          const db = Math.abs(data[nOff + 2] - sb);
          if (dr <= tol && dg <= tol && db <= tol) {
            visited[nPos] = 1;
            queue[tail++] = nPos;
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
      compositeSlotLayers(slot);
      redraw2dCanvas();
    },
    [brushColor, brushOpacity, bboxMask, bucketTolerance, redraw2dCanvas],
  );

  // Fill a specific UV triangle on a ShaderSlot
  const fillUvTriangleOnSlot = useCallback(
    (
      slot: ShaderSlot,
      uv0: { u: number; v: number },
      uv1: { u: number; v: number },
      uv2: { u: number; v: number },
    ) => {
      const layerCanvas = getActiveLayerCanvas(slot);
      const ctx = layerCanvas.getContext('2d');
      if (!ctx) return;
      const snap = ctx.getImageData(0, 0, slot.width, slot.height);
      slot.undoStack.push({ layerIdx: slot.activeLayerIdx, imageData: snap });
      if (slot.undoStack.length > 20) slot.undoStack.shift();
      slot.redoStack = [];

      preparePaintContext(ctx, slot.activeLayerIdx > 0);
      const x0 = (((uv0.u % 1) + 1) % 1) * slot.width;
      const y0 = (((uv0.v % 1) + 1) % 1) * slot.height;
      const x1 = (((uv1.u % 1) + 1) % 1) * slot.width;
      const y1 = (((uv1.v % 1) + 1) % 1) * slot.height;
      const x2 = (((uv2.u % 1) + 1) % 1) * slot.width;
      const y2 = (((uv2.v % 1) + 1) % 1) * slot.height;

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      compositeSlotLayers(slot);
      redraw2dCanvas();
    },
    [preparePaintContext, redraw2dCanvas],
  );

  // GIMP-Style 4px UV Seam Bleed Dilation: expands opaque painted pixels outward into transparent border pixels
  // so lower mipmaps never bleed dark background colors across 3D UV seams!
  const dilateCanvasSeamBleed = useCallback((canvas: HTMLCanvasElement, radiusPx = 4) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const passBuf = new Uint8ClampedArray(data);

    for (let step = 0; step < radiusPx; step++) {
      passBuf.set(data);
      for (let y = 0; y < h; y++) {
        const rowOff = y * w;
        for (let x = 0; x < w; x++) {
          const pOff = (rowOff + x) * 4;
          if (passBuf[pOff + 3] >= 24) continue; // Already opaque
          let rSum = 0;
          let gSum = 0;
          let bSum = 0;
          let aMax = 0;
          let count = 0;
          const neighbors = [
            x > 0 ? pOff - 4 : -1,
            x + 1 < w ? pOff + 4 : -1,
            y > 0 ? pOff - w * 4 : -1,
            y + 1 < h ? pOff + w * 4 : -1,
          ];
          for (const nOff of neighbors) {
            if (nOff >= 0 && passBuf[nOff + 3] >= 24) {
              rSum += passBuf[nOff];
              gSum += passBuf[nOff + 1];
              bSum += passBuf[nOff + 2];
              if (passBuf[nOff + 3] > aMax) aMax = passBuf[nOff + 3];
              count++;
            }
          }
          if (count > 0) {
            data[pOff] = Math.round(rSum / count);
            data[pOff + 1] = Math.round(gSum / count);
            data[pOff + 2] = Math.round(bSum / count);
            data[pOff + 3] = aMax;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, []);

  // Contiguous 3D UV Island Magic Wand & Fill + Automatic 4px Seam Bleed
  const fillContiguousUvIslandOnSlot = useCallback(
    (slot: ShaderSlot, mesh: THREE.Mesh, startFaceIndex: number) => {
      const uvAttr = mesh.geometry.getAttribute('uv');
      const indexAttr = mesh.geometry.getIndex();
      if (!uvAttr || !indexAttr) return;

      const triCount = Math.floor(indexAttr.count / 3);
      if (startFaceIndex < 0 || startFaceIndex >= triCount) return;

      // Quantize UV coordinates to 1/1024 grid to link triangles sharing UV seams
      const quantUv = (vIdx: number): string => {
        const u = Math.round((((uvAttr.getX(vIdx) % 1) + 1) % 1) * 1024);
        const v = Math.round((((uvAttr.getY(vIdx) % 1) + 1) % 1) * 1024);
        return `${u},${v}`;
      };

      const uvKeyToTris = new Map<string, number[]>();
      const triKeys: Array<[string, string, string]> = new Array(triCount);
      for (let t = 0; t < triCount; t++) {
        const a = indexAttr.getX(t * 3);
        const b = indexAttr.getX(t * 3 + 1);
        const c = indexAttr.getX(t * 3 + 2);
        const ka = quantUv(a);
        const kb = quantUv(b);
        const kc = quantUv(c);
        triKeys[t] = [ka, kb, kc];
        for (const k of [ka, kb, kc]) {
          let list = uvKeyToTris.get(k);
          if (!list) {
            list = [];
            uvKeyToTris.set(k, list);
          }
          list.push(t);
        }
      }

      // BFS from startFaceIndex across connected UV vertices
      const visited = new Uint8Array(triCount);
      const queue: number[] = [startFaceIndex];
      visited[startFaceIndex] = 1;
      const islandTris: number[] = [];

      while (queue.length > 0) {
        const cur = queue.pop()!;
        islandTris.push(cur);
        for (const k of triKeys[cur]) {
          const adj = uvKeyToTris.get(k);
          if (!adj) continue;
          for (const nextTri of adj) {
            if (!visited[nextTri]) {
              visited[nextTri] = 1;
              queue.push(nextTri);
            }
          }
        }
      }

      const layerCanvas = getActiveLayerCanvas(slot);
      const ctx = layerCanvas.getContext('2d');
      if (!ctx) return;
      const snap = ctx.getImageData(0, 0, slot.width, slot.height);
      slot.undoStack.push({ layerIdx: slot.activeLayerIdx, imageData: snap });
      if (slot.undoStack.length > 20) slot.undoStack.shift();
      slot.redoStack = [];

      preparePaintContext(ctx, slot.activeLayerIdx > 0);
      ctx.beginPath();
      for (const t of islandTris) {
        const a = indexAttr.getX(t * 3);
        const b = indexAttr.getX(t * 3 + 1);
        const c = indexAttr.getX(t * 3 + 2);
        const x0 = (((uvAttr.getX(a) % 1) + 1) % 1) * slot.width;
        const y0 = (((uvAttr.getY(a) % 1) + 1) % 1) * slot.height;
        const x1 = (((uvAttr.getX(b) % 1) + 1) % 1) * slot.width;
        const y1 = (((uvAttr.getY(b) % 1) + 1) % 1) * slot.height;
        const x2 = (((uvAttr.getX(c) % 1) + 1) % 1) * slot.width;
        const y2 = (((uvAttr.getY(c) % 1) + 1) % 1) * slot.height;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.closePath();
      }
      ctx.fill();
      ctx.lineWidth = 4; // Built-in 4px UV seam bleed along island perimeter
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();

      compositeSlotLayers(slot);
      redraw2dCanvas();
      setStatusMessage(
        `Filled contiguous 3D UV Island (${islandTris.length} connected triangles) with automatic 4px UV seam bleed padding!`,
      );
    },
    [preparePaintContext, redraw2dCanvas],
  );

  // GIMP Clone Stamp (`gimpclone.c`): copies composite pixels from cloneOffset onto active layer
  const paintCloneSegment = useCallback(
    (slot: ShaderSlot, fromPt: { x: number; y: number }, toPt: { x: number; y: number }) => {
      if (!cloneSourcePt) return;
      if (!cloneOffsetRef.current) {
        cloneOffsetRef.current = {
          dx: cloneSourcePt.x - fromPt.x,
          dy: cloneSourcePt.y - fromPt.y,
        };
      }
      const { dx, dy } = cloneOffsetRef.current;
      const layerCanvas = getActiveLayerCanvas(slot);
      const dstCtx = layerCanvas.getContext('2d');
      const srcCtx = slot.canvas.getContext('2d');
      if (!dstCtx || !srcCtx) return;

      const radius = Math.max(1, Math.round(brushSize / 2));
      const dist = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.35)));
      const w = slot.width;
      const h = slot.height;
      const srcData = srcCtx.getImageData(0, 0, w, h).data;
      const dstImg = dstCtx.getImageData(0, 0, w, h);
      const dstData = dstImg.data;
      const alphaScale = brushOpacity / 100;

      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        const cx = Math.round(fromPt.x + (toPt.x - fromPt.x) * t);
        const cy = Math.round(fromPt.y + (toPt.y - fromPt.y) * t);
        for (let oy = -radius; oy <= radius; oy++) {
          for (let ox = -radius; ox <= radius; ox++) {
            const dSq = ox * ox + oy * oy;
            if (dSq > radius * radius) continue;
            const tx = cx + ox;
            const ty = cy + oy;
            if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
            const sx = ((Math.round(tx + dx) % w) + w) % w;
            const sy = ((Math.round(ty + dy) % h) + h) % h;
            const sIdx = (sy * w + sx) * 4;
            const dIdx = (ty * w + tx) * 4;
            const falloff = brushHardness >= 85 ? 1 : 1 - Math.sqrt(dSq) / (radius + 0.5);
            const mix = Math.max(0, Math.min(1, alphaScale * falloff));
            dstData[dIdx] = Math.round(dstData[dIdx] * (1 - mix) + srcData[sIdx] * mix);
            dstData[dIdx + 1] = Math.round(dstData[dIdx + 1] * (1 - mix) + srcData[sIdx + 1] * mix);
            dstData[dIdx + 2] = Math.round(dstData[dIdx + 2] * (1 - mix) + srcData[sIdx + 2] * mix);
            dstData[dIdx + 3] = Math.max(dstData[dIdx + 3], Math.round(255 * mix));
          }
        }
      }

      dstCtx.putImageData(dstImg, 0, 0);
      compositeSlotLayers(slot);
      redraw2dCanvas();
    },
    [cloneSourcePt, brushSize, brushOpacity, brushHardness, redraw2dCanvas],
  );

  // GIMP Smudge Brush (`gimpsmudge.c`): blends & pulls existing composite pixels along the stroke
  const paintSmudgeSegment = useCallback(
    (slot: ShaderSlot, fromPt: { x: number; y: number }, toPt: { x: number; y: number }) => {
      const layerCanvas = getActiveLayerCanvas(slot);
      const dstCtx = layerCanvas.getContext('2d');
      const compCtx = slot.canvas.getContext('2d');
      if (!dstCtx || !compCtx) return;

      const w = slot.width;
      const h = slot.height;
      const radius = Math.max(1, Math.round(brushSize / 2));
      const compData = compCtx.getImageData(0, 0, w, h).data;
      const dstImg = dstCtx.getImageData(0, 0, w, h);
      const dstData = dstImg.data;

      if (!smudgeBufferRef.current) {
        const sx = Math.max(0, Math.min(w - 1, Math.floor(fromPt.x)));
        const sy = Math.max(0, Math.min(h - 1, Math.floor(fromPt.y)));
        const sIdx = (sy * w + sx) * 4;
        smudgeBufferRef.current = {
          r: compData[sIdx],
          g: compData[sIdx + 1],
          b: compData[sIdx + 2],
          a: compData[sIdx + 3],
        };
      }

      const carry = smudgeBufferRef.current;
      const dist = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.35)));
      const rate = Math.min(0.92, (brushOpacity / 100) * 0.72);

      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        const cx = Math.round(fromPt.x + (toPt.x - fromPt.x) * t);
        const cy = Math.round(fromPt.y + (toPt.y - fromPt.y) * t);
        const cIdx = (Math.max(0, Math.min(h - 1, cy)) * w + Math.max(0, Math.min(w - 1, cx))) * 4;
        carry.r = carry.r * rate + compData[cIdx] * (1 - rate);
        carry.g = carry.g * rate + compData[cIdx + 1] * (1 - rate);
        carry.b = carry.b * rate + compData[cIdx + 2] * (1 - rate);

        for (let oy = -radius; oy <= radius; oy++) {
          for (let ox = -radius; ox <= radius; ox++) {
            const dSq = ox * ox + oy * oy;
            if (dSq > radius * radius) continue;
            const tx = cx + ox;
            const ty = cy + oy;
            if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
            const dIdx = (ty * w + tx) * 4;
            const falloff = 1 - Math.sqrt(dSq) / (radius + 0.5);
            const mix = rate * falloff;
            const baseR = dstData[dIdx + 3] > 0 ? dstData[dIdx] : compData[dIdx];
            const baseG = dstData[dIdx + 3] > 0 ? dstData[dIdx + 1] : compData[dIdx + 1];
            const baseB = dstData[dIdx + 3] > 0 ? dstData[dIdx + 2] : compData[dIdx + 2];
            dstData[dIdx] = Math.round(baseR * (1 - mix) + carry.r * mix);
            dstData[dIdx + 1] = Math.round(baseG * (1 - mix) + carry.g * mix);
            dstData[dIdx + 2] = Math.round(baseB * (1 - mix) + carry.b * mix);
            dstData[dIdx + 3] = 255;
          }
        }
      }

      dstCtx.putImageData(dstImg, 0, 0);
      compositeSlotLayers(slot);
      redraw2dCanvas();
    },
    [brushSize, brushOpacity, redraw2dCanvas],
  );

  // GIMP Convolve Blur / Sharpen (`gimpconvolve.c`): 3x3 Gaussian blur or Unsharp Mask sharpen under brush
  const paintBlurSharpenSegment = useCallback(
    (slot: ShaderSlot, pt: { x: number; y: number }, sharpen: boolean) => {
      const layerCanvas = getActiveLayerCanvas(slot);
      const dstCtx = layerCanvas.getContext('2d');
      const compCtx = slot.canvas.getContext('2d');
      if (!dstCtx || !compCtx) return;

      const w = slot.width;
      const h = slot.height;
      const radius = Math.max(2, Math.round(brushSize / 2));
      const cx = Math.round(pt.x);
      const cy = Math.round(pt.y);
      const compData = compCtx.getImageData(0, 0, w, h).data;
      const dstImg = dstCtx.getImageData(0, 0, w, h);
      const dstData = dstImg.data;
      const strength = Math.min(1, brushOpacity / 100);

      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const dSq = ox * ox + oy * oy;
          if (dSq > radius * radius) continue;
          const x = cx + ox;
          const y = cy + oy;
          if (x < 1 || x >= w - 1 || y < 1 || y >= h - 1) continue;

          // Compute 3x3 neighborhood average
          let rAvg = 0;
          let gAvg = 0;
          let bAvg = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const kIdx = ((y + ky) * w + (x + kx)) * 4;
              rAvg += compData[kIdx];
              gAvg += compData[kIdx + 1];
              bAvg += compData[kIdx + 2];
            }
          }
          rAvg /= 9;
          gAvg /= 9;
          bAvg /= 9;

          const cIdx = (y * w + x) * 4;
          const falloff = 1 - Math.sqrt(dSq) / (radius + 0.5);
          const mix = strength * falloff * 0.65;

          if (sharpen) {
            const amount = 1.6 * mix;
            dstData[cIdx] = Math.max(0, Math.min(255, Math.round(compData[cIdx] + (compData[cIdx] - rAvg) * amount)));
            dstData[cIdx + 1] = Math.max(
              0,
              Math.min(255, Math.round(compData[cIdx + 1] + (compData[cIdx + 1] - gAvg) * amount)),
            );
            dstData[cIdx + 2] = Math.max(
              0,
              Math.min(255, Math.round(compData[cIdx + 2] + (compData[cIdx + 2] - bAvg) * amount)),
            );
          } else {
            dstData[cIdx] = Math.round(compData[cIdx] * (1 - mix) + rAvg * mix);
            dstData[cIdx + 1] = Math.round(compData[cIdx + 1] * (1 - mix) + gAvg * mix);
            dstData[cIdx + 2] = Math.round(compData[cIdx + 2] * (1 - mix) + bAvg * mix);
          }
          dstData[cIdx + 3] = 255;
        }
      }

      dstCtx.putImageData(dstImg, 0, 0);
      compositeSlotLayers(slot);
      redraw2dCanvas();
    },
    [brushSize, brushOpacity, redraw2dCanvas],
  );

  // Commit Sharp Line / Sharp Rect / BBox Mask on mouse up
  const finishDragToolOnSlot = useCallback(
    (slot: ShaderSlot, startPt: { x: number; y: number }, endPt: { x: number; y: number }) => {
      if (activeTool === 'bbox-mask') {
        const rx = Math.max(0, Math.min(startPt.x, endPt.x));
        const ry = Math.max(0, Math.min(startPt.y, endPt.y));
        const rw = Math.min(slot.width - rx, Math.abs(endPt.x - startPt.x));
        const rh = Math.min(slot.height - ry, Math.abs(endPt.y - startPt.y));
        if (rw >= 4 && rh >= 4) {
          setBboxMask({ x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh) });
          setStatusMessage(
            `Active Bounding-Box Layer Mask set to (${Math.round(rx)}, ${Math.round(ry)}, ${Math.round(rw)}×${Math.round(rh)} px). All 3D & 2D painting is now clipped inside this box!`,
          );
          setActiveTool('brush');
        }
        redraw2dCanvas();
        return;
      }

      const layerCanvas = getActiveLayerCanvas(slot);
      const ctx = layerCanvas.getContext('2d');
      if (!ctx) return;

      if (activeTool === 'sharp-line') {
        if (preStrokeSnapshotRef.current) {
          slot.undoStack.push({ layerIdx: slot.activeLayerIdx, imageData: preStrokeSnapshotRef.current });
          if (slot.undoStack.length > 20) slot.undoStack.shift();
          slot.redoStack = [];
        }
        preparePaintContext(ctx, slot.activeLayerIdx > 0);
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'square';
        ctx.beginPath();
        ctx.moveTo(startPt.x, startPt.y);
        ctx.lineTo(endPt.x, endPt.y);
        ctx.stroke();
        ctx.restore();
        compositeSlotLayers(slot);
      } else if (activeTool === 'sharp-rect') {
        if (preStrokeSnapshotRef.current) {
          slot.undoStack.push({ layerIdx: slot.activeLayerIdx, imageData: preStrokeSnapshotRef.current });
          if (slot.undoStack.length > 20) slot.undoStack.shift();
          slot.redoStack = [];
        }
        preparePaintContext(ctx, slot.activeLayerIdx > 0);
        const rx = Math.min(startPt.x, endPt.x);
        const ry = Math.min(startPt.y, endPt.y);
        const rw = Math.abs(endPt.x - startPt.x);
        const rh = Math.abs(endPt.y - startPt.y);
        if (rectFilled) {
          ctx.fillRect(rx, ry, rw, rh);
        } else {
          ctx.lineWidth = Math.max(0.5, brushSize);
          ctx.strokeRect(rx, ry, rw, rh);
        }
        ctx.restore();
        compositeSlotLayers(slot);
      }
      redraw2dCanvas();
    },
    [activeTool, preparePaintContext, brushSize, rectFilled, redraw2dCanvas],
  );

  // Sample color with Eyedropper
  const samplePixelColor = useCallback((slot: ShaderSlot, pt: { x: number; y: number }) => {
    const ctx = slot.canvas.getContext('2d');
    if (!ctx) return;
    const px = Math.max(0, Math.min(slot.width - 1, Math.floor(pt.x)));
    const py = Math.max(0, Math.min(slot.height - 1, Math.floor(pt.y)));
    const data = ctx.getImageData(px, py, 1, 1).data;
    const hex = `#${data[0].toString(16).padStart(2, '0')}${data[1].toString(16).padStart(2, '0')}${data[2].toString(16).padStart(2, '0')}`;
    setBrushColor(hex);
    setFillMode('color');
    setActiveTool('brush');
  }, []);

  // Load selected item's 3D model and shader diffuse bitmaps
  const handleSelectItemToEdit = useCallback(
    async (item: TagEntrySummary) => {
      setSelectedTag(item);
      setChooserOpen(false);
      setIsLoadingItem(true);
      setStatusMessage(`Loading 3D model and textures for "${item.path}" (${item.primaryClassName})...`);
      setBboxMask(null);

      try {
        // Case 0: Unmerged Floating BSP Object from 3D BSP Studio
        if (item.primaryClassName === 'floating-bsp') {
          const floatIdx = -1000 - item.index;
          const floatObj = (window.__openceFloatingBspObjects ?? [])[floatIdx];
          if (!floatObj) {
            setStatusMessage(`Floating BSP object "${item.path}" was not found.`);
            setIsLoadingItem(false);
            return;
          }
          const width = floatObj.width || 1024;
          const height = floatObj.height || 1024;
          const c = document.createElement('canvas');
          c.width = width;
          c.height = height;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = '#475569';
          ctx.fillRect(0, 0, width, height);

          if (floatObj.textureDataUrl) {
            await new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                ctx.drawImage(img, 0, 0, width, height);
                resolve();
              };
              img.onerror = () => resolve();
              img.src = floatObj.textureDataUrl!;
            });
          } else if (floatObj.shaderTagId && floatObj.shaderTagId !== 0xffffffff) {
            const texRes = await window.opence.getBitmapTexture(floatObj.shaderTagId, 0);
            if (texRes.ok && texRes.texture) {
              const tmp = document.createElement('canvas');
              tmp.width = texRes.texture.width;
              tmp.height = texRes.texture.height;
              tmp.getContext('2d')!.putImageData(
                new ImageData(new Uint8ClampedArray(texRes.texture.rgbaData), texRes.texture.width, texRes.texture.height),
                0,
                0,
              );
              ctx.drawImage(tmp, 0, 0, width, height);
            }
          }

          const threeTex = new THREE.CanvasTexture(c);
          threeTex.flipY = false;
          threeTex.wrapS = THREE.RepeatWrapping;
          threeTex.wrapT = THREE.RepeatWrapping;
          threeTex.colorSpace = THREE.SRGBColorSpace;
          threeTex.needsUpdate = true;

          // Compute bounding box of floating object vertices
          let minX = Infinity, minY = Infinity, minZ = Infinity;
          let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
          const verts = floatObj.vertices;
          const vCount = Math.floor(verts.length / 8);
          for (let i = 0; i < vCount; i++) {
            const x = verts[i * 8 + 0];
            const y = verts[i * 8 + 1];
            const z = verts[i * 8 + 2];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
          }
          if (!Number.isFinite(minX)) {
            minX = -1; minY = -1; minZ = -1;
            maxX = 1; maxY = 1; maxZ = 1;
          }

          const synthGeom: ModelRenderGeometry = {
            modelTagId: item.tagId,
            submeshes: [
              {
                shaderIndex: 0,
                shaderTagId: floatObj.shaderTagId || item.tagId,
                shaderPath: floatObj.shaderPath || item.path,
                vertices: new Float32Array(verts),
                indices: new Uint32Array(floatObj.indices),
                vertexCount: vCount,
                triangleCount: Math.floor(floatObj.indices.length / 3),
              },
            ],
            boundingBox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
          };

          setModelGeometry(synthGeom);
          setShaderSlots([
            {
              shaderTagId: floatObj.shaderTagId || item.tagId,
              shaderPath: floatObj.shaderPath || item.path,
              bitmapTagIndex: floatObj.bitmapTagIndex,
              bitmapTagId: floatObj.bitmapTagId,
              bitmapPath: floatObj.bitmapPath || item.path,
              width,
              height,
              canvas: c,
              originalImageData: ctx.getImageData(0, 0, width, height),
              threeTexture: threeTex,
              layers: createInitialLayersForCanvas(c, width, height),
              activeLayerIdx: 1,
              undoStack: [],
              redoStack: [],
              dirty: false,
              floatingObjectId: floatObj.id,
            },
          ]);
          setActiveSlotIdx(0);
          setIsLoadingItem(false);
          setStatusMessage(
            `Loaded Floating BSP Object "${floatObj.name}" (${vCount} verts). Paint directly on it, then click Apply Painted Texture before merging into the BSP!`,
          );
          return;
        }

        // Case A: User picked a bitmap tag directly -> create a 3D preview box + plane with that bitmap
        if (item.primaryClassName === 'bitmap') {
          const texRes = await window.opence.getBitmapTexture(item.tagId, 0);
          if (!texRes.ok || !texRes.texture) {
            setStatusMessage(`Failed to decode bitmap "${item.path}": ${texRes.ok ? 'Empty' : texRes.message}`);
            setIsLoadingItem(false);
            return;
          }
          const srcW = texRes.texture.width;
          const srcH = texRes.texture.height;
          const scaleFactor =
            autoHdUpscale && Math.max(srcW, srcH) < 1024
              ? Math.max(1, Math.min(4, Math.floor(1024 / Math.max(1, Math.max(srcW, srcH)))))
              : 1;
          const width = srcW * scaleFactor;
          const height = srcH * scaleFactor;

          const tmp = document.createElement('canvas');
          tmp.width = srcW;
          tmp.height = srcH;
          tmp.getContext('2d')!.putImageData(
            new ImageData(new Uint8ClampedArray(texRes.texture.rgbaData), srcW, srcH),
            0,
            0,
          );

          const c = document.createElement('canvas');
          c.width = width;
          c.height = height;
          const ctx = c.getContext('2d')!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(tmp, 0, 0, width, height);

          const threeTex = new THREE.CanvasTexture(c);
          threeTex.flipY = false;
          threeTex.wrapS = THREE.RepeatWrapping;
          threeTex.wrapT = THREE.RepeatWrapping;
          threeTex.colorSpace = THREE.SRGBColorSpace;
          threeTex.needsUpdate = true;

          // Build a synthetic cube submesh so the user can paint on it in 3D + 2D
          const cubeGeom = new THREE.BoxGeometry(2.2, 2.2, 2.2);
          const posAttr = cubeGeom.getAttribute('position');
          const normAttr = cubeGeom.getAttribute('normal');
          const uvAttr = cubeGeom.getAttribute('uv');
          const idxAttr = cubeGeom.getIndex()!;
          const verts = new Float32Array(posAttr.count * 8);
          for (let i = 0; i < posAttr.count; i++) {
            verts[i * 8 + 0] = posAttr.getX(i);
            verts[i * 8 + 1] = posAttr.getY(i);
            verts[i * 8 + 2] = posAttr.getZ(i);
            verts[i * 8 + 3] = normAttr.getX(i);
            verts[i * 8 + 4] = normAttr.getY(i);
            verts[i * 8 + 5] = normAttr.getZ(i);
            verts[i * 8 + 6] = uvAttr.getX(i);
            verts[i * 8 + 7] = 1 - uvAttr.getY(i);
          }
          const indices = new Uint32Array(idxAttr.array);
          const synthGeom: ModelRenderGeometry = {
            modelTagId: item.tagId,
            submeshes: [
              {
                shaderIndex: 0,
                shaderTagId: item.tagId,
                shaderPath: item.path,
                vertices: verts,
                indices,
                vertexCount: posAttr.count,
                triangleCount: indices.length / 3,
              },
            ],
            boundingBox: { min: [-1.1, -1.1, -1.1], max: [1.1, 1.1, 1.1] },
          };

          setModelGeometry(synthGeom);
          setShaderSlots([
            {
              shaderTagId: item.tagId,
              shaderPath: item.path,
              bitmapTagIndex: item.index,
              bitmapTagId: item.tagId,
              bitmapPath: item.path,
              width,
              height,
              canvas: c,
              originalImageData: ctx.getImageData(0, 0, width, height),
              threeTexture: threeTex,
              layers: createInitialLayersForCanvas(c, width, height),
              activeLayerIdx: 1,
              undoStack: [],
              redoStack: [],
            },
          ]);
          setActiveSlotIdx(0);
          setIsLoadingItem(false);
          setStatusMessage(`Loaded bitmap "${item.path}" (${width}×${height}px) on 3D preview cube.`);
          return;
        }

        // Case B: Object tag or gbxmodel tag -> resolve modelTagId
        let modelTagId = item.primaryClassName === 'gbxmodel' ? item.tagId : 0xffffffff;
        if (modelTagId === 0xffffffff) {
          const slotsRes = await window.opence.getDependencySlots(item.index);
          if (slotsRes.ok) {
            const modSlot = slotsRes.slots.find(
              (s) =>
                (s.currentGroup === 'gbxmodel' || s.allowedClasses?.includes('gbxmodel')) &&
                s.currentTagId !== null &&
                s.currentTagId !== 0xffffffff,
            );
            if (modSlot && modSlot.currentTagId !== null) {
              modelTagId = modSlot.currentTagId;
            }
          }
        }

        if (modelTagId === 0xffffffff) {
          setStatusMessage(`"${item.path}" does not reference a 3D gbxmodel tag.`);
          setIsLoadingItem(false);
          return;
        }

        const geomRes = await window.opence.getModelGeometry(modelTagId, 4);
        if (!geomRes.ok || !geomRes.geometry || geomRes.geometry.submeshes.length === 0) {
          setStatusMessage(`Could not extract 3D geometry for "${item.path}".`);
          setIsLoadingItem(false);
          return;
        }

        const geom = geomRes.geometry;
        setModelGeometry(geom);

        // Resolve each unique shader's diffuse bitmap tag
        const uniqueShaders = new Map<number, string>();
        for (const sub of geom.submeshes) {
          if (sub.shaderTagId && sub.shaderTagId !== 0xffffffff && !uniqueShaders.has(sub.shaderTagId)) {
            uniqueShaders.set(sub.shaderTagId, sub.shaderPath || `shader_${sub.shaderIndex}`);
          }
        }
        if (uniqueShaders.size === 0 && geom.submeshes[0]) {
          uniqueShaders.set(geom.submeshes[0].shaderTagId || modelTagId, item.path);
        }

        const builtSlots: ShaderSlot[] = [];
        const slotByBitmapIndex = new Map<number, ShaderSlot>();
        for (const [shTagId, shPath] of uniqueShaders.entries()) {
          const shaderEntry =
            allTags.find((t) => t.tagId === shTagId) ??
            allTags.find((t) => (t.tagId & 0xffff) === (shTagId & 0xffff));

          let bitmapEntry: TagEntrySummary | undefined;
          if (shaderEntry) {
            const shDeps = await window.opence.getDependencySlots(shaderEntry.index);
            if (shDeps.ok) {
              // Prefer 'base map', 'map', 'diffuse', or first non-null bitmap slot
              const preferred =
                shDeps.slots.find(
                  (s) =>
                    (s.currentGroup === 'bitmap' || s.allowedClasses?.includes('bitmap')) &&
                    s.currentTagId !== null &&
                    s.currentTagId !== 0xffffffff &&
                    /base|map|diffuse|primary/i.test(s.fieldName),
                ) ??
                shDeps.slots.find(
                  (s) =>
                    (s.currentGroup === 'bitmap' || s.allowedClasses?.includes('bitmap')) &&
                    s.currentTagId !== null &&
                    s.currentTagId !== 0xffffffff,
                );
              if (preferred && preferred.currentTagId !== null) {
                bitmapEntry =
                  allTags.find((t) => t.tagId === preferred.currentTagId) ??
                  allTags.find((t) => (t.tagId & 0xffff) === (preferred.currentTagId! & 0xffff));
              }
            }
          }

          const bmpIndex = bitmapEntry?.index ?? -1;
          const existingShared = bmpIndex >= 0 ? slotByBitmapIndex.get(bmpIndex) : undefined;
          if (existingShared) {
            // Share canvas, threeTexture, layers, and undo/redo stacks with the existing slot for the same bitmap tag
            builtSlots.push({
              shaderTagId: shTagId,
              shaderPath: shPath,
              bitmapTagIndex: bmpIndex,
              bitmapTagId: existingShared.bitmapTagId,
              bitmapPath: existingShared.bitmapPath,
              width: existingShared.width,
              height: existingShared.height,
              canvas: existingShared.canvas,
              originalImageData: existingShared.originalImageData,
              threeTexture: existingShared.threeTexture,
              layers: existingShared.layers,
              activeLayerIdx: existingShared.activeLayerIdx,
              undoStack: existingShared.undoStack,
              redoStack: existingShared.redoStack,
              dirty: false,
            });
            continue;
          }

          const texRes = await window.opence.getBitmapTexture(shTagId, 0);
          let width = 1024;
          let height = 1024;
          const c = document.createElement('canvas');

          if (texRes.ok && texRes.texture) {
            const srcW = texRes.texture.width;
            const srcH = texRes.texture.height;
            const scaleFactor =
              autoHdUpscale && Math.max(srcW, srcH) < 1024
                ? Math.max(1, Math.min(4, Math.floor(1024 / Math.max(1, Math.max(srcW, srcH)))))
                : 1;
            width = srcW * scaleFactor;
            height = srcH * scaleFactor;
            const tmp = document.createElement('canvas');
            tmp.width = srcW;
            tmp.height = srcH;
            tmp.getContext('2d')!.putImageData(
              new ImageData(new Uint8ClampedArray(texRes.texture.rgbaData), srcW, srcH),
              0,
              0,
            );
            c.width = width;
            c.height = height;
            const ctx = c.getContext('2d')!;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(tmp, 0, 0, width, height);
          } else {
            c.width = width;
            c.height = height;
            const ctx = c.getContext('2d')!;
            ctx.fillStyle = '#334155';
            ctx.fillRect(0, 0, width, height);
          }

          const ctx = c.getContext('2d')!;
          const threeTex = new THREE.CanvasTexture(c);
          threeTex.flipY = false;
          threeTex.wrapS = THREE.RepeatWrapping;
          threeTex.wrapT = THREE.RepeatWrapping;
          threeTex.colorSpace = THREE.SRGBColorSpace;
          threeTex.needsUpdate = true;

          const newSlot: ShaderSlot = {
            shaderTagId: shTagId,
            shaderPath: shPath,
            bitmapTagIndex: bmpIndex,
            bitmapTagId: bitmapEntry?.tagId ?? shTagId,
            bitmapPath: bitmapEntry?.path ?? shPath,
            width,
            height,
            canvas: c,
            originalImageData: ctx.getImageData(0, 0, width, height),
            threeTexture: threeTex,
            layers: createInitialLayersForCanvas(c, width, height),
            activeLayerIdx: 1,
            undoStack: [],
            redoStack: [],
            dirty: false,
          };
          builtSlots.push(newSlot);
          if (bmpIndex >= 0) {
            slotByBitmapIndex.set(bmpIndex, newSlot);
          }
        }

        setShaderSlots(builtSlots);
        setActiveSlotIdx(0);
        setIsLoadingItem(false);
        setStatusMessage(
          `Loaded "${item.path}" with ${geom.submeshes.length} 3D submesh(es) and ${builtSlots.length} paintable shader texture slot(s). Left-drag on the 3D model to paint; Right-drag to orbit!`,
        );
      } catch (err) {
        setIsLoadingItem(false);
        setStatusMessage(`Failed to load item: ${(err as Error).message}`);
      }
    },
    [allTags, autoHdUpscale],
  );

  // Initialize Three.js 3D Viewport
  useEffect(() => {
    const container = threeContainerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.05,
      500,
    );
    camera.up.set(0, 0, 1);
    camera.position.set(3.2, -3.2, 2.0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // Allow right-click drag and middle-click drag for orbiting at all times; left-click orbits only when activeTool === 'orbit'
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controlsRef.current = controls;

    // Studio Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 1.35);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(6, -6, 9);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.75);
    fillLight.position.set(-6, 6, 4);
    scene.add(fillLight);

    // Subtle floor grid in Halo Z-up space
    const grid = new THREE.GridHelper(10, 20, 0x38bdf8, 0x1e293b);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      if (!container || !renderer || !camera) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Configure OrbitControls left-button behavior depending on whether the user is in 'orbit' tool or a paint tool
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.mouseButtons = {
      LEFT: activeTool === 'orbit' ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE),
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
  }, [activeTool]);

  // Handle dragging the center splitter between 3D View and 2D UV View
  useEffect(() => {
    if (!isDraggingSplitter) return;
    const handleMouseMove = (e: MouseEvent) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.max(15, Math.min(85, pct)));
    };
    const handleMouseUp = () => {
      setIsDraggingSplitter(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSplitter]);

  // Ensure Three.js renderer resizes cleanly when 3D/2D visibility or splitter percent changes
  useEffect(() => {
    const container = threeContainerRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!container || !renderer || !camera || !show3dView) return;
    const id = requestAnimationFrame(() => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    return () => cancelAnimationFrame(id);
  }, [show3dView, show2dView, splitPercent]);

  const lastCenteredGeometryRef = useRef<ModelRenderGeometry | null>(null);

  // Populate 3D meshes when modelGeometry or shaderSlots change
  useEffect(() => {
    const modelGroup = modelGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!modelGroup || !modelGeometry) return;

    while (modelGroup.children.length > 0) {
      modelGroup.remove(modelGroup.children[0]);
    }
    meshListRef.current = [];

    const slotByShader = new Map<number, ShaderSlot>();
    for (const s of shaderSlots) {
      slotByShader.set(s.shaderTagId, s);
    }

    for (const sub of modelGeometry.submeshes) {
      if (sub.vertexCount === 0 || sub.indices.length === 0) continue;
      const geom = new THREE.BufferGeometry();
      const vCount = sub.vertexCount;
      const positions = new Float32Array(vCount * 3);
      const normals = new Float32Array(vCount * 3);
      const uvs = new Float32Array(vCount * 2);
      const rawVerts = sub.vertices;
      for (let i = 0; i < vCount; i++) {
        const base = i * 8;
        positions[i * 3 + 0] = rawVerts[base + 0];
        positions[i * 3 + 1] = rawVerts[base + 1];
        positions[i * 3 + 2] = rawVerts[base + 2];
        normals[i * 3 + 0] = rawVerts[base + 3];
        normals[i * 3 + 1] = rawVerts[base + 4];
        normals[i * 3 + 2] = rawVerts[base + 5];
        uvs[i * 2 + 0] = rawVerts[base + 6];
        uvs[i * 2 + 1] = rawVerts[base + 7];
      }
      const indicesArr =
        sub.indices instanceof Uint32Array
          ? sub.indices
          : new Uint32Array(Array.from(sub.indices as ArrayLike<number>));
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geom.setIndex(new THREE.BufferAttribute(indicesArr, 1));
      geom.computeBoundingBox();
      geom.computeBoundingSphere();

      const slot = slotByShader.get(sub.shaderTagId) ?? shaderSlots[0];
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.6,
        metalness: 0.1,
        side: THREE.DoubleSide,
        map: slot ? slot.threeTexture : null,
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { shaderTagId: sub.shaderTagId };
      modelGroup.add(mesh);

      const wireGeom = new THREE.WireframeGeometry(geom);
      const wireMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.45,
      });
      const wire = new THREE.LineSegments(wireGeom, wireMat);
      wire.visible = showWireframe3d;
      mesh.add(wire);

      meshListRef.current.push({ mesh, wire, shaderTagId: sub.shaderTagId });
    }

    // Center camera on model bounding box only when a new modelGeometry is loaded
    if (camera && controls && lastCenteredGeometryRef.current !== modelGeometry) {
      lastCenteredGeometryRef.current = modelGeometry;
      const box = new THREE.Box3().setFromObject(modelGroup);
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 0.5);
        controls.target.copy(center);
        camera.position.set(
          center.x + maxDim * 1.45,
          center.y - maxDim * 1.45,
          center.z + maxDim * 0.85,
        );
        controls.update();
      }
    }
  }, [modelGeometry, shaderSlots]);

  // Toggle 3D wireframe visibility
  useEffect(() => {
    for (const item of meshListRef.current) {
      item.wire.visible = showWireframe3d;
    }
  }, [showWireframe3d]);

  // Raycast helper on the 3D Viewport
  const raycast3dModel = useCallback(
    (clientX: number, clientY: number) => {
      const container = threeContainerRef.current;
      const camera = cameraRef.current;
      if (!container || !camera || meshListRef.current.length === 0) return null;
      const rect = container.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const meshes = meshListRef.current.map((m) => m.mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length === 0) return null;
      const hit = hits[0];
      if (!hit.uv) return null;

      const hitShaderId = (hit.object.userData?.shaderTagId as number) ?? activeSlot?.shaderTagId;
      let slotIdx = shaderSlots.findIndex((s) => s.shaderTagId === hitShaderId);
      if (slotIdx < 0) slotIdx = activeSlotIdx;
      const slot = shaderSlots[slotIdx];
      if (!slot) return null;

      const u = ((hit.uv.x % 1) + 1) % 1;
      const v = ((hit.uv.y % 1) + 1) % 1;
      const px = u * slot.width;
      const py = v * slot.height;

      // Also extract the hit triangle's 3 UV coordinates if face/triangle fill is used
      let triUvs: [{ u: number; v: number }, { u: number; v: number }, { u: number; v: number }] | null = null;
      const hitMesh = hit.object instanceof THREE.Mesh ? hit.object : null;
      const faceIndex = typeof hit.faceIndex === 'number' ? hit.faceIndex : -1;
      if (hit.face && hitMesh) {
        const uvAttr = hitMesh.geometry.getAttribute('uv');
        if (uvAttr) {
          triUvs = [
            { u: uvAttr.getX(hit.face.a), v: uvAttr.getY(hit.face.a) },
            { u: uvAttr.getX(hit.face.b), v: uvAttr.getY(hit.face.b) },
            { u: uvAttr.getX(hit.face.c), v: uvAttr.getY(hit.face.c) },
          ];
        }
      }

      return { slot, slotIdx, pt: { x: px, y: py }, triUvs, hitMesh, faceIndex };
    },
    [activeSlot, shaderSlots, activeSlotIdx],
  );

  // 3D Viewport Pointer Handlers
  const handle3dPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || activeTool === 'orbit') return;
    const hit = raycast3dModel(e.clientX, e.clientY);
    if (!hit) return;

    if (hit.slotIdx !== activeSlotIdx) {
      setActiveSlotIdx(hit.slotIdx);
    }

    if (activeTool === 'eyedropper') {
      samplePixelColor(hit.slot, hit.pt);
      return;
    }

    if (activeTool === 'tri-fill' && hit.triUvs) {
      fillUvTriangleOnSlot(hit.slot, hit.triUvs[0], hit.triUvs[1], hit.triUvs[2]);
      return;
    }

    if (activeTool === 'uv-island' && hit.hitMesh && hit.faceIndex >= 0) {
      fillContiguousUvIslandOnSlot(hit.slot, hit.hitMesh, hit.faceIndex);
      return;
    }

    if (activeTool === 'clone' && (e.altKey || !cloneSourcePt)) {
      setCloneSourcePt({ x: Math.round(hit.pt.x), y: Math.round(hit.pt.y) });
      cloneOffsetRef.current = null;
      setStatusMessage(
        `Clone Stamp source ⊕ set to (${Math.round(hit.pt.x)}, ${Math.round(hit.pt.y)}). Drag on 3D model or 2D UV to clone! (Alt+Click to pick a new source)`,
      );
      return;
    }

    if (activeTool === 'stamp') {
      paintDecalStampOnSlot(hit.slot, hit.pt);
      return;
    }

    if (activeTool === 'bucket') {
      floodFillOnSlot(hit.slot, hit.pt);
      return;
    }

    const activeLayerC = getActiveLayerCanvas(hit.slot);
    const ctx = activeLayerC.getContext('2d');
    if (ctx) {
      preStrokeSnapshotRef.current = ctx.getImageData(0, 0, hit.slot.width, hit.slot.height);
    }
    isPaintingRef.current = true;
    lastSlotIdxRef.current = hit.slotIdx;
    lastUvPixelRef.current = hit.pt;
    dragStartPixelRef.current = hit.pt;
    dragCurrentPixelRef.current = hit.pt;
    cloneOffsetRef.current = null;
    smudgeBufferRef.current = null;

    if (
      activeTool === 'brush' ||
      activeTool === 'eraser' ||
      activeTool === 'airbrush' ||
      activeTool === 'clone' ||
      activeTool === 'smudge' ||
      activeTool === 'blur-sharpen'
    ) {
      if (preStrokeSnapshotRef.current) {
        hit.slot.undoStack.push({ layerIdx: hit.slot.activeLayerIdx, imageData: preStrokeSnapshotRef.current });
        if (hit.slot.undoStack.length > 20) hit.slot.undoStack.shift();
        hit.slot.redoStack = [];
      }
      if (activeTool === 'brush' || activeTool === 'eraser') {
        paintStrokeSegment(hit.slot, hit.pt, hit.pt);
      } else if (activeTool === 'airbrush') {
        paintAirbrushSegment(hit.slot, hit.pt, hit.pt);
      } else if (activeTool === 'clone') {
        paintCloneSegment(hit.slot, hit.pt, hit.pt);
      } else if (activeTool === 'smudge') {
        paintSmudgeSegment(hit.slot, hit.pt, hit.pt);
      } else if (activeTool === 'blur-sharpen') {
        paintBlurSharpenSegment(hit.slot, hit.pt, e.shiftKey || convolveSharpen);
      }
    }
  };

  const handle3dPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPaintingRef.current || activeTool === 'orbit') return;
    const hit = raycast3dModel(e.clientX, e.clientY);
    if (!hit) return;

    // Seamless cross-slot painting when dragging across submeshes that use different bitmaps (e.g., Warthog hull -> tires -> chaingun)
    let crossedSlot = false;
    if (hit.slotIdx !== lastSlotIdxRef.current) {
      crossedSlot = true;
      lastSlotIdxRef.current = hit.slotIdx;
      setActiveSlotIdx(hit.slotIdx);
      lastUvPixelRef.current = hit.pt;
      if (
        activeTool === 'brush' ||
        activeTool === 'eraser' ||
        activeTool === 'airbrush' ||
        activeTool === 'clone' ||
        activeTool === 'smudge' ||
        activeTool === 'blur-sharpen'
      ) {
        const activeLayerC = getActiveLayerCanvas(hit.slot);
        const ctx = activeLayerC.getContext('2d');
        if (ctx) {
          const snap = ctx.getImageData(0, 0, hit.slot.width, hit.slot.height);
          hit.slot.undoStack.push({ layerIdx: hit.slot.activeLayerIdx, imageData: snap });
          if (hit.slot.undoStack.length > 20) hit.slot.undoStack.shift();
          hit.slot.redoStack = [];
        }
      }
    }

    dragCurrentPixelRef.current = hit.pt;
    const prev = crossedSlot ? hit.pt : (lastUvPixelRef.current ?? hit.pt);
    const dist = Math.hypot(hit.pt.x - prev.x, hit.pt.y - prev.y);
    const sameIsland = !crossedSlot && dist < hit.slot.width * 0.35;

    if (activeTool === 'brush' || activeTool === 'eraser') {
      paintStrokeSegment(hit.slot, sameIsland ? prev : hit.pt, hit.pt);
      lastUvPixelRef.current = hit.pt;
    } else if (activeTool === 'airbrush') {
      paintAirbrushSegment(hit.slot, sameIsland ? prev : hit.pt, hit.pt);
      lastUvPixelRef.current = hit.pt;
    } else if (activeTool === 'clone') {
      paintCloneSegment(hit.slot, sameIsland ? prev : hit.pt, hit.pt);
      lastUvPixelRef.current = hit.pt;
    } else if (activeTool === 'smudge') {
      paintSmudgeSegment(hit.slot, sameIsland ? prev : hit.pt, hit.pt);
      lastUvPixelRef.current = hit.pt;
    } else if (activeTool === 'blur-sharpen') {
      paintBlurSharpenSegment(hit.slot, hit.pt, e.shiftKey || convolveSharpen);
      lastUvPixelRef.current = hit.pt;
    } else if (activeTool === 'sharp-line' || activeTool === 'sharp-rect' || activeTool === 'bbox-mask') {
      redraw2dCanvas();
    }
  };

  const handle3dPointerUp = () => {
    if (!isPaintingRef.current) return;
    if (
      activeSlot &&
      dragStartPixelRef.current &&
      dragCurrentPixelRef.current &&
      (activeTool === 'sharp-line' || activeTool === 'sharp-rect' || activeTool === 'bbox-mask')
    ) {
      finishDragToolOnSlot(activeSlot, dragStartPixelRef.current, dragCurrentPixelRef.current);
    }
    isPaintingRef.current = false;
    lastUvPixelRef.current = null;
    dragStartPixelRef.current = null;
    dragCurrentPixelRef.current = null;
    cloneOffsetRef.current = null;
    smudgeBufferRef.current = null;
  };

  // 2D UV Canvas Pointer & Zoom/Pan Handlers
  const get2dCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const c = uvCanvasRef.current;
    if (!c || !activeSlot) return null;
    const rect = c.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * activeSlot.width;
    const y = ((e.clientY - rect.top) / rect.height) * activeSlot.height;
    return { x, y };
  };

  const handle2dWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom2d((prev) => {
      const next = Math.max(0.5, Math.min(8, Number((prev * factor).toFixed(2))));
      if (Math.abs(next - 1) < 0.05) {
        setPan2d({ x: 0, y: 0 });
      }
      return next;
    });
  };

  const handle2dPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Middle-click or Right-click pans the zoomed 2D canvas
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      isPanning2dRef.current = { startX: e.clientX, startY: e.clientY, origX: pan2d.x, origY: pan2d.y };
      return;
    }
    if (e.button !== 0 || !activeSlot) return;
    const pt = get2dCanvasCoords(e);
    if (!pt) return;

    if (activeTool === 'eyedropper') {
      samplePixelColor(activeSlot, pt);
      return;
    }

    if (activeTool === 'clone' && (e.altKey || !cloneSourcePt)) {
      setCloneSourcePt({ x: Math.round(pt.x), y: Math.round(pt.y) });
      cloneOffsetRef.current = null;
      setStatusMessage(
        `Clone Stamp source ⊕ set to (${Math.round(pt.x)}, ${Math.round(pt.y)}). Drag on 2D UV or 3D model to clone! (Alt+Click to pick a new source)`,
      );
      return;
    }

    if (activeTool === 'stamp') {
      paintDecalStampOnSlot(activeSlot, pt);
      return;
    }

    if (activeTool === 'bucket') {
      floodFillOnSlot(activeSlot, pt);
      return;
    }

    const activeLayerC = getActiveLayerCanvas(activeSlot);
    const ctx = activeLayerC.getContext('2d');
    if (ctx) {
      preStrokeSnapshotRef.current = ctx.getImageData(0, 0, activeSlot.width, activeSlot.height);
    }
    isPaintingRef.current = true;
    lastUvPixelRef.current = pt;
    dragStartPixelRef.current = pt;
    dragCurrentPixelRef.current = pt;
    cloneOffsetRef.current = null;
    smudgeBufferRef.current = null;

    if (
      activeTool === 'brush' ||
      activeTool === 'eraser' ||
      activeTool === 'airbrush' ||
      activeTool === 'clone' ||
      activeTool === 'smudge' ||
      activeTool === 'blur-sharpen'
    ) {
      if (preStrokeSnapshotRef.current) {
        activeSlot.undoStack.push({ layerIdx: activeSlot.activeLayerIdx, imageData: preStrokeSnapshotRef.current });
        if (activeSlot.undoStack.length > 20) activeSlot.undoStack.shift();
        activeSlot.redoStack = [];
      }
      if (activeTool === 'brush' || activeTool === 'eraser') {
        paintStrokeSegment(activeSlot, pt, pt);
      } else if (activeTool === 'airbrush') {
        paintAirbrushSegment(activeSlot, pt, pt);
      } else if (activeTool === 'clone') {
        paintCloneSegment(activeSlot, pt, pt);
      } else if (activeTool === 'smudge') {
        paintSmudgeSegment(activeSlot, pt, pt);
      } else if (activeTool === 'blur-sharpen') {
        paintBlurSharpenSegment(activeSlot, pt, e.shiftKey || convolveSharpen);
      }
    }
  };

  const handle2dPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning2dRef.current) {
      const dx = e.clientX - isPanning2dRef.current.startX;
      const dy = e.clientY - isPanning2dRef.current.startY;
      setPan2d({ x: isPanning2dRef.current.origX + dx, y: isPanning2dRef.current.origY + dy });
      return;
    }
    if (!isPaintingRef.current || !activeSlot) return;
    const pt = get2dCanvasCoords(e);
    if (!pt) return;
    dragCurrentPixelRef.current = pt;

    if (activeTool === 'brush' || activeTool === 'eraser') {
      const prev = lastUvPixelRef.current ?? pt;
      paintStrokeSegment(activeSlot, prev, pt);
      lastUvPixelRef.current = pt;
    } else if (activeTool === 'airbrush') {
      const prev = lastUvPixelRef.current ?? pt;
      paintAirbrushSegment(activeSlot, prev, pt);
      lastUvPixelRef.current = pt;
    } else if (activeTool === 'clone') {
      const prev = lastUvPixelRef.current ?? pt;
      paintCloneSegment(activeSlot, prev, pt);
      lastUvPixelRef.current = pt;
    } else if (activeTool === 'smudge') {
      const prev = lastUvPixelRef.current ?? pt;
      paintSmudgeSegment(activeSlot, prev, pt);
      lastUvPixelRef.current = pt;
    } else if (activeTool === 'blur-sharpen') {
      paintBlurSharpenSegment(activeSlot, pt, e.shiftKey || convolveSharpen);
      lastUvPixelRef.current = pt;
    } else if (activeTool === 'sharp-line' || activeTool === 'sharp-rect' || activeTool === 'bbox-mask') {
      redraw2dCanvas();
    }
  };

  const handle2dPointerUp = () => {
    if (isPanning2dRef.current) {
      isPanning2dRef.current = null;
      return;
    }
    if (!isPaintingRef.current || !activeSlot) return;
    if (
      dragStartPixelRef.current &&
      dragCurrentPixelRef.current &&
      (activeTool === 'sharp-line' || activeTool === 'sharp-rect' || activeTool === 'bbox-mask')
    ) {
      finishDragToolOnSlot(activeSlot, dragStartPixelRef.current, dragCurrentPixelRef.current);
    }
    isPaintingRef.current = false;
    lastUvPixelRef.current = null;
    dragStartPixelRef.current = null;
    dragCurrentPixelRef.current = null;
    cloneOffsetRef.current = null;
    smudgeBufferRef.current = null;
  };

  // 1-Click UV Seam Bleed Dilation (+4px) on Active Layer
  const handleDilateActiveLayerSeamBleed = () => {
    if (!activeSlot) return;
    const layerCanvas = getActiveLayerCanvas(activeSlot);
    const ctx = layerCanvas.getContext('2d');
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, activeSlot.width, activeSlot.height);
    activeSlot.undoStack.push({ layerIdx: activeSlot.activeLayerIdx, imageData: snap });
    if (activeSlot.undoStack.length > 20) activeSlot.undoStack.shift();
    activeSlot.redoStack = [];
    dilateCanvasSeamBleed(layerCanvas, 4);
    compositeSlotLayers(activeSlot);
    redraw2dCanvas();
    setStatusMessage('Dilated active layer edges outward by +4px (UV Seam Bleed padding) to prevent mipmap seams!');
  };

  // GIMP-Style HSV / Brightness Adjustment on Active Layer
  const handleApplyLayerHsvAdjustment = () => {
    if (!activeSlot || (hsvHue === 0 && hsvSat === 0 && hsvVal === 0)) return;
    const layerCanvas = getActiveLayerCanvas(activeSlot);
    const ctx = layerCanvas.getContext('2d');
    if (!ctx) return;
    const w = activeSlot.width;
    const h = activeSlot.height;
    const snap = ctx.getImageData(0, 0, w, h);
    activeSlot.undoStack.push({ layerIdx: activeSlot.activeLayerIdx, imageData: snap });
    if (activeSlot.undoStack.length > 20) activeSlot.undoStack.shift();
    activeSlot.redoStack = [];

    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const hueShift = ((hsvHue % 360) + 360) % 360;
    const satMult = Math.max(0, 1 + hsvSat / 100);
    const valOffset = (hsvVal / 100) * 255;

    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let r = d[i] / 255;
      let g = d[i + 1] / 255;
      let b = d[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      let hh = 0;
      if (delta !== 0) {
        if (max === r) hh = ((g - b) / delta) % 6;
        else if (max === g) hh = (b - r) / delta + 2;
        else hh = (r - g) / delta + 4;
        hh = Math.round(hh * 60);
        if (hh < 0) hh += 360;
      }
      const ss = max === 0 ? 0 : delta / max;
      const vv = max;

      const newH = (hh + hueShift) % 360;
      const newS = Math.max(0, Math.min(1, ss * satMult));
      const newV = Math.max(0, Math.min(1, vv + valOffset / 255));

      const c = newV * newS;
      const x = c * (1 - Math.abs(((newH / 60) % 2) - 1));
      const m = newV - c;
      let rp = 0;
      let gp = 0;
      let bp = 0;
      if (newH < 60) [rp, gp, bp] = [c, x, 0];
      else if (newH < 120) [rp, gp, bp] = [x, c, 0];
      else if (newH < 180) [rp, gp, bp] = [0, c, x];
      else if (newH < 240) [rp, gp, bp] = [0, x, c];
      else if (newH < 300) [rp, gp, bp] = [x, 0, c];
      else [rp, gp, bp] = [c, 0, x];

      d[i] = Math.round((rp + m) * 255);
      d[i + 1] = Math.round((gp + m) * 255);
      d[i + 2] = Math.round((bp + m) * 255);
    }

    ctx.putImageData(imgData, 0, 0);
    compositeSlotLayers(activeSlot);
    redraw2dCanvas();
    setHsvHue(0);
    setHsvSat(0);
    setHsvVal(0);
    setStatusMessage('Applied HSV / Brightness color adjustment to active layer!');
  };

  // Fill Active Bounding Box (or Entire Layer) in 1 click
  const handleFillActiveRegion = () => {
    if (!activeSlot) return;
    const layerCanvas = getActiveLayerCanvas(activeSlot);
    const ctx = layerCanvas.getContext('2d');
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, activeSlot.width, activeSlot.height);
    activeSlot.undoStack.push({ layerIdx: activeSlot.activeLayerIdx, imageData: snap });
    if (activeSlot.undoStack.length > 20) activeSlot.undoStack.shift();
    activeSlot.redoStack = [];

    preparePaintContext(ctx, activeSlot.activeLayerIdx > 0);
    if (bboxMask) {
      ctx.fillRect(bboxMask.x, bboxMask.y, bboxMask.w, bboxMask.h);
    } else {
      ctx.fillRect(0, 0, activeSlot.width, activeSlot.height);
    }
    ctx.restore();
    compositeSlotLayers(activeSlot);
    redraw2dCanvas();
  };

  // --- Multi-Layer System Handlers ---
  const handleAddLayer = () => {
    if (!activeSlot) return;
    const newCanvas = document.createElement('canvas');
    newCanvas.width = activeSlot.width;
    newCanvas.height = activeSlot.height;
    const newIdx = activeSlot.layers.length;
    activeSlot.layers.push({
      id: `layer-${Date.now()}-${newIdx}`,
      name: `Paint Layer ${newIdx}`,
      visible: true,
      opacity: 100,
      blendMode: 'source-over',
      canvas: newCanvas,
    });
    activeSlot.activeLayerIdx = newIdx;
    compositeSlotLayers(activeSlot);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
  };

  const handleDuplicateLayer = () => {
    if (!activeSlot) return;
    const src = activeSlot.layers[activeSlot.activeLayerIdx];
    if (!src) return;
    const dupCanvas = document.createElement('canvas');
    dupCanvas.width = activeSlot.width;
    dupCanvas.height = activeSlot.height;
    dupCanvas.getContext('2d')!.drawImage(src.canvas, 0, 0);
    const insertIdx = activeSlot.activeLayerIdx + 1;
    activeSlot.layers.splice(insertIdx, 0, {
      id: `layer-dup-${Date.now()}`,
      name: `${src.name} Copy`,
      visible: src.visible,
      opacity: src.opacity,
      blendMode: src.blendMode,
      canvas: dupCanvas,
    });
    activeSlot.activeLayerIdx = insertIdx;
    compositeSlotLayers(activeSlot);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
  };

  const handleMergeLayerDown = () => {
    if (!activeSlot || activeSlot.activeLayerIdx <= 0) return;
    const topIdx = activeSlot.activeLayerIdx;
    const botIdx = topIdx - 1;
    const topLayer = activeSlot.layers[topIdx];
    const botLayer = activeSlot.layers[botIdx];
    if (!topLayer || !botLayer) return;

    const botCtx = botLayer.canvas.getContext('2d')!;
    botCtx.save();
    botCtx.globalAlpha = Math.max(0, Math.min(1, topLayer.opacity / 100));
    botCtx.globalCompositeOperation = topLayer.blendMode;
    botCtx.drawImage(topLayer.canvas, 0, 0);
    botCtx.restore();

    activeSlot.layers.splice(topIdx, 1);
    activeSlot.activeLayerIdx = botIdx;
    compositeSlotLayers(activeSlot);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
  };

  const handleDeleteLayer = () => {
    if (!activeSlot || activeSlot.layers.length <= 1) return;
    const delIdx = activeSlot.activeLayerIdx;
    if (delIdx === 0 && activeSlot.layers.length > 1) {
      // Clear active overlay layer instead of deleting Base Texture if user clicks delete on layer 0
      const c = activeSlot.layers[1]?.canvas;
      if (c) c.getContext('2d')?.clearRect(0, 0, activeSlot.width, activeSlot.height);
    } else {
      activeSlot.layers.splice(delIdx, 1);
      activeSlot.activeLayerIdx = Math.max(0, delIdx - 1);
    }
    compositeSlotLayers(activeSlot);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
  };

  const handleToggleLayerVisible = (idx: number) => {
    if (!activeSlot || !activeSlot.layers[idx]) return;
    activeSlot.layers[idx].visible = !activeSlot.layers[idx].visible;
    compositeSlotLayers(activeSlot);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
  };

  const handleChangeLayerOpacity = (opacity: number) => {
    if (!activeSlot) return;
    const layer = activeSlot.layers[activeSlot.activeLayerIdx];
    if (!layer) return;
    layer.opacity = opacity;
    compositeSlotLayers(activeSlot);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
  };

  const handleChangeLayerBlendMode = (mode: BlendModeKind) => {
    if (!activeSlot) return;
    const layer = activeSlot.layers[activeSlot.activeLayerIdx];
    if (!layer) return;
    layer.blendMode = mode;
    compositeSlotLayers(activeSlot);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
  };

  const handleUndo = useCallback(() => {
    if (!activeSlot || activeSlot.undoStack.length === 0) return;
    const prev = activeSlot.undoStack.pop()!;
    const targetLayer = activeSlot.layers[prev.layerIdx] ?? activeSlot.layers[activeSlot.activeLayerIdx];
    if (!targetLayer) return;
    const ctx = targetLayer.canvas.getContext('2d');
    if (!ctx) return;
    const current = ctx.getImageData(0, 0, activeSlot.width, activeSlot.height);
    activeSlot.redoStack.push({ layerIdx: prev.layerIdx, imageData: current });
    ctx.putImageData(prev.imageData, 0, 0);
    compositeSlotLayers(activeSlot);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
  }, [activeSlot, redraw2dCanvas]);

  const handleRedo = useCallback(() => {
    if (!activeSlot || activeSlot.redoStack.length === 0) return;
    const next = activeSlot.redoStack.pop()!;
    const targetLayer = activeSlot.layers[next.layerIdx] ?? activeSlot.layers[activeSlot.activeLayerIdx];
    if (!targetLayer) return;
    const ctx = targetLayer.canvas.getContext('2d');
    if (!ctx) return;
    const current = ctx.getImageData(0, 0, activeSlot.width, activeSlot.height);
    activeSlot.undoStack.push({ layerIdx: next.layerIdx, imageData: current });
    ctx.putImageData(next.imageData, 0, 0);
    compositeSlotLayers(activeSlot);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
  }, [activeSlot, redraw2dCanvas]);

  // Keyboard shortcuts: Ctrl+Z (Undo) and Ctrl+Y / Ctrl+Shift+Z (Redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  const handleResetSlot = () => {
    if (!activeSlot) return;
    const ctx = activeSlot.canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(activeSlot.originalImageData, 0, 0);
    activeSlot.layers = createInitialLayersForCanvas(activeSlot.canvas, activeSlot.width, activeSlot.height);
    activeSlot.activeLayerIdx = 1;
    activeSlot.undoStack = [];
    activeSlot.redoStack = [];
    compositeSlotLayers(activeSlot);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
  };

  // Upscale active texture slot resolution (e.g. 2x up to 1024x1024 or 2048x2048) for crisp fine-detail painting
  const handleUpscaleSlotResolution = (targetMaxDim?: number) => {
    if (!activeSlot) return;
    const curW = activeSlot.width;
    const curH = activeSlot.height;
    const newW = targetMaxDim ? targetMaxDim : Math.min(2048, curW * 2);
    const newH = targetMaxDim ? targetMaxDim : Math.min(2048, curH * 2);
    if (newW === curW && newH === curH) {
      setStatusMessage(`Texture "${activeSlot.bitmapPath}" is already at ${curW}×${curH}px.`);
      return;
    }

    for (const layer of activeSlot.layers) {
      const lTmp = document.createElement('canvas');
      lTmp.width = curW;
      lTmp.height = curH;
      lTmp.getContext('2d')!.drawImage(layer.canvas, 0, 0);
      layer.canvas.width = newW;
      layer.canvas.height = newH;
      const lCtx = layer.canvas.getContext('2d')!;
      lCtx.imageSmoothingEnabled = true;
      lCtx.imageSmoothingQuality = 'high';
      lCtx.drawImage(lTmp, 0, 0, newW, newH);
    }

    activeSlot.canvas.width = newW;
    activeSlot.canvas.height = newH;
    activeSlot.width = newW;
    activeSlot.height = newH;

    // Dispose the old WebGL texture (which has immutable texStorage2D dimensions in WebGL2)
    // and allocate a fresh THREE.CanvasTexture sized to (newW, newH) so live 3D painting continues seamlessly!
    const oldTex = activeSlot.threeTexture;
    const freshTex = new THREE.CanvasTexture(activeSlot.canvas);
    freshTex.flipY = false;
    freshTex.wrapS = THREE.RepeatWrapping;
    freshTex.wrapT = THREE.RepeatWrapping;
    freshTex.colorSpace = THREE.SRGBColorSpace;
    activeSlot.threeTexture = freshTex;

    compositeSlotLayers(activeSlot);
    freshTex.needsUpdate = true;

    const ctx = activeSlot.canvas.getContext('2d')!;
    const freshOriginal = ctx.getImageData(0, 0, newW, newH);
    activeSlot.originalImageData = freshOriginal;
    activeSlot.undoStack = [];
    activeSlot.redoStack = [];

    // Update any other shader slots that share the same underlying canvas / bitmap
    for (const s of shaderSlots) {
      if (s === activeSlot || s.canvas === activeSlot.canvas) {
        s.width = newW;
        s.height = newH;
        s.threeTexture = freshTex;
        s.originalImageData = freshOriginal;
      }
    }

    // Rebind live 3D mesh materials immediately so 3D viewport painting updates on every stroke
    for (const item of meshListRef.current) {
      const mat = item.mesh.material as THREE.MeshStandardMaterial;
      const matchingSlot = shaderSlots.find((s) => s.shaderTagId === item.shaderTagId) ?? shaderSlots[0];
      if (mat && (mat.map === oldTex || matchingSlot?.threeTexture === freshTex)) {
        mat.map = freshTex;
        mat.needsUpdate = true;
      }
    }
    try {
      oldTex?.dispose();
    } catch {
      /* ignore dispose errors */
    }

    // Scale active UV bounding-box mask if one is set so strokes aren't clipped to old resolution bounds
    if (bboxMask) {
      const sx = newW / Math.max(1, curW);
      const sy = newH / Math.max(1, curH);
      setBboxMask({
        x: Math.round(bboxMask.x * sx),
        y: Math.round(bboxMask.y * sy),
        w: Math.round(bboxMask.w * sx),
        h: Math.round(bboxMask.h * sy),
      });
    }

    setShaderSlots([...shaderSlots]);
    setLayerVersion((v) => v + 1);
    redraw2dCanvas();
    setStatusMessage(
      `Upscaled texture canvas and all layers to ${newW}×${newH}px HD! Live 3D model texture rebound and ready for painting.`,
    );
  };

  // Apply ALL painted/modified textures across all shader slots into the open map's bitmap tags in memory!
  const handleApplyToMapBitmap = async () => {
    if (!activeSlot) return;

    // 1. Update any Floating BSP Object textures first
    for (const slot of shaderSlots) {
      if (slot.floatingObjectId) {
        const floatObj = (window.__openceFloatingBspObjects ?? []).find((f) => f.id === slot.floatingObjectId);
        if (floatObj) {
          floatObj.textureDataUrl = slot.canvas.toDataURL('image/png');
          floatObj.width = slot.width;
          floatObj.height = slot.height;
          window.dispatchEvent(
            new CustomEvent('opence:floating-bsp-texture-updated', {
              detail: { id: floatObj.id, textureDataUrl: floatObj.textureDataUrl },
            }),
          );
        }
      }
    }

    if (!window.opence.replaceBitmapFromDataUrl) return;

    // Collect all unique writable bitmapTagIndex slots that were modified (or fallback to all writable slots on the item)
    const dirtyWritableByBmpIdx = new Map<number, ShaderSlot>();
    const allWritableByBmpIdx = new Map<number, ShaderSlot>();
    for (const slot of shaderSlots) {
      if (slot.bitmapTagIndex >= 0) {
        if (!allWritableByBmpIdx.has(slot.bitmapTagIndex)) {
          allWritableByBmpIdx.set(slot.bitmapTagIndex, slot);
        }
        if (slot.dirty && !dirtyWritableByBmpIdx.has(slot.bitmapTagIndex)) {
          dirtyWritableByBmpIdx.set(slot.bitmapTagIndex, slot);
        }
      }
    }

    const targetsToApply =
      dirtyWritableByBmpIdx.size > 0
        ? Array.from(dirtyWritableByBmpIdx.values())
        : allWritableByBmpIdx.size > 0
        ? Array.from(allWritableByBmpIdx.values())
        : [];

    if (targetsToApply.length === 0) {
      if (activeSlot.floatingObjectId) {
        setStatusMessage(
          `Applied painted texture to Floating BSP Object "${activeSlot.bitmapPath}"! Switch to 3D BSP/Model Studio to place or merge it into the BSP.`,
        );
      } else {
        setStatusMessage('Cannot apply: no writable bitmap tag index resolved for this item.');
      }
      return;
    }

    setIsApplying(true);
    setStatusMessage(
      `Encoding ${targetsToApply.length} painted bitmap texture(s) with mipmaps into map bitmap tag(s)...`,
    );

    const appliedNames: string[] = [];
    let lastError: string | null = null;

    for (const slot of targetsToApply) {
      const dataUrl = slot.canvas.toDataURL('image/png');
      const res = await window.opence.replaceBitmapFromDataUrl(slot.bitmapTagIndex, 0, dataUrl);
      if (res.ok) {
        for (const s of shaderSlots) {
          if (s.bitmapTagIndex === slot.bitmapTagIndex) s.dirty = false;
        }
        appliedNames.push(`${slot.bitmapPath.split('\\').pop() || slot.bitmapPath} (#${slot.bitmapTagIndex})`);
        window.dispatchEvent(
          new CustomEvent('opence:bitmap-updated', { detail: { tagIndex: slot.bitmapTagIndex } }),
        );
      } else {
        lastError = res.message ?? 'Unknown error';
      }
    }

    setIsApplying(false);
    setShaderSlots([...shaderSlots]);
    if (appliedNames.length > 0) {
      setStatusMessage(
        `Applied ${appliedNames.length} bitmap texture(s) [${appliedNames.join(', ')}] in memory! Switch to 3D Viewport or OpenCE Tag Test (or Ctrl+S to save).`,
      );
    } else {
      setStatusMessage(`Failed to apply bitmap(s): ${lastError ?? 'Unknown error'}`);
    }
  };

  return (
    <div
      data-testid="bitmap-3d-studio-panel"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        position: 'relative',
      }}
    >
      {/* Top Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          background: 'var(--bg-panel-header)',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <button
          data-testid="bitmap-3d-open-chooser-btn"
          onClick={() => setChooserOpen(true)}
          style={{
            padding: '6px 12px',
            background: 'rgba(56, 189, 248, 0.2)',
            border: '1px solid rgba(56, 189, 248, 0.55)',
            color: '#38bdf8',
            fontWeight: 700,
            fontSize: 12,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Choose Item to Edit...
        </button>

        {selectedTag && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>
              Editing: <strong style={{ color: 'var(--text-primary)' }}>[{selectedTag.primaryClassName}] {selectedTag.path}</strong>
            </span>
            {onOpenTagEditor && (
              <button
                onClick={() => onOpenTagEditor(selectedTag.index)}
                style={{
                  padding: '3px 8px',
                  fontSize: 11,
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-dim)',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Inspect Tag
              </button>
            )}
          </div>
        )}

        {/* Shader / Bitmap Slot Selector */}
        {shaderSlots.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Texture Slot:</span>
            <select
              data-testid="bitmap-3d-slot-select"
              value={activeSlotIdx}
              onChange={(e) => setActiveSlotIdx(Number(e.target.value))}
              style={{
                padding: '4px 8px',
                background: 'var(--bg-input, #1e1e1e)',
                border: '1px solid var(--border)',
                color: 'var(--accent-cyan)',
                fontWeight: 600,
                fontSize: 11.5,
                maxWidth: 320,
              }}
            >
              {shaderSlots.map((s, idx) => (
                <option key={s.shaderTagId} value={idx}>
                  #{idx + 1}: {s.bitmapPath.split('\\').pop()} ({s.width}×{s.height})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 3D & 2D View Visibility Toggles in the Cyan Bar */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          <button
            data-testid="bitmap-3d-toggle-3d-view-btn"
            onClick={() => {
              if (show3dView && !show2dView) {
                setShow3dView(false);
                setShow2dView(true);
              } else {
                setShow3dView((v) => !v);
              }
            }}
            style={{
              padding: '5px 10px',
              fontSize: 11.5,
              fontWeight: 700,
              background: show3dView ? 'rgba(56,189,248,0.22)' : 'rgba(15,23,42,0.55)',
              border: show3dView ? '1px solid #38bdf8' : '1px solid var(--border)',
              color: show3dView ? '#38bdf8' : 'var(--text-dim)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            title="Show or hide the 3D Model Viewport"
          >
            {show3dView ? '👁 Hide 3D View' : '👁 Show 3D View'}
          </button>
          <button
            data-testid="bitmap-3d-toggle-2d-view-btn"
            onClick={() => {
              if (show2dView && !show3dView) {
                setShow2dView(false);
                setShow3dView(true);
              } else {
                setShow2dView((v) => !v);
              }
            }}
            style={{
              padding: '5px 10px',
              fontSize: 11.5,
              fontWeight: 700,
              background: show2dView ? 'rgba(56,189,248,0.22)' : 'rgba(15,23,42,0.55)',
              border: show2dView ? '1px solid #38bdf8' : '1px solid var(--border)',
              color: show2dView ? '#38bdf8' : 'var(--text-dim)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            title="Show or hide the 2D UV & Bounding-Box View"
          >
            {show2dView ? '👁 Hide 2D UV View' : '👁 Show 2D UV View'}
          </button>
        </div>
      </div>

      {/* Status Banner */}
      {statusMessage && (
        <div
          style={{
            padding: '5px 12px',
            fontSize: 11.5,
            background: statusMessage.startsWith('Failed') ? 'rgba(239,68,68,0.16)' : 'rgba(56,189,248,0.12)',
            color: statusMessage.startsWith('Failed') ? '#f87171' : '#7dd3fc',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Main Workspace: Left Single-Column Tool Dock + Center 3D/2D Viewports + Right Brush/Texture/Layer Column */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left Single-Column Monochrome Tool Dock */}
        <div
          data-testid="bitmap-3d-gimp-tool-dock"
          style={{
            width: 44,
            flexShrink: 0,
            background: '#111823',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '8px 4px',
            gap: 4,
            overflowY: 'auto',
          }}
        >
          {GIMP_TOOLS_META.map((t) => {
            const isSelected = activeTool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`bitmap-3d-tool-${t.id}`}
                title={`${t.name} — ${t.hint}`}
                aria-label={t.name}
                onMouseEnter={() => setHoveredTool(t.id)}
                onMouseLeave={() => setHoveredTool(null)}
                onClick={() => setActiveTool(t.id)}
                style={{
                  width: 32,
                  height: 30,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  background: isSelected ? 'rgba(56, 189, 248, 0.24)' : 'rgba(15, 23, 42, 0.65)',
                  border: isSelected ? '1.5px solid #38bdf8' : '1px solid var(--border)',
                  color: isSelected ? '#ffffff' : '#9fb3c8',
                  borderRadius: 4,
                  cursor: 'pointer',
                  boxShadow: isSelected ? '0 0 6px rgba(56,189,248,0.28)' : 'none',
                }}
              >
                {t.icon}
              </button>
            );
          })}
        </div>

        {/* Center 3D + 2D Viewports with Adjustable Center Divider */}
        <div
          ref={splitContainerRef}
          style={{
            flex: 1,
            display: 'flex',
            minWidth: 0,
            minHeight: 0,
            position: 'relative',
            userSelect: isDraggingSplitter ? 'none' : 'auto',
          }}
        >
          {/* 3D Model Paint Viewport */}
          <div
            style={{
              width: show3dView && show2dView ? `${splitPercent}%` : show3dView ? '100%' : '0%',
              flex: show3dView && !show2dView ? 1 : undefined,
              display: show3dView ? 'flex' : 'none',
              flexDirection: 'column',
              position: 'relative',
              minWidth: 0,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: 10,
                zIndex: 5,
                background: 'rgba(15, 23, 42, 0.82)',
                border: '1px solid var(--border)',
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 11,
                color: 'var(--text-secondary)',
                pointerEvents: 'none',
              }}
            >
              <strong>3D In-Place Paint Viewport</strong> — Left-Drag: Paint on 3D Model | Right-Drag: Orbit Camera | Scroll: Zoom
            </div>
            <div
              ref={threeContainerRef}
              onPointerDown={handle3dPointerDown}
              onPointerMove={handle3dPointerMove}
              onPointerUp={handle3dPointerUp}
              onPointerLeave={handle3dPointerUp}
              style={{
                flex: 1,
                width: '100%',
                height: '100%',
                cursor: activeTool === 'orbit' ? 'grab' : 'crosshair',
              }}
            />
          </div>

          {/* Adjustable Center Divider Handle */}
          {show3dView && show2dView && (
            <div
              data-testid="bitmap-3d-center-splitter"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDraggingSplitter(true);
              }}
              title="Drag left or right to resize the 3D Model View and 2D UV View"
              style={{
                width: 6,
                flexShrink: 0,
                cursor: 'col-resize',
                background: isDraggingSplitter ? '#38bdf8' : 'rgba(56, 189, 248, 0.25)',
                borderLeft: '1px solid var(--border)',
                borderRight: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                transition: 'background 0.12s',
              }}
            >
              <div
                style={{
                  width: 2,
                  height: 36,
                  borderRadius: 2,
                  background: '#38bdf8',
                }}
              />
            </div>
          )}

          {/* 2D UV & Bounding-Box Layer Mask Viewport */}
          <div
            data-testid="bitmap-3d-2d-viewport"
            onWheel={handle2dWheel}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              flex: show2dView ? 1 : 0,
              display: show2dView ? 'flex' : 'none',
              flexDirection: 'column',
              background: '#090d16',
              position: 'relative',
              minWidth: 0,
              alignItems: 'center',
              justifyContent: 'center',
              padding: 12,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: 10,
                zIndex: 5,
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid var(--border)',
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 11,
                color: 'var(--text-secondary)',
                pointerEvents: 'none',
              }}
            >
              <strong>2D UV &amp; Skinning View</strong> — Scroll: Zoom | Right-Drag: Pan
              {bboxMask ? ` | Clip: (${bboxMask.x}, ${bboxMask.y}, ${bboxMask.w}×${bboxMask.h})` : ''}
            </div>

            {/* 2D Zoom Controls Badge */}
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 10,
                zIndex: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'rgba(15, 23, 42, 0.88)',
                border: '1px solid var(--border)',
                padding: '3px 6px',
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              <button
                type="button"
                onClick={() => setZoom2d((z) => Math.max(0.5, Number((z / 1.25).toFixed(2))))}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 3,
                  padding: '1px 6px',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
                title="Zoom Out 2D Texture"
              >
                −
              </button>
              <button
                type="button"
                data-testid="bitmap-3d-2d-zoom-reset"
                onClick={() => {
                  setZoom2d(1);
                  setPan2d({ x: 0, y: 0 });
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#38bdf8',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: 11,
                  minWidth: 44,
                }}
                title="Click to reset 2D zoom & pan to 100%"
              >
                {Math.round(zoom2d * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom2d((z) => Math.min(8, Number((z * 1.25).toFixed(2))))}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 3,
                  padding: '1px 6px',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
                title="Zoom In 2D Texture"
              >
                +
              </button>
            </div>

            <canvas
              ref={uvCanvasRef}
              onPointerDown={handle2dPointerDown}
              onPointerMove={handle2dPointerMove}
              onPointerUp={handle2dPointerUp}
              onPointerLeave={handle2dPointerUp}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                border: '1px solid #334155',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                cursor: 'crosshair',
                background: '#1e293b',
                transform: `translate(${pan2d.x}px, ${pan2d.y}px) scale(${zoom2d})`,
                transformOrigin: 'center center',
                imageRendering: zoom2d >= 2 ? 'pixelated' : 'auto',
              }}
            />
          </div>
        </div>

        {/* Right Column: Brush Shapes, Stroke & Texture Options, and Layer Settings */}
        <div
          style={{
            width: 335,
            flexShrink: 0,
            background: 'var(--bg-panel-header)',
            borderLeft: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: 12,
            gap: 11,
          }}
        >
          {/* Active Tool Readout & Quick Brush Shape Selector */}
          <div>
            {(() => {
              const displayTool =
                GIMP_TOOLS_META.find((t) => t.id === (hoveredTool ?? activeTool)) ?? GIMP_TOOLS_META[0]!;
              return (
                <div
                  data-testid="bitmap-3d-tool-readout"
                  style={{
                    padding: '5px 8px',
                    background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: 4,
                    fontSize: 10.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ display: 'flex', color: '#38bdf8' }}>{displayTool.icon}</span>
                  <strong style={{ color: '#38bdf8' }}>{displayTool.name}:</strong>
                  <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayTool.hint}
                  </span>
                </div>
              );
            })()}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>Brush Shape:</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('brush');
                    setBrushHardness(65);
                  }}
                  style={{
                    padding: '3px 8px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: activeTool === 'brush' && brushHardness < 80 ? 'rgba(56,189,248,0.22)' : 'rgba(0,0,0,0.25)',
                    border: activeTool === 'brush' && brushHardness < 80 ? '1px solid #38bdf8' : '1px solid var(--border)',
                    color: activeTool === 'brush' && brushHardness < 80 ? '#38bdf8' : 'var(--text-secondary)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Round
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('brush');
                    setBrushHardness(100);
                  }}
                  style={{
                    padding: '3px 8px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: activeTool === 'brush' && brushHardness >= 80 ? 'rgba(56,189,248,0.22)' : 'rgba(0,0,0,0.25)',
                    border: activeTool === 'brush' && brushHardness >= 80 ? '1px solid #38bdf8' : '1px solid var(--border)',
                    color: activeTool === 'brush' && brushHardness >= 80 ? '#38bdf8' : 'var(--text-secondary)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Hard Square
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool('airbrush')}
                  style={{
                    padding: '3px 8px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: activeTool === 'airbrush' ? 'rgba(56,189,248,0.22)' : 'rgba(0,0,0,0.25)',
                    border: activeTool === 'airbrush' ? '1px solid #38bdf8' : '1px solid var(--border)',
                    color: activeTool === 'airbrush' ? '#38bdf8' : 'var(--text-secondary)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Soft Radial
                </button>
              </div>
            </div>
          </div>

          {/* Multi-Layer Stack */}
          <div
            data-testid="bitmap-3d-layers-panel"
            data-layer-version={layerVersion}
            style={{
              padding: 8,
              background: 'rgba(0,0,0,0.24)',
              border: '1px solid var(--border)',
              borderRadius: 5,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#a78bfa' }}>
                Layers ({activeSlot ? activeSlot.layers.length : 0})
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  data-testid="bitmap-3d-layer-add-btn"
                  onClick={handleAddLayer}
                  disabled={!activeSlot}
                  title="New Transparent Layer (+)"
                  style={{
                    width: 24,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'rgba(167,139,250,0.2)',
                    border: '1px solid rgba(167,139,250,0.5)',
                    color: '#c4b5fd',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={12} />
                </button>
                <button
                  type="button"
                  data-testid="bitmap-3d-layer-dup-btn"
                  onClick={handleDuplicateLayer}
                  disabled={!activeSlot}
                  title="Duplicate Active Layer"
                  style={{
                    width: 24,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  data-testid="bitmap-3d-layer-merge-btn"
                  onClick={handleMergeLayerDown}
                  disabled={!activeSlot || activeSlot.activeLayerIdx <= 0}
                  title="Merge Active Layer Down"
                  style={{
                    width: 24,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  <ArrowDownToLine size={12} />
                </button>
                <button
                  type="button"
                  data-testid="bitmap-3d-layer-del-btn"
                  onClick={handleDeleteLayer}
                  disabled={!activeSlot || activeSlot.layers.length <= 1}
                  title="Delete Active Layer"
                  style={{
                    width: 24,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'rgba(239,68,68,0.18)',
                    border: '1px solid rgba(239,68,68,0.45)',
                    color: '#fca5a5',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {activeSlot && activeSlot.layers[activeSlot.activeLayerIdx] && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5 }}>
                <span style={{ color: 'var(--text-dim)' }}>Layer Mode:</span>
                <select
                  value={activeSlot.layers[activeSlot.activeLayerIdx]!.blendMode}
                  onChange={(e) => handleChangeLayerBlendMode(e.target.value as BlendModeKind)}
                  style={{
                    padding: '2px 4px',
                    fontSize: 10.5,
                    background: 'var(--bg-input, #1e1e1e)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    borderRadius: 3,
                  }}
                >
                  <option value="source-over">Normal</option>
                  <option value="color">Color Tint</option>
                  <option value="multiply">Multiply</option>
                  <option value="overlay">Overlay</option>
                  <option value="screen">Screen</option>
                </select>
                <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>
                  {activeSlot.layers[activeSlot.activeLayerIdx]!.opacity}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={activeSlot.layers[activeSlot.activeLayerIdx]!.opacity}
                  onChange={(e) => handleChangeLayerOpacity(Number(e.target.value))}
                  title="Active Layer Opacity"
                  style={{ width: 65 }}
                />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 110, overflowY: 'auto' }}>
              {activeSlot &&
                [...activeSlot.layers]
                  .map((layer, idx) => ({ layer, idx }))
                  .reverse()
                  .map(({ layer, idx }) => {
                    const isAct = idx === activeSlot.activeLayerIdx;
                    return (
                      <div
                        key={layer.id}
                        data-testid={`bitmap-3d-layer-item-${idx}`}
                        onClick={() => {
                          activeSlot.activeLayerIdx = idx;
                          setLayerVersion((v) => v + 1);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 6px',
                          background: isAct ? 'rgba(167, 139, 250, 0.22)' : 'rgba(15, 23, 42, 0.5)',
                          border: isAct ? '1px solid #a78bfa' : '1px solid var(--border)',
                          borderRadius: 3,
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleLayerVisible(idx);
                          }}
                          title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            display: 'flex',
                            color: layer.visible ? '#cbd5e1' : '#475569',
                            cursor: 'pointer',
                          }}
                        >
                          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>
                        <span
                          style={{
                            flex: 1,
                            fontWeight: isAct ? 700 : 500,
                            color: isAct ? '#c4b5fd' : 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {layer.name}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{layer.opacity}%</span>
                      </div>
                    );
                  })}
            </div>
          </div>

          {/* Section 2: Bounding-Box Layer Mask & UV Seam Bleed Controls */}
          <div style={{ padding: 8, background: 'rgba(0,0,0,0.22)', border: '1px solid var(--border)', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24' }}>
                Region Clip Mask &amp; UV Seam Bleed
              </span>
              {bboxMask && (
                <button
                  onClick={() => setBboxMask(null)}
                  style={{
                    padding: '2px 6px',
                    fontSize: 10,
                    background: 'rgba(239,68,68,0.18)',
                    border: '1px solid rgba(239,68,68,0.45)',
                    color: '#f87171',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Clear Box
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                onClick={handleFillActiveRegion}
                disabled={!activeSlot}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: 'rgba(251, 191, 36, 0.16)',
                  border: '1px solid rgba(251, 191, 36, 0.45)',
                  color: '#fbbf24',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                {bboxMask ? 'Fill Inside Box' : 'Fill Entire Layer'}
              </button>
              <button
                type="button"
                data-testid="bitmap-3d-seam-bleed-btn"
                onClick={handleDilateActiveLayerSeamBleed}
                disabled={!activeSlot}
                title="Expand painted island edges outward by +4px into transparent pixels so lower mipmaps never show dark seam lines in Halo"
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.45)',
                  color: '#38bdf8',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                +4px Seam Bleed
              </button>
            </div>

            {activeTool === 'clone' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, paddingTop: 2 }}>
                <span style={{ color: '#4ade80' }}>
                  {cloneSourcePt
                    ? `Clone Source ⊕: (${cloneSourcePt.x}, ${cloneSourcePt.y})`
                    : 'Click 3D/2D (or Alt+Click) to set source ⊕'}
                </span>
                {cloneSourcePt && (
                  <button
                    type="button"
                    onClick={() => {
                      setCloneSourcePt(null);
                      cloneOffsetRef.current = null;
                    }}
                    style={{
                      padding: '2px 6px',
                      fontSize: 10,
                      background: 'rgba(0,0,0,0.35)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    Reset ⊕
                  </button>
                )}
              </div>
            )}

            {activeTool === 'blur-sharpen' && (
              <div style={{ display: 'flex', gap: 4, paddingTop: 2 }}>
                <button
                  type="button"
                  onClick={() => setConvolveSharpen(false)}
                  style={{
                    flex: 1,
                    padding: '3px 6px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: !convolveSharpen ? 'rgba(56,189,248,0.22)' : 'rgba(0,0,0,0.25)',
                    border: !convolveSharpen ? '1px solid #38bdf8' : '1px solid var(--border)',
                    color: !convolveSharpen ? '#38bdf8' : 'var(--text-secondary)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Gaussian Blur (3×3)
                </button>
                <button
                  type="button"
                  onClick={() => setConvolveSharpen(true)}
                  style={{
                    flex: 1,
                    padding: '3px 6px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: convolveSharpen ? 'rgba(56,189,248,0.22)' : 'rgba(0,0,0,0.25)',
                    border: convolveSharpen ? '1px solid #38bdf8' : '1px solid var(--border)',
                    color: convolveSharpen ? '#38bdf8' : 'var(--text-secondary)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Unsharp Sharpen
                </button>
              </div>
            )}
          </div>

          {/* Section 2B: Layer HSV / Tone Filter */}
          <div style={{ padding: 8, background: 'rgba(0,0,0,0.22)', border: '1px solid var(--border)', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#f472b6' }}>
                Layer HSV / Tone Filter
              </span>
              <button
                type="button"
                data-testid="bitmap-3d-apply-hsv-btn"
                onClick={handleApplyLayerHsvAdjustment}
                disabled={!activeSlot || (hsvHue === 0 && hsvSat === 0 && hsvVal === 0)}
                style={{
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  background: 'rgba(244, 114, 182, 0.2)',
                  border: '1px solid rgba(244, 114, 182, 0.5)',
                  color: '#f472b6',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Apply HSV
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Hue: {hsvHue}°</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={hsvHue}
                  onChange={(e) => setHsvHue(Number(e.target.value))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Sat: {hsvSat}%</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={hsvSat}
                  onChange={(e) => setHsvSat(Number(e.target.value))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Val: {hsvVal}%</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={hsvVal}
                  onChange={(e) => setHsvVal(Number(e.target.value))}
                />
              </label>
            </div>
          </div>

          {/* Section 3: Brush / Line Settings, Blend Mode, Symmetry & Fill Source */}
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 6 }}>
              2. Stroke, Blend Mode &amp; Symmetry
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 7 }}>
              <button
                onClick={() => setFillMode('color')}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: fillMode === 'color' ? 'rgba(56,189,248,0.2)' : 'transparent',
                  border: fillMode === 'color' ? '1px solid #38bdf8' : '1px solid var(--border)',
                  color: fillMode === 'color' ? '#38bdf8' : 'var(--text-secondary)',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Solid Color
              </button>
              <button
                onClick={() => setFillMode('texture')}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: fillMode === 'texture' ? 'rgba(34,197,94,0.2)' : 'transparent',
                  border: fillMode === 'texture' ? '1px solid #4ade80' : '1px solid var(--border)',
                  color: fillMode === 'texture' ? '#4ade80' : 'var(--text-secondary)',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Texture Pattern
              </button>
            </div>

            {fillMode === 'color' && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                    style={{ width: 34, height: 26, border: 'none', background: 'transparent', cursor: 'pointer' }}
                  />
                  <input
                    type="text"
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '4px 8px',
                      background: 'var(--bg-input, #1e1e1e)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontSize: 11.5,
                      fontFamily: 'var(--mono-font)',
                    }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                  {HALO_COLOR_SWATCHES.map((sw) => (
                    <button
                      key={sw}
                      onClick={() => setBrushColor(sw)}
                      title={sw}
                      style={{
                        height: 19,
                        background: sw,
                        border: brushColor.toLowerCase() === sw.toLowerCase() ? '2px solid #ffffff' : '1px solid #334155',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Blend Mode + UV Mirror Symmetry */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8, fontSize: 11 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Blend Mode:</span>
                <select
                  data-testid="bitmap-3d-blend-mode-select"
                  value={blendMode}
                  onChange={(e) => setBlendMode(e.target.value as BlendModeKind)}
                  style={{
                    flex: 1,
                    padding: '3px 6px',
                    background: 'var(--bg-input, #1e1e1e)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    borderRadius: 3,
                  }}
                >
                  <option value="source-over">Normal (Standard Paint)</option>
                  <option value="color">Color Tint (Keep Armor Shading!)</option>
                  <option value="multiply">Multiply (Weathering / Dirt)</option>
                  <option value="overlay">Overlay (Contrast &amp; Detail)</option>
                  <option value="screen">Screen (Visor / Plasma Glow)</option>
                </select>
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: 'var(--text-secondary)', marginRight: 'auto' }}>UV Symmetry:</span>
                {(
                  [
                    { id: 'off', label: 'Off' },
                    { id: 'x', label: 'Mirror X' },
                    { id: 'y', label: 'Mirror Y' },
                    { id: 'xy', label: 'X+Y' },
                  ] as Array<{ id: SymmetryMode; label: string }>
                ).map((sym) => (
                  <button
                    key={sym.id}
                    type="button"
                    onClick={() => setSymmetryMode(sym.id)}
                    style={{
                      padding: '2px 7px',
                      fontSize: 10,
                      fontWeight: 700,
                      background: symmetryMode === sym.id ? 'rgba(56,189,248,0.22)' : 'rgba(0,0,0,0.25)',
                      border: symmetryMode === sym.id ? '1px solid #38bdf8' : '1px solid var(--border)',
                      color: symmetryMode === sym.id ? '#38bdf8' : 'var(--text-secondary)',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    {sym.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Size / Line Width: {brushSize}px</span>
                <input
                  data-testid="bitmap-3d-brush-size-slider"
                  type="range"
                  min={0.5}
                  max={80}
                  step={0.5}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  style={{ width: 140 }}
                />
              </label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10.5, color: 'var(--text-dim)', marginRight: 'auto' }}>Quick Fine Sizes:</span>
                {[0.5, 1, 2, 4, 8].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setBrushSize(sz)}
                    style={{
                      padding: '2px 6px',
                      fontSize: 10,
                      fontWeight: 700,
                      background: brushSize === sz ? 'rgba(56,189,248,0.22)' : 'rgba(0,0,0,0.25)',
                      border: brushSize === sz ? '1px solid #38bdf8' : '1px solid var(--border)',
                      color: brushSize === sz ? '#38bdf8' : 'var(--text-secondary)',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    {sz}px
                  </button>
                ))}
              </div>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Edge Hardness: {brushHardness}%</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={brushHardness}
                  onChange={(e) => setBrushHardness(Number(e.target.value))}
                  style={{ width: 140 }}
                />
              </label>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Opacity: {brushOpacity}%</span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={brushOpacity}
                  onChange={(e) => setBrushOpacity(Number(e.target.value))}
                  style={{ width: 140 }}
                />
              </label>
              {activeTool === 'bucket' && (
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Flood Tolerance: {bucketTolerance}</span>
                  <input
                    type="range"
                    min={0}
                    max={128}
                    value={bucketTolerance}
                    onChange={(e) => setBucketTolerance(Number(e.target.value))}
                    style={{ width: 140 }}
                  />
                </label>
              )}
              {activeTool === 'sharp-rect' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={rectFilled}
                    onChange={(e) => setRectFilled(e.target.checked)}
                  />
                  Fill Sharp Rectangle (uncheck for crisp outline)
                </label>
              )}

              {/* HD Texture Resolution Upscaler for crisp fine-line painting */}
              <div
                style={{
                  marginTop: 4,
                  padding: 7,
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  borderRadius: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5 }}>
                  <strong style={{ color: '#38bdf8' }}>
                    Canvas Resolution: {activeSlot ? `${activeSlot.width}×${activeSlot.height}px` : '—'}
                  </strong>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={autoHdUpscale}
                      onChange={(e) => setAutoHdUpscale(e.target.checked)}
                    />
                    Auto-HD (≥1024px)
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    data-testid="bitmap-3d-upscale-2x-btn"
                    onClick={() => handleUpscaleSlotResolution()}
                    disabled={!activeSlot || activeSlot.width >= 2048}
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      fontSize: 10.5,
                      fontWeight: 700,
                      background: 'rgba(56,189,248,0.18)',
                      border: '1px solid rgba(56,189,248,0.45)',
                      color: '#38bdf8',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    Upscale 2× HD
                  </button>
                  <button
                    type="button"
                    data-testid="bitmap-3d-upscale-1024-btn"
                    onClick={() => handleUpscaleSlotResolution(1024)}
                    disabled={!activeSlot || (activeSlot.width === 1024 && activeSlot.height === 1024)}
                    style={{
                      padding: '4px 7px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    1024×1024
                  </button>
                  <button
                    type="button"
                    data-testid="bitmap-3d-upscale-2048-btn"
                    onClick={() => handleUpscaleSlotResolution(2048)}
                    disabled={!activeSlot || (activeSlot.width === 2048 && activeSlot.height === 2048)}
                    style={{
                      padding: '4px 7px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    2048×2048
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Custom Textures Dropdown (`<exe>/textures/`) */}
          <div style={{ padding: 9, background: 'rgba(0,0,0,0.22)', border: '1px solid var(--border)', borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#4ade80' }}>
                3. Textures Library (`textures/`)
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={loadCustomTextures}
                  title="Reload textures from textures/ directory"
                  style={{
                    padding: '2px 6px',
                    fontSize: 10.5,
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Reload
                </button>
                <button
                  onClick={() => window.opence.openCustomTexturesFolder?.()}
                  title={texturesDirPath || 'Open textures/ folder alongside executable'}
                  style={{
                    padding: '2px 6px',
                    fontSize: 10.5,
                    background: 'rgba(34,197,94,0.16)',
                    border: '1px solid rgba(34,197,94,0.45)',
                    color: '#4ade80',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Open Folder
                </button>
              </div>
            </div>

            {/* Compact Dropdown + Live Preview Thumbnail */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              {customTextures[selectedPatternIdx] && (
                <img
                  src={customTextures[selectedPatternIdx].dataUrl}
                  alt={customTextures[selectedPatternIdx].name}
                  onClick={() => setFillMode('texture')}
                  title="Click to activate Texture Pattern fill mode"
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: 'cover',
                    borderRadius: 4,
                    border: fillMode === 'texture' ? '2px solid #4ade80' : '1px solid var(--border)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <select
                  data-testid="bitmap-3d-texture-select"
                  value={selectedPatternIdx}
                  onChange={(e) => {
                    setSelectedPatternIdx(Number(e.target.value));
                    setFillMode('texture');
                  }}
                  style={{
                    width: '100%',
                    padding: '5px 8px',
                    background: 'var(--bg-input, #1e1e1e)',
                    border: fillMode === 'texture' ? '1px solid #4ade80' : '1px solid var(--border)',
                    color: fillMode === 'texture' ? '#4ade80' : 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: 11.5,
                    borderRadius: 4,
                  }}
                >
                  {customTextures.length === 0 ? (
                    <option value={0}>No textures in textures/</option>
                  ) : (
                    customTextures.map((tex, idx) => (
                      <option key={tex.filePath} value={idx}>
                        {tex.name}
                      </option>
                    ))
                  )}
                </select>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  Select a texture for Pattern Brush or ⭐ Stamp / Decal tool
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Texture Scale: {Math.round(patternScale * 100)}%</span>
                <input
                  type="range"
                  min={0.25}
                  max={4}
                  step={0.25}
                  value={patternScale}
                  onChange={(e) => setPatternScale(Number(e.target.value))}
                  style={{ width: 130 }}
                />
              </label>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Pattern / Decal Angle: {patternRotationDeg}°</span>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={15}
                  value={patternRotationDeg}
                  onChange={(e) => setPatternRotationDeg(Number(e.target.value))}
                  style={{ width: 130 }}
                />
              </label>
            </div>
          </div>

          {/* Section 5: Overlays, Undo/Redo & Apply to Map */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto' }}>
            <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-secondary)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={showWireframe3d}
                  onChange={(e) => setShowWireframe3d(e.target.checked)}
                />
                3D Wireframe
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={showUvOverlay2d}
                  onChange={(e) => setShowUvOverlay2d(e.target.checked)}
                />
                2D UV Mesh
              </label>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handleUndo}
                disabled={!activeSlot || activeSlot.undoStack.length === 0}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: 11,
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Undo
              </button>
              <button
                onClick={handleRedo}
                disabled={!activeSlot || activeSlot.redoStack.length === 0}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: 11,
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Redo
              </button>
              <button
                onClick={handleResetSlot}
                disabled={!activeSlot}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: 11,
                  background: 'rgba(239,68,68,0.14)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  color: '#f87171',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Reset
              </button>
            </div>

            <button
              data-testid="bitmap-3d-apply-btn"
              onClick={handleApplyToMapBitmap}
              disabled={!activeSlot || isApplying}
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'rgba(34, 197, 94, 0.24)',
                border: '1px solid rgba(34, 197, 94, 0.6)',
                color: '#4ade80',
                fontWeight: 700,
                fontSize: 12,
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {isApplying ? 'Encoding Mipmaps & Applying...' : '✓ Apply Painted Texture to Map'}
            </button>
          </div>
        </div>
      </div>

      {/* Item Chooser Modal Popup (Category Dropdown on Top + Items List Below, like Add Object menu) */}
      {chooserOpen && (
        <div
          data-testid="bitmap-3d-chooser-modal"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: 540,
              maxWidth: '92%',
              maxHeight: '84%',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                background: 'var(--bg-panel-header)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                Select Item to Paint in 3D Bitmap Editor
              </span>
              {selectedTag && (
                <button
                  onClick={() => setChooserOpen(false)}
                  style={{
                    padding: '3px 9px',
                    fontSize: 11.5,
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--text-dim)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              )}
            </div>

            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
              {/* Top Dropdown: Category */}
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  1. Category
                </div>
                <select
                  data-testid="bitmap-3d-category-select"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value as ItemCategory)}
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    background: 'var(--bg-input, #1e1e1e)',
                    border: '1px solid var(--border)',
                    color: 'var(--accent-cyan)',
                    fontWeight: 700,
                    fontSize: 12.5,
                    borderRadius: 4,
                  }}
                >
                  {ITEM_CATEGORIES.map((cat) => {
                    const count =
                      cat.id === 'floating-bsp'
                        ? (window.__openceFloatingBspObjects ?? []).length
                        : allTags.filter((t) => t.primaryClassName === cat.id).length;
                    return (
                      <option key={cat.id} value={cat.id}>
                        {cat.label} ({count})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Filter Input */}
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  2. Items in Category ({categoryItems.length})
                </div>
                <input
                  type="text"
                  placeholder="Filter items in this category..."
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    background: 'var(--bg-input, #1e1e1e)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    borderRadius: 4,
                    marginBottom: 6,
                  }}
                />
              </div>

              {/* Items List Below */}
              <div
                style={{
                  flex: 1,
                  minHeight: 220,
                  maxHeight: 340,
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: 'rgba(0,0,0,0.25)',
                }}
              >
                {categoryItems.length === 0 ? (
                  <div style={{ padding: 18, textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
                    No items found in this category for the current map.
                  </div>
                ) : (
                  categoryItems.map((item) => {
                    const leaf = item.path.split('\\').pop() || item.path;
                    return (
                      <button
                        key={item.index}
                        data-testid={`bitmap-3d-item-${item.index}`}
                        onClick={() => handleSelectItemToEdit(item)}
                        disabled={isLoadingItem}
                        style={{
                          width: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          padding: '8px 12px',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#38bdf8' }}>{leaf}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                          [{item.primaryClassName}] {item.path}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

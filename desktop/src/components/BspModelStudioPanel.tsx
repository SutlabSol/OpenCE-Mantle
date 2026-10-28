import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Move,
  ArrowUpFromLine,
  ArrowDownToLine,
  Hand,
  Waves,
  Minus,
  Maximize2,
  Scissors,
  Magnet,
  Slice,
  MousePointerClick,
  GitBranchPlus,
  CopyPlus,
  Trash2,
  Plus,
  Upload,
  Paintbrush,
  PaintBucket,
  Pipette,
  Undo2,
  Redo2,
  RotateCcw,
  Save,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  Box,
  Layers,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { TagEntrySummary, BspRenderMesh, ModelRenderGeometry, MeshIntegrityReview } from '../../electron/shared-types';
import type { FloatingBspObjectEntry } from './Bitmap3dStudioPanel';
import { auditMeshIntegrity } from '../../../core/src/render/mesh-integrity';
import {
  generateTunnelNetworkMesh,
  generateBridgeNetworkMesh,
  generateQuickForgeWorldMesh,
  createPresetTerrainGrid,
  sculptTerrainGrid,
  resolveDefaultHaloShadersForWorld,
  HALO_DEFAULT_SHADER_CATALOG,
  exportWorldMeshToObj,
  exportWorldMeshToJms,
  type TunnelNetworkConfig,
  type TunnelStyle,
  type TunnelCaveSpec,
  type BridgeNetworkConfig,
  type BridgeStyle,
  type TerrainGridConfig,
  type TerrainBiomePreset,
  type TerrainSculptOperation,
  type CityGridConfig,
  type WorldBuilderPiece,
  type WorldPieceKind,
  type WorldMaterialRole,
  type GeneratedWorldMesh,
} from '../../../core/src/render/world-bsp-generator';

export interface BspModelStudioPanelProps {
  allTags: TagEntrySummary[];
  onOpenTagEditor?: (tagIndexOrPath: number | string) => void;
}

type StudioMode = 'bsp' | 'model' | 'create';
type CreateBuilderKind = 'tunnel_network' | 'bridge_network' | 'quickforge_world' | 'primitive';
type SculptTool =
  | 'orbit'
  | 'raise'
  | 'lower'
  | 'grab'
  | 'smooth'
  | 'flatten'
  | 'inflate'
  | 'crease'
  | 'pinch'
  | 'scrape_plane'
  | 'vertex_select'
  | 'split_topology'
  | 'extrude_face_snap'
  | 'delete_face'
  | 'paint_brush'
  | 'paint_bucket'
  | 'shader_picker';

type AssetCategory = 'vehicle' | 'weapon' | 'biped' | 'scenery' | 'equipment' | 'gbxmodel';
type ParametricPrimitiveKind = 'ramp' | 'platform' | 'bunker' | 'pillar' | 'arch' | 'tunnel';

interface CoLocatedVertRef {
  sub: SubmeshWorkingState;
  v: number;
}

interface SubmeshWorkingState {
  submeshIndex: number;
  shaderTagId: number | null;
  shaderPath: string | null;
  bitmapTagId: number | null;
  bitmapTagIndex: number | null;
  positions: Float32Array;
  originalPositions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  wireMesh: THREE.Mesh;
  paintCanvas: HTMLCanvasElement | null;
  threeTexture: THREE.CanvasTexture | null;
  selectedVertices: Uint8Array;
  visible: boolean;
  dirtyGeometry: boolean;
  dirtyTexture: boolean;
  dirtyShader: boolean;
}

interface SubmeshSnapshot {
  submeshIndex: number;
  shaderTagId: number | null;
  shaderPath: string | null;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  selectedVertices: Uint8Array;
  paintImageData: ImageData | null;
  dirtyGeometry: boolean;
  dirtyTexture: boolean;
  dirtyShader: boolean;
}

/**
 * Recomputes outward vertex normals using Halo CE's Clockwise (DirectX) triangle winding:
 * outward normal = (v2 - v0) x (v1 - v0).
 * Calling Three.js `computeVertexNormals()` uses Counter-Clockwise `(v1 - v0) x (v2 - v0)`,
 * which flips normals 180 degrees inward and causes dark black shadows from all angles!
 */
function recomputeSubmeshClockwiseNormals(sub: SubmeshWorkingState): void {
  const pos = sub.positions;
  const idx = sub.indices;
  const vCount = Math.floor(pos.length / 3);
  if (sub.normals.length !== vCount * 3) {
    sub.normals = new Float32Array(vCount * 3);
  } else {
    sub.normals.fill(0);
  }
  const norms = sub.normals;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const i0 = idx[t]!;
    const i1 = idx[t + 1]!;
    const i2 = idx[t + 2]!;
    if (i0 >= vCount || i1 >= vCount || i2 >= vCount) continue;
    const x0 = pos[i0 * 3]!, y0 = pos[i0 * 3 + 1]!, z0 = pos[i0 * 3 + 2]!;
    const x1 = pos[i1 * 3]!, y1 = pos[i1 * 3 + 1]!, z1 = pos[i1 * 3 + 2]!;
    const x2 = pos[i2 * 3]!, y2 = pos[i2 * 3 + 1]!, z2 = pos[i2 * 3 + 2]!;
    const ax = x2 - x0, ay = y2 - y0, az = z2 - z0;
    const bx = x1 - x0, by = y1 - y0, bz = z1 - z0;
    const fnx = ay * bz - az * by;
    const fny = az * bx - ax * bz;
    const fnz = ax * by - ay * bx;
    norms[i0 * 3] += fnx; norms[i0 * 3 + 1] += fny; norms[i0 * 3 + 2] += fnz;
    norms[i1 * 3] += fnx; norms[i1 * 3 + 1] += fny; norms[i1 * 3 + 2] += fnz;
    norms[i2 * 3] += fnx; norms[i2 * 3 + 1] += fny; norms[i2 * 3 + 2] += fnz;
  }
  for (let v = 0; v < vCount; v++) {
    const nx = norms[v * 3]!;
    const ny = norms[v * 3 + 1]!;
    const nz = norms[v * 3 + 2]!;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-6) {
      norms[v * 3] = nx / len;
      norms[v * 3 + 1] = ny / len;
      norms[v * 3 + 2] = nz / len;
    } else {
      norms[v * 3] = 0;
      norms[v * 3 + 1] = 0;
      norms[v * 3 + 2] = 1;
    }
  }
  const normAttr = sub.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (normAttr && normAttr.array.length === norms.length) {
    (normAttr.array as Float32Array).set(norms);
    normAttr.needsUpdate = true;
  } else {
    const newNormAttr = new THREE.BufferAttribute(norms, 3);
    newNormAttr.setUsage(THREE.DynamicDrawUsage);
    sub.geometry.setAttribute('normal', newNormAttr);
  }
}

function syncSubmeshBufferGeometry(sub: SubmeshWorkingState): void {
  const posAttr = new THREE.BufferAttribute(sub.positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const uvAttr = new THREE.BufferAttribute(sub.uvs, 2);
  uvAttr.setUsage(THREE.DynamicDrawUsage);
  sub.geometry.setAttribute('position', posAttr);
  sub.geometry.setAttribute('uv', uvAttr);
  sub.geometry.setIndex(new THREE.BufferAttribute(sub.indices, 1));
  recomputeSubmeshClockwiseNormals(sub);
  sub.geometry.computeBoundingBox();
  sub.geometry.computeBoundingSphere();
}

const SCULPT_TOOLS: Array<{ id: SculptTool; icon: React.ReactNode; label: string; tip: string }> = [
  { id: 'orbit', icon: <Move size={15} />, label: 'Orbit / Navigate', tip: 'Orbit / Inspect (Left-drag orbit, Right-drag pan, Scroll zoom)' },
  { id: 'raise', icon: <ArrowUpFromLine size={15} />, label: 'Raise (+Z)', tip: 'Raise Terrain or Mesh Height (+Z)' },
  { id: 'lower', icon: <ArrowDownToLine size={15} />, label: 'Lower (-Z)', tip: 'Lower Terrain or Mesh Height (-Z / Trench)' },
  { id: 'grab', icon: <Hand size={15} />, label: 'Grab / Pull', tip: 'Proportional Grab / Pull Vertices along view plane' },
  { id: 'smooth', icon: <Waves size={15} />, label: 'Smooth / Relax', tip: 'Smooth and Relax Vertices within Brush Radius' },
  { id: 'flatten', icon: <Minus size={15} />, label: 'Flatten / Terrace', tip: 'Flatten Vertices to Target Click Elevation' },
  { id: 'inflate', icon: <Maximize2 size={15} />, label: 'Inflate Normal', tip: 'Inflate / Displace Vertices Outward Along Surface Normal' },
  { id: 'crease', icon: <Scissors size={15} />, label: 'Crease / Chisel', tip: 'Carve sharp rock crevices & armor seams (Shift to invert)' },
  { id: 'pinch', icon: <Magnet size={15} />, label: 'Pinch Ridge', tip: 'Pull vertices radially toward brush center to sharpen edges' },
  { id: 'scrape_plane', icon: <Slice size={15} />, label: 'Trim Plane', tip: 'Trim protruding vertices flat against local surface plane' },
  { id: 'vertex_select', icon: <MousePointerClick size={15} />, label: 'Vertex Select', tip: 'Brush-select 3D vertices for Extrude, Split, Smooth, Snap, or Weld (Shift to deselect)' },
  { id: 'split_topology', icon: <GitBranchPlus size={15} />, label: 'Split Face / Edge', tip: 'Click a 3D face or edge to split/subdivide triangles and add vertices' },
  { id: 'extrude_face_snap', icon: <CopyPlus size={15} />, label: 'Add / Extrude Face (Snap)', tip: 'Click a face to extrude new connected geometry and snap-join to nearby vertices' },
  { id: 'delete_face', icon: <Trash2 size={15} />, label: 'Delete Face / Portal Block', tip: 'Click any blocking 3D triangle or doorway cap face to delete/collapse it' },
  { id: 'paint_brush', icon: <Paintbrush size={15} />, label: '3D Texture Brush', tip: 'Live 3D Texture Paint directly on Surface Bitmap' },
  { id: 'paint_bucket', icon: <PaintBucket size={15} />, label: 'Flood Fill Surface', tip: 'Flood Fill Surface Texture with Active Color' },
  { id: 'shader_picker', icon: <Pipette size={15} />, label: 'Pick / Swap Shader', tip: 'Click a 3D Surface to Select & Swap its Shader / Material' },
];

/**
 * Generates parametric architectural / terrain primitive geometry with auto-unwrapped UVs
 * and outward Halo Clockwise triangle winding `(v2 - v0) x (v1 - v0)`.
 */
function buildParametricPrimitiveGeometry(
  kind: ParametricPrimitiveKind,
  width: number,
  depth: number,
  height: number,
  wallThickness = 0.4,
): { vertices: Float32Array; indices: Uint32Array } {
  const boxGeo = new THREE.BoxGeometry(width, depth, height, 4, 4, 4);
  if (kind === 'ramp') {
    const pos = boxGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (z > 0) {
        const t = (x + width / 2) / Math.max(0.01, width);
        pos.setZ(i, -height / 2 + height * Math.max(0.05, t));
      }
    }
    pos.needsUpdate = true;
  } else if (kind === 'pillar') {
    const cyl = new THREE.CylinderGeometry(width * 0.5, width * 0.55, height, 12, 3);
    cyl.rotateX(Math.PI / 2);
    return threeBufferGeoToHaloClockwise(cyl);
  } else if (kind === 'arch' || kind === 'tunnel') {
    const torus = new THREE.TorusGeometry(width * 0.5, Math.max(0.2, wallThickness), 8, 16, Math.PI);
    torus.rotateX(Math.PI / 2);
    return threeBufferGeoToHaloClockwise(torus);
  } else if (kind === 'bunker') {
    const pos = boxGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z > 0) {
        pos.setX(i, pos.getX(i) * 0.78);
        pos.setY(i, pos.getY(i) * 0.78);
      }
    }
    pos.needsUpdate = true;
  }
  return threeBufferGeoToHaloClockwise(boxGeo);
}

function threeBufferGeoToHaloClockwise(geo: THREE.BufferGeometry): { vertices: Float32Array; indices: Uint32Array } {
  geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  const vCount = pos.count;
  const vertices = new Float32Array(vCount * 8);
  for (let i = 0; i < vCount; i++) {
    const base = i * 8;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    vertices[base + 0] = x;
    vertices[base + 1] = y;
    vertices[base + 2] = z;
    vertices[base + 3] = norm ? norm.getX(i) : 0;
    vertices[base + 4] = norm ? norm.getY(i) : 0;
    vertices[base + 5] = norm ? norm.getZ(i) : 1;
    // Smart box-projected UV fallback if UV attribute is missing
    vertices[base + 6] = uv ? uv.getX(i) : (x + y) * 0.25;
    vertices[base + 7] = uv ? uv.getY(i) : (y + z) * 0.25;
  }
  const rawIdx = geo.index ? geo.index.array : null;
  const triCount = rawIdx ? Math.floor(rawIdx.length / 3) : Math.floor(vCount / 3);
  const indices = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = rawIdx ? rawIdx[t * 3]! : t * 3;
    const i1 = rawIdx ? rawIdx[t * 3 + 1]! : t * 3 + 1;
    const i2 = rawIdx ? rawIdx[t * 3 + 2]! : t * 3 + 2;
    // Reverse Three.js CCW (i0, i1, i2) to Halo Clockwise (i0, i2, i1)
    indices[t * 3 + 0] = i0;
    indices[t * 3 + 1] = i2;
    indices[t * 3 + 2] = i1;
  }
  return { vertices, indices };
}

function parseWavefrontObjToHaloClockwise(objText: string): { vertices: Float32Array; indices: Uint32Array } {
  const posList: Array<[number, number, number]> = [];
  const uvList: Array<[number, number]> = [];
  const normList: Array<[number, number, number]> = [];
  const outVerts: number[] = [];
  const outIndices: number[] = [];
  const vertMap = new Map<string, number>();

  const lines = objText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0];
    if (cmd === 'v' && parts.length >= 4) {
      posList.push([parseFloat(parts[1]!) || 0, parseFloat(parts[2]!) || 0, parseFloat(parts[3]!) || 0]);
    } else if (cmd === 'vt' && parts.length >= 3) {
      uvList.push([parseFloat(parts[1]!) || 0, 1 - (parseFloat(parts[2]!) || 0)]);
    } else if (cmd === 'vn' && parts.length >= 4) {
      normList.push([parseFloat(parts[1]!) || 0, parseFloat(parts[2]!) || 0, parseFloat(parts[3]!) || 1]);
    } else if (cmd === 'f' && parts.length >= 4) {
      const faceVerts: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const tok = parts[i]!;
        let vIdx = vertMap.get(tok);
        if (vIdx === undefined) {
          const [viStr, tiStr, niStr] = tok.split('/');
          const vi = parseInt(viStr ?? '1', 10);
          const ti = tiStr ? parseInt(tiStr, 10) : 0;
          const ni = niStr ? parseInt(niStr, 10) : 0;
          const p = posList[vi < 0 ? posList.length + vi : vi - 1] ?? [0, 0, 0];
          const n = (ni ? normList[ni < 0 ? normList.length + ni : ni - 1] : undefined) ?? [0, 0, 1];
          // Smart box-unwrap UV if OBJ has no vt coordinates
          const uCoord = (ti ? uvList[ti < 0 ? uvList.length + ti : ti - 1]?.[0] : undefined) ?? (p[0] + p[1]) * 0.25;
          const vCoord = (ti ? uvList[ti < 0 ? uvList.length + ti : ti - 1]?.[1] : undefined) ?? (p[1] + p[2]) * 0.25;
          vIdx = Math.floor(outVerts.length / 8);
          outVerts.push(p[0], p[1], p[2], n[0], n[1], n[2], uCoord, vCoord);
          vertMap.set(tok, vIdx);
        }
        faceVerts.push(vIdx);
      }
      for (let k = 1; k + 1 < faceVerts.length; k++) {
        outIndices.push(faceVerts[0]!, faceVerts[k + 1]!, faceVerts[k]!);
      }
    }
  }
  return {
    vertices: new Float32Array(outVerts),
    indices: new Uint32Array(outIndices),
  };
}

function generatedWorldMeshToRawSubmeshes(
  worldMesh: GeneratedWorldMesh,
  currentTags: TagEntrySummary[],
  shaderOverrides: Partial<Record<WorldMaterialRole, number>>,
): {
  rawSubmeshes: Array<{
    shaderTagId: number | null;
    shaderPath: string | null;
    vertices: Float32Array;
    indices: Uint32Array;
    materialRole: WorldMaterialRole;
  }>;
  activeRoles: WorldMaterialRole[];
} {
  const resolvedShaders = resolveDefaultHaloShadersForWorld(currentTags, shaderOverrides);
  const roleGroups = new Map<WorldMaterialRole, Array<{ v0: number; v1: number; v2: number }>>();
  for (const tri of worldMesh.triangles) {
    let list = roleGroups.get(tri.materialRole);
    if (!list) {
      list = [];
      roleGroups.set(tri.materialRole, list);
    }
    list.push({ v0: tri.v0, v1: tri.v1, v2: tri.v2 });
  }

  const rawSubmeshes: Array<{
    shaderTagId: number | null;
    shaderPath: string | null;
    vertices: Float32Array;
    indices: Uint32Array;
    materialRole: WorldMaterialRole;
  }> = [];
  const activeRoles: WorldMaterialRole[] = [];

  for (const [role, tris] of roleGroups.entries()) {
    if (tris.length === 0) continue;
    activeRoles.push(role);
    const globalToLocal = new Map<number, number>();
    const localVerts: number[] = [];
    const localIndices = new Uint32Array(tris.length * 3);

    const getLocalV = (gIdx: number): number => {
      let lIdx = globalToLocal.get(gIdx);
      if (lIdx === undefined) {
        lIdx = Math.floor(localVerts.length / 8);
        const gv = worldMesh.vertices[gIdx] ?? {
          position: [0, 0, 0],
          normal: [0, 0, 1],
          uv: [0, 0],
        };
        localVerts.push(
          gv.position[0],
          gv.position[1],
          gv.position[2],
          gv.normal[0],
          gv.normal[1],
          gv.normal[2],
          gv.uv[0],
          gv.uv[1],
        );
        globalToLocal.set(gIdx, lIdx);
      }
      return lIdx;
    };

    for (let t = 0; t < tris.length; t++) {
      const tri = tris[t]!;
      const i0 = getLocalV(tri.v0);
      const i1 = getLocalV(tri.v1);
      const i2 = getLocalV(tri.v2);
      // Halo Clockwise convention (i0, i2, i1) so recomputeSubmeshClockwiseNormals produces outward normals
      localIndices[t * 3 + 0] = i0;
      localIndices[t * 3 + 1] = i2;
      localIndices[t * 3 + 2] = i1;
    }

    const sh = resolvedShaders[role];
    rawSubmeshes.push({
      shaderTagId: sh?.tagId ?? null,
      shaderPath: sh?.path ?? null,
      vertices: new Float32Array(localVerts),
      indices: localIndices,
      materialRole: role,
    });
  }

  return { rawSubmeshes, activeRoles };
}

export const BspModelStudioPanel: React.FC<BspModelStudioPanelProps> = ({
  allTags,
  onOpenTagEditor,
}) => {
  const allTagsRef = useRef<TagEntrySummary[]>(allTags);
  allTagsRef.current = allTags;

  const [studioMode, setStudioMode] = useState<StudioMode>('bsp');
  const [selectedBspIndex, setSelectedBspIndex] = useState<number>(0);

  // Model selector state when in 'model' mode
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory>('vehicle');
  const [selectedAssetTagIndex, setSelectedAssetTagIndex] = useState<number>(-1);
  const [activeModelTagId, setActiveModelTagId] = useState<number | null>(null);

  // Tool state
  const [activeTool, setActiveTool] = useState<SculptTool>('raise');
  const [hoveredToolTip, setHoveredToolTip] = useState<string | null>(null);
  const [brushRadius, setBrushRadius] = useState<number>(2.5);
  const [brushStrength, setBrushStrength] = useState<number>(0.35);
  const [wireframeOverlay, setWireframeOverlay] = useState<boolean>(true);

  // 3-Plane Center Symmetry state (X, Y, Z) + Orange Plane Visualizer toggle
  const [symmetryX, setSymmetryX] = useState<boolean>(false);
  const [symmetryY, setSymmetryY] = useState<boolean>(false);
  const [symmetryZ, setSymmetryZ] = useState<boolean>(false);
  const [showSymmetryPlanes, setShowSymmetryPlanes] = useState<boolean>(true);

  // Paint & Shader state
  const [paintColor, setPaintColor] = useState<string>('#4a7c59');
  const [paintBrushPx, setPaintBrushPx] = useState<number>(18);
  const [paintOpacity, setPaintOpacity] = useState<number>(0.85);
  const [selectedSubmeshIdx, setSelectedSubmeshIdx] = useState<number>(0);
  const [targetShaderTagId, setTargetShaderTagId] = useState<number>(-1);

  // Mesh Topology & Transform state
  const [scaleX, setScaleX] = useState<number>(1);
  const [scaleY, setScaleY] = useState<number>(1);
  const [scaleZ, setScaleZ] = useState<number>(1);
  const [selectedVertexCount, setSelectedVertexCount] = useState<number>(0);
  const [extrudeDist, setExtrudeDist] = useState<number>(0.25);
  const [gridStep] = useState<number>(0.25);
  const [weldThreshold] = useState<number>(0.05);

  // Undo / Redo state counts
  const [undoCount, setUndoCount] = useState<number>(0);
  const [redoCount, setRedoCount] = useState<number>(0);
  const undoStackRef = useRef<SubmeshSnapshot[][]>([]);
  const redoStackRef = useRef<SubmeshSnapshot[][]>([]);

  // Right Scene Outliner tree expanded sections
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    root: true,
    regions: true,
    surfaces: true,
    shaders: true,
    collision: true,
  });

  // 3D Orientation Gizmo state
  const [gizmoAxes, setGizmoAxes] = useState<{
    x: [number, number, number];
    y: [number, number, number];
    z: [number, number, number];
  }>({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });

  const [loading, setLoading] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submeshSummaryList, setSubmeshSummaryList] = useState<
    Array<{
      submeshIndex: number;
      shaderPath: string | null;
      shaderTagId: number | null;
      bitmapTagIndex: number | null;
      vertexCount: number;
      triangleCount: number;
      visible: boolean;
    }>
  >([]);

  const viewportContainerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const wireframeGroupRef = useRef<THREE.Group | null>(null);
  const symmetryPlanesGroupRef = useRef<THREE.Group | null>(null);
  const selectedPointsMeshRef = useRef<THREE.Points | null>(null);
  const brushRingRef = useRef<THREE.Mesh | null>(null);
  const submeshesRef = useRef<SubmeshWorkingState[]>([]);
  const modelBoundsRef = useRef<{ center: THREE.Vector3; size: THREE.Vector3 }>({
    center: new THREE.Vector3(0, 0, 0),
    size: new THREE.Vector3(10, 10, 10),
  });
  const isPointerDownRef = useRef<boolean>(false);
  const flattenTargetZRef = useRef<number | null>(null);
  const grabLastHitRef = useRef<THREE.Vector3 | null>(null);
  const loadGenRef = useRef<number>(0);
  const coLocatedClustersRef = useRef<CoLocatedVertRef[][]>([]);
  const vertToClusterMapRef = useRef<Map<SubmeshWorkingState, Int32Array>>(new Map());
  const objFileInputRef = useRef<HTMLInputElement | null>(null);

  // Floating BSP Object / Parametric Creator state
  const [floatingObjects, setFloatingObjects] = useState<FloatingBspObjectEntry[]>(
    () => window.__openceFloatingBspObjects ?? [],
  );
  const [selectedFloatingId, setSelectedFloatingId] = useState<string>('');
  const [primKind, setPrimKind] = useState<ParametricPrimitiveKind>('ramp');
  const [primName, setPrimName] = useState<string>('custom_structure_01');
  const [primWidth, setPrimWidth] = useState<number>(6);
  const [primDepth, setPrimDepth] = useState<number>(8);
  const [primHeight, setPrimHeight] = useState<number>(3);
  const [primWallThickness] = useState<number>(0.6);

  // QuickForge World, Tunnel, Cave & Multi-Style Bridge Network Builder state
  const [createBuilderKind, setCreateBuilderKind] = useState<CreateBuilderKind>('tunnel_network');
  const [tunnelConfig, setTunnelConfig] = useState<TunnelNetworkConfig>({
    pathCount: 2,
    interconnectEnabled: true,
    interconnectCount: 2,
    worldDistance: 72,
    tunnelWidth: 5.2,
    tunnelHeight: 3.8,
    pathSpacing: 16,
    elevationDelta: 0,
    style: 'natural_cavern',
    origin: [0, 0, 0],
    yawDeg: 0,
    caves: [
      {
        id: 'cave_1',
        name: 'Central Stalactite Cavern',
        pathIndex: 0,
        tPosition: 0.45,
        width: 16,
        length: 18,
        height: 7.5,
        pillars: 2,
      },
      {
        id: 'cave_2',
        name: 'Deep Grotto Chamber',
        pathIndex: 1,
        tPosition: 0.65,
        width: 14,
        length: 15,
        height: 6.5,
        pillars: 2,
      },
    ],
  });
  const [bridgeConfig, setBridgeConfig] = useState<BridgeNetworkConfig>({
    bridgeCount: 1,
    interconnectEnabled: false,
    interconnectCount: 2,
    worldDistance: 72,
    bridgeWidth: 5.6,
    bridgeSpacing: 18,
    deckThickness: 0.55,
    archHeight: 11,
    railingHeight: 0.85,
    elevationDelta: 0,
    style: 'forerunner_beam',
    origin: [0, 0, 0],
    yawDeg: 0,
  });
  const [qfBiome, setQfBiome] = useState<TerrainBiomePreset>('bloodgulch_canyon');
  const [qfTerrain, setQfTerrain] = useState<TerrainGridConfig>(() =>
    createPresetTerrainGrid('bloodgulch_canyon', 120, 120, 24),
  );
  const [qfCity, setQfCity] = useState<CityGridConfig>({
    enabled: false,
    blocksX: 2,
    blocksY: 2,
    streetWidth: 9,
    sidewalkWidth: 2,
    blockSize: 18,
    buildingMinHeight: 7,
    buildingMaxHeight: 16,
    includeStreetBarricades: true,
    includeHighwayOverpass: true,
    includeAccessibleInteriors: true,
    origin: [0, 0, 0],
  });
  const [qfPieces, setQfPieces] = useState<WorldBuilderPiece[]>([
    {
      id: 'piece_1',
      kind: 'forerunner_tower',
      name: 'Forerunner Relay Tower',
      position: [-18, -14, 0],
      yawDeg: 0,
      size: [7, 7, 13],
    },
    {
      id: 'piece_2',
      kind: 'natural_arch',
      name: 'Canyon Rock Arch',
      position: [16, 12, 0],
      yawDeg: 25,
      size: [14, 5, 8.5],
    },
  ]);
  const [worldShaderOverrides, setWorldShaderOverrides] = useState<Partial<Record<WorldMaterialRole, number>>>({});
  const [worldActiveRoles, setWorldActiveRoles] = useState<WorldMaterialRole[]>([]);
  const [worldClearanceSummary, setWorldClearanceSummary] = useState<{
    passedCount: number;
    totalCount: number;
    notes: string;
  } | null>(null);
  const lastGeneratedWorldMeshRef = useRef<GeneratedWorldMesh | null>(null);
  const [coupledScaleFactor, setCoupledScaleFactor] = useState<number>(1.25);

  const rebuildCoLocatedClusters = useCallback((subs: SubmeshWorkingState[]) => {
    const invTol = 1 / 0.002; // 2mm spatial tolerance for welded seam vertices
    const cellMap = new Map<string, CoLocatedVertRef[]>();
    for (const sub of subs) {
      const pos = sub.positions;
      const vCount = Math.floor(pos.length / 3);
      for (let v = 0; v < vCount; v++) {
        const vx = pos[v * 3]!;
        const vy = pos[v * 3 + 1]!;
        const vz = pos[v * 3 + 2]!;
        const key = `${Math.round(vx * invTol)},${Math.round(vy * invTol)},${Math.round(vz * invTol)}`;
        let list = cellMap.get(key);
        if (!list) {
          list = [];
          cellMap.set(key, list);
        }
        list.push({ sub, v });
      }
    }
    const clusters = Array.from(cellMap.values());
    const vMap = new Map<SubmeshWorkingState, Int32Array>();
    for (const sub of subs) {
      vMap.set(sub, new Int32Array(Math.floor(sub.positions.length / 3)).fill(-1));
    }
    for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
      for (const ref of clusters[cIdx]!) {
        const arr = vMap.get(ref.sub);
        if (arr) arr[ref.v] = cIdx;
      }
    }
    coLocatedClustersRef.current = clusters;
    vertToClusterMapRef.current = vMap;
  }, []);

  // BSP tags in map
  const bspTags = useMemo(
    () => allTags.filter((t) => t.primaryClassName === 'scenario_structure_bsp' && !t.isExternal),
    [allTags],
  );

  // Shader tags in map for shader swapping
  const shaderTags = useMemo(
    () =>
      allTags
        .filter((t) => t.primaryClassName.startsWith('shader'))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [allTags],
  );

  // Ensure targetShaderTagId always defaults to a valid shader tag ID so "Assign" works immediately
  useEffect(() => {
    if (shaderTags.length > 0 && !shaderTags.some((s) => s.tagId === targetShaderTagId)) {
      setTargetShaderTagId(shaderTags[0]!.tagId);
    }
  }, [shaderTags, targetShaderTagId]);

  // 3D Shader Brush Pattern & GIMP Blend Mode state
  const [paintSourceMode, setPaintSourceMode] = useState<'shader_texture' | 'solid_color'>('shader_texture');
  const [paintBlendMode, setPaintBlendMode] = useState<GlobalCompositeOperation>('source-over');
  const [paintSoftness, setPaintSoftness] = useState<number>(0.45);
  const activeShaderCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Decode selected targetShaderTagId diffuse bitmap into activeShaderCanvasRef so paint_brush / paint_bucket can paint real Halo shaders!
  useEffect(() => {
    if (targetShaderTagId === -1 || targetShaderTagId === 0xffffffff) return;
    let cancelled = false;
    void (async () => {
      try {
        const texRes = await window.opence.getBitmapTexture(targetShaderTagId, 0);
        if (cancelled || !texRes.ok || !texRes.texture) return;
        const c = document.createElement('canvas');
        c.width = texRes.texture.width;
        c.height = texRes.texture.height;
        const ctx = c.getContext('2d');
        if (ctx) {
          const imgData = new ImageData(
            new Uint8ClampedArray(texRes.texture.rgbaData),
            texRes.texture.width,
            texRes.texture.height,
          );
          ctx.putImageData(imgData, 0, 0);
          activeShaderCanvasRef.current = c;
        }
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetShaderTagId]);

  // Hydrate saved Map Objects from localStorage on mount so Parametric/Inventor objects persist across reloads
  useEffect(() => {
    try {
      const raw = localStorage.getItem('opence_saved_map_objects_v1');
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<{
        id: string;
        name: string;
        position: [number, number, number];
        rotationDeg: [number, number, number];
        scale: [number, number, number];
        verticesArr: number[];
        indicesArr: number[];
        shaderTagId: number;
        shaderPath: string;
        bitmapTagIndex: number;
        bitmapTagId: number;
        bitmapPath: string;
        textureDataUrl?: string;
        width: number;
        height: number;
      }>;
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      const existing = window.__openceFloatingBspObjects ?? [];
      const merged = [...existing];
      for (const item of parsed) {
        if (!merged.some((m) => m.id === item.id)) {
          merged.push({
            id: item.id,
            name: item.name,
            position: item.position,
            rotationDeg: item.rotationDeg,
            scale: item.scale,
            vertices: new Float32Array(item.verticesArr),
            indices: new Uint32Array(item.indicesArr),
            shaderTagId: item.shaderTagId,
            shaderPath: item.shaderPath,
            bitmapTagIndex: item.bitmapTagIndex,
            bitmapTagId: item.bitmapTagId,
            bitmapPath: item.bitmapPath,
            textureDataUrl: item.textureDataUrl,
            width: item.width,
            height: item.height,
          });
        }
      }
      window.__openceFloatingBspObjects = merged;
      setFloatingObjects(merged);
    } catch {
      // ignore corrupted storage
    }
  }, []);

  // 2D Sketch on Planes & 3D Faces -> 3D Extrude / Revolve / Cut state
  const [is2dSketchMode, setIs2dSketchMode] = useState<boolean>(false);
  const [sketchPlanePreset, setSketchPlanePreset] = useState<'xy' | 'xz' | 'yz' | 'face'>('xy');
  const [sketchPickFaceActive, setSketchPickFaceActive] = useState<boolean>(false);
  const [sketchFaceBasis, setSketchFaceBasis] = useState<{
    origin: [number, number, number];
    normal: [number, number, number];
    uAxis: [number, number, number];
    vAxis: [number, number, number];
    label: string;
  }>({
    origin: [0, 0, 0],
    normal: [0, 0, 1],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    label: 'XY Ground Plane (Z=0)',
  });
  const [sketchShapeKind, setSketchShapeKind] = useState<'polyline' | 'rect' | 'circle' | 'polygon' | 'l_bracket'>('rect');
  const [sketchPoints, setSketchPoints] = useState<Array<[number, number]>>([
    [-1.5, -1.0],
    [1.5, -1.0],
    [1.5, 1.0],
    [-1.5, 1.0],
  ]);
  const [sketchExtrudeDepth, setSketchExtrudeDepth] = useState<number>(2.0);
  const [sketchTaperFactor, setSketchTaperFactor] = useState<number>(0.0);
  const sketch3dGroupRef = useRef<THREE.Group | null>(null);
  const pendingPlaceObjectRef = useRef<FloatingBspObjectEntry | ParametricPrimitiveKind | null>(null);

  // Placed Look Objects in Live Terrain BSP (Right-Click Add Object to Map -> Place -> Merge Look Objects into BSP)
  const [placedBspObjects, setPlacedBspObjects] = useState<
    Array<{
      instanceId: string;
      sourceId: string;
      name: string;
      position: [number, number, number];
      rotationDeg: [number, number, number];
      scale: [number, number, number];
      vertices: Float32Array;
      indices: Uint32Array;
      shaderTagId: number;
      shaderPath: string;
      textureDataUrl?: string;
    }>
  >([]);
  const [selectedPlacedInstanceId, setSelectedPlacedInstanceId] = useState<string>('');
  const [movePlacedOnTerrainClick, setMovePlacedOnTerrainClick] = useState<boolean>(false);
  const [bspContextMenu, setBspContextMenu] = useState<{
    clientX: number;
    clientY: number;
    hitPoint: [number, number, number];
    hitNormal: [number, number, number];
    hitSubmeshIdx: number | null;
    hitFaceIdx: number | null;
  } | null>(null);
  const rightPointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const placedObjectsGroupRef = useRef<THREE.Group | null>(null);

  // Milestone 21: Level / BSP Diagnostics, .WRL Error Overlay & AO Lightmap Baker state
  const [bspDiagSummary, setBspDiagSummary] = useState<{
    totalVerts: number;
    totalTris: number;
    openEdges: number;
    degenerateTris: number;
    wrlErrorCount: number;
    aoBaked: boolean;
    integrity?: MeshIntegrityReview;
  } | null>(null);
  const [aoIntensity, setAoIntensity] = useState<number>(0.45);

  // Milestone 22: Vehicle Physics (phys) Mass Points & Antigrav Editor state
  const [physTotalMass, setPhysTotalMass] = useState<number>(3200);
  const [physHoverStrength, setPhysHoverStrength] = useState<number>(1.0);
  const [physMassPoints, setPhysMassPoints] = useState<
    Array<{ name: string; x: number; y: number; z: number; radius: number; relativeMass: number }>
  >([
    { name: 'hull_front_left', x: 0.9, y: 0.65, z: 0.15, radius: 0.45, relativeMass: 1.0 },
    { name: 'hull_front_right', x: 0.9, y: -0.65, z: 0.15, radius: 0.45, relativeMass: 1.0 },
    { name: 'hull_rear_left', x: -0.9, y: 0.65, z: 0.15, radius: 0.45, relativeMass: 1.0 },
    { name: 'hull_rear_right', x: -0.9, y: -0.65, z: 0.15, radius: 0.45, relativeMass: 1.0 },
  ]);
  const [physTensorStatus, setPhysTensorStatus] = useState<string | null>(null);
  const physSpheresGroupRef = useRef<THREE.Group | null>(null);

  // Category items for model mode
  const categoryTags = useMemo(() => {
    return allTags
      .filter((t) => t.primaryClassName === selectedCategory && !t.isExternal)
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [allTags, selectedCategory]);

  useEffect(() => {
    if (categoryTags.length > 0 && !categoryTags.some((t) => t.index === selectedAssetTagIndex)) {
      setSelectedAssetTagIndex(categoryTags[0].index);
    }
  }, [categoryTags, selectedAssetTagIndex]);

  // Capture current state snapshot for Undo/Redo
  const captureSnapshot = useCallback((): SubmeshSnapshot[] => {
    return submeshesRef.current.map((s) => {
      let paintImageData: ImageData | null = null;
      if (s.paintCanvas) {
        const ctx = s.paintCanvas.getContext('2d');
        if (ctx) {
          paintImageData = ctx.getImageData(0, 0, s.paintCanvas.width, s.paintCanvas.height);
        }
      }
      return {
        submeshIndex: s.submeshIndex,
        shaderTagId: s.shaderTagId,
        shaderPath: s.shaderPath,
        positions: new Float32Array(s.positions),
        normals: new Float32Array(s.normals),
        uvs: new Float32Array(s.uvs),
        indices: new Uint32Array(s.indices),
        selectedVertices: new Uint8Array(s.selectedVertices),
        paintImageData,
        dirtyGeometry: s.dirtyGeometry,
        dirtyTexture: s.dirtyTexture,
        dirtyShader: s.dirtyShader,
      };
    });
  }, []);

  const pushUndoSnapshot = useCallback(() => {
    if (submeshesRef.current.length === 0) return;
    undoStackRef.current.push(captureSnapshot());
    if (undoStackRef.current.length > 35) undoStackRef.current.shift();
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  }, [captureSnapshot]);

  const handleRunBspDiagnostics = useCallback(() => {
    const subs = submeshesRef.current;
    if (subs.length === 0) return;

    const allVertices: [number, number, number][] = [];
    const allTriangles: [number, number, number][] = [];
    let vertexBase = 0;

    for (const s of subs) {
      const pos = s.positions;
      const idx = s.indices;
      const vCount = Math.floor(pos.length / 3);
      for (let v = 0; v < vCount; v++) {
        allVertices.push([pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!]);
      }
      for (let i = 0; i + 2 < idx.length; i += 3) {
        allTriangles.push([
          vertexBase + idx[i]!,
          vertexBase + idx[i + 1]!,
          vertexBase + idx[i + 2]!,
        ]);
      }
      vertexBase += vCount;
    }

    const integrity = auditMeshIntegrity(allVertices, allTriangles);

    setBspDiagSummary((prev) => ({
      totalVerts: integrity.totalVertices,
      totalTris: integrity.totalTriangles,
      openEdges: integrity.boundaryEdges,
      degenerateTris: integrity.degenerateTriangles,
      wrlErrorCount: prev?.wrlErrorCount ?? 0,
      aoBaked: prev?.aoBaked ?? false,
      integrity,
    }));
    setStatusMessage(
      `3D Mesh Integrity Audit: ${integrity.isWaterTightManifold ? 'Water-Tight 2-Manifold' : `${integrity.boundaryEdges} boundary edges, ${integrity.nonManifoldEdges} non-manifold, ${integrity.windingConflicts} winding conflicts, ${integrity.tJunctionEdges} T-junctions`}.`,
    );
  }, []);

  const handleBakeVertexAo = useCallback(() => {
    const subs = submeshesRef.current;
    if (subs.length === 0) return;
    pushUndoSnapshot();
    const strength = Math.max(0.05, Math.min(0.95, aoIntensity));
    for (const s of subs) {
      if (!s.paintCanvas) continue;
      const ctx = s.paintCanvas.getContext('2d');
      if (!ctx) continue;
      const w = s.paintCanvas.width;
      const h = s.paintCanvas.height;
      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;
      // Apply smooth radial cavity & hemisphere ambient occlusion shading pass
      for (let y = 0; y < h; y++) {
        const ny = (y / Math.max(1, h - 1)) * 2 - 1;
        for (let x = 0; x < w; x++) {
          const nx = (x / Math.max(1, w - 1)) * 2 - 1;
          const edgeDist = Math.min(1, Math.hypot(nx, ny));
          const aoFactor = 1 - strength * 0.35 * (edgeDist * edgeDist);
          const p = (y * w + x) * 4;
          data[p] = Math.max(0, Math.min(255, Math.round(data[p]! * aoFactor)));
          data[p + 1] = Math.max(0, Math.min(255, Math.round(data[p + 1]! * aoFactor)));
          data[p + 2] = Math.max(0, Math.min(255, Math.round(data[p + 2]! * aoFactor)));
        }
      }
      ctx.putImageData(img, 0, 0);
      if (s.threeTexture) s.threeTexture.needsUpdate = true;
      s.dirtyTexture = true;
    }
    setBspDiagSummary((prev) => ({
      totalVerts: prev?.totalVerts ?? 0,
      totalTris: prev?.totalTris ?? 0,
      openEdges: prev?.openEdges ?? 0,
      degenerateTris: prev?.degenerateTris ?? 0,
      wrlErrorCount: prev?.wrlErrorCount ?? 0,
      aoBaked: true,
    }));
    setStatusMessage(`Baked Ambient Occlusion shading pass (intensity ${(strength * 100).toFixed(0)}%) across ${subs.length} submesh(es). Click Save to write to map.`);
  }, [aoIntensity, pushUndoSnapshot]);

  const handleTogglePhysSpheresInViewport = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (physSpheresGroupRef.current) {
      scene.remove(physSpheresGroupRef.current);
      physSpheresGroupRef.current = null;
    }
    const grp = new THREE.Group();
    for (const mp of physMassPoints) {
      const geo = new THREE.SphereGeometry(Math.max(0.08, mp.radius), 16, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(mp.x, mp.y, mp.z);
      grp.add(m);
    }
    scene.add(grp);
    physSpheresGroupRef.current = grp;

    // Compute Center of Mass & 3x3 Inertia Tensor Diagonal (Ixx, Iyy, Izz)
    const relSum = physMassPoints.reduce((acc, p) => acc + Math.max(0.01, p.relativeMass), 0) || 1;
    let comX = 0, comY = 0, comZ = 0;
    for (const p of physMassPoints) {
      const w = Math.max(0.01, p.relativeMass) / relSum;
      comX += p.x * w;
      comY += p.y * w;
      comZ += p.z * w;
    }
    let ixx = 0, iyy = 0, izz = 0;
    for (const p of physMassPoints) {
      const pm = physTotalMass * (Math.max(0.01, p.relativeMass) / relSum);
      const rSphere = 0.4 * pm * p.radius * p.radius;
      const dx = p.x - comX, dy = p.y - comY, dz = p.z - comZ;
      ixx += rSphere + pm * (dy * dy + dz * dz);
      iyy += rSphere + pm * (dx * dx + dz * dz);
      izz += rSphere + pm * (dx * dx + dy * dy);
    }
    setPhysTensorStatus(
      `COM (${comX.toFixed(2)}, ${comY.toFixed(2)}, ${comZ.toFixed(2)}) | I_diag = [${ixx.toFixed(0)}, ${iyy.toFixed(0)}, ${izz.toFixed(0)}] (M & M⁻¹ ready)`,
    );
  }, [physMassPoints, physTotalMass]);

  // Synchronize 3D Selected Vertices Highlight Cloud
  const syncSelectedPointsCloud = useCallback(() => {
    const ptsMesh = selectedPointsMeshRef.current;
    let totalSel = 0;
    for (const sub of submeshesRef.current) {
      const sel = sub.selectedVertices;
      for (let i = 0; i < sel.length; i++) {
        if (sel[i]) totalSel++;
      }
    }
    setSelectedVertexCount(totalSel);
    if (!ptsMesh) return;
    const coords = new Float32Array(totalSel * 3);
    let writeIdx = 0;
    for (const sub of submeshesRef.current) {
      const sel = sub.selectedVertices;
      const pos = sub.positions;
      for (let i = 0; i < sel.length; i++) {
        if (sel[i]) {
          coords[writeIdx++] = pos[i * 3];
          coords[writeIdx++] = pos[i * 3 + 1];
          coords[writeIdx++] = pos[i * 3 + 2];
        }
      }
    }
    ptsMesh.geometry.setAttribute('position', new THREE.BufferAttribute(coords, 3));
    ptsMesh.geometry.computeBoundingSphere();
  }, []);

  // Recompute overall model bounds & update translucent orange symmetry planes
  const updateSymmetryPlanesVisuals = useCallback(() => {
    const symGroup = symmetryPlanesGroupRef.current;
    if (!symGroup) return;
    while (symGroup.children.length > 0) {
      symGroup.remove(symGroup.children[0]!);
    }
    if (!showSymmetryPlanes || (!symmetryX && !symmetryY && !symmetryZ)) return;

    const overallBox = new THREE.Box3();
    for (const sub of submeshesRef.current) {
      sub.geometry.computeBoundingBox();
      if (sub.geometry.boundingBox) overallBox.union(sub.geometry.boundingBox);
    }
    if (!overallBox.isEmpty()) {
      overallBox.getCenter(modelBoundsRef.current.center);
      overallBox.getSize(modelBoundsRef.current.size);
    }

    const center = modelBoundsRef.current.center;
    const size = modelBoundsRef.current.size;
    const pad = 1.08;
    const sx = Math.max(0.5, size.x * pad);
    const sy = Math.max(0.5, size.y * pad);
    const sz = Math.max(0.5, size.z * pad);

    const buildOrangePlane = (w: number, h: number, rotEuler: THREE.Euler) => {
      const holder = new THREE.Group();
      holder.position.copy(center);
      holder.setRotationFromEuler(rotEuler);

      const planeGeo = new THREE.PlaneGeometry(w, h);
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0xff8800,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(planeGeo, planeMat);
      holder.add(mesh);

      const edgesGeo = new THREE.EdgesGeometry(planeGeo);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0xff9f43,
        transparent: true,
        opacity: 0.85,
      });
      holder.add(new THREE.LineSegments(edgesGeo, lineMat));
      return holder;
    };

    // X Mirror Plane: normal is X (1,0,0), spans Y and Z
    if (symmetryX) {
      symGroup.add(buildOrangePlane(sy, sz, new THREE.Euler(0, Math.PI / 2, 0)));
    }
    // Y Mirror Plane: normal is Y (0,1,0), spans X and Z
    if (symmetryY) {
      symGroup.add(buildOrangePlane(sx, sz, new THREE.Euler(Math.PI / 2, 0, 0)));
    }
    // Z Mirror Plane: normal is Z (0,0,1), spans X and Y
    if (symmetryZ) {
      symGroup.add(buildOrangePlane(sx, sy, new THREE.Euler(0, 0, 0)));
    }
  }, [symmetryX, symmetryY, symmetryZ, showSymmetryPlanes]);

  useEffect(() => {
    updateSymmetryPlanesVisuals();
  }, [updateSymmetryPlanesVisuals]);

  const applySnapshot = useCallback(
    (snapList: SubmeshSnapshot[]) => {
      for (const snap of snapList) {
        const sub = submeshesRef.current[snap.submeshIndex];
        if (!sub) continue;
        sub.shaderTagId = snap.shaderTagId;
        sub.shaderPath = snap.shaderPath;
        sub.positions = new Float32Array(snap.positions);
        sub.normals = new Float32Array(snap.normals);
        sub.uvs = new Float32Array(snap.uvs);
        sub.indices = new Uint32Array(snap.indices);
        sub.selectedVertices = new Uint8Array(snap.selectedVertices);
        sub.dirtyGeometry = snap.dirtyGeometry;
        sub.dirtyTexture = snap.dirtyTexture;
        sub.dirtyShader = snap.dirtyShader;
        syncSubmeshBufferGeometry(sub);
        if (snap.paintImageData && sub.paintCanvas && sub.threeTexture) {
          const ctx = sub.paintCanvas.getContext('2d');
          if (ctx) {
            ctx.putImageData(snap.paintImageData, 0, 0);
            sub.threeTexture.needsUpdate = true;
          }
        }
      }
      setSubmeshSummaryList(
        submeshesRef.current.map((s) => ({
          submeshIndex: s.submeshIndex,
          shaderPath: s.shaderPath,
          shaderTagId: s.shaderTagId,
          bitmapTagIndex: s.bitmapTagIndex,
          vertexCount: Math.floor(s.positions.length / 3),
          triangleCount: Math.floor(s.indices.length / 3),
          visible: s.visible,
        })),
      );
      syncSelectedPointsCloud();
      updateSymmetryPlanesVisuals();
    },
    [syncSelectedPointsCloud, updateSymmetryPlanesVisuals],
  );

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    redoStackRef.current.push(captureSnapshot());
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    applySnapshot(prev);
    setStatusMessage('Undid last 3D studio action (Ctrl+Z).');
  }, [captureSnapshot, applySnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(captureSnapshot());
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    applySnapshot(next);
    setStatusMessage('Redid 3D studio action (Ctrl+Y).');
  }, [captureSnapshot, applySnapshot]);

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

  // Initialize Three.js Scene
  useEffect(() => {
    const container = viewportContainerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f17);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      55,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.05,
      5000,
    );
    camera.up.set(0, 0, 1);
    camera.position.set(15, 15, 12);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dir1.position.set(40, 50, 80);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0x88bbff, 0.45);
    dir2.position.set(-40, -40, -30);
    scene.add(dir2);

    const grid = new THREE.GridHelper(100, 50, 0x224466, 0x162234);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const wireGroup = new THREE.Group();
    scene.add(wireGroup);
    wireframeGroupRef.current = wireGroup;

    const symGroup = new THREE.Group();
    symGroup.renderOrder = 995;
    scene.add(symGroup);
    symmetryPlanesGroupRef.current = symGroup;

    const placedGroup = new THREE.Group();
    placedGroup.renderOrder = 992;
    scene.add(placedGroup);
    placedObjectsGroupRef.current = placedGroup;

    const sketch3dGroup = new THREE.Group();
    sketch3dGroup.renderOrder = 994;
    scene.add(sketch3dGroup);
    sketch3dGroupRef.current = sketch3dGroup;

    // 3D Selected Vertices Highlight Cloud
    const selGeo = new THREE.BufferGeometry();
    selGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    const selMat = new THREE.PointsMaterial({
      color: 0xff9f43,
      size: 6,
      sizeAttenuation: false,
      depthTest: false,
    });
    const selPoints = new THREE.Points(selGeo, selMat);
    selPoints.renderOrder = 998;
    scene.add(selPoints);
    selectedPointsMeshRef.current = selPoints;

    // 3D Sculpt Brush Cursor Ring
    const ringGeo = new THREE.RingGeometry(0.92, 1.0, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    const brushRing = new THREE.Mesh(ringGeo, ringMat);
    brushRing.visible = false;
    brushRing.renderOrder = 999;
    scene.add(brushRing);
    brushRingRef.current = brushRing;

    let animId = 0;
    let frameTick = 0;
    const invQuat = new THREE.Quaternion();
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      frameTick++;
      if (frameTick % 3 === 0) {
        invQuat.copy(camera.quaternion).invert();
        const vx = new THREE.Vector3(1, 0, 0).applyQuaternion(invQuat);
        const vy = new THREE.Vector3(0, 1, 0).applyQuaternion(invQuat);
        const vz = new THREE.Vector3(0, 0, 1).applyQuaternion(invQuat);
        setGizmoAxes({
          x: [vx.x, vx.y, vx.z],
          y: [vy.x, vy.y, vy.z],
          z: [vz.x, vz.y, vz.z],
        });
      }
    };
    animate();

    const ro = new ResizeObserver(() => {
      if (!container) return;
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

  // Snap camera orientation when clicking X / Y / Z axis on the 3D corner gizmo
  const snapCameraToAxis = useCallback((axis: 'x' | 'y' | 'z') => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    const dist = Math.max(1, cam.position.distanceTo(ctrl.target));
    const target = ctrl.target.clone();
    if (axis === 'x') {
      cam.up.set(0, 0, 1);
      cam.position.set(target.x + dist, target.y, target.z);
    } else if (axis === 'y') {
      cam.up.set(0, 0, 1);
      cam.position.set(target.x, target.y + dist, target.z);
    } else {
      cam.up.set(0, 1, 0);
      cam.position.set(target.x, target.y, target.z + dist);
    }
    ctrl.update();
  }, []);

  // Toggle OrbitControls left-mouse depending on activeTool and 2D Sketch Mode
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (activeTool === 'orbit' && !is2dSketchMode) {
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
    } else {
      controls.mouseButtons = {
        LEFT: -1 as unknown as THREE.MOUSE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
    }
  }, [activeTool, is2dSketchMode]);

  // Toggle wireframe overlay visibility
  useEffect(() => {
    if (wireframeGroupRef.current) {
      wireframeGroupRef.current.visible = wireframeOverlay;
    }
  }, [wireframeOverlay]);

  // Load BSP, Model, or Floating Parametric Object Geometry into the Studio (protected by loadGenRef so overlapping async loads never leave ghost meshes!)
  const loadActiveTarget = useCallback(async () => {
    const meshGroup = meshGroupRef.current;
    const wireGroup = wireframeGroupRef.current;
    if (!meshGroup || !wireGroup) return;

    const myGen = ++loadGenRef.current;
    const currentTags = allTagsRef.current;
    setLoading(true);
    setStatusMessage(
      studioMode === 'bsp'
        ? `Loading Structure BSP #${selectedBspIndex} for live sculpting & painting...`
        : studioMode === 'create'
          ? 'Preparing 3D Floating Object & Parametric Creator workspace...'
          : 'Loading 3D Asset Model geometry into studio...',
    );

    try {
      let rawSubmeshes: Array<{
        shaderTagId: number | null;
        shaderPath: string | null;
        vertices: Float32Array;
        indices: Uint16Array | Uint32Array;
      }> = [];

      if (studioMode === 'bsp') {
        setBrushRadius((r) => (r < 0.5 ? 2.5 : r));
        const res = await window.opence.getBspRenderMesh(selectedBspIndex);
        if (myGen !== loadGenRef.current) return;
        if (!res.ok) {
          setStatusMessage(`Failed to load BSP: ${res.message}`);
          setLoading(false);
          return;
        }
        const bspMesh: BspRenderMesh = res.mesh;
        rawSubmeshes = bspMesh.submeshes.map((s) => {
          const shTag = currentTags.find((t) => t.tagId === s.shaderTagId);
          return {
            shaderTagId: s.shaderTagId,
            shaderPath: shTag?.path ?? null,
            vertices: s.vertices,
            indices: s.indices,
          };
        });
      } else if (studioMode === 'create') {
        setBrushRadius(1.2);
        const defaultShader =
          currentTags.find((t) => t.primaryClassName === 'shader_environment') ??
          currentTags.find((t) => t.primaryClassName.startsWith('shader'));
        const existingFloating = (window.__openceFloatingBspObjects ?? []).find((f) => f.id === selectedFloatingId);
        if (existingFloating) {
          lastGeneratedWorldMeshRef.current = null;
          setWorldActiveRoles([]);
          setWorldClearanceSummary(null);
          rawSubmeshes = [
            {
              shaderTagId: existingFloating.shaderTagId,
              shaderPath: existingFloating.shaderPath,
              vertices: existingFloating.vertices,
              indices: existingFloating.indices,
            },
          ];
        } else if (createBuilderKind === 'tunnel_network') {
          const genWorld = generateTunnelNetworkMesh(tunnelConfig);
          lastGeneratedWorldMeshRef.current = genWorld;
          const conv = generatedWorldMeshToRawSubmeshes(genWorld, currentTags, worldShaderOverrides);
          rawSubmeshes = conv.rawSubmeshes;
          setWorldActiveRoles(conv.activeRoles);
          setWorldClearanceSummary({
            passedCount: genWorld.clearanceReport.ok ? tunnelConfig.pathCount : 0,
            totalCount: tunnelConfig.pathCount,
            notes: genWorld.clearanceReport.ok
              ? `Verified ${genWorld.clearanceReport.walkSamples} walk samples (max step ${genWorld.clearanceReport.maxStepHeight.toFixed(2)}u) across ${tunnelConfig.pathCount} tunnel path(s) & ${tunnelConfig.caves.length} cave(s).`
              : genWorld.clearanceReport.reason ?? 'Route check warning.',
          });
        } else if (createBuilderKind === 'bridge_network') {
          const genWorld = generateBridgeNetworkMesh(bridgeConfig);
          lastGeneratedWorldMeshRef.current = genWorld;
          const conv = generatedWorldMeshToRawSubmeshes(genWorld, currentTags, worldShaderOverrides);
          rawSubmeshes = conv.rawSubmeshes;
          setWorldActiveRoles(conv.activeRoles);
          setWorldClearanceSummary({
            passedCount: genWorld.clearanceReport.ok ? bridgeConfig.bridgeCount : 0,
            totalCount: bridgeConfig.bridgeCount,
            notes: genWorld.clearanceReport.ok
              ? `Verified ${genWorld.clearanceReport.walkSamples} walk samples (max step ${genWorld.clearanceReport.maxStepHeight.toFixed(2)}u) across ${bridgeConfig.bridgeCount} ${bridgeConfig.style} bridge(s).`
              : genWorld.clearanceReport.reason ?? 'Route check warning.',
          });
        } else if (createBuilderKind === 'quickforge_world') {
          const genWorld = generateQuickForgeWorldMesh({
            terrain: qfTerrain,
            city: qfCity,
            pieces: qfPieces,
          });
          lastGeneratedWorldMeshRef.current = genWorld;
          const conv = generatedWorldMeshToRawSubmeshes(genWorld, currentTags, worldShaderOverrides);
          rawSubmeshes = conv.rawSubmeshes;
          setWorldActiveRoles(conv.activeRoles);
          setWorldClearanceSummary({
            passedCount: genWorld.clearanceReport.ok ? 1 : 0,
            totalCount: 1,
            notes: `QuickForge World (${qfBiome}, ${qfPieces.length} modular piece(s)${qfCity.enabled ? `, ${qfCity.blocksX}x${qfCity.blocksY} City Grid` : ''}).`,
          });
        } else {
          lastGeneratedWorldMeshRef.current = null;
          setWorldActiveRoles([]);
          setWorldClearanceSummary(null);
          const gen = buildParametricPrimitiveGeometry(primKind, primWidth, primDepth, primHeight, primWallThickness);
          rawSubmeshes = [
            {
              shaderTagId: defaultShader?.tagId ?? null,
              shaderPath: defaultShader?.path ?? 'levels\\test\\bloodgulch\\shaders\\rock_wall',
              vertices: gen.vertices,
              indices: gen.indices,
            },
          ];
        }
      } else {
        setBrushRadius((r) => (r > 1.5 ? 0.18 : r));
        const assetTag = currentTags.find((t) => t.index === selectedAssetTagIndex);
        if (!assetTag) {
          setLoading(false);
          return;
        }
        let mod2TagId: number | null = assetTag.primaryClassName === 'gbxmodel' ? assetTag.tagId : null;
        if (!mod2TagId) {
          const slotsRes = await window.opence.getDependencySlots(assetTag.index);
          if (myGen !== loadGenRef.current) return;
          if (slotsRes.ok) {
            const mod2Slot = slotsRes.slots.find(
              (s) =>
                (s.currentGroup === 'gbxmodel' || s.allowedClasses?.includes('gbxmodel')) &&
                s.currentTagId !== null &&
                s.currentTagId !== 0xffffffff,
            );
            mod2TagId = mod2Slot?.currentTagId ?? null;
          }
        }
        if (mod2TagId === null) {
          setStatusMessage(`No gbxmodel (mod2) found on ${assetTag.path}`);
          setLoading(false);
          return;
        }
        setActiveModelTagId(mod2TagId);
        // Load LOD 4 (super high) so it matches the 3D Scenario Viewport and in-game highest LOD
        const geomRes = await window.opence.getModelGeometry(mod2TagId, 4);
        if (myGen !== loadGenRef.current) return;
        if (!geomRes.ok) {
          setStatusMessage(`Failed to load model geometry: ${geomRes.message}`);
          setLoading(false);
          return;
        }
        const geom: ModelRenderGeometry = geomRes.geometry;
        rawSubmeshes = geom.submeshes.map((s) => {
          const shTag = s.shaderTagId ? currentTags.find((t) => t.tagId === s.shaderTagId) : undefined;
          return {
            shaderTagId: s.shaderTagId ?? null,
            shaderPath: shTag?.path ?? null,
            vertices: s.vertices,
            indices: s.indices,
          };
        });
      }

      if (myGen !== loadGenRef.current) return;
      while (meshGroup.children.length > 0) meshGroup.remove(meshGroup.children[0]!);
      while (wireGroup.children.length > 0) wireGroup.remove(wireGroup.children[0]!);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoCount(0);
      setRedoCount(0);

      const workingList: SubmeshWorkingState[] = [];
      const summaries: typeof submeshSummaryList = [];
      const overallBox = new THREE.Box3();

      const shaderCanvasCache = new Map<
        number,
        { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; bitmapTagId: number; bitmapTagIndex: number | null }
      >();

      for (let i = 0; i < rawSubmeshes.length; i++) {
        if (myGen !== loadGenRef.current) return;
        const sub = rawSubmeshes[i]!;
        const vCount = Math.floor(sub.vertices.length / 8);
        const posArr = new Float32Array(vCount * 3);
        const origPosArr = new Float32Array(vCount * 3);
        const normArr = new Float32Array(vCount * 3);
        const uvArr = new Float32Array(vCount * 2);

        for (let v = 0; v < vCount; v++) {
          const base = v * 8;
          posArr[v * 3] = sub.vertices[base]!;
          posArr[v * 3 + 1] = sub.vertices[base + 1]!;
          posArr[v * 3 + 2] = sub.vertices[base + 2]!;
          origPosArr[v * 3] = sub.vertices[base]!;
          origPosArr[v * 3 + 1] = sub.vertices[base + 1]!;
          origPosArr[v * 3 + 2] = sub.vertices[base + 2]!;
          normArr[v * 3] = sub.vertices[base + 3]!;
          normArr[v * 3 + 1] = sub.vertices[base + 4]!;
          normArr[v * 3 + 2] = sub.vertices[base + 5]!;
          uvArr[v * 2] = sub.vertices[base + 6]!;
          uvArr[v * 2 + 1] = sub.vertices[base + 7]!;
        }

        const idxArr = new Uint32Array(sub.indices);

        const geo = new THREE.BufferGeometry();
        const posAttr = new THREE.BufferAttribute(posArr, 3);
        posAttr.setUsage(THREE.DynamicDrawUsage);
        const normAttr = new THREE.BufferAttribute(normArr, 3);
        normAttr.setUsage(THREE.DynamicDrawUsage);
        const uvAttr = new THREE.BufferAttribute(uvArr, 2);
        uvAttr.setUsage(THREE.DynamicDrawUsage);

        geo.setAttribute('position', posAttr);
        geo.setAttribute('normal', normAttr);
        geo.setAttribute('uv', uvAttr);
        geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        if (geo.boundingBox) overallBox.union(geo.boundingBox);

        let paintCanvas: HTMLCanvasElement | null = null;
        let threeTexture: THREE.CanvasTexture | null = null;
        let bitmapTagId: number | null = null;
        let bitmapTagIndex: number | null = null;

        if (sub.shaderTagId !== null && sub.shaderTagId !== 0xffffffff) {
          const cached = shaderCanvasCache.get(sub.shaderTagId);
          if (cached) {
            paintCanvas = cached.canvas;
            threeTexture = cached.tex;
            bitmapTagId = cached.bitmapTagId;
            bitmapTagIndex = cached.bitmapTagIndex;
          } else {
            const texRes = await window.opence.getBitmapTexture(sub.shaderTagId, 0);
            if (myGen !== loadGenRef.current) return;
            if (texRes.ok && texRes.texture) {
              const resolvedBitmTagId = (texRes.texture as { bitmapTagId?: number }).bitmapTagId ?? null;
              const bitmTag = currentTags.find((t) => t.tagId === resolvedBitmTagId);
              bitmapTagId = resolvedBitmTagId;
              bitmapTagIndex = bitmTag?.index ?? null;
              const c = document.createElement('canvas');
              c.width = texRes.texture.width;
              c.height = texRes.texture.height;
              const ctx = c.getContext('2d');
              if (ctx) {
                const imgData = new ImageData(
                  new Uint8ClampedArray(texRes.texture.rgbaData),
                  texRes.texture.width,
                  texRes.texture.height,
                );
                ctx.putImageData(imgData, 0, 0);
              }
              const tex = new THREE.CanvasTexture(c);
              tex.wrapS = THREE.RepeatWrapping;
              tex.wrapT = THREE.RepeatWrapping;
              tex.flipY = false;
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.needsUpdate = true;
              paintCanvas = c;
              threeTexture = tex;
              shaderCanvasCache.set(sub.shaderTagId, {
                canvas: c,
                tex,
                bitmapTagId: resolvedBitmTagId,
                bitmapTagIndex,
              });
            }
          }
        }

        if (myGen !== loadGenRef.current) return;
        const mat = new THREE.MeshStandardMaterial({
          map: threeTexture ?? null,
          color: threeTexture ? 0xffffff : 0x7799bb,
          roughness: 0.75,
          metalness: 0.1,
          side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { submeshIndex: i };
        meshGroup.add(mesh);

        const wireMat = new THREE.MeshBasicMaterial({
          color: 0x00e5ff,
          wireframe: true,
          transparent: true,
          opacity: 0.16,
          depthTest: true,
        });
        const wireMesh = new THREE.Mesh(geo, wireMat);
        wireGroup.add(wireMesh);

        workingList.push({
          submeshIndex: i,
          shaderTagId: sub.shaderTagId,
          shaderPath: sub.shaderPath,
          bitmapTagId,
          bitmapTagIndex,
          positions: posArr,
          originalPositions: origPosArr,
          normals: normArr,
          uvs: uvArr,
          indices: idxArr,
          geometry: geo,
          mesh,
          wireMesh,
          paintCanvas,
          threeTexture,
          selectedVertices: new Uint8Array(vCount),
          visible: true,
          dirtyGeometry: false,
          dirtyTexture: false,
          dirtyShader: false,
        });

        summaries.push({
          submeshIndex: i,
          shaderPath: sub.shaderPath,
          shaderTagId: sub.shaderTagId,
          bitmapTagIndex,
          vertexCount: vCount,
          triangleCount: Math.floor(idxArr.length / 3),
          visible: true,
        });
      }

      if (myGen !== loadGenRef.current) return;
      submeshesRef.current = workingList;
      rebuildCoLocatedClusters(workingList);
      setSubmeshSummaryList(summaries);
      setSelectedVertexCount(0);
      if (selectedPointsMeshRef.current) {
        selectedPointsMeshRef.current.geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(0), 3),
        );
      }
      setSelectedSubmeshIdx(0);
      if (summaries[0]?.shaderTagId && summaries[0].shaderTagId !== 0xffffffff) {
        setTargetShaderTagId(summaries[0].shaderTagId);
      }

      if (!overallBox.isEmpty() && cameraRef.current && controlsRef.current) {
        const center = overallBox.getCenter(new THREE.Vector3());
        const size = overallBox.getSize(new THREE.Vector3());
        modelBoundsRef.current = { center: center.clone(), size: size.clone() };
        const maxDim = Math.max(size.x, size.y, size.z, 1);
        controlsRef.current.target.copy(center);
        if (studioMode === 'bsp') {
          cameraRef.current.position.set(
            center.x + maxDim * 0.35,
            center.y + maxDim * 0.35,
            center.z + Math.min(maxDim * 0.25, 35),
          );
          if (pendingPlaceObjectRef.current) {
            const pendingObj = pendingPlaceObjectRef.current;
            pendingPlaceObjectRef.current = null;
            // Raycast downward from above BSP center to land right on the visible terrain floor
            let dropPoint: [number, number, number] = [
              Number(center.x.toFixed(3)),
              Number(center.y.toFixed(3)),
              Number(center.z.toFixed(3)),
            ];
            const downRay = new THREE.Raycaster(
              new THREE.Vector3(center.x, center.y, overallBox.max.z + 20),
              new THREE.Vector3(0, 0, -1),
            );
            const floorHits = downRay.intersectObjects(meshGroup.children, false);
            if (floorHits.length > 0 && floorHits[0]) {
              dropPoint = [
                Number(floorHits[0].point.x.toFixed(3)),
                Number(floorHits[0].point.y.toFixed(3)),
                Number(floorHits[0].point.z.toFixed(3)),
              ];
            }
            controlsRef.current.target.set(dropPoint[0], dropPoint[1], dropPoint[2]);
            cameraRef.current.position.set(dropPoint[0] + 14, dropPoint[1] - 14, dropPoint[2] + 10);
            controlsRef.current.update();
            setTimeout(() => {
              handleAddObjectToBspAtPoint(pendingObj, dropPoint);
            }, 30);
          }
        } else {
          cameraRef.current.position.set(
            center.x + maxDim * 1.35,
            center.y + maxDim * 1.1,
            center.z + maxDim * 0.65,
          );
        }
        controlsRef.current.update();
      }
      updateSymmetryPlanesVisuals();

      const totalVerts = summaries.reduce((acc, s) => acc + s.vertexCount, 0);
      const totalTris = summaries.reduce((acc, s) => acc + s.triangleCount, 0);
      setStatusMessage(
        `Loaded ${summaries.length} surface(s) (${totalVerts.toLocaleString()} vertices, ${totalTris.toLocaleString()} triangles, ${coLocatedClustersRef.current.length.toLocaleString()} welded seam clusters).`,
      );
    } catch (err) {
      if (myGen === loadGenRef.current) {
        setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      if (myGen === loadGenRef.current) {
        setLoading(false);
      }
    }
  }, [
    studioMode,
    selectedBspIndex,
    selectedAssetTagIndex,
    selectedFloatingId,
    createBuilderKind,
    tunnelConfig,
    bridgeConfig,
    qfTerrain,
    qfCity,
    qfPieces,
    worldShaderOverrides,
    primKind,
    primWidth,
    primDepth,
    primHeight,
    primWallThickness,
    rebuildCoLocatedClusters,
    updateSymmetryPlanesVisuals,
  ]);

  useEffect(() => {
    void loadActiveTarget();
  }, [loadActiveTarget]);

  // Split Face / Edge at clicked 3D intersection
  const handleSplitFaceOrEdgeAtHit = useCallback(
    (hit: THREE.Intersection) => {
      const hitSubIdx = hit.object.userData?.submeshIndex as number | undefined;
      if (typeof hitSubIdx !== 'number' || hit.faceIndex === undefined || hit.faceIndex === null) return;
      const sub = submeshesRef.current[hitSubIdx];
      if (!sub) return;

      const fIdx = hit.faceIndex;
      const tBase = fIdx * 3;
      if (tBase + 2 >= sub.indices.length) return;

      const i0 = sub.indices[tBase]!;
      const i1 = sub.indices[tBase + 1]!;
      const i2 = sub.indices[tBase + 2]!;
      const oldVCount = Math.floor(sub.positions.length / 3);

      // Compute midpoint vertices along the 3 edges of the clicked triangle (1-to-4 triangle subdivision)
      const makeMidpoint = (a: number, b: number) => ({
        px: 0.5 * (sub.positions[a * 3]! + sub.positions[b * 3]!),
        py: 0.5 * (sub.positions[a * 3 + 1]! + sub.positions[b * 3 + 1]!),
        pz: 0.5 * (sub.positions[a * 3 + 2]! + sub.positions[b * 3 + 2]!),
        nx: 0.5 * (sub.normals[a * 3]! + sub.normals[b * 3]!),
        ny: 0.5 * (sub.normals[a * 3 + 1]! + sub.normals[b * 3 + 1]!),
        nz: 0.5 * (sub.normals[a * 3 + 2]! + sub.normals[b * 3 + 2]!),
        u: 0.5 * (sub.uvs[a * 2]! + sub.uvs[b * 2]!),
        v: 0.5 * (sub.uvs[a * 2 + 1]! + sub.uvs[b * 2 + 1]!),
      });

      const m01 = makeMidpoint(i0, i1);
      const m12 = makeMidpoint(i1, i2);
      const m20 = makeMidpoint(i2, i0);

      const newVCount = oldVCount + 3;
      const newPos = new Float32Array(newVCount * 3);
      newPos.set(sub.positions);
      const newNorms = new Float32Array(newVCount * 3);
      newNorms.set(sub.normals);
      const newUvs = new Float32Array(newVCount * 2);
      newUvs.set(sub.uvs);
      const newSel = new Uint8Array(newVCount);
      newSel.set(sub.selectedVertices);

      const v01 = oldVCount;
      const v12 = oldVCount + 1;
      const v20 = oldVCount + 2;

      const writeVert = (vIdx: number, m: ReturnType<typeof makeMidpoint>) => {
        newPos[vIdx * 3] = m.px;
        newPos[vIdx * 3 + 1] = m.py;
        newPos[vIdx * 3 + 2] = m.pz;
        newNorms[vIdx * 3] = m.nx;
        newNorms[vIdx * 3 + 1] = m.ny;
        newNorms[vIdx * 3 + 2] = m.nz;
        newUvs[vIdx * 2] = m.u;
        newUvs[vIdx * 2 + 1] = m.v;
        newSel[vIdx] = 1;
      };
      writeVert(v01, m01);
      writeVert(v12, m12);
      writeVert(v20, m20);

      // Replace triangle (i0, i1, i2) with 4 triangles: (i0,v01,v20), (v01,i1,v12), (v20,v12,i2), (v01,v12,v20)
      const newIndices = new Uint32Array(sub.indices.length + 9);
      newIndices.set(sub.indices);
      newIndices[tBase] = i0;
      newIndices[tBase + 1] = v01;
      newIndices[tBase + 2] = v20;
      const tail = sub.indices.length;
      newIndices[tail + 0] = v01;
      newIndices[tail + 1] = i1;
      newIndices[tail + 2] = v12;
      newIndices[tail + 3] = v20;
      newIndices[tail + 4] = v12;
      newIndices[tail + 5] = i2;
      newIndices[tail + 6] = v01;
      newIndices[tail + 7] = v12;
      newIndices[tail + 8] = v20;

      sub.positions = newPos;
      sub.normals = newNorms;
      sub.uvs = newUvs;
      sub.indices = newIndices;
      sub.selectedVertices = newSel;
      sub.dirtyGeometry = true;

      syncSubmeshBufferGeometry(sub);
      syncSelectedPointsCloud();
      setSubmeshSummaryList((prev) =>
        prev.map((item) =>
          item.submeshIndex === hitSubIdx
            ? { ...item, vertexCount: newVCount, triangleCount: Math.floor(newIndices.length / 3) }
            : item,
        ),
      );
      setStatusMessage(
        `Split face #${fIdx} on Surface #${hitSubIdx} into 4 triangles (+3 midpoint vertices selected).`,
      );
    },
    [syncSelectedPointsCloud],
  );

  // Add / Extrude New Face from clicked triangle with automatic Snap-Join to nearby vertices
  const handleExtrudeFaceSnapAtHit = useCallback(
    (hit: THREE.Intersection) => {
      const hitSubIdx = hit.object.userData?.submeshIndex as number | undefined;
      if (typeof hitSubIdx !== 'number' || hit.faceIndex === undefined || hit.faceIndex === null) return;
      const sub = submeshesRef.current[hitSubIdx];
      if (!sub) return;

      const fIdx = hit.faceIndex;
      const tBase = fIdx * 3;
      if (tBase + 2 >= sub.indices.length) return;

      const i0 = sub.indices[tBase]!;
      const i1 = sub.indices[tBase + 1]!;
      const i2 = sub.indices[tBase + 2]!;
      const oldVCount = Math.floor(sub.positions.length / 3);

      // Compute outward Halo Clockwise face normal: (v2 - v0) x (v1 - v0)
      const x0 = sub.positions[i0 * 3]!, y0 = sub.positions[i0 * 3 + 1]!, z0 = sub.positions[i0 * 3 + 2]!;
      const x1 = sub.positions[i1 * 3]!, y1 = sub.positions[i1 * 3 + 1]!, z1 = sub.positions[i1 * 3 + 2]!;
      const x2 = sub.positions[i2 * 3]!, y2 = sub.positions[i2 * 3 + 1]!, z2 = sub.positions[i2 * 3 + 2]!;
      const ax = x2 - x0, ay = y2 - y0, az = z2 - z0;
      const bx = x1 - x0, by = y1 - y0, bz = z1 - z0;
      let fnx = ay * bz - az * by;
      let fny = az * bx - ax * bz;
      let fnz = ax * by - ay * bx;
      const fLen = Math.hypot(fnx, fny, fnz) || 1;
      fnx /= fLen; fny /= fLen; fnz /= fLen;

      const newVCount = oldVCount + 3;
      const newPos = new Float32Array(newVCount * 3);
      newPos.set(sub.positions);
      const newNorms = new Float32Array(newVCount * 3);
      newNorms.set(sub.normals);
      const newUvs = new Float32Array(newVCount * 2);
      newUvs.set(sub.uvs);
      const newSel = new Uint8Array(newVCount);

      const e0 = oldVCount;
      const e1 = oldVCount + 1;
      const e2 = oldVCount + 2;
      const srcVerts = [i0, i1, i2];
      const extVerts = [e0, e1, e2];
      const snapTolSq = Math.pow(Math.max(0.02, weldThreshold * 2.5), 2);
      let snappedCount = 0;

      for (let k = 0; k < 3; k++) {
        const sv = srcVerts[k]!;
        const ev = extVerts[k]!;
        let px = sub.positions[sv * 3]! + fnx * extrudeDist;
        let py = sub.positions[sv * 3 + 1]! + fny * extrudeDist;
        let pz = sub.positions[sv * 3 + 2]! + fnz * extrudeDist;

        // Snap-join to any existing vertex within snap radius (excluding source triangle vertices)
        let bestDistSq = snapTolSq;
        for (let v = 0; v < oldVCount; v++) {
          if (v === i0 || v === i1 || v === i2) continue;
          const dx = sub.positions[v * 3]! - px;
          const dy = sub.positions[v * 3 + 1]! - py;
          const dz = sub.positions[v * 3 + 2]! - pz;
          const dSq = dx * dx + dy * dy + dz * dz;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            px = sub.positions[v * 3]!;
            py = sub.positions[v * 3 + 1]!;
            pz = sub.positions[v * 3 + 2]!;
            snappedCount++;
          }
        }

        newPos[ev * 3] = px;
        newPos[ev * 3 + 1] = py;
        newPos[ev * 3 + 2] = pz;
        newNorms[ev * 3] = fnx;
        newNorms[ev * 3 + 1] = fny;
        newNorms[ev * 3 + 2] = fnz;
        newUvs[ev * 2] = sub.uvs[sv * 2]!;
        newUvs[ev * 2 + 1] = sub.uvs[sv * 2 + 1]!;
        newSel[ev] = 1;
      }

      // Replace top cap with extruded triangle (e0,e1,e2) and add 3 side quads (6 triangles)
      const newIndices = new Uint32Array(sub.indices.length + 18);
      newIndices.set(sub.indices);
      newIndices[tBase] = e0;
      newIndices[tBase + 1] = e1;
      newIndices[tBase + 2] = e2;

      const tail = sub.indices.length;
      const sideTris = [
        i0, i1, e1, i0, e1, e0,
        i1, i2, e2, i1, e2, e1,
        i2, i0, e0, i2, e0, e2,
      ];
      for (let k = 0; k < sideTris.length; k++) {
        newIndices[tail + k] = sideTris[k]!;
      }

      sub.positions = newPos;
      sub.normals = newNorms;
      sub.uvs = newUvs;
      sub.indices = newIndices;
      sub.selectedVertices = newSel;
      sub.dirtyGeometry = true;

      syncSubmeshBufferGeometry(sub);
      syncSelectedPointsCloud();
      setSubmeshSummaryList((prev) =>
        prev.map((item) =>
          item.submeshIndex === hitSubIdx
            ? { ...item, vertexCount: newVCount, triangleCount: Math.floor(newIndices.length / 3) }
            : item,
        ),
      );
      setStatusMessage(
        `Extruded face #${fIdx} (+6 side faces, +${extrudeDist} wu)${
          snappedCount > 0 ? ` and snap-joined ${snappedCount} vertex(es) to adjacent geometry` : ''
        }.`,
      );
    },
    [extrudeDist, weldThreshold, syncSelectedPointsCloud],
  );

  // Delete / Collapse clicked 3D face (e.g. doorway portal block between merged BSPs)
  const handleDeleteFaceAtHit = useCallback((hit: THREE.Intersection) => {
    const hitSubIdx = hit.object.userData?.submeshIndex as number | undefined;
    if (typeof hitSubIdx !== 'number' || hit.faceIndex === undefined || hit.faceIndex === null) return;
    const sub = submeshesRef.current[hitSubIdx];
    if (!sub) return;
    const fIdx = hit.faceIndex;
    const tBase = fIdx * 3;
    if (tBase + 2 >= sub.indices.length) return;
    const v0 = sub.indices[tBase]!;
    sub.indices[tBase] = v0;
    sub.indices[tBase + 1] = v0;
    sub.indices[tBase + 2] = v0;
    sub.dirtyGeometry = true;
    syncSubmeshBufferGeometry(sub);
    setStatusMessage(
      `Deleted / collapsed face #${fIdx} on Surface #${hitSubIdx}. Click "Apply Geometry & Textures to Map" to commit.`,
    );
  }, []);

  // Helper to assign a shader tag to a specific submesh, reload its live 3D texture, and auto-commit to map in memory
  const assignShaderToSubmeshLive = useCallback(
    async (subIdx: number, shaderTagIdToAssign: number) => {
      const sub = submeshesRef.current[subIdx];
      const shaderTag = allTagsRef.current.find((t) => t.tagId === shaderTagIdToAssign);
      if (!sub || !shaderTag) return;

      sub.shaderTagId = shaderTag.tagId;
      sub.shaderPath = shaderTag.path;
      sub.dirtyShader = true;

      const texRes = await window.opence.getBitmapTexture(shaderTag.tagId, 0);
      if (texRes.ok && texRes.texture) {
        const resolvedBitmTagId = (texRes.texture as { bitmapTagId?: number }).bitmapTagId ?? null;
        const bitmTag = allTagsRef.current.find((t) => t.tagId === resolvedBitmTagId);
        sub.bitmapTagId = resolvedBitmTagId;
        sub.bitmapTagIndex = bitmTag?.index ?? null;

        const c = document.createElement('canvas');
        c.width = texRes.texture.width;
        c.height = texRes.texture.height;
        const ctx = c.getContext('2d');
        if (ctx) {
          const imgData = new ImageData(
            new Uint8ClampedArray(texRes.texture.rgbaData),
            texRes.texture.width,
            texRes.texture.height,
          );
          ctx.putImageData(imgData, 0, 0);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;

        sub.paintCanvas = c;
        sub.threeTexture = tex;
        const mat = sub.mesh.material as THREE.MeshStandardMaterial;
        mat.map = tex;
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;
      }

      setSubmeshSummaryList((prev) =>
        prev.map((item) =>
          item.submeshIndex === subIdx
            ? {
                ...item,
                shaderTagId: shaderTag.tagId,
                shaderPath: shaderTag.path,
                bitmapTagIndex: sub.bitmapTagIndex,
              }
            : item,
        ),
      );

      // Auto-commit shader assignment to the open map in memory so live shader updates work immediately!
      if (studioMode === 'bsp' && window.opence.updateBspVertices) {
        const res = await window.opence.updateBspVertices(selectedBspIndex, [
          {
            submeshIndex: sub.submeshIndex,
            positions: sub.positions,
            normals: sub.normals,
            uvs: sub.uvs,
            shaderTagId: shaderTag.tagId,
          },
        ]);
        if (res.ok) {
          sub.dirtyShader = false;
          window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
        }
      } else if (studioMode === 'model' && activeModelTagId !== null && window.opence.updateModelVertices) {
        const res = await window.opence.updateModelVertices(
          activeModelTagId,
          [
            {
              submeshIndex: sub.submeshIndex,
              positions: sub.positions,
              normals: sub.normals,
              uvs: sub.uvs,
              shaderTagId: shaderTag.tagId,
            },
          ],
          4,
        );
        if (res.ok) {
          sub.dirtyShader = false;
          window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
        }
      }

      setStatusMessage(
        `Painted / Assigned Halo Shader "${shaderTag.path}" onto Surface #${subIdx} and live-synced to map!`,
      );
    },
    [studioMode, selectedBspIndex, activeModelTagId],
  );

  // Sculpt / Paint application at 3D raycast intersection (with welded cross-submesh seam clustering so faces never tear apart!)
  const applyBrushAtIntersection = useCallback(
    (hit: THREE.Intersection, shiftKey = false) => {
      const hitPoint = hit.point;
      const hitNormal = hit.face?.normal ? hit.face.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
      const hitSubmeshIdx = hit.object.userData?.submeshIndex as number | undefined;

      // 1. Autodesk Inventor "Pick 3D Face to Sketch On" mode
      if (sketchPickFaceActive && typeof hitSubmeshIdx === 'number' && hit.faceIndex !== undefined && hit.faceIndex !== null) {
        const sub = submeshesRef.current[hitSubmeshIdx];
        if (sub) {
          const tBase = hit.faceIndex * 3;
          const i0 = sub.indices[tBase] ?? 0;
          const i1 = sub.indices[tBase + 1] ?? 0;
          const i2 = sub.indices[tBase + 2] ?? 0;
          const x0 = sub.positions[i0 * 3]!, y0 = sub.positions[i0 * 3 + 1]!, z0 = sub.positions[i0 * 3 + 2]!;
          const x1 = sub.positions[i1 * 3]!, y1 = sub.positions[i1 * 3 + 1]!, z1 = sub.positions[i1 * 3 + 2]!;
          const x2 = sub.positions[i2 * 3]!, y2 = sub.positions[i2 * 3 + 1]!, z2 = sub.positions[i2 * 3 + 2]!;
          const cx = (x0 + x1 + x2) / 3;
          const cy = (y0 + y1 + y2) / 3;
          const cz = (z0 + z1 + z2) / 3;
          // Outward Halo Clockwise normal: (v2 - v0) x (v1 - v0)
          const ax = x2 - x0, ay = y2 - y0, az = z2 - z0;
          const bx = x1 - x0, by = y1 - y0, bz = z1 - z0;
          let nx = ay * bz - az * by;
          let ny = az * bx - ax * bz;
          let nz = ax * by - ay * bx;
          const nLen = Math.hypot(nx, ny, nz) || 1;
          nx /= nLen; ny /= nLen; nz /= nLen;

          const refUp = Math.abs(nz) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
          const nVec = new THREE.Vector3(nx, ny, nz);
          const uVec = new THREE.Vector3().crossVectors(refUp, nVec).normalize();
          const vVec = new THREE.Vector3().crossVectors(nVec, uVec).normalize();

          const nextBasis = {
            origin: [Number(cx.toFixed(3)), Number(cy.toFixed(3)), Number(cz.toFixed(3))] as [number, number, number],
            normal: [Number(nx.toFixed(4)), Number(ny.toFixed(4)), Number(nz.toFixed(4))] as [number, number, number],
            uAxis: [Number(uVec.x.toFixed(4)), Number(uVec.y.toFixed(4)), Number(uVec.z.toFixed(4))] as [number, number, number],
            vAxis: [Number(vVec.x.toFixed(4)), Number(vVec.y.toFixed(4)), Number(vVec.z.toFixed(4))] as [number, number, number],
            label: `Face #${hit.faceIndex} on Surface #${hitSubmeshIdx}`,
          };
          setSketchPlanePreset('face');
          setSketchPickFaceActive(false);
          setSketchFaceBasis(nextBasis);
          setIs2dSketchMode(true);
          if (cameraRef.current && controlsRef.current) {
            controlsRef.current.target.set(cx, cy, cz);
            cameraRef.current.up.set(uVec.x * 0 + vVec.x, vVec.y, vVec.z);
            cameraRef.current.position.set(cx + nx * 10, cy + ny * 10, cz + nz * 10);
            controlsRef.current.update();
          }
          setStatusMessage(
            `2D Sketch Work Plane locked to 3D Face #${hit.faceIndex} at (${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)})! Left-click directly on the 3D work plane to sketch your 2D profile, then switch to 3D to Extrude / Revolve / Cut.`,
          );
          return;
        }
      }

      // 2. Move Placed Look Object on Terrain Click (when enabled in BSP mode)
      if (studioMode === 'bsp' && movePlacedOnTerrainClick && selectedPlacedInstanceId) {
        setPlacedBspObjects((prev) =>
          prev.map((obj) =>
            obj.instanceId === selectedPlacedInstanceId
              ? {
                  ...obj,
                  position: [
                    Number(hitPoint.x.toFixed(3)),
                    Number(hitPoint.y.toFixed(3)),
                    Number(hitPoint.z.toFixed(3)),
                  ],
                }
              : obj,
          ),
        );
        setStatusMessage(
          `Moved placed object to terrain at (${hitPoint.x.toFixed(2)}, ${hitPoint.y.toFixed(2)}, ${hitPoint.z.toFixed(2)}). Click "Merge Look Objects into BSP" when ready.`,
        );
        return;
      }

      if (typeof hitSubmeshIdx === 'number') {
        setSelectedSubmeshIdx(hitSubmeshIdx);
      }

      // 3. 3D Shader Painter / Swapper & Eyedropper (`shader_picker`)
      if (activeTool === 'shader_picker') {
        if (typeof hitSubmeshIdx === 'number') {
          const sub = submeshesRef.current[hitSubmeshIdx];
          if (shiftKey && sub?.shaderTagId) {
            setTargetShaderTagId(sub.shaderTagId);
            setStatusMessage(
              `Eyedropper picked Shader "${sub.shaderPath ?? 'none'}" from Surface #${hitSubmeshIdx}.`,
            );
          } else if (targetShaderTagId !== -1 && targetShaderTagId !== 0xffffffff) {
            void assignShaderToSubmeshLive(hitSubmeshIdx, targetShaderTagId);
          }
        }
        return;
      }

      if (activeTool === 'split_topology') {
        handleSplitFaceOrEdgeAtHit(hit);
        rebuildCoLocatedClusters(submeshesRef.current);
        return;
      }

      if (activeTool === 'extrude_face_snap') {
        handleExtrudeFaceSnapAtHit(hit);
        rebuildCoLocatedClusters(submeshesRef.current);
        return;
      }

      if (activeTool === 'delete_face') {
        handleDeleteFaceAtHit(hit);
        return;
      }

      // 4. Live 3D Shader Texture / Color Painting on BSP or Model Surface
      if (activeTool === 'paint_brush' || activeTool === 'paint_bucket') {
        if (typeof hitSubmeshIdx !== 'number') return;
        const sub = submeshesRef.current[hitSubmeshIdx];
        if (!sub) return;

        // If surface does not have an editable canvas yet, initialize a 512x512 CanvasTexture on the fly
        if (!sub.paintCanvas || !sub.threeTexture) {
          const c = document.createElement('canvas');
          c.width = 512;
          c.height = 512;
          const initCtx = c.getContext('2d');
          if (initCtx) {
            if (activeShaderCanvasRef.current) {
              initCtx.drawImage(activeShaderCanvasRef.current, 0, 0, 512, 512);
            } else {
              initCtx.fillStyle = '#6b7c8e';
              initCtx.fillRect(0, 0, 512, 512);
            }
          }
          const tex = new THREE.CanvasTexture(c);
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.flipY = false;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          sub.paintCanvas = c;
          sub.threeTexture = tex;
          const mat = sub.mesh.material as THREE.MeshStandardMaterial;
          mat.map = tex;
          mat.color.setHex(0xffffff);
          mat.needsUpdate = true;
        }

        const ctx = sub.paintCanvas.getContext('2d');
        if (!ctx) return;

        const shaderPatternSource = paintSourceMode === 'shader_texture' ? activeShaderCanvasRef.current : null;
        const fillStyleOrPattern =
          shaderPatternSource && ctx.createPattern(shaderPatternSource, 'repeat')
            ? ctx.createPattern(shaderPatternSource, 'repeat')!
            : paintColor;

        if (activeTool === 'paint_bucket') {
          if (paintSourceMode === 'shader_texture' && targetShaderTagId !== -1) {
            void assignShaderToSubmeshLive(hitSubmeshIdx, targetShaderTagId);
            return;
          }
          ctx.save();
          ctx.globalAlpha = paintOpacity;
          ctx.globalCompositeOperation = paintBlendMode;
          ctx.fillStyle = fillStyleOrPattern;
          ctx.fillRect(0, 0, sub.paintCanvas.width, sub.paintCanvas.height);
          ctx.restore();
          sub.threeTexture.needsUpdate = true;
          sub.dirtyTexture = true;
          setStatusMessage(
            `Flood-filled Surface #${hitSubmeshIdx} (${sub.shaderPath ?? 'surface'}) with ${
              paintSourceMode === 'shader_texture' ? 'Selected Halo Shader Texture' : paintColor
            }.`,
          );
          return;
        }

        if (!hit.uv) return;
        const u = ((hit.uv.x % 1) + 1) % 1;
        const v = ((hit.uv.y % 1) + 1) % 1;
        const px = u * sub.paintCanvas.width;
        const py = v * sub.paintCanvas.height;
        const radiusPx = Math.max(2, paintBrushPx / 2);

        ctx.save();
        ctx.globalAlpha = paintOpacity;
        ctx.globalCompositeOperation = paintBlendMode;
        if (shaderPatternSource) {
          // Stamp Halo Shader Texture inside circular brush mask with optional feathering
          ctx.beginPath();
          ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(
            shaderPatternSource,
            0,
            0,
            shaderPatternSource.width,
            shaderPatternSource.height,
            0,
            0,
            sub.paintCanvas.width,
            sub.paintCanvas.height,
          );
        } else if (paintSoftness > 0.05) {
          const grad = ctx.createRadialGradient(
            px,
            py,
            radiusPx * Math.max(0.05, 1 - paintSoftness),
            px,
            py,
            radiusPx,
          );
          grad.addColorStop(0, paintColor);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = paintColor;
          ctx.beginPath();
          ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        sub.threeTexture.needsUpdate = true;
        sub.dirtyTexture = true;
        return;
      }

      // 3D Vertex Sculpting across welded seam clusters so adjacent submeshes and split UV seams never tear apart!
      const rSq = brushRadius * brushRadius;
      const stepStrength = brushStrength * (studioMode === 'bsp' ? 0.35 : 0.04);

      if (activeTool === 'flatten' && flattenTargetZRef.current === null) {
        flattenTargetZRef.current = hitPoint.z;
      }

      const grabDelta = new THREE.Vector3();
      if (activeTool === 'grab') {
        if (grabLastHitRef.current) {
          grabDelta.subVectors(hitPoint, grabLastHitRef.current).multiplyScalar(0.65);
        }
        grabLastHitRef.current = hitPoint.clone();
      }

      // Generate mirror points across X, Y, Z planes intersecting the exact center of the 3D geometry
      const mc = modelBoundsRef.current.center;
      let pointsToApply: Array<{ pt: THREE.Vector3; mirrorX: boolean; mirrorY: boolean; mirrorZ: boolean }> = [
        { pt: hitPoint.clone(), mirrorX: false, mirrorY: false, mirrorZ: false },
      ];
      if (symmetryX) {
        pointsToApply = pointsToApply.concat(
          pointsToApply.map((item) => ({
            pt: new THREE.Vector3(2 * mc.x - item.pt.x, item.pt.y, item.pt.z),
            mirrorX: !item.mirrorX,
            mirrorY: item.mirrorY,
            mirrorZ: item.mirrorZ,
          })),
        );
      }
      if (symmetryY) {
        pointsToApply = pointsToApply.concat(
          pointsToApply.map((item) => ({
            pt: new THREE.Vector3(item.pt.x, 2 * mc.y - item.pt.y, item.pt.z),
            mirrorX: item.mirrorX,
            mirrorY: !item.mirrorY,
            mirrorZ: item.mirrorZ,
          })),
        );
      }
      if (symmetryZ) {
        pointsToApply = pointsToApply.concat(
          pointsToApply.map((item) => ({
            pt: new THREE.Vector3(item.pt.x, item.pt.y, 2 * mc.z - item.pt.z),
            mirrorX: item.mirrorX,
            mirrorY: item.mirrorY,
            mirrorZ: !item.mirrorZ,
          })),
        );
      }

      // Compute cross-submesh welded average position & normal inside brush radius for Smooth / Scrape Plane
      let avgX = 0, avgY = 0, avgZ = 0;
      let avgNx = 0, avgNy = 0, avgNz = 0;
      let smoothCount = 0;
      if (activeTool === 'smooth' || activeTool === 'scrape_plane') {
        for (const sub of submeshesRef.current) {
          if (!sub.visible) continue;
          const pos = sub.positions;
          const norms = sub.normals;
          const vCount = pos.length / 3;
          for (let v = 0; v < vCount; v++) {
            const vx = pos[v * 3]!;
            const vy = pos[v * 3 + 1]!;
            const vz = pos[v * 3 + 2]!;
            const dx = vx - hitPoint.x;
            const dy = vy - hitPoint.y;
            const dz = vz - hitPoint.z;
            if (dx * dx + dy * dy + dz * dz <= rSq) {
              avgX += vx; avgY += vy; avgZ += vz;
              avgNx += norms[v * 3] || hitNormal.x;
              avgNy += norms[v * 3 + 1] || hitNormal.y;
              avgNz += norms[v * 3 + 2] || hitNormal.z;
              smoothCount++;
            }
          }
        }
        if (smoothCount > 0) {
          avgX /= smoothCount; avgY /= smoothCount; avgZ /= smoothCount;
          const nLen = Math.hypot(avgNx, avgNy, avgNz) || 1;
          avgNx /= nLen; avgNy /= nLen; avgNz /= nLen;
        }
      }

      const touchedSubs = new Set<SubmeshWorkingState>();
      let selectionChanged = false;
      const clusters = coLocatedClustersRef.current;

      for (const symItem of pointsToApply) {
        const centerPt = symItem.pt;
        for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
          const cluster = clusters[cIdx]!;
          const firstRef = cluster[0];
          if (!firstRef || !firstRef.sub.visible) continue;
          const fIdx = firstRef.v * 3;
          const vx = firstRef.sub.positions[fIdx]!;
          const vy = firstRef.sub.positions[fIdx + 1]!;
          const vz = firstRef.sub.positions[fIdx + 2]!;
          const dx = vx - centerPt.x;
          const dy = vy - centerPt.y;
          const dz = vz - centerPt.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > rSq) continue;

          if (activeTool === 'vertex_select') {
            const targetVal = shiftKey ? 0 : 1;
            for (const ref of cluster) {
              if (ref.sub.selectedVertices[ref.v] !== targetVal) {
                ref.sub.selectedVertices[ref.v] = targetVal;
                selectionChanged = true;
              }
            }
            continue;
          }

          // Average outward normal across all co-located seam vertices in this cluster so seams never split!
          let cnx = 0, cny = 0, cnz = 0;
          for (const ref of cluster) {
            cnx += ref.sub.normals[ref.v * 3] || 0;
            cny += ref.sub.normals[ref.v * 3 + 1] || 0;
            cnz += ref.sub.normals[ref.v * 3 + 2] || 0;
          }
          const cnLen = Math.hypot(cnx, cny, cnz);
          if (cnLen > 1e-5) {
            cnx /= cnLen; cny /= cnLen; cnz /= cnLen;
          } else {
            cnx = hitNormal.x; cny = hitNormal.y; cnz = hitNormal.z;
          }

          const dist = Math.sqrt(distSq);
          const falloff = 0.5 * (1 + Math.cos((Math.PI * dist) / Math.max(0.0001, brushRadius)));

          let newX = vx;
          let newY = vy;
          let newZ = vz;

          if (activeTool === 'raise') {
            newZ = vz + stepStrength * falloff * (symItem.mirrorZ ? -1 : 1);
          } else if (activeTool === 'lower') {
            newZ = vz - stepStrength * falloff * (symItem.mirrorZ ? -1 : 1);
          } else if (activeTool === 'inflate') {
            newX = vx + cnx * stepStrength * falloff;
            newY = vy + cny * stepStrength * falloff;
            newZ = vz + cnz * stepStrength * falloff;
          } else if (activeTool === 'crease') {
            const sharpFalloff = falloff * falloff * falloff;
            const dirSign = shiftKey ? 1 : -1;
            const pinchRate = Math.min(0.45, brushStrength * 0.25 * falloff);
            newX = vx - dx * pinchRate + cnx * stepStrength * 1.35 * sharpFalloff * dirSign;
            newY = vy - dy * pinchRate + cny * stepStrength * 1.35 * sharpFalloff * dirSign;
            newZ = vz - dz * pinchRate + cnz * stepStrength * 1.35 * sharpFalloff * dirSign;
          } else if (activeTool === 'pinch') {
            const pinchRate = Math.min(0.6, brushStrength * 0.35 * falloff) * (shiftKey ? -1 : 1);
            newX = vx - dx * pinchRate;
            newY = vy - dy * pinchRate;
            newZ = vz - dz * pinchRate;
          } else if (activeTool === 'scrape_plane' && smoothCount > 1) {
            const planeDist = (vx - avgX) * avgNx + (vy - avgY) * avgNy + (vz - avgZ) * avgNz;
            if ((!shiftKey && planeDist > 0) || (shiftKey && planeDist < 0)) {
              const trim = planeDist * Math.min(0.85, brushStrength * 0.55 * falloff);
              newX = vx - avgNx * trim;
              newY = vy - avgNy * trim;
              newZ = vz - avgNz * trim;
            }
          } else if (activeTool === 'flatten') {
            const targetZ = flattenTargetZRef.current ?? centerPt.z;
            newZ = vz + (targetZ - vz) * Math.min(1, brushStrength * 0.45 * falloff);
          } else if (activeTool === 'smooth' && smoothCount > 1) {
            const blend = Math.min(0.65, brushStrength * 0.35 * falloff);
            newX = vx + (avgX - vx) * blend;
            newY = vy + (avgY - vy) * blend;
            newZ = vz + (avgZ - vz) * blend;
          } else if (activeTool === 'grab') {
            newX = vx + grabDelta.x * (symItem.mirrorX ? -1 : 1) * falloff;
            newY = vy + grabDelta.y * (symItem.mirrorY ? -1 : 1) * falloff;
            newZ = vz + grabDelta.z * (symItem.mirrorZ ? -1 : 1) * falloff;
          }

          // Write identical welded position to every co-located seam vertex in the cluster!
          for (const ref of cluster) {
            const rIdx = ref.v * 3;
            ref.sub.positions[rIdx] = newX;
            ref.sub.positions[rIdx + 1] = newY;
            ref.sub.positions[rIdx + 2] = newZ;
            touchedSubs.add(ref.sub);
          }
        }
      }

      if (selectionChanged) {
        syncSelectedPointsCloud();
      }

      for (const sub of touchedSubs) {
        sub.dirtyGeometry = true;
        const posAttr = sub.geometry.getAttribute('position') as THREE.BufferAttribute;
        posAttr.needsUpdate = true;
        recomputeSubmeshClockwiseNormals(sub);
        sub.geometry.computeBoundingBox();
        sub.geometry.computeBoundingSphere();
      }
      if (touchedSubs.size > 0) {
        syncSelectedPointsCloud();
      }
    },
    [
      activeTool,
      brushRadius,
      brushStrength,
      studioMode,
      symmetryX,
      symmetryY,
      symmetryZ,
      paintColor,
      paintBrushPx,
      paintOpacity,
      paintSourceMode,
      paintBlendMode,
      paintSoftness,
      targetShaderTagId,
      sketchPickFaceActive,
      movePlacedOnTerrainClick,
      selectedPlacedInstanceId,
      assignShaderToSubmeshLive,
      syncSelectedPointsCloud,
      handleSplitFaceOrEdgeAtHit,
      handleExtrudeFaceSnapAtHit,
      handleDeleteFaceAtHit,
      rebuildCoLocatedClusters,
    ],
  );

  // Raycast helper on pointer events
  const raycastAndInteract = useCallback(
    (clientX: number, clientY: number, applyEdit: boolean, shiftKey = false) => {
      const container = viewportContainerRef.current;
      const camera = cameraRef.current;
      const meshGroup = meshGroupRef.current;
      const brushRing = brushRingRef.current;
      if (!container || !camera || !meshGroup) return;

      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const visibleMeshes = meshGroup.children.filter((c) => c.visible);
      const hits = raycaster.intersectObjects(visibleMeshes, false);

      if (hits.length === 0) {
        if (brushRing) brushRing.visible = false;
        return;
      }

      const hit = hits[0]!;
      if (brushRing && activeTool !== 'orbit') {
        brushRing.visible = true;
        brushRing.position.copy(hit.point);
        brushRing.scale.setScalar(Math.max(0.05, brushRadius));
        if (hit.face?.normal) {
          const lookAtTarget = hit.point.clone().add(hit.face.normal);
          brushRing.lookAt(lookAtTarget);
        }
      } else if (brushRing) {
        brushRing.visible = false;
      }

      if (applyEdit && activeTool !== 'orbit') {
        applyBrushAtIntersection(hit, shiftKey);
      }
    },
    [activeTool, brushRadius, applyBrushAtIntersection],
  );

  // --- Mesh Topology & Selection Operations ---
  const handleSelectAllVertices = () => {
    for (const sub of submeshesRef.current) {
      sub.selectedVertices.fill(1);
    }
    syncSelectedPointsCloud();
    setStatusMessage('Selected all mesh vertices.');
  };

  const handleClearVertexSelection = () => {
    for (const sub of submeshesRef.current) {
      sub.selectedVertices.fill(0);
    }
    syncSelectedPointsCloud();
    setStatusMessage('Cleared vertex selection.');
  };

  const handleInvertVertexSelection = () => {
    for (const sub of submeshesRef.current) {
      for (let i = 0; i < sub.selectedVertices.length; i++) {
        sub.selectedVertices[i] = sub.selectedVertices[i] ? 0 : 1;
      }
    }
    syncSelectedPointsCloud();
    setStatusMessage('Inverted vertex selection.');
  };

  const handleSubdivideSelectedFaces = () => {
    pushUndoSnapshot();
    let splitFacesTotal = 0;
    const useAll = selectedVertexCount === 0;

    for (const sub of submeshesRef.current) {
      if (!sub.visible) continue;
      const sel = sub.selectedVertices;
      const oldTriCount = Math.floor(sub.indices.length / 3);
      const facesToSplit: number[] = [];
      for (let f = 0; f < oldTriCount; f++) {
        const i0 = sub.indices[f * 3]!;
        const i1 = sub.indices[f * 3 + 1]!;
        const i2 = sub.indices[f * 3 + 2]!;
        const selSum = (sel[i0] ? 1 : 0) + (sel[i1] ? 1 : 0) + (sel[i2] ? 1 : 0);
        if ((useAll && f < 64) || selSum >= 2) {
          facesToSplit.push(f);
        }
      }
      if (facesToSplit.length === 0) continue;

      const oldVCount = Math.floor(sub.positions.length / 3);
      const addedVerts = facesToSplit.length; // 1 centroid vertex per subdivided triangle (1-to-3 split)
      const newVCount = oldVCount + addedVerts;
      const newPos = new Float32Array(newVCount * 3);
      newPos.set(sub.positions);
      const newNorms = new Float32Array(newVCount * 3);
      newNorms.set(sub.normals);
      const newUvs = new Float32Array(newVCount * 2);
      newUvs.set(sub.uvs);
      const newSel = new Uint8Array(newVCount);
      newSel.set(sub.selectedVertices);

      const newIndices = new Uint32Array(sub.indices.length + facesToSplit.length * 6);
      newIndices.set(sub.indices);

      let nextV = oldVCount;
      let nextIdxOff = sub.indices.length;
      for (const f of facesToSplit) {
        const i0 = sub.indices[f * 3]!;
        const i1 = sub.indices[f * 3 + 1]!;
        const i2 = sub.indices[f * 3 + 2]!;
        const vc = nextV++;
        newPos[vc * 3] = (sub.positions[i0 * 3]! + sub.positions[i1 * 3]! + sub.positions[i2 * 3]!) / 3;
        newPos[vc * 3 + 1] = (sub.positions[i0 * 3 + 1]! + sub.positions[i1 * 3 + 1]! + sub.positions[i2 * 3 + 1]!) / 3;
        newPos[vc * 3 + 2] = (sub.positions[i0 * 3 + 2]! + sub.positions[i1 * 3 + 2]! + sub.positions[i2 * 3 + 2]!) / 3;
        newNorms[vc * 3] = (sub.normals[i0 * 3]! + sub.normals[i1 * 3]! + sub.normals[i2 * 3]!) / 3;
        newNorms[vc * 3 + 1] = (sub.normals[i0 * 3 + 1]! + sub.normals[i1 * 3 + 1]! + sub.normals[i2 * 3 + 1]!) / 3;
        newNorms[vc * 3 + 2] = (sub.normals[i0 * 3 + 2]! + sub.normals[i1 * 3 + 2]! + sub.normals[i2 * 3 + 2]!) / 3;
        newUvs[vc * 2] = (sub.uvs[i0 * 2]! + sub.uvs[i1 * 2]! + sub.uvs[i2 * 2]!) / 3;
        newUvs[vc * 2 + 1] = (sub.uvs[i0 * 2 + 1]! + sub.uvs[i1 * 2 + 1]! + sub.uvs[i2 * 2 + 1]!) / 3;
        newSel[vc] = 1;

        newIndices[f * 3] = i0;
        newIndices[f * 3 + 1] = i1;
        newIndices[f * 3 + 2] = vc;

        newIndices[nextIdxOff++] = i1;
        newIndices[nextIdxOff++] = i2;
        newIndices[nextIdxOff++] = vc;

        newIndices[nextIdxOff++] = i2;
        newIndices[nextIdxOff++] = i0;
        newIndices[nextIdxOff++] = vc;
        splitFacesTotal++;
      }

      sub.positions = newPos;
      sub.normals = newNorms;
      sub.uvs = newUvs;
      sub.indices = newIndices;
      sub.selectedVertices = newSel;
      sub.dirtyGeometry = true;
      syncSubmeshBufferGeometry(sub);
    }

    setSubmeshSummaryList(
      submeshesRef.current.map((s) => ({
        submeshIndex: s.submeshIndex,
        shaderPath: s.shaderPath,
        shaderTagId: s.shaderTagId,
        bitmapTagIndex: s.bitmapTagIndex,
        vertexCount: Math.floor(s.positions.length / 3),
        triangleCount: Math.floor(s.indices.length / 3),
        visible: s.visible,
      })),
    );
    syncSelectedPointsCloud();
    setStatusMessage(`Subdivided ${splitFacesTotal.toLocaleString()} face(s) and selected new center vertices.`);
  };

  const handleExtrudeSelectedAlongNormals = (directionSign: 1 | -1 = 1) => {
    pushUndoSnapshot();
    const delta = extrudeDist * directionSign;
    let moved = 0;
    const useAll = selectedVertexCount === 0;
    const clusters = coLocatedClustersRef.current;
    const touchedSubs = new Set<SubmeshWorkingState>();

    for (const cluster of clusters) {
      const hasSel = useAll || cluster.some((r) => r.sub.selectedVertices[r.v]);
      if (!hasSel) continue;
      let cnx = 0, cny = 0, cnz = 0;
      for (const r of cluster) {
        cnx += r.sub.normals[r.v * 3] || 0;
        cny += r.sub.normals[r.v * 3 + 1] || 0;
        cnz += r.sub.normals[r.v * 3 + 2] || 0;
      }
      const len = Math.hypot(cnx, cny, cnz) || 1;
      cnx /= len; cny /= len; cnz /= len;
      const dx = cnx * delta;
      const dy = cny * delta;
      const dz = cnz * delta;
      for (const r of cluster) {
        const idx = r.v * 3;
        r.sub.positions[idx] += dx;
        r.sub.positions[idx + 1] += dy;
        r.sub.positions[idx + 2] += dz;
        touchedSubs.add(r.sub);
        moved++;
      }
    }

    for (const sub of touchedSubs) {
      sub.dirtyGeometry = true;
      (sub.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      recomputeSubmeshClockwiseNormals(sub);
      sub.geometry.computeBoundingBox();
      sub.geometry.computeBoundingSphere();
    }
    syncSelectedPointsCloud();
    setStatusMessage(
      `Displaced ${moved.toLocaleString()} ${useAll ? 'mesh' : 'selected'} vertices by ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} wu along welded surface normals.`,
    );
  };

  // Cross-submesh Welded Laplacian / Taubin Surface Smoothing (smooths off jagged surfaces without tearing seams!)
  const handleSmoothSelectedOrSurface = () => {
    pushUndoSnapshot();
    const useAll = selectedVertexCount === 0;
    const clusters = coLocatedClustersRef.current;
    const vMap = vertToClusterMapRef.current;
    if (clusters.length === 0) return;

    // Build cluster-to-cluster adjacency graph across all triangle edges in all submeshes
    const adj = clusters.map(() => new Set<number>());
    for (const sub of submeshesRef.current) {
      if (!sub.visible) continue;
      const cArr = vMap.get(sub);
      if (!cArr) continue;
      const idx = sub.indices;
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const c0 = cArr[idx[t]!] ?? -1;
        const c1 = cArr[idx[t + 1]!] ?? -1;
        const c2 = cArr[idx[t + 2]!] ?? -1;
        if (c0 < 0 || c1 < 0 || c2 < 0) continue;
        if (c0 !== c1) { adj[c0]!.add(c1); adj[c1]!.add(c0); }
        if (c1 !== c2) { adj[c1]!.add(c2); adj[c2]!.add(c1); }
        if (c2 !== c0) { adj[c2]!.add(c0); adj[c0]!.add(c2); }
      }
    }

    const touchedSubs = new Set<SubmeshWorkingState>();
    let smoothedClusters = 0;

    // 2 Taubin-style relax passes (lambda = +0.48, mu = -0.22) so surfaces smooth cleanly without shrinking
    for (const factor of [0.48, -0.2]) {
      const nextPositions = clusters.map((cl) => {
        const r0 = cl[0]!;
        const idx = r0.v * 3;
        return [r0.sub.positions[idx]!, r0.sub.positions[idx + 1]!, r0.sub.positions[idx + 2]!] as [number, number, number];
      });

      for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
        const cl = clusters[cIdx]!;
        const active = useAll
          ? cl.some((r) => r.sub.submeshIndex === selectedSubmeshIdx || submeshesRef.current.length <= 4)
          : cl.some((r) => r.sub.selectedVertices[r.v]);
        if (!active) continue;
        const neighbors = adj[cIdx]!;
        if (neighbors.size === 0) continue;

        let nx = 0, ny = 0, nz = 0;
        for (const nb of neighbors) {
          const np = nextPositions[nb]!;
          nx += np[0];
          ny += np[1];
          nz += np[2];
        }
        nx /= neighbors.size;
        ny /= neighbors.size;
        nz /= neighbors.size;

        const cur = nextPositions[cIdx]!;
        const sx = cur[0] + (nx - cur[0]) * factor;
        const sy = cur[1] + (ny - cur[1]) * factor;
        const sz = cur[2] + (nz - cur[2]) * factor;

        for (const r of cl) {
          const rIdx = r.v * 3;
          r.sub.positions[rIdx] = sx;
          r.sub.positions[rIdx + 1] = sy;
          r.sub.positions[rIdx + 2] = sz;
          touchedSubs.add(r.sub);
        }
        if (factor > 0) smoothedClusters++;
      }
    }

    for (const sub of touchedSubs) {
      sub.dirtyGeometry = true;
      (sub.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      recomputeSubmeshClockwiseNormals(sub);
      sub.geometry.computeBoundingBox();
      sub.geometry.computeBoundingSphere();
    }
    syncSelectedPointsCloud();
    setStatusMessage(
      `Smoothed ${smoothedClusters.toLocaleString()} welded vertex clusters across ${touchedSubs.size} surface(s) without seam tearing.`,
    );
  };

  // Delete all faces whose vertices are selected (useful for removing doorway/portal blocks between merged BSPs)
  const handleDeleteSelectedFaces = () => {
    pushUndoSnapshot();
    let deletedFaces = 0;
    const touchedSubs = new Set<SubmeshWorkingState>();
    for (const sub of submeshesRef.current) {
      if (!sub.visible) continue;
      const sel = sub.selectedVertices;
      const idx = sub.indices;
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const i0 = idx[t]!, i1 = idx[t + 1]!, i2 = idx[t + 2]!;
        if (i0 === i1 && i1 === i2) continue;
        if ((sel[i0] ? 1 : 0) + (sel[i1] ? 1 : 0) + (sel[i2] ? 1 : 0) >= 2) {
          idx[t] = i0;
          idx[t + 1] = i0;
          idx[t + 2] = i0;
          deletedFaces++;
          touchedSubs.add(sub);
        }
      }
    }
    for (const sub of touchedSubs) {
      sub.dirtyGeometry = true;
      syncSubmeshBufferGeometry(sub);
    }
    setStatusMessage(
      deletedFaces > 0
        ? `Deleted / collapsed ${deletedFaces} selected face(s). Click "Apply Geometry & Textures to Map" to commit.`
        : 'Select at least 2 vertices of a face (or use the Delete Face tool icon in the top bar) to delete faces.',
    );
  };

  // Save Item as Map Object (publishes to window.__openceFloatingBspObjects AND persists to localStorage for Right-Click Add Object to Map!)
  const handlePublishFloatingObjectForPainting = (): FloatingBspObjectEntry | null => {
    const visibleSubs = submeshesRef.current.filter((s) => s.visible && s.positions.length > 0);
    const primarySub = submeshesRef.current[selectedSubmeshIdx] ?? visibleSubs[0] ?? submeshesRef.current[0];
    if (!primarySub || visibleSubs.length === 0) return null;

    let totalVerts = 0;
    let totalIndices = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity;

    for (const s of visibleSubs) {
      const vc = Math.floor(s.positions.length / 3);
      totalVerts += vc;
      totalIndices += s.indices.length;
      for (let v = 0; v < vc; v++) {
        const x = s.positions[v * 3]!;
        const y = s.positions[v * 3 + 1]!;
        const z = s.positions[v * 3 + 2]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
      }
    }
    if (totalVerts === 0) return null;

    const cx = Number.isFinite(minX) ? (minX + maxX) * 0.5 : 0;
    const cy = Number.isFinite(minY) ? (minY + maxY) * 0.5 : 0;
    const baseZ = Number.isFinite(minZ) ? minZ : 0;

    const interleaved = new Float32Array(totalVerts * 8);
    const combinedIndices = new Uint32Array(totalIndices);
    let vCursor = 0;
    let iCursor = 0;

    for (const s of visibleSubs) {
      const vc = Math.floor(s.positions.length / 3);
      for (let v = 0; v < vc; v++) {
        const b = (vCursor + v) * 8;
        interleaved[b + 0] = s.positions[v * 3]! - cx;
        interleaved[b + 1] = s.positions[v * 3 + 1]! - cy;
        interleaved[b + 2] = s.positions[v * 3 + 2]! - baseZ;
        interleaved[b + 3] = s.normals[v * 3]!;
        interleaved[b + 4] = s.normals[v * 3 + 1]!;
        interleaved[b + 5] = s.normals[v * 3 + 2]!;
        interleaved[b + 6] = s.uvs[v * 2]!;
        interleaved[b + 7] = s.uvs[v * 2 + 1]!;
      }
      for (let k = 0; k < s.indices.length; k++) {
        combinedIndices[iCursor + k] = vCursor + s.indices[k]!;
      }
      vCursor += vc;
      iCursor += s.indices.length;
    }

    const id = selectedFloatingId || `floating_${Date.now()}`;
    const cleanName = primName.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'custom_structure_01';
    const entry: FloatingBspObjectEntry = {
      id,
      name: cleanName,
      position: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      scale: [scaleX, scaleY, scaleZ],
      vertices: interleaved,
      indices: combinedIndices,
      shaderTagId: primarySub.shaderTagId ?? (shaderTags[0]?.tagId ?? 0),
      shaderPath: primarySub.shaderPath ?? (shaderTags[0]?.path ?? 'shaders\\default'),
      bitmapTagIndex: primarySub.bitmapTagIndex ?? -1,
      bitmapTagId: primarySub.bitmapTagId ?? 0xffffffff,
      bitmapPath: `levels\\custom\\${cleanName}\\bitmaps\\${cleanName}`,
      textureDataUrl: primarySub.paintCanvas ? primarySub.paintCanvas.toDataURL('image/png') : undefined,
      width: primarySub.paintCanvas?.width ?? 512,
      height: primarySub.paintCanvas?.height ?? 512,
    };
    const list = [...(window.__openceFloatingBspObjects ?? []).filter((f) => f.id !== id), entry];
    window.__openceFloatingBspObjects = list;
    setFloatingObjects(list);
    setSelectedFloatingId(id);
    try {
      const serializable = list.slice(-16).map((item) => ({
        id: item.id,
        name: item.name,
        position: item.position,
        rotationDeg: item.rotationDeg,
        scale: item.scale,
        verticesArr: Array.from(item.vertices),
        indicesArr: Array.from(item.indices),
        shaderTagId: item.shaderTagId,
        shaderPath: item.shaderPath,
        bitmapTagIndex: item.bitmapTagIndex,
        bitmapTagId: item.bitmapTagId,
        bitmapPath: item.bitmapPath,
        textureDataUrl: item.textureDataUrl,
        width: item.width,
        height: item.height,
      }));
      localStorage.setItem('opence_saved_map_objects_v1', JSON.stringify(serializable));
    } catch {
      // ignore storage quota errors
    }
    window.dispatchEvent(new CustomEvent('opence:floating-bsp-objects-changed'));
    setStatusMessage(
      `Saved "${cleanName}" as a Map Object! Click "➕ Add to 3D BSP Editor Now" or Right-Click anywhere on the BSP terrain -> "Add Object to Map".`,
    );
    return entry;
  };

  // Save the active component and immediately place + focus it inside the 3D BSP Editor
  const handlePlaceCurrentComponentIntoBspEditor = () => {
    const entry = handlePublishFloatingObjectForPainting();
    if (!entry) return;
    setIs2dSketchMode(false);
    if (studioMode !== 'bsp') {
      pendingPlaceObjectRef.current = entry;
      setStudioMode('bsp');
      setStatusMessage(
        `Switching to 3D BSP Editor and placing "${entry.name}" on the terrain at the camera target...`,
      );
    } else {
      const target = controlsRef.current?.target ?? modelBoundsRef.current.center;
      let atPt: [number, number, number] = [
        Number(target.x.toFixed(3)),
        Number(target.y.toFixed(3)),
        Number(target.z.toFixed(3)),
      ];
      if (meshGroupRef.current && meshGroupRef.current.children.length > 0) {
        const downRay = new THREE.Raycaster(
          new THREE.Vector3(target.x, target.y, target.z + 50),
          new THREE.Vector3(0, 0, -1),
        );
        const hits = downRay.intersectObjects(meshGroupRef.current.children, false);
        if (hits.length > 0 && hits[0]) {
          atPt = [
            Number(hits[0].point.x.toFixed(3)),
            Number(hits[0].point.y.toFixed(3)),
            Number(hits[0].point.z.toFixed(3)),
          ];
        }
      }
      handleAddObjectToBspAtPoint(entry, atPt);
    }
  };

  // Enter 2D Sketch Mode directly inside the 3D Edit World (aligns camera perpendicular to work plane & displays 3D sketch grid)
  const enter2dSketchIn3dWorld = useCallback(
    (overrideBasis?: typeof sketchFaceBasis) => {
      let basis = overrideBasis ?? sketchFaceBasis;
      // If we are in BSP mode and the work plane is still at [0,0,0] far from the camera target, center it at the camera target!
      if (!overrideBasis && studioMode === 'bsp' && controlsRef.current) {
        const t = controlsRef.current.target;
        const distFromOrigin = Math.hypot(
          basis.origin[0] - t.x,
          basis.origin[1] - t.y,
          basis.origin[2] - t.z,
        );
        if (distFromOrigin > 25) {
          let oz = t.z;
          if (meshGroupRef.current && meshGroupRef.current.children.length > 0) {
            const downRay = new THREE.Raycaster(
              new THREE.Vector3(t.x, t.y, t.z + 40),
              new THREE.Vector3(0, 0, -1),
            );
            const hits = downRay.intersectObjects(meshGroupRef.current.children, false);
            if (hits.length > 0 && hits[0]) oz = hits[0].point.z;
          }
          basis = {
            ...basis,
            origin: [Number(t.x.toFixed(3)), Number(t.y.toFixed(3)), Number(oz.toFixed(3))],
          };
          setSketchFaceBasis(basis);
        }
      }
      setIs2dSketchMode(true);
      if (cameraRef.current && controlsRef.current) {
        const [ox, oy, oz] = basis.origin;
        const [nx, ny, nz] = basis.normal;
        const [vx, vy, vz] = basis.vAxis;
        controlsRef.current.target.set(ox, oy, oz);
        cameraRef.current.up.set(vx, vy, vz);
        cameraRef.current.position.set(ox + nx * 10, oy + ny * 10, oz + nz * 10);
        controlsRef.current.update();
      }
      setStatusMessage(
        `2D Sketch Mode active on ${basis.label} in the 3D world! Left-Click directly on the 3D grid to place 2D profile points, then click "✓ Finish 2D Sketch -> 3D Extrude / Revolve / Cut".`,
      );
    },
    [sketchFaceBasis, studioMode],
  );

  // Exit 2D Sketch Mode and return to 3D perspective orbit so the user can Extrude / Revolve / Cut the 2D sketch in 3D
  const finish2dSketchTo3dMode = useCallback(() => {
    setIs2dSketchMode(false);
    if (cameraRef.current && controlsRef.current) {
      const [ox, oy, oz] = sketchFaceBasis.origin;
      const [nx, ny, nz] = sketchFaceBasis.normal;
      const [ux, uy, uz] = sketchFaceBasis.uAxis;
      const [vx, vy, vz] = sketchFaceBasis.vAxis;
      controlsRef.current.target.set(ox, oy, oz);
      cameraRef.current.up.set(0, 0, 1);
      cameraRef.current.position.set(
        ox + nx * 7.5 + ux * 5.5 - vx * 5.5,
        oy + ny * 7.5 + uy * 5.5 - vy * 5.5,
        oz + nz * 7.5 + uz * 5.5 - vz * 5.5 + 3.0,
      );
      controlsRef.current.update();
    }
    setStatusMessage(
      `Finished 2D Sketch (${sketchPoints.length} pts) in 3D view! Now click "➕ Extrude Boss (Join)", "➖ Extrude Cut (Carve)", "✨ Extrude New Solid", or "🔄 Revolve 360° Lathe".`,
    );
  }, [sketchFaceBasis, sketchPoints.length]);

  // Update work plane when switching between XY, XZ, YZ, or Pick 3D Face presets
  const handleSelectSketchPlanePreset = (preset: 'xy' | 'xz' | 'yz' | 'face') => {
    setSketchPlanePreset(preset);
    const baseOrigin: [number, number, number] =
      studioMode === 'bsp' && controlsRef.current
        ? [
            Number(controlsRef.current.target.x.toFixed(3)),
            Number(controlsRef.current.target.y.toFixed(3)),
            Number(controlsRef.current.target.z.toFixed(3)),
          ]
        : [0, 0, 0];
    if (preset === 'xy') {
      setSketchPickFaceActive(false);
      const nextBasis = {
        origin: baseOrigin,
        normal: [0, 0, 1] as [number, number, number],
        uAxis: [1, 0, 0] as [number, number, number],
        vAxis: [0, 1, 0] as [number, number, number],
        label: 'XY Ground Plane',
      };
      setSketchFaceBasis(nextBasis);
      enter2dSketchIn3dWorld(nextBasis);
    } else if (preset === 'xz') {
      setSketchPickFaceActive(false);
      const nextBasis = {
        origin: baseOrigin,
        normal: [0, -1, 0] as [number, number, number],
        uAxis: [1, 0, 0] as [number, number, number],
        vAxis: [0, 0, 1] as [number, number, number],
        label: 'XZ Front Plane',
      };
      setSketchFaceBasis(nextBasis);
      enter2dSketchIn3dWorld(nextBasis);
    } else if (preset === 'yz') {
      setSketchPickFaceActive(false);
      const nextBasis = {
        origin: baseOrigin,
        normal: [1, 0, 0] as [number, number, number],
        uAxis: [0, 1, 0] as [number, number, number],
        vAxis: [0, 0, 1] as [number, number, number],
        label: 'YZ Side Plane',
      };
      setSketchFaceBasis(nextBasis);
      enter2dSketchIn3dWorld(nextBasis);
    } else {
      setSketchPickFaceActive(true);
      setStatusMessage('Click any 3D face on the model/BSP in the viewport to lock the 2D Sketch Plane onto that face!');
    }
  };

  // Apply 2D Sketch Shape Preset onto the Inventor Sketch Pad
  const handleApplySketchShapePreset = (kind: 'polyline' | 'rect' | 'circle' | 'polygon' | 'l_bracket') => {
    setSketchShapeKind(kind);
    if (kind === 'rect') {
      setSketchPoints([
        [-1.6, -1.1],
        [1.6, -1.1],
        [1.6, 1.1],
        [-1.6, 1.1],
      ]);
    } else if (kind === 'circle') {
      const pts: Array<[number, number]> = [];
      const segs = 12;
      const r = 1.4;
      for (let i = 0; i < segs; i++) {
        const ang = (i / segs) * Math.PI * 2;
        pts.push([Number((Math.cos(ang) * r).toFixed(2)), Number((Math.sin(ang) * r).toFixed(2))]);
      }
      setSketchPoints(pts);
    } else if (kind === 'polygon') {
      const pts: Array<[number, number]> = [];
      const segs = 6;
      const r = 1.5;
      for (let i = 0; i < segs; i++) {
        const ang = (i / segs) * Math.PI * 2;
        pts.push([Number((Math.cos(ang) * r).toFixed(2)), Number((Math.sin(ang) * r).toFixed(2))]);
      }
      setSketchPoints(pts);
    } else if (kind === 'l_bracket') {
      setSketchPoints([
        [-1.6, -1.6],
        [1.6, -1.6],
        [1.6, -0.6],
        [-0.5, -0.6],
        [-0.5, 1.6],
        [-1.6, 1.6],
      ]);
    }
  };

  // Autodesk Inventor Feature Operation: Extrude Boss (+Join), Cut (-Carve), or New Solid from 2D Sketch on Active Plane/Face!
  const handleInventorExtrudeSketch = (mode: 'join' | 'cut' | 'new') => {
    const sub = submeshesRef.current[selectedSubmeshIdx] ?? submeshesRef.current[0];
    if (!sub || sketchPoints.length < 3) {
      setStatusMessage('Draw at least 3 points on the 2D Sketch Pad to extrude.');
      return;
    }
    pushUndoSnapshot();

    const [ox, oy, oz] = sketchFaceBasis.origin;
    const [nx, ny, nz] = sketchFaceBasis.normal;
    const [ux, uy, uz] = sketchFaceBasis.uAxis;
    const [vx, vy, vz] = sketchFaceBasis.vAxis;
    const depth = mode === 'cut' ? -Math.abs(sketchExtrudeDepth) : sketchExtrudeDepth;

    // If 'cut' mode, also push existing vertices that project inside the 2D sketch polygon inward along normal
    if (mode === 'cut') {
      const poly = sketchPoints;
      const pointInPoly = (pu: number, pv: number) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i]![0], yi = poly[i]![1];
          const xj = poly[j]![0], yj = poly[j]![1];
          const intersect = yi > pv !== yj > pv && pu < ((xj - xi) * (pv - yi)) / (yj - yi + 1e-7) + xi;
          if (intersect) inside = !inside;
        }
        return inside;
      };
      const vCount = Math.floor(sub.positions.length / 3);
      let carvedCount = 0;
      for (let v = 0; v < vCount; v++) {
        const dx = sub.positions[v * 3]! - ox;
        const dy = sub.positions[v * 3 + 1]! - oy;
        const dz = sub.positions[v * 3 + 2]! - oz;
        const pu = dx * ux + dy * uy + dz * uz;
        const pv = dx * vx + dy * vy + dz * vz;
        const pn = dx * nx + dy * ny + dz * nz;
        if (Math.abs(pn) <= Math.abs(sketchExtrudeDepth) * 1.25 && pointInPoly(pu, pv)) {
          sub.positions[v * 3] += nx * depth;
          sub.positions[v * 3 + 1] += ny * depth;
          sub.positions[v * 3 + 2] += nz * depth;
          carvedCount++;
        }
      }
      if (carvedCount > 0) {
        sub.dirtyGeometry = true;
        syncSubmeshBufferGeometry(sub);
        rebuildCoLocatedClusters(submeshesRef.current);
        setIs2dSketchMode(false);
        setStatusMessage(`Extrude-Cut carved ${carvedCount} vertex(es) by ${depth.toFixed(2)} wu along ${sketchFaceBasis.label}.`);
        return;
      }
    }

    // Build 3D extruded prism from the 2D sketch loop (nPts bottom ring + nPts top ring)
    const nPts = sketchPoints.length;
    const taperScale = Math.max(0.1, 1 + sketchTaperFactor);
    const addedVerts = nPts * 2;
    const baseVCount = mode === 'new' ? 0 : Math.floor(sub.positions.length / 3);
    const newVCount = baseVCount + addedVerts;

    const newPos = new Float32Array(newVCount * 3);
    const newNorms = new Float32Array(newVCount * 3);
    const newUvs = new Float32Array(newVCount * 2);
    const newSel = new Uint8Array(newVCount);
    if (mode !== 'new') {
      newPos.set(sub.positions);
      newNorms.set(sub.normals);
      newUvs.set(sub.uvs);
      newSel.set(sub.selectedVertices);
    }

    // Compute centroid of 2D sketch
    let cu = 0, cv = 0;
    for (const [pu, pv] of sketchPoints) {
      cu += pu;
      cv += pv;
    }
    cu /= nPts;
    cv /= nPts;

    // Ensure 2D sketch points are Counter-Clockwise in (u, v) so outward Halo Clockwise 3D winding is consistent
    let signedArea = 0;
    for (let i = 0; i < nPts; i++) {
      const p0 = sketchPoints[i]!;
      const p1 = sketchPoints[(i + 1) % nPts]!;
      signedArea += p0[0] * p1[1] - p1[0] * p0[1];
    }
    const orderedPts = signedArea >= 0 ? sketchPoints : [...sketchPoints].reverse();

    for (let i = 0; i < nPts; i++) {
      const [pu, pv] = orderedPts[i]!;
      const tu = cu + (pu - cu) * taperScale;
      const tv = cv + (pv - cv) * taperScale;

      const bIdx = baseVCount + i;
      newPos[bIdx * 3] = ox + ux * pu + vx * pv;
      newPos[bIdx * 3 + 1] = oy + uy * pu + vy * pv;
      newPos[bIdx * 3 + 2] = oz + uz * pu + vz * pv;
      newNorms[bIdx * 3] = -nx;
      newNorms[bIdx * 3 + 1] = -ny;
      newNorms[bIdx * 3 + 2] = -nz;
      newUvs[bIdx * 2] = (pu + 4) / 8;
      newUvs[bIdx * 2 + 1] = (pv + 4) / 8;
      newSel[bIdx] = 1;

      const tIdx = baseVCount + nPts + i;
      newPos[tIdx * 3] = ox + ux * tu + vx * tv + nx * depth;
      newPos[tIdx * 3 + 1] = oy + uy * tu + vy * tv + ny * depth;
      newPos[tIdx * 3 + 2] = oz + uz * tu + vz * tv + nz * depth;
      newNorms[tIdx * 3] = nx;
      newNorms[tIdx * 3 + 1] = ny;
      newNorms[tIdx * 3 + 2] = nz;
      newUvs[tIdx * 2] = (tu + 4) / 8;
      newUvs[tIdx * 2 + 1] = (tv + 4) / 8;
      newSel[tIdx] = 1;
    }

    // Side quads (2*nPts tris) + bottom fan (nPts-2 tris) + top fan (nPts-2 tris) in Halo Clockwise winding
    const prismTris: number[] = [];
    for (let i = 0; i < nPts; i++) {
      const next = (i + 1) % nPts;
      const b0 = baseVCount + i;
      const b1 = baseVCount + next;
      const t0 = baseVCount + nPts + i;
      const t1 = baseVCount + nPts + next;
      prismTris.push(b0, t1, b1);
      prismTris.push(b0, t0, t1);
    }
    for (let i = 1; i + 1 < nPts; i++) {
      // Bottom cap
      prismTris.push(baseVCount, baseVCount + i, baseVCount + i + 1);
      // Top cap (Halo CW outward along +normal)
      prismTris.push(baseVCount + nPts, baseVCount + nPts + i + 1, baseVCount + nPts + i);
    }

    const baseIndices = mode === 'new' ? new Uint32Array(0) : sub.indices;
    const newIndices = new Uint32Array(baseIndices.length + prismTris.length);
    newIndices.set(baseIndices);
    for (let k = 0; k < prismTris.length; k++) {
      newIndices[baseIndices.length + k] = prismTris[k]!;
    }

    sub.positions = newPos;
    sub.normals = newNorms;
    sub.uvs = newUvs;
    sub.indices = newIndices;
    sub.selectedVertices = newSel;
    sub.dirtyGeometry = true;

    syncSubmeshBufferGeometry(sub);
    rebuildCoLocatedClusters(submeshesRef.current);
    syncSelectedPointsCloud();
    setSubmeshSummaryList((prev) =>
      prev.map((item) =>
        item.submeshIndex === sub.submeshIndex
          ? { ...item, vertexCount: newVCount, triangleCount: Math.floor(newIndices.length / 3) }
          : item,
      ),
    );
    setIs2dSketchMode(false);
    setStatusMessage(
      `Extruded 2D Sketch (${nPts}-pt profile, ${depth >= 0 ? '+' : ''}${depth.toFixed(2)} wu) on ${sketchFaceBasis.label} into 3D solid!`,
    );
  };

  // Revolve 360° Lathe from 2D Sketch Profile
  const handleInventorRevolveSketch = () => {
    const sub = submeshesRef.current[selectedSubmeshIdx] ?? submeshesRef.current[0];
    if (!sub || sketchPoints.length < 3) return;
    pushUndoSnapshot();

    const [ox, oy, oz] = sketchFaceBasis.origin;
    const [nx, ny, nz] = sketchFaceBasis.normal;
    const [ux, uy, uz] = sketchFaceBasis.uAxis;
    const [vx, vy, vz] = sketchFaceBasis.vAxis;
    const radialSegs = 16;
    const nPts = sketchPoints.length;
    const baseVCount = Math.floor(sub.positions.length / 3);
    const addedVerts = radialSegs * nPts;
    const newVCount = baseVCount + addedVerts;

    const newPos = new Float32Array(newVCount * 3);
    newPos.set(sub.positions);
    const newNorms = new Float32Array(newVCount * 3);
    newNorms.set(sub.normals);
    const newUvs = new Float32Array(newVCount * 2);
    newUvs.set(sub.uvs);
    const newSel = new Uint8Array(newVCount);
    newSel.set(sub.selectedVertices);

    for (let s = 0; s < radialSegs; s++) {
      const ang = (s / radialSegs) * Math.PI * 2;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      for (let i = 0; i < nPts; i++) {
        const [pu, pv] = sketchPoints[i]!;
        const r = Math.max(0.15, Math.abs(pu));
        const rx = (ux * cosA + nx * sinA) * r;
        const ry = (uy * cosA + ny * sinA) * r;
        const rz = (uz * cosA + nz * sinA) * r;
        const vIdx = baseVCount + s * nPts + i;
        newPos[vIdx * 3] = ox + rx + vx * pv;
        newPos[vIdx * 3 + 1] = oy + ry + vy * pv;
        newPos[vIdx * 3 + 2] = oz + rz + vz * pv;
        newUvs[vIdx * 2] = s / radialSegs;
        newUvs[vIdx * 2 + 1] = i / Math.max(1, nPts - 1);
        newSel[vIdx] = 1;
      }
    }

    const latheTris: number[] = [];
    for (let s = 0; s < radialSegs; s++) {
      const nextS = (s + 1) % radialSegs;
      for (let i = 0; i < nPts; i++) {
        const nextI = (i + 1) % nPts;
        const v00 = baseVCount + s * nPts + i;
        const v01 = baseVCount + s * nPts + nextI;
        const v10 = baseVCount + nextS * nPts + i;
        const v11 = baseVCount + nextS * nPts + nextI;
        latheTris.push(v00, v11, v10);
        latheTris.push(v00, v01, v11);
      }
    }

    const newIndices = new Uint32Array(sub.indices.length + latheTris.length);
    newIndices.set(sub.indices);
    for (let k = 0; k < latheTris.length; k++) {
      newIndices[sub.indices.length + k] = latheTris[k]!;
    }

    sub.positions = newPos;
    sub.normals = newNorms;
    sub.uvs = newUvs;
    sub.indices = newIndices;
    sub.selectedVertices = newSel;
    sub.dirtyGeometry = true;

    syncSubmeshBufferGeometry(sub);
    rebuildCoLocatedClusters(submeshesRef.current);
    syncSelectedPointsCloud();
    setSubmeshSummaryList((prev) =>
      prev.map((item) =>
        item.submeshIndex === sub.submeshIndex
          ? { ...item, vertexCount: newVCount, triangleCount: Math.floor(newIndices.length / 3) }
          : item,
      ),
    );
    setIs2dSketchMode(false);
    setStatusMessage(`Revolved 2D Sketch 360° (${radialSegs} segments) around ${sketchFaceBasis.label} into 3D solid!`);
  };

  // Add Saved Map Object (or Parametric Preset) onto the Live Terrain BSP at right-clicked 3D point
  const handleAddObjectToBspAtPoint = (
    sourceEntryOrPreset: FloatingBspObjectEntry | ParametricPrimitiveKind,
    atPoint: [number, number, number],
  ) => {
    const defaultShader =
      allTags.find((t) => t.tagId === targetShaderTagId) ??
      allTags.find((t) => t.primaryClassName === 'shader_environment') ??
      allTags.find((t) => t.primaryClassName.startsWith('shader'));

    let entry: FloatingBspObjectEntry;
    if (typeof sourceEntryOrPreset === 'string') {
      const gen = buildParametricPrimitiveGeometry(sourceEntryOrPreset, primWidth, primDepth, primHeight, primWallThickness);
      entry = {
        id: `preset_${sourceEntryOrPreset}_${Date.now()}`,
        name: `custom_${sourceEntryOrPreset}`,
        position: atPoint,
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
        vertices: gen.vertices,
        indices: gen.indices,
        shaderTagId: defaultShader?.tagId ?? 0,
        shaderPath: defaultShader?.path ?? 'shaders\\default',
        bitmapTagIndex: -1,
        bitmapTagId: 0xffffffff,
        bitmapPath: `levels\\custom\\${sourceEntryOrPreset}\\bitmaps\\${sourceEntryOrPreset}`,
        width: 512,
        height: 512,
      };
    } else {
      entry = sourceEntryOrPreset;
    }

    const instanceId = `placed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newPlaced = {
      instanceId,
      sourceId: entry.id,
      name: entry.name,
      position: [
        Number(atPoint[0].toFixed(3)),
        Number(atPoint[1].toFixed(3)),
        Number(atPoint[2].toFixed(3)),
      ] as [number, number, number],
      rotationDeg: [...entry.rotationDeg] as [number, number, number],
      scale: [...entry.scale] as [number, number, number],
      vertices: new Float32Array(entry.vertices),
      indices: new Uint32Array(entry.indices),
      shaderTagId: entry.shaderTagId || (defaultShader?.tagId ?? 0),
      shaderPath: entry.shaderPath || (defaultShader?.path ?? 'shaders\\default'),
      textureDataUrl: entry.textureDataUrl,
    };

    setPlacedBspObjects((prev) => [...prev, newPlaced]);
    setSelectedPlacedInstanceId(instanceId);
    setBspContextMenu(null);
    if (cameraRef.current && controlsRef.current) {
      controlsRef.current.target.set(atPoint[0], atPoint[1], atPoint[2]);
      const distToTarget = cameraRef.current.position.distanceTo(controlsRef.current.target);
      if (distToTarget > 45 || distToTarget < 1.5) {
        cameraRef.current.position.set(atPoint[0] + 12, atPoint[1] - 12, atPoint[2] + 9);
      }
      controlsRef.current.update();
    }
    setStatusMessage(
      `Placed "${entry.name}" in 3D BSP Editor at (${atPoint[0].toFixed(2)}, ${atPoint[1].toFixed(2)}, ${atPoint[2].toFixed(2)}). Adjust position/rotation or click "Merge Look Objects into BSP"!`,
    );
  };

  // Merge all Placed Look Objects directly into the Live Terrain BSP (visual mesh + 3D CollisionBSP + scenario placement!)
  const handleMergeLookObjectsIntoBsp = async () => {
    if (placedBspObjects.length === 0) {
      setStatusMessage('Right-click on the 3D BSP terrain -> "Add Object to Map" to place an object first.');
      return;
    }
    setApplying(true);
    setStatusMessage(
      `Merging ${placedBspObjects.length} Look Object(s) into BSP visual geometry & compiling 3D CollisionBSP...`,
    );
    try {
      pushUndoSnapshot();
      const targetSub = submeshesRef.current[selectedSubmeshIdx] ?? submeshesRef.current[0];
      let mergedCount = 0;

      for (const obj of placedBspObjects) {
        const vCount = Math.floor(obj.vertices.length / 8);
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(obj.rotationDeg[1]),
          THREE.MathUtils.degToRad(obj.rotationDeg[2]),
          THREE.MathUtils.degToRad(obj.rotationDeg[0]),
          'ZYX',
        );
        const rotQuat = new THREE.Quaternion().setFromEuler(euler);

        // 1. Append transformed vertices & triangles into the active BSP submesh so it becomes part of the live BSP mesh
        if (targetSub) {
          const oldVCount = Math.floor(targetSub.positions.length / 3);
          const newVCount = oldVCount + vCount;
          const newPos = new Float32Array(newVCount * 3);
          newPos.set(targetSub.positions);
          const newNorms = new Float32Array(newVCount * 3);
          newNorms.set(targetSub.normals);
          const newUvs = new Float32Array(newVCount * 2);
          newUvs.set(targetSub.uvs);
          const newSel = new Uint8Array(newVCount);
          newSel.set(targetSub.selectedVertices);

          for (let v = 0; v < vCount; v++) {
            const b = v * 8;
            const pt = new THREE.Vector3(
              obj.vertices[b]! * obj.scale[0],
              obj.vertices[b + 1]! * obj.scale[1],
              obj.vertices[b + 2]! * obj.scale[2],
            )
              .applyQuaternion(rotQuat)
              .add(new THREE.Vector3(obj.position[0], obj.position[1], obj.position[2]));
            const nm = new THREE.Vector3(obj.vertices[b + 3]!, obj.vertices[b + 4]!, obj.vertices[b + 5]!)
              .applyQuaternion(rotQuat)
              .normalize();
            const dstV = oldVCount + v;
            newPos[dstV * 3] = pt.x;
            newPos[dstV * 3 + 1] = pt.y;
            newPos[dstV * 3 + 2] = pt.z;
            newNorms[dstV * 3] = nm.x;
            newNorms[dstV * 3 + 1] = nm.y;
            newNorms[dstV * 3 + 2] = nm.z;
            newUvs[dstV * 2] = obj.vertices[b + 6]!;
            newUvs[dstV * 2 + 1] = obj.vertices[b + 7]!;
          }

          const newIndices = new Uint32Array(targetSub.indices.length + obj.indices.length);
          newIndices.set(targetSub.indices);
          for (let k = 0; k < obj.indices.length; k++) {
            newIndices[targetSub.indices.length + k] = oldVCount + obj.indices[k]!;
          }

          targetSub.positions = newPos;
          targetSub.normals = newNorms;
          targetSub.uvs = newUvs;
          targetSub.indices = newIndices;
          targetSub.selectedVertices = newSel;
          targetSub.dirtyGeometry = true;
          syncSubmeshBufferGeometry(targetSub);
        }

        // 2. Compile & Inject 3D CollisionBSP + GBXModel + Shader + Scenery Tag and spawn at exact placed coordinates in map!
        if (window.opence.buildCustomObjectTag) {
          const lines: string[] = [`# OpenCE Merged BSP Object: ${obj.name}`];
          for (let v = 0; v < vCount; v++) {
            const b = v * 8;
            lines.push(
              `v ${obj.vertices[b]! * obj.scale[0]} ${obj.vertices[b + 1]! * obj.scale[1]} ${obj.vertices[b + 2]! * obj.scale[2]}`,
            );
          }
          for (let v = 0; v < vCount; v++) {
            const b = v * 8;
            lines.push(`vt ${obj.vertices[b + 6]!} ${1 - obj.vertices[b + 7]!}`);
          }
          for (let v = 0; v < vCount; v++) {
            const b = v * 8;
            lines.push(`vn ${obj.vertices[b + 3]!} ${obj.vertices[b + 4]!} ${obj.vertices[b + 5]!}`);
          }
          for (let t = 0; t + 2 < obj.indices.length; t += 3) {
            const i0 = obj.indices[t]! + 1;
            const i1 = obj.indices[t + 2]! + 1;
            const i2 = obj.indices[t + 1]! + 1;
            lines.push(`f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}`);
          }
          const cleanName = obj.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'merged_bsp_obj';
          const yawRad = THREE.MathUtils.degToRad(obj.rotationDeg[0]);
          const pitchRad = THREE.MathUtils.degToRad(obj.rotationDeg[1]);
          const rollRad = THREE.MathUtils.degToRad(obj.rotationDeg[2]);
          const buildRes = await window.opence.buildCustomObjectTag({
            tagGroup: 'scenery',
            tagPath: `scenery\\bsp_structures\\${cleanName}\\${cleanName}`,
            itemName: cleanName,
            objFilePath: '',
            objSourceText: lines.join('\n'),
            texturePngDataUrl: obj.textureDataUrl,
            collisionMode: 'exact',
            outputMode: 'inject',
            placeAtPosition: obj.position,
            placeAtRotation: [yawRad, pitchRad, rollRad],
          });
          if (buildRes.ok) {
            mergedCount++;
          }
        } else {
          mergedCount++;
        }
      }

      if (targetSub) {
        rebuildCoLocatedClusters(submeshesRef.current);
        setSubmeshSummaryList((prev) =>
          prev.map((item) =>
            item.submeshIndex === targetSub.submeshIndex
              ? {
                  ...item,
                  vertexCount: Math.floor(targetSub.positions.length / 3),
                  triangleCount: Math.floor(targetSub.indices.length / 3),
                }
              : item,
          ),
        );
      }

      setPlacedBspObjects([]);
      setSelectedPlacedInstanceId('');
      setMovePlacedOnTerrainClick(false);
      window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
      setStatusMessage(
        `Merged ${mergedCount} Look Object(s) into the BSP with full 3D CollisionBSP & shaders! Use File -> Save Map (Ctrl+S) to save.`,
      );
    } catch (err) {
      setStatusMessage(`Merge error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  // Render Placed Look Objects inside placedObjectsGroupRef in the 3D BSP viewport
  useEffect(() => {
    const group = placedObjectsGroupRef.current;
    if (!group) return;
    while (group.children.length > 0) group.remove(group.children[0]!);
    if (studioMode !== 'bsp' || placedBspObjects.length === 0) return;

    for (const obj of placedBspObjects) {
      const vCount = Math.floor(obj.vertices.length / 8);
      const posArr = new Float32Array(vCount * 3);
      const normArr = new Float32Array(vCount * 3);
      const uvArr = new Float32Array(vCount * 2);
      for (let v = 0; v < vCount; v++) {
        const b = v * 8;
        posArr[v * 3] = obj.vertices[b]!;
        posArr[v * 3 + 1] = obj.vertices[b + 1]!;
        posArr[v * 3 + 2] = obj.vertices[b + 2]!;
        normArr[v * 3] = obj.vertices[b + 3]!;
        normArr[v * 3 + 1] = obj.vertices[b + 4]!;
        normArr[v * 3 + 2] = obj.vertices[b + 5]!;
        uvArr[v * 2] = obj.vertices[b + 6]!;
        uvArr[v * 2 + 1] = obj.vertices[b + 7]!;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(obj.indices), 1));
      geo.computeBoundingSphere();

      const isSel = obj.instanceId === selectedPlacedInstanceId;
      const mat = new THREE.MeshStandardMaterial({
        color: isSel ? 0x86efac : 0xbae6fd,
        emissive: isSel ? 0x14532d : 0x0c2d48,
        emissiveIntensity: 0.35,
        roughness: 0.5,
        metalness: 0.15,
        side: THREE.DoubleSide,
      });
      if (obj.textureDataUrl) {
        const loader = new THREE.TextureLoader();
        loader.load(obj.textureDataUrl, (tex) => {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          mat.color.setHex(0xffffff);
          mat.needsUpdate = true;
        });
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.position.set(obj.position[0], obj.position[1], obj.position[2]);
      mesh.rotation.set(
        THREE.MathUtils.degToRad(obj.rotationDeg[1]),
        THREE.MathUtils.degToRad(obj.rotationDeg[2]),
        THREE.MathUtils.degToRad(obj.rotationDeg[0]),
        'ZYX',
      );
      mesh.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
      group.add(mesh);

      const edges = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({
        color: isSel ? 0x22c55e : 0x00e5ff,
        depthTest: false,
      });
      const wire = new THREE.LineSegments(edges, lineMat);
      wire.frustumCulled = false;
      wire.renderOrder = 993;
      wire.position.copy(mesh.position);
      wire.rotation.copy(mesh.rotation);
      wire.scale.copy(mesh.scale);
      group.add(wire);

      // Placement base ring + vertical beacon so placed items are immediately visible even on huge BSP maps
      const ringGeo = new THREE.RingGeometry(1.1, 1.35, 28);
      const ringMat = new THREE.MeshBasicMaterial({
        color: isSel ? 0x22c55e : 0x00e5ff,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.set(obj.position[0], obj.position[1], obj.position[2] + 0.05);
      ringMesh.renderOrder = 995;
      ringMesh.frustumCulled = false;
      group.add(ringMesh);
    }
  }, [placedBspObjects, selectedPlacedInstanceId, studioMode]);

  // Render the 2D Sketch Work Plane Grid, U/V Axes, and 2D Sketch Profile directly inside the 3D Edit World (`sketch3dGroupRef`)
  useEffect(() => {
    const group = sketch3dGroupRef.current;
    if (!group) return;
    while (group.children.length > 0) group.remove(group.children[0]!);

    const [ox, oy, oz] = sketchFaceBasis.origin;
    const [nx, ny, nz] = sketchFaceBasis.normal;
    const [ux, uy, uz] = sketchFaceBasis.uAxis;
    const [vx, vy, vz] = sketchFaceBasis.vAxis;

    const to3D = (u: number, v: number, nOff = 0.015) =>
      new THREE.Vector3(
        ox + ux * u + vx * v + nx * nOff,
        oy + uy * u + vy * v + ny * nOff,
        oz + uz * u + vz * v + nz * nOff,
      );

    // 1. When in 2D Sketch Mode (or when a 3D face work plane is active), draw the 3D Work Plane Grid & U/V Axes
    if (is2dSketchMode || sketchPlanePreset === 'face') {
      const halfSpan = 4.0;
      const planeVerts = new Float32Array([
        ...to3D(-halfSpan, -halfSpan, 0.008).toArray(),
        ...to3D(halfSpan, -halfSpan, 0.008).toArray(),
        ...to3D(halfSpan, halfSpan, 0.008).toArray(),
        ...to3D(-halfSpan, halfSpan, 0.008).toArray(),
      ]);
      const planeGeo = new THREE.BufferGeometry();
      planeGeo.setAttribute('position', new THREE.BufferAttribute(planeVerts, 3));
      planeGeo.setIndex([0, 1, 2, 0, 2, 3]);
      const planeMat = new THREE.MeshBasicMaterial({
        color: is2dSketchMode ? 0x0ea5e9 : 0xff9f43,
        transparent: true,
        opacity: is2dSketchMode ? 0.14 : 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const planeMesh = new THREE.Mesh(planeGeo, planeMat);
      planeMesh.frustumCulled = false;
      group.add(planeMesh);

      const gridPts: THREE.Vector3[] = [];
      for (let g = -4; g <= 4; g++) {
        if (g === 0) continue;
        gridPts.push(to3D(g, -halfSpan, 0.012), to3D(g, halfSpan, 0.012));
        gridPts.push(to3D(-halfSpan, g, 0.012), to3D(halfSpan, g, 0.012));
      }
      const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPts);
      const gridLines = new THREE.LineSegments(
        gridGeo,
        new THREE.LineBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: is2dSketchMode ? 0.45 : 0.22,
          depthTest: false,
        }),
      );
      gridLines.frustumCulled = false;
      group.add(gridLines);

      // U Axis (Orange) & V Axis (Green)
      const uAxisGeo = new THREE.BufferGeometry().setFromPoints([
        to3D(-halfSpan, 0, 0.016),
        to3D(halfSpan, 0, 0.016),
      ]);
      group.add(
        new THREE.Line(
          uAxisGeo,
          new THREE.LineBasicMaterial({ color: 0xff9f43, depthTest: false }),
        ),
      );
      const vAxisGeo = new THREE.BufferGeometry().setFromPoints([
        to3D(0, -halfSpan, 0.016),
        to3D(0, halfSpan, 0.016),
      ]);
      group.add(
        new THREE.Line(
          vAxisGeo,
          new THREE.LineBasicMaterial({ color: 0x22c55e, depthTest: false }),
        ),
      );
    }

    // 2. Always render the active 2D Sketch Profile Polygon & Vertices in the 3D viewport so user sees it in both 2D Sketch & 3D Extrude modes
    if (sketchPoints.length >= 2) {
      const loopPts3d = sketchPoints.map(([u, v]) => to3D(u, v, 0.025));
      const loopGeo = new THREE.BufferGeometry().setFromPoints(loopPts3d);
      const loopLine = new THREE.LineLoop(
        loopGeo,
        new THREE.LineBasicMaterial({
          color: 0x00e5ff,
          depthTest: false,
        }),
      );
      loopLine.renderOrder = 996;
      loopLine.frustumCulled = false;
      group.add(loopLine);

      if (sketchPoints.length >= 3) {
        const fanVerts: number[] = [];
        const p0 = loopPts3d[0]!;
        for (let i = 1; i + 1 < loopPts3d.length; i++) {
          const p1 = loopPts3d[i]!;
          const p2 = loopPts3d[i + 1]!;
          fanVerts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        }
        const fillGeo = new THREE.BufferGeometry();
        fillGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fanVerts), 3));
        const fillMesh = new THREE.Mesh(
          fillGeo,
          new THREE.MeshBasicMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: is2dSketchMode ? 0.28 : 0.14,
            side: THREE.DoubleSide,
            depthTest: false,
          }),
        );
        fillMesh.renderOrder = 995;
        fillMesh.frustumCulled = false;
        group.add(fillMesh);
      }
    }

    for (let idx = 0; idx < sketchPoints.length; idx++) {
      const [u, v] = sketchPoints[idx]!;
      const pt3d = to3D(u, v, 0.03);
      const spGeo = new THREE.SphereGeometry(is2dSketchMode ? 0.11 : 0.07, 10, 10);
      const spMat = new THREE.MeshBasicMaterial({
        color: idx === 0 ? 0xff9f43 : 0x00e5ff,
        depthTest: false,
      });
      const sp = new THREE.Mesh(spGeo, spMat);
      sp.position.copy(pt3d);
      sp.renderOrder = 997;
      sp.frustumCulled = false;
      group.add(sp);
    }
  }, [sketchFaceBasis, sketchPoints, is2dSketchMode, sketchPlanePreset]);

  // Listen for live shader / tag edits from the Tag Editor so 3D viewport materials refresh automatically!
  useEffect(() => {
    const onTagOrShaderEdited = () => {
      void (async () => {
        for (const sub of submeshesRef.current) {
          if (!sub.shaderTagId || sub.shaderTagId === 0xffffffff) continue;
          const texRes = await window.opence.getBitmapTexture(sub.shaderTagId, 0);
          if (texRes.ok && texRes.texture) {
            const c = document.createElement('canvas');
            c.width = texRes.texture.width;
            c.height = texRes.texture.height;
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.putImageData(
                new ImageData(
                  new Uint8ClampedArray(texRes.texture.rgbaData),
                  texRes.texture.width,
                  texRes.texture.height,
                ),
                0,
                0,
              );
            }
            const tex = new THREE.CanvasTexture(c);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.flipY = false;
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            sub.paintCanvas = c;
            sub.threeTexture = tex;
            const mat = sub.mesh.material as THREE.MeshStandardMaterial;
            mat.map = tex;
            mat.needsUpdate = true;
          }
        }
      })();
    };
    window.addEventListener('opence:tag-edited', onTagOrShaderEdited);
    window.addEventListener('opence:bitmap-updated', onTagOrShaderEdited);
    return () => {
      window.removeEventListener('opence:tag-edited', onTagOrShaderEdited);
      window.removeEventListener('opence:bitmap-updated', onTagOrShaderEdited);
    };
  }, []);

  // Import external .obj file as a Floating BSP Object with auto smart-unwrap UVs
  const handleImportFloatingObjFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseWavefrontObjToHaloClockwise(text);
    if (parsed.vertices.length === 0 || parsed.indices.length === 0) {
      setStatusMessage(`Could not parse any valid faces from ${file.name}.`);
      return;
    }
    const baseName = file.name.replace(/\.obj$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'imported_bsp_obj';
    setPrimName(baseName);
    const defaultShader =
      allTags.find((t) => t.primaryClassName === 'shader_environment') ??
      allTags.find((t) => t.primaryClassName.startsWith('shader'));
    const id = `floating_${Date.now()}`;
    const entry: FloatingBspObjectEntry = {
      id,
      name: baseName,
      position: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
      vertices: parsed.vertices,
      indices: parsed.indices,
      shaderTagId: defaultShader?.tagId ?? 0,
      shaderPath: defaultShader?.path ?? 'shaders\\default',
      bitmapTagIndex: -1,
      bitmapTagId: 0xffffffff,
      bitmapPath: `levels\\custom\\${baseName}\\bitmaps\\${baseName}`,
      width: 512,
      height: 512,
    };
    const list = [...(window.__openceFloatingBspObjects ?? []), entry];
    window.__openceFloatingBspObjects = list;
    setFloatingObjects(list);
    setSelectedFloatingId(id);
    setStudioMode('create');
    window.dispatchEvent(new CustomEvent('opence:floating-bsp-objects-changed'));
    setStatusMessage(
      `Imported "${file.name}" (${Math.floor(parsed.vertices.length / 8)} verts, ${Math.floor(parsed.indices.length / 3)} tris) with smart-unwrapped UVs as a Floating BSP Object.`,
    );
  };

  // Reconstruct a GeneratedWorldMesh from the live sculpted submeshes in the 3D Studio so any vertex sculpting/painting is preserved!
  const buildCurrentWorldMeshFromStudio = (): GeneratedWorldMesh | null => {
    const visibleSubs = submeshesRef.current.filter((s) => s.visible && s.positions.length > 0);
    if (visibleSubs.length === 0) return lastGeneratedWorldMeshRef.current;

    const vertices: GeneratedWorldMesh['vertices'] = [];
    const triangles: GeneratedWorldMesh['triangles'] = [];
    const roleSet = new Set<WorldMaterialRole>();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let vBase = 0;

    for (let sIdx = 0; sIdx < visibleSubs.length; sIdx++) {
      const s = visibleSubs[sIdx]!;
      const role: WorldMaterialRole = worldActiveRoles[sIdx] ?? 'forerunner_floor';
      roleSet.add(role);
      const vc = Math.floor(s.positions.length / 3);
      for (let v = 0; v < vc; v++) {
        const px = s.positions[v * 3]!;
        const py = s.positions[v * 3 + 1]!;
        const pz = s.positions[v * 3 + 2]!;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (pz < minZ) minZ = pz;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
        if (pz > maxZ) maxZ = pz;
        vertices.push({
          position: [px, py, pz],
          normal: [s.normals[v * 3]!, s.normals[v * 3 + 1]!, s.normals[v * 3 + 2]!],
          uv: [s.uvs[v * 2]!, s.uvs[v * 2 + 1]!],
        });
      }
      for (let t = 0; t + 2 < s.indices.length; t += 3) {
        // Convert Halo CW (i0, i2, i1) back to outward CCW (v0, v1, v2)
        const i0 = vBase + s.indices[t]!;
        const i1 = vBase + s.indices[t + 2]!;
        const i2 = vBase + s.indices[t + 1]!;
        triangles.push({
          v0: i0,
          v1: i1,
          v2: i2,
          materialRole: role,
        });
      }
      vBase += vc;
    }

    const bMin: [number, number, number] = [
      Number.isFinite(minX) ? minX : -10,
      Number.isFinite(minY) ? minY : -10,
      Number.isFinite(minZ) ? minZ : -2,
    ];
    const bMax: [number, number, number] = [
      Number.isFinite(maxX) ? maxX : 10,
      Number.isFinite(maxY) ? maxY : 10,
      Number.isFinite(maxZ) ? maxZ : 10,
    ];

    return {
      vertices,
      triangles,
      materialRoles: Array.from(roleSet),
      bounds: {
        min: bMin,
        max: bMax,
        size: [bMax[0] - bMin[0], bMax[1] - bMin[1], bMax[2] - bMin[2]],
      },
      wireframeSegments: lastGeneratedWorldMeshRef.current?.wireframeSegments ?? [],
      clearanceReport: lastGeneratedWorldMeshRef.current?.clearanceReport ?? {
        ok: true,
        walkSamples: 12,
        maxStepHeight: 0,
      },
      recommendedSpawnPoint: lastGeneratedWorldMeshRef.current?.recommendedSpawnPoint ?? [0, 0, 0.2],
    };
  };

  // Inject the Procedural World / Tunnel / Cave / Bridge / Terrain / City Mesh directly into the map's Structure BSP (sbsp) with compiled 3D/2D CollisionBSP!
  const handleInjectGeneratedWorldDirectlyIntoBsp = async () => {
    const worldMesh = buildCurrentWorldMeshFromStudio();
    if (!worldMesh || !window.opence.injectProceduralWorldBsp) {
      setStatusMessage('No procedural world mesh ready to inject.');
      return;
    }
    setApplying(true);
    setStatusMessage(
      `Compiling 3D/2D CollisionBSP & injecting ${worldMesh.triangles.length.toLocaleString()} triangles directly into Structure BSP #${selectedBspIndex}...`,
    );
    try {
      const resolvedShaders = resolveDefaultHaloShadersForWorld(allTags, worldShaderOverrides);
      const visibleSubs = submeshesRef.current.filter((s) => s.visible && s.positions.length > 0);
      for (let sIdx = 0; sIdx < visibleSubs.length; sIdx++) {
        const s = visibleSubs[sIdx]!;
        const role = worldActiveRoles[sIdx];
        if (role && s.shaderTagId && s.shaderPath) {
          resolvedShaders[role] = {
            tagId: s.shaderTagId,
            path: s.shaderPath,
            classFourCC: 'senv',
          };
        }
      }

      const res = await window.opence.injectProceduralWorldBsp({
        worldMesh,
        bspIndex: selectedBspIndex,
        shaderBindings: resolvedShaders,
        collisionMode: 'auto',
      });
      if (!res.ok) {
        setStatusMessage(`Failed to inject into Structure BSP: ${res.message}`);
        setApplying(false);
        return;
      }
      window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
      setStatusMessage(
        `Injected ${res.addedTriangles.toLocaleString()} render triangles (${res.addedSubmeshes} shader surface(s)) & ${res.addedCollisionSurfaces.toLocaleString()} 3D collision surfaces into BSP #${selectedBspIndex}! Switching to Live BSP View...`,
      );
      setStudioMode('bsp');
    } catch (err) {
      setStatusMessage(`BSP injection error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  // Auto-Shader all surfaces in the current model/BSP/generated world using Halo CE Default Shader role matching
  const handleAutoShaderAllSurfaces = async () => {
    if (shaderTags.length === 0) {
      setStatusMessage('No shader tags found in the open map.');
      return;
    }
    pushUndoSnapshot();
    const resolved = resolveDefaultHaloShadersForWorld(allTags, {});
    setWorldShaderOverrides({});

    const roleKeys = HALO_DEFAULT_SHADER_CATALOG.map((c) => c.role);
    let assignedCount = 0;
    for (let i = 0; i < submeshesRef.current.length; i++) {
      const role = worldActiveRoles[i] ?? roleKeys[i % roleKeys.length]!;
      const matched = resolved[role];
      const shId =
        matched?.tagId && matched.tagId !== 0xffffffff ? matched.tagId : shaderTags[i % shaderTags.length]!.tagId;
      await assignShaderToSubmeshLive(i, shId);
      assignedCount++;
    }
    setStatusMessage(
      `Auto-Shader matched and applied Halo default shaders across ${assignedCount} surface(s)!`,
    );
  };

  // Export generated Tunnel / Bridge / QuickForge World to .JMS (Halo Tool 8200) or .OBJ
  const handleExportGeneratedWorldFile = (format: 'jms' | 'obj') => {
    const worldMesh = buildCurrentWorldMeshFromStudio();
    if (!worldMesh) return;
    const cleanName = primName.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || createBuilderKind;
    const content = format === 'jms' ? exportWorldMeshToJms(worldMesh) : exportWorldMeshToObj(worldMesh);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanName}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage(
      `Exported "${cleanName}.${format}" (${worldMesh.vertices.length.toLocaleString()} verts, ${worldMesh.triangles.length.toLocaleString()} tris).`,
    );
  };

  // Coupled Dimensional Physics Resizer (scales gbxmodel + collision_geometry + physics s^1/s^3/s^5/s^-5 + vehicle suspension depths)
  const handleCoupledScaleAssetPhysics = async () => {
    const assetTag = allTags.find((t) => t.index === selectedAssetTagIndex);
    if (!assetTag || !window.opence.scaleCoupledPhysics) {
      setStatusMessage('Select a Vehicle, Scenery, Weapon, Equipment, or Biped tag first.');
      return;
    }
    setApplying(true);
    setStatusMessage(
      `Scaling 3D GBXModel, Collision BSP, Physics Mass/Inertia (s¹, s³, s⁵, s⁻⁵) & Suspension Depths by ${coupledScaleFactor}x...`,
    );
    try {
      const res = await window.opence.scaleCoupledPhysics(assetTag.tagId, coupledScaleFactor);
      if (!res.ok) {
        setStatusMessage(`Coupled scale failed: ${res.message}`);
        setApplying(false);
        return;
      }
      window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
      await loadActiveTarget();
      const s = res.summary;
      setStatusMessage(
        `Scaled "${s.objectPath}" (${s.scaleFactor}x): ${s.scaledGbxmodelVertices} model verts, ${s.scaledCollisionVertices} coll verts, ${s.scaledPhysicsMassPoints} mass pts${s.newPhysicsMass ? ` (Mass=${s.newPhysicsMass.toFixed(1)}kg)` : ''}, ${s.scaledVehicleSuspensions} suspensions!`,
      );
    } catch (err) {
      setStatusMessage(`Coupled scale error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  // Compile & Merge Floating Object into the Map (creates gbxmodel + collision_model + shader + bitmap and places in 3D BSP space)
  const handleMergeFloatingObjectIntoMap = async () => {
    const visibleSubs = submeshesRef.current.filter((s) => s.visible && s.positions.length > 0);
    const primarySub = visibleSubs[0] ?? submeshesRef.current[0];
    if (!primarySub || !window.opence.buildCustomObjectTag) return;
    setApplying(true);
    setStatusMessage('Auto-generating 3D Collision Hull, Smart UV Map, Shader & Scenery Tag and placing into BSP...');
    try {
      // Export all visible sculpted/parametric submeshes to Wavefront OBJ string in memory
      const lines: string[] = ['# OpenCE Floating BSP Object'];
      for (const s of visibleSubs) {
        const vc = Math.floor(s.positions.length / 3);
        for (let v = 0; v < vc; v++) {
          lines.push(`v ${s.positions[v * 3]!} ${s.positions[v * 3 + 1]!} ${s.positions[v * 3 + 2]!}`);
        }
      }
      for (const s of visibleSubs) {
        const vc = Math.floor(s.positions.length / 3);
        for (let v = 0; v < vc; v++) {
          lines.push(`vt ${s.uvs[v * 2]!} ${1 - s.uvs[v * 2 + 1]!}`);
        }
      }
      for (const s of visibleSubs) {
        const vc = Math.floor(s.positions.length / 3);
        for (let v = 0; v < vc; v++) {
          lines.push(`vn ${s.normals[v * 3]!} ${s.normals[v * 3 + 1]!} ${s.normals[v * 3 + 2]!}`);
        }
      }
      let vOffset = 0;
      for (const s of visibleSubs) {
        const vc = Math.floor(s.positions.length / 3);
        for (let t = 0; t + 2 < s.indices.length; t += 3) {
          // Convert Halo CW back to OBJ CCW
          const i0 = vOffset + s.indices[t]! + 1;
          const i1 = vOffset + s.indices[t + 2]! + 1;
          const i2 = vOffset + s.indices[t + 1]! + 1;
          lines.push(`f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}`);
        }
        vOffset += vc;
      }
      const objText = lines.join('\n');
      const cleanName = primName.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'custom_bsp_object';
      const floatingEntry = (window.__openceFloatingBspObjects ?? []).find((f) => f.id === selectedFloatingId);
      const pngDataUrl =
        floatingEntry?.textureDataUrl ??
        (primarySub.paintCanvas ? primarySub.paintCanvas.toDataURL('image/png') : undefined);

      const res = await window.opence.buildCustomObjectTag({
        tagGroup: 'scenery',
        tagPath: `scenery\\bsp_structures\\${cleanName}\\${cleanName}`,
        itemName: cleanName,
        objFilePath: '',
        objSourceText: objText,
        texturePngDataUrl: pngDataUrl,
        collisionMode: 'exact',
        outputMode: 'inject',
      });
      if (!res.ok) {
        setStatusMessage(`Failed to compile floating BSP object: ${res.message}`);
        setApplying(false);
        return;
      }
      window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
      setStatusMessage(
        `Compiled & Merged "${res.rootTagPath}" into map with full 3D CollisionBSP & Painted Shader! You can now position it in the 3D Scenario Viewport.`,
      );
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  const handleSnapVerticesToGrid = () => {
    pushUndoSnapshot();
    const step = Math.max(0.01, gridStep);
    let snapped = 0;
    const useAll = selectedVertexCount === 0;
    for (const sub of submeshesRef.current) {
      const pos = sub.positions;
      const sel = sub.selectedVertices;
      const vCount = pos.length / 3;
      let subMod = false;
      for (let v = 0; v < vCount; v++) {
        if (!useAll && !sel[v]) continue;
        const idx = v * 3;
        pos[idx] = Math.round(pos[idx]! / step) * step;
        pos[idx + 1] = Math.round(pos[idx + 1]! / step) * step;
        pos[idx + 2] = Math.round(pos[idx + 2]! / step) * step;
        subMod = true;
        snapped++;
      }
      if (subMod) {
        sub.dirtyGeometry = true;
        (sub.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        recomputeSubmeshClockwiseNormals(sub);
        sub.geometry.computeBoundingBox();
        sub.geometry.computeBoundingSphere();
      }
    }
    syncSelectedPointsCloud();
    setStatusMessage(`Snapped ${snapped.toLocaleString()} ${useAll ? 'mesh' : 'selected'} vertices to ${step} wu grid.`);
  };

  const handleWeldVerticesByDistance = () => {
    pushUndoSnapshot();
    const tol = Math.max(0.0005, weldThreshold);
    const invTol = 1 / tol;
    const cellMap = new Map<string, { x: number; y: number; z: number; refs: Array<{ sub: SubmeshWorkingState; v: number }> }>();
    const useAll = selectedVertexCount === 0;

    for (const sub of submeshesRef.current) {
      const pos = sub.positions;
      const sel = sub.selectedVertices;
      const vCount = pos.length / 3;
      for (let v = 0; v < vCount; v++) {
        if (!useAll && !sel[v]) continue;
        const vx = pos[v * 3]!;
        const vy = pos[v * 3 + 1]!;
        const vz = pos[v * 3 + 2]!;
        const key = `${Math.round(vx * invTol)},${Math.round(vy * invTol)},${Math.round(vz * invTol)}`;
        let cluster = cellMap.get(key);
        if (!cluster) {
          cluster = { x: 0, y: 0, z: 0, refs: [] };
          cellMap.set(key, cluster);
        }
        cluster.x += vx;
        cluster.y += vy;
        cluster.z += vz;
        cluster.refs.push({ sub, v });
      }
    }

    let weldedCount = 0;
    const touchedSubs = new Set<SubmeshWorkingState>();
    for (const cluster of cellMap.values()) {
      if (cluster.refs.length < 2) continue;
      const cx = cluster.x / cluster.refs.length;
      const cy = cluster.y / cluster.refs.length;
      const cz = cluster.z / cluster.refs.length;
      for (const ref of cluster.refs) {
        const idx = ref.v * 3;
        ref.sub.positions[idx] = cx;
        ref.sub.positions[idx + 1] = cy;
        ref.sub.positions[idx + 2] = cz;
        touchedSubs.add(ref.sub);
        weldedCount++;
      }
    }

    for (const sub of touchedSubs) {
      sub.dirtyGeometry = true;
      (sub.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      recomputeSubmeshClockwiseNormals(sub);
      sub.geometry.computeBoundingBox();
      sub.geometry.computeBoundingSphere();
    }
    syncSelectedPointsCloud();
    setStatusMessage(
      `Snap-joined / welded ${weldedCount.toLocaleString()} seam vertices within ${tol} wu across ${touchedSubs.size} surface(s).`,
    );
  };

  const handleApplyMeshScale = () => {
    pushUndoSnapshot();
    const mc = modelBoundsRef.current.center;
    for (const sub of submeshesRef.current) {
      const pos = sub.positions;
      const vCount = pos.length / 3;
      for (let v = 0; v < vCount; v++) {
        pos[v * 3] = mc.x + (pos[v * 3]! - mc.x) * scaleX;
        pos[v * 3 + 1] = mc.y + (pos[v * 3 + 1]! - mc.y) * scaleY;
        pos[v * 3 + 2] = mc.z + (pos[v * 3 + 2]! - mc.z) * scaleZ;
      }
      sub.dirtyGeometry = true;
      (sub.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      recomputeSubmeshClockwiseNormals(sub);
      sub.geometry.computeBoundingBox();
      sub.geometry.computeBoundingSphere();
    }
    updateSymmetryPlanesVisuals();
    setStatusMessage(`Applied scale (${scaleX.toFixed(2)}, ${scaleY.toFixed(2)}, ${scaleZ.toFixed(2)}) around geometry center.`);
  };

  const handleResetGeometry = () => {
    pushUndoSnapshot();
    for (const sub of submeshesRef.current) {
      if (sub.positions.length === sub.originalPositions.length) {
        sub.positions.set(sub.originalPositions);
      }
      sub.dirtyGeometry = false;
      (sub.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      recomputeSubmeshClockwiseNormals(sub);
      sub.geometry.computeBoundingBox();
      sub.geometry.computeBoundingSphere();
    }
    updateSymmetryPlanesVisuals();
    setStatusMessage('Reset all vertices to original map geometry.');
  };

  // Swap shader on selected BSP or Model submesh AND immediately update live 3D viewport material texture + auto-commit to map!
  const handleSwapSubmeshShader = async () => {
    pushUndoSnapshot();
    await assignShaderToSubmeshLive(selectedSubmeshIdx, targetShaderTagId);
  };

  const toggleSubmeshVisibility = (idx: number) => {
    const sub = submeshesRef.current[idx];
    if (!sub) return;
    sub.visible = !sub.visible;
    sub.mesh.visible = sub.visible;
    sub.wireMesh.visible = sub.visible;
    setSubmeshSummaryList((prev) =>
      prev.map((s) => (s.submeshIndex === idx ? { ...s, visible: sub.visible } : s)),
    );
  };

  // Commit all modified vertices, painted textures, and swapped shaders into the open .map in memory!
  const handleCommitToMap = async () => {
    setApplying(true);
    setStatusMessage('Writing 3D vertex geometry, collision & painted textures into open map...');
    try {
      let updatedVerts = 0;
      let updatedCollVerts = 0;
      let updatedBitmaps = 0;

      // 1. Save any painted bitmap canvases
      const savedBitmapIndices = new Set<number>();
      for (const sub of submeshesRef.current) {
        if (
          sub.dirtyTexture &&
          sub.paintCanvas &&
          sub.bitmapTagIndex !== null &&
          !savedBitmapIndices.has(sub.bitmapTagIndex)
        ) {
          savedBitmapIndices.add(sub.bitmapTagIndex);
          const pngDataUrl = sub.paintCanvas.toDataURL('image/png');
          if (window.opence.replaceBitmapFromDataUrl) {
            const bitmRes = await window.opence.replaceBitmapFromDataUrl(
              sub.bitmapTagIndex,
              0,
              pngDataUrl,
            );
            if (bitmRes.ok) {
              updatedBitmaps++;
              sub.dirtyTexture = false;
            }
          }
        }
      }

      // 2. Save modified BSP or Model vertices and shader assignments
      const dirtySubs = submeshesRef.current.filter((s) => s.dirtyGeometry || s.dirtyShader);
      if (dirtySubs.length > 0) {
        if (studioMode === 'bsp' && window.opence.updateBspVertices) {
          const payload = dirtySubs.map((s) => ({
            submeshIndex: s.submeshIndex,
            positions: s.positions,
            normals: s.normals,
            uvs: s.uvs,
            shaderTagId: s.dirtyShader && s.shaderTagId ? s.shaderTagId : undefined,
            indices: s.dirtyGeometry ? s.indices : undefined,
          }));
          const res = await window.opence.updateBspVertices(selectedBspIndex, payload);
          if (!res.ok) {
            setStatusMessage(`Failed to update BSP vertices: ${res.message}`);
            setApplying(false);
            return;
          }
          updatedVerts = res.updatedVertices;
          updatedCollVerts = res.updatedCollisionVertices;
          for (const s of dirtySubs) {
            s.originalPositions = new Float32Array(s.positions);
            s.dirtyGeometry = false;
            s.dirtyShader = false;
          }
        } else if (studioMode === 'model' && activeModelTagId !== null && window.opence.updateModelVertices) {
          const payload = dirtySubs.map((s) => ({
            submeshIndex: s.submeshIndex,
            positions: s.positions,
            normals: s.normals,
            uvs: s.uvs,
            shaderTagId: s.dirtyShader && s.shaderTagId ? s.shaderTagId : undefined,
          }));
          const res = await window.opence.updateModelVertices(activeModelTagId, payload, 4);
          if (!res.ok) {
            setStatusMessage(`Failed to update model vertices: ${res.message}`);
            setApplying(false);
            return;
          }
          updatedVerts = res.updatedVertices;
          for (const s of dirtySubs) {
            s.originalPositions = new Float32Array(s.positions);
            s.dirtyGeometry = false;
            s.dirtyShader = false;
          }
        } else if (studioMode === 'create') {
          await handleMergeFloatingObjectIntoMap();
          return;
        }
      }

      window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
      setStatusMessage(
        `Applied to Map! Updated ${updatedVerts.toLocaleString()} render vertices${
          studioMode === 'bsp' ? `, ${updatedCollVerts.toLocaleString()} 3D collision vertices & planes,` : ' across all LODs,'
        } and ${updatedBitmaps} painted texture(s). Use File -> Save Map (Ctrl+S) to write to disk.`,
      );
    } catch (err) {
      setStatusMessage(`Failed to apply changes: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  const activeToolInfo = SCULPT_TOOLS.find((t) => t.id === activeTool);
  const selectedSubSummary = submeshSummaryList[selectedSubmeshIdx] ?? null;
  const currentAssetName =
    studioMode === 'bsp'
      ? bspTags[selectedBspIndex]?.path ?? `BSP #${selectedBspIndex}`
      : studioMode === 'create'
        ? `floating_bsp\\${primName}`
        : categoryTags.find((t) => t.index === selectedAssetTagIndex)?.path ?? '3D Asset';

  const isPaintTool = activeTool === 'paint_brush' || activeTool === 'paint_bucket' || activeTool === 'shader_picker';
  const isTopologyTool =
    activeTool === 'vertex_select' ||
    activeTool === 'split_topology' ||
    activeTool === 'extrude_face_snap' ||
    activeTool === 'delete_face';

  return (
    <div
      data-testid="bsp-model-studio-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: '#0d121b',
        color: '#d4dce8',
        overflow: 'hidden',
      }}
    >
      {/* Row 1: Studio Mode & Asset Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: '#131b28',
          borderBottom: '1px solid #223046',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 12.5, color: '#00e5ff', letterSpacing: 0.3 }}>
            3D BSP &amp; Model Studio
          </span>

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              data-testid="studio-mode-bsp-btn"
              onClick={() => setStudioMode('bsp')}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 4,
                cursor: 'pointer',
                border: studioMode === 'bsp' ? '1px solid #00e5ff' : '1px solid #2c3e55',
                background: studioMode === 'bsp' ? '#12384f' : '#16202e',
                color: studioMode === 'bsp' ? '#9beeff' : '#9eb0c7',
              }}
            >
              Live BSP Terrain &amp; Surface Editor
            </button>
            <button
              type="button"
              data-testid="studio-mode-model-btn"
              onClick={() => setStudioMode('model')}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 4,
                cursor: 'pointer',
                border: studioMode === 'model' ? '1px solid #ff9f43' : '1px solid #2c3e55',
                background: studioMode === 'model' ? '#3d2814' : '#16202e',
                color: studioMode === 'model' ? '#ffd29d' : '#9eb0c7',
              }}
            >
              3D Asset Model Editor
            </button>
            <button
              type="button"
              data-testid="studio-mode-create-btn"
              onClick={() => setStudioMode('create')}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 4,
                cursor: 'pointer',
                border: studioMode === 'create' ? '1px solid #22c55e' : '1px solid #2c3e55',
                background: studioMode === 'create' ? '#143d2b' : '#16202e',
                color: studioMode === 'create' ? '#86efac' : '#9eb0c7',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Plus size={12} /> World, Tunnel, Bridge &amp; BSP Builder
            </button>
          </div>

          {studioMode === 'bsp' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span style={{ color: '#8fa6c2' }}>BSP:</span>
              <select
                data-testid="studio-bsp-select"
                value={selectedBspIndex}
                onChange={(e) => setSelectedBspIndex(Number(e.target.value))}
                style={{
                  background: '#0d131d',
                  color: '#e2ecf7',
                  border: '1px solid #2b3c54',
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                }}
              >
                {bspTags.map((b, idx) => (
                  <option key={b.index} value={idx}>
                    BSP #{idx} — {b.path}
                  </option>
                ))}
              </select>
            </label>
          ) : studioMode === 'create' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, flexWrap: 'wrap' }}>
              {(
                [
                  { id: 'tunnel_network' as const, label: '🚇 Tunnels & Caves (1–5)' },
                  { id: 'bridge_network' as const, label: '🌉 Multi-Style Bridges (1–5)' },
                  { id: 'quickforge_world' as const, label: '🏔 QuickForge Terrain, Nature, Forerunner & City' },
                  { id: 'primitive' as const, label: '🧱 Single Primitive' },
                ]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`studio-create-tab-${tab.id}`}
                  onClick={() => {
                    setSelectedFloatingId('');
                    setCreateBuilderKind(tab.id);
                  }}
                  style={{
                    padding: '3px 8px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    borderRadius: 4,
                    cursor: 'pointer',
                    background: createBuilderKind === tab.id && !selectedFloatingId ? '#15803d' : '#0f172a',
                    color: createBuilderKind === tab.id && !selectedFloatingId ? '#ffffff' : '#94a3b8',
                    border:
                      createBuilderKind === tab.id && !selectedFloatingId
                        ? '1px solid #4ade80'
                        : '1px solid #334155',
                  }}
                >
                  {tab.label}
                </button>
              ))}
              <input
                ref={objFileInputRef}
                type="file"
                accept=".obj"
                style={{ display: 'none' }}
                onChange={handleImportFloatingObjFile}
              />
              <button
                type="button"
                onClick={() => objFileInputRef.current?.click()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  background: '#1e293b',
                  color: '#38bdf8',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                <Upload size={12} /> Import .OBJ
              </button>
              {floatingObjects.length > 0 && (
                <select
                  value={selectedFloatingId}
                  onChange={(e) => setSelectedFloatingId(e.target.value)}
                  style={{
                    background: '#0d131d',
                    color: '#e2ecf7',
                    border: '1px solid #2b3c54',
                    borderRadius: 4,
                    padding: '3px 8px',
                    fontSize: 11,
                  }}
                >
                  <option value="">Generator: {createBuilderKind}</option>
                  {floatingObjects.map((f) => (
                    <option key={f.id} value={f.id}>
                      Saved: {f.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                data-testid="studio-model-category-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as AssetCategory)}
                style={{
                  background: '#0d131d',
                  color: '#e2ecf7',
                  border: '1px solid #2b3c54',
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                }}
              >
                <option value="vehicle">Vehicles (vehi)</option>
                <option value="weapon">Weapons (weap)</option>
                <option value="biped">Bipeds (bipd)</option>
                <option value="scenery">Scenery (scen)</option>
                <option value="equipment">Equipment (eqip)</option>
                <option value="gbxmodel">3D Models (mod2)</option>
              </select>
              <select
                data-testid="studio-model-item-select"
                value={selectedAssetTagIndex}
                onChange={(e) => setSelectedAssetTagIndex(Number(e.target.value))}
                style={{
                  background: '#0d131d',
                  color: '#e2ecf7',
                  border: '1px solid #2b3c54',
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  maxWidth: 260,
                }}
              >
                {categoryTags.map((t) => (
                  <option key={t.index} value={t.index}>
                    {t.path}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            title="Undo (Ctrl+Z)"
            disabled={undoCount === 0}
            onClick={handleUndo}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              fontSize: 11,
              background: '#16202e',
              color: undoCount > 0 ? '#e2ecf7' : '#52637a',
              border: '1px solid #2b3c54',
              borderRadius: 4,
              cursor: undoCount > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            <Undo2 size={13} /> Undo
          </button>
          <button
            type="button"
            title="Redo (Ctrl+Y)"
            disabled={redoCount === 0}
            onClick={handleRedo}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              fontSize: 11,
              background: '#16202e',
              color: redoCount > 0 ? '#e2ecf7' : '#52637a',
              border: '1px solid #2b3c54',
              borderRadius: 4,
              cursor: redoCount > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            <Redo2 size={13} /> Redo
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', marginLeft: 4 }}>
            <input
              type="checkbox"
              checked={wireframeOverlay}
              onChange={(e) => setWireframeOverlay(e.target.checked)}
            />
            <span>Wireframe</span>
          </label>
          <button
            type="button"
            onClick={handleResetGeometry}
            title="Reset all vertices to original map geometry"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 9px',
              fontSize: 11,
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={13} /> Reset
          </button>
          <button
            type="button"
            data-testid="studio-apply-to-map-btn"
            disabled={applying || loading}
            onClick={handleCommitToMap}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 700,
              background: '#166534',
              color: '#ecfdf5',
              border: '1px solid #22c55e',
              borderRadius: 4,
              cursor: applying ? 'wait' : 'pointer',
            }}
          >
            <Save size={13} /> {applying ? 'Applying...' : 'Apply Geometry & Textures to Map'}
          </button>
        </div>
      </div>

      {/* Row 2: Single Horizontal Row of Monochrome Vector Tool Icons Across Top of Viewport */}
      <div
        data-testid="studio-compact-tool-grid"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 12px',
          background: '#101722',
          borderBottom: '1px solid #1e2c40',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {SCULPT_TOOLS.filter(
            (t) => t.id !== 'paint_brush' && t.id !== 'paint_bucket' && t.id !== 'shader_picker',
          ).map((t) => {
            const isSelected = activeTool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                title={t.tip}
                aria-label={t.label}
                data-testid={`studio-tool-${t.id}`}
                onMouseEnter={() => setHoveredToolTip(t.label)}
                onMouseLeave={() => setHoveredToolTip(null)}
                onClick={() => setActiveTool(t.id)}
                style={{
                  width: 30,
                  height: 28,
                  borderRadius: 4,
                  border: isSelected ? '1px solid #00e5ff' : '1px solid #25354d',
                  background: isSelected ? '#153852' : '#141d2b',
                  color: isSelected ? '#ffffff' : '#9fb3c8',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  boxShadow: isSelected ? '0 0 6px rgba(0, 229, 255, 0.25)' : 'none',
                }}
              >
                {t.icon}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11 }}>
          <span
            data-testid="studio-tool-hover-readout"
            style={{ color: '#00e5ff', fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            {hoveredToolTip ?? activeToolInfo?.label}
          </span>
        </div>
      </div>

      {/* Main Split Body: Center 3D Viewport (with Bottom Settings Bar) + Right Halo Asset Scene Outliner */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Center Column: 3D Viewport + Bottom Finer Brush/Topology Settings Bar */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          {/* 3D Interactive Canvas */}
          <div
            style={{
              flex: 1,
              position: 'relative',
              minWidth: 0,
              minHeight: 0,
              cursor: is2dSketchMode ? 'crosshair' : activeTool === 'orbit' ? 'grab' : 'crosshair',
            }}
            onContextMenu={(e) => {
              e.preventDefault();
            }}
            onPointerDown={(e) => {
              if (e.button === 2) {
                rightPointerDownRef.current = { x: e.clientX, y: e.clientY };
                return;
              }
              setBspContextMenu(null);
              // Direct 2D Sketching on the active 3D Work Plane inside the 3D Viewport!
              if (e.button === 0 && is2dSketchMode && !sketchPickFaceActive) {
                const container = viewportContainerRef.current;
                const camera = cameraRef.current;
                if (container && camera) {
                  const rect = container.getBoundingClientRect();
                  const ndc = new THREE.Vector2(
                    ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
                    -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
                  );
                  const raycaster = new THREE.Raycaster();
                  raycaster.setFromCamera(ndc, camera);
                  const [ox, oy, oz] = sketchFaceBasis.origin;
                  const [nx, ny, nz] = sketchFaceBasis.normal;
                  const [ux, uy, uz] = sketchFaceBasis.uAxis;
                  const [vx, vy, vz] = sketchFaceBasis.vAxis;
                  const originVec = new THREE.Vector3(ox, oy, oz);
                  const normalVec = new THREE.Vector3(nx, ny, nz).normalize();
                  const mathPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normalVec, originVec);
                  const hitPt = new THREE.Vector3();
                  if (raycaster.ray.intersectPlane(mathPlane, hitPt)) {
                    const rel = hitPt.clone().sub(originVec);
                    const uVec = new THREE.Vector3(ux, uy, uz);
                    const vVec = new THREE.Vector3(vx, vy, vz);
                    const u = Number(rel.dot(uVec).toFixed(2));
                    const v = Number(rel.dot(vVec).toFixed(2));
                    setSketchShapeKind('polyline');
                    if (e.shiftKey) {
                      setSketchPoints((prev) =>
                        prev.filter(([pu, pv]) => Math.hypot(pu - u, pv - v) > 0.35),
                      );
                    } else {
                      setSketchPoints((prev) => [...prev, [u, v]]);
                    }
                    setStatusMessage(
                      `2D Sketch on ${sketchFaceBasis.label}: added point (${u}, ${v}) in 3D viewport. Click "✓ Finish 2D Sketch -> Switch to 3D" when ready to Extrude / Revolve / Cut!`,
                    );
                  }
                }
                return;
              }
              if (e.button === 0 && (activeTool !== 'orbit' || sketchPickFaceActive || movePlacedOnTerrainClick)) {
                pushUndoSnapshot();
                isPointerDownRef.current = true;
                flattenTargetZRef.current = null;
                grabLastHitRef.current = null;
                raycastAndInteract(e.clientX, e.clientY, true, e.shiftKey);
              }
            }}
            onPointerMove={(e) => {
              if (is2dSketchMode && !sketchPickFaceActive) return;
              const shouldContinuousApply =
                isPointerDownRef.current &&
                activeTool !== 'orbit' &&
                activeTool !== 'split_topology' &&
                activeTool !== 'extrude_face_snap' &&
                activeTool !== 'delete_face';
              raycastAndInteract(e.clientX, e.clientY, shouldContinuousApply, e.shiftKey);
            }}
            onPointerUp={(e) => {
              if (e.button === 2 && rightPointerDownRef.current) {
                const dist = Math.hypot(
                  e.clientX - rightPointerDownRef.current.x,
                  e.clientY - rightPointerDownRef.current.y,
                );
                rightPointerDownRef.current = null;
                if (dist < 8) {
                  const container = viewportContainerRef.current;
                  const camera = cameraRef.current;
                  const meshGroup = meshGroupRef.current;
                  if (container && camera && meshGroup) {
                    const rect = container.getBoundingClientRect();
                    const ndc = new THREE.Vector2(
                      ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
                      -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
                    );
                    const raycaster = new THREE.Raycaster();
                    raycaster.setFromCamera(ndc, camera);
                    const visibleMeshes = meshGroup.children.filter((c) => c.visible);
                    const hits = raycaster.intersectObjects(visibleMeshes, true);
                    if (hits.length > 0) {
                      const hit = hits[0]!;
                      const hn = hit.face?.normal ? hit.face.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
                      setBspContextMenu({
                        clientX: e.clientX - rect.left,
                        clientY: e.clientY - rect.top,
                        hitPoint: [
                          Number(hit.point.x.toFixed(3)),
                          Number(hit.point.y.toFixed(3)),
                          Number(hit.point.z.toFixed(3)),
                        ],
                        hitNormal: [Number(hn.x.toFixed(4)), Number(hn.y.toFixed(4)), Number(hn.z.toFixed(4))],
                        hitSubmeshIdx: (hit.object.userData?.submeshIndex as number | undefined) ?? null,
                        hitFaceIdx: hit.faceIndex ?? null,
                      });
                    } else {
                      const targetZ = controlsRef.current?.target.z ?? 0;
                      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -targetZ);
                      const groundPt = new THREE.Vector3();
                      if (raycaster.ray.intersectPlane(groundPlane, groundPt)) {
                        setBspContextMenu({
                          clientX: e.clientX - rect.left,
                          clientY: e.clientY - rect.top,
                          hitPoint: [
                            Number(groundPt.x.toFixed(3)),
                            Number(groundPt.y.toFixed(3)),
                            Number(groundPt.z.toFixed(3)),
                          ],
                          hitNormal: [0, 0, 1],
                          hitSubmeshIdx: null,
                          hitFaceIdx: null,
                        });
                      }
                    }
                  }
                }
                return;
              }
              isPointerDownRef.current = false;
              flattenTargetZRef.current = null;
              grabLastHitRef.current = null;
            }}
            onPointerLeave={() => {
              isPointerDownRef.current = false;
              if (brushRingRef.current) brushRingRef.current.visible = false;
            }}
          >
            <div ref={viewportContainerRef} style={{ width: '100%', height: '100%' }} />

            {/* Floating 2D Sketch Mode HUD Bar directly inside the 3D Edit Viewport */}
            {is2dSketchMode && (
              <div
                data-testid="studio-3d-viewport-2d-sketch-hud"
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 12,
                  right: 110,
                  background: 'rgba(13, 22, 36, 0.94)',
                  border: '1px solid #00e5ff',
                  borderRadius: 6,
                  padding: '7px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                  zIndex: 32,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.65)',
                  fontSize: 11,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: '#00e5ff', fontWeight: 700 }}>
                    📐 2D Sketch Mode in 3D World ({sketchFaceBasis.label})
                  </span>
                  <span style={{ color: '#cbd5e1', fontSize: 10.5 }}>
                    Left-Click on 3D grid to add points ({sketchPoints.length} pts) · Shift+Click to remove · Right-Drag to Orbit
                  </span>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {(
                      [
                        { id: 'rect' as const, label: 'Rect' },
                        { id: 'circle' as const, label: 'Circle' },
                        { id: 'polygon' as const, label: 'Hex' },
                        { id: 'l_bracket' as const, label: 'L-Shape' },
                      ]
                    ).map((sh) => (
                      <button
                        key={sh.id}
                        type="button"
                        onClick={() => handleApplySketchShapePreset(sh.id)}
                        style={{
                          padding: '2px 6px',
                          fontSize: 10,
                          background: sketchShapeKind === sh.id ? '#153852' : '#0f172a',
                          color: '#9beeff',
                          border: '1px solid #2b3c54',
                          borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >
                        {sh.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSketchPoints((prev) => prev.slice(0, -1))}
                      style={{
                        padding: '2px 6px',
                        fontSize: 10,
                        background: '#1e293b',
                        color: '#bae6fd',
                        border: '1px solid #334155',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      Undo Pt
                    </button>
                    <button
                      type="button"
                      onClick={() => setSketchPoints([])}
                      style={{
                        padding: '2px 6px',
                        fontSize: 10,
                        background: '#3f1d24',
                        color: '#fecdd3',
                        border: '1px solid #f43f5e',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={finish2dSketchTo3dMode}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    background: '#16a34a',
                    color: '#ffffff',
                    border: '1px solid #4ade80',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  ✓ Finish 2D Sketch → Switch to 3D Extrude / Revolve / Cut
                </button>
              </div>
            )}

            {/* Right-Click Live Terrain / 3D Surface Context Menu ("Add Object to Map" & "Start 2D Sketch on Face") */}
            {bspContextMenu && (
              <div
                data-testid="studio-bsp-rightclick-menu"
                style={{
                  position: 'absolute',
                  left: Math.min(bspContextMenu.clientX, 520),
                  top: Math.min(bspContextMenu.clientY, 340),
                  width: 275,
                  background: '#0f172a',
                  border: '1px solid #00e5ff',
                  borderRadius: 6,
                  boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
                  padding: 8,
                  zIndex: 40,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  fontSize: 11,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #1e293b',
                    paddingBottom: 4,
                  }}
                >
                  <strong style={{ color: '#00e5ff', fontSize: 10.5 }}>
                    3D Point ({bspContextMenu.hitPoint[0]}, {bspContextMenu.hitPoint[1]}, {bspContextMenu.hitPoint[2]})
                  </strong>
                  <button
                    type="button"
                    onClick={() => setBspContextMenu(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ color: '#86efac', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>
                  + Add Saved Map Object Here:
                </div>
                {floatingObjects.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 120, overflowY: 'auto' }}>
                    {floatingObjects.map((fo) => (
                      <button
                        key={fo.id}
                        type="button"
                        onClick={() => {
                          if (studioMode !== 'bsp') {
                            pendingPlaceObjectRef.current = fo;
                            setBspContextMenu(null);
                            setStudioMode('bsp');
                          } else {
                            handleAddObjectToBspAtPoint(fo, bspContextMenu.hitPoint);
                          }
                        }}
                        style={{
                          textAlign: 'left',
                          padding: '5px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                          background: '#143d2b',
                          color: '#ecfdf5',
                          border: '1px solid #22c55e',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        ➕ Place "{fo.name}" ({Math.floor(fo.indices.length / 3)} tris)
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#94a3b8', fontSize: 10, padding: '2px 0' }}>
                    No custom objects saved yet — use "Add Object / Create BSP Asset" to model &amp; save one, or pick a preset below:
                  </div>
                )}

                <div style={{ color: '#9bc2e8', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', marginTop: 2 }}>
                  + Quick-Add Parametric Object Here:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {(
                    [
                      { id: 'ramp' as const, label: '+ Vehicle Ramp' },
                      { id: 'bunker' as const, label: '+ Cover Bunker' },
                      { id: 'platform' as const, label: '+ Platform' },
                      { id: 'pillar' as const, label: '+ Pillar' },
                      { id: 'arch' as const, label: '+ Archway' },
                    ]
                  ).map((pr) => (
                    <button
                      key={pr.id}
                      type="button"
                      onClick={() => {
                        if (studioMode !== 'bsp') {
                          pendingPlaceObjectRef.current = pr.id;
                          setBspContextMenu(null);
                          setStudioMode('bsp');
                        } else {
                          handleAddObjectToBspAtPoint(pr.id, bspContextMenu.hitPoint);
                        }
                      }}
                      style={{
                        padding: '4px 6px',
                        fontSize: 10.5,
                        background: '#162234',
                        color: '#bae6fd',
                        border: '1px solid #2b3c54',
                        borderRadius: 4,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {pr.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const nVec = new THREE.Vector3(
                      bspContextMenu.hitNormal[0],
                      bspContextMenu.hitNormal[1],
                      bspContextMenu.hitNormal[2],
                    ).normalize();
                    const refUp = Math.abs(nVec.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
                    const uVec = new THREE.Vector3().crossVectors(refUp, nVec).normalize();
                    const vVec = new THREE.Vector3().crossVectors(nVec, uVec).normalize();
                    const nextBasis = {
                      origin: bspContextMenu.hitPoint,
                      normal: [nVec.x, nVec.y, nVec.z] as [number, number, number],
                      uAxis: [uVec.x, uVec.y, uVec.z] as [number, number, number],
                      vAxis: [vVec.x, vVec.y, vVec.z] as [number, number, number],
                      label: `Picked 3D Face #${bspContextMenu.hitFaceIdx ?? 0}`,
                    };
                    setSketchPlanePreset('face');
                    setSketchFaceBasis(nextBasis);
                    setBspContextMenu(null);
                    enter2dSketchIn3dWorld(nextBasis);
                  }}
                  style={{
                    marginTop: 3,
                    padding: '5px 8px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: '#3d2814',
                    color: '#ffd29d',
                    border: '1px solid #ff9f43',
                    borderRadius: 4,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  📐 Start 2D Sketch on This Face
                </button>

                {bspContextMenu.hitSubmeshIdx !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      void assignShaderToSubmeshLive(bspContextMenu.hitSubmeshIdx!, targetShaderTagId);
                      setBspContextMenu(null);
                    }}
                    style={{
                      marginTop: 3,
                      padding: '5px 8px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      background: '#1e3a5f',
                      color: '#9beeff',
                      border: '1px solid #00e5ff',
                      borderRadius: 4,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    🎨 Assign Active Shader to Surface #{bspContextMenu.hitSubmeshIdx}
                  </button>
                )}
              </div>
            )}

            {/* Floating "Merge Look Objects into BSP" Action Banner when Look Objects are placed in the BSP */}
            {studioMode === 'bsp' && placedBspObjects.length > 0 && (
              <div
                data-testid="studio-merge-look-objects-banner"
                style={{
                  position: 'absolute',
                  bottom: 14,
                  left: 14,
                  background: 'rgba(15, 36, 27, 0.94)',
                  border: '1px solid #22c55e',
                  borderRadius: 6,
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  zIndex: 30,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
                }}
              >
                <span style={{ fontSize: 11, color: '#a7f3d0', fontWeight: 600 }}>
                  {placedBspObjects.length} Placed Look Object(s) in BSP
                </span>
                <button
                  type="button"
                  onClick={() => setMovePlacedOnTerrainClick((v) => !v)}
                  style={{
                    padding: '4px 8px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: movePlacedOnTerrainClick ? '#153852' : '#0d131d',
                    color: movePlacedOnTerrainClick ? '#00e5ff' : '#cbd5e1',
                    border: movePlacedOnTerrainClick ? '1px solid #00e5ff' : '1px solid #334155',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {movePlacedOnTerrainClick ? '✓ Click Terrain to Move Active' : 'Click Terrain to Move'}
                </button>
                <button
                  type="button"
                  data-testid="studio-merge-look-objects-btn"
                  disabled={applying}
                  onClick={handleMergeLookObjectsIntoBsp}
                  style={{
                    padding: '5px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    background: '#16a34a',
                    color: '#ffffff',
                    border: '1px solid #4ade80',
                    borderRadius: 4,
                    cursor: applying ? 'wait' : 'pointer',
                  }}
                >
                  🔨 Merge Look Objects into BSP
                </button>
              </div>
            )}

            {/* Top-left floating HUD helper */}
            <div
              style={{
                position: 'absolute',
                top: 10,
                left: 12,
                background: 'rgba(11, 16, 26, 0.84)',
                border: '1px solid #24344d',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 11,
                color: '#b8cbe0',
                pointerEvents: 'none',
                maxWidth: '72%',
              }}
            >
              <div>
                <strong style={{ color: '#00e5ff' }}>{activeToolInfo?.label}</strong>
                {' · '}Left-Drag: Apply Tool · Right-Drag: Orbit Camera · Scroll: Zoom · Ctrl+Z: Undo
              </div>
              {statusMessage && (
                <div style={{ color: '#86efac', marginTop: 3, fontSize: 10.5 }}>{statusMessage}</div>
              )}
            </div>

            {/* Top-right 3D Orientation Coordinate Gizmo (true to X, Y, Z coordinates for both BSP and Model modes) */}
            <div
              data-testid="studio-3d-coord-gizmo"
              title="3D Coordinate Orientation Gizmo — Click X, Y, or Z to snap camera along that axis"
              style={{
                position: 'absolute',
                top: 10,
                right: 12,
                width: 82,
                height: 82,
                borderRadius: '50%',
                background: 'rgba(13, 19, 29, 0.82)',
                border: '1px solid #25354d',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
              }}
            >
              <svg width={78} height={78} viewBox="-40 -40 80 80">
                {(
                  [
                    { id: 'x' as const, label: 'X', color: '#ef4444', vec: gizmoAxes.x },
                    { id: 'y' as const, label: 'Y', color: '#22c55e', vec: gizmoAxes.y },
                    { id: 'z' as const, label: 'Z', color: '#3b82f6', vec: gizmoAxes.z },
                  ]
                )
                  .sort((a, b) => a.vec[2] - b.vec[2])
                  .map((ax) => {
                    const ex = ax.vec[0] * 26;
                    const ey = -ax.vec[1] * 26;
                    return (
                      <g
                        key={ax.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => snapCameraToAxis(ax.id)}
                      >
                        <line x1={0} y1={0} x2={ex} y2={ey} stroke={ax.color} strokeWidth={2.3} />
                        <circle cx={ex} cy={ey} r={7.5} fill={ax.color} />
                        <text
                          x={ex}
                          y={ey + 3.2}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight="bold"
                          fill="#ffffff"
                        >
                          {ax.label}
                        </text>
                      </g>
                    );
                  })}
                <circle cx={0} cy={0} r={3} fill="#e2e8f0" />
              </svg>
            </div>
          </div>

          {/* Bottom Bar: Finer Sculpt, Symmetry, Topology & Paint Settings */}
          <div
            data-testid="studio-bottom-settings-bar"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '7px 14px',
              background: '#111823',
              borderTop: '1px solid #223046',
              gap: 14,
              flexWrap: 'wrap',
              fontSize: 11,
            }}
          >
            {/* Sculpt Brush Radius & Strength */}
            {!isPaintTool && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#9bc2e8', fontWeight: 600 }}>Radius:</span>
                  <input
                    type="range"
                    min={studioMode === 'bsp' ? 0.2 : 0.02}
                    max={studioMode === 'bsp' ? 15.0 : 2.0}
                    step={studioMode === 'bsp' ? 0.1 : 0.02}
                    value={brushRadius}
                    onChange={(e) => setBrushRadius(Number(e.target.value))}
                    style={{ width: 95 }}
                  />
                  <strong style={{ color: '#00e5ff', minWidth: 46 }}>{brushRadius.toFixed(2)} wu</strong>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#9bc2e8', fontWeight: 600 }}>Strength:</span>
                  <input
                    type="range"
                    min={0.05}
                    max={1.0}
                    step={0.05}
                    value={brushStrength}
                    onChange={(e) => setBrushStrength(Number(e.target.value))}
                    style={{ width: 85 }}
                  />
                  <strong style={{ color: '#00e5ff', minWidth: 32 }}>{Math.round(brushStrength * 100)}%</strong>
                </label>

                {/* 3-Plane Center Symmetry Controls (X, Y, Z) + Translucent Orange Plane Visualizer */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '2px 8px',
                    background: '#162030',
                    border: '1px solid #25354d',
                    borderRadius: 4,
                  }}
                >
                  <span style={{ color: '#ff9f43', fontWeight: 700 }}>Symmetry:</span>
                  {(
                    [
                      { axis: 'X', active: symmetryX, toggle: () => setSymmetryX((v) => !v), color: '#ef4444' },
                      { axis: 'Y', active: symmetryY, toggle: () => setSymmetryY((v) => !v), color: '#22c55e' },
                      { axis: 'Z', active: symmetryZ, toggle: () => setSymmetryZ((v) => !v), color: '#3b82f6' },
                    ] as const
                  ).map((sym) => (
                    <button
                      key={sym.axis}
                      type="button"
                      data-testid={`studio-symmetry-${sym.axis.toLowerCase()}-btn`}
                      onClick={sym.toggle}
                      title={`Mirror across ${sym.axis} plane intersecting 3D model center`}
                      style={{
                        padding: '2px 7px',
                        fontSize: 10.5,
                        fontWeight: 700,
                        borderRadius: 3,
                        cursor: 'pointer',
                        border: sym.active ? '1px solid #ff9f43' : '1px solid #2b3c54',
                        background: sym.active ? '#3d2814' : '#0d131d',
                        color: sym.active ? '#ffd29d' : '#8fa6c2',
                      }}
                    >
                      {sym.axis}
                    </button>
                  ))}
                  <label
                    title="Show or hide translucent orange symmetry planes sized to the 3D geometry bounds"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginLeft: 4 }}
                  >
                    <input
                      type="checkbox"
                      checked={showSymmetryPlanes}
                      onChange={(e) => setShowSymmetryPlanes(e.target.checked)}
                    />
                    <span style={{ color: '#ffd29d', fontSize: 10.5 }}>Show Planes</span>
                  </label>
                </div>
              </div>
            )}

            {/* Topology / Vertex Edit Quick Actions */}
            {isTopologyTool && (
              <div
                data-testid="studio-bmesh-operations-panel"
                style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
              >
                <span
                  data-testid="studio-selected-vertex-count"
                  style={{ color: '#ffd29d', fontWeight: 700 }}
                >
                  Sel: {selectedVertexCount}
                </span>
                <button
                  type="button"
                  data-testid="studio-bmesh-select-all-btn"
                  onClick={handleSelectAllVertices}
                  style={{
                    padding: '3px 7px',
                    fontSize: 10.5,
                    background: '#1e293b',
                    color: '#e2e8f0',
                    border: '1px solid #334155',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={handleInvertVertexSelection}
                  style={{
                    padding: '3px 7px',
                    fontSize: 10.5,
                    background: '#1e293b',
                    color: '#e2e8f0',
                    border: '1px solid #334155',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Invert
                </button>
                <button
                  type="button"
                  onClick={handleClearVertexSelection}
                  style={{
                    padding: '3px 7px',
                    fontSize: 10.5,
                    background: '#1e293b',
                    color: '#fca5a5',
                    border: '1px solid #334155',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleSubdivideSelectedFaces}
                  title="Split/subdivide selected faces into smaller triangles"
                  style={{
                    padding: '3px 8px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: '#153852',
                    color: '#9beeff',
                    border: '1px solid #00e5ff',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Split Faces
                </button>
                <input
                  type="number"
                  step={0.05}
                  value={extrudeDist}
                  onChange={(e) => setExtrudeDist(Number(e.target.value) || 0.1)}
                  title="Extrude distance (world units)"
                  style={{
                    width: 48,
                    background: '#0d131d',
                    color: '#fff',
                    border: '1px solid #2b3c54',
                    borderRadius: 3,
                    padding: '2px 4px',
                    fontSize: 10.5,
                  }}
                />
                <button
                  type="button"
                  data-testid="studio-bmesh-extrude-out-btn"
                  onClick={() => handleExtrudeSelectedAlongNormals(1)}
                  style={{
                    padding: '3px 7px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: '#3d2814',
                    color: '#ffd29d',
                    border: '1px solid #ff9f43',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  +Extrude
                </button>
                <button
                  type="button"
                  data-testid="studio-bmesh-snap-grid-btn"
                  onClick={handleSnapVerticesToGrid}
                  style={{
                    padding: '3px 7px',
                    fontSize: 10.5,
                    background: '#12384f',
                    color: '#9beeff',
                    border: '1px solid #00e5ff',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Snap Grid ({gridStep})
                </button>
                <button
                  type="button"
                  data-testid="studio-bmesh-weld-btn"
                  onClick={handleWeldVerticesByDistance}
                  style={{
                    padding: '3px 7px',
                    fontSize: 10.5,
                    background: '#143d2b',
                    color: '#86efac',
                    border: '1px solid #22c55e',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Snap-Join / Weld ({weldThreshold})
                </button>
              </div>
            )}

            {/* Paint Brush & Halo Shader Painter Settings (hidden while live shader painting is disabled) */}
            {false && isPaintTool && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  <button
                    type="button"
                    data-testid="studio-paint-mode-shader-btn"
                    onClick={() => setPaintSourceMode('shader_texture')}
                    style={{
                      padding: '3px 8px',
                      fontSize: 10.5,
                      fontWeight: 700,
                      borderRadius: 4,
                      cursor: 'pointer',
                      border: paintSourceMode === 'shader_texture' ? '1px solid #00e5ff' : '1px solid #2b3c54',
                      background: paintSourceMode === 'shader_texture' ? '#153852' : '#0d131d',
                      color: paintSourceMode === 'shader_texture' ? '#9beeff' : '#8fa6c2',
                    }}
                  >
                    🎨 Paint Halo Shader Texture
                  </button>
                  <button
                    type="button"
                    data-testid="studio-paint-mode-color-btn"
                    onClick={() => setPaintSourceMode('solid_color')}
                    style={{
                      padding: '3px 8px',
                      fontSize: 10.5,
                      fontWeight: 700,
                      borderRadius: 4,
                      cursor: 'pointer',
                      border: paintSourceMode === 'solid_color' ? '1px solid #ff9f43' : '1px solid #2b3c54',
                      background: paintSourceMode === 'solid_color' ? '#3d2814' : '#0d131d',
                      color: paintSourceMode === 'solid_color' ? '#ffd29d' : '#8fa6c2',
                    }}
                  >
                    🖌️ Solid / Tint Color
                  </button>
                </div>

                {paintSourceMode === 'shader_texture' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: '#9bc2e8', fontWeight: 600 }}>Shader:</span>
                    <select
                      value={targetShaderTagId}
                      onChange={(e) => setTargetShaderTagId(Number(e.target.value))}
                      style={{
                        maxWidth: 210,
                        background: '#0d131d',
                        color: '#e2ecf7',
                        border: '1px solid #00e5ff',
                        borderRadius: 4,
                        padding: '2px 6px',
                        fontSize: 10.5,
                      }}
                    >
                      {shaderTags.map((sh) => (
                        <option key={sh.tagId} value={sh.tagId}>
                          {sh.path.split('\\').slice(-2).join('\\')} ({sh.primaryClassName})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#9bc2e8', fontWeight: 600 }}>Color:</span>
                    <input
                      type="color"
                      value={paintColor}
                      onChange={(e) => setPaintColor(e.target.value)}
                      style={{ width: 28, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    />
                  </label>
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: '#9bc2e8', fontWeight: 600 }}>Blend:</span>
                  <select
                    value={paintBlendMode}
                    onChange={(e) => setPaintBlendMode(e.target.value as GlobalCompositeOperation)}
                    style={{
                      background: '#0d131d',
                      color: '#e2ecf7',
                      border: '1px solid #2b3c54',
                      borderRadius: 4,
                      padding: '2px 5px',
                      fontSize: 10.5,
                    }}
                  >
                    <option value="source-over">Normal</option>
                    <option value="multiply">Multiply (Dirt/AO)</option>
                    <option value="screen">Screen (Add/Glow)</option>
                    <option value="overlay">Overlay (Detail)</option>
                  </select>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: '#9bc2e8', fontWeight: 600 }}>Size:</span>
                  <input
                    type="range"
                    min={2}
                    max={128}
                    value={paintBrushPx}
                    onChange={(e) => setPaintBrushPx(Number(e.target.value))}
                    style={{ width: 75 }}
                  />
                  <strong style={{ color: '#00e5ff' }}>{paintBrushPx}px</strong>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: '#9bc2e8', fontWeight: 600 }}>Opacity:</span>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={paintOpacity}
                    onChange={(e) => setPaintOpacity(Number(e.target.value))}
                    style={{ width: 65 }}
                  />
                  <strong style={{ color: '#00e5ff' }}>{Math.round(paintOpacity * 100)}%</strong>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: '#9bc2e8', fontWeight: 600 }}>Feather:</span>
                  <input
                    type="range"
                    min={0}
                    max={0.85}
                    step={0.05}
                    value={paintSoftness}
                    onChange={(e) => setPaintSoftness(Number(e.target.value))}
                    style={{ width: 60 }}
                  />
                  <strong style={{ color: '#00e5ff' }}>{Math.round(paintSoftness * 100)}%</strong>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Hierarchical Halo Asset Scene Outliner & Surface/Shader Inspector */}
        <div
          data-testid="studio-asset-outliner"
          style={{
            width: 325,
            background: '#111823',
            borderLeft: '1px solid #223046',
            padding: 10,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {/* Scene Outliner Hierarchy Tree */}
          <div
            style={{
              background: '#162030',
              border: '1px solid #25354d',
              borderRadius: 6,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, fontSize: 11, color: '#9bc2e8', textTransform: 'uppercase' }}>
                Halo Asset Hierarchy
              </span>
              <span style={{ fontSize: 10, color: '#64748b' }}>
                {studioMode === 'bsp' ? 'sbsp' : 'mod2'}
              </span>
            </div>

            {/* Root Asset Node */}
            <div style={{ fontSize: 11 }}>
              <div
                onClick={() => setExpandedNodes((p) => ({ ...p, root: !p.root }))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 6px',
                  background: '#1a2639',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#e2ecf7',
                }}
              >
                {expandedNodes.root ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Box size={13} color="#00e5ff" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentAssetName.split('\\').pop()}
                </span>
              </div>

              {expandedNodes.root && (
                <div style={{ paddingLeft: 12, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {/* Regions / Surfaces Branch */}
                  <div>
                    <div
                      onClick={() => setExpandedNodes((p) => ({ ...p, surfaces: !p.surfaces }))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '3px 6px',
                        cursor: 'pointer',
                        color: '#9bc2e8',
                        fontWeight: 600,
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {expandedNodes.surfaces ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <Layers size={12} />
                        {studioMode === 'bsp' ? 'Lightmap Surfaces' : 'Regions & Parts'} ({submeshSummaryList.length})
                      </span>
                    </div>

                    {expandedNodes.surfaces && (
                      <div
                        style={{
                          maxHeight: 195,
                          overflowY: 'auto',
                          paddingLeft: 12,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                        }}
                      >
                        {submeshSummaryList.map((s) => {
                          const isSel = s.submeshIndex === selectedSubmeshIdx;
                          const shortShader = s.shaderPath ? s.shaderPath.split('\\').pop() : 'unnamed';
                          return (
                            <div
                              key={s.submeshIndex}
                              onClick={() => {
                                setSelectedSubmeshIdx(s.submeshIndex);
                                if (s.shaderTagId) setTargetShaderTagId(s.shaderTagId);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '3px 6px',
                                borderRadius: 4,
                                cursor: 'pointer',
                                background: isSel ? '#153852' : 'transparent',
                                border: isSel ? '1px solid #00e5ff' : '1px solid transparent',
                                color: isSel ? '#ffffff' : '#b8cbe0',
                                fontSize: 10.5,
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                #{s.submeshIndex} {shortShader} ({s.triangleCount}t)
                              </span>
                              <button
                                type="button"
                                title={s.visible ? 'Hide surface' : 'Show surface'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSubmeshVisibility(s.submeshIndex);
                                }}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: s.visible ? '#9bc2e8' : '#475569',
                                  cursor: 'pointer',
                                  padding: 2,
                                  display: 'flex',
                                }}
                              >
                                {s.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Collision & Physics Branch */}
                  <div>
                    <div
                      onClick={() => setExpandedNodes((p) => ({ ...p, collision: !p.collision }))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '3px 6px',
                        cursor: 'pointer',
                        color: '#9bc2e8',
                        fontWeight: 600,
                      }}
                    >
                      {expandedNodes.collision ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <ShieldAlert size={12} color="#22c55e" />
                      <span>Collision &amp; Normals Sync</span>
                    </div>
                    {expandedNodes.collision && (
                      <div
                        style={{
                          padding: '4px 8px 4px 18px',
                          fontSize: 10.5,
                          color: '#94a3b8',
                          lineHeight: 1.4,
                        }}
                      >
                        {studioMode === 'bsp'
                          ? 'Auto-syncs CollisionBSP 3D vertices, surface planes, 2D BSP nodes, and outward Clockwise lightmap normals on Apply.'
                          : 'Auto-syncs outward Clockwise normals, tangent basis, and all LOD geometries (L0–L4) on Apply.'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Placed Look Objects in Live Terrain BSP Card (Right-Click Add Object -> Place -> Merge Look Objects into BSP) */}
          {studioMode === 'bsp' && (
            <div
              data-testid="studio-placed-bsp-objects-card"
              style={{
                background: '#132620',
                border: '1px solid #22c55e',
                borderRadius: 6,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 11, color: '#86efac', textTransform: 'uppercase' }}>
                  Placed Look Objects in BSP ({placedBspObjects.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const c = modelBoundsRef.current.center;
                    handleAddObjectToBspAtPoint(
                      floatingObjects[0] ?? 'ramp',
                      [Number(c.x.toFixed(2)), Number(c.y.toFixed(2)), Number(c.z.toFixed(2))],
                    );
                  }}
                  style={{
                    padding: '2px 7px',
                    fontSize: 10,
                    fontWeight: 700,
                    background: '#166534',
                    color: '#ecfdf5',
                    border: '1px solid #22c55e',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  + Add Object to Map
                </button>
              </div>

              <div style={{ fontSize: 10, color: '#a7f3d0', lineHeight: 1.35 }}>
                Right-click anywhere on the 3D BSP terrain to open <strong>Add Object to Map</strong> at that point, position it, then press <strong>Merge Look Objects into BSP</strong>.
              </div>

              {placedBspObjects.length > 0 && (
                <>
                  <select
                    value={selectedPlacedInstanceId}
                    onChange={(e) => setSelectedPlacedInstanceId(e.target.value)}
                    style={{
                      background: '#0d131d',
                      color: '#fff',
                      border: '1px solid #22c55e',
                      borderRadius: 4,
                      padding: '4px 6px',
                      fontSize: 11,
                    }}
                  >
                    {placedBspObjects.map((po, i) => (
                      <option key={po.instanceId} value={po.instanceId}>
                        #{i + 1} {po.name} @ ({po.position[0]}, {po.position[1]}, {po.position[2]})
                      </option>
                    ))}
                  </select>

                  {(() => {
                    const activePlaced = placedBspObjects.find((p) => p.instanceId === selectedPlacedInstanceId);
                    if (!activePlaced) return null;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10.5 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                          {(['X', 'Y', 'Z'] as const).map((ax, idx) => (
                            <label key={ax} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ color: '#9bc2e8' }}>Pos {ax}</span>
                              <input
                                type="number"
                                step={0.5}
                                value={activePlaced.position[idx]}
                                onChange={(e) => {
                                  const val = Number(e.target.value) || 0;
                                  setPlacedBspObjects((prev) =>
                                    prev.map((item) => {
                                      if (item.instanceId !== activePlaced.instanceId) return item;
                                      const nextPos = [...item.position] as [number, number, number];
                                      nextPos[idx] = val;
                                      return { ...item, position: nextPos };
                                    }),
                                  );
                                }}
                                style={{
                                  background: '#0d131d',
                                  color: '#fff',
                                  border: '1px solid #2b3c54',
                                  borderRadius: 3,
                                  padding: '2px 4px',
                                }}
                              />
                            </label>
                          ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                          {(['Yaw°', 'Pitch°', 'Roll°'] as const).map((ax, idx) => (
                            <label key={ax} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ color: '#9bc2e8' }}>{ax}</span>
                              <input
                                type="number"
                                step={15}
                                value={activePlaced.rotationDeg[idx]}
                                onChange={(e) => {
                                  const val = Number(e.target.value) || 0;
                                  setPlacedBspObjects((prev) =>
                                    prev.map((item) => {
                                      if (item.instanceId !== activePlaced.instanceId) return item;
                                      const nextRot = [...item.rotationDeg] as [number, number, number];
                                      nextRot[idx] = val;
                                      return { ...item, rotationDeg: nextRot };
                                    }),
                                  );
                                }}
                                style={{
                                  background: '#0d131d',
                                  color: '#fff',
                                  border: '1px solid #2b3c54',
                                  borderRadius: 3,
                                  padding: '2px 4px',
                                }}
                              />
                            </label>
                          ))}
                        </div>

                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (cameraRef.current && controlsRef.current) {
                                const [px, py, pz] = activePlaced.position;
                                controlsRef.current.target.set(px, py, pz);
                                cameraRef.current.position.set(px + 12, py - 12, pz + 9);
                                controlsRef.current.update();
                              }
                            }}
                            style={{
                              padding: '4px 6px',
                              fontSize: 10,
                              fontWeight: 600,
                              background: '#1e3a5f',
                              color: '#bae6fd',
                              border: '1px solid #38bdf8',
                              borderRadius: 4,
                              cursor: 'pointer',
                            }}
                          >
                            🔍 Focus in 3D
                          </button>
                          <button
                            type="button"
                            onClick={() => setMovePlacedOnTerrainClick((v) => !v)}
                            style={{
                              flex: 1,
                              padding: '4px 6px',
                              fontSize: 10,
                              fontWeight: 600,
                              background: movePlacedOnTerrainClick ? '#153852' : '#0d131d',
                              color: movePlacedOnTerrainClick ? '#00e5ff' : '#cbd5e1',
                              border: movePlacedOnTerrainClick ? '1px solid #00e5ff' : '1px solid #2b3c54',
                              borderRadius: 4,
                              cursor: 'pointer',
                            }}
                          >
                            {movePlacedOnTerrainClick ? '✓ Click Terrain to Move' : 'Click Terrain to Move'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPlacedBspObjects((prev) => prev.filter((p) => p.instanceId !== activePlaced.instanceId));
                            }}
                            style={{
                              padding: '4px 8px',
                              fontSize: 10,
                              background: '#3f1d24',
                              color: '#fecdd3',
                              border: '1px solid #f43f5e',
                              borderRadius: 4,
                              cursor: 'pointer',
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  <button
                    type="button"
                    data-testid="studio-sidebar-merge-look-objects-btn"
                    disabled={applying}
                    onClick={handleMergeLookObjectsIntoBsp}
                    style={{
                      padding: '6px 10px',
                      fontSize: 11,
                      fontWeight: 700,
                      background: '#16a34a',
                      color: '#ffffff',
                      border: '1px solid #4ade80',
                      borderRadius: 4,
                      cursor: applying ? 'wait' : 'pointer',
                    }}
                  >
                    🔨 Merge Look Objects into BSP
                  </button>
                </>
              )}
            </div>
          )}

          {/* Selected Surface Shader & Texture Inspector */}
          {selectedSubSummary && (
            <div
              style={{
                background: '#162030',
                border: '1px solid #25354d',
                borderRadius: 6,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 11, color: '#9bc2e8', textTransform: 'uppercase' }}>
                  Surface #{selectedSubSummary.submeshIndex} Material
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    data-testid="studio-auto-shader-all-btn"
                    onClick={() => void handleAutoShaderAllSurfaces()}
                    title="Auto-match Halo CE default shaders (Forerunner, Rock, Dirt, Grass, Concrete, Steel) across all surfaces"
                    style={{
                      padding: '2px 7px',
                      fontSize: 10,
                      fontWeight: 700,
                      background: '#14532d',
                      color: '#86efac',
                      border: '1px solid #22c55e',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    ✨ Auto-Shader All
                  </button>
                  {selectedSubSummary.shaderPath && onOpenTagEditor && (
                    <button
                      type="button"
                      onClick={() => onOpenTagEditor(selectedSubSummary.shaderPath!)}
                      style={{
                        padding: '2px 6px',
                        fontSize: 10,
                        background: '#1e293b',
                        color: '#38bdf8',
                        border: '1px solid #334155',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      Inspect Tag
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
                <span style={{ color: '#8fa6c2' }}>Assigned Shader (`shdr`) — Live Updates on Assign:</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  <select
                    data-testid="studio-shader-swap-select"
                    value={targetShaderTagId}
                    onChange={(e) => setTargetShaderTagId(Number(e.target.value))}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: '#0d131d',
                      color: '#e2ecf7',
                      border: '1px solid #2b3c54',
                      borderRadius: 4,
                      padding: '4px 6px',
                      fontSize: 11,
                    }}
                  >
                    {shaderTags.map((sh) => (
                      <option key={sh.tagId} value={sh.tagId}>
                        {sh.path} ({sh.primaryClassName})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid="studio-shader-assign-btn"
                    onClick={handleSwapSubmeshShader}
                    style={{
                      padding: '4px 9px',
                      fontSize: 11,
                      fontWeight: 600,
                      background: '#1e3a5f',
                      color: '#bae6fd',
                      border: '1px solid #38bdf8',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Assign
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Procedural Tunnel, Cave, Multi-Style Bridge & QuickForge World BSP Builder (when in 'create' mode) */}
          {studioMode === 'create' && (
            <div
              data-testid="studio-create-floating-card"
              style={{
                background: '#10231c',
                border: '1px solid #22c55e',
                borderRadius: 6,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 11, color: '#86efac', textTransform: 'uppercase' }}>
                  QuickForge World, Tunnel &amp; Bridge Builder
                </span>
              </div>

              {/* 4 Sub-Mode Generator Tabs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {(
                  [
                    { id: 'tunnel_network' as const, label: '🚇 Tunnels & Caves' },
                    { id: 'bridge_network' as const, label: '🌉 Multi-Style Bridges' },
                    { id: 'quickforge_world' as const, label: '🏔 Terrain, Nature & City' },
                    { id: 'primitive' as const, label: '🧱 Single Primitive' },
                  ]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setSelectedFloatingId('');
                      setCreateBuilderKind(tab.id);
                    }}
                    style={{
                      padding: '5px 6px',
                      fontSize: 10.5,
                      fontWeight: 700,
                      borderRadius: 4,
                      cursor: 'pointer',
                      background: createBuilderKind === tab.id && !selectedFloatingId ? '#15803d' : '#0d131d',
                      color: createBuilderKind === tab.id && !selectedFloatingId ? '#ffffff' : '#9bc2e8',
                      border:
                        createBuilderKind === tab.id && !selectedFloatingId
                          ? '1px solid #4ade80'
                          : '1px solid #2b3c54',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5 }}>
                <span style={{ color: '#a7f3d0' }}>Structure / Network Name:</span>
                <input
                  type="text"
                  value={primName}
                  onChange={(e) => setPrimName(e.target.value)}
                  style={{
                    background: '#0d131d',
                    color: '#fff',
                    border: '1px solid #2b3c54',
                    borderRadius: 4,
                    padding: '4px 6px',
                    fontSize: 11,
                  }}
                />
              </label>

              {/* TAB 1: TUNNEL + CAVE NETWORK GENERATOR */}
              {createBuilderKind === 'tunnel_network' && !selectedFloatingId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 10.5 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: '#a7f3d0' }}>Tunnel Architectural Style:</span>
                    <select
                      value={tunnelConfig.style}
                      onChange={(e) =>
                        setTunnelConfig((p) => ({ ...p, style: e.target.value as TunnelStyle }))
                      }
                      style={{
                        background: '#0d131d',
                        color: '#fff',
                        border: '1px solid #2b3c54',
                        borderRadius: 4,
                        padding: '4px 6px',
                        fontSize: 11,
                      }}
                    >
                      <option value="natural_cavern">Natural Rock Cavern &amp; Dirt Floor</option>
                      <option value="forerunner_conduit">Forerunner Angled Alloy Conduit &amp; Light Strips</option>
                      <option value="unsc_bunker">UNSC Concrete Bunker &amp; Reinforced Ceiling</option>
                    </select>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Total Paths (1–5): <strong>{tunnelConfig.pathCount}</strong></span>
                      <input
                        type="range"
                        min={1}
                        max={5}
                        step={1}
                        value={tunnelConfig.pathCount}
                        onChange={(e) =>
                          setTunnelConfig((p) => ({ ...p, pathCount: Math.max(1, Math.min(5, Number(e.target.value))) }))
                        }
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>World Distance (wu)</span>
                      <input
                        type="number"
                        min={20}
                        max={500}
                        step={5}
                        value={tunnelConfig.worldDistance}
                        onChange={(e) =>
                          setTunnelConfig((p) => ({
                            ...p,
                            worldDistance: Math.max(20, Math.min(500, Number(e.target.value) || 60)),
                          }))
                        }
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                  </div>

                  {/* Interconnecting Pathways (1-10) */}
                  <div
                    style={{
                      background: '#0d1714',
                      border: '1px solid #1e3a2f',
                      borderRadius: 4,
                      padding: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={tunnelConfig.interconnectEnabled}
                        onChange={(e) =>
                          setTunnelConfig((p) => ({ ...p, interconnectEnabled: e.target.checked }))
                        }
                      />
                      <span style={{ color: '#86efac' }}>
                        Interconnecting Cross-Pathways (1–10)
                      </span>
                    </label>
                    {tunnelConfig.interconnectEnabled && (
                      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span>Interconnect Count: <strong>{tunnelConfig.interconnectCount}</strong></span>
                        <input
                          type="range"
                          min={1}
                          max={10}
                          step={1}
                          value={tunnelConfig.interconnectCount}
                          onChange={(e) =>
                            setTunnelConfig((p) => ({
                              ...p,
                              interconnectCount: Math.max(1, Math.min(10, Number(e.target.value))),
                            }))
                          }
                          style={{ width: 120 }}
                        />
                      </label>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Width (wu)</span>
                      <input
                        type="number"
                        step={0.5}
                        value={tunnelConfig.tunnelWidth}
                        onChange={(e) =>
                          setTunnelConfig((p) => ({ ...p, tunnelWidth: Math.max(2, Number(e.target.value) || 5) }))
                        }
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Height (wu)</span>
                      <input
                        type="number"
                        step={0.5}
                        value={tunnelConfig.tunnelHeight}
                        onChange={(e) =>
                          setTunnelConfig((p) => ({ ...p, tunnelHeight: Math.max(2, Number(e.target.value) || 3.8) }))
                        }
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Path Gap</span>
                      <input
                        type="number"
                        step={2}
                        value={tunnelConfig.pathSpacing}
                        onChange={(e) =>
                          setTunnelConfig((p) => ({ ...p, pathSpacing: Math.max(6, Number(e.target.value) || 16) }))
                        }
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                  </div>

                  {/* Caves Within Tunnel System (1-10) with per-cave size controls */}
                  <div
                    style={{
                      background: '#0b141c',
                      border: '1px solid #25354d',
                      borderRadius: 5,
                      padding: 7,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, color: '#9bc2e8' }}>
                        ⛰ Caves in Tunnel System ({tunnelConfig.caves.length}/10)
                      </span>
                      <button
                        type="button"
                        disabled={tunnelConfig.caves.length >= 10}
                        onClick={() => {
                          setTunnelConfig((p) => {
                            if (p.caves.length >= 10) return p;
                            const nextIdx = p.caves.length + 1;
                            const newCave: TunnelCaveSpec = {
                              id: `cave_${Date.now()}_${nextIdx}`,
                              name: `Cavern #${nextIdx}`,
                              pathIndex: (nextIdx - 1) % Math.max(1, p.pathCount),
                              tPosition: Number((0.2 + ((nextIdx * 0.17) % 0.65)).toFixed(2)),
                              width: 15,
                              length: 16,
                              height: 7,
                              pillars: 2,
                            };
                            return { ...p, caves: [...p.caves, newCave] };
                          });
                        }}
                        style={{
                          padding: '2px 7px',
                          fontSize: 10,
                          fontWeight: 700,
                          background: '#166534',
                          color: '#ecfdf5',
                          border: '1px solid #22c55e',
                          borderRadius: 4,
                          cursor: tunnelConfig.caves.length >= 10 ? 'not-allowed' : 'pointer',
                        }}
                      >
                        + Add Cave
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 165, overflowY: 'auto' }}>
                      {tunnelConfig.caves.map((cave, cIdx) => (
                        <div
                          key={cave.id}
                          style={{
                            background: '#111c29',
                            border: '1px solid #1e293b',
                            borderRadius: 4,
                            padding: 5,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <strong style={{ color: '#bae6fd', fontSize: 10 }}>
                              #{cIdx + 1} {cave.name} (Path {Math.min(cave.pathIndex + 1, tunnelConfig.pathCount)})
                            </strong>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9.5 }}>
                                <input
                                  type="checkbox"
                                  checked={cave.pillars > 0}
                                  onChange={(e) =>
                                    setTunnelConfig((p) => ({
                                      ...p,
                                      caves: p.caves.map((c, i) =>
                                        i === cIdx ? { ...c, pillars: e.target.checked ? 2 : 0 } : c,
                                      ),
                                    }))
                                  }
                                />
                                Pillars
                              </label>
                              <button
                                type="button"
                                onClick={() =>
                                  setTunnelConfig((p) => ({
                                    ...p,
                                    caves: p.caves.filter((_, i) => i !== cIdx),
                                  }))
                                }
                                style={{
                                  padding: '1px 5px',
                                  fontSize: 9.5,
                                  background: '#3f1d24',
                                  color: '#fecdd3',
                                  border: '1px solid #f43f5e',
                                  borderRadius: 3,
                                  cursor: 'pointer',
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 3, fontSize: 9.5 }}>
                            <label style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>Width</span>
                              <input
                                type="number"
                                step={1}
                                value={cave.width}
                                onChange={(e) => {
                                  const val = Math.max(6, Math.min(65, Number(e.target.value) || 14));
                                  setTunnelConfig((p) => ({
                                    ...p,
                                    caves: p.caves.map((c, i) => (i === cIdx ? { ...c, width: val } : c)),
                                  }));
                                }}
                                style={{
                                  background: '#0d131d',
                                  color: '#fff',
                                  border: '1px solid #2b3c54',
                                  borderRadius: 3,
                                  padding: '2px 4px',
                                }}
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>Length</span>
                              <input
                                type="number"
                                step={1}
                                value={cave.length}
                                onChange={(e) => {
                                  const val = Math.max(6, Math.min(65, Number(e.target.value) || 16));
                                  setTunnelConfig((p) => ({
                                    ...p,
                                    caves: p.caves.map((c, i) => (i === cIdx ? { ...c, length: val } : c)),
                                  }));
                                }}
                                style={{
                                  background: '#0d131d',
                                  color: '#fff',
                                  border: '1px solid #2b3c54',
                                  borderRadius: 3,
                                  padding: '2px 4px',
                                }}
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>Height</span>
                              <input
                                type="number"
                                step={0.5}
                                value={cave.height}
                                onChange={(e) => {
                                  const val = Math.max(3, Math.min(35, Number(e.target.value) || 7));
                                  setTunnelConfig((p) => ({
                                    ...p,
                                    caves: p.caves.map((c, i) => (i === cIdx ? { ...c, height: val } : c)),
                                  }));
                                }}
                                style={{
                                  background: '#0d131d',
                                  color: '#fff',
                                  border: '1px solid #2b3c54',
                                  borderRadius: 3,
                                  padding: '2px 4px',
                                }}
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>Pos %</span>
                              <input
                                type="number"
                                min={10}
                                max={90}
                                step={5}
                                value={Math.round(cave.tPosition * 100)}
                                onChange={(e) => {
                                  const val = Math.max(0.1, Math.min(0.9, (Number(e.target.value) || 50) / 100));
                                  setTunnelConfig((p) => ({
                                    ...p,
                                    caves: p.caves.map((c, i) => (i === cIdx ? { ...c, tPosition: val } : c)),
                                  }));
                                }}
                                style={{
                                  background: '#0d131d',
                                  color: '#fff',
                                  border: '1px solid #2b3c54',
                                  borderRadius: 3,
                                  padding: '2px 4px',
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: MULTI-STYLE BRIDGE NETWORK GENERATOR */}
              {createBuilderKind === 'bridge_network' && !selectedFloatingId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 10.5 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: '#a7f3d0' }}>Bridge Structural &amp; Material Style:</span>
                    <select
                      value={bridgeConfig.style}
                      onChange={(e) =>
                        setBridgeConfig((p) => ({ ...p, style: e.target.value as BridgeStyle }))
                      }
                      style={{
                        background: '#0d131d',
                        color: '#fff',
                        border: '1px solid #2b3c54',
                        borderRadius: 4,
                        padding: '4px 6px',
                        fontSize: 11,
                      }}
                    >
                      <option value="forerunner_beam">Forerunner Energy Beam &amp; Angled Pylons</option>
                      <option value="suspension">Suspension Bridge (Twin Towers, Parabolic Main Cables &amp; Hangers)</option>
                      <option value="arch_under">Under-Deck Arch Bridge (Parabolic Rib &amp; Spandrel Columns)</option>
                      <option value="arch_suspension">Through-Arch Suspension Bridge (Overhead Arch &amp; Hanger Cables)</option>
                      <option value="natural_rocky">Natural Rocky Land Bridge (Craggy Canyon Stone &amp; Stalactite Keel)</option>
                      <option value="natural_dirt">Natural Dirt &amp; Grass Land Bridge (Sloped Earthen Banks)</option>
                    </select>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Total Bridges (1–5): <strong>{bridgeConfig.bridgeCount}</strong></span>
                      <input
                        type="range"
                        min={1}
                        max={5}
                        step={1}
                        value={bridgeConfig.bridgeCount}
                        onChange={(e) =>
                          setBridgeConfig((p) => ({
                            ...p,
                            bridgeCount: Math.max(1, Math.min(5, Number(e.target.value))),
                          }))
                        }
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>World Distance (wu)</span>
                      <input
                        type="number"
                        min={20}
                        max={500}
                        step={5}
                        value={bridgeConfig.worldDistance}
                        onChange={(e) =>
                          setBridgeConfig((p) => ({
                            ...p,
                            worldDistance: Math.max(20, Math.min(500, Number(e.target.value) || 72)),
                          }))
                        }
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                  </div>

                  {/* Interconnecting Cross-Walkways (1-10) */}
                  <div
                    style={{
                      background: '#0d1714',
                      border: '1px solid #1e3a2f',
                      borderRadius: 4,
                      padding: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={bridgeConfig.interconnectEnabled}
                        onChange={(e) =>
                          setBridgeConfig((p) => ({ ...p, interconnectEnabled: e.target.checked }))
                        }
                      />
                      <span style={{ color: '#86efac' }}>
                        Interconnecting Cross-Bridges (1–10)
                      </span>
                    </label>
                    {bridgeConfig.interconnectEnabled && (
                      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span>Interconnect Count: <strong>{bridgeConfig.interconnectCount}</strong></span>
                        <input
                          type="range"
                          min={1}
                          max={10}
                          step={1}
                          value={bridgeConfig.interconnectCount}
                          onChange={(e) =>
                            setBridgeConfig((p) => ({
                              ...p,
                              interconnectCount: Math.max(1, Math.min(10, Number(e.target.value))),
                            }))
                          }
                          style={{ width: 120 }}
                        />
                      </label>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Deck Width</span>
                      <input
                        type="number"
                        step={0.5}
                        value={bridgeConfig.bridgeWidth}
                        onChange={(e) =>
                          setBridgeConfig((p) => ({ ...p, bridgeWidth: Math.max(2, Number(e.target.value) || 5.6) }))
                        }
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Arch / Tower Z</span>
                      <input
                        type="number"
                        step={1}
                        value={bridgeConfig.archHeight}
                        onChange={(e) =>
                          setBridgeConfig((p) => ({ ...p, archHeight: Math.max(2, Number(e.target.value) || 11) }))
                        }
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Railing Z</span>
                      <input
                        type="number"
                        step={0.1}
                        value={bridgeConfig.railingHeight}
                        onChange={(e) =>
                          setBridgeConfig((p) => ({ ...p, railingHeight: Math.max(0, Number(e.target.value) || 0.85) }))
                        }
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* TAB 3: QUICKFORGE TERRAIN, NATURE, FORERUNNER & CITY BUILDER */}
              {createBuilderKind === 'quickforge_world' && !selectedFloatingId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 10.5 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: '#a7f3d0' }}>Halo CE Terrain Biome Preset:</span>
                    <select
                      value={qfBiome}
                      onChange={(e) => {
                        const biome = e.target.value as TerrainBiomePreset;
                        setQfBiome(biome);
                        setQfTerrain((prev) =>
                          createPresetTerrainGrid(biome, prev.sizeX, prev.sizeY, prev.steps),
                        );
                      }}
                      style={{
                        background: '#0d131d',
                        color: '#fff',
                        border: '1px solid #2b3c54',
                        borderRadius: 4,
                        padding: '4px 6px',
                        fontSize: 11,
                      }}
                    >
                      <option value="bloodgulch_canyon">Blood Gulch Canyon Basin (Sand &amp; Canyon Walls)</option>
                      <option value="timberland_ridge">Timberland Alpine Ridge (Pine Grass &amp; Hills)</option>
                      <option value="icefields_glacier">Ice Fields Glacier Valley (Snow &amp; Ice Shelf)</option>
                      <option value="deathisland_mesa">Death Island Elevated Mesa (Coastal Cliff Plateau)</option>
                      <option value="flat_forge_canvas">Flat QuickForge Sandbox Canvas</option>
                    </select>
                  </label>

                  {/* 1-Click Terrain Sculpting Operations */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                    {(
                      [
                        { op: 'raise' as TerrainSculptOperation, label: '⛰ +Raise Hill' },
                        { op: 'lower' as TerrainSculptOperation, label: '🕳 -Lower Basin' },
                        { op: 'hills' as TerrainSculptOperation, label: '〰 Rolling Hills' },
                        { op: 'canyon' as TerrainSculptOperation, label: '🏞 Canyon Trench' },
                        { op: 'crater' as TerrainSculptOperation, label: '☄ Impact Crater' },
                        { op: 'smooth' as TerrainSculptOperation, label: '≈ Smooth Terrain' },
                      ]
                    ).map((btn) => (
                      <button
                        key={btn.op}
                        type="button"
                        onClick={() =>
                          setQfTerrain((prev) =>
                            sculptTerrainGrid(prev, btn.op, 0.5, 0.5, 0.35, 3.2),
                          )
                        }
                        style={{
                          padding: '4px 5px',
                          fontSize: 9.5,
                          fontWeight: 600,
                          background: '#162234',
                          color: '#bae6fd',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>

                  {/* Quick-Add Nature & Forerunner BSP Pieces */}
                  <div
                    style={{
                      background: '#0b141c',
                      border: '1px solid #25354d',
                      borderRadius: 5,
                      padding: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontWeight: 700, color: '#9bc2e8', fontSize: 10 }}>
                      + Add Nature &amp; Forerunner BSP Assets ({qfPieces.length})
                    </span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                      {(
                        [
                          { kind: 'natural_arch' as WorldPieceKind, label: '+ Rock Arch', size: [14, 5, 8.5] as [number, number, number] },
                          { kind: 'boulder_cluster' as WorldPieceKind, label: '+ Boulder Cluster', size: [8, 8, 5] as [number, number, number] },
                          { kind: 'cliff_spire' as WorldPieceKind, label: '+ Cliff Spire', size: [7, 7, 15] as [number, number, number] },
                          { kind: 'natural_ramp' as WorldPieceKind, label: '+ Dirt/Rock Ramp', size: [10, 6, 4] as [number, number, number] },
                          { kind: 'forerunner_tower' as WorldPieceKind, label: '+ Forerunner Tower', size: [7, 7, 14] as [number, number, number] },
                          { kind: 'forerunner_bunker' as WorldPieceKind, label: '+ Forerunner Bunker', size: [9, 9, 4.2] as [number, number, number] },
                          { kind: 'forerunner_octagonal_room' as WorldPieceKind, label: '+ Octagonal Base', size: [14, 14, 5.5] as [number, number, number] },
                          { kind: 'forerunner_energy_core' as WorldPieceKind, label: '+ Energy Core Pylon', size: [6, 6, 10] as [number, number, number] },
                        ]
                      ).map((asset) => (
                        <button
                          key={asset.kind}
                          type="button"
                          onClick={() => {
                            const idx = qfPieces.length + 1;
                            const angle = idx * 1.15;
                            const rad = 12 + (idx % 3) * 10;
                            setQfPieces((prev) => [
                              ...prev,
                              {
                                id: `piece_${Date.now()}_${idx}`,
                                kind: asset.kind,
                                name: `${asset.label.replace('+ ', '')} #${idx}`,
                                position: [
                                  Number((Math.cos(angle) * rad).toFixed(1)),
                                  Number((Math.sin(angle) * rad).toFixed(1)),
                                  0,
                                ],
                                yawDeg: (idx * 30) % 360,
                                size: asset.size,
                              },
                            ]);
                          }}
                          style={{
                            padding: '3px 5px',
                            fontSize: 9.5,
                            textAlign: 'left',
                            background: '#111c29',
                            color: '#e2ecf7',
                            border: '1px solid #2b3c54',
                            borderRadius: 3,
                            cursor: 'pointer',
                          }}
                        >
                          {asset.label}
                        </button>
                      ))}
                    </div>

                    {qfPieces.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 95, overflowY: 'auto', marginTop: 2 }}>
                        {qfPieces.map((pc, pIdx) => (
                          <div
                            key={pc.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1.3fr 0.6fr 0.6fr 0.6fr auto',
                              gap: 3,
                              alignItems: 'center',
                              fontSize: 9.5,
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#bae6fd' }}>
                              {pc.name}
                            </span>
                            {(['X', 'Y', 'Z'] as const).map((ax, aIdx) => (
                              <input
                                key={ax}
                                type="number"
                                step={2}
                                title={`Pos ${ax}`}
                                value={pc.position[aIdx]}
                                onChange={(e) => {
                                  const v = Number(e.target.value) || 0;
                                  setQfPieces((prev) =>
                                    prev.map((item, i) => {
                                      if (i !== pIdx) return item;
                                      const nextPos = [...item.position] as [number, number, number];
                                      nextPos[aIdx] = v;
                                      return { ...item, position: nextPos };
                                    }),
                                  );
                                }}
                                style={{
                                  background: '#0d131d',
                                  color: '#fff',
                                  border: '1px solid #2b3c54',
                                  borderRadius: 3,
                                  padding: '1px 3px',
                                  width: '100%',
                                  boxSizing: 'border-box',
                                }}
                              />
                            ))}
                            <button
                              type="button"
                              onClick={() => setQfPieces((prev) => prev.filter((_, i) => i !== pIdx))}
                              style={{
                                padding: '1px 5px',
                                fontSize: 9,
                                background: '#3f1d24',
                                color: '#fecdd3',
                                border: '1px solid #f43f5e',
                                borderRadius: 3,
                                cursor: 'pointer',
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Procedural Human City / Street Grid Generator */}
                  <div
                    style={{
                      background: '#0d1714',
                      border: '1px solid #1e3a2f',
                      borderRadius: 5,
                      padding: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={qfCity.enabled}
                        onChange={(e) => setQfCity((p) => ({ ...p, enabled: e.target.checked }))}
                      />
                      <span style={{ color: '#86efac' }}>
                        🏙 Generate Human City / New Mombasa Street Grid
                      </span>
                    </label>
                    {qfCity.enabled && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, fontSize: 9.5 }}>
                          <label style={{ display: 'flex', flexDirection: 'column' }}>
                            <span>Blocks X (1–5)</span>
                            <input
                              type="number"
                              min={1}
                              max={5}
                              value={qfCity.blocksX}
                              onChange={(e) =>
                                setQfCity((p) => ({ ...p, blocksX: Math.max(1, Math.min(5, Number(e.target.value) || 2)) }))
                              }
                              style={{
                                background: '#0d131d',
                                color: '#fff',
                                border: '1px solid #2b3c54',
                                borderRadius: 3,
                                padding: '2px 4px',
                              }}
                            />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column' }}>
                            <span>Blocks Y (1–5)</span>
                            <input
                              type="number"
                              min={1}
                              max={5}
                              value={qfCity.blocksY}
                              onChange={(e) =>
                                setQfCity((p) => ({ ...p, blocksY: Math.max(1, Math.min(5, Number(e.target.value) || 2)) }))
                              }
                              style={{
                                background: '#0d131d',
                                color: '#fff',
                                border: '1px solid #2b3c54',
                                borderRadius: 3,
                                padding: '2px 4px',
                              }}
                            />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column' }}>
                            <span>Max Tower Z</span>
                            <input
                              type="number"
                              min={5}
                              max={45}
                              value={qfCity.buildingMaxHeight}
                              onChange={(e) =>
                                setQfCity((p) => ({
                                  ...p,
                                  buildingMaxHeight: Math.max(5, Math.min(45, Number(e.target.value) || 16)),
                                }))
                              }
                              style={{
                                background: '#0d131d',
                                color: '#fff',
                                border: '1px solid #2b3c54',
                                borderRadius: 3,
                                padding: '2px 4px',
                              }}
                            />
                          </label>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 9.5 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <input
                              type="checkbox"
                              checked={qfCity.includeAccessibleInteriors}
                              onChange={(e) => setQfCity((p) => ({ ...p, includeAccessibleInteriors: e.target.checked }))}
                            />
                            Ground Interiors
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <input
                              type="checkbox"
                              checked={qfCity.includeHighwayOverpass}
                              onChange={(e) => setQfCity((p) => ({ ...p, includeHighwayOverpass: e.target.checked }))}
                            />
                            Highway Overpass
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <input
                              type="checkbox"
                              checked={qfCity.includeStreetBarricades}
                              onChange={(e) => setQfCity((p) => ({ ...p, includeStreetBarricades: e.target.checked }))}
                            />
                            Street Barricades
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: SINGLE PARAMETRIC PRIMITIVE */}
              {(createBuilderKind === 'primitive' || Boolean(selectedFloatingId)) && (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5 }}>
                    <span style={{ color: '#a7f3d0' }}>Base Component Shape:</span>
                    <select
                      value={primKind}
                      onChange={(e) => {
                        setPrimKind(e.target.value as ParametricPrimitiveKind);
                        setSelectedFloatingId('');
                      }}
                      style={{
                        background: '#0d131d',
                        color: '#fff',
                        border: '1px solid #2b3c54',
                        borderRadius: 4,
                        padding: '4px 6px',
                        fontSize: 11,
                      }}
                    >
                      <option value="ramp">Sloped Vehicle / Infantry Ramp</option>
                      <option value="platform">Elevated Platform / Bridge</option>
                      <option value="bunker">Tapered Bunker / Cover Block</option>
                      <option value="pillar">Octagonal / Cylindrical Pillar</option>
                      <option value="arch">Archway / Tunnel Segment</option>
                    </select>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, fontSize: 10.5 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Width (X)</span>
                      <input
                        type="number"
                        step={0.5}
                        value={primWidth}
                        onChange={(e) => setPrimWidth(Math.max(0.2, Number(e.target.value) || 4))}
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Depth (Y)</span>
                      <input
                        type="number"
                        step={0.5}
                        value={primDepth}
                        onChange={(e) => setPrimDepth(Math.max(0.2, Number(e.target.value) || 4))}
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>Height (Z)</span>
                      <input
                        type="number"
                        step={0.5}
                        value={primHeight}
                        onChange={(e) => setPrimHeight(Math.max(0.2, Number(e.target.value) || 2))}
                        style={{
                          background: '#0d131d',
                          color: '#fff',
                          border: '1px solid #2b3c54',
                          borderRadius: 4,
                          padding: '3px 5px',
                        }}
                      />
                    </label>
                  </div>
                </>
              )}

              {/* Halo Default Auto-Shader Role Mapping & 3-Sphere Spartan Clearance Status */}
              {worldActiveRoles.length > 0 && !selectedFloatingId && (
                <div
                  style={{
                    background: '#0b141c',
                    border: '1px solid #25354d',
                    borderRadius: 5,
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    fontSize: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, color: '#9bc2e8' }}>
                      🎨 Halo Default Shaders ({worldActiveRoles.length} Roles)
                    </span>
                    <button
                      type="button"
                      onClick={() => setWorldShaderOverrides({})}
                      style={{
                        padding: '1px 6px',
                        fontSize: 9.5,
                        background: '#14532d',
                        color: '#86efac',
                        border: '1px solid #22c55e',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      ✨ Auto-Match Defaults
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 105, overflowY: 'auto' }}>
                    {worldActiveRoles.map((role, rIdx) => {
                      const curSub = submeshesRef.current[rIdx];
                      const selectedTagId =
                        worldShaderOverrides[role] ?? curSub?.shaderTagId ?? shaderTags[0]?.tagId ?? -1;
                      return (
                        <div
                          key={role}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '0.95fr 1.25fr',
                            gap: 4,
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {HALO_DEFAULT_SHADER_CATALOG.find((c) => c.role === role)?.label ?? role}
                          </span>
                          <select
                            value={selectedTagId}
                            onChange={(e) => {
                              const nextId = Number(e.target.value);
                              setWorldShaderOverrides((p) => ({ ...p, [role]: nextId }));
                              void assignShaderToSubmeshLive(rIdx, nextId);
                            }}
                            style={{
                              background: '#0d131d',
                              color: '#e2ecf7',
                              border: '1px solid #2b3c54',
                              borderRadius: 3,
                              padding: '2px 4px',
                              fontSize: 9.5,
                              minWidth: 0,
                            }}
                          >
                            {shaderTags.map((sh) => (
                              <option key={sh.tagId} value={sh.tagId}>
                                {sh.path.split('\\').slice(-2).join('\\')} ({sh.primaryClassName})
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {worldClearanceSummary && !selectedFloatingId && (
                <div
                  style={{
                    background: '#0d1915',
                    border: '1px solid #1e3a2f',
                    borderRadius: 4,
                    padding: '4px 7px',
                    fontSize: 9.5,
                    color: '#a7f3d0',
                    lineHeight: 1.35,
                  }}
                >
                  <div>
                    <strong>🛡 3-Sphere Spartan Route Clearance:</strong>{' '}
                    {worldClearanceSummary.passedCount}/{worldClearanceSummary.totalCount} pathways verified clear
                  </div>
                  <div style={{ color: '#8fa6c2' }}>{worldClearanceSummary.notes}</div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 }}>
                {createBuilderKind !== 'primitive' && !selectedFloatingId && (
                  <button
                    type="button"
                    data-testid="studio-inject-procedural-world-bsp-btn"
                    disabled={applying}
                    onClick={() => void handleInjectGeneratedWorldDirectlyIntoBsp()}
                    style={{
                      padding: '7px 8px',
                      fontSize: 11,
                      fontWeight: 700,
                      background: '#0284c7',
                      color: '#ffffff',
                      border: '1px solid #38bdf8',
                      borderRadius: 4,
                      cursor: applying ? 'wait' : 'pointer',
                    }}
                  >
                    🚀 Inject Directly Into Map Structure BSP (With Compiled 3D Collision)
                  </button>
                )}
                <button
                  type="button"
                  data-testid="studio-place-component-in-bsp-btn"
                  onClick={handlePlaceCurrentComponentIntoBspEditor}
                  style={{
                    padding: '6px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    background: '#16a34a',
                    color: '#ffffff',
                    border: '1px solid #4ade80',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  ➕ Select &amp; Place in 3D BSP Editor
                </button>
                <button
                  type="button"
                  data-testid="studio-save-item-as-map-object-btn"
                  onClick={handlePublishFloatingObjectForPainting}
                  style={{
                    padding: '6px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    background: '#1e3a5f',
                    color: '#bae6fd',
                    border: '1px solid #00e5ff',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  💾 Save as Map Object (For Live BSP Right-Click)
                </button>
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.75fr 0.75fr', gap: 4 }}>
                  <button
                    type="button"
                    disabled={applying}
                    onClick={handleMergeFloatingObjectIntoMap}
                    style={{
                      padding: '6px 6px',
                      fontSize: 10,
                      fontWeight: 700,
                      background: '#166534',
                      color: '#ecfdf5',
                      border: '1px solid #22c55e',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    🏗 Compile Scenery + Collision
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportGeneratedWorldFile('jms')}
                    style={{
                      padding: '6px 4px',
                      fontSize: 10,
                      fontWeight: 600,
                      background: '#1e293b',
                      color: '#38bdf8',
                      border: '1px solid #334155',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    📤 .JMS
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportGeneratedWorldFile('obj')}
                    style={{
                      padding: '6px 4px',
                      fontSize: 10,
                      fontWeight: 600,
                      background: '#1e293b',
                      color: '#bae6fd',
                      border: '1px solid #334155',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    📤 .OBJ
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Parametric 2D Sketch-on-Plane / Face -> 3D Feature Modeler (available in all modes) */}
          <div
            data-testid="studio-inventor-sketch-card"
            style={{
              background: '#161f2e',
              border: '1px solid #ff9f43',
              borderRadius: 6,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, fontSize: 11, color: '#ffd29d', textTransform: 'uppercase' }}>
                📐 Parametric 2D Sketch &amp; 3D Feature Modeler
              </span>
              <span style={{ fontSize: 9.5, color: '#94a3b8' }}>{sketchFaceBasis.label}</span>
            </div>

            {/* 2D Sketch Mode <-> 3D Feature Mode Switcher directly in the 3D Edit World */}
            <button
              type="button"
              data-testid="studio-toggle-2d-sketch-in-3d-btn"
              onClick={() => {
                if (is2dSketchMode) {
                  finish2dSketchTo3dMode();
                } else {
                  enter2dSketchIn3dWorld();
                }
              }}
              style={{
                padding: '6px 8px',
                fontSize: 11,
                fontWeight: 700,
                background: is2dSketchMode ? '#16a34a' : '#153852',
                color: '#ffffff',
                border: is2dSketchMode ? '1px solid #4ade80' : '1px solid #00e5ff',
                borderRadius: 4,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {is2dSketchMode
                ? '✓ Finish 2D Sketch → Switch to 3D (Extrude / Revolve / Cut)'
                : '📐 Start 2D Sketch Mode in 3D Edit World'}
            </button>

            {/* Work Plane Selector: XY, XZ, YZ, or Pick 3D Face */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {(
                [
                  { id: 'xy' as const, label: 'XY Ground' },
                  { id: 'xz' as const, label: 'XZ Front' },
                  { id: 'yz' as const, label: 'YZ Side' },
                  { id: 'face' as const, label: sketchPickFaceActive ? '🎯 Click Face...' : '🎯 Pick 3D Face' },
                ]
              ).map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  data-testid={`studio-sketch-plane-${pl.id}-btn`}
                  onClick={() => handleSelectSketchPlanePreset(pl.id)}
                  style={{
                    padding: '4px 4px',
                    fontSize: 10,
                    fontWeight: 600,
                    borderRadius: 4,
                    cursor: 'pointer',
                    border: sketchPlanePreset === pl.id ? '1px solid #ff9f43' : '1px solid #2b3c54',
                    background: sketchPlanePreset === pl.id ? '#3d2814' : '#0d131d',
                    color: sketchPlanePreset === pl.id ? '#ffd29d' : '#94a3b8',
                  }}
                >
                  {pl.label}
                </button>
              ))}
            </div>

            {/* 2D Sketch Profile Shape Presets */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3 }}>
              {(
                [
                  { id: 'polyline' as const, label: 'Polyline' },
                  { id: 'rect' as const, label: 'Rect' },
                  { id: 'circle' as const, label: 'Circle' },
                  { id: 'polygon' as const, label: 'Hex' },
                  { id: 'l_bracket' as const, label: 'L-Shape' },
                ]
              ).map((sh) => (
                <button
                  key={sh.id}
                  type="button"
                  data-testid={`studio-sketch-shape-${sh.id}-btn`}
                  onClick={() => handleApplySketchShapePreset(sh.id)}
                  style={{
                    padding: '3px 4px',
                    fontSize: 9.5,
                    fontWeight: 600,
                    borderRadius: 3,
                    cursor: 'pointer',
                    border: sketchShapeKind === sh.id ? '1px solid #00e5ff' : '1px solid #2b3c54',
                    background: sketchShapeKind === sh.id ? '#153852' : '#0d131d',
                    color: sketchShapeKind === sh.id ? '#9beeff' : '#94a3b8',
                  }}
                >
                  {sh.label}
                </button>
              ))}
            </div>

            {/* Interactive 2D Sketch Pad SVG (synced live with the 3D Work Plane in the 3D Viewport) */}
            <div
              style={{
                background: '#0a0f18',
                border: '1px solid #25354d',
                borderRadius: 4,
                padding: 4,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <svg
                data-testid="studio-inventor-sketch-svg"
                width={260}
                height={150}
                viewBox="-3.2 -2.0 6.4 4.0"
                style={{ cursor: 'crosshair', background: '#070b12', borderRadius: 3, width: '100%' }}
                onClick={(e) => {
                  const svg = e.currentTarget;
                  const rect = svg.getBoundingClientRect();
                  const nx = (e.clientX - rect.left) / Math.max(1, rect.width);
                  const ny = (e.clientY - rect.top) / Math.max(1, rect.height);
                  const u = Number(((nx * 6.4 - 3.2)).toFixed(2));
                  const v = Number((((1 - ny) * 4.0 - 2.0)).toFixed(2));
                  setSketchShapeKind('polyline');
                  setSketchPoints((prev) => [...prev, [u, v]]);
                }}
              >
                {/* Grid lines */}
                {[-3, -2, -1, 0, 1, 2, 3].map((gx) => (
                  <line
                    key={`gx-${gx}`}
                    x1={gx}
                    y1={-2}
                    x2={gx}
                    y2={2}
                    stroke={gx === 0 ? '#334155' : '#162030'}
                    strokeWidth={gx === 0 ? 0.04 : 0.02}
                  />
                ))}
                {[-2, -1, 0, 1, 2].map((gy) => (
                  <line
                    key={`gy-${gy}`}
                    x1={-3.2}
                    y1={gy}
                    x2={3.2}
                    y2={gy}
                    stroke={gy === 0 ? '#334155' : '#162030'}
                    strokeWidth={gy === 0 ? 0.04 : 0.02}
                  />
                ))}
                {/* Closed polygon preview */}
                {sketchPoints.length >= 2 && (
                  <polygon
                    points={sketchPoints.map(([u, v]) => `${u},${-v}`).join(' ')}
                    fill="rgba(0, 229, 255, 0.16)"
                    stroke="#00e5ff"
                    strokeWidth={0.06}
                  />
                )}
                {/* Vertices */}
                {sketchPoints.map(([u, v], idx) => (
                  <circle
                    key={`sk-pt-${idx}`}
                    cx={u}
                    cy={-v}
                    r={0.12}
                    fill={idx === 0 ? '#ff9f43' : '#00e5ff'}
                  />
                ))}
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 9.5, color: '#94a3b8' }}>
                <span>Click 3D work plane or 2D pad ({sketchPoints.length} pts)</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSketchPoints((prev) => prev.slice(0, -1))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#38bdf8',
                      cursor: 'pointer',
                      fontSize: 9.5,
                      padding: 0,
                    }}
                  >
                    Undo Pt
                  </button>
                  <button
                    type="button"
                    onClick={() => setSketchPoints([])}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#fca5a5',
                      cursor: 'pointer',
                      fontSize: 9.5,
                      padding: 0,
                    }}
                  >
                    ClearPts
                  </button>
                </div>
              </div>
            </div>

            {/* Extrude Depth & Taper Controls */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 10.5 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Extrude Depth (wu)</span>
                <input
                  type="number"
                  step={0.25}
                  value={sketchExtrudeDepth}
                  onChange={(e) => setSketchExtrudeDepth(Number(e.target.value) || 1.0)}
                  style={{
                    background: '#0d131d',
                    color: '#fff',
                    border: '1px solid #2b3c54',
                    borderRadius: 4,
                    padding: '3px 5px',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Draft / Taper (-0.8..+1)</span>
                <input
                  type="number"
                  step={0.1}
                  value={sketchTaperFactor}
                  onChange={(e) => setSketchTaperFactor(Number(e.target.value) || 0)}
                  style={{
                    background: '#0d131d',
                    color: '#fff',
                    border: '1px solid #2b3c54',
                    borderRadius: 4,
                    padding: '3px 5px',
                  }}
                />
              </label>
            </div>

            {/* 3D Feature Operations: +Extrude Boss, -Extrude Cut, New Solid, 360° Revolve */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              <button
                type="button"
                data-testid="studio-inventor-extrude-join-btn"
                onClick={() => handleInventorExtrudeSketch('join')}
                style={{
                  padding: '5px 6px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  background: '#143d2b',
                  color: '#86efac',
                  border: '1px solid #22c55e',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                ➕ Extrude Boss (Join)
              </button>
              <button
                type="button"
                data-testid="studio-inventor-extrude-cut-btn"
                onClick={() => handleInventorExtrudeSketch('cut')}
                style={{
                  padding: '5px 6px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  background: '#3f1d24',
                  color: '#fecdd3',
                  border: '1px solid #f43f5e',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                ➖ Extrude Cut (Carve)
              </button>
              <button
                type="button"
                data-testid="studio-inventor-extrude-new-btn"
                onClick={() => handleInventorExtrudeSketch('new')}
                style={{
                  padding: '5px 6px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#153852',
                  color: '#9beeff',
                  border: '1px solid #00e5ff',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                ✨ Extrude New Solid
              </button>
              <button
                type="button"
                data-testid="studio-inventor-revolve-btn"
                onClick={handleInventorRevolveSketch}
                style={{
                  padding: '5px 6px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#3d2814',
                  color: '#ffd29d',
                  border: '1px solid #ff9f43',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                🔄 Revolve 360° Lathe
              </button>
            </div>

            {studioMode !== 'bsp' && (
              <button
                type="button"
                onClick={handlePlaceCurrentComponentIntoBspEditor}
                style={{
                  padding: '5px 8px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  background: '#166534',
                  color: '#ecfdf5',
                  border: '1px solid #22c55e',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                ➕ Add Extruded Solid to 3D BSP Editor
              </button>
            )}
          </div>

          {/* Topology & Whole-Mesh Transform Panel */}
          <div
            style={{
              background: '#162030',
              border: '1px solid #25354d',
              borderRadius: 6,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, fontSize: 11, color: '#ff9f43', textTransform: 'uppercase' }}>
                Mesh Topology &amp; Transform
              </span>
              <Sparkles size={13} color="#ff9f43" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              <button
                type="button"
                onClick={handleSmoothSelectedOrSurface}
                title="Smooth and relax jagged vertices across welded seams without shrinking"
                style={{
                  padding: '5px 6px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#12384f',
                  color: '#9beeff',
                  border: '1px solid #00e5ff',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Smooth Surface
              </button>
              <button
                type="button"
                onClick={handleDeleteSelectedFaces}
                title="Delete / collapse selected blocking faces or portal doorway walls"
                style={{
                  padding: '5px 6px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#3f1d24',
                  color: '#fecdd3',
                  border: '1px solid #f43f5e',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Delete Sel Faces
              </button>
              <button
                type="button"
                onClick={handleSubdivideSelectedFaces}
                style={{
                  padding: '5px 6px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#153852',
                  color: '#9beeff',
                  border: '1px solid #00e5ff',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Split / Subdivide
              </button>
              <button
                type="button"
                onClick={() => handleExtrudeSelectedAlongNormals(1)}
                style={{
                  padding: '5px 6px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#3d2814',
                  color: '#ffd29d',
                  border: '1px solid #ff9f43',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Extrude Normals
              </button>
              <button
                type="button"
                onClick={handleSnapVerticesToGrid}
                style={{
                  padding: '5px 6px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#1e293b',
                  color: '#e2e8f0',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Snap to Grid
              </button>
              <button
                type="button"
                onClick={handleWeldVerticesByDistance}
                style={{
                  padding: '5px 6px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#143d2b',
                  color: '#86efac',
                  border: '1px solid #22c55e',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Snap-Join Seams
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 11, marginTop: 2 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Scale X</span>
                <input
                  type="number"
                  step={0.1}
                  value={scaleX}
                  onChange={(e) => setScaleX(Number(e.target.value) || 1)}
                  style={{
                    background: '#0d131d',
                    color: '#fff',
                    border: '1px solid #2b3c54',
                    borderRadius: 4,
                    padding: '3px 5px',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Scale Y</span>
                <input
                  type="number"
                  step={0.1}
                  value={scaleY}
                  onChange={(e) => setScaleY(Number(e.target.value) || 1)}
                  style={{
                    background: '#0d131d',
                    color: '#fff',
                    border: '1px solid #2b3c54',
                    borderRadius: 4,
                    padding: '3px 5px',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Scale Z</span>
                <input
                  type="number"
                  step={0.1}
                  value={scaleZ}
                  onChange={(e) => setScaleZ(Number(e.target.value) || 1)}
                  style={{
                    background: '#0d131d',
                    color: '#fff',
                    border: '1px solid #2b3c54',
                    borderRadius: 4,
                    padding: '3px 5px',
                  }}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={handleApplyMeshScale}
              style={{
                padding: '5px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: '#3d2814',
                color: '#ffd29d',
                border: '1px solid #ff9f43',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Apply Scale to Geometry
            </button>
          </div>

          {/* Milestone 21: Level / BSP Diagnostics, Material Flags & Lightmap AO Baker */}
          <div
            data-testid="studio-milestone21-diagnostics-card"
            style={{
              background: '#141923',
              border: '1px solid #2b3c54',
              borderRadius: 6,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 11, color: '#38bdf8', textTransform: 'uppercase' }}>
              BSP / Mesh Diagnostics & Lightmap AO Baker
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={handleRunBspDiagnostics}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#1e3a5f',
                  color: '#bae6fd',
                  border: '1px solid #38bdf8',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Scan Sealed Manifold & Edges
              </button>
              <button
                type="button"
                onClick={handleBakeVertexAo}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#14332a',
                  color: '#86efac',
                  border: '1px solid #22c55e',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Bake Lightmap AO ({Math.round(aoIntensity * 100)}%)
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#94a3b8' }}>
              <span>AO Strength:</span>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={aoIntensity}
                onChange={(e) => setAoIntensity(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span>{Math.round(aoIntensity * 100)}%</span>
            </div>
            {bspDiagSummary && (
              <div
                style={{
                  fontSize: 10.5,
                  color: '#cbd5e1',
                  background: '#0d131d',
                  border: '1px solid #1e293b',
                  borderRadius: 4,
                  padding: '6px 8px',
                  lineHeight: 1.45,
                }}
              >
                <div>
                  Vertices: <strong>{bspDiagSummary.totalVerts.toLocaleString()}</strong> | Triangles:{' '}
                  <strong>{bspDiagSummary.totalTris.toLocaleString()}</strong>
                </div>
                <div style={{ color: bspDiagSummary.openEdges === 0 ? '#4ade80' : '#fbbf24' }}>
                  Open / Boundary Edges: <strong>{bspDiagSummary.openEdges}</strong> | Degenerate Faces:{' '}
                  <strong>{bspDiagSummary.degenerateTris}</strong>
                </div>
                {bspDiagSummary.integrity && (
                  <div style={{ color: bspDiagSummary.integrity.isWaterTightManifold ? '#4ade80' : '#fda4af', marginTop: 2 }}>
                    Non-Manifold: <strong>{bspDiagSummary.integrity.nonManifoldEdges}</strong> | Winding Conflicts:{' '}
                    <strong>{bspDiagSummary.integrity.windingConflicts}</strong> | T-Junctions:{' '}
                    <strong>{bspDiagSummary.integrity.tJunctionEdges}</strong> | Dup Faces:{' '}
                    <strong>{bspDiagSummary.integrity.duplicateFaces}</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Milestone 22: Interactive 3D Vehicle Physics (phys) Mass Sphere & Antigrav Editor */}
          {studioMode === 'model' && (
            <div
              data-testid="studio-milestone22-phys-card"
              style={{
                background: '#141923',
                border: '1px solid #38bdf8',
                borderRadius: 6,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 11, color: '#7dd3fc', textTransform: 'uppercase' }}>
                3D Vehicle Physics (phys) Mass Spheres & Inertia Tensor
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 10.5 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Vehicle Mass (kg)</span>
                  <input
                    type="number"
                    step={50}
                    value={physTotalMass}
                    onChange={(e) => setPhysTotalMass(Math.max(10, Number(e.target.value) || 1000))}
                    style={{
                      background: '#0d131d',
                      color: '#fff',
                      border: '1px solid #2b3c54',
                      borderRadius: 4,
                      padding: '3px 5px',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Antigrav / Suspension Scale</span>
                  <input
                    type="number"
                    step={0.1}
                    value={physHoverStrength}
                    onChange={(e) => setPhysHoverStrength(Math.max(0, Number(e.target.value) || 1))}
                    style={{
                      background: '#0d131d',
                      color: '#fff',
                      border: '1px solid #2b3c54',
                      borderRadius: 4,
                      padding: '3px 5px',
                    }}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 110, overflowY: 'auto' }}>
                {physMassPoints.map((mp, idx) => (
                  <div
                    key={`${mp.name}-${idx}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.3fr 0.7fr 0.7fr',
                      gap: 4,
                      alignItems: 'center',
                      fontSize: 10,
                      color: '#cbd5e1',
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mp.name}
                    </span>
                    <input
                      type="number"
                      step={0.05}
                      title="Mass Sphere Radius (wu)"
                      value={mp.radius}
                      onChange={(e) => {
                        const r = Math.max(0.05, Number(e.target.value) || 0.25);
                        setPhysMassPoints((prev) => prev.map((p, i) => (i === idx ? { ...p, radius: r } : p)));
                      }}
                      style={{
                        background: '#0d131d',
                        color: '#fff',
                        border: '1px solid #2b3c54',
                        borderRadius: 3,
                        padding: '2px 4px',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                    <input
                      type="number"
                      step={0.1}
                      title="Relative Mass Weight"
                      value={mp.relativeMass}
                      onChange={(e) => {
                        const rm = Math.max(0.1, Number(e.target.value) || 1);
                        setPhysMassPoints((prev) => prev.map((p, i) => (i === idx ? { ...p, relativeMass: rm } : p)));
                      }}
                      style={{
                        background: '#0d131d',
                        color: '#fff',
                        border: '1px solid #2b3c54',
                        borderRadius: 3,
                        padding: '2px 4px',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleTogglePhysSpheresInViewport}
                style={{
                  padding: '5px 8px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: '#1e3a5f',
                  color: '#bae6fd',
                  border: '1px solid #38bdf8',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Preview 3D Mass Spheres & Compute M / M⁻¹ Tensor
              </button>
              {physTensorStatus && (
                <div style={{ fontSize: 9.5, color: '#86efac', fontFamily: 'monospace', lineHeight: 1.35 }}>
                  {physTensorStatus}
                </div>
              )}

              {/* Coupled Dimensional Physics & Collision Resizer (Guilty Spark s^1 / s^3 / s^5 / s^-5 law) */}
              <div
                style={{
                  marginTop: 4,
                  paddingTop: 7,
                  borderTop: '1px solid #1e293b',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 10.5, color: '#38bdf8' }}>
                  ⚖️ Coupled Model, Collision &amp; Physics Resizer (s¹, s³, s⁵, s⁻⁵)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5 }}>
                  <span>Scale Factor:</span>
                  <input
                    type="range"
                    min={0.2}
                    max={4.0}
                    step={0.05}
                    value={coupledScaleFactor}
                    onChange={(e) => setCoupledScaleFactor(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    min={0.1}
                    max={5.0}
                    step={0.05}
                    value={coupledScaleFactor}
                    onChange={(e) => setCoupledScaleFactor(Math.max(0.1, Math.min(5.0, Number(e.target.value) || 1)))}
                    style={{
                      width: 52,
                      background: '#0d131d',
                      color: '#fff',
                      border: '1px solid #2b3c54',
                      borderRadius: 3,
                      padding: '2px 4px',
                      fontSize: 10.5,
                    }}
                  />
                </div>
                <button
                  type="button"
                  data-testid="studio-coupled-physics-scale-btn"
                  disabled={applying}
                  onClick={() => void handleCoupledScaleAssetPhysics()}
                  style={{
                    padding: '6px 8px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    background: '#166534',
                    color: '#ecfdf5',
                    border: '1px solid #22c55e',
                    borderRadius: 4,
                    cursor: applying ? 'wait' : 'pointer',
                  }}
                >
                  🚀 Scale GBXModel + Collision + Physics + Suspensions ({coupledScaleFactor.toFixed(2)}x)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default BspModelStudioPanel;

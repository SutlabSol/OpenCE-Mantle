import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type {
  MapHeaderSummary,
  BspRenderMesh,
  ScenarioPlacementsSummary,
  ScenarioObjectPlacement,
  ScenarioObjectKind,
  ModelRenderGeometry,
} from '../../../electron/shared-types';

export type RenderMode = 'textured' | 'textured-wireframe' | 'wireframe' | 'flat';
export type GizmoMode = 'translate' | 'rotate';

export interface VisibleLayers {
  bsp: boolean;
  vehicles: boolean;
  scenery: boolean;
  spawns: boolean;
  items: boolean;
  encounters: boolean;
  firingPositions: boolean;
  triggerVolumes: boolean;
  cutsceneCameras: boolean;
  netgameFlags: boolean;
}

export interface ScenarioViewportProps {
  header: MapHeaderSummary;
  bspIndex?: number;
}

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

/**
 * Local-space Oriented Bounding Box (OBB) helper that stays aligned with the object's
 * local coordinate frame as it is rotated, instead of expanding into a global world-axis AABB.
 */
class LocalBoxHelper extends THREE.LineSegments {
  private targetObject: THREE.Object3D;

  constructor(object: THREE.Object3D, color = 0x39ff14) {
    const indices = new Uint16Array([
      0, 1, 1, 2, 2, 3, 3, 0,
      4, 5, 5, 6, 6, 7, 7, 4,
      0, 4, 1, 5, 2, 6, 3, 7,
    ]);
    const positions = new Float32Array(8 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color,
      toneMapped: false,
    });

    super(geometry, material);
    this.targetObject = object;
    this.type = 'LocalBoxHelper';
    this.matrixAutoUpdate = false;
    this.update();
  }

  update(): void {
    this.targetObject.updateWorldMatrix(true, true);
    const invTargetWorld = new THREE.Matrix4().copy(this.targetObject.matrixWorld).invert();
    const localBox = new THREE.Box3();
    const childBox = new THREE.Box3();
    const relMatrix = new THREE.Matrix4();

    this.targetObject.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        if (!child.geometry.boundingBox) {
          child.geometry.computeBoundingBox();
        }
        if (child.geometry.boundingBox && !child.geometry.boundingBox.isEmpty()) {
          childBox.copy(child.geometry.boundingBox);
          relMatrix.multiplyMatrices(invTargetWorld, child.matrixWorld);
          childBox.applyMatrix4(relMatrix);
          localBox.union(childBox);
        }
      }
    });

    if (localBox.isEmpty()) {
      localBox.min.set(-0.5, -0.5, 0);
      localBox.max.set(0.5, 0.5, 1.0);
    }

    const min = localBox.min;
    const max = localBox.max;
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    // 8 local-space box corners
    arr[0] = max.x; arr[1] = max.y; arr[2] = max.z;
    arr[3] = min.x; arr[4] = max.y; arr[5] = max.z;
    arr[6] = min.x; arr[7] = min.y; arr[8] = max.z;
    arr[9] = max.x; arr[10] = min.y; arr[11] = max.z;
    arr[12] = max.x; arr[13] = max.y; arr[14] = min.z;
    arr[15] = min.x; arr[16] = max.y; arr[17] = min.z;
    arr[18] = min.x; arr[19] = min.y; arr[20] = min.z;
    arr[21] = max.x; arr[22] = min.y; arr[23] = min.z;

    posAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();

    // Transform the local box by the object's full world matrix so it rotates with the object
    this.matrix.copy(this.targetObject.matrixWorld);
    this.matrixWorld.copy(this.targetObject.matrixWorld);
  }

  dispose(): void {
    this.geometry.dispose();
    if (Array.isArray(this.material)) {
      this.material.forEach((m) => m.dispose());
    } else {
      this.material.dispose();
    }
  }
}

export default function ScenarioViewport({ header, bspIndex = 0 }: ScenarioViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [scenarioData, setScenarioData] = useState<ScenarioPlacementsSummary | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<VisibleLayers>({
    bsp: true,
    vehicles: true,
    scenery: true,
    spawns: true,
    items: true,
    encounters: true,
    firingPositions: true,
    triggerVolumes: true,
    cutsceneCameras: true,
    netgameFlags: true,
  });
  const [renderMode, setRenderMode] = useState<RenderMode>('textured');
  const [cameraSpeed, setCameraSpeed] = useState<number>(60);
  const [cameraPosDisplay, setCameraPosDisplay] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const [webGLSupported] = useState<boolean>(() => isWebGLAvailable());

  // Multi-BSP Simultaneous Rendering State
  const [visibleBspIndices, setVisibleBspIndices] = useState<number[]>([bspIndex]);
  const [bspMeshes, setBspMeshes] = useState<Record<number, BspRenderMesh>>({});
  const [bspDropdownOpen, setBspDropdownOpen] = useState<boolean>(false);
  const bspDropdownRef = useRef<HTMLDivElement | null>(null);
  const bspChildGroupsRef = useRef<Map<number, THREE.Group>>(new Map());

  const primaryMesh = bspMeshes[visibleBspIndices[0]] || Object.values(bspMeshes)[0] || null;
  const bspCount = primaryMesh?.bspCount ?? 1;
  const bspNames = primaryMesh?.bspNames ?? [];

  const totalVertices = useMemo(() => {
    return visibleBspIndices.reduce((sum, idx) => sum + (bspMeshes[idx]?.totalVertices || 0), 0);
  }, [visibleBspIndices, bspMeshes]);

  const totalTriangles = useMemo(() => {
    return visibleBspIndices.reduce((sum, idx) => sum + (bspMeshes[idx]?.totalTriangles || 0), 0);
  }, [visibleBspIndices, bspMeshes]);

  const totalSubmeshes = useMemo(() => {
    return visibleBspIndices.reduce((sum, idx) => sum + (bspMeshes[idx]?.submeshes.length || 0), 0);
  }, [visibleBspIndices, bspMeshes]);

  const combinedBounds = useMemo<[number, number, number, number, number, number] | undefined>(() => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let found = false;
    for (const idx of visibleBspIndices) {
      const b = bspMeshes[idx]?.worldBounds;
      if (b) {
        minX = Math.min(minX, b[0]);
        minY = Math.min(minY, b[1]);
        minZ = Math.min(minZ, b[2]);
        maxX = Math.max(maxX, b[3]);
        maxY = Math.max(maxY, b[4]);
        maxZ = Math.max(maxZ, b[5]);
        found = true;
      }
    }
    return found ? [minX, minY, minZ, maxX, maxY, maxZ] : primaryMesh?.worldBounds;
  }, [visibleBspIndices, bspMeshes, primaryMesh]);

  useEffect(() => {
    setVisibleBspIndices([bspIndex]);
  }, [bspIndex]);

  useEffect(() => {
    if (!bspDropdownOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (bspDropdownRef.current && !bspDropdownRef.current.contains(e.target as Node)) {
        setBspDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [bspDropdownOpen]);

  // Editing & Selection State (Step 9)
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const selectedObjectId = selectedObjectIds[selectedObjectIds.length - 1] || null;
  const setSelectedObjectId = useCallback((id: string | null) => {
    setSelectedObjectIds(id ? [id] : []);
  }, []);
  const selectedObjectIdsRef = useRef<string[]>([]);
  selectedObjectIdsRef.current = selectedObjectIds;
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'outliner'>('properties');
  const [outlinerFilter, setOutlinerFilter] = useState<'all' | ScenarioObjectKind>('all');
  const [outlinerSearch, setOutlinerSearch] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [addKind, setAddKind] = useState<
    | ScenarioObjectKind
    | 'teleporter'
    | 'teleport'
    | 'teleport_2way'
    | 'koth'
    | 'race'
    | 'oddball'
    | 'ctf_flag'
    | 'ctf_flag_item'
  >('vehicle');
  const [addNetgameSubtype, setAddNetgameSubtype] = useState<
    'spawn' | 'ctf_flag' | 'ctf_flag_item' | 'koth' | 'oddball' | 'race'
  >('spawn');
  const [addTeleporterSubtype, setAddTeleporterSubtype] = useState<'teleport' | 'teleport_2way'>('teleport');
  const [addPaletteIndex, setAddPaletteIndex] = useState<number>(0);
  const [addTeam, setAddTeam] = useState<number>(0);
  const [viewportContextMenu, setViewportContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Swap State
  const [swapKind, setSwapKind] = useState<ScenarioObjectKind>('vehicle');
  const [swapPaletteIndex, setSwapPaletteIndex] = useState<number>(0);

  // Mutable refs for Three.js engine and fly camera animation loop
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const haloRootRef = useRef<THREE.Group | null>(null);
  const layerGroupsRef = useRef<{
    bsp: THREE.Group;
    vehicles: THREE.Group;
    scenery: THREE.Group;
    spawns: THREE.Group;
    items: THREE.Group;
    encounters: THREE.Group;
    firingPositions: THREE.Group;
    triggerVolumes: THREE.Group;
    cutsceneCameras: THREE.Group;
    netgameFlags: THREE.Group;
  } | null>(null);
  const submeshMeshesRef = useRef<{ mesh: THREE.Mesh; lines: THREE.LineSegments; solidMat: THREE.MeshStandardMaterial; bspIndex?: number }[]>([]);
  const objectMeshesRef = useRef<{ mesh: THREE.Mesh; lines?: THREE.LineSegments; solidMat: THREE.MeshStandardMaterial; shaderTagId?: number }[]>([]);
  const textureCacheRef = useRef<Map<number, Promise<THREE.Texture | null>>>(new Map());
  const modelCacheRef = useRef<Map<number, Promise<ModelRenderGeometry | null>>>(new Map());

  // Gizmo & selection refs
  const transformControlsRef = useRef<TransformControls | null>(null);
  const selectionBoxHelperRef = useRef<LocalBoxHelper | null>(null);
  const gizmoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const partnerBoxHelperRef = useRef<LocalBoxHelper | null>(null);
  const kothZoneHelpersRef = useRef<LocalBoxHelper[]>([]);
  const multiSelectionHelpersRef = useRef<LocalBoxHelper[]>([]);
  const isTransformDraggingRef = useRef<boolean>(false);
  const dragStartPositionsRef = useRef<Map<string, { pos: THREE.Vector3; rot: THREE.Euler }>>(new Map());
  const pointerDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Camera fly controls state
  const camPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 10, 30));
  const camEulerRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: -0.2 });
  const keysDownRef = useRef<Set<string>>(new Set());
  const isRightMouseDownRef = useRef<boolean>(false);
  const speedRef = useRef<number>(cameraSpeed);
  speedRef.current = cameraSpeed;

  const hasInitialFramedRef = useRef<boolean>(false);
  const isLeftPanDraggingRef = useRef<boolean>(false);
  const isMiddleDraggingRef = useRef<boolean>(false);
  const isCtrlMiddleOrbitRef = useRef<boolean>(false);
  const isShiftLeftRotateRef = useRef<boolean>(false);
  const isShiftRightRotateRef = useRef<boolean>(false);
  const isShiftMiddleRotateRef = useRef<boolean>(false);
  const dragHasMovedRef = useRef<boolean>(false);
  const customDragStartRef = useRef<{ pos: [number, number, number]; rot: [number, number, number] } | null>(null);
  const selectedObjectIdRef = useRef<string | null>(selectedObjectId);
  selectedObjectIdRef.current = selectedObjectId;

  // Clipboard & Undo history stack for 3D viewport object editing (Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+Z)
  const clipboardObjectRef = useRef<{
    kind: ScenarioObjectKind;
    paletteIndex: number;
    position: [number, number, number];
    rotation: [number, number, number];
    teamIndex?: number;
    wasCut?: boolean;
  } | null>(null);

  type ViewportUndoEntry =
    | {
        type: 'transform';
        items: Array<{
          id: string;
          prevPos: [number, number, number];
          prevRot: [number, number, number];
        }>;
      }
    | {
        type: 'add';
        ids: string[];
      }
    | {
        type: 'delete';
        objects: Array<{
          kind: ScenarioObjectKind;
          paletteIndex: number;
          position: [number, number, number];
          rotation: [number, number, number];
          teamIndex?: number;
        }>;
      };
  const undoStackRef = useRef<ViewportUndoEntry[]>([]);

  const selectedPlacement = useMemo(() => {
    if (!selectedObjectId || !scenarioData) return null;
    return scenarioData.objects.find((o) => o.id === selectedObjectId) || null;
  }, [selectedObjectId, scenarioData]);

  // Frame scene (center camera on world bounds)
  const frameScene = useCallback((bounds?: [number, number, number, number, number, number]) => {
    const b = bounds || combinedBounds;
    if (!b || !cameraRef.current) return;

    const [minX, minY, minZ, maxX, maxY, maxZ] = b;
    // Map Halo coordinates to Three.js coordinates under haloRoot (rx = -PI/2):
    const cx = (minX + maxX) / 2;
    const cy = (minZ + maxZ) / 2;
    const cz = -(minY + maxY) / 2;

    const spanX = Math.abs(maxX - minX);
    const spanY = Math.abs(maxZ - minZ);
    const spanZ = Math.abs(maxY - minY);
    const maxSpan = Math.max(spanX, spanY, spanZ, 40);

    const dist = maxSpan * 0.75;
    const eyeY = cy + maxSpan * 0.45;
    const eyeZ = cz + dist;
    const eyeX = cx + dist * 0.3;

    camPosRef.current.set(eyeX, eyeY, eyeZ);

    const dx = cx - eyeX;
    const dy = cy - eyeY;
    const dz = cz - eyeZ;
    const horizDist = Math.sqrt(dx * dx + dz * dz);

    camEulerRef.current.yaw = Math.atan2(-dx, -dz);
    camEulerRef.current.pitch = Math.atan2(dy, horizDist);

    const speed = Math.max(20, Math.min(350, Math.round(maxSpan * 0.4)));
    setCameraSpeed(speed);
  }, [combinedBounds]);

  // Orientation gizmo alignment: rotates camera to orthogonal or isometric view and frames BSPs
  const alignCameraView = useCallback((dir: 'x' | '-x' | 'y' | '-y' | 'z' | '-z' | 'iso') => {
    const b = combinedBounds;
    if (!b || !cameraRef.current) return;
    const [minX, minY, minZ, maxX, maxY, maxZ] = b;
    const cx = (minX + maxX) / 2;
    const cy = (minZ + maxZ) / 2;
    const cz = -(minY + maxY) / 2;
    const spanX = Math.abs(maxX - minX);
    const spanY = Math.abs(maxZ - minZ);
    const spanZ = Math.abs(maxY - minY);
    const maxSpan = Math.max(spanX, spanY, spanZ, 40);
    const dist = maxSpan * 0.95;

    let eyeX = cx;
    let eyeY = cy;
    let eyeZ = cz;

    switch (dir) {
      case 'x': // Look from Front (+X in Halo: Three.js World +X) towards center
        eyeX = cx + dist;
        break;
      case '-x': // Look from Back (-X in Halo: Three.js World -X) towards center
        eyeX = cx - dist;
        break;
      case 'y': // Look from Left (+Y in Halo: Three.js World -Z) towards center
        eyeZ = cz - dist;
        break;
      case '-y': // Look from Right (-Y in Halo: Three.js World +Z) towards center
        eyeZ = cz + dist;
        break;
      case 'z': // Look from Top (+Z in Halo: Three.js World +Y) towards center
        eyeY = cy + dist;
        break;
      case '-z': // Look from Bottom (-Z in Halo: Three.js World -Y) towards center
        eyeY = cy - dist;
        break;
      case 'iso':
      default:
        eyeX = cx + dist * 0.65;
        eyeY = cy + dist * 0.55;
        eyeZ = cz + dist * 0.65;
        break;
    }

    const dx = cx - eyeX;
    const dy = cy - eyeY;
    const dz = cz - eyeZ;
    const horizDist = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    const pitch = horizDist === 0 ? (dy < 0 ? -Math.PI / 2 + 0.001 : Math.PI / 2 - 0.001) : Math.atan2(dy, horizDist);

    camPosRef.current.set(eyeX, eyeY, eyeZ);
    camEulerRef.current.yaw = yaw;
    camEulerRef.current.pitch = pitch;
    if (cameraRef.current) {
      cameraRef.current.position.set(eyeX, eyeY, eyeZ);
      const lookTarget = new THREE.Vector3().copy(camPosRef.current).add(
        new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)),
      );
      cameraRef.current.lookAt(lookTarget);
    }
  }, [combinedBounds]);

  // Focus camera on an object
  const focusOnObject = useCallback((placementId: string) => {
    if (!scenarioData || !cameraRef.current) return;
    const placement = scenarioData.objects.find((o) => o.id === placementId);
    if (!placement) return;
    const [hx, hy, hz] = placement.position;
    // Halo to Three.js world space:
    const wx = hx;
    const wy = hz;
    const wz = -hy;

    camPosRef.current.set(wx - 8, wy + 5, wz + 8);
    const dx = wx - (wx - 8);
    const dy = wy - (wy + 5);
    const dz = wz - (wz + 8);
    const horiz = Math.hypot(dx, dz);
    camEulerRef.current.yaw = Math.atan2(-dx, -dz);
    camEulerRef.current.pitch = Math.atan2(dy, horiz);
  }, [scenarioData]);

  // Mutation Actions
  const handleUpdatePlacement = useCallback(
    async (
      placementId: string,
      updates: {
        position?: [number, number, number];
        rotation?: [number, number, number];
        paletteIndex?: number;
        teamIndex?: number;
        multiplayerSpawnFlags?: number;
        forceSpawn?: boolean;
      },
    ) => {
      try {
        const currentObj = scenarioData?.objects.find((o) => o.id === placementId);
        // If this is a teleporter with a co-located partner (Two-Way Teleporter Node), keep them stuck together
        let colocatedId: string | null = null;
        if (currentObj && currentObj.kind === 'netgame_flag' && (currentObj.paletteIndex === 6 || currentObj.paletteIndex === 7)) {
          const colocated = (scenarioData?.objects || []).find(
            (o) =>
              o.id !== placementId &&
              o.kind === 'netgame_flag' &&
              (o.paletteIndex === 6 || o.paletteIndex === 7) &&
              Math.hypot(o.position[0] - currentObj.position[0], o.position[1] - currentObj.position[1], o.position[2] - currentObj.position[2]) < 0.25,
          );
          if (colocated) colocatedId = colocated.id;
        }

        let res = await window.opence.updateScenarioPlacement(placementId, updates);
        if (colocatedId && updates.position) {
          const partnerUpdates = { ...updates };
          res = await window.opence.updateScenarioPlacement(colocatedId, partnerUpdates);
        }

        if (res && res.ok) {
          setScenarioData(res.summary);
        }
      } catch (err) {
        console.error('Failed to update scenario placement:', err);
      }
    },
    [scenarioData],
  );

  const handleDuplicatePlacement = useCallback(
    async (placementId: string) => {
      try {
        const res = await window.opence.duplicateScenarioPlacement(placementId);
        if (res && res.ok) {
          undoStackRef.current.push({ type: 'add', ids: [res.newPlacement.id] });
          setScenarioData(res.summary);
          setSelectedObjectId(res.newPlacement.id);
        }
      } catch (err) {
        console.error('Failed to duplicate scenario placement:', err);
      }
    },
    [],
  );

  const handleDeletePlacement = useCallback(
    async (placementId: string, options?: { skipUndo?: boolean }) => {
      try {
        const idsToDelete =
          selectedObjectIdsRef.current.includes(placementId) && selectedObjectIdsRef.current.length > 1
            ? [...selectedObjectIdsRef.current]
            : [placementId];

        // Also include any co-located teleporter nodes (2-way teleporter nodes) or paired flags
        const expandedIds = new Set<string>(idsToDelete);
        for (const id of idsToDelete) {
          const obj = scenarioData?.objects.find((o) => o.id === id);
          if (obj && obj.kind === 'netgame_flag' && (obj.paletteIndex === 6 || obj.paletteIndex === 7)) {
            // Co-located node partner
            const colocated = scenarioData?.objects.find(
              (o) =>
                o.id !== id &&
                o.kind === 'netgame_flag' &&
                (o.paletteIndex === 6 || o.paletteIndex === 7) &&
                Math.hypot(o.position[0] - obj.position[0], o.position[1] - obj.position[1], o.position[2] - obj.position[2]) < 0.25,
            );
            if (colocated) expandedIds.add(colocated.id);

            // Paired destination/origin
            const partnerType = obj.paletteIndex === 6 ? 7 : 6;
            const partner = scenarioData?.objects.find(
              (o) => o.kind === 'netgame_flag' && o.paletteIndex === partnerType && o.teamIndex === obj.teamIndex,
            );
            if (partner) expandedIds.add(partner.id);
          }
        }

        if (!options?.skipUndo && scenarioData) {
          const deletedObjs = Array.from(expandedIds)
            .map((id) => scenarioData.objects.find((o) => o.id === id))
            .filter((o): o is NonNullable<typeof o> => !!o)
            .map((o) => ({
              kind: o.kind,
              paletteIndex: o.paletteIndex,
              position: [...o.position] as [number, number, number],
              rotation: [...o.rotation] as [number, number, number],
              teamIndex: o.teamIndex,
            }));
          if (deletedObjs.length > 0) {
            undoStackRef.current.push({ type: 'delete', objects: deletedObjs });
          }
        }

        // Sort descending by index so deleting from the array doesn't disrupt earlier element indices
        const sortedIds = Array.from(expandedIds).sort((a, b) => {
          const ai = parseInt(a.split('-')[1], 10);
          const bi = parseInt(b.split('-')[1], 10);
          return bi - ai;
        });

        let finalSummary = scenarioData;
        for (const id of sortedIds) {
          const res = await window.opence.deleteScenarioPlacement(id);
          if (res && res.ok) {
            finalSummary = res.summary;
          }
        }

        if (finalSummary) {
          setScenarioData(finalSummary);
        }
        setSelectedObjectIds([]);
      } catch (err) {
        console.error('Failed to delete scenario placement:', err);
      }
    },
    [scenarioData],
  );

  const handleCopyPlacement = useCallback(() => {
    const id = selectedObjectIdRef.current;
    if (!id || !scenarioData) return;
    const obj = scenarioData.objects.find((o) => o.id === id);
    if (!obj) return;
    clipboardObjectRef.current = {
      kind: obj.kind,
      paletteIndex: obj.paletteIndex,
      position: [...obj.position] as [number, number, number],
      rotation: [...obj.rotation] as [number, number, number],
      teamIndex: obj.teamIndex,
      wasCut: false,
    };
  }, [scenarioData]);

  const handleCutPlacement = useCallback(async () => {
    const id = selectedObjectIdRef.current;
    if (!id || !scenarioData) return;
    const obj = scenarioData.objects.find((o) => o.id === id);
    if (!obj) return;
    clipboardObjectRef.current = {
      kind: obj.kind,
      paletteIndex: obj.paletteIndex,
      position: [...obj.position] as [number, number, number],
      rotation: [...obj.rotation] as [number, number, number],
      teamIndex: obj.teamIndex,
      wasCut: true,
    };
    await handleDeletePlacement(id);
  }, [scenarioData, handleDeletePlacement]);

  const handlePastePlacement = useCallback(async () => {
    const clip = clipboardObjectRef.current;
    if (!clip) return;
    try {
      const pastePos: [number, number, number] = clip.wasCut
        ? [...clip.position]
        : [clip.position[0] + 1.5, clip.position[1] + 1.5, clip.position[2]];
      const res = await window.opence.addScenarioPlacement(
        clip.kind,
        clip.paletteIndex,
        pastePos,
        clip.rotation,
        clip.teamIndex,
      );
      if (res && res.ok) {
        clip.position = pastePos;
        clip.wasCut = false;
        undoStackRef.current.push({ type: 'add', ids: [res.newPlacement.id] });
        setScenarioData(res.summary);
        setSelectedObjectId(res.newPlacement.id);
      }
    } catch (err) {
      console.error('Failed to paste scenario placement:', err);
    }
  }, []);

  const handleUndo = useCallback(async () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    try {
      if (entry.type === 'transform') {
        for (const item of entry.items) {
          const allGroups = [
            ...(layerGroupsRef.current?.vehicles.children || []),
            ...(layerGroupsRef.current?.scenery.children || []),
            ...(layerGroupsRef.current?.spawns.children || []),
            ...(layerGroupsRef.current?.items.children || []),
            ...(layerGroupsRef.current?.encounters.children || []),
            ...(layerGroupsRef.current?.firingPositions.children || []),
            ...(layerGroupsRef.current?.triggerVolumes.children || []),
            ...(layerGroupsRef.current?.cutsceneCameras.children || []),
            ...(layerGroupsRef.current?.netgameFlags.children || []),
          ];
          const grp = allGroups.find((g) => g.userData?.id === item.id);
          if (grp) {
            grp.position.set(item.prevPos[0], item.prevPos[1], item.prevPos[2]);
            grp.rotation.set(item.prevRot[2], -item.prevRot[1], item.prevRot[0], 'ZYX');
          }
          await handleUpdatePlacement(item.id, {
            position: item.prevPos,
            rotation: item.prevRot,
          });
        }
        selectionBoxHelperRef.current?.update();
      } else if (entry.type === 'add') {
        const sortedIds = [...entry.ids].sort((a, b) => {
          const ai = parseInt(a.split('-')[1], 10);
          const bi = parseInt(b.split('-')[1], 10);
          return bi - ai;
        });
        let finalSummary = scenarioData;
        for (const id of sortedIds) {
          const res = await window.opence.deleteScenarioPlacement(id);
          if (res && res.ok) {
            finalSummary = res.summary;
          }
        }
        if (finalSummary) {
          setScenarioData(finalSummary);
        }
        setSelectedObjectIds([]);
      } else if (entry.type === 'delete') {
        let finalSummary = scenarioData;
        let lastCreatedId: string | null = null;
        for (const obj of entry.objects) {
          const res = await window.opence.addScenarioPlacement(
            obj.kind,
            obj.paletteIndex,
            obj.position,
            obj.rotation,
            obj.teamIndex,
          );
          if (res && res.ok) {
            finalSummary = res.summary;
            lastCreatedId = res.newPlacement.id;
          }
        }
        if (finalSummary) {
          setScenarioData(finalSummary);
        }
        if (lastCreatedId) {
          setSelectedObjectId(lastCreatedId);
        }
      }
    } catch (err) {
      console.error('Failed to undo scenario placement action:', err);
    }
  }, [scenarioData, handleUpdatePlacement]);

  const handleAddPlacement = useCallback(
    async (
      kind:
        | ScenarioObjectKind
        | 'teleporter'
        | 'teleport'
        | 'teleport_2way'
        | 'koth'
        | 'race'
        | 'oddball'
        | 'ctf_flag'
        | 'ctf_flag_item',
      paletteIndex: number,
      position: [number, number, number],
      rotation: [number, number, number] = [0, 0, 0],
      teamIndex?: number,
    ) => {
      try {
        if (kind === 'ctf_flag') {
          // CTF Flag Stand (type 0 = CTF Flag, usageId = teamIndex 0 Red or 1 Blue)
          const res = await window.opence.addScenarioPlacement('netgame_flag', 0, position, rotation, teamIndex ?? 0);
          if (res && res.ok) {
            undoStackRef.current.push({ type: 'add', ids: [res.newPlacement.id] });
            setScenarioData(res.summary);
            setSelectedObjectId(res.newPlacement.id);
            setShowAddModal(false);
          }
          return;
        }

        if (kind === 'ctf_flag_item') {
          // Droppable CTF Flag item (weapon item collection)
          const weaponsPal = scenarioData?.palettes.weapons || [];
          const flagIdx = weaponsPal.findIndex(
            (p) =>
              p.path.toLowerCase().endsWith('\\flag') ||
              p.name.toLowerCase() === 'flag' ||
              p.path.toLowerCase().includes('weapons\\flag'),
          );
          const chosenIdx = flagIdx >= 0 ? flagIdx : 0;
          const res = await window.opence.addScenarioPlacement('weapon', chosenIdx, position, rotation);
          if (res && res.ok) {
            undoStackRef.current.push({ type: 'add', ids: [res.newPlacement.id] });
            setScenarioData(res.summary);
            setSelectedObjectId(res.newPlacement.id);
            setShowAddModal(false);
          }
          return;
        }

        if (kind === 'teleport_2way') {
          // Two-Way Teleporter: 2 Bi-directional nodes (Node 1 and Node 2), each with an Origin and Destination
          const existing = (scenarioData?.objects || []).filter(
            (o) => o.kind === 'netgame_flag' && (o.paletteIndex === 6 || o.paletteIndex === 7),
          );
          const maxId = existing.length > 0 ? Math.max(...existing.map((o) => o.teamIndex ?? 0)) : -1;
          const idA = maxId + 1;
          const idB = maxId + 2;

          const p1 = position;
          const p2: [number, number, number] = [position[0] + 6, position[1], position[2]];

          // Node 1: Origin ID A, Destination ID B
          const n1A = await window.opence.addScenarioPlacement('netgame_flag', 6, p1, rotation, idA);
          const n1B = await window.opence.addScenarioPlacement('netgame_flag', 7, p1, rotation, idB);

          // Node 2: Origin ID B, Destination ID A
          const n2B = await window.opence.addScenarioPlacement('netgame_flag', 6, p2, rotation, idB);
          const n2A = await window.opence.addScenarioPlacement('netgame_flag', 7, p2, rotation, idA);

          if (n2A && n2A.ok) {
            const addedIds = [n1A, n1B, n2B, n2A]
              .filter((r): r is NonNullable<typeof r> & { ok: true } => !!(r && r.ok))
              .map((r) => r.newPlacement.id);
            if (addedIds.length > 0) undoStackRef.current.push({ type: 'add', ids: addedIds });
            setScenarioData(n2A.summary);
            if (n1A && n1A.ok) setSelectedObjectId(n1A.newPlacement.id);
            setShowAddModal(false);
          }
          return;
        }

        if (kind === 'teleport') {
          // Find next available Teleport ID
          const existing = (scenarioData?.objects || []).filter(
            (o) => o.kind === 'netgame_flag' && (o.paletteIndex === 6 || o.paletteIndex === 7),
          );
          const nextId = existing.length > 0 ? Math.max(...existing.map((o) => o.teamIndex ?? 0)) + 1 : 0;

          // 1. Place Origin (type 6)
          const resOrigin = await window.opence.addScenarioPlacement('netgame_flag', 6, position, rotation, nextId);
          if (resOrigin && resOrigin.ok) {
            // 2. Place Destination (type 7) offset by 5m
            const destPos: [number, number, number] = [position[0] + 5, position[1], position[2]];
            const resDest = await window.opence.addScenarioPlacement('netgame_flag', 7, destPos, rotation, nextId);
            const addedIds = [resOrigin.newPlacement.id];
            if (resDest && resDest.ok) {
              addedIds.push(resDest.newPlacement.id);
              setScenarioData(resDest.summary);
            } else {
              setScenarioData(resOrigin.summary);
            }
            undoStackRef.current.push({ type: 'add', ids: addedIds });
            setSelectedObjectId(resOrigin.newPlacement.id);
            setShowAddModal(false);
          }
          return;
        }

        if (kind === 'koth') {
          // Find next available KOTH Hill ID
          const existing = (scenarioData?.objects || []).filter(
            (o) => o.kind === 'netgame_flag' && o.paletteIndex === 8,
          );
          const nextHillId = existing.length > 0 ? Math.max(...existing.map((o) => o.teamIndex ?? 0)) + 1 : 0;

          // Spawn 8 points in a 5m diameter circle (radius = 2.5m)
          let lastRes = null;
          let firstId = null;
          const addedIds: string[] = [];
          for (let k = 0; k < 8; k++) {
            const angle = (k * 2 * Math.PI) / 8;
            const px = position[0] + 2.5 * Math.cos(angle);
            const py = position[1] + 2.5 * Math.sin(angle);
            const pz = position[2];
            lastRes = await window.opence.addScenarioPlacement('netgame_flag', 8, [px, py, pz], rotation, nextHillId);
            if (lastRes && lastRes.ok) {
              addedIds.push(lastRes.newPlacement.id);
              if (k === 0) {
                firstId = lastRes.newPlacement.id;
              }
            }
          }
          if (lastRes && lastRes.ok) {
            if (addedIds.length > 0) undoStackRef.current.push({ type: 'add', ids: addedIds });
            setScenarioData(lastRes.summary);
            if (firstId) setSelectedObjectId(firstId);
            setShowAddModal(false);
          }
          return;
        }

        if (kind === 'race') {
          const existing = (scenarioData?.objects || []).filter(
            (o) => o.kind === 'netgame_flag' && (o.paletteIndex === 3 || o.paletteIndex === 4),
          );
          const nextId = existing.length > 0 ? Math.max(...existing.map((o) => o.teamIndex ?? 0)) + 1 : 0;
          const res = await window.opence.addScenarioPlacement('netgame_flag', 3, position, rotation, nextId);
          if (res && res.ok) {
            undoStackRef.current.push({ type: 'add', ids: [res.newPlacement.id] });
            setScenarioData(res.summary);
            setSelectedObjectId(res.newPlacement.id);
            setShowAddModal(false);
          }
          return;
        }

        if (kind === 'oddball') {
          const existing = (scenarioData?.objects || []).filter(
            (o) => o.kind === 'netgame_flag' && o.paletteIndex === 2,
          );
          const nextId = existing.length > 0 ? Math.max(...existing.map((o) => o.teamIndex ?? 0)) + 1 : 0;
          const res = await window.opence.addScenarioPlacement('netgame_flag', 2, position, rotation, nextId);
          if (res && res.ok) {
            undoStackRef.current.push({ type: 'add', ids: [res.newPlacement.id] });
            setScenarioData(res.summary);
            setSelectedObjectId(res.newPlacement.id);
            setShowAddModal(false);
          }
          return;
        }

        const res = await window.opence.addScenarioPlacement(
          kind as ScenarioObjectKind,
          paletteIndex,
          position,
          rotation,
          teamIndex,
        );
        if (res && res.ok) {
          undoStackRef.current.push({ type: 'add', ids: [res.newPlacement.id] });
          setScenarioData(res.summary);
          setSelectedObjectId(res.newPlacement.id);
          setShowAddModal(false);
        }
      } catch (err) {
        console.error('Failed to add scenario placement:', err);
      }
    },
    [scenarioData],
  );

  const handleSwapPlacement = useCallback(
    async (placementId: string, newKind: ScenarioObjectKind, newPaletteIndex: number) => {
      try {
        const res = await window.opence.swapScenarioPlacement(placementId, newKind, newPaletteIndex);
        if (res && res.ok) {
          setScenarioData(res.summary);
          setSelectedObjectId(res.newPlacement.id);
        }
      } catch (err) {
        console.error('Failed to swap scenario placement:', err);
      }
    },
    [],
  );

  // Snap all player spawns and netgame equipment to the nearest ground BSP surface
  const snapAllSpawnsToGround = useCallback(async () => {
    if (!scenarioData || submeshMeshesRef.current.length === 0) return;
    const bspMeshesList = submeshMeshesRef.current
      .filter((s) => s.mesh.parent?.visible !== false)
      .map((s) => s.mesh);
    if (bspMeshesList.length === 0) return;

    sceneRef.current?.updateMatrixWorld(true);

    const targets = scenarioData.objects.filter((o) => o.kind === 'spawn' || o.kind === 'equipment');
    let snappedCount = 0;

    for (const obj of targets) {
      const [curX, curY, curZ] = obj.position;
      // World space: Halo (X, Y, Z) is Three.js World (X, Z, -Y)
      // Cast a vertical downward ray along World -Y (Halo -Z)
      const rayOrigin = new THREE.Vector3(curX, Math.max(curZ + 100, 200), -curY);
      const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0.001, 2000);
      const hits = raycaster.intersectObjects(bspMeshesList, false);

      // Filter for upward-facing ground surfaces (Halo vertex normal Z >= 0.2) to exclude ceilings and walls
      const groundHits = hits.filter((h) => {
        if (!h.face) return true;
        const normAttr = h.object.geometry.getAttribute('normal');
        if (!normAttr) return true;
        const vnz = (normAttr.getZ(h.face.a) + normAttr.getZ(h.face.b) + normAttr.getZ(h.face.c)) / 3;
        return vnz >= 0.2;
      });

      if (groundHits.length > 0) {
        // Prefer ground at or below the object (with 3 unit tolerance for sunken objects)
        const belowHits = groundHits.filter((h) => h.point.y <= curZ + 3.0);
        const bestHit = (belowHits.length > 0 ? belowHits : groundHits)
          .sort((a, b) => Math.abs(a.point.y - curZ) - Math.abs(b.point.y - curZ))[0];

        const groundZ = bestHit.point.y + 0.02;
        const targetGroup = sceneRef.current?.getObjectByName(obj.id);
        if (targetGroup) {
          targetGroup.position.z = groundZ;
        }
        await handleUpdatePlacement(obj.id, { position: [curX, curY, groundZ] });
        snappedCount++;
      }
    }
    selectionBoxHelperRef.current?.update();
  }, [scenarioData, handleUpdatePlacement]);

  // Ground Snapping: casts a ray straight down from above the object onto the BSP ground geometry
  // Can snap upwards (for objects sunken into terrain) or downwards (for hovering objects), while ignoring ceilings
  const snapSelectedToGround = useCallback(async () => {
    if (!scenarioData || submeshMeshesRef.current.length === 0) return;
    const targetIds = selectedObjectIdsRef.current.length > 0
      ? selectedObjectIdsRef.current
      : (selectedObjectId ? [selectedObjectId] : []);
    if (targetIds.length === 0) return;

    const bspMeshesList = submeshMeshesRef.current
      .filter((s) => s.mesh.parent?.visible !== false)
      .map((s) => s.mesh);
    if (bspMeshesList.length === 0) return;

    sceneRef.current?.updateMatrixWorld(true);

    for (const id of targetIds) {
      const placement = scenarioData.objects.find((o) => o.id === id);
      if (!placement) continue;

      const [curX, curY, curZ] = placement.position;
      // World space conversion:
      // Halo +X is World +X, Halo +Z (up) is World +Y, Halo +Y is World -Z
      // Cast a vertical downward ray along World -Y (Halo -Z)
      const worldOrigin = new THREE.Vector3(curX, Math.max(curZ + 100, 200), -curY);
      const worldDir = new THREE.Vector3(0, -1, 0);
      const raycaster = new THREE.Raycaster(worldOrigin, worldDir, 0.001, 2000);

      const hits = raycaster.intersectObjects(bspMeshesList, false);

      // Filter for upward-facing ground surfaces (Halo vertex normal Z >= 0.2) to exclude ceilings and steep walls
      const groundHits = hits.filter((h) => {
        if (!h.face) return true;
        const normAttr = h.object.geometry.getAttribute('normal');
        if (!normAttr) return true;
        const vnz = (normAttr.getZ(h.face.a) + normAttr.getZ(h.face.b) + normAttr.getZ(h.face.c)) / 3;
        return vnz >= 0.2;
      });

      if (groundHits.length > 0) {
        // Prefer ground at or below the object (with 3 unit tolerance for sunken objects)
        const belowHits = groundHits.filter((h) => h.point.y <= curZ + 3.0);
        const bestHit = (belowHits.length > 0 ? belowHits : groundHits)
          .sort((a, b) => Math.abs(a.point.y - curZ) - Math.abs(b.point.y - curZ))[0];

        const groundZ = bestHit.point.y + 0.02; // World Y is Halo Z (height)

        const targetGroup = sceneRef.current?.getObjectByName(id);
        if (targetGroup) {
          targetGroup.position.z = groundZ;
        }

        await handleUpdatePlacement(id, {
          position: [curX, curY, groundZ],
        });
      }
    }
    selectionBoxHelperRef.current?.update();
  }, [selectedObjectId, scenarioData, handleUpdatePlacement]);

  const callbacksRef = useRef({
    handleUpdatePlacement,
    handleDuplicatePlacement,
    handleDeletePlacement,
    handleCopyPlacement,
    handleCutPlacement,
    handlePastePlacement,
    handleUndo,
    snapSelectedToGround,
    focusOnObject,
    frameScene,
  });
  callbacksRef.current = {
    handleUpdatePlacement,
    handleDuplicatePlacement,
    handleDeletePlacement,
    handleCopyPlacement,
    handleCutPlacement,
    handlePastePlacement,
    handleUndo,
    snapSelectedToGround,
    focusOnObject,
    frameScene,
  };

  const prevMapKeyRef = useRef<string>(`${header.scenarioName}_${header.crc32}_${bspIndex}`);
  useEffect(() => {
    const key = `${header.scenarioName}_${header.crc32}_${bspIndex}`;
    if (prevMapKeyRef.current !== key) {
      prevMapKeyRef.current = key;
      hasInitialFramedRef.current = false;
      bspChildGroupsRef.current.clear();
      setBspMeshes({});
      setVisibleBspIndices([bspIndex]);
    }
  }, [bspIndex, header.scenarioName, header.crc32]);

  // Load BSP Render Meshes for any visible BSP not yet cached
  useEffect(() => {
    let active = true;
    for (const idx of visibleBspIndices) {
      if (!bspMeshes[idx]) {
        setLoading(true);
        setError(null);
        window.opence
          .getBspRenderMesh(idx)
          .then((res) => {
            if (!active) return;
            if (res.ok) {
              setBspMeshes((prev) => ({ ...prev, [idx]: res.mesh }));
              setLoading(false);
            } else {
              setError(res.message);
              setLoading(false);
            }
          })
          .catch((err) => {
            if (!active) return;
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
          });
      }
    }

    return () => {
      active = false;
    };
  }, [visibleBspIndices, bspMeshes, header.scenarioName, header.crc32]);

  // Texture loader helper
  const loadTexture = useCallback((shaderTagId: number): Promise<THREE.Texture | null> => {
    if (shaderTagId === 0xffffffff || shaderTagId === 0) return Promise.resolve(null);
    const cache = textureCacheRef.current;
    if (cache.has(shaderTagId)) {
      return cache.get(shaderTagId)!;
    }
    const promise = (async () => {
      try {
        const res = await window.opence.getBitmapTexture(shaderTagId);
        if (res.ok && res.texture) {
          const { width, height, rgbaData } = res.texture;
          const tex = new THREE.DataTexture(
            rgbaData,
            width,
            height,
            THREE.RGBAFormat,
            THREE.UnsignedByteType,
          );
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          tex.needsUpdate = true;
          return tex;
        }
      } catch {
        // Fallback
      }
      return null;
    })();
    cache.set(shaderTagId, promise);
    return promise;
  }, []);

  // Refresh 3D viewport textures immediately when a bitmap tag is modified in the Bitmap Editor
  useEffect(() => {
    const onBitmapUpdated = () => {
      textureCacheRef.current.clear();
      for (const item of objectMeshesRef.current) {
        if (item.shaderTagId) {
          loadTexture(item.shaderTagId).then((tex) => {
            if (tex && item.solidMat) {
              item.solidMat.map = tex;
              item.solidMat.color.setHex(0xffffff);
              item.solidMat.needsUpdate = true;
            }
          });
        }
      }
    };
    window.addEventListener('opence:bitmap-updated', onBitmapUpdated);
    return () => window.removeEventListener('opence:bitmap-updated', onBitmapUpdated);
  }, [loadTexture]);

  // Load Scenario Objects
  useEffect(() => {
    let active = true;
    window.opence
      .getScenarioObjects?.()
      .then((res) => {
        if (!active) return;
        if (res && res.ok) {
          setScenarioData(res.summary);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [header.scenarioName, header.crc32]);

  // Model geometry loader helper
  const loadModelGeometry = useCallback((modelTagId: number): Promise<ModelRenderGeometry | null> => {
    if (modelTagId === 0xffffffff || modelTagId === 0) return Promise.resolve(null);
    const cache = modelCacheRef.current;
    if (cache.has(modelTagId)) {
      return cache.get(modelTagId)!;
    }
    const promise = (async () => {
      try {
        const res = await window.opence.getModelGeometry?.(modelTagId);
        if (res && res.ok && res.geometry) {
          return res.geometry;
        }
      } catch {
        // Fallback
      }
      return null;
    })();
    cache.set(modelTagId, promise);
    return promise;
  }, []);

  // Populate 3D scene objects from scenario placements
  const populateScenarioObjects = useCallback(
    (summary: ScenarioPlacementsSummary, layers: NonNullable<typeof layerGroupsRef.current>) => {
      const {
        vehicles,
        scenery,
        spawns,
        items,
        encounters,
        firingPositions,
        triggerVolumes,
        cutsceneCameras,
        netgameFlags,
      } = layers;

      const clearGroup = (group: THREE.Group) => {
        while (group.children.length > 0) {
          group.remove(group.children[0]);
        }
      };
      clearGroup(vehicles);
      clearGroup(scenery);
      clearGroup(spawns);
      clearGroup(items);
      clearGroup(encounters);
      clearGroup(firingPositions);
      clearGroup(triggerVolumes);
      clearGroup(cutsceneCameras);
      clearGroup(netgameFlags);

      for (const item of objectMeshesRef.current) {
        item.mesh.geometry.dispose();
        if (item.lines) {
          item.lines.geometry.dispose();
          (item.lines.material as THREE.Material).dispose();
        }
        item.solidMat.dispose();
      }
      objectMeshesRef.current = [];

      for (const obj of summary.objects) {
        const objGroup = new THREE.Group();
        objGroup.name = obj.id;
        objGroup.userData = { id: obj.id, kind: obj.kind, placement: obj };
        objGroup.position.set(obj.position[0], obj.position[1], obj.position[2]);
        // Halo CE matrix4x3_rotation_from_angles(yaw, pitch, roll) equals R_x(roll) * R_y(-pitch) * R_z(yaw) ('XYZ')
        objGroup.rotation.set(obj.rotation[2], -obj.rotation[1], obj.rotation[0], 'XYZ');

        let targetLayer = scenery;
        if (obj.kind === 'vehicle') targetLayer = vehicles;
        else if (obj.kind === 'scenery') targetLayer = scenery;
        else if (obj.kind === 'spawn') targetLayer = spawns;
        else if (obj.kind === 'weapon' || obj.kind === 'equipment') targetLayer = items;
        else if (obj.kind === 'encounter') targetLayer = encounters;
        else if (obj.kind === 'firing_position') targetLayer = firingPositions;
        else if (obj.kind === 'trigger_volume') targetLayer = triggerVolumes;
        else if (obj.kind === 'cutscene_camera') targetLayer = cutsceneCameras;
        else if (obj.kind === 'netgame_flag') targetLayer = netgameFlags;

        if (obj.kind === 'spawn') {
          const color = obj.teamIndex === 0 ? 0xef5350 : obj.teamIndex === 1 ? 0x42a5f5 : 0xffca28;
          const markerGroup = new THREE.Group();
          markerGroup.userData = { id: obj.id };

          const cylGeom = new THREE.CylinderGeometry(0.3, 0.3, 1.6, 12);
          cylGeom.rotateX(Math.PI / 2);
          cylGeom.translate(0, 0, 0.8);
          const cylMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
          const cylMesh = new THREE.Mesh(cylGeom, cylMat);
          cylMesh.userData = { id: obj.id };
          markerGroup.add(cylMesh);

          const coneGeom = new THREE.ConeGeometry(0.3, 0.6, 12);
          coneGeom.rotateZ(-Math.PI / 2);
          coneGeom.translate(0.5, 0, 1.2);
          const coneMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
          const coneMesh = new THREE.Mesh(coneGeom, coneMat);
          coneMesh.userData = { id: obj.id };
          markerGroup.add(coneMesh);

          objGroup.add(markerGroup);
          targetLayer.add(objGroup);
        } else if (obj.kind === 'trigger_volume') {
          const dx = Math.max(0.2, Math.abs(obj.extents?.[0] || 2));
          const dy = Math.max(0.2, Math.abs(obj.extents?.[1] || 2));
          const dz = Math.max(0.2, Math.abs(obj.extents?.[2] || 2));
          const boxGeom = new THREE.BoxGeometry(dx, dy, dz);
          boxGeom.translate((obj.extents?.[0] || 2) / 2, (obj.extents?.[1] || 2) / 2, (obj.extents?.[2] || 2) / 2);
          const boxMat = new THREE.MeshStandardMaterial({
            color: 0x00e676,
            transparent: true,
            opacity: 0.25,
            roughness: 0.5,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          const boxMesh = new THREE.Mesh(boxGeom, boxMat);
          boxMesh.userData = { id: obj.id };
          objGroup.add(boxMesh);

          const wireGeom = new THREE.WireframeGeometry(boxGeom);
          const wireMat = new THREE.LineBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.85,
          });
          const wireMesh = new THREE.LineSegments(wireGeom, wireMat);
          objGroup.add(wireMesh);
          targetLayer.add(objGroup);
        } else if (obj.kind === 'firing_position') {
          const fpMarker = new THREE.Group();
          fpMarker.userData = { id: obj.id };

          const sphereGeom = new THREE.SphereGeometry(0.35, 12, 12);
          sphereGeom.translate(0, 0, 0.35);
          const sphereMat = new THREE.MeshStandardMaterial({
            color: 0xffd54f,
            roughness: 0.3,
            metalness: 0.2,
            emissive: 0xffa000,
            emissiveIntensity: 0.2,
          });
          const sphereMesh = new THREE.Mesh(sphereGeom, sphereMat);
          sphereMesh.userData = { id: obj.id };
          fpMarker.add(sphereMesh);

          const coneGeom = new THREE.ConeGeometry(0.18, 0.45, 8);
          coneGeom.rotateZ(-Math.PI / 2);
          coneGeom.translate(0.4, 0, 0.35);
          const coneMat = new THREE.MeshStandardMaterial({ color: 0xffb300, roughness: 0.4 });
          const coneMesh = new THREE.Mesh(coneGeom, coneMat);
          coneMesh.userData = { id: obj.id };
          fpMarker.add(coneMesh);

          objGroup.add(fpMarker);
          targetLayer.add(objGroup);
        } else if (obj.kind === 'cutscene_camera') {
          const camMarker = new THREE.Group();
          camMarker.userData = { id: obj.id };

          const bodyGeom = new THREE.BoxGeometry(0.5, 0.35, 0.3);
          const bodyMat = new THREE.MeshStandardMaterial({ color: 0xab47bc, roughness: 0.4 });
          const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
          bodyMesh.userData = { id: obj.id };
          camMarker.add(bodyMesh);

          const frustumGeom = new THREE.ConeGeometry(0.5, 0.9, 4);
          frustumGeom.rotateZ(-Math.PI / 2);
          frustumGeom.rotateX(Math.PI / 4);
          frustumGeom.translate(0.7, 0, 0);
          const frustumMat = new THREE.MeshBasicMaterial({
            color: 0xe1bee7,
            wireframe: true,
          });
          const frustumMesh = new THREE.Mesh(frustumGeom, frustumMat);
          frustumMesh.userData = { id: obj.id };
          camMarker.add(frustumMesh);

          objGroup.add(camMarker);
          targetLayer.add(objGroup);
        } else if (obj.kind === 'netgame_flag') {
          const flagMarker = new THREE.Group();
          flagMarker.userData = { id: obj.id };

          const isTeleOrigin = obj.paletteIndex === 6 || (obj.objectPath || '').toLowerCase().includes('origin') || (obj.objectPath || '').toLowerCase().includes('source');
          const isTeleDest = obj.paletteIndex === 7 || (obj.objectPath || '').toLowerCase().includes('dest');
          const isKoth = obj.paletteIndex === 8 || (obj.objectPath || '').toLowerCase().includes('hill');
          const isRace = obj.paletteIndex === 3 || obj.paletteIndex === 4 || (obj.objectPath || '').toLowerCase().includes('race');
          const isOddball = obj.paletteIndex === 2 || (obj.objectPath || '').toLowerCase().includes('oddball');

          // Check if this teleporter flag is part of a Two-Way Teleporter node (co-located with another teleporter flag)
          const isTwoWayNode = (isTeleOrigin || isTeleDest) && (scenarioData?.objects || []).some(
            (other) =>
              other.id !== obj.id &&
              other.kind === 'netgame_flag' &&
              (other.paletteIndex === 6 || other.paletteIndex === 7) &&
              Math.hypot(other.position[0] - obj.position[0], other.position[1] - obj.position[1], other.position[2] - obj.position[2]) < 0.25,
          );

          if (isKoth) {
            // KOTH marker: Orange box cube (size of AR ~0.7m)
            const cubeGeom = new THREE.BoxGeometry(0.7, 0.7, 0.7);
            cubeGeom.translate(0, 0, 0.35);
            const cubeMat = new THREE.MeshStandardMaterial({
              color: 0xff9800,
              emissive: 0xff6d00,
              emissiveIntensity: 0.4,
              roughness: 0.3,
            });
            const cubeMesh = new THREE.Mesh(cubeGeom, cubeMat);
            cubeMesh.userData = { id: obj.id };
            flagMarker.add(cubeMesh);
          } else if (isRace) {
            // Race marker: Red box cube
            const cubeGeom = new THREE.BoxGeometry(0.7, 0.7, 0.7);
            cubeGeom.translate(0, 0, 0.35);
            const cubeMat = new THREE.MeshStandardMaterial({
              color: 0xf44336,
              emissive: 0xd50000,
              emissiveIntensity: 0.4,
              roughness: 0.3,
            });
            const cubeMesh = new THREE.Mesh(cubeGeom, cubeMat);
            cubeMesh.userData = { id: obj.id };
            flagMarker.add(cubeMesh);
          } else if (isOddball) {
            // Oddball skull spawn: Purple box cube
            const cubeGeom = new THREE.BoxGeometry(0.7, 0.7, 0.7);
            cubeGeom.translate(0, 0, 0.35);
            const cubeMat = new THREE.MeshStandardMaterial({
              color: 0xba68c8,
              emissive: 0xaa00ff,
              emissiveIntensity: 0.4,
              roughness: 0.3,
            });
            const cubeMesh = new THREE.Mesh(cubeGeom, cubeMat);
            cubeMesh.userData = { id: obj.id };
            flagMarker.add(cubeMesh);
          } else if (isTwoWayNode) {
            // Two-Way Teleporter Node: Glowing Purple portal ring & beam
            const torusGeom = new THREE.TorusGeometry(0.85, 0.09, 8, 24);
            torusGeom.translate(0, 0, 0.09);
            const torusMat = new THREE.MeshStandardMaterial({
              color: 0xab47bc,
              emissive: 0x8e24aa,
              emissiveIntensity: 0.6,
              roughness: 0.2,
            });
            const torusMesh = new THREE.Mesh(torusGeom, torusMat);
            torusMesh.userData = { id: obj.id };
            flagMarker.add(torusMesh);

            // Purple energy beam
            const beamGeom = new THREE.CylinderGeometry(0.14, 0.14, 2.0, 8);
            beamGeom.rotateX(Math.PI / 2);
            beamGeom.translate(0, 0, 1.0);
            const beamMat = new THREE.MeshBasicMaterial({ color: 0xba68c8, transparent: true, opacity: 0.45 });
            const beamMesh = new THREE.Mesh(beamGeom, beamMat);
            beamMesh.userData = { id: obj.id };
            flagMarker.add(beamMesh);
          } else if (isTeleOrigin) {
            // Teleport Origin: Cyan glowing portal ring
            const torusGeom = new THREE.TorusGeometry(0.75, 0.08, 8, 24);
            torusGeom.translate(0, 0, 0.08);
            const torusMat = new THREE.MeshStandardMaterial({
              color: 0x00e5ff,
              emissive: 0x00b0ff,
              emissiveIntensity: 0.5,
              roughness: 0.2,
            });
            const torusMesh = new THREE.Mesh(torusGeom, torusMat);
            torusMesh.userData = { id: obj.id };
            flagMarker.add(torusMesh);

            // Energy beam
            const beamGeom = new THREE.CylinderGeometry(0.12, 0.12, 1.8, 8);
            beamGeom.rotateX(Math.PI / 2);
            beamGeom.translate(0, 0, 0.9);
            const beamMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.4 });
            const beamMesh = new THREE.Mesh(beamGeom, beamMat);
            beamMesh.userData = { id: obj.id };
            flagMarker.add(beamMesh);
          } else if (isTeleDest) {
            // Teleport Destination: Green/Lime glowing portal ring
            const torusGeom = new THREE.TorusGeometry(0.75, 0.08, 8, 24);
            torusGeom.translate(0, 0, 0.08);
            const torusMat = new THREE.MeshStandardMaterial({
              color: 0x76ff03,
              emissive: 0x64dd17,
              emissiveIntensity: 0.5,
              roughness: 0.2,
            });
            const torusMesh = new THREE.Mesh(torusGeom, torusMat);
            torusMesh.userData = { id: obj.id };
            flagMarker.add(torusMesh);

            // Energy beam
            const beamGeom = new THREE.CylinderGeometry(0.12, 0.12, 1.8, 8);
            beamGeom.rotateX(Math.PI / 2);
            beamGeom.translate(0, 0, 0.9);
            const beamMat = new THREE.MeshBasicMaterial({ color: 0x76ff03, transparent: true, opacity: 0.4 });
            const beamMesh = new THREE.Mesh(beamGeom, beamMat);
            beamMesh.userData = { id: obj.id };
            flagMarker.add(beamMesh);
          } else {
            // Standard flag pole with banner (CTF etc.)
            const poleGeom = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8);
            poleGeom.rotateX(Math.PI / 2);
            poleGeom.translate(0, 0, 1.1);
            const poleMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 });
            const poleMesh = new THREE.Mesh(poleGeom, poleMat);
            poleMesh.userData = { id: obj.id };
            flagMarker.add(poleMesh);

            const bannerColor = (obj.objectPath || '').toLowerCase().includes('red') ? 0xef5350 : 0x42a5f5;
            const bannerGeom = new THREE.PlaneGeometry(0.8, 0.5);
            bannerGeom.rotateY(Math.PI / 2);
            bannerGeom.translate(0, 0.4, 1.8);
            const bannerMat = new THREE.MeshStandardMaterial({ color: bannerColor, side: THREE.DoubleSide });
            const bannerMesh = new THREE.Mesh(bannerGeom, bannerMat);
            bannerMesh.userData = { id: obj.id };
            flagMarker.add(bannerMesh);
          }

          objGroup.add(flagMarker);
          targetLayer.add(objGroup);
        } else if (obj.modelTagId && obj.modelTagId !== 0xffffffff) {
          targetLayer.add(objGroup);

          loadModelGeometry(obj.modelTagId).then((modelGeom) => {
            if (!modelGeom || modelGeom.submeshes.length === 0) {
              if (objGroup.children.length === 0) {
                const fbGeom = new THREE.BoxGeometry(1.5, 1.5, 1.5);
                fbGeom.translate(0, 0, 0.75);
                const fbMat = new THREE.MeshStandardMaterial({
                  color: obj.kind === 'vehicle' ? 0x42a5f5 : obj.kind === 'weapon' ? 0xffa726 : 0xab47bc,
                  wireframe: true,
                });
                const fallbackMesh = new THREE.Mesh(fbGeom, fbMat);
                fallbackMesh.userData = { id: obj.id };
                objGroup.add(fallbackMesh);
              }
              return;
            }

            const defaultColor =
              obj.kind === 'vehicle'
                ? 0x3f51b5
                : obj.kind === 'scenery'
                  ? 0x78909c
                  : obj.kind === 'weapon' || obj.kind === 'equipment'
                    ? 0xff9800
                    : 0x4caf50;

            for (const submesh of modelGeom.submeshes) {
              if (submesh.vertexCount === 0 || submesh.indices.length === 0) continue;

              const geom = new THREE.BufferGeometry();
              const interleaved = new THREE.InterleavedBuffer(submesh.vertices, 8);
              geom.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
              geom.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
              geom.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleaved, 2, 6));
              geom.setIndex(new THREE.BufferAttribute(submesh.indices, 1));

              const solidMat = new THREE.MeshStandardMaterial({
                color: defaultColor,
                roughness: 0.65,
                metalness: 0.15,
                side: THREE.DoubleSide,
              });

              const mesh = new THREE.Mesh(geom, solidMat);
              mesh.userData = { id: obj.id };
              objGroup.add(mesh);

              const wireframeGeom = new THREE.WireframeGeometry(geom);
              const wireframeMat = new THREE.LineBasicMaterial({
                color: 0x00e5ff,
                transparent: true,
                opacity: renderMode === 'wireframe' ? 0.9 : 0.35,
              });
              const lines = new THREE.LineSegments(wireframeGeom, wireframeMat);
              lines.visible = renderMode === 'textured-wireframe' || renderMode === 'wireframe';
              mesh.visible = renderMode !== 'wireframe';
              mesh.add(lines);

              objectMeshesRef.current.push({ mesh, lines, solidMat, shaderTagId: submesh.shaderTagId });

              if (submesh.shaderTagId) {
                loadTexture(submesh.shaderTagId).then((tex) => {
                  if (tex && solidMat) {
                    solidMat.map = tex;
                    solidMat.color.setHex(0xffffff);
                    solidMat.needsUpdate = true;
                  }
                });
              }
            }
            selectionBoxHelperRef.current?.update();
          });
        } else if (obj.kind === 'encounter') {
          // Fallback biped marker for AI encounter when gbxmodel is absent
          const encColor = obj.teamIndex === 0 ? 0xef5350 : obj.teamIndex === 1 ? 0x42a5f5 : 0xba68c8;
          const bipedMarker = new THREE.Group();
          bipedMarker.userData = { id: obj.id };

          const cylGeom = new THREE.CylinderGeometry(0.28, 0.28, 1.7, 12);
          cylGeom.rotateX(Math.PI / 2);
          cylGeom.translate(0, 0, 0.85);
          const cylMat = new THREE.MeshStandardMaterial({ color: encColor, roughness: 0.45 });
          const cylMesh = new THREE.Mesh(cylGeom, cylMat);
          cylMesh.userData = { id: obj.id };
          bipedMarker.add(cylMesh);

          const headGeom = new THREE.SphereGeometry(0.22, 12, 12);
          headGeom.translate(0, 0, 1.85);
          const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
          const headMesh = new THREE.Mesh(headGeom, headMat);
          headMesh.userData = { id: obj.id };
          bipedMarker.add(headMesh);

          const coneGeom = new THREE.ConeGeometry(0.2, 0.5, 8);
          coneGeom.rotateZ(-Math.PI / 2);
          coneGeom.translate(0.45, 0, 1.3);
          const coneMat = new THREE.MeshStandardMaterial({ color: encColor, roughness: 0.3 });
          const coneMesh = new THREE.Mesh(coneGeom, coneMat);
          coneMesh.userData = { id: obj.id };
          bipedMarker.add(coneMesh);

          objGroup.add(bipedMarker);
          targetLayer.add(objGroup);
        } else {
          const dims =
            obj.kind === 'vehicle'
              ? [3.5, 2.2, 1.8]
              : obj.kind === 'weapon' || obj.kind === 'equipment'
                ? [0.8, 0.4, 0.3]
                : [1.5, 1.5, 2.0];
          const boxGeom = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
          boxGeom.translate(0, 0, dims[2] / 2);
          const color =
            obj.kind === 'vehicle'
              ? 0x42a5f5
              : obj.kind === 'weapon' || obj.kind === 'equipment'
                ? 0xffa726
                : 0xab47bc;
          const boxMat = new THREE.MeshStandardMaterial({
            color,
            wireframe: true,
          });
          const boxMesh = new THREE.Mesh(boxGeom, boxMat);
          boxMesh.userData = { id: obj.id };
          objGroup.add(boxMesh);
          targetLayer.add(objGroup);
        }
      }
    },
    [loadModelGeometry, loadTexture, renderMode],
  );

  // Re-populate scenario objects when scenarioData changes
  useEffect(() => {
    if (scenarioData && layerGroupsRef.current) {
      populateScenarioObjects(scenarioData, layerGroupsRef.current);
    }
  }, [scenarioData, populateScenarioObjects]);

  // Synchronize layer visibility toggles
  useEffect(() => {
    if (!layerGroupsRef.current) return;
    layerGroupsRef.current.bsp.visible = visibleLayers.bsp;
    layerGroupsRef.current.vehicles.visible = visibleLayers.vehicles;
    layerGroupsRef.current.scenery.visible = visibleLayers.scenery;
    layerGroupsRef.current.spawns.visible = visibleLayers.spawns;
    layerGroupsRef.current.items.visible = visibleLayers.items;
    layerGroupsRef.current.encounters.visible = visibleLayers.encounters;
    layerGroupsRef.current.firingPositions.visible = visibleLayers.firingPositions;
    layerGroupsRef.current.triggerVolumes.visible = visibleLayers.triggerVolumes;
    layerGroupsRef.current.cutsceneCameras.visible = visibleLayers.cutsceneCameras;
    layerGroupsRef.current.netgameFlags.visible = visibleLayers.netgameFlags;
  }, [visibleLayers]);

  // Update render mode materials
  useEffect(() => {
    const allMeshes = [...submeshMeshesRef.current, ...objectMeshesRef.current];
    for (const item of allMeshes) {
      const { mesh, lines, solidMat } = item;
      switch (renderMode) {
        case 'textured':
          mesh.visible = true;
          if (lines) lines.visible = false;
          solidMat.wireframe = false;
          break;
        case 'textured-wireframe':
          mesh.visible = true;
          if (lines) {
            lines.visible = true;
            (lines.material as THREE.LineBasicMaterial).opacity = 0.35;
          }
          solidMat.wireframe = false;
          break;
        case 'wireframe':
          mesh.visible = true;
          solidMat.wireframe = true;
          if (lines) {
            lines.visible = true;
            (lines.material as THREE.LineBasicMaterial).opacity = 0.9;
          }
          break;
        case 'flat':
          mesh.visible = true;
          if (lines) lines.visible = false;
          solidMat.wireframe = false;
          break;
      }
    }
  }, [renderMode]);

  // Update TransformControls mode
  useEffect(() => {
    if (transformControlsRef.current) {
      transformControlsRef.current.setMode(gizmoMode);
    }
  }, [gizmoMode]);

  // Attach/Detach TransformControls & Selection BoxHelper on selectedObjectIds change
  useEffect(() => {
    const tc = transformControlsRef.current;
    const scene = sceneRef.current;
    if (!tc || !scene) return;

    // Clean up previous selection helpers
    if (selectionBoxHelperRef.current) {
      scene.remove(selectionBoxHelperRef.current);
      selectionBoxHelperRef.current.dispose();
      selectionBoxHelperRef.current = null;
    }
    if (partnerBoxHelperRef.current) {
      scene.remove(partnerBoxHelperRef.current);
      partnerBoxHelperRef.current.dispose();
      partnerBoxHelperRef.current = null;
    }
    for (const h of kothZoneHelpersRef.current) {
      scene.remove(h);
      h.dispose();
    }
    kothZoneHelpersRef.current = [];
    for (const h of multiSelectionHelpersRef.current) {
      scene.remove(h);
      h.dispose();
    }
    multiSelectionHelpersRef.current = [];

    if (selectedObjectIds.length === 0 || !layerGroupsRef.current) {
      tc.detach();
      return;
    }

    const allGroups = [
      ...layerGroupsRef.current.vehicles.children,
      ...layerGroupsRef.current.scenery.children,
      ...layerGroupsRef.current.spawns.children,
      ...layerGroupsRef.current.items.children,
      ...layerGroupsRef.current.encounters.children,
      ...layerGroupsRef.current.firingPositions.children,
      ...layerGroupsRef.current.triggerVolumes.children,
      ...layerGroupsRef.current.cutsceneCameras.children,
      ...layerGroupsRef.current.netgameFlags.children,
    ];

    const primaryGroup = allGroups.find((g) => g.userData?.id === selectedObjectId);

    if (primaryGroup) {
      tc.attach(primaryGroup);
      const boxHelper = new LocalBoxHelper(primaryGroup, 0x39ff14);
      const boxMat = boxHelper.material as THREE.LineBasicMaterial;
      boxMat.depthTest = false;
      boxMat.transparent = true;
      boxMat.opacity = 1.0;
      boxMat.linewidth = 2;
      boxHelper.renderOrder = 9999;
      scene.add(boxHelper);
      selectionBoxHelperRef.current = boxHelper;

      // Other multi-selected objects outline
      for (const id of selectedObjectIds) {
        if (id === selectedObjectId) continue;
        const group = allGroups.find((g) => g.userData?.id === id);
        if (group) {
          const mHelper = new LocalBoxHelper(group, 0x00e5ff);
          const mMat = mHelper.material as THREE.LineBasicMaterial;
          mMat.depthTest = false;
          mMat.transparent = true;
          mMat.opacity = 0.85;
          mHelper.renderOrder = 9998;
          scene.add(mHelper);
          multiSelectionHelpersRef.current.push(mHelper);
        }
      }

      // Check if primary is a teleporter: outline its paired partner in green outline
      const primaryObj = scenarioData?.objects.find((o) => o.id === selectedObjectId);
      if (primaryObj && primaryObj.kind === 'netgame_flag' && (primaryObj.paletteIndex === 6 || primaryObj.paletteIndex === 7)) {
        const partnerType = primaryObj.paletteIndex === 6 ? 7 : 6;
        const partner = scenarioData?.objects.find(
          (o) => o.kind === 'netgame_flag' && o.paletteIndex === partnerType && o.teamIndex === primaryObj.teamIndex,
        );
        if (partner) {
          const partnerGroup = allGroups.find((g) => g.userData?.id === partner.id);
          if (partnerGroup) {
            const pHelper = new LocalBoxHelper(partnerGroup, 0x00ff88);
            const pMat = pHelper.material as THREE.LineBasicMaterial;
            pMat.depthTest = false;
            pMat.transparent = true;
            pMat.opacity = 1.0;
            pMat.linewidth = 2;
            pHelper.renderOrder = 9999;
            scene.add(pHelper);
            partnerBoxHelperRef.current = pHelper;
          }
        }
      }

      // Check if primary is a KOTH marker: outline all other markers of the same Hill ID in orange
      if (primaryObj && primaryObj.kind === 'netgame_flag' && primaryObj.paletteIndex === 8) {
        const zonePoints = (scenarioData?.objects || []).filter(
          (o) => o.kind === 'netgame_flag' && o.paletteIndex === 8 && o.teamIndex === primaryObj.teamIndex && o.id !== selectedObjectId,
        );
        for (const pt of zonePoints) {
          const ptGroup = allGroups.find((g) => g.userData?.id === pt.id);
          if (ptGroup) {
            const kHelper = new LocalBoxHelper(ptGroup, 0xffa500);
            const kMat = kHelper.material as THREE.LineBasicMaterial;
            kMat.depthTest = false;
            kMat.transparent = true;
            kMat.opacity = 0.85;
            kHelper.renderOrder = 9997;
            scene.add(kHelper);
            kothZoneHelpersRef.current.push(kHelper);
          }
        }
      }
    } else {
      tc.detach();
    }
  }, [selectedObjectId, selectedObjectIds, scenarioData]);

  // Synchronize multi-BSP geometries with Three.js scene
  const syncBspMeshes = useCallback(() => {
    const layerGroups = layerGroupsRef.current;
    if (!layerGroups) return;
    const bspGroup = layerGroups.bsp;

    for (const idx of visibleBspIndices) {
      if (bspChildGroupsRef.current.has(idx)) {
        bspChildGroupsRef.current.get(idx)!.visible = true;
      } else {
        const meshData = bspMeshes[idx];
        if (!meshData) continue;

        const childGroup = new THREE.Group();
        childGroup.name = `bsp_${idx}`;

        for (const submesh of meshData.submeshes) {
          if (submesh.vertexCount === 0 || submesh.indices.length === 0) continue;

          const geom = new THREE.BufferGeometry();
          const interleaved = new THREE.InterleavedBuffer(submesh.vertices, 8);
          geom.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
          geom.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
          geom.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleaved, 2, 6));

          if (submesh.lightmapUvs && submesh.lightmapUvs.length > 0) {
            geom.setAttribute('uv2', new THREE.BufferAttribute(submesh.lightmapUvs, 2));
          }
          geom.setIndex(new THREE.BufferAttribute(submesh.indices, 1));

          const solidMat = new THREE.MeshStandardMaterial({
            color: 0x90a4ae,
            roughness: 0.8,
            metalness: 0.1,
            side: THREE.DoubleSide,
          });

          const mesh = new THREE.Mesh(geom, solidMat);
          childGroup.add(mesh);

          const wireframeGeom = new THREE.WireframeGeometry(geom);
          const wireframeMat = new THREE.LineBasicMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: renderMode === 'wireframe' ? 0.9 : 0.35,
          });
          const lines = new THREE.LineSegments(wireframeGeom, wireframeMat);
          lines.visible = renderMode === 'textured-wireframe' || renderMode === 'wireframe';
          mesh.visible = true;
          solidMat.wireframe = renderMode === 'wireframe';
          mesh.add(lines);

          submeshMeshesRef.current.push({ mesh, lines, solidMat, bspIndex: idx });

          if (submesh.shaderTagId) {
            loadTexture(submesh.shaderTagId).then((tex) => {
              if (tex && solidMat) {
                solidMat.map = tex;
                solidMat.color.setHex(0xffffff);
                solidMat.needsUpdate = true;
              }
            });
          }
        }

        bspGroup.add(childGroup);
        bspChildGroupsRef.current.set(idx, childGroup);
      }
    }

    // Hide any child groups not in visibleBspIndices
    for (const [idx, group] of bspChildGroupsRef.current.entries()) {
      group.visible = visibleBspIndices.includes(idx);
    }
  }, [visibleBspIndices, bspMeshes, renderMode, loadTexture]);

  useEffect(() => {
    syncBspMeshes();
  }, [syncBspMeshes]);

  // Main Three.js setup and animation loop
  useEffect(() => {
    if (!webGLSupported || !containerRef.current || !primaryMesh) return;

    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x13171f);
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.5, 10000);
    cameraRef.current = camera;

    // 3. Renderer
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.innerHTML = '';
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;
    } catch (err) {
      setError(`Failed to initialize WebGL renderer: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(100, 200, 100);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x78909c, 0.4);
    dirLight2.position.set(-100, -50, -100);
    scene.add(dirLight2);

    const headLight = new THREE.PointLight(0xffffff, 0.5, 300);
    scene.add(headLight);

    // 5. Halo coordinate root: Z-up to Y-up
    const haloRoot = new THREE.Group();
    haloRoot.rotation.x = -Math.PI / 2;
    scene.add(haloRoot);
    haloRootRef.current = haloRoot;

    // Layer groups under haloRoot
    const bspGroup = new THREE.Group();
    const vehiclesGroup = new THREE.Group();
    const sceneryGroup = new THREE.Group();
    const spawnsGroup = new THREE.Group();
    const itemsGroup = new THREE.Group();
    const encountersGroup = new THREE.Group();
    const firingPositionsGroup = new THREE.Group();
    const triggerVolumesGroup = new THREE.Group();
    const cutsceneCamerasGroup = new THREE.Group();
    const netgameFlagsGroup = new THREE.Group();

    haloRoot.add(bspGroup);
    haloRoot.add(vehiclesGroup);
    haloRoot.add(sceneryGroup);
    haloRoot.add(spawnsGroup);
    haloRoot.add(itemsGroup);
    haloRoot.add(encountersGroup);
    haloRoot.add(firingPositionsGroup);
    haloRoot.add(triggerVolumesGroup);
    haloRoot.add(cutsceneCamerasGroup);
    haloRoot.add(netgameFlagsGroup);

    const layerGroups = {
      bsp: bspGroup,
      vehicles: vehiclesGroup,
      scenery: sceneryGroup,
      spawns: spawnsGroup,
      items: itemsGroup,
      encounters: encountersGroup,
      firingPositions: firingPositionsGroup,
      triggerVolumes: triggerVolumesGroup,
      cutsceneCameras: cutsceneCamerasGroup,
      netgameFlags: netgameFlagsGroup,
    };
    layerGroupsRef.current = layerGroups;

    // TransformControls setup (use 'local' coordinate space so axes stick to the item as it rotates)
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.size = 0.75;
    transformControls.setSpace('local');
    transformControls.setMode(gizmoMode);
    const helper = transformControls.getHelper ? transformControls.getHelper() : (transformControls as unknown as THREE.Object3D);
    scene.add(helper);
    transformControlsRef.current = transformControls;

    transformControls.addEventListener('dragging-changed', (event) => {
      isTransformDraggingRef.current = !!event.value;
      if (event.value) {
        // Record start positions of all selected objects for multi-transform
        dragStartPositionsRef.current.clear();
        const allGroups = [
          ...(layerGroupsRef.current?.vehicles.children || []),
          ...(layerGroupsRef.current?.scenery.children || []),
          ...(layerGroupsRef.current?.spawns.children || []),
          ...(layerGroupsRef.current?.items.children || []),
          ...(layerGroupsRef.current?.encounters.children || []),
          ...(layerGroupsRef.current?.firingPositions.children || []),
          ...(layerGroupsRef.current?.triggerVolumes.children || []),
          ...(layerGroupsRef.current?.cutsceneCameras.children || []),
          ...(layerGroupsRef.current?.netgameFlags.children || []),
        ];
        for (const id of selectedObjectIdsRef.current) {
          const g = allGroups.find((grp) => grp.userData?.id === id);
          if (g) {
            dragStartPositionsRef.current.set(id, {
              pos: g.position.clone(),
              rot: new THREE.Euler().setFromQuaternion(g.quaternion, 'XYZ'),
            });
          }
        }
      }
    });

    transformControls.addEventListener('mouseUp', async () => {
      const attached = transformControls.object;
      if (!attached || !attached.userData?.id) return;
      const primaryId = attached.userData.id as string;

      const start = dragStartPositionsRef.current.get(primaryId);
      const deltaPos = start ? attached.position.clone().sub(start.pos) : new THREE.Vector3();

      const idsToUpdate = selectedObjectIdsRef.current.length > 0 ? selectedObjectIdsRef.current : [primaryId];
      const allGroups = [
        ...(layerGroupsRef.current?.vehicles.children || []),
        ...(layerGroupsRef.current?.scenery.children || []),
        ...(layerGroupsRef.current?.spawns.children || []),
        ...(layerGroupsRef.current?.items.children || []),
        ...(layerGroupsRef.current?.encounters.children || []),
        ...(layerGroupsRef.current?.firingPositions.children || []),
        ...(layerGroupsRef.current?.triggerVolumes.children || []),
        ...(layerGroupsRef.current?.cutsceneCameras.children || []),
        ...(layerGroupsRef.current?.netgameFlags.children || []),
      ];

      const undoItems: Array<{
        id: string;
        prevPos: [number, number, number];
        prevRot: [number, number, number];
      }> = [];

      for (const id of idsToUpdate) {
        const grp = allGroups.find((g) => g.userData?.id === id);
        if (grp) {
          const myStart = dragStartPositionsRef.current.get(id);
          if (myStart) {
            undoItems.push({
              id,
              prevPos: [myStart.pos.x, myStart.pos.y, myStart.pos.z],
              prevRot: [myStart.rot.z, -myStart.rot.y, myStart.rot.x],
            });
          }
          if (id !== primaryId && start && myStart) {
            grp.position.copy(myStart.pos.clone().add(deltaPos));
          }
          const newPos: [number, number, number] = [grp.position.x, grp.position.y, grp.position.z];
          const euler = new THREE.Euler().setFromQuaternion(grp.quaternion, 'XYZ');
          const newRot: [number, number, number] = [euler.z, -euler.y, euler.x];
          await callbacksRef.current.handleUpdatePlacement(id, { position: newPos, rotation: newRot });
        }
      }

      if (undoItems.length > 0) {
        undoStackRef.current.push({ type: 'transform', items: undoItems });
      }
    });

    // 6. Build BSP submeshes for visible BSPs
    syncBspMeshes();

    if (scenarioData) {
      populateScenarioObjects(scenarioData, layerGroups);
    }

    // Initial frame on bounds only on first load
    if (!hasInitialFramedRef.current && primaryMesh) {
      callbacksRef.current.frameScene(combinedBounds);
      hasInitialFramedRef.current = true;
    }

    // 7. Event Listeners
    const canvas = renderer.domElement;

    const getSelectedGroup = (): THREE.Object3D | null => {
      const id = selectedObjectIdRef.current;
      if (!id || !layerGroupsRef.current) return null;
      const allGroups = [
        ...layerGroupsRef.current.vehicles.children,
        ...layerGroupsRef.current.scenery.children,
        ...layerGroupsRef.current.spawns.children,
        ...layerGroupsRef.current.items.children,
        ...layerGroupsRef.current.encounters.children,
        ...layerGroupsRef.current.firingPositions.children,
        ...layerGroupsRef.current.triggerVolumes.children,
        ...layerGroupsRef.current.cutsceneCameras.children,
        ...layerGroupsRef.current.netgameFlags.children,
      ];
      return allGroups.find((g) => g.userData?.id === id) || null;
    };

    const recordCustomDragStart = (targetGroup: THREE.Object3D | null) => {
      if (!targetGroup) {
        customDragStartRef.current = null;
        return;
      }
      const euler = new THREE.Euler().setFromQuaternion(targetGroup.quaternion, 'XYZ');
      customDragStartRef.current = {
        pos: [targetGroup.position.x, targetGroup.position.y, targetGroup.position.z],
        rot: [euler.z, -euler.y, euler.x],
      };
    };

    const onMouseDown = (e: MouseEvent) => {
      const targetGroup = getSelectedGroup();
      setViewportContextMenu(null);
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY };

      if (e.button === 1) {
        // Middle Mouse Button (MMB)
        e.preventDefault();
        canvas.focus();
        if ((e.ctrlKey || e.metaKey) && targetGroup) {
          // Ctrl + MMB drag: orbit camera around the selected item (keeping it in centre)
          isCtrlMiddleOrbitRef.current = true;
          dragHasMovedRef.current = false;
        } else if (e.shiftKey && targetGroup) {
          // Shift + MMB drag: orbit/rotate selected item in all directions (true to global coords)
          isShiftMiddleRotateRef.current = true;
          dragHasMovedRef.current = false;
          recordCustomDragStart(targetGroup);
        } else if (targetGroup) {
          // MMB drag: drag selected item around
          isMiddleDraggingRef.current = true;
          dragHasMovedRef.current = false;
          recordCustomDragStart(targetGroup);
        }
      } else if (e.button === 0) {
        // Left Mouse Button (LMB)
        if (e.shiftKey && targetGroup) {
          // Shift + LMB drag: rotate selected item on horizontal plane (yaw around global Z, true to global coords)
          isShiftLeftRotateRef.current = true;
          dragHasMovedRef.current = false;
          recordCustomDragStart(targetGroup);
          canvas.focus();
        } else {
          // LMB drag: pan camera (or single click to select if movement < 6px)
          isLeftPanDraggingRef.current = true;
          dragHasMovedRef.current = false;
          canvas.focus();
        }
      } else if (e.button === 2) {
        // Right Mouse Button (RMB)
        if (e.shiftKey && targetGroup) {
          // Shift + RMB drag: rotate selected item on vertical plane (pitch/roll in global coords)
          isShiftRightRotateRef.current = true;
          dragHasMovedRef.current = false;
          recordCustomDragStart(targetGroup);
          canvas.focus();
        } else {
          // RMB drag: orbit camera (or right-click without drag for Quick Add Object menu)
          isRightMouseDownRef.current = true;
          canvas.focus();
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      const targetGroup = getSelectedGroup();
      const wasObjectDrag =
        isMiddleDraggingRef.current ||
        (isShiftLeftRotateRef.current && dragHasMovedRef.current) ||
        (isShiftRightRotateRef.current && dragHasMovedRef.current) ||
        (isShiftMiddleRotateRef.current && dragHasMovedRef.current);

      if (wasObjectDrag) {
        isMiddleDraggingRef.current = false;
        isShiftLeftRotateRef.current = false;
        isShiftRightRotateRef.current = false;
        isShiftMiddleRotateRef.current = false;
        if (dragHasMovedRef.current && targetGroup && selectedObjectIdRef.current) {
          if (customDragStartRef.current) {
            undoStackRef.current.push({
              type: 'transform',
              items: [
                {
                  id: selectedObjectIdRef.current,
                  prevPos: customDragStartRef.current.pos,
                  prevRot: customDragStartRef.current.rot,
                },
              ],
            });
            customDragStartRef.current = null;
          }
          const newPos: [number, number, number] = [
            targetGroup.position.x,
            targetGroup.position.y,
            targetGroup.position.z,
          ];
          const euler = new THREE.Euler().setFromQuaternion(targetGroup.quaternion, 'XYZ');
          const newRot: [number, number, number] = [euler.z, -euler.y, euler.x];
          callbacksRef.current.handleUpdatePlacement(selectedObjectIdRef.current, {
            position: newPos,
            rotation: newRot,
          });
        }
      }

      isMiddleDraggingRef.current = false;
      isCtrlMiddleOrbitRef.current = false;
      isShiftLeftRotateRef.current = false;
      isShiftRightRotateRef.current = false;
      isShiftMiddleRotateRef.current = false;

      if (e.button === 2) {
        isRightMouseDownRef.current = false;
      } else if (e.button === 0) {
        isLeftPanDraggingRef.current = false;
        if (!wasObjectDrag) {
          const dx = e.clientX - pointerDownPosRef.current.x;
          const dy = e.clientY - pointerDownPosRef.current.y;
          // If clicking without dragging and not interacting with the gizmo: raycast selection
          if (Math.hypot(dx, dy) < 6 && !isTransformDraggingRef.current) {
            const rect = canvas.getBoundingClientRect();
            const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);

            if (layerGroupsRef.current) {
              const interactiveRoots = [
                ...layerGroupsRef.current.vehicles.children,
                ...layerGroupsRef.current.scenery.children,
                ...layerGroupsRef.current.spawns.children,
                ...layerGroupsRef.current.items.children,
                ...layerGroupsRef.current.encounters.children,
                ...layerGroupsRef.current.firingPositions.children,
                ...layerGroupsRef.current.triggerVolumes.children,
                ...layerGroupsRef.current.cutsceneCameras.children,
                ...layerGroupsRef.current.netgameFlags.children,
              ];
              const hits = raycaster.intersectObjects(interactiveRoots, true);
              if (hits.length > 0) {
                let curr: THREE.Object3D | null = hits[0].object;
                while (curr && (!curr.userData || !curr.userData.id)) {
                  curr = curr.parent;
                }
                if (curr && curr.userData?.id) {
                  const clickedId = curr.userData.id as string;
                  if (e.ctrlKey || e.metaKey) {
                    // Multi-select with Ctrl: toggle clicked object if of the same entity kind
                    setSelectedObjectIds((prev) => {
                      if (prev.length === 0) return [clickedId];
                      const [prevKind] = prev[0].split('-');
                      const [clickedKind] = clickedId.split('-');
                      if (prevKind !== clickedKind) {
                        return [clickedId]; // Switch category selection
                      }
                      if (prev.includes(clickedId)) {
                        return prev.filter((id) => id !== clickedId);
                      }
                      return [...prev, clickedId];
                    });
                  } else {
                    setSelectedObjectIds([clickedId]);
                  }
                  return;
                }
              }
            }
            // Clicked empty background: deselect
            if (!e.ctrlKey && !e.metaKey) {
              setSelectedObjectIds([]);
            }
          }
        }
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const dx = e.clientX - pointerDownPosRef.current.x;
      const dy = e.clientY - pointerDownPosRef.current.y;
      if (Math.hypot(dx, dy) < 6 && !e.shiftKey && !e.altKey) {
        const rect = container.getBoundingClientRect();
        const x = Math.min(Math.max(8, e.clientX - rect.left), Math.max(8, rect.width - 200));
        const y = Math.min(Math.max(8, e.clientY - rect.top), Math.max(8, rect.height - 230));
        setViewportContextMenu({ x, y });
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const targetGroup = getSelectedGroup();

      // 1. Ctrl + MMB drag: orbit camera around the selected item (keeping it in centre)
      if (isCtrlMiddleOrbitRef.current && targetGroup) {
        dragHasMovedRef.current = true;
        // Convert Halo local coords [hx, hy, hz] to Three.js world coords [hx, hz, -hy]
        const pivot = new THREE.Vector3(
          targetGroup.position.x,
          targetGroup.position.z,
          -targetGroup.position.y,
        );
        const dist = Math.max(2.0, camPosRef.current.distanceTo(pivot));
        camEulerRef.current.yaw -= e.movementX * 0.004;
        camEulerRef.current.pitch -= e.movementY * 0.004;
        const limit = Math.PI / 2 - 0.02;
        camEulerRef.current.pitch = Math.max(-limit, Math.min(limit, camEulerRef.current.pitch));
        const { yaw, pitch } = camEulerRef.current;
        const forward = new THREE.Vector3(
          -Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch),
        );
        camPosRef.current.copy(pivot).addScaledVector(forward, -dist);
        return;
      }

      // 2. Shift + MMB drag: orbit/rotate selected item in all directions (true to global coords)
      if (isShiftMiddleRotateRef.current && targetGroup) {
        dragHasMovedRef.current = true;
        const qGlobalZ = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          -e.movementX * 0.015,
        );
        const qGlobalY = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          e.movementY * 0.015,
        );
        targetGroup.quaternion.premultiply(qGlobalZ).premultiply(qGlobalY);
        selectionBoxHelperRef.current?.update();
        return;
      }

      // 3. MMB drag: drag selected item around on horizontal plane
      if (isMiddleDraggingRef.current && targetGroup) {
        dragHasMovedRef.current = true;
        const yaw = camEulerRef.current.yaw;
        const moveRight = e.movementX * 0.05;
        const moveFwd = -e.movementY * 0.05;
        targetGroup.position.x += moveRight * Math.cos(yaw) + moveFwd * (-Math.sin(yaw));
        targetGroup.position.y += moveRight * Math.sin(yaw) + moveFwd * Math.cos(yaw);
        selectionBoxHelperRef.current?.update();
        return;
      }

      // 4. Shift + LMB drag: rotate selected item on horizontal plane (true to global Z axis)
      if (isShiftLeftRotateRef.current && targetGroup) {
        dragHasMovedRef.current = true;
        const qGlobalZ = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          -e.movementX * 0.015,
        );
        targetGroup.quaternion.premultiply(qGlobalZ);
        selectionBoxHelperRef.current?.update();
        return;
      }

      // 5. Shift + RMB drag: rotate selected item on vertical plane (true to global X/Y axes)
      if (isShiftRightRotateRef.current && targetGroup) {
        dragHasMovedRef.current = true;
        const qGlobalY = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          e.movementY * 0.015,
        );
        const qGlobalX = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          e.movementX * 0.015,
        );
        targetGroup.quaternion.premultiply(qGlobalY).premultiply(qGlobalX);
        selectionBoxHelperRef.current?.update();
        return;
      }

      // 6. LMB drag (when not dragging gizmo): pan camera
      if (isLeftPanDraggingRef.current && !isTransformDraggingRef.current) {
        const dx = e.clientX - pointerDownPosRef.current.x;
        const dy = e.clientY - pointerDownPosRef.current.y;
        if (Math.hypot(dx, dy) >= 4 || dragHasMovedRef.current) {
          dragHasMovedRef.current = true;
          const { yaw, pitch } = camEulerRef.current;
          const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
          const up = new THREE.Vector3(
            -Math.sin(yaw) * Math.sin(pitch),
            Math.cos(pitch),
            -Math.cos(yaw) * Math.sin(pitch),
          );
          const panScale = Math.max(0.03, speedRef.current * 0.0012);
          camPosRef.current.addScaledVector(right, -e.movementX * panScale);
          camPosRef.current.addScaledVector(up, e.movementY * panScale);
        }
        return;
      }

      // 7. RMB drag: orbit camera
      if (isRightMouseDownRef.current) {
        camEulerRef.current.yaw -= e.movementX * 0.003;
        camEulerRef.current.pitch -= e.movementY * 0.003;
        const limit = Math.PI / 2 - 0.02;
        camEulerRef.current.pitch = Math.max(-limit, Math.min(limit, camEulerRef.current.pitch));
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      keysDownRef.current.add(e.code);

      if (e.code === 'KeyR' && !(e.ctrlKey || e.metaKey)) {
        callbacksRef.current.frameScene();
      } else if (e.code === 'KeyG' && !(e.ctrlKey || e.metaKey)) {
        callbacksRef.current.snapSelectedToGround();
      } else if (e.code === 'KeyC' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        callbacksRef.current.handleCopyPlacement();
      } else if (e.code === 'KeyX' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        callbacksRef.current.handleCutPlacement();
      } else if (e.code === 'KeyV' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        callbacksRef.current.handlePastePlacement();
      } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        callbacksRef.current.handleUndo();
      } else if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const id = selectedObjectIdRef.current;
        if (id) callbacksRef.current.handleDuplicatePlacement(id);
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        const id = selectedObjectIdRef.current;
        if (id) callbacksRef.current.handleDeletePlacement(id);
      } else if (e.code === 'KeyT' && !(e.ctrlKey || e.metaKey)) {
        setGizmoMode('translate');
      } else if (e.code === 'KeyY' && !(e.ctrlKey || e.metaKey)) {
        setGizmoMode('rotate');
      } else if (e.code === 'KeyF' && !(e.ctrlKey || e.metaKey)) {
        const id = selectedObjectIdRef.current;
        if (id) callbacksRef.current.focusOnObject(id);
      } else if (e.code === 'Escape') {
        setSelectedObjectId(null);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysDownRef.current.delete(e.code);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCameraSpeed((prev) => {
        const delta = e.deltaY < 0 ? 10 : -10;
        return Math.max(10, Math.min(400, prev + delta));
      });
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // 8. Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0 && cameraRef.current && rendererRef.current) {
          cameraRef.current.aspect = w / h;
          cameraRef.current.updateProjectionMatrix();
          rendererRef.current.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    // 9. Animation loop
    let animId = 0;
    let lastTime = performance.now();
    let displayThrottle = 0;

    const animate = (time: number) => {
      animId = requestAnimationFrame(animate);

      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      const keys = keysDownRef.current;
      const { yaw, pitch } = camEulerRef.current;
      const pos = camPosRef.current;

      // Only fly camera when gizmo is not being actively dragged
      if (!isTransformDraggingRef.current) {
        const forward = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const up = new THREE.Vector3(0, 1, 0);

        const move = new THREE.Vector3();
        if (keys.has('KeyW')) move.add(forward);
        if (keys.has('KeyS')) move.sub(forward);
        if (keys.has('KeyD')) move.add(right);
        if (keys.has('KeyA')) move.sub(right);
        if (keys.has('Space')) move.add(up);
        if (keys.has('KeyC')) move.sub(up);

        if (move.lengthSq() > 0) {
          move.normalize();
          const speedMultiplier = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.5 : 1.0;
          move.multiplyScalar(speedRef.current * speedMultiplier * dt);
          pos.add(move);
        }
      }

      camera.position.copy(pos);
      const lookTarget = new THREE.Vector3().copy(pos).add(
        new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)),
      );
      camera.lookAt(lookTarget);

      headLight.position.copy(pos);

      if (selectionBoxHelperRef.current) {
        selectionBoxHelperRef.current.update();
      }
      if (partnerBoxHelperRef.current) {
        partnerBoxHelperRef.current.update();
      }
      for (const h of kothZoneHelpersRef.current) {
        h.update();
      }
      for (const h of multiSelectionHelpersRef.current) {
        h.update();
      }

      renderer.render(scene, camera);

      // Render real-time Blender-like 3D Orientation Gizmo
      if (gizmoCanvasRef.current) {
        const gCtx = gizmoCanvasRef.current.getContext('2d');
        if (gCtx) {
          gCtx.clearRect(0, 0, 90, 90);

          // Background disk
          gCtx.beginPath();
          gCtx.arc(45, 45, 38, 0, Math.PI * 2);
          gCtx.fillStyle = 'rgba(21, 25, 33, 0.85)';
          gCtx.fill();
          gCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
          gCtx.lineWidth = 1.5;
          gCtx.stroke();

          // Camera rotation matrix
          const rotMat = new THREE.Matrix4().extractRotation(camera.matrixWorldInverse);

          // Three.js world axes corresponding to Halo coordinates:
          // Halo +X (Red): Three.js (1, 0, 0)
          // Halo +Y (Green): Three.js (0, 0, -1)
          // Halo +Z (Blue): Three.js (0, 1, 0)
          const axes = [
            { id: 'x' as const, label: 'X', dir: new THREE.Vector3(1, 0, 0), color: '#ef5350', isNegative: false },
            { id: '-x' as const, label: '-X', dir: new THREE.Vector3(-1, 0, 0), color: '#ef5350', isNegative: true },
            { id: 'y' as const, label: 'Y', dir: new THREE.Vector3(0, 0, -1), color: '#66bb6a', isNegative: false },
            { id: '-y' as const, label: '-Y', dir: new THREE.Vector3(0, 0, 1), color: '#66bb6a', isNegative: true },
            { id: 'z' as const, label: 'Z', dir: new THREE.Vector3(0, 1, 0), color: '#42a5f5', isNegative: false },
            { id: '-z' as const, label: '-Z', dir: new THREE.Vector3(0, -1, 0), color: '#42a5f5', isNegative: true },
          ];

          const projected = axes.map((a) => {
            const v = a.dir.clone().applyMatrix4(rotMat);
            return {
              ...a,
              sx: 45 + v.x * 26,
              sy: 45 - v.y * 26,
              sz: v.z, // depth: positive means pointing away, negative means pointing towards camera
            };
          });

          // Sort from furthest to closest (back to front)
          projected.sort((a, b) => b.sz - a.sz);

          for (const a of projected) {
            // Draw axis line from center
            gCtx.beginPath();
            gCtx.moveTo(45, 45);
            gCtx.lineTo(a.sx, a.sy);
            gCtx.strokeStyle = a.isNegative ? 'rgba(255, 255, 255, 0.2)' : a.color;
            gCtx.lineWidth = a.isNegative ? 1.5 : 2.5;
            gCtx.stroke();

            // Draw axis circle / dot
            gCtx.beginPath();
            const r = a.isNegative ? 4 : 8;
            gCtx.arc(a.sx, a.sy, r, 0, Math.PI * 2);
            gCtx.fillStyle = a.isNegative ? 'rgba(150, 150, 150, 0.7)' : a.color;
            gCtx.fill();
            gCtx.strokeStyle = '#fff';
            gCtx.lineWidth = 1;
            gCtx.stroke();

            if (!a.isNegative) {
              gCtx.fillStyle = '#fff';
              gCtx.font = 'bold 9px sans-serif';
              gCtx.textAlign = 'center';
              gCtx.textBaseline = 'middle';
              gCtx.fillText(a.label, a.sx, a.sy);
            }
          }
        }
      }

      displayThrottle += dt;
      if (displayThrottle > 0.1) {
        displayThrottle = 0;
        setCameraPosDisplay({
          x: Math.round(pos.x),
          y: Math.round(-pos.z),
          z: Math.round(pos.y),
        });
      }
    };
    animId = requestAnimationFrame(animate);

    // Cleanup
    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('wheel', onWheel);

      transformControls.dispose();
      transformControlsRef.current = null;
      if (selectionBoxHelperRef.current) {
        scene.remove(selectionBoxHelperRef.current);
        selectionBoxHelperRef.current.dispose();
        selectionBoxHelperRef.current = null;
      }

      for (const item of submeshMeshesRef.current) {
        item.mesh.geometry.dispose();
        item.lines.geometry.dispose();
        (item.lines.material as THREE.Material).dispose();
        item.solidMat.dispose();
      }
      submeshMeshesRef.current = [];
      bspChildGroupsRef.current.clear();

      for (const item of objectMeshesRef.current) {
        item.mesh.geometry.dispose();
        if (item.lines) {
          item.lines.geometry.dispose();
          (item.lines.material as THREE.Material).dispose();
        }
        item.solidMat.dispose();
      }
      objectMeshesRef.current = [];
      layerGroupsRef.current = null;
      textureCacheRef.current.clear();
      modelCacheRef.current.clear();

      renderer.dispose();
      if (canvas.parentElement) {
        canvas.parentElement.removeChild(canvas);
      }
    };
  }, [webGLSupported, primaryMesh !== null, header.scenarioName, header.crc32]);

  // Outliner items filtering
  const filteredOutlinerObjects = useMemo(() => {
    if (!scenarioData) return [];
    return scenarioData.objects.filter((obj) => {
      if (outlinerFilter !== 'all' && obj.kind !== outlinerFilter) return false;
      if (outlinerSearch.trim()) {
        const query = outlinerSearch.toLowerCase();
        return obj.id.toLowerCase().includes(query) || obj.objectPath.toLowerCase().includes(query);
      }
      return true;
    });
  }, [scenarioData, outlinerFilter, outlinerSearch]);

  return (
    <div
      data-testid="scenario-viewport"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        background: '#13171f',
        overflow: 'hidden',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {/* Top HUD Controls Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          background: 'rgba(21, 23, 28, 0.92)',
          borderBottom: '1px solid var(--border)',
          zIndex: 10,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {/* Scenario / BSP info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12 }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{header.scenarioName}</span>
          <span style={{ color: 'var(--text-dim)' }}>|</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            BSP {visibleBspIndices.join(', ')} ({totalSubmeshes} submeshes)
          </span>
          <span style={{ color: 'var(--text-dim)' }}>|</span>
          <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
            {totalVertices.toLocaleString()} verts / {totalTriangles.toLocaleString()} tris
          </span>
        </div>

        {/* Layer Visibility Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginRight: 2 }}>Layers:</span>
          {(
            [
              ['bsp', 'layer-toggle-bsp', 'BSP', null],
              ['vehicles', 'layer-toggle-vehicles', 'Vehicles', scenarioData?.counts.vehicles],
              ['scenery', 'layer-toggle-scenery', 'Scenery', scenarioData?.counts.scenery],
              ['spawns', 'layer-toggle-spawns', 'Spawns', scenarioData?.counts.spawns],
              ['items', 'layer-toggle-items', 'Items', scenarioData ? scenarioData.counts.weapons + scenarioData.counts.equipment : null],
              ['encounters', 'layer-toggle-encounters', 'AI Squads', scenarioData?.counts.encounters],
              ['firingPositions', 'layer-toggle-firing-positions', 'Firing Points', scenarioData?.counts.firingPositions],
              ['triggerVolumes', 'layer-toggle-trigger-volumes', 'Triggers', scenarioData?.counts.triggerVolumes],
              ['cutsceneCameras', 'layer-toggle-cutscene-cameras', 'Cameras', scenarioData?.counts.cutsceneCameras],
              ['netgameFlags', 'layer-toggle-netgame-flags', 'Flags', scenarioData?.counts.netgameFlags],
            ] as const
          ).map(([layerKey, testId, label, count]) => {
            const active = visibleLayers[layerKey];
            return (
              <button
                key={layerKey}
                data-testid={testId}
                onClick={() => setVisibleLayers((p) => ({ ...p, [layerKey]: !p[layerKey] }))}
                style={{
                  background: active ? 'var(--bg-main)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-dim)',
                  border: `1px solid ${active ? 'var(--accent-cyan)' : 'var(--border)'}`,
                  borderRadius: 3,
                  padding: '2px 7px',
                  fontSize: 11,
                  fontWeight: active ? 600 : 400,
                  opacity: active ? 1 : 0.6,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title={`Toggle ${label} layer`}
              >
                <span style={{ color: active ? 'var(--accent-cyan)' : 'var(--text-dim)' }}>{active ? '✓' : '✗'}</span>
                <span>{label}</span>
                {count !== null && count !== undefined && (
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--mono-font)' }}>
                    ({count})
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Viewport Render Controls & Modding Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Add Object Button */}
          <button
            data-testid="viewport-add-object-btn"
            onClick={() => setShowAddModal(true)}
            style={{
              background: '#2e7d32',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="Add a new object or spawn to the scenario"
          >
            <span>+</span> Add Object
          </button>

          {/* Multi-BSP Selector for campaign maps */}
          {bspCount > 1 && (
            <div ref={bspDropdownRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <button
                data-testid="viewport-bsp-selector"
                onClick={() => setBspDropdownOpen((prev) => !prev)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'var(--bg-main)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  cursor: 'pointer',
                  outline: 'none',
                }}
                title="Toggle Structure BSPs to render simultaneously"
              >
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>BSPs:</span>
                <span>{visibleBspIndices.length} / {bspCount} visible</span>
                <span style={{ fontSize: 9 }}>▼</span>
              </button>

              {bspDropdownOpen && (
                <div
                  data-testid="viewport-bsp-dropdown-menu"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 4,
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                    zIndex: 50,
                    minWidth: 240,
                    padding: '6px 0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '4px 10px 6px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 10.5,
                      color: 'var(--text-dim)',
                    }}
                  >
                    <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>Structure BSPs</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        data-testid="bsp-show-all-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setVisibleBspIndices(Array.from({ length: bspCount }, (_, i) => i));
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent-cyan)',
                          cursor: 'pointer',
                          fontSize: 10.5,
                          padding: 0,
                        }}
                      >
                        Show All
                      </button>
                      <span>|</span>
                      <button
                        data-testid="bsp-reset-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setVisibleBspIndices([0]);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: 10.5,
                          padding: 0,
                        }}
                      >
                        Reset (0)
                      </button>
                    </div>
                  </div>
                  {(bspNames.length > 0 ? bspNames : Array.from({ length: bspCount }, (_, i) => `BSP ${i}`)).map((name, idx) => {
                    const isVisible = visibleBspIndices.includes(idx);
                    return (
                      <div
                        key={idx}
                        data-testid={`viewport-bsp-toggle-${idx}`}
                        onClick={() => {
                          setVisibleBspIndices((prev) => {
                            if (prev.includes(idx)) {
                              if (prev.length <= 1) return prev; // Keep at least one BSP visible
                              return prev.filter((i) => i !== idx);
                            } else {
                              return [...prev, idx];
                            }
                          });
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 12px',
                          cursor: 'pointer',
                          background: isVisible ? 'rgba(0, 229, 255, 0.12)' : 'transparent',
                          color: isVisible ? 'var(--accent-cyan)' : 'var(--text-primary)',
                          fontSize: 11,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={() => {}} // Controlled by row click
                          style={{ cursor: 'pointer', accentColor: 'var(--accent-cyan)' }}
                        />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>
                          BSP {idx}: {name.split('/').pop() || name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Mode Selector */}
          <div style={{ display: 'flex', background: 'var(--bg-main)', borderRadius: 4, padding: 2, border: '1px solid var(--border)' }}>
            {(
              [
                ['textured-wireframe', 'Textured + Wire'],
                ['textured', 'Textured'],
                ['wireframe', 'Wireframe'],
                ['flat', 'Flat'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                data-testid={`viewport-mode-${mode}`}
                onClick={() => setRenderMode(mode)}
                style={{
                  background: renderMode === mode ? 'var(--accent-cyan)' : 'transparent',
                  color: renderMode === mode ? '#000' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 3,
                  padding: '3px 9px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Speed slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
            <span>Speed:</span>
            <input
              data-testid="viewport-speed-control"
              type="range"
              min="10"
              max="350"
              step="5"
              value={cameraSpeed}
              onChange={(e) => setCameraSpeed(Number(e.target.value))}
              style={{ width: 70, accentColor: 'var(--accent-cyan)' }}
              title={`Flight speed: ${cameraSpeed} units/s`}
            />
            <span style={{ width: 34, fontFamily: 'var(--mono-font)', fontSize: 10.5 }}>{cameraSpeed}</span>
          </div>

          {/* Frame scene / Reset camera */}
          <button
            data-testid="viewport-reset-camera"
            onClick={() => frameScene()}
            style={{
              background: 'var(--bg-panel)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
            }}
            title="Center camera on map (R key)"
          >
            [R] Frame Scene
          </button>



          {/* Inspector Panel Toggle Button */}
          <button
            data-testid="viewport-toggle-inspector-btn"
            onClick={() => setShowInspector((prev) => !prev)}
            style={{
              background: showInspector ? 'var(--accent-cyan)' : 'var(--bg-panel)',
              color: showInspector ? '#000' : 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            title="Toggle Scenario Object Inspector & Outliner"
          >
            {showInspector ? 'Hide Inspector' : 'Inspector'}
          </button>
        </div>
      </div>

      {/* Main Middle Row: 3D Canvas + Side Inspector Panel */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        {/* Main 3D Canvas Container */}
        <div
          ref={containerRef}
          data-testid="viewport-canvas-container"
          tabIndex={0}
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            position: 'relative',
            outline: 'none',
          }}
        />

        {/* View Cube / Orientation XYZ Gizmo (Top-Right of Viewport) */}
        <div
          data-testid="viewport-orientation-gizmo"
          style={{
            position: 'absolute',
            top: 12,
            right: showInspector ? 342 : 12,
            zIndex: 10,
            background: 'rgba(21, 25, 33, 0.85)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 8px',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            View Orientation
          </div>

          {/* Dynamic 3D Rotating Blender-Style Coordinate Gizmo */}
          <canvas
            ref={gizmoCanvasRef}
            width={90}
            height={90}
            data-testid="orientation-gizmo-canvas"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const mx = e.clientX - rect.left;
              const my = e.clientY - rect.top;
              if (!cameraRef.current) return;
              const rotMat = new THREE.Matrix4().extractRotation(cameraRef.current.matrixWorldInverse);
              const axes = [
                { id: 'x' as const, dir: new THREE.Vector3(1, 0, 0) },
                { id: '-x' as const, dir: new THREE.Vector3(-1, 0, 0) },
                { id: 'y' as const, dir: new THREE.Vector3(0, 0, -1) },
                { id: '-y' as const, dir: new THREE.Vector3(0, 0, 1) },
                { id: 'z' as const, dir: new THREE.Vector3(0, 1, 0) },
                { id: '-z' as const, dir: new THREE.Vector3(0, -1, 0) },
              ];
              for (const a of axes) {
                const v = a.dir.clone().applyMatrix4(rotMat);
                const sx = 45 + v.x * 26;
                const sy = 45 - v.y * 26;
                if (Math.hypot(mx - sx, my - sy) < 14) {
                  alignCameraView(a.id);
                  return;
                }
              }
            }}
            style={{ cursor: 'pointer', display: 'block' }}
            title="Click an axis to align view"
          />

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <button
              data-testid="orientation-btn-iso"
              title="Reset to Isometric View"
              onClick={() => { alignCameraView('iso'); }}
              style={{
                width: '100%',
                maxWidth: 64,
                height: 22,
                background: 'var(--bg-main)',
                color: 'var(--accent-cyan)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                transition: 'background 0.15s, border-color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.borderColor = 'var(--accent-cyan)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-main)';
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              ISO
            </button>
          </div>
        </div>

        {/* Collapsible Inspector / Outliner Side Panel (Step 9) */}
        {showInspector && (
          <div
            data-testid="scenario-inspector-panel"
            style={{
              width: 330,
              minWidth: 330,
              flexShrink: 0,
              height: '100%',
              background: 'rgba(21, 25, 33, 0.95)',
              borderLeft: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 15,
              fontSize: 11.5,
              color: 'var(--text-primary)',
            }}
          >
            {/* Panel Tabs */}
            <div
              style={{
                display: 'flex',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-main)',
              }}
            >
              <button
                data-testid="inspector-tab-properties"
                onClick={() => setInspectorTab('properties')}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  background: inspectorTab === 'properties' ? 'rgba(21, 25, 33, 0.95)' : 'transparent',
                  color: inspectorTab === 'properties' ? 'var(--accent-cyan)' : 'var(--text-dim)',
                  border: 'none',
                  borderBottom: inspectorTab === 'properties' ? '2px solid var(--accent-cyan)' : 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Properties {selectedPlacement ? `(${selectedPlacement.id})` : ''}
              </button>
              <button
                data-testid="inspector-tab-outliner"
                onClick={() => setInspectorTab('outliner')}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  background: inspectorTab === 'outliner' ? 'rgba(21, 25, 33, 0.95)' : 'transparent',
                  color: inspectorTab === 'outliner' ? 'var(--accent-cyan)' : 'var(--text-dim)',
                  border: 'none',
                  borderBottom: inspectorTab === 'outliner' ? '2px solid var(--accent-cyan)' : 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Outliner ({scenarioData?.totalObjects ?? 0})
              </button>
            </div>

            {/* Tab Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {inspectorTab === 'properties' ? (
                selectedPlacement ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Object Header Info */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 10px',
                        background: 'var(--bg-panel)',
                        borderRadius: 4,
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--accent-cyan)', fontSize: 13 }}>
                          {selectedPlacement.id}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
                          {selectedPlacement.objectPath}
                        </div>
                      </div>
                      <span
                        style={{
                          textTransform: 'uppercase',
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 3,
                          background:
                            selectedPlacement.kind === 'vehicle'
                              ? '#1565c0'
                              : selectedPlacement.kind === 'spawn'
                                ? '#c62828'
                                : selectedPlacement.kind === 'scenery'
                                  ? '#00838f'
                                  : '#ef6c00',
                          color: '#fff',
                        }}
                      >
                        {selectedPlacement.kind}
                      </span>
                    </div>

                    {/* Transform Gizmo Mode Switcher */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                        Gizmo Mode
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          data-testid="gizmo-mode-translate"
                          onClick={() => setGizmoMode('translate')}
                          style={{
                            flex: 1,
                            padding: '5px 8px',
                            background: gizmoMode === 'translate' ? 'var(--accent-cyan)' : 'var(--bg-main)',
                            color: gizmoMode === 'translate' ? '#000' : 'var(--text-primary)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >
                          Translate (T)
                        </button>
                        <button
                          data-testid="gizmo-mode-rotate"
                          onClick={() => setGizmoMode('rotate')}
                          style={{
                            flex: 1,
                            padding: '5px 8px',
                            background: gizmoMode === 'rotate' ? 'var(--accent-cyan)' : 'var(--bg-main)',
                            color: gizmoMode === 'rotate' ? '#000' : 'var(--text-primary)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >
                          Rotate (Y)
                        </button>
                      </div>
                    </div>

                    {/* Palette Selector (if applicable) */}
                    {(selectedPlacement.kind === 'vehicle' ||
                      selectedPlacement.kind === 'scenery' ||
                      selectedPlacement.kind === 'biped' ||
                      selectedPlacement.kind === 'weapon' ||
                      selectedPlacement.kind === 'equipment') &&
                      scenarioData && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                            Type Palette
                          </label>
                          <select
                            data-testid="inspector-palette-select"
                            value={selectedPlacement.paletteIndex}
                            onChange={(e) =>
                              handleUpdatePlacement(selectedPlacement.id, {
                                paletteIndex: parseInt(e.target.value, 10),
                              })
                            }
                            style={{
                              background: 'var(--bg-main)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: 4,
                              padding: '5px 8px',
                              fontSize: 11.5,
                              outline: 'none',
                            }}
                          >
                            {(
                              scenarioData.palettes[
                                selectedPlacement.kind === 'weapon'
                                  ? 'weapons'
                                  : selectedPlacement.kind === 'equipment'
                                    ? 'equipment'
                                    : selectedPlacement.kind === 'vehicle'
                                      ? 'vehicles'
                                      : selectedPlacement.kind === 'scenery'
                                        ? 'scenery'
                                        : selectedPlacement.kind === 'biped'
                                          ? 'bipeds'
                                          : 'weapons'
                              ] || []
                            ).map((p) => (
                              <option key={p.paletteIndex} value={p.paletteIndex}>
                                #{p.paletteIndex}: {p.name || p.path}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                    {/* Team Index (if spawn) */}
                    {selectedPlacement.kind === 'spawn' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                          Team
                        </label>
                        <select
                          data-testid="inspector-team-select"
                          value={selectedPlacement.teamIndex ?? 0}
                          onChange={(e) =>
                            handleUpdatePlacement(selectedPlacement.id, {
                              teamIndex: parseInt(e.target.value, 10),
                            })
                          }
                          style={{
                            background: 'var(--bg-main)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            padding: '5px 8px',
                            fontSize: 11.5,
                            outline: 'none',
                          }}
                        >
                          <option value={0}>0 - Red Team</option>
                          <option value={1}>1 - Blue Team</option>
                          <option value={2}>2 - Yellow / FFA / None</option>
                        </select>
                      </div>
                    )}

                    {/* Force Spawn in Multiplayer Toggle (Vehicles & Items) */}
                    {(selectedPlacement.kind === 'vehicle' ||
                      selectedPlacement.kind === 'weapon' ||
                      selectedPlacement.kind === 'equipment') && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 8px',
                          background: 'var(--bg-main)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                            Force Spawn
                          </span>
                          <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>
                            Enable in all multiplayer gametypes
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          data-testid="inspector-force-spawn-toggle"
                          checked={selectedPlacement.forceSpawn ?? true}
                          onChange={(e) => {
                            handleUpdatePlacement(selectedPlacement.id, { forceSpawn: e.target.checked });
                          }}
                          style={{ cursor: 'pointer', width: 16, height: 16, accentColor: 'var(--accent-cyan)' }}
                        />
                      </div>
                    )}

                    {/* Trigger Volume Extents */}
                    {selectedPlacement.kind === 'trigger_volume' && selectedPlacement.extents && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                          Volume Extents (dx, dy, dz)
                        </div>
                        <div style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--accent-cyan)' }}>
                          {selectedPlacement.extents.map((v) => v.toFixed(2)).join(' × ')} m
                        </div>
                      </div>
                    )}

                    {/* Firing Position Group */}
                    {selectedPlacement.kind === 'firing_position' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                          Firing Position Group
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#ffd54f' }}>
                          Group {selectedPlacement.groupLetter || 'A'}
                        </div>
                      </div>
                    )}

                    {/* Cutscene Camera FOV */}
                    {selectedPlacement.kind === 'cutscene_camera' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                          Field of View
                        </div>
                        <div style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--accent-cyan)' }}>
                          {(((selectedPlacement.fieldOfView || 1.22) * 180) / Math.PI).toFixed(1)}° ({((selectedPlacement.fieldOfView || 1.22)).toFixed(3)} rad)
                        </div>
                      </div>
                    )}

                    {/* Teleporter Pair Controls */}
                    {selectedPlacement.kind === 'netgame_flag' && (selectedPlacement.paletteIndex === 6 || selectedPlacement.paletteIndex === 7) && (
                      <div
                        data-testid="inspector-teleport-controls"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          padding: 8,
                          background: 'rgba(0, 229, 255, 0.08)',
                          border: '1px solid rgba(0, 229, 255, 0.3)',
                          borderRadius: 4,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent-cyan)', textTransform: 'uppercase' }}>
                            Teleporter Pair ({selectedPlacement.paletteIndex === 6 ? 'Origin' : 'Destination'})
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                            Teleporter ID:
                          </span>
                          <input
                            data-testid="inspector-teleport-id-input"
                            type="number"
                            min="0"
                            value={selectedPlacement.teamIndex ?? 0}
                            onChange={async (e) => {
                              const newId = parseInt(e.target.value, 10);
                              if (!isNaN(newId)) {
                                const oldId = selectedPlacement.teamIndex;
                                const partnerType = selectedPlacement.paletteIndex === 6 ? 7 : 6;
                                const partner = scenarioData?.objects.find(
                                  (o) => o.kind === 'netgame_flag' && o.paletteIndex === partnerType && o.teamIndex === oldId,
                                );
                                await handleUpdatePlacement(selectedPlacement.id, { teamIndex: newId });
                                if (partner) {
                                  await handleUpdatePlacement(partner.id, { teamIndex: newId });
                                }
                              }
                            }}
                            style={{
                              width: 70,
                              background: 'var(--bg-main)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: 3,
                              padding: '3px 5px',
                              fontSize: 11,
                              fontFamily: 'var(--mono-font)',
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <button
                            data-testid="inspector-teleport-switch-origin"
                            onClick={() => {
                              const origin = scenarioData?.objects.find(
                                (o) => o.kind === 'netgame_flag' && o.paletteIndex === 6 && o.teamIndex === selectedPlacement.teamIndex,
                              );
                              if (origin) {
                                setSelectedObjectId(origin.id);
                                focusOnObject(origin.id);
                              }
                            }}
                            style={{
                              flex: 1,
                              padding: '4px 6px',
                              fontSize: 10.5,
                              fontWeight: 600,
                              background: selectedPlacement.paletteIndex === 6 ? 'var(--accent-cyan)' : 'var(--bg-main)',
                              color: selectedPlacement.paletteIndex === 6 ? '#000' : 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: 3,
                              cursor: 'pointer',
                            }}
                          >
                            Switch to Origin
                          </button>
                          <button
                            data-testid="inspector-teleport-switch-dest"
                            onClick={() => {
                              const dest = scenarioData?.objects.find(
                                (o) => o.kind === 'netgame_flag' && o.paletteIndex === 7 && o.teamIndex === selectedPlacement.teamIndex,
                              );
                              if (dest) {
                                setSelectedObjectId(dest.id);
                                focusOnObject(dest.id);
                              }
                            }}
                            style={{
                              flex: 1,
                              padding: '4px 6px',
                              fontSize: 10.5,
                              fontWeight: 600,
                              background: selectedPlacement.paletteIndex === 7 ? '#76ff03' : 'var(--bg-main)',
                              color: selectedPlacement.paletteIndex === 7 ? '#000' : 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: 3,
                              cursor: 'pointer',
                            }}
                          >
                            Switch to Destination
                          </button>
                        </div>
                      </div>
                    )}

                    {/* King of the Hill (KOTH Zone) Controls */}
                    {selectedPlacement.kind === 'netgame_flag' && selectedPlacement.paletteIndex === 8 && (
                      <div
                        data-testid="inspector-koth-controls"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          padding: 8,
                          background: 'rgba(255, 152, 0, 0.08)',
                          border: '1px solid rgba(255, 152, 0, 0.35)',
                          borderRadius: 4,
                        }}
                      >
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#ffa726', textTransform: 'uppercase' }}>
                          King of the Hill (KOTH Zone)
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                            KOTH ID:
                          </span>
                          <input
                            data-testid="inspector-koth-id-input"
                            type="number"
                            min="0"
                            value={selectedPlacement.teamIndex ?? 0}
                            onChange={async (e) => {
                              const newId = parseInt(e.target.value, 10);
                              if (!isNaN(newId)) {
                                const oldId = selectedPlacement.teamIndex;
                                const zone = (scenarioData?.objects || []).filter(
                                  (o) => o.kind === 'netgame_flag' && o.paletteIndex === 8 && o.teamIndex === oldId,
                                );
                                for (const pt of zone) {
                                  await handleUpdatePlacement(pt.id, { teamIndex: newId });
                                }
                              }
                            }}
                            style={{
                              width: 70,
                              background: 'var(--bg-main)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: 3,
                              padding: '3px 5px',
                              fontSize: 11,
                              fontFamily: 'var(--mono-font)',
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              data-testid="inspector-koth-add-point"
                              onClick={async () => {
                                const pos = selectedPlacement.position;
                                await window.opence.addScenarioPlacement(
                                  'netgame_flag',
                                  8,
                                  [pos[0] + 1.0, pos[1], pos[2]],
                                  selectedPlacement.rotation,
                                  selectedPlacement.teamIndex ?? 0,
                                );
                                const res = await window.opence.getScenarioObjects();
                                if (res && res.ok) setScenarioData(res.summary);
                              }}
                              style={{
                                flex: 1,
                                padding: '4px 6px',
                                fontSize: 10.5,
                                fontWeight: 600,
                                background: 'var(--bg-main)',
                                color: '#ffa726',
                                border: '1px solid rgba(255, 152, 0, 0.4)',
                                borderRadius: 3,
                                cursor: 'pointer',
                              }}
                            >
                              + Add Point
                            </button>
                            <button
                              data-testid="inspector-koth-remove-point"
                              onClick={() => handleDeletePlacement(selectedPlacement.id)}
                              style={{
                                flex: 1,
                                padding: '4px 6px',
                                fontSize: 10.5,
                                fontWeight: 600,
                                background: 'var(--bg-main)',
                                color: '#ff6b6b',
                                border: '1px solid rgba(255, 107, 107, 0.4)',
                                borderRadius: 3,
                                cursor: 'pointer',
                              }}
                            >
                              Remove Point
                            </button>
                          </div>
                          <button
                            data-testid="inspector-koth-select-zone"
                            onClick={() => {
                              const oldId = selectedPlacement.teamIndex;
                              const zone = (scenarioData?.objects || []).filter(
                                (o) => o.kind === 'netgame_flag' && o.paletteIndex === 8 && o.teamIndex === oldId,
                              );
                              setSelectedObjectIds(zone.map((pt) => pt.id));
                            }}
                            style={{
                              width: '100%',
                              padding: '5px 6px',
                              fontSize: 11,
                              fontWeight: 600,
                              background: 'rgba(255, 152, 0, 0.15)',
                              color: '#ffa726',
                              border: '1px solid rgba(255, 152, 0, 0.45)',
                              borderRadius: 3,
                              cursor: 'pointer',
                            }}
                            title="Select all points in this KOTH zone to move or delete them all together"
                          >
                            Select Full Zone (Move All)
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Race Marker Controls */}
                    {selectedPlacement.kind === 'netgame_flag' && (selectedPlacement.paletteIndex === 3 || selectedPlacement.paletteIndex === 4) && (
                      <div
                        data-testid="inspector-race-controls"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          padding: 8,
                          background: 'rgba(244, 67, 54, 0.08)',
                          border: '1px solid rgba(244, 67, 54, 0.35)',
                          borderRadius: 4,
                        }}
                      >
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#ef5350', textTransform: 'uppercase' }}>
                          Race Track Checkpoint
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                            Race Checkpoint ID:
                          </span>
                          <input
                            data-testid="inspector-race-id-input"
                            type="number"
                            min="0"
                            value={selectedPlacement.teamIndex ?? 0}
                            onChange={(e) => {
                              const newId = parseInt(e.target.value, 10);
                              if (!isNaN(newId)) {
                                handleUpdatePlacement(selectedPlacement.id, { teamIndex: newId });
                              }
                            }}
                            style={{
                              width: 70,
                              background: 'var(--bg-main)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: 3,
                              padding: '3px 5px',
                              fontSize: 11,
                              fontFamily: 'var(--mono-font)',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Oddball Spawn Controls */}
                    {selectedPlacement.kind === 'netgame_flag' && selectedPlacement.paletteIndex === 2 && (
                      <div
                        data-testid="inspector-oddball-controls"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          padding: 8,
                          background: 'rgba(186, 104, 200, 0.08)',
                          border: '1px solid rgba(186, 104, 200, 0.35)',
                          borderRadius: 4,
                        }}
                      >
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#ba68c8', textTransform: 'uppercase' }}>
                          Oddball Ball Spawn
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                            Oddball Spawn ID:
                          </span>
                          <input
                            data-testid="inspector-oddball-id-input"
                            type="number"
                            min="0"
                            value={selectedPlacement.teamIndex ?? 0}
                            onChange={(e) => {
                              const newId = parseInt(e.target.value, 10);
                              if (!isNaN(newId)) {
                                handleUpdatePlacement(selectedPlacement.id, { teamIndex: newId });
                              }
                            }}
                            style={{
                              width: 70,
                              background: 'var(--bg-main)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: 3,
                              padding: '3px 5px',
                              fontSize: 11,
                              fontFamily: 'var(--mono-font)',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Team Spawns Count & Multi-Select */}
                    {selectedPlacement.kind === 'spawn' && (
                      <div
                        data-testid="inspector-spawn-team-controls"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          padding: 8,
                          background: 'rgba(66, 165, 245, 0.08)',
                          border: '1px solid rgba(66, 165, 245, 0.3)',
                          borderRadius: 4,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#42a5f5', textTransform: 'uppercase' }}>
                            Player Spawn Info
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          <strong>{selectedPlacement.teamIndex === 0 ? 'Red Team' : selectedPlacement.teamIndex === 1 ? 'Blue Team' : 'FFA / Other'} Spawns:</strong>{' '}
                          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                            {(scenarioData?.objects || []).filter((o) => o.kind === 'spawn' && (o.teamIndex ?? 0) === (selectedPlacement.teamIndex ?? 0)).length}
                          </span>{' '}
                          <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                            (Total Map Spawns: {(scenarioData?.objects || []).filter((o) => o.kind === 'spawn').length})
                          </span>
                        </div>
                        <button
                          data-testid="inspector-select-all-team-spawns"
                          onClick={() => {
                            const team = selectedPlacement.teamIndex ?? 0;
                            const teamSpawns = (scenarioData?.objects || []).filter(
                              (o) => o.kind === 'spawn' && (o.teamIndex ?? 0) === team,
                            );
                            setSelectedObjectIds(teamSpawns.map((s) => s.id));
                          }}
                          style={{
                            width: '100%',
                            padding: '5px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            background: 'var(--bg-main)',
                            color: '#42a5f5',
                            border: '1px solid rgba(66, 165, 245, 0.4)',
                            borderRadius: 3,
                            cursor: 'pointer',
                            marginTop: 2,
                          }}
                        >
                          Select All {selectedPlacement.teamIndex === 0 ? 'Red' : selectedPlacement.teamIndex === 1 ? 'Blue' : 'Team'} Spawns
                        </button>
                      </div>
                    )}

                    {/* Position Coordinates */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                        Position (Halo World)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                        {(['x', 'y', 'z'] as const).map((axis, i) => (
                          <div key={axis}>
                            <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                              {axis}:
                            </span>
                            <input
                              data-testid={`inspector-pos-${axis}`}
                              type="number"
                              step="0.5"
                              value={selectedPlacement.position[i]}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val)) {
                                  const newPos = [...selectedPlacement.position] as [number, number, number];
                                  newPos[i] = val;
                                  handleUpdatePlacement(selectedPlacement.id, { position: newPos });
                                }
                              }}
                              style={{
                                width: '100%',
                                background: 'var(--bg-main)',
                                color: 'var(--text-primary)',
                                border: '1px solid var(--border)',
                                borderRadius: 3,
                                padding: '3px 5px',
                                fontSize: 11,
                                fontFamily: 'var(--mono-font)',
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Rotation Angles */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                        Rotation (Degrees)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                        {[
                          ['Yaw', 0],
                          ['Pitch', 1],
                          ['Roll', 2],
                        ].map(([label, idx]) => {
                          const i = idx as number;
                          const degVal = Math.round(((selectedPlacement.rotation[i] || 0) * 180) / Math.PI);
                          return (
                            <div key={label}>
                              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{label}:</span>
                              <input
                                data-testid={`inspector-rot-${String(label).toLowerCase()}`}
                                type="number"
                                step="5"
                                value={degVal}
                                onChange={(e) => {
                                  const deg = parseFloat(e.target.value);
                                  if (!isNaN(deg)) {
                                    const rad = (deg * Math.PI) / 180;
                                    const newRot = [...selectedPlacement.rotation] as [number, number, number];
                                    newRot[i] = rad;
                                    handleUpdatePlacement(selectedPlacement.id, { rotation: newRot });
                                  }
                                }}
                                style={{
                                  width: '100%',
                                  background: 'var(--bg-main)',
                                  color: 'var(--text-primary)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 3,
                                  padding: '3px 5px',
                                  fontSize: 11,
                                  fontFamily: 'var(--mono-font)',
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Action Buttons Toolbar */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          data-testid="inspector-snap-ground-btn"
                          onClick={snapSelectedToGround}
                          style={{
                            flex: 1,
                            padding: '6px 8px',
                            background: 'var(--bg-panel)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                          title="Snap object to ground geometry (G key)"
                        >
                          Snap Ground [G]
                        </button>
                        <button
                          data-testid="inspector-duplicate-btn"
                          onClick={() => handleDuplicatePlacement(selectedPlacement.id)}
                          style={{
                            flex: 1,
                            padding: '6px 8px',
                            background: 'var(--bg-panel)',
                            color: 'var(--accent-cyan)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                          title="Duplicate object (Ctrl+D)"
                        >
                          Duplicate [Ctrl+D]
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          data-testid="inspector-focus-btn"
                          onClick={() => focusOnObject(selectedPlacement.id)}
                          style={{
                            flex: 1,
                            padding: '6px 8px',
                            background: 'var(--bg-panel)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                          title="Center camera on object (F key)"
                        >
                          Focus Camera [F]
                        </button>
                        <button
                          data-testid="inspector-delete-btn"
                          onClick={() => handleDeletePlacement(selectedPlacement.id)}
                          style={{
                            flex: 1,
                            padding: '6px 8px',
                            background: 'rgba(180, 40, 40, 0.2)',
                            color: '#ff6b6b',
                            border: '1px solid rgba(180, 40, 40, 0.4)',
                            borderRadius: 4,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                          title="Delete object (Del key)"
                        >
                          Delete Object [Del]
                        </button>
                      </div>
                    </div>

                    {/* Swap Object Section */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        marginTop: 10,
                        padding: 8,
                        background: 'var(--bg-main)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                      }}
                    >
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                        Swap Object
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 10, color: 'var(--text-dim)' }}>Target Category</label>
                        <select
                          data-testid="swap-kind-select"
                          value={swapKind}
                          onChange={(e) => {
                            setSwapKind(e.target.value as ScenarioObjectKind);
                            setSwapPaletteIndex(0);
                          }}
                          style={{
                            background: 'var(--bg-panel)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            padding: '4px 6px',
                            fontSize: 11,
                          }}
                        >
                          <option value="vehicle">Vehicle</option>
                          <option value="scenery">Scenery</option>
                          <option value="weapon">Weapon</option>
                          <option value="equipment">Equipment</option>
                          <option value="biped">Biped</option>
                          <option value="spawn">Player Starting Location (Spawn)</option>
                        </select>
                      </div>
                      {swapKind !== 'spawn' && scenarioData && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, color: 'var(--text-dim)' }}>Target Item</label>
                          <select
                            data-testid="swap-palette-select"
                            value={swapPaletteIndex}
                            onChange={(e) => setSwapPaletteIndex(parseInt(e.target.value, 10))}
                            style={{
                              background: 'var(--bg-panel)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: 4,
                              padding: '4px 6px',
                              fontSize: 11,
                            }}
                          >
                            {(
                              scenarioData.palettes[
                                swapKind === 'vehicle'
                                  ? 'vehicles'
                                  : swapKind === 'scenery'
                                    ? 'scenery'
                                    : swapKind === 'weapon'
                                      ? 'weapons'
                                      : swapKind === 'biped'
                                        ? 'bipeds'
                                        : 'equipment'
                              ] || []
                            ).map((p) => (
                              <option key={p.paletteIndex} value={p.paletteIndex}>
                                #{p.paletteIndex}: {p.name || p.path}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <button
                        data-testid="inspector-swap-btn"
                        onClick={() => handleSwapPlacement(selectedPlacement.id, swapKind, swapPaletteIndex)}
                        style={{
                          marginTop: 4,
                          padding: '6px 8px',
                          background: 'var(--accent-primary, #007acc)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                        title="Swap this object with selected target item"
                      >
                        ⇄ Swap Object
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--text-dim)' }}>
                    <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>No Object Selected</div>
                    <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                      Click on any vehicle, scenery, weapon, or spawn in the 3D viewport, or pick one from the Outliner
                      tab to view and edit its properties.
                    </div>
                  </div>
                )
              ) : (
                /* Outliner Tab */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Search box */}
                  <input
                    data-testid="outliner-search-input"
                    type="text"
                    placeholder="Search objects..."
                    value={outlinerSearch}
                    onChange={(e) => setOutlinerSearch(e.target.value)}
                    style={{
                      background: 'var(--bg-main)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      padding: '5px 8px',
                      fontSize: 11,
                    }}
                  />

                  {/* Filter chips */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(
                      [
                        ['all', 'All'],
                        ['vehicle', 'Vehicles'],
                        ['scenery', 'Scenery'],
                        ['spawn', 'Spawns'],
                        ['weapon', 'Weapons'],
                        ['equipment', 'Equipment'],
                        ['encounter', 'AI Squads'],
                        ['firing_position', 'Firing Points'],
                        ['trigger_volume', 'Triggers'],
                        ['cutscene_camera', 'Cameras'],
                        ['netgame_flag', 'Flags'],
                      ] as const
                    ).map(([cat, label]) => (
                      <button
                        key={cat}
                        data-testid={`outliner-filter-${cat}`}
                        onClick={() => setOutlinerFilter(cat)}
                        style={{
                          background: outlinerFilter === cat ? 'var(--accent-cyan)' : 'var(--bg-main)',
                          color: outlinerFilter === cat ? '#000' : 'var(--text-dim)',
                          border: 'none',
                          borderRadius: 3,
                          padding: '2px 6px',
                          fontSize: 10,
                          cursor: 'pointer',
                          fontWeight: outlinerFilter === cat ? 600 : 400,
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* List of objects */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {filteredOutlinerObjects.map((obj) => {
                      const isSelected = obj.id === selectedObjectId;
                      return (
                        <div
                          key={obj.id}
                          data-testid={`outliner-item-${obj.id}`}
                          onClick={() => {
                            setSelectedObjectId(obj.id);
                            setInspectorTab('properties');
                          }}
                          onDoubleClick={() => focusOnObject(obj.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '5px 8px',
                            background: isSelected ? 'rgba(0, 229, 255, 0.15)' : 'var(--bg-panel)',
                            border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border)'}`,
                            borderRadius: 4,
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: isSelected ? 'var(--accent-cyan)' : 'var(--text-primary)', fontSize: 11 }}>
                              {obj.id}
                            </div>
                            <div
                              style={{
                                fontSize: 9.5,
                                color: 'var(--text-dim)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: 190,
                              }}
                              title={obj.objectPath}
                            >
                              {obj.objectPath}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                focusOnObject(obj.id);
                              }}
                              title="Focus"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-dim)',
                                cursor: 'pointer',
                                fontSize: 11,
                              }}
                            >
                              ⊙
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicatePlacement(obj.id);
                              }}
                              title="Duplicate"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--accent-cyan)',
                                cursor: 'pointer',
                                fontSize: 11,
                              }}
                            >
                              ⧉
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeletePlacement(obj.id);
                              }}
                              title="Delete"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#ff6b6b',
                                cursor: 'pointer',
                                fontSize: 11,
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3D Viewport Right-Click Context Menu (Shortcut to Add Object Modal) */}
      {viewportContextMenu && (
        <div
          data-testid="viewport-context-menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: viewportContextMenu.x,
            top: viewportContextMenu.y,
            width: 190,
            background: 'rgba(19, 23, 31, 0.96)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '5px 0',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
            zIndex: 28,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '4px 12px 6px',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              marginBottom: 2,
            }}
          >
            Quick Add Object
          </div>
          {(
            [
              { kind: 'scenery', label: 'Add Scenery', icon: '🌲' },
              { kind: 'vehicle', label: 'Add Vehicle', icon: '🚙' },
              { kind: 'weapon', label: 'Add Weapon', icon: '🔫' },
              { kind: 'equipment', label: 'Add Equipment', icon: '🧰' },
              { kind: 'netgame_flag', label: 'Add Netgame Flag', icon: '🚩' },
              { kind: 'teleporter', label: 'Add Teleporter', icon: '🌀' },
            ] as const
          ).map((item) => (
            <button
              key={item.kind}
              data-testid={`viewport-ctx-add-${item.kind}`}
              onClick={() => {
                setAddKind(item.kind);
                setAddPaletteIndex(0);
                setViewportContextMenu(null);
                setShowAddModal(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                padding: '6px 12px',
                fontSize: 12,
                textAlign: 'left',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 229, 255, 0.14)';
                e.currentTarget.style.color = 'var(--accent-cyan)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
            >
              <span style={{ fontSize: 12, width: 16, textAlign: 'center' }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Add Object Modal Dialog */}
      {showAddModal && (
        <div
          data-testid="add-object-modal"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 30,
          }}
        >
          <div
            style={{
              width: 390,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                Add Scenario Object
              </span>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  fontSize: 16,
                }}
              >
                ✕
              </button>
            </div>

            {/* Category */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>Object Category</label>
              <select
                data-testid="add-modal-kind-select"
                value={
                  addKind === 'spawn' ||
                  addKind === 'ctf_flag' ||
                  addKind === 'ctf_flag_item' ||
                  addKind === 'koth' ||
                  addKind === 'oddball' ||
                  addKind === 'race'
                    ? 'netgame_flag'
                    : addKind === 'teleport' || addKind === 'teleport_2way'
                      ? 'teleporter'
                      : addKind
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (
                    val === 'spawn' ||
                    val === 'ctf_flag' ||
                    val === 'ctf_flag_item' ||
                    val === 'koth' ||
                    val === 'oddball' ||
                    val === 'race'
                  ) {
                    setAddKind('netgame_flag');
                    setAddNetgameSubtype(val);
                  } else if (val === 'teleport' || val === 'teleport_2way') {
                    setAddKind('teleporter');
                    setAddTeleporterSubtype(val);
                  } else {
                    setAddKind(val as ScenarioObjectKind | 'teleporter');
                  }
                  setAddPaletteIndex(0);
                }}
                style={{
                  background: 'var(--bg-main)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '6px 8px',
                  fontSize: 12,
                }}
              >
                <option value="scenery">Scenery</option>
                <option value="vehicle">Vehicle</option>
                <option value="weapon">Weapon</option>
                <option value="equipment">Equipment</option>
                <option value="netgame_flag">Netgame Flag (Spawns / CTF / KOTH / Oddball / Race)</option>
                <option value="teleporter">Teleporter (One-Way &amp; Two-Way)</option>
                <option value="biped">Biped</option>
              </select>
            </div>

            {/* Netgame Flag / Objective Subtype (when Netgame Flag category is selected) */}
            {(addKind === 'netgame_flag' ||
              addKind === 'spawn' ||
              addKind === 'ctf_flag' ||
              addKind === 'ctf_flag_item' ||
              addKind === 'koth' ||
              addKind === 'oddball' ||
              addKind === 'race') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>
                  Netgame Flag / Objective Type
                </label>
                <select
                  data-testid="add-modal-netgame-select"
                  value={addNetgameSubtype}
                  onChange={(e) =>
                    setAddNetgameSubtype(
                      e.target.value as 'spawn' | 'ctf_flag' | 'ctf_flag_item' | 'koth' | 'oddball' | 'race',
                    )
                  }
                  style={{
                    background: 'var(--bg-main)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '6px 8px',
                    fontSize: 12,
                  }}
                >
                  <option value="spawn">Player Starting Location (Spawn)</option>
                  <option value="ctf_flag">CTF Flag Stand (Team Base Flag)</option>
                  <option value="ctf_flag_item">CTF Flag (Droppable Item)</option>
                  <option value="koth">King of the Hill (KOTH 8-Point Zone)</option>
                  <option value="oddball">Oddball Skull Spawn</option>
                  <option value="race">Race Track Checkpoint</option>
                </select>
              </div>
            )}

            {/* Teleporter Style Subtype (when Teleporter category is selected) */}
            {(addKind === 'teleporter' || addKind === 'teleport' || addKind === 'teleport_2way') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>Teleporter Style</label>
                <select
                  data-testid="add-modal-teleporter-select"
                  value={addTeleporterSubtype}
                  onChange={(e) => setAddTeleporterSubtype(e.target.value as 'teleport' | 'teleport_2way')}
                  style={{
                    background: 'var(--bg-main)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '6px 8px',
                    fontSize: 12,
                  }}
                >
                  <option value="teleport">One-Way Teleporter (Origin &amp; Destination Pair)</option>
                  <option value="teleport_2way">Two-Way Teleporter (Bi-Directional Pair - Purple)</option>
                </select>
              </div>
            )}

            {/* Palette item (if applicable) */}
            {(addKind === 'vehicle' || addKind === 'scenery' || addKind === 'biped' || addKind === 'weapon' || addKind === 'equipment') &&
              scenarioData && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>Palette Item</label>
                  <select
                    data-testid="add-modal-palette-select"
                    value={addPaletteIndex}
                    onChange={(e) => setAddPaletteIndex(parseInt(e.target.value, 10))}
                    style={{
                      background: 'var(--bg-main)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      padding: '6px 8px',
                      fontSize: 12,
                    }}
                  >
                    {(
                      scenarioData.palettes[
                        addKind === 'vehicle'
                          ? 'vehicles'
                          : addKind === 'scenery'
                            ? 'scenery'
                            : addKind === 'weapon'
                              ? 'weapons'
                              : addKind === 'biped'
                                ? 'bipeds'
                                : 'equipment'
                      ] || []
                    ).map((p) => (
                      <option key={p.paletteIndex} value={p.paletteIndex}>
                        #{p.paletteIndex}: {p.name || p.path}
                      </option>
                    ))}
                  </select>
                </div>
              )}

            {/* Team (if spawn or CTF flag stand) */}
            {((addKind === 'netgame_flag' && (addNetgameSubtype === 'spawn' || addNetgameSubtype === 'ctf_flag')) ||
              addKind === 'spawn' ||
              addKind === 'ctf_flag') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>Team</label>
                <select
                  data-testid="add-modal-team-select"
                  value={addTeam}
                  onChange={(e) => setAddTeam(parseInt(e.target.value, 10))}
                  style={{
                    background: 'var(--bg-main)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '6px 8px',
                    fontSize: 12,
                  }}
                >
                  <option value={0}>0 - Red Team</option>
                  <option value={1}>1 - Blue Team</option>
                  {(addNetgameSubtype === 'spawn' || addKind === 'spawn') && (
                    <option value={2}>2 - Yellow / FFA / None</option>
                  )}
                </select>
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  background: 'var(--bg-main)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '6px 12px',
                  fontSize: 11.5,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                data-testid="add-modal-submit-btn"
                onClick={() => {
                  const { yaw, pitch } = camEulerRef.current;
                  const camPos = camPosRef.current;
                  // Forward vector in Three.js world space:
                  const fwdX = -Math.sin(yaw) * Math.cos(pitch);
                  const fwdY = Math.sin(pitch);
                  const fwdZ = -Math.cos(yaw) * Math.cos(pitch);
                  // 15 meters in front of the camera in Three.js world space:
                  const spawnWorldX = camPos.x + fwdX * 15.0;
                  const spawnWorldY = camPos.y + fwdY * 15.0;
                  const spawnWorldZ = camPos.z + fwdZ * 15.0;
                  // Convert Three.js world coordinates to Halo coordinates:
                  // World X = Halo X, World Y = Halo Z (up), World Z = -Halo Y
                  const spawnHaloPos: [number, number, number] = [
                    spawnWorldX,
                    -spawnWorldZ,
                    spawnWorldY,
                  ];
                  // Keep the exact [0, 0, 0] rotation exported from Blender by default
                  const spawnHaloRot: [number, number, number] = [0, 0, 0];
                  const effectiveKind =
                    addKind === 'netgame_flag'
                      ? addNetgameSubtype
                      : addKind === 'teleporter'
                        ? addTeleporterSubtype
                        : addKind;
                  handleAddPlacement(effectiveKind, addPaletteIndex, spawnHaloPos, spawnHaloRot, addTeam);
                }}
                style={{
                  background: '#2e7d32',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 14px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Add to Map
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div
          data-testid="viewport-loading"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(19, 23, 31, 0.85)',
            color: 'var(--accent-cyan)',
            gap: 12,
            zIndex: 20,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Extracting Structure BSP Geometry...</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Reading submeshes, lightmap UVs, and shaders</div>
        </div>
      )}

      {/* Error Overlay */}
      {error && !loading && (
        <div
          data-testid="viewport-error"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(25, 10, 10, 0.92)',
            color: '#ff6b6b',
            gap: 10,
            padding: 24,
            zIndex: 20,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700 }}>Failed to Load 3D Viewport</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 500 }}>{error}</div>
        </div>
      )}

      {/* WebGL Not Available Fallback */}
      {!webGLSupported && !loading && !error && (
        <div
          data-testid="viewport-no-webgl"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'repeating-linear-gradient(45deg, var(--bg-main) 0px, var(--bg-main) 10px, #11151c 10px, #11151c 20px)',
            color: 'var(--text-dim)',
            gap: 10,
            zIndex: 5,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-cyan)' }}>3D Scenario Viewport</div>
          <div style={{ fontSize: 12 }}>WebGL is not available in this environment.</div>
          {primaryMesh && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
              BSP Geometry extracted: {totalSubmeshes} submeshes, {totalVertices} vertices, {totalTriangles} triangles.
            </div>
          )}
        </div>
      )}

      {/* Bottom Camera & Control Hints HUD */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 14px',
          background: 'rgba(15, 17, 21, 0.88)',
          borderTop: '1px solid var(--border)',
          fontSize: 10.5,
          color: 'var(--text-dim)',
          zIndex: 10,
        }}
      >
        <div style={{ fontFamily: 'var(--mono-font)' }}>
          Camera: X: {cameraPosDisplay.x} Y: {cameraPosDisplay.y} Z: {cameraPosDisplay.z}
        </div>
        <div>
          {selectedPlacement ? (
            <span style={{ color: 'var(--accent-cyan)' }}>
              Selected: {selectedPlacement.id} | MMB: Drag | Shift+LMB/RMB/MMB: Rotate | Ctrl+MMB: Orbit Item | Ctrl+C/X/V/Z | G: Ground | Del: Delete
            </span>
          ) : (
            <span>
              LMB Drag: Pan | RMB Drag: Orbit | Right-Click: Quick Add | WASD: Fly | R: Frame | Scroll: Speed
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

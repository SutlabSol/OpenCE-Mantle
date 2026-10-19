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
  });
  const [renderMode, setRenderMode] = useState<RenderMode>('textured-wireframe');
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
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'outliner'>('properties');
  const [outlinerFilter, setOutlinerFilter] = useState<'all' | ScenarioObjectKind>('all');
  const [outlinerSearch, setOutlinerSearch] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [addKind, setAddKind] = useState<ScenarioObjectKind>('vehicle');
  const [addPaletteIndex, setAddPaletteIndex] = useState<number>(0);
  const [addTeam, setAddTeam] = useState<number>(0);

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
  } | null>(null);
  const submeshMeshesRef = useRef<{ mesh: THREE.Mesh; lines: THREE.LineSegments; solidMat: THREE.MeshStandardMaterial; bspIndex?: number }[]>([]);
  const objectMeshesRef = useRef<{ mesh: THREE.Mesh; lines?: THREE.LineSegments; solidMat: THREE.MeshStandardMaterial }[]>([]);
  const textureCacheRef = useRef<Map<number, Promise<THREE.Texture | null>>>(new Map());
  const modelCacheRef = useRef<Map<number, Promise<ModelRenderGeometry | null>>>(new Map());

  // Gizmo & selection refs
  const transformControlsRef = useRef<TransformControls | null>(null);
  const selectionBoxHelperRef = useRef<THREE.BoxHelper | null>(null);
  const isTransformDraggingRef = useRef<boolean>(false);
  const pointerDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Camera fly controls state
  const camPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 10, 30));
  const camEulerRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: -0.2 });
  const keysDownRef = useRef<Set<string>>(new Set());
  const isRightMouseDownRef = useRef<boolean>(false);
  const speedRef = useRef<number>(cameraSpeed);
  speedRef.current = cameraSpeed;

  const hasInitialFramedRef = useRef<boolean>(false);
  const isMiddleDraggingRef = useRef<boolean>(false);
  const isCtrlDraggingRef = useRef<boolean>(false);
  const isAltLeftDraggingRef = useRef<boolean>(false);
  const isAltRightDraggingRef = useRef<boolean>(false);
  const dragHasMovedRef = useRef<boolean>(false);
  const selectedObjectIdRef = useRef<string | null>(selectedObjectId);
  selectedObjectIdRef.current = selectedObjectId;

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
        const res = await window.opence.updateScenarioPlacement(placementId, updates);
        if (res && res.ok) {
          setScenarioData(res.summary);
        }
      } catch (err) {
        console.error('Failed to update scenario placement:', err);
      }
    },
    [],
  );

  const handleDuplicatePlacement = useCallback(
    async (placementId: string) => {
      try {
        const res = await window.opence.duplicateScenarioPlacement(placementId);
        if (res && res.ok) {
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
    async (placementId: string) => {
      try {
        const res = await window.opence.deleteScenarioPlacement(placementId);
        if (res && res.ok) {
          setScenarioData(res.summary);
          if (selectedObjectId === placementId) {
            setSelectedObjectId(null);
          }
        }
      } catch (err) {
        console.error('Failed to delete scenario placement:', err);
      }
    },
    [selectedObjectId],
  );

  const handleAddPlacement = useCallback(
    async (
      kind: ScenarioObjectKind,
      paletteIndex: number,
      position: [number, number, number],
      rotation: [number, number, number] = [0, 0, 0],
      teamIndex?: number,
    ) => {
      try {
        const res = await window.opence.addScenarioPlacement(
          kind,
          paletteIndex,
          position,
          rotation,
          teamIndex,
        );
        if (res && res.ok) {
          setScenarioData(res.summary);
          setSelectedObjectId(res.newPlacement.id);
          setShowAddModal(false);
        }
      } catch (err) {
        console.error('Failed to add scenario placement:', err);
      }
    },
    [],
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

  // Ground Snapping: casts a ray straight down from above the object onto the BSP geometry
  const snapSelectedToGround = useCallback(async () => {
    if (!selectedObjectId || !scenarioData || submeshMeshesRef.current.length === 0) return;
    const placement = scenarioData.objects.find((o) => o.id === selectedObjectId);
    if (!placement) return;

    const [curX, curY, curZ] = placement.position;
    // World space conversion:
    // Halo +X is World +X, Halo +Z (up) is World +Y, Halo +Y is World -Z
    const worldOrigin = new THREE.Vector3(curX, curZ + 50, -curY);
    const worldDir = new THREE.Vector3(0, -1, 0);
    const raycaster = new THREE.Raycaster(worldOrigin, worldDir, 0.1, 1000);

    const bspMeshesList = submeshMeshesRef.current
      .filter((s) => s.mesh.parent?.visible !== false)
      .map((s) => s.mesh);
    const hits = raycaster.intersectObjects(bspMeshesList, false);

    if (hits.length > 0) {
      const groundZ = hits[0].point.y; // World Y is Halo Z (height)
      await handleUpdatePlacement(selectedObjectId, {
        position: [curX, curY, groundZ],
      });
    }
  }, [selectedObjectId, scenarioData, handleUpdatePlacement]);

  const callbacksRef = useRef({
    handleUpdatePlacement,
    handleDuplicatePlacement,
    handleDeletePlacement,
    snapSelectedToGround,
    focusOnObject,
    frameScene,
  });
  callbacksRef.current = {
    handleUpdatePlacement,
    handleDuplicatePlacement,
    handleDeletePlacement,
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
      const { vehicles, scenery, spawns, items } = layers;

      const clearGroup = (group: THREE.Group) => {
        while (group.children.length > 0) {
          group.remove(group.children[0]);
        }
      };
      clearGroup(vehicles);
      clearGroup(scenery);
      clearGroup(spawns);
      clearGroup(items);

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
        objGroup.rotation.set(obj.rotation[2], obj.rotation[1], obj.rotation[0], 'ZYX');

        let targetLayer = scenery;
        if (obj.kind === 'vehicle') targetLayer = vehicles;
        else if (obj.kind === 'scenery') targetLayer = scenery;
        else if (obj.kind === 'spawn') targetLayer = spawns;
        else if (obj.kind === 'weapon' || obj.kind === 'equipment') targetLayer = items;

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

              objectMeshesRef.current.push({ mesh, lines, solidMat });

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
          });
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

  // Attach/Detach TransformControls & Selection BoxHelper on selectedObjectId change
  useEffect(() => {
    const tc = transformControlsRef.current;
    const scene = sceneRef.current;
    if (!tc || !scene) return;

    if (selectionBoxHelperRef.current) {
      scene.remove(selectionBoxHelperRef.current);
      selectionBoxHelperRef.current.dispose();
      selectionBoxHelperRef.current = null;
    }

    if (!selectedObjectId || !layerGroupsRef.current) {
      tc.detach();
      return;
    }

    const allGroups = [
      ...layerGroupsRef.current.vehicles.children,
      ...layerGroupsRef.current.scenery.children,
      ...layerGroupsRef.current.spawns.children,
      ...layerGroupsRef.current.items.children,
    ];
    const targetGroup = allGroups.find((g) => g.userData?.id === selectedObjectId);

    if (targetGroup) {
      tc.attach(targetGroup);
      const boxHelper = new THREE.BoxHelper(targetGroup, 0x39ff14);
      const boxMat = boxHelper.material as THREE.LineBasicMaterial;
      boxMat.depthTest = false;
      boxMat.transparent = true;
      boxMat.opacity = 1.0;
      boxMat.linewidth = 2;
      boxHelper.renderOrder = 9999;
      scene.add(boxHelper);
      selectionBoxHelperRef.current = boxHelper;
    } else {
      tc.detach();
    }
  }, [selectedObjectId, scenarioData]);

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

    haloRoot.add(bspGroup);
    haloRoot.add(vehiclesGroup);
    haloRoot.add(sceneryGroup);
    haloRoot.add(spawnsGroup);
    haloRoot.add(itemsGroup);

    const layerGroups = {
      bsp: bspGroup,
      vehicles: vehiclesGroup,
      scenery: sceneryGroup,
      spawns: spawnsGroup,
      items: itemsGroup,
    };
    layerGroupsRef.current = layerGroups;

    // TransformControls setup
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.size = 0.75;
    transformControls.setMode(gizmoMode);
    const helper = transformControls.getHelper ? transformControls.getHelper() : (transformControls as unknown as THREE.Object3D);
    scene.add(helper);
    transformControlsRef.current = transformControls;

    transformControls.addEventListener('dragging-changed', (event) => {
      isTransformDraggingRef.current = !!event.value;
    });

    transformControls.addEventListener('mouseUp', async () => {
      const attached = transformControls.object;
      if (!attached || !attached.userData?.id) return;
      const id = attached.userData.id as string;

      const newPos: [number, number, number] = [attached.position.x, attached.position.y, attached.position.z];
      const euler = new THREE.Euler().setFromQuaternion(attached.quaternion, 'ZYX');
      const newRot: [number, number, number] = [euler.z, euler.y, euler.x];

      callbacksRef.current.handleUpdatePlacement(id, { position: newPos, rotation: newRot });
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
      ];
      return allGroups.find((g) => g.userData?.id === id) || null;
    };

    const onMouseDown = (e: MouseEvent) => {
      const targetGroup = getSelectedGroup();
      if (e.button === 1) {
        // Scroll button / Middle click drag: horizontal move
        if (targetGroup) {
          e.preventDefault();
          isMiddleDraggingRef.current = true;
          dragHasMovedRef.current = false;
          canvas.focus();
        }
      } else if (e.button === 0) {
        if (e.ctrlKey && targetGroup) {
          // Left Ctrl + left click drag: vertical up/down move
          isCtrlDraggingRef.current = true;
          dragHasMovedRef.current = false;
        } else if (e.altKey && targetGroup) {
          // Left Alt + left click drag: yaw rotate
          isAltLeftDraggingRef.current = true;
          dragHasMovedRef.current = false;
        } else {
          pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
        }
      } else if (e.button === 2) {
        if (e.altKey && targetGroup) {
          // Left Alt + right click drag: pitch & yaw rotate (suppress camera fly-look!)
          isAltRightDraggingRef.current = true;
          dragHasMovedRef.current = false;
        } else {
          isRightMouseDownRef.current = true;
          canvas.focus();
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      const targetGroup = getSelectedGroup();
      const wasCustomDrag =
        isMiddleDraggingRef.current ||
        isCtrlDraggingRef.current ||
        isAltLeftDraggingRef.current ||
        isAltRightDraggingRef.current;

      if (wasCustomDrag) {
        isMiddleDraggingRef.current = false;
        isCtrlDraggingRef.current = false;
        isAltLeftDraggingRef.current = false;
        isAltRightDraggingRef.current = false;

        if (dragHasMovedRef.current && targetGroup && selectedObjectIdRef.current) {
          const newPos: [number, number, number] = [
            targetGroup.position.x,
            targetGroup.position.y,
            targetGroup.position.z,
          ];
          const euler = new THREE.Euler().setFromQuaternion(targetGroup.quaternion, 'ZYX');
          const newRot: [number, number, number] = [euler.z, euler.y, euler.x];
          callbacksRef.current.handleUpdatePlacement(selectedObjectIdRef.current, {
            position: newPos,
            rotation: newRot,
          });
        }
      }

      if (e.button === 2) {
        isRightMouseDownRef.current = false;
        isAltRightDraggingRef.current = false;
      } else if (e.button === 0 && !wasCustomDrag) {
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
            ];
            const hits = raycaster.intersectObjects(interactiveRoots, true);
            if (hits.length > 0) {
              let curr: THREE.Object3D | null = hits[0].object;
              while (curr && (!curr.userData || !curr.userData.id)) {
                curr = curr.parent;
              }
              if (curr && curr.userData?.id) {
                setSelectedObjectId(curr.userData.id);
                return;
              }
            }
          }
          // Clicked empty background: deselect
          setSelectedObjectId(null);
        }
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      const targetGroup = getSelectedGroup();

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

      if (isCtrlDraggingRef.current && targetGroup) {
        dragHasMovedRef.current = true;
        const moveZ = -e.movementY * 0.05;
        targetGroup.position.z += moveZ;
        selectionBoxHelperRef.current?.update();
        return;
      }

      if (isAltLeftDraggingRef.current && targetGroup) {
        dragHasMovedRef.current = true;
        targetGroup.rotation.z -= e.movementX * 0.02; // yaw
        selectionBoxHelperRef.current?.update();
        return;
      }

      if (isAltRightDraggingRef.current && targetGroup) {
        dragHasMovedRef.current = true;
        targetGroup.rotation.z -= e.movementX * 0.02; // yaw
        targetGroup.rotation.y += e.movementY * 0.02; // pitch
        selectionBoxHelperRef.current?.update();
        return;
      }

      if (isRightMouseDownRef.current && !e.altKey) {
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

      renderer.render(scene, camera);

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
            width: '100%',
            height: '100%',
            position: 'relative',
            outline: 'none',
          }}
        />

        {/* Collapsible Inspector / Outliner Side Panel (Step 9) */}
        {showInspector && (
          <div
            data-testid="scenario-inspector-panel"
            style={{
              width: 330,
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
              width: 380,
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
                value={addKind}
                onChange={(e) => {
                  setAddKind(e.target.value as ScenarioObjectKind);
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
                <option value="vehicle">Vehicle</option>
                <option value="scenery">Scenery</option>
                <option value="spawn">Player Starting Location (Spawn)</option>
                <option value="weapon">Weapon</option>
                <option value="equipment">Equipment</option>
                <option value="biped">Biped</option>
              </select>
            </div>

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

            {/* Team (if spawn) */}
            {addKind === 'spawn' && (
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
                  <option value={2}>2 - Yellow / FFA / None</option>
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
                  // 2 meters in front of the camera in Three.js world space:
                  const spawnWorldX = camPos.x + fwdX * 2.0;
                  const spawnWorldY = camPos.y + fwdY * 2.0;
                  const spawnWorldZ = camPos.z + fwdZ * 2.0;
                  // Convert Three.js world coordinates to Halo coordinates:
                  // World X = Halo X, World Y = Halo Z (up), World Z = -Halo Y
                  const spawnHaloPos: [number, number, number] = [
                    spawnWorldX,
                    -spawnWorldZ,
                    spawnWorldY,
                  ];
                  const spawnHaloRot: [number, number, number] = [yaw, 0, 0];
                  handleAddPlacement(addKind, addPaletteIndex, spawnHaloPos, spawnHaloRot, addTeam);
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
              Selected: {selectedPlacement.id} | G: Snap Ground | Ctrl+D: Duplicate | Del: Delete | T: Translate | Y: Rotate | F: Focus
            </span>
          ) : (
            <span>
              Click object to select | RMB + WASD: Fly | Shift: 2.5x Speed | Space/C: Up/Down | R: Frame | Scroll: Speed
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

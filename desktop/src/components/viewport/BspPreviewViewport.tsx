import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import type { BspRenderMesh } from '../../../electron/shared-types';

export interface BspPreviewViewportProps {
  sourceFilePath: string;
  selectedBspIndices: number[];
  bspNames?: Record<number, string>;
  height?: number | string;
}

const BSP_COLORS = [
  0x38bdf8, // Sky Cyan
  0xfbbf24, // Amber
  0x34d399, // Emerald
  0xf472b6, // Rose
  0xa78bfa, // Purple
  0x60a5fa, // Blue
  0xf87171, // Red
];

const BSP_HEX_STRINGS = [
  '#38bdf8',
  '#fbbf24',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#60a5fa',
  '#f87171',
];

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

export default function BspPreviewViewport({
  sourceFilePath,
  selectedBspIndices,
  bspNames = {},
  height = 360,
}: BspPreviewViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(true);
  const [bspVisibility, setBspVisibility] = useState<Record<number, boolean>>({});
  const [meshes, setMeshes] = useState<Record<number, BspRenderMesh>>({});

  const webGLSupported = useMemo(() => isWebGLAvailable(), []);

  // Three.js instances
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const bspGroupsRef = useRef<Map<number, THREE.Group>>(new Map());
  const wireframesRef = useRef<Map<number, THREE.LineSegments[]>>(new Map());
  const cacheRef = useRef<Map<number, BspRenderMesh>>(new Map());

  // Camera Orbit state
  const orbitRef = useRef({
    target: new THREE.Vector3(0, 0, 0),
    radius: 100,
    theta: Math.PI / 4,
    phi: Math.PI / 4,
    isDragging: false,
    dragButton: 0,
    prevMouse: { x: 0, y: 0 },
  });

  // Load render meshes for selected BSPs
  useEffect(() => {
    if (!sourceFilePath || selectedBspIndices.length === 0) {
      setMeshes({});
      return;
    }

    let active = true;
    const fetchMeshes = async () => {
      setLoading(true);
      setError(null);
      const newMeshes: Record<number, BspRenderMesh> = {};

      for (const idx of selectedBspIndices) {
        if (cacheRef.current.has(idx)) {
          newMeshes[idx] = cacheRef.current.get(idx)!;
          continue;
        }
        try {
          const res = await window.opence.getSourceBspMesh?.(sourceFilePath, idx);
        if (!res) continue;
          if (res.ok && active) {
            cacheRef.current.set(idx, res.mesh);
            newMeshes[idx] = res.mesh;
          }
        } catch (err: any) {
          if (active) {
            console.error(`Failed to load render mesh for BSP ${idx}:`, err);
            setError(err?.message || 'Failed to load BSP geometry.');
          }
        }
      }

      if (active) {
        setMeshes(newMeshes);
        setLoading(false);
      }
    };

    fetchMeshes();
    return () => {
      active = false;
    };
  }, [sourceFilePath, selectedBspIndices]);

  // Initialize visibility state for new BSPs
  useEffect(() => {
    setBspVisibility((prev) => {
      const next = { ...prev };
      for (const idx of selectedBspIndices) {
        if (next[idx] === undefined) next[idx] = true;
      }
      return next;
    });
  }, [selectedBspIndices]);

  // Combined statistics
  const stats = useMemo(() => {
    let totalVerts = 0;
    let totalTris = 0;
    let totalSub = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let hasBounds = false;

    for (const idx of selectedBspIndices) {
      const m = meshes[idx];
      if (!m) continue;
      totalVerts += m.totalVertices;
      totalTris += m.totalTriangles;
      totalSub += m.submeshes.length;

      const [bx0, by0, bz0, bx1, by1, bz1] = m.worldBounds;
      minX = Math.min(minX, bx0);
      minY = Math.min(minY, by0);
      minZ = Math.min(minZ, bz0);
      maxX = Math.max(maxX, bx1);
      maxY = Math.max(maxY, by1);
      maxZ = Math.max(maxZ, bz1);
      hasBounds = true;
    }

    const bounds: [number, number, number, number, number, number] = hasBounds
      ? [minX, minY, minZ, maxX, maxY, maxZ]
      : [0, 0, 0, 0, 0, 0];

    return { totalVerts, totalTris, totalSub, bounds, hasBounds };
  }, [selectedBspIndices, meshes]);

  // Camera Orbit update helper
  const updateCameraPosition = useCallback(() => {
    if (!cameraRef.current) return;
    const { target, radius, theta, phi } = orbitRef.current;
    const x = target.x + radius * Math.sin(phi) * Math.sin(theta);
    const y = target.y + radius * Math.cos(phi);
    const z = target.z + radius * Math.sin(phi) * Math.cos(theta);
    cameraRef.current.position.set(x, y, z);
    cameraRef.current.lookAt(target);
  }, []);

  // Frame Camera on Bounds
  const frameCamera = useCallback(() => {
    if (!stats.hasBounds || !cameraRef.current) return;
    const [minX, minY, minZ, maxX, maxY, maxZ] = stats.bounds;

    // Convert Halo Z-up to Three.js Y-up:
    // Three.js: X = Halo X, Y = Halo Z, Z = -Halo Y
    const cx = (minX + maxX) / 2;
    const cy = (minZ + maxZ) / 2;
    const cz = -(minY + maxY) / 2;

    const spanX = Math.abs(maxX - minX);
    const spanY = Math.abs(maxZ - minZ);
    const spanZ = Math.abs(maxY - minY);
    const maxSpan = Math.max(spanX, spanY, spanZ, 20);

    orbitRef.current.target.set(cx, cy, cz);
    orbitRef.current.radius = maxSpan * 1.5;
    orbitRef.current.theta = Math.PI / 4;
    orbitRef.current.phi = Math.PI / 3;

    cameraRef.current.near = Math.max(0.1, maxSpan * 0.005);
    cameraRef.current.far = maxSpan * 15;
    cameraRef.current.updateProjectionMatrix();

    updateCameraPosition();
  }, [stats, updateCameraPosition]);

  // Initialize Three.js Scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !webGLSupported) return;

    const width = container.clientWidth || 600;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 5000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(100, 200, 100);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x90caf9, 0.4);
    dirLight2.position.set(-100, -50, -100);
    scene.add(dirLight2);

    // Grid helper
    const grid = new THREE.GridHelper(500, 50, 0x1e293b, 0x0f172a);
    grid.position.y = -1;
    scene.add(grid);

    let animId = 0;
    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    renderLoop();

    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth || 600;
      cameraRef.current.aspect = w / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, height);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [webGLSupported, height]);

  // Build / Update 3D Geometry
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Clear old BSP groups
    bspGroupsRef.current.forEach((grp) => scene.remove(grp));
    bspGroupsRef.current.clear();
    wireframesRef.current.clear();

    // Build mesh groups for each selected BSP
    selectedBspIndices.forEach((bspIdx, colorIndex) => {
      const meshData = meshes[bspIdx];
      if (!meshData) return;

      const colorHex = BSP_COLORS[colorIndex % BSP_COLORS.length];
      const bspGroup = new THREE.Group();
      bspGroup.name = `bsp_${bspIdx}`;

      const linesList: THREE.LineSegments[] = [];

      for (const submesh of meshData.submeshes) {
        if (submesh.vertexCount === 0 || submesh.indices.length === 0) continue;

        const geom = new THREE.BufferGeometry();
        // Convert vertices: Halo coordinates (X, Y, Z) -> Three.js (X, Z, -Y)
        const vCount = submesh.vertexCount;
        const positions = new Float32Array(vCount * 3);
        const normals = new Float32Array(vCount * 3);

        for (let v = 0; v < vCount; v++) {
          const inIdx = v * 8;
          const outIdx = v * 3;
          // Halo position
          const hx = submesh.vertices[inIdx + 0];
          const hy = submesh.vertices[inIdx + 1];
          const hz = submesh.vertices[inIdx + 2];
          // Halo normal
          const hnx = submesh.vertices[inIdx + 3];
          const hny = submesh.vertices[inIdx + 4];
          const hnz = submesh.vertices[inIdx + 5];

          // Reorient to Three.js Y-up
          positions[outIdx + 0] = hx;
          positions[outIdx + 1] = hz;
          positions[outIdx + 2] = -hy;

          normals[outIdx + 0] = hnx;
          normals[outIdx + 1] = hnz;
          normals[outIdx + 2] = -hny;
        }

        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geom.setIndex(new THREE.BufferAttribute(submesh.indices, 1));

        const solidMat = new THREE.MeshStandardMaterial({
          color: colorHex,
          roughness: 0.7,
          metalness: 0.15,
          side: THREE.DoubleSide,
        });

        const solidMesh = new THREE.Mesh(geom, solidMat);
        bspGroup.add(solidMesh);

        // Wireframe overlay
        const wireGeom = new THREE.WireframeGeometry(geom);
        const wireMat = new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.25,
        });
        const lines = new THREE.LineSegments(wireGeom, wireMat);
        lines.visible = wireframe;
        solidMesh.add(lines);
        linesList.push(lines);
      }

      bspGroup.visible = bspVisibility[bspIdx] !== false;
      scene.add(bspGroup);
      bspGroupsRef.current.set(bspIdx, bspGroup);
      wireframesRef.current.set(bspIdx, linesList);
    });

    frameCamera();
  }, [meshes, selectedBspIndices, bspVisibility, wireframe, frameCamera]);

  // Toggle wireframe visibility
  useEffect(() => {
    wireframesRef.current.forEach((linesList) => {
      for (const line of linesList) {
        line.visible = wireframe;
      }
    });
  }, [wireframe]);

  // Toggle individual BSP visibility
  useEffect(() => {
    bspGroupsRef.current.forEach((grp, idx) => {
      grp.visible = bspVisibility[idx] !== false;
    });
  }, [bspVisibility]);

  // Mouse Orbit Controls
  const handleMouseDown = (e: React.MouseEvent) => {
    orbitRef.current.isDragging = true;
    orbitRef.current.dragButton = e.button;
    orbitRef.current.prevMouse = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!orbitRef.current.isDragging) return;
    const dx = e.clientX - orbitRef.current.prevMouse.x;
    const dy = e.clientY - orbitRef.current.prevMouse.y;
    orbitRef.current.prevMouse = { x: e.clientX, y: e.clientY };

    if (orbitRef.current.dragButton === 0) {
      // Rotate
      orbitRef.current.theta -= dx * 0.008;
      orbitRef.current.phi = Math.max(0.05, Math.min(Math.PI - 0.05, orbitRef.current.phi - dy * 0.008));
    } else if (orbitRef.current.dragButton === 2 || e.shiftKey) {
      // Pan
      const panFactor = orbitRef.current.radius * 0.0015;
      const cam = cameraRef.current;
      if (cam) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        orbitRef.current.target.addScaledVector(right, -dx * panFactor);
        orbitRef.current.target.addScaledVector(up, dy * panFactor);
      }
    }
    updateCameraPosition();
  };

  const handleMouseUp = () => {
    orbitRef.current.isDragging = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1;
    orbitRef.current.radius = Math.max(1, Math.min(10000, orbitRef.current.radius * zoomFactor));
    updateCameraPosition();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        background: '#090d16',
        height: typeof height === 'string' ? height : undefined,
        flex: typeof height === 'string' ? 1 : undefined,
      }}
    >
      {/* Viewport Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(255, 255, 255, 0.02)',
          borderBottom: '1px solid var(--border)',
          fontSize: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>BSP Viewport:</span>
          {selectedBspIndices.map((bspIdx, colorIndex) => {
            const hexColor = BSP_HEX_STRINGS[colorIndex % BSP_HEX_STRINGS.length];
            const isVisible = bspVisibility[bspIdx] !== false;
            const label = bspNames[bspIdx] ? bspNames[bspIdx].split('\\').pop() : `BSP ${bspIdx}`;
            return (
              <button
                key={bspIdx}
                type="button"
                onClick={() => setBspVisibility((prev) => ({ ...prev, [bspIdx]: !isVisible }))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: isVisible ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  border: `1px solid ${isVisible ? hexColor : 'rgba(255, 255, 255, 0.1)'}`,
                  color: isVisible ? hexColor : 'var(--text-dim)',
                  opacity: isVisible ? 1 : 0.5,
                  transition: 'all 0.15s ease',
                }}
              >
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: hexColor,
                  }}
                />
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setWireframe(!wireframe)}
            style={{
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: 'pointer',
              background: wireframe ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${wireframe ? 'rgba(56, 189, 248, 0.3)' : 'var(--border)'}`,
              color: wireframe ? 'var(--accent-cyan, #38bdf8)' : 'var(--text-dim)',
            }}
          >
            Wireframe: {wireframe ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={frameCamera}
            style={{
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: 'pointer',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            Reset View
          </button>
        </div>
      </div>

      {/* 3D Canvas Area */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          width: '100%',
          height: typeof height === 'number' ? `${height}px` : undefined,
          flex: typeof height === 'string' ? 1 : undefined,
          minHeight: '280px',
          position: 'relative',
          cursor: 'grab',
        }}
      >
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(9, 13, 22, 0.75)',
              color: 'var(--accent-cyan, #38bdf8)',
              fontSize: '13px',
              fontWeight: 600,
              gap: '8px',
              zIndex: 10,
            }}
          >
            <span>Loading BSP 3D Geometry...</span>
          </div>
        )}
        {error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(9, 13, 22, 0.85)',
              color: '#f87171',
              fontSize: '12px',
              padding: '20px',
              textAlign: 'center',
              zIndex: 10,
            }}
          >
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Combined Stats Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'rgba(0, 0, 0, 0.25)',
          borderTop: '1px solid var(--border)',
          fontSize: '11px',
          color: 'var(--text-dim)',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', gap: '14px' }}>
          <span>
            Selected:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{selectedBspIndices.length} BSP(s)</strong>
          </span>
          <span>
            Vertices:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{stats.totalVerts.toLocaleString()}</strong>
          </span>
          <span>
            Triangles:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{stats.totalTris.toLocaleString()}</strong>
          </span>
          <span>
            Submeshes:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{stats.totalSub}</strong>
          </span>
        </div>
        <div>
          Bounds:{' '}
          <code style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
            [{stats.bounds[0].toFixed(0)}, {stats.bounds[1].toFixed(0)}, {stats.bounds[2].toFixed(0)}] → [
            {stats.bounds[3].toFixed(0)}, {stats.bounds[4].toFixed(0)}, {stats.bounds[5].toFixed(0)}]
          </code>
        </div>
      </div>
    </div>
  );
}

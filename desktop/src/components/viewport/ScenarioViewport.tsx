import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { MapHeaderSummary, BspRenderMesh } from '../../../electron/shared-types';

export type RenderMode = 'textured' | 'textured-wireframe' | 'wireframe' | 'flat';

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
  const [meshData, setMeshData] = useState<BspRenderMesh | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>('textured-wireframe');
  const [cameraSpeed, setCameraSpeed] = useState<number>(60);
  const [cameraPosDisplay, setCameraPosDisplay] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const [webGLSupported] = useState<boolean>(() => isWebGLAvailable());

  // Mutable refs for Three.js engine and fly camera animation loop
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const haloRootRef = useRef<THREE.Group | null>(null);
  const submeshMeshesRef = useRef<{ mesh: THREE.Mesh; lines: THREE.LineSegments; solidMat: THREE.MeshStandardMaterial }[]>([]);
  const textureCacheRef = useRef<Map<number, Promise<THREE.Texture | null>>>(new Map());

  // Camera fly controls state
  const camPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 10, 30));
  const camEulerRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: -0.2 });
  const keysDownRef = useRef<Set<string>>(new Set());
  const isRightMouseDownRef = useRef<boolean>(false);
  const speedRef = useRef<number>(cameraSpeed);
  speedRef.current = cameraSpeed;

  // Frame scene (center camera on world bounds)
  const frameScene = useCallback((bounds?: [number, number, number, number, number, number]) => {
    const b = bounds || meshData?.worldBounds;
    if (!b || !cameraRef.current) return;

    const [minX, minY, minZ, maxX, maxY, maxZ] = b;
    // Map Halo coordinates to Three.js coordinates under haloRoot (rx = -PI/2):
    // Halo: +X forward, +Y left, +Z up
    // Three.js: tx = hx, ty = hz, tz = -hy
    const cx = (minX + maxX) / 2;
    const cy = (minZ + maxZ) / 2;
    const cz = -(minY + maxY) / 2;

    const spanX = Math.abs(maxX - minX);
    const spanY = Math.abs(maxZ - minZ);
    const spanZ = Math.abs(maxY - minY);
    const maxSpan = Math.max(spanX, spanY, spanZ, 40);

    // Position camera diagonally elevated and looking towards center
    const dist = maxSpan * 0.75;
    const eyeY = cy + maxSpan * 0.45;
    const eyeZ = cz + dist;
    const eyeX = cx + dist * 0.3;

    camPosRef.current.set(eyeX, eyeY, eyeZ);

    // Compute yaw and pitch facing center
    const dx = cx - eyeX;
    const dy = cy - eyeY;
    const dz = cz - eyeZ;
    const horizDist = Math.sqrt(dx * dx + dz * dz);

    camEulerRef.current.yaw = Math.atan2(-dx, -dz);
    camEulerRef.current.pitch = Math.atan2(dy, horizDist);

    const speed = Math.max(20, Math.min(350, Math.round(maxSpan * 0.4)));
    setCameraSpeed(speed);
  }, [meshData]);

  // Load BSP Render Mesh
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    window.opence.getBspRenderMesh(bspIndex)
      .then((res) => {
        if (!active) return;
        if (res.ok) {
          setMeshData(res.mesh);
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

    return () => {
      active = false;
    };
  }, [bspIndex]);

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
        // Failed to load texture - fallback to neutral solid color
      }
      return null;
    })();
    cache.set(shaderTagId, promise);
    return promise;
  }, []);

  // Update render mode materials
  useEffect(() => {
    for (const item of submeshMeshesRef.current) {
      const { mesh, lines, solidMat } = item;
      switch (renderMode) {
        case 'textured':
          mesh.visible = true;
          lines.visible = false;
          solidMat.wireframe = false;
          break;
        case 'textured-wireframe':
          mesh.visible = true;
          lines.visible = true;
          (lines.material as THREE.LineBasicMaterial).opacity = 0.35;
          solidMat.wireframe = false;
          break;
        case 'wireframe':
          mesh.visible = false;
          lines.visible = true;
          (lines.material as THREE.LineBasicMaterial).opacity = 0.9;
          break;
        case 'flat':
          mesh.visible = true;
          lines.visible = false;
          solidMat.wireframe = false;
          break;
      }
    }
  }, [renderMode]);

  // Main Three.js setup and animation loop
  useEffect(() => {
    if (!webGLSupported || !containerRef.current || !meshData) return;

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

    // Headlight attached to camera
    const headLight = new THREE.PointLight(0xffffff, 0.5, 300);
    scene.add(headLight);

    // 5. Halo coordinate root: Z-up to Y-up
    const haloRoot = new THREE.Group();
    haloRoot.rotation.x = -Math.PI / 2;
    scene.add(haloRoot);
    haloRootRef.current = haloRoot;

    // 6. Build meshes from BSP submeshes
    submeshMeshesRef.current = [];
    for (const submesh of meshData.submeshes) {
      if (submesh.vertexCount === 0 || submesh.indices.length === 0) continue;

      const geom = new THREE.BufferGeometry();
      const interleaved = new THREE.InterleavedBuffer(submesh.vertices, 8);
      geom.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
      geom.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
      geom.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleaved, 2, 6));
      geom.setIndex(new THREE.BufferAttribute(submesh.indices, 1));
      if (submesh.lightmapUvs && submesh.lightmapUvs.length > 0) {
        geom.setAttribute('uv2', new THREE.BufferAttribute(submesh.lightmapUvs, 2));
      }

      const solidMat = new THREE.MeshStandardMaterial({
        color: 0x90a4ae,
        roughness: 0.85,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geom, solidMat);
      haloRoot.add(mesh);

      // Wireframe overlay lines
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

      submeshMeshesRef.current.push({ mesh, lines, solidMat });

      // Request diffuse texture asynchronously
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

    // Initial frame on bounds
    frameScene(meshData.worldBounds);

    // 7. Event Listeners for Fly Camera
    const canvas = renderer.domElement;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        isRightMouseDownRef.current = true;
        canvas.focus();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        isRightMouseDownRef.current = false;
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isRightMouseDownRef.current) {
        camEulerRef.current.yaw -= e.movementX * 0.003;
        camEulerRef.current.pitch -= e.movementY * 0.003;
        const limit = Math.PI / 2 - 0.02;
        camEulerRef.current.pitch = Math.max(-limit, Math.min(limit, camEulerRef.current.pitch));
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      keysDownRef.current.add(e.code);
      if (e.code === 'KeyR' && !(e.ctrlKey || e.metaKey)) {
        frameScene(meshData.worldBounds);
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

      // Update camera orientation
      const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);

      // Compute movement directions
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0);

      const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.5 : 1.0;
      const moveStep = speedRef.current * boost * dt;

      if (keys.has('KeyW')) pos.addScaledVector(forward, moveStep);
      if (keys.has('KeyS')) pos.addScaledVector(forward, -moveStep);
      if (keys.has('KeyA')) pos.addScaledVector(right, -moveStep);
      if (keys.has('KeyD')) pos.addScaledVector(right, moveStep);
      if (keys.has('Space') || keys.has('KeyE')) pos.addScaledVector(up, moveStep);
      if (keys.has('KeyC') || keys.has('KeyQ')) pos.addScaledVector(up, -moveStep);

      camera.position.copy(pos);
      headLight.position.copy(pos);

      // Throttle camera pos UI updates to ~10 fps
      displayThrottle += dt;
      if (displayThrottle > 0.1) {
        displayThrottle = 0;
        setCameraPosDisplay({ x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) });
      }

      renderer.render(scene, camera);
    };

    animId = requestAnimationFrame(animate);

    // 10. Cleanup on unmount or mesh change
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

      for (const item of submeshMeshesRef.current) {
        item.mesh.geometry.dispose();
        item.lines.geometry.dispose();
        (item.lines.material as THREE.Material).dispose();
        item.solidMat.dispose();
      }
      submeshMeshesRef.current = [];

      renderer.dispose();
      if (canvas.parentElement) {
        canvas.parentElement.removeChild(canvas);
      }
    };
  }, [webGLSupported, meshData, frameScene, loadTexture]);

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
            BSP {bspIndex} ({meshData?.submeshes.length ?? 0} submeshes)
          </span>
          <span style={{ color: 'var(--text-dim)' }}>|</span>
          <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
            {meshData?.totalVertices.toLocaleString() ?? 0} verts / {meshData?.totalTriangles.toLocaleString() ?? 0} tris
          </span>
        </div>

        {/* Viewport Render Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
        </div>
      </div>

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
          {meshData && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
              BSP Geometry extracted: {meshData.submeshes.length} submeshes, {meshData.totalVertices} vertices, {meshData.totalTriangles} triangles.
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
          RMB + WASD: Fly | Shift: 2.5x Speed | Space/C: Up/Down | R: Frame | Scroll: Speed
        </div>
      </div>
    </div>
  );
}

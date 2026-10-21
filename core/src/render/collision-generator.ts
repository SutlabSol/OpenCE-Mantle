/**
 * Collision model geometry analyzer and generator for Halo CE.
 * Validates OBJ mesh complexity for in-app simple collision proxy generation.
 */

export interface ObjMeshSummary {
  vertexCount: number;
  triangleCount: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  isTooComplex: boolean;
  message: string;
}

export function parseAndAnalyzeObj(objText: string): ObjMeshSummary {
  const lines = objText.split(/\r?\n/);
  const vertices: [number, number, number][] = [];
  const triangles: [number, number, number][] = [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    const prefix = parts[0].toLowerCase();

    if (prefix === 'v') {
      const x = parseFloat(parts[1]) || 0;
      const y = parseFloat(parts[2]) || 0;
      const z = parseFloat(parts[3]) || 0;
      vertices.push([x, y, z]);

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    } else if (prefix === 'f') {
      const vIndices: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const seg = parts[i].split('/')[0];
        const idx = parseInt(seg, 10);
        if (!isNaN(idx)) {
          // OBJ indices are 1-based, or negative for relative
          const resolved = idx > 0 ? idx - 1 : vertices.length + idx;
          vIndices.push(resolved);
        }
      }
      // Triangulate polygon fan
      for (let i = 1; i < vIndices.length - 1; i++) {
        triangles.push([vIndices[0], vIndices[i], vIndices[i + 1]]);
      }
    }
  }

  const vertexCount = vertices.length;
  const triangleCount = triangles.length;

  if (vertexCount === 0 || triangleCount === 0) {
    return {
      vertexCount: 0,
      triangleCount: 0,
      bounds: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] },
      isTooComplex: true,
      message: 'No valid 3D mesh vertices or faces were found in this OBJ file.',
    };
  }

  const bounds = {
    min: [minX, minY, minZ] as [number, number, number],
    max: [maxX, maxY, maxZ] as [number, number, number],
    size: [maxX - minX, maxY - minY, maxZ - minZ] as [number, number, number],
  };

  const MAX_SIMPLE_TRIANGLES = 64;

  if (triangleCount > MAX_SIMPLE_TRIANGLES) {
    return {
      vertexCount,
      triangleCount,
      bounds,
      isTooComplex: true,
      message: `Model geometry is too complex for in-app automatic collision generation (${triangleCount} triangles detected; maximum simple threshold is ${MAX_SIMPLE_TRIANGLES}). Halo CE collision models require a binary space partition (BSP) half-space tree with convex hulls. Please use Blender with the Halo CE HEK toolchain (tool collision-geometry) for detailed collision meshes.`,
    };
  }

  return {
    vertexCount,
    triangleCount,
    bounds,
    isTooComplex: false,
    message: `Simple collision proxy model suitable for in-app generation (${triangleCount} triangles, ${vertexCount} vertices).`,
  };
}

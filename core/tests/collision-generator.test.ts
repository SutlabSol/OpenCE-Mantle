import { describe, expect, it } from 'vitest';
import {
  buildCustomObjectContainer,
  compileMeshCollisionBspData,
  parseObjMesh,
} from '../src/render/collision-generator';

describe('4-Stage Blender-Parity .OBJ Collision BSP Compiler', () => {
  it('merges coplanar triangles into convex polygons (Limited Dissolve) and builds bsp2d_nodes', () => {
    // A 12-triangle cube with UV-split duplicate vertices
    const cubeObj = `
o Cube
usemtl metal_hull
v -1 -1  0
v  1 -1  0
v  1  1  0
v -1  1  0
v -1 -1  2
v  1 -1  2
v  1  1  2
v -1  1  2
# Bottom (-Z)
f 1 4 3
f 1 3 2
# Top (+Z)
f 5 6 7
f 5 7 8
# Front (-Y)
f 1 2 6
f 1 6 5
# Back (+Y)
f 3 4 8
f 3 8 7
# Left (-X)
f 4 1 5
f 4 5 8
# Right (+X)
f 2 3 7
f 2 7 6
`;
    const mesh = parseObjMesh(cubeObj);
    expect(mesh.rawFaces.length).toBe(12);
    const compiled = compileMeshCollisionBspData(mesh, 1, { mode: 'auto' });
    expect(compiled).not.toBeNull();
    // 12 triangles on 6 planes should merge into 6 quad surfaces (4 edges each -> 12 shared edges)!
    expect(compiled!.stats.weldedVertices).toBe(8);
    expect(compiled!.stats.mergedSurfaces).toBe(6);
    expect(compiled!.stats.planes).toBe(6);
    expect(compiled!.stats.edges).toBe(12);
    expect(compiled!.stats.isConcave).toBe(false);
  });

  it('compiles concave archway/L-shape meshes with two-sided surface/leaf flags to prevent ghost walls', () => {
    // An L-shaped concave step / ramp mesh
    const concaveObj = `
o ConcaveStep
usemtl stone_wall
v 0 0 0
v 4 0 0
v 4 0 2
v 2 0 2
v 2 0 4
v 0 0 4
v 0 4 0
v 4 4 0
v 4 4 2
v 2 4 2
v 2 4 4
v 0 4 4
# Horizontal step tread (z=2, x=2..4)
f 4 3 9
f 4 9 10
# Vertical riser (x=2, z=2..4)
f 4 10 11
f 4 11 5
# Top step (z=4, x=0..2)
f 6 5 11
f 6 11 12
# Bottom base (z=0)
f 1 7 8
f 1 8 2
`;
    const mesh = parseObjMesh(concaveObj);
    const compiled = compileMeshCollisionBspData(mesh, 1, { mode: 'auto' });
    expect(compiled).not.toBeNull();
    expect(compiled!.stats.isConcave).toBe(true);
    // Leaf 0 must have _collision_leaf_contains_two_sided_bit (0x01)
    expect(compiled!.leaves[0][0] & 0x01).toBe(1);
    // Surfaces must have _collision_surface_two_sided_bit (0x01)
    for (const surf of compiled!.surfaces) {
      expect(surf.flags & 0x01).toBe(1);
    }
    // Both forward and negated plane designators must be present in bsp2dReferences
    expect(compiled!.bsp2dReferences.length).toBe(compiled!.surfaces.length * 2);
  });

  it('automatically decimates high-poly (>512 triangle) meshes via QEM instead of falling back to a 6-plane box', () => {
    // Generate a UV sphere with 32x24 = 768 quads = 1,536 triangles (> 512 old limit!)
    const lines: string[] = ['o HighPolySphere', 'usemtl boulder_rock'];
    const rings = 24;
    const segments = 32;
    for (let r = 0; r <= rings; r++) {
      const phi = (Math.PI * r) / rings;
      for (let s = 0; s < segments; s++) {
        const theta = (2 * Math.PI * s) / segments;
        const x = Math.sin(phi) * Math.cos(theta) * 5;
        const y = Math.sin(phi) * Math.sin(theta) * 5;
        const z = Math.cos(phi) * 5;
        lines.push(`v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}`);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segments; s++) {
        const nextS = (s + 1) % segments;
        const a = r * segments + s + 1;
        const b = r * segments + nextS + 1;
        const c = (r + 1) * segments + nextS + 1;
        const d = (r + 1) * segments + s + 1;
        if (r > 0) lines.push(`f ${a} ${b} ${c}`);
        if (r < rings - 1) lines.push(`f ${a} ${c} ${d}`);
      }
    }

    const objText = lines.join('\n');
    const built = buildCustomObjectContainer({
      tagGroup: 'scenery',
      tagPath: 'scenery\\custom\\sphere\\sphere',
      objText,
      collisionMode: 'auto',
      targetCollisionFaces: 300,
    });

    expect(built.meshSummary.triangleCount).toBeGreaterThan(1000);
    expect(built.meshSummary.collisionPreview).toBeDefined();
    expect(built.meshSummary.collisionPreview!.inputTriangles).toBeGreaterThan(1000);
    expect(built.meshSummary.collisionPreview!.decimatedTriangles).toBeLessThanOrEqual(300);
    expect(built.meshSummary.collisionPreview!.mergedSurfaces).toBeGreaterThan(50);
  });
});

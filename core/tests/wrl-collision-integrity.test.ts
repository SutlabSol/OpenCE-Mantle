import { describe, expect, it } from 'vitest';
import {
  analyzeHaloToolLog,
  matchWrlToSubmeshes,
  parseHaloWrl,
} from '../src/render/wrl-diagnostics';
import {
  createSourceCollisionWorld,
  resolveSourceBody,
  stepSourceWalk,
} from '../src/render/live-collision';
import { auditMeshIntegrity } from '../src/render/mesh-integrity';
import { parseObjMesh } from '../src/render/collision-generator';

describe('Item 1: WRL 1.0 Diagnostics & tool.exe Log Triage', () => {
  const sampleWrl = `#VRML 1.0 ascii
Separator {
  Coordinate3 {
    point [
      0.0 0.0 0.0,
      10.0 0.0 0.0,
      0.0 10.0 0.0
    ]
  }
  MaterialBinding { value PER_FACE }
  Material {
    diffuseColor [ 1.0 0.0 0.0 ]
    transparency [ 0.0 ]
  }
  IndexedFaceSet {
    coordIndex [ 0, 1, 2, -1 ]
  }
}
Separator {
  Coordinate3 {
    point [
      5.0 5.0 1.0,
      15.0 5.0 1.0
    ]
  }
  MaterialBinding { value PER_VERTEX }
  Material {
    diffuseColor [ 1.0 0.0 0.0, 1.0 0.0 0.0 ]
  }
  IndexedLineSet {
    coordIndex [ 0, 1, -1 ]
  }
}
`;

  it('parses VRML 1.0 Separator blocks into faces, segments, and summary bounds', () => {
    const res = parseHaloWrl(sampleWrl, false);
    expect(res.format).toBe('Halo Tool VRML 1.0');
    expect(res.regions).toBe(2);
    expect(res.faces.length).toBe(1);
    expect(res.segments.length).toBe(1);
    expect(res.bounds.min).toEqual([0, 0, 0]);
    expect(res.bounds.max).toEqual([15, 10, 1]);
  });

  it('matches WRL error primitives to closest BSP submeshes', () => {
    const parsed = parseHaloWrl(sampleWrl, false);
    const assoc = matchWrlToSubmeshes(
      [
        {
          id: 'submesh_ground',
          min: [-1, -1, -1],
          max: [20, 20, 2],
        },
        {
          id: 'submesh_distant_cliff',
          min: [500, 500, 500],
          max: [520, 520, 520],
        },
      ],
      parsed,
    );
    expect(assoc.candidates.length).toBeGreaterThan(0);
    expect(assoc.candidates[0].partId).toBe('submesh_ground');
    expect(assoc.candidates[0].diagnosticSamples).toBe(2);
  });

  it('triages tool.exe compilation output into actionable diagnostics', () => {
    const log = `
### ERROR edge #42 is open (red)
### ERROR couldn't update edge #12 (red)
### WARNING nearly coplanar surfaces (red and green)
### ERROR portal outside the bsp
`;
    const review = analyzeHaloToolLog(log);
    expect(review.diagnostics.length).toBe(4);
    expect(review.containsFatal).toBe(true);
    expect(review.diagnostics.some((d) => d.code === 'OPEN_EDGE' && d.wrlUseful)).toBe(true);
    expect(review.diagnostics.some((d) => d.code === 'NON_MANIFOLD')).toBe(true);
    expect(review.diagnostics.some((d) => d.code === 'COPLANAR')).toBe(true);
    expect(review.diagnostics.some((d) => d.code === 'PORTAL')).toBe(true);
  });
});

describe('Item 2: Live First-Person Collision Walk Sandbox', () => {
  const floorPositions = new Float32Array([
    -50, -50, 0,
    50, -50, 0,
    50, 50, 0,
    -50, 50, 0,
  ]);
  const floorIndices = new Uint32Array([0, 1, 2, 0, 2, 3]);

  it('builds a spatial collision world and resolves Master Chief capsule against the floor', () => {
    const world = createSourceCollisionWorld({
      positions: floorPositions,
      indices: floorIndices,
    });
    expect(world.triangleCount).toBe(2);

    const resolved = resolveSourceBody(world, [0, 0, -0.25]);
    expect(resolved.contacts).toBeGreaterThan(0);
    expect(resolved.grounded).toBe(true);
    expect(resolved.feet[2]).toBeGreaterThan(-0.1);
  });

  it('steps Master Chief walk capsule with gravity, landing, and jump impulse', () => {
    const world = createSourceCollisionWorld({
      positions: floorPositions,
      indices: floorIndices,
    });
    let state = {
      feet: [0, 0, 0.2] as [number, number, number],
      position: [0, 0, 0.2] as [number, number, number],
      verticalSpeed: 0,
      verticalVelocity: 0,
      grounded: false,
      contacts: 0,
    };

    for (let i = 0; i < 30; i++) {
      state = stepSourceWalk(world, state, [3, 0, 0], 1 / 60, false);
    }

    expect(state.grounded).toBe(true);
    expect(state.feet[0]).toBeGreaterThan(0.5);

    // Jump test
    const jumpState = stepSourceWalk(world, state, [0, 0, 0], 1 / 60, true);
    expect(jumpState.verticalSpeed).toBeGreaterThan(0);
  });
});

describe('Item 3: Quantized BSP Mesh Integrity & T-Junction Scanner', () => {
  const closedTetrahedronObj = `
v 0 0 0
v 10 0 0
v 0 10 0
v 0 0 10
f 1 3 2
f 1 2 4
f 2 3 4
f 3 1 4
`;

  it('identifies a closed 2-manifold tetrahedron with 0 open or non-manifold edges', () => {
    const built = parseObjMesh(closedTetrahedronObj);
    expect(built.summary.meshIntegrity).toBeDefined();
    expect(built.summary.meshIntegrity!.boundaryEdges).toBe(0);
    expect(built.summary.meshIntegrity!.nonManifoldEdges).toBe(0);
    expect(built.summary.meshIntegrity!.tJunctionEdges).toBe(0);
    expect(built.summary.meshIntegrity!.edgeClosedShellCandidates).toBe(1);
  });

  it('detects open boundary edges, duplicate faces, and T-junctions on quantized meshes', () => {
    const positions = new Float32Array([
      0, 0, 0,
      10, 0, 0,
      0, 10, 0,
      5, 0, 0, // midpoint lying on edge (0,0,0)-(10,0,0)
      5, -5, 0,
    ]);
    const indices = new Uint32Array([
      0, 1, 2,
      0, 1, 2, // duplicate face
      0, 3, 4, // uses midpoint vertex 3 -> creates T-junction on edge 0..1
    ]);
    const report = auditMeshIntegrity({ positions, indices });
    expect(report.boundaryEdges).toBeGreaterThan(0);
    expect(report.duplicateFaces).toBeGreaterThan(0);
    expect(report.tJunctionEdges).toBeGreaterThan(0);
  });
});

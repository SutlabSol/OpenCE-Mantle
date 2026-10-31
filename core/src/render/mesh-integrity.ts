/**
 * Quantized-Coordinate BSP & Model Mesh Integrity and T-Junction Scanner.
 *
 * Builds a quantized coordinate edge graph (TOLERANCE = 1e-6) with Union-Find
 * connected-component tracking across triangles (ignoring split UV/normal seams)
 * to detect:
 *   1. Duplicate faces
 *   2. Degenerate (zero-area / collinear) triangles
 *   3. Short edges (< 0.1 cm in JMS scale)
 *   4. Open boundary edges (edge.count === 1)
 *   5. Non-manifold edges (edge.count > 2)
 *   6. Winding conflicts (adjacent faces with opposing normal directions)
 *   7. T-junction edges (an interior vertex lying strictly along another edge segment)
 *
 * Adapted from Project Guilty Spark (`haloMeshIntegrity.ts`).
 * Reference: https://c20.reclaimers.net/h1/guides/levels/bsp-troubleshooting/
 */

export interface MeshIntegrityReview {
  totalVertices: number;
  totalTriangles: number;
  isWaterTightManifold: boolean;
  checkedTriangles: number;
  duplicateFaces: number;
  shortEdges: number;
  degenerateTriangles: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  windingConflicts: number;
  /** Coordinate-only edge with another distinct vertex strictly inside it; a compiler-risk candidate. */
  tJunctionEdges: number;
  /** False means the bounded T-junction scan was incomplete. */
  tJunctionScanComplete: boolean;
  tJunctionCandidatesChecked: number;
  connectedShellCandidates: number;
  openShellCandidates: number;
  edgeClosedShellCandidates: number;
  exampleDuplicateTriangles: number[];
  exampleShortEdges: number[];
  exampleDegenerateTriangles: number[];
  exampleBoundaryTriangles: number[];
  exampleNonManifoldTriangles: number[];
  exampleWindingTriangles: number[];
  exampleTJunctionTriangles: number[];
  note: string;
}

const TOLERANCE = 1e-6;
const SHORT_EDGE = 0.001; // 0.1 cm in JMS x100 coordinate conversion
const AREA_EPSILON = 1e-10;
const KEY_FACTOR = 1 / TOLERANCE;
const SAMPLE_LIMIT = 16;
const TJUNCTION_COMPARISON_LIMIT = 2_000_000;
const TJUNCTION_DISTANCE_EPSILON = 0.000005;

interface QuantizedEdge {
  firstTriangle: number;
  count: number;
  directionSum: number;
  start: [number, number, number];
  end: [number, number, number];
}

function pushSample(out: number[], index: number): void {
  if (out.length < SAMPLE_LIMIT) out.push(index);
}

/**
 * Audits an indexed 3D triangle mesh for 2-manifold BSP/collision topology defects and T-junctions.
 */
export function auditMeshIntegrity(
  meshOrVertices:
    | {
        positions: ArrayLike<number>;
        indices: ArrayLike<number>;
      }
    | Array<[number, number, number]>,
  maybeTriangles?: Array<[number, number, number]>,
): MeshIntegrityReview {
  let mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> };
  if (Array.isArray(meshOrVertices)) {
    const tris = maybeTriangles ?? [];
    const flatPos = new Float32Array(meshOrVertices.length * 3);
    for (let i = 0; i < meshOrVertices.length; i++) {
      const v = meshOrVertices[i];
      flatPos[i * 3] = v[0];
      flatPos[i * 3 + 1] = v[1];
      flatPos[i * 3 + 2] = v[2];
    }
    const flatIdx = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      flatIdx[i * 3] = t[0];
      flatIdx[i * 3 + 1] = t[1];
      flatIdx[i * 3 + 2] = t[2];
    }
    mesh = { positions: flatPos, indices: flatIdx };
  } else {
    mesh = meshOrVertices;
  }
  const posLen = mesh.positions.length;
  const idxLen = mesh.indices.length;
  if (!posLen || !idxLen || posLen % 3 !== 0 || idxLen % 3 !== 0) {
    throw new Error('Mesh integrity audit requires non-empty coordinate/index triplets');
  }

  const vertexCount = posLen / 3;
  const triangleCount = idxLen / 3;

  const getPoint = (index: number): [number, number, number] => [
    mesh.positions[index * 3],
    mesh.positions[index * 3 + 1],
    mesh.positions[index * 3 + 2],
  ];

  const byIndex = new Map<number, string>();
  const uniquePointPositions = new Map<string, [number, number, number]>();
  const vertexKey = (index: number): string => {
    let key = byIndex.get(index);
    if (key === undefined) {
      const coords = getPoint(index);
      key = `${Math.round(coords[0] * KEY_FACTOR)}:${Math.round(coords[1] * KEY_FACTOR)}:${Math.round(coords[2] * KEY_FACTOR)}`;
      byIndex.set(index, key);
      if (!uniquePointPositions.has(key)) {
        uniquePointPositions.set(key, coords);
      }
    }
    return key;
  };

  const parents = new Int32Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) parents[t] = t;
  const find = (id: number): number => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]];
      id = parents[id];
    }
    return id;
  };
  const union = (left: number, right: number): void => {
    const l = find(left);
    const r = find(right);
    if (l !== r) parents[r] = l;
  };

  const faces = new Map<string, number>();
  const edges = new Map<string, QuantizedEdge>();
  const duplicateExamples: number[] = [];
  const shortExamples: number[] = [];
  const degenerateExamples: number[] = [];
  const boundaryExamples: number[] = [];
  const nonManifoldExamples: number[] = [];
  const windingExamples: number[] = [];
  let duplicateFaces = 0;
  let shortEdges = 0;
  let degenerateTriangles = 0;
  const badTriangle = new Uint8Array(triangleCount);

  for (let t = 0; t < triangleCount; t++) {
    const i0 = mesh.indices[t * 3];
    const i1 = mesh.indices[t * 3 + 1];
    const i2 = mesh.indices[t * 3 + 2];
    if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) {
      continue;
    }
    const ids = [i0, i1, i2];
    const tags = ids.map(vertexKey);
    const identity = [...tags].sort().join(';');
    const oldFace = faces.get(identity);
    if (oldFace !== undefined) {
      duplicateFaces++;
      badTriangle[t] = 1;
      badTriangle[oldFace] = 1;
      pushSample(duplicateExamples, t);
    } else {
      faces.set(identity, t);
    }

    const a = getPoint(i0);
    const b = getPoint(i1);
    const c = getPoint(i2);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    if (new Set(tags).size < 3 || Math.hypot(cross[0], cross[1], cross[2]) <= AREA_EPSILON) {
      degenerateTriangles++;
      badTriangle[t] = 1;
      pushSample(degenerateExamples, t);
    }

    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      const left = tags[k];
      const right = tags[j];
      if (left === right) continue;
      const key = left < right ? `${left}|${right}` : `${right}|${left}`;
      const direction = left < right ? 1 : -1;
      const old = edges.get(key);
      if (old) {
        union(t, old.firstTriangle);
        old.count++;
        old.directionSum += direction;
      } else {
        const pa = getPoint(ids[k]);
        const pb = getPoint(ids[j]);
        edges.set(key, {
          firstTriangle: t,
          count: 1,
          directionSum: direction,
          start: pa,
          end: pb,
        });
        if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) < SHORT_EDGE) {
          shortEdges++;
          pushSample(shortExamples, t);
        }
      }
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let windingConflicts = 0;
  for (const e of edges.values()) {
    if (e.count === 1) {
      boundaryEdges++;
      pushSample(boundaryExamples, e.firstTriangle);
    } else if (e.count > 2) {
      nonManifoldEdges++;
      pushSample(nonManifoldExamples, e.firstTriangle);
    } else if (e.directionSum !== 0) {
      windingConflicts++;
      pushSample(windingExamples, e.firstTriangle);
    }
  }

  const uniquePoints = [...uniquePointPositions.values()];
  const sorted = ([0, 1, 2] as const).map((axis) =>
    [...uniquePoints].sort((a, b) => a[axis] - b[axis]),
  );
  const lowerBound = (
    points: [number, number, number][],
    axis: 0 | 1 | 2,
    target: number,
  ): number => {
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (points[mid][axis] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let tJunctionEdges = 0;
  let tJunctionCandidatesChecked = 0;
  let tJunctionScanComplete = true;
  const tJunctionExamples: number[] = [];

  for (const edge of edges.values()) {
    const a = edge.start;
    const b = edge.end;
    const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const lengthSquared = delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2;
    if (lengthSquared < SHORT_EDGE ** 2) continue;
    const axis = (
      Math.abs(delta[1]) > Math.abs(delta[0])
        ? Math.abs(delta[2]) > Math.abs(delta[1])
          ? 2
          : 1
        : Math.abs(delta[2]) > Math.abs(delta[0])
          ? 2
          : 0
    ) as 0 | 1 | 2;
    const candidates = sorted[axis];
    const min = Math.min(a[axis], b[axis]) - TJUNCTION_DISTANCE_EPSILON;
    const max = Math.max(a[axis], b[axis]) + TJUNCTION_DISTANCE_EPSILON;
    const begin = lowerBound(candidates, axis, min);
    const end = lowerBound(candidates, axis, max);
    if (tJunctionCandidatesChecked + (end - begin) > TJUNCTION_COMPARISON_LIMIT) {
      tJunctionScanComplete = false;
      break;
    }
    let found = false;
    const length = Math.sqrt(lengthSquared);
    for (let i = begin; i < end; i++) {
      tJunctionCandidatesChecked++;
      const pt = candidates[i];
      const t =
        ((pt[0] - a[0]) * delta[0] +
          (pt[1] - a[1]) * delta[1] +
          (pt[2] - a[2]) * delta[2]) /
        lengthSquared;
      if (
        t <= TJUNCTION_DISTANCE_EPSILON / length ||
        t >= 1 - TJUNCTION_DISTANCE_EPSILON / length
      ) {
        continue;
      }
      const projX = a[0] + t * delta[0] - pt[0];
      const projY = a[1] + t * delta[1] - pt[1];
      const projZ = a[2] + t * delta[2] - pt[2];
      if (projX * projX + projY * projY + projZ * projZ <= TJUNCTION_DISTANCE_EPSILON ** 2) {
        found = true;
        break;
      }
    }
    if (found) {
      tJunctionEdges++;
      badTriangle[edge.firstTriangle] = 1;
      pushSample(tJunctionExamples, edge.firstTriangle);
    }
  }

  for (const e of edges.values()) {
    if (e.count !== 2 || e.directionSum !== 0) {
      badTriangle[e.firstTriangle] = 1;
    }
  }

  const componentDirty = new Map<number, boolean>();
  for (let t = 0; t < triangleCount; t++) {
    const root = find(t);
    const dirty = (componentDirty.get(root) ?? false) || badTriangle[t] === 1;
    componentDirty.set(root, dirty);
  }
  let openShellCandidates = 0;
  let edgeClosedShellCandidates = 0;
  for (const dirty of componentDirty.values()) {
    if (dirty) openShellCandidates++;
    else edgeClosedShellCandidates++;
  }

  return {
    totalVertices: vertexCount,
    totalTriangles: triangleCount,
    isWaterTightManifold:
      boundaryEdges === 0 &&
      nonManifoldEdges === 0 &&
      windingConflicts === 0 &&
      duplicateFaces === 0 &&
      degenerateTriangles === 0,
    checkedTriangles: triangleCount,
    duplicateFaces,
    shortEdges,
    degenerateTriangles,
    boundaryEdges,
    nonManifoldEdges,
    windingConflicts,
    tJunctionEdges,
    tJunctionScanComplete,
    tJunctionCandidatesChecked,
    connectedShellCandidates: componentDirty.size,
    openShellCandidates,
    edgeClosedShellCandidates,
    exampleDuplicateTriangles: duplicateExamples,
    exampleShortEdges: shortExamples,
    exampleDegenerateTriangles: degenerateExamples,
    exampleBoundaryTriangles: boundaryExamples,
    exampleNonManifoldTriangles: nonManifoldExamples,
    exampleWindingTriangles: windingExamples,
    exampleTJunctionTriangles: tJunctionExamples,
    note: 'Quantized coordinate edge-graph audit (1e-6 tolerance). Identifies 2-manifold defects and interior T-junctions across UV-split vertices.',
  };
}

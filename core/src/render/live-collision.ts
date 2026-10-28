/**
 * Deterministic 3D Collision, AABB BVH & Gravity Walk Sandbox for BSP and Model Viewports.
 *
 * Uses a zero-cutoff AABB Bounding Volume Hierarchy (BVH) and Christer Ericson's exact
 * closest-point-on-triangle Voronoi solver against a 3-sphere Master Chief
 * player capsule approximation (RADIUS = 0.32, EYE = 1.62, BODY_OFFSETS = [0.34, 0.91, 1.43]),
 * plus Guilty Spark's 3-sphere route walkability & head-clearance verifier (`verifyBipedRouteClearance`).
 */

export type WalkVec3 = [number, number, number];

const CELL_SIZE = 4;
const PLAYER_RADIUS = 0.32;
const PLAYER_EYE = 1.62;
const BODY_OFFSETS = [0.34, 0.91, 1.43] as const;
const MAX_TRIANGLES = 350000;
const EPS = 1e-8;

export interface CollisionTriangle {
  a: WalkVec3;
  b: WalkVec3;
  c: WalkVec3;
  normal: WalkVec3;
}

export interface CollisionBvhNode {
  min: WalkVec3;
  max: WalkVec3;
  ids?: number[];
  left?: CollisionBvhNode;
  right?: CollisionBvhNode;
}

export interface SourceCollisionWorld {
  triangles: CollisionTriangle[];
  cells: Map<string, number[]>;
  cellSize: number;
  triangleCount: number;
  bodyRadius: number;
  bodyOffsets: readonly number[];
  spatialRoot: CollisionBvhNode | null;
  queryStats: {
    lastCandidates: number;
    lastNodes: number;
    maxCandidates: number;
  };
}

export interface WalkState {
  feet: WalkVec3;
  position: WalkVec3;
  verticalSpeed: number;
  verticalVelocity: number;
  grounded: boolean;
  contacts: number;
}

export interface SourceWalkState {
  feet?: WalkVec3;
  position: WalkVec3;
  verticalSpeed?: number;
  verticalVelocity: number;
  grounded: boolean;
  contacts?: number;
}

export const WALK_EYE_HEIGHT = PLAYER_EYE;
export const WALK_JUMP_VELOCITY = 3.8;

const add = (a: WalkVec3, b: WalkVec3): WalkVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: WalkVec3, b: WalkVec3): WalkVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: WalkVec3, s: number): WalkVec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: WalkVec3, b: WalkVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: WalkVec3, b: WalkVec3): WalkVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v: WalkVec3): WalkVec3 => {
  const d = Math.hypot(v[0], v[1], v[2]);
  return d < EPS ? [0, 0, 1] : mul(v, 1 / d);
};
const isFiniteCoord = (v: number): boolean => Number.isFinite(v) && Math.abs(v) < 65536;

/**
 * Builds a top-down AABB Bounding Volume Hierarchy (BVH) over all triangles without any cell-count cutoff.
 */
export function buildCollisionBvh(triangles: CollisionTriangle[]): CollisionBvhNode | null {
  if (triangles.length === 0) return null;

  function build(ids: number[]): CollisionBvhNode {
    const min: WalkVec3 = [Infinity, Infinity, Infinity];
    const max: WalkVec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < ids.length; i++) {
      const t = triangles[ids[i]];
      const pts = [t.a, t.b, t.c];
      for (let p = 0; p < 3; p++) {
        const pt = pts[p];
        if (pt[0] < min[0]) min[0] = pt[0];
        if (pt[1] < min[1]) min[1] = pt[1];
        if (pt[2] < min[2]) min[2] = pt[2];
        if (pt[0] > max[0]) max[0] = pt[0];
        if (pt[1] > max[1]) max[1] = pt[1];
        if (pt[2] > max[2]) max[2] = pt[2];
      }
    }
    if (ids.length <= 16) {
      return { min, max, ids };
    }
    const wx = max[0] - min[0];
    const wy = max[1] - min[1];
    const wz = max[2] - min[2];
    const axis = wx >= wy && wx >= wz ? 0 : wy >= wz ? 1 : 2;
    ids.sort(
      (ia, ib) =>
        triangles[ia].a[axis] +
        triangles[ia].b[axis] +
        triangles[ia].c[axis] -
        (triangles[ib].a[axis] + triangles[ib].b[axis] + triangles[ib].c[axis]),
    );
    const half = ids.length >> 1;
    return {
      min,
      max,
      left: build(ids.slice(0, half)),
      right: build(ids.slice(half)),
    };
  }

  const allIds = new Array<number>(triangles.length);
  for (let i = 0; i < triangles.length; i++) allIds[i] = i;
  return build(allIds);
}

/**
 * Queries the AABB BVH for all triangle indices overlapping the bounding box `[min, max]`.
 */
export function queryCollisionBvhAabb(
  root: CollisionBvhNode | null,
  min: WalkVec3,
  max: WalkVec3,
): { ids: number[]; nodes: number } {
  if (!root) return { ids: [], nodes: 0 };
  const stack: CollisionBvhNode[] = [root];
  const ids: number[] = [];
  let nodes = 0;
  while (stack.length > 0) {
    const node = stack.pop()!;
    nodes++;
    if (
      node.min[0] > max[0] ||
      node.min[1] > max[1] ||
      node.min[2] > max[2] ||
      node.max[0] < min[0] ||
      node.max[1] < min[1] ||
      node.max[2] < min[2]
    ) {
      continue;
    }
    if (node.ids) {
      for (let i = 0; i < node.ids.length; i++) {
        ids.push(node.ids[i]);
      }
    } else {
      if (node.left) stack.push(node.left);
      if (node.right) stack.push(node.right);
    }
  }
  return { ids, nodes };
}

/**
 * Queries the AABB BVH for all triangle indices within `radius` of `position`.
 */
export function queryCollisionIndex(
  root: CollisionBvhNode | null,
  position: WalkVec3,
  radius: number,
): { ids: number[]; nodes: number } {
  return queryCollisionBvhAabb(
    root,
    [position[0] - radius, position[1] - radius, position[2] - radius],
    [position[0] + radius, position[1] + radius, position[2] + radius],
  );
}

/**
 * Builds a BVH collision world from any indexed triangle mesh (`BspRenderMesh` or `ModelRenderGeometry`).
 * Accepts either `positions` (stride 3: `[x, y, z]`) or `vertices` (interleaved stride 8: `[x, y, z, nx, ny, nz, u, v]`).
 */
export type CollisionSubmeshInput = {
  positions?: ArrayLike<number>;
  vertices?: ArrayLike<number>;
  indices: ArrayLike<number>;
};

export function createSourceCollisionWorld(
  meshOrSubmeshes:
    | (CollisionSubmeshInput & { submeshes?: undefined })
    | { submeshes: CollisionSubmeshInput[] },
  body?: { height: number; radius: number },
): SourceCollisionWorld {
  if (
    body &&
    (!Number.isFinite(body.height) ||
      !Number.isFinite(body.radius) ||
      body.height < 0.2 ||
      body.height > 20 ||
      body.radius < 0.03 ||
      body.radius >= body.height / 2)
  ) {
    throw new Error('Invalid source biped collision dimensions');
  }

  const meshList: CollisionSubmeshInput[] =
    'submeshes' in meshOrSubmeshes && Array.isArray(meshOrSubmeshes.submeshes)
      ? meshOrSubmeshes.submeshes
      : [meshOrSubmeshes as CollisionSubmeshInput];

  const triangles: CollisionTriangle[] = [];
  const cells = new Map<string, number[]>();

  for (const mesh of meshList) {
    if (!mesh || !mesh.indices) continue;
    const rawBuf = mesh.positions ?? mesh.vertices;
    if (!rawBuf) continue;
    const stride = mesh.positions ? 3 : rawBuf.length % 8 === 0 ? 8 : 3;
    const posLen = rawBuf.length;
    const idxLen = mesh.indices.length;
    if (posLen % stride !== 0 || idxLen % 3 !== 0 || triangles.length + idxLen / 3 > MAX_TRIANGLES) {
      if (meshList.length === 1 && !('submeshes' in meshOrSubmeshes)) {
        throw new Error('Collision mesh is malformed or exceeds the triangle budget');
      }
      continue;
    }
    const vertexCount = posLen / stride;
    for (let i = 0; i < idxLen; i += 3) {
      const i0 = mesh.indices[i];
      const i1 = mesh.indices[i + 1];
      const i2 = mesh.indices[i + 2];
      if (
        i0 < 0 ||
        i1 < 0 ||
        i2 < 0 ||
        i0 >= vertexCount ||
        i1 >= vertexCount ||
        i2 >= vertexCount ||
        i0 === i1 ||
        i1 === i2 ||
        i0 === i2
      ) {
        continue;
      }
      const a: WalkVec3 = [rawBuf[i0 * stride], rawBuf[i0 * stride + 1], rawBuf[i0 * stride + 2]];
      const b: WalkVec3 = [rawBuf[i1 * stride], rawBuf[i1 * stride + 1], rawBuf[i1 * stride + 2]];
      const c: WalkVec3 = [rawBuf[i2 * stride], rawBuf[i2 * stride + 1], rawBuf[i2 * stride + 2]];
      if (!a.every(isFiniteCoord) || !b.every(isFiniteCoord) || !c.every(isFiniteCoord)) {
        continue;
      }
      const n = cross(sub(b, a), sub(c, a));
      if (Math.hypot(n[0], n[1], n[2]) < 1e-7) {
        continue;
      }
      triangles.push({ a, b, c, normal: norm(n) });
    }
  }

  const bodyRadius = body?.radius ?? PLAYER_RADIUS;
  const bodyOffsets = body
    ? [body.radius + 0.01, body.height / 2, body.height - body.radius - 0.01]
    : BODY_OFFSETS;

  return {
    triangles,
    cells,
    cellSize: CELL_SIZE,
    triangleCount: triangles.length,
    bodyRadius,
    bodyOffsets,
    spatialRoot: buildCollisionBvh(triangles),
    queryStats: {
      lastCandidates: 0,
      lastNodes: 0,
      maxCandidates: 0,
    },
  };
}

/** Christer Ericson's closest-point-on-triangle Voronoi region test. */
export function closestPointOnTriangle(p: WalkVec3, t: CollisionTriangle): WalkVec3 {
  const { a, b, c } = t;
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;

  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, mul(ab, d1 / (d1 - d3)));

  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, mul(ac, d2 / (d2 - d6)));

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    return add(b, mul(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  }

  const denom = 1 / (va + vb + vc);
  return add(a, add(mul(ab, vb * denom), mul(ac, vc * denom)));
}

function nearbyTriangles(world: SourceCollisionWorld, p: WalkVec3, r: number): number[] {
  const res = queryCollisionIndex(world.spatialRoot, p, r);
  world.queryStats.lastCandidates = res.ids.length;
  world.queryStats.lastNodes = res.nodes;
  world.queryStats.maxCandidates = Math.max(world.queryStats.maxCandidates, res.ids.length);
  return res.ids;
}

export function resolveSourceBody(
  world: SourceCollisionWorld,
  feet: WalkVec3,
): { feet: WalkVec3; position: WalkVec3; grounded: boolean; contacts: number } {
  const radius = world.bodyRadius ?? PLAYER_RADIUS;
  const offsets = world.bodyOffsets ?? BODY_OFFSETS;
  let at: WalkVec3 = [feet[0], feet[1], feet[2]];
  let contacts = 0;
  let grounded = false;

  for (let iteration = 0; iteration < 5; iteration++) {
    let pushed = false;
    for (const offset of offsets) {
      const center: WalkVec3 = [at[0], at[1], at[2] + offset];
      for (const index of nearbyTriangles(world, center, radius + 0.025)) {
        const t = world.triangles[index];
        const point = closestPointOnTriangle(center, t);
        const delta = sub(center, point);
        const dist = Math.hypot(delta[0], delta[1], delta[2]);
        if (dist > radius + 0.02) continue;
        const direction = dist > EPS ? mul(delta, 1 / dist) : t.normal;
        if (direction[2] > 0.5 && dist <= radius + 0.02) {
          grounded = true;
        }
        if (dist >= radius - 0.0005) continue;
        const amount = Math.min(0.35, radius - dist + 0.0005);
        at = add(at, mul(direction, amount));
        contacts++;
        pushed = true;
      }
    }
    if (!pushed) break;
  }

  return { feet: at, position: at, grounded, contacts };
}

/**
 * Advances the Spartan walk state by `dt` seconds with sub-stepped gravity and collision resolution.
 */
export function stepSourceWalk(
  world: SourceCollisionWorld,
  state: {
    feet?: WalkVec3;
    position?: WalkVec3;
    verticalSpeed?: number;
    verticalVelocity?: number;
    grounded: boolean;
    contacts?: number;
  },
  planar: WalkVec3,
  dt: number,
  jumpRequested = false,
): WalkState {
  const startFeet = state.feet ?? state.position ?? [0, 0, 0];
  const startVz = state.verticalSpeed ?? state.verticalVelocity ?? 0;
  const clampedDt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
  if (clampedDt === 0) {
    return {
      feet: startFeet,
      position: startFeet,
      verticalSpeed: startVz,
      verticalVelocity: startVz,
      grounded: state.grounded,
      contacts: state.contacts ?? 0,
    };
  }

  let vZ = startVz;
  if (jumpRequested && state.grounded) {
    vZ = WALK_JUMP_VELOCITY;
  }

  const speed = Math.hypot(planar[0], planar[1]);
  const safePlanar: WalkVec3 =
    speed > 60 ? [(planar[0] / speed) * 60, (planar[1] / speed) * 60, 0] : [planar[0], planar[1], 0];

  const steps = Math.max(
    1,
    Math.ceil((Math.hypot(safePlanar[0], safePlanar[1], vZ) * clampedDt) / 0.12),
  );
  let next: WalkState = {
    feet: [startFeet[0], startFeet[1], startFeet[2]],
    position: [startFeet[0], startFeet[1], startFeet[2]],
    verticalSpeed: vZ,
    verticalVelocity: vZ,
    grounded: state.grounded,
    contacts: 0,
  };
  let totalContacts = 0;

  for (let i = 0; i < steps; i++) {
    const h = clampedDt / steps;
    const speedZ = Math.max(-16, (next.verticalSpeed ?? 0) - 12 * h);
    const delta: WalkVec3 = [safePlanar[0] * h, safePlanar[1] * h, speedZ * h];
    const resolved = resolveSourceBody(world, add(next.position, delta));
    totalContacts += resolved.contacts;
    const finalVz = resolved.grounded && speedZ < 0 ? 0 : speedZ;
    next = {
      feet: resolved.feet,
      position: resolved.feet,
      verticalSpeed: finalVz,
      verticalVelocity: finalVz,
      grounded: resolved.grounded,
      contacts: resolved.contacts,
    };
  }

  return { ...next, contacts: totalContacts };
}

/**
 * Raycasts/queries the highest walkable floor Z (`normal[2] >= 0.65`) beneath `at` within `[at[2] - maxDrop, at[2] + maxRise]`.
 * Adapted from Guilty Spark (`crates/spark-core/src/bsp_clearance.rs:114-139`).
 */
export function findWalkableFloorZ(
  world: SourceCollisionWorld,
  at: WalkVec3,
  maxDrop = 2.0,
  maxRise = 0.25,
): number | null {
  const { ids } = queryCollisionBvhAabb(
    world.spatialRoot,
    [at[0] - 1e-4, at[1] - 1e-4, at[2] - maxDrop],
    [at[0] + 1e-4, at[1] + 1e-4, at[2] + maxRise],
  );
  let bestZ: number | null = null;
  for (let i = 0; i < ids.length; i++) {
    const t = world.triangles[ids[i]];
    if (Math.abs(t.normal[2]) < 0.65) continue;
    const z = t.a[2] - (t.normal[0] * (at[0] - t.a[0]) + t.normal[1] * (at[1] - t.a[1])) / t.normal[2];
    if (z > at[2] + maxRise || z < at[2] - maxDrop) continue;
    const testPt: WalkVec3 = [at[0], at[1], z];
    const cp = closestPointOnTriangle(testPt, t);
    const dx = cp[0] - testPt[0];
    const dy = cp[1] - testPt[1];
    const dz = cp[2] - testPt[2];
    if (dx * dx + dy * dy + dz * dz < 1e-6) {
      bestZ = bestZ === null ? z : Math.max(bestZ, z);
    }
  }
  return bestZ;
}

export interface BipedClearanceReport {
  ok: boolean;
  walkSamples: number;
  maxStepHeight: number;
  blockedAt?: WalkVec3;
  reason?: string;
}

export type BipedClearanceVerificationResult = BipedClearanceReport;

export interface LiveCollisionPolygon {
  vertices: WalkVec3[];
  plane?: [number, number, number, number];
}

export function buildCollisionIndexFromPolygons(polygons: LiveCollisionPolygon[]): SourceCollisionWorld {
  const flatPositions: number[] = [];
  const flatIndices: number[] = [];
  for (const poly of polygons) {
    if (!poly.vertices || poly.vertices.length < 3) continue;
    const baseV = Math.floor(flatPositions.length / 3);
    for (const v of poly.vertices) {
      flatPositions.push(v[0], v[1], v[2]);
    }
    for (let k = 1; k + 1 < poly.vertices.length; k++) {
      flatIndices.push(baseV, baseV + k, baseV + k + 1);
    }
  }
  return createSourceCollisionWorld({
    positions: new Float32Array(flatPositions),
    indices: new Uint32Array(flatIndices),
  });
}

/**
 * Verifies continuous walkable floor & 3-sphere Spartan capsule clearance (`heights = [0.20, 0.36, 0.52]`, `radius = 0.18`)
 * along a polyline route (`tunnelPoints` or bridge centerline).
 * Ported from Guilty Spark (`crates/spark-core/src/bsp_clearance.rs:195-223`).
 */
export function verifyBipedRouteClearance(
  world: SourceCollisionWorld,
  routePoints: WalkVec3[],
  optionsOrSpacing?:
    | number
    | {
        sampleSpacing?: number;
        maxStepHeight?: number;
        capsuleRadius?: number;
      },
): BipedClearanceReport {
  if (routePoints.length < 2) {
    return { ok: false, walkSamples: 0, maxStepHeight: 0, reason: 'Route requires at least 2 waypoints.' };
  }
  const options =
    typeof optionsOrSpacing === 'number' ? { sampleSpacing: optionsOrSpacing } : optionsOrSpacing;
  const spacing = Math.max(0.1, options?.sampleSpacing ?? 0.25);
  const maxStep = options?.maxStepHeight ?? 0.35;
  const radius = options?.capsuleRadius ?? 0.18;
  const radiusSq = (radius - 0.002) * (radius - 0.002);

  let samples = 0;
  let prevZ: number | null = null;
  let observedMaxStep = 0;

  for (let seg = 0; seg < routePoints.length - 1; seg++) {
    const a = routePoints[seg];
    const b = routePoints[seg + 1];
    const d = sub(b, a);
    const len = Math.hypot(d[0], d[1], d[2]);
    const steps = Math.max(1, Math.ceil(len / spacing));
    for (let s = 0; s <= steps; s++) {
      const p = add(a, mul(d, s / steps));
      const floorZ = findWalkableFloorZ(world, p, 3.5, 0.8);
      if (floorZ === null) {
        return {
          ok: false,
          walkSamples: samples,
          maxStepHeight: observedMaxStep,
          blockedAt: p,
          reason: `Route floor is discontinuous near (${p[0].toFixed(2)}, ${p[1].toFixed(2)}, ${p[2].toFixed(2)}).`,
        };
      }
      if (prevZ !== null) {
        const dz = Math.abs(floorZ - prevZ);
        if (dz > observedMaxStep) observedMaxStep = dz;
        if (dz > maxStep) {
          return {
            ok: false,
            walkSamples: samples,
            maxStepHeight: observedMaxStep,
            blockedAt: [p[0], p[1], floorZ],
            reason: `Route floor has an abrupt step of ${dz.toFixed(2)}u (> ${maxStep}u) near (${p[0].toFixed(2)}, ${p[1].toFixed(2)}).`,
          };
        }
      }
      prevZ = floorZ;

      // 3-sphere vertical biped clearance check against non-floor wall/ceiling obstacles
      for (const h of [0.35, 0.75, 1.25]) {
        const sphereCenter: WalkVec3 = [p[0], p[1], floorZ + h];
        const { ids } = queryCollisionIndex(world.spatialRoot, sphereCenter, radius);
        for (let k = 0; k < ids.length; k++) {
          const tri = world.triangles[ids[k]];
          // Skip walkable floor triangles under the feet
          if (Math.abs(tri.normal[2]) >= 0.65 && tri.a[2] <= floorZ + 0.15) continue;
          const cp = closestPointOnTriangle(sphereCenter, tri);
          const dx = sphereCenter[0] - cp[0];
          const dy = sphereCenter[1] - cp[1];
          const dz = sphereCenter[2] - cp[2];
          if (dx * dx + dy * dy + dz * dz < radiusSq) {
            return {
              ok: false,
              walkSamples: samples,
              maxStepHeight: observedMaxStep,
              blockedAt: sphereCenter,
              reason: `Biped capsule head/shoulder clearance blocked at (${p[0].toFixed(2)}, ${p[1].toFixed(2)}, ${(floorZ + h).toFixed(2)}).`,
            };
          }
        }
      }
      samples++;
    }
  }

  return {
    ok: true,
    walkSamples: samples,
    maxStepHeight: observedMaxStep,
  };
}

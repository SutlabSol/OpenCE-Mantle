import { parseCacheFileHeader, type CacheFileHeader } from './header';
import { parseTagIndex, resolveTagDataPointer, type TagIndex } from './tag-index';
import { getGroupStructName, isRangeInBuffer, resolvePointer, resolveStruct } from './definitions/engine';
import { extractBspRenderMesh } from '../render/bsp-geometry';
import { exportBspToObj } from '../render/model-exporter';
import { buildCustomObjectContainer } from '../render/collision-generator';
import { applyInjectionWithReport, planAddInjection } from './tag-injector';
import { TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../constants/cache-file';
import { fourCCFromString, NULL_TAG_ID } from '../constants/tag-classes';
import { duplicateTagInMap } from './tag-index-editor';

export interface CollisionWireframeData {
  tagIndex: number;
  tagPath: string;
  vertexCount: number;
  edgeCount: number;
  surfaceCount: number;
  /** Flat array of [x0, y0, z0, x1, y1, z1, ...] in Halo world coordinates */
  linePositions: number[];
  /** Reconstructed Wavefront .OBJ text of all collision surfaces */
  objText: string;
}

export interface TagClassConversionResult {
  buffer: Buffer;
  createdTagIndex: number;
  createdTagPath: string;
  createdTagGroup: string;
  summary: string;
}

const OBJECT_SUBCLASS_SPECS: Record<
  string,
  {
    fourCC: string;
    secondaryFourCC: string;
    tertiaryFourCC: string | null;
    objectTypeEnum: number;
    structSize: number;
  }
> = {
  biped: { fourCC: 'bipd', secondaryFourCC: 'unit', tertiaryFourCC: 'obje', objectTypeEnum: 0, structSize: 1268 },
  vehicle: { fourCC: 'vehi', secondaryFourCC: 'unit', tertiaryFourCC: 'obje', objectTypeEnum: 1, structSize: 1008 },
  weapon: { fourCC: 'weap', secondaryFourCC: 'item', tertiaryFourCC: 'obje', objectTypeEnum: 2, structSize: 1288 },
  equipment: { fourCC: 'eqip', secondaryFourCC: 'item', tertiaryFourCC: 'obje', objectTypeEnum: 3, structSize: 944 },
  garbage: { fourCC: 'garb', secondaryFourCC: 'item', tertiaryFourCC: 'obje', objectTypeEnum: 4, structSize: 944 },
  projectile: { fourCC: 'proj', secondaryFourCC: 'obje', tertiaryFourCC: null, objectTypeEnum: 5, structSize: 588 },
  scenery: { fourCC: 'scen', secondaryFourCC: 'obje', tertiaryFourCC: null, objectTypeEnum: 6, structSize: 508 },
  device_machine: { fourCC: 'mach', secondaryFourCC: 'devi', tertiaryFourCC: 'obje', objectTypeEnum: 7, structSize: 804 },
  device_control: { fourCC: 'ctrl', secondaryFourCC: 'devi', tertiaryFourCC: 'obje', objectTypeEnum: 8, structSize: 792 },
  device_light_fixture: { fourCC: 'lifi', secondaryFourCC: 'devi', tertiaryFourCC: 'obje', objectTypeEnum: 9, structSize: 720 },
  sound_scenery: { fourCC: 'ssce', secondaryFourCC: 'obje', tertiaryFourCC: null, objectTypeEnum: 11, structSize: 508 },
};

/**
 * Extracts 3D wireframe lines and a triangulated Wavefront `.OBJ` mesh from a `model_collision_geometry` (`coll`) tag.
 * Used both for the 3D Viewport Collision Hitbox overlay and for converting `coll` -> `gbxmodel` (`mod2`).
 */
export function extractCollisionModelGeometry(view: Buffer, collTagIndex: number): CollisionWireframeData {
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const entry = tagIndex.entries[collTagIndex];
  if (!entry || entry.primaryClassName !== 'model_collision_geometry') {
    throw new Error(`Tag #${collTagIndex} is not a model_collision_geometry (coll) tag.`);
  }

  const collAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(collAt, 664, view.length)) {
    throw new Error(`Collision model "${entry.path}" header is outside buffer bounds.`);
  }

  // nodes reflexive at +652 (12 bytes: count, pointer, zero)
  const nodeCount = view.readInt32LE(collAt + 652);
  const nodePtr = view.readUInt32LE(collAt + 656);
  const nodesAt = nodeCount > 0 ? resolvePointer(nodePtr, header.tagDataOffset, tagIndex.baseMemoryAddress) : -1;

  // Locate matching gbxmodel / model tag so we can transform each node's collision BSP vertices
  // from bone-local space into model-root space (matching rendered gbxmodel vertices).
  let modEntry = tagIndex.entries.find(
    (e) =>
      e.path === entry.path &&
      (e.primaryClassName === 'gbxmodel' || e.primaryClassName === 'model' || e.primaryClassFourCC === 0x6d6f6432 || e.primaryClassFourCC === 0x6d6f6465),
  );
  if (!modEntry) {
    // Search object tags whose +0x44 collision_model dependency references this collTagIndex
    for (const cand of tagIndex.entries) {
      if (!cand.primaryClassName || !OBJECT_SUBCLASS_SPECS[cand.primaryClassName]) continue;
      const objAt = resolveTagDataPointer(cand.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
      if (!isRangeInBuffer(objAt, 128, view.length)) continue;
      const collDepId = view.readUInt32LE(objAt + 0x44 + 12);
      if (collDepId === entry.tagId) {
        const modDepId = view.readUInt32LE(objAt + 0x24 + 12);
        const foundMod = tagIndex.entries.find((e) => e.tagId === modDepId);
        if (foundMod) {
          modEntry = foundMod;
          break;
        }
      }
    }
  }
  if (!modEntry) {
    // Fallback prefix match (e.g. vehicles\scorpion\scorpion vs vehicles\scorpion\scorpion_mp)
    modEntry = tagIndex.entries.find(
      (e) =>
        (e.primaryClassName === 'gbxmodel' || e.primaryClassName === 'model') &&
        (e.path.startsWith(entry.path) || entry.path.startsWith(e.path)),
    );
  }

  interface NodeTransform {
    name: string;
    invScale: number;
    rot: [number, number, number, number, number, number, number, number, number];
    tr: [number, number, number];
    hasInverseMatrix: boolean;
    worldPos: [number, number, number];
    worldMat: [number, number, number, number, number, number, number, number, number];
  }

  const modNodeTransforms: NodeTransform[] = [];
  const modNodeByName = new Map<string, NodeTransform>();

  if (modEntry && !modEntry.isExternal) {
    const modAt = resolveTagDataPointer(modEntry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    if (isRangeInBuffer(modAt, 200, view.length)) {
      const mNodeCount = view.readInt32LE(modAt + 184);
      const mNodePtr = view.readUInt32LE(modAt + 188);
      const mNodesAt = mNodeCount > 0 ? resolvePointer(mNodePtr, header.tagDataOffset, tagIndex.baseMemoryAddress) : -1;
      if (mNodesAt >= 0 && isRangeInBuffer(mNodesAt, mNodeCount * 156, view.length)) {
        const rawNodes: Array<{
          name: string;
          parent: number;
          dt: [number, number, number];
          dq: [number, number, number, number];
          scale: number;
          rot: [number, number, number, number, number, number, number, number, number];
          tr: [number, number, number];
        }> = [];

        for (let i = 0; i < mNodeCount; i++) {
          const o = mNodesAt + i * 156;
          const name = view.toString('ascii', o, o + 32).replace(/\0.*/g, '').trim().toLowerCase();
          const parent = view.readInt16LE(o + 36);
          const dt: [number, number, number] = [
            view.readFloatLE(o + 40),
            view.readFloatLE(o + 44),
            view.readFloatLE(o + 48),
          ];
          const dq: [number, number, number, number] = [
            view.readFloatLE(o + 52),
            view.readFloatLE(o + 56),
            view.readFloatLE(o + 60),
            view.readFloatLE(o + 64),
          ];
          const scale = view.readFloatLE(o + 104);
          const rot: [number, number, number, number, number, number, number, number, number] = [
            view.readFloatLE(o + 108),
            view.readFloatLE(o + 112),
            view.readFloatLE(o + 116),
            view.readFloatLE(o + 120),
            view.readFloatLE(o + 124),
            view.readFloatLE(o + 128),
            view.readFloatLE(o + 132),
            view.readFloatLE(o + 136),
            view.readFloatLE(o + 140),
          ];
          const tr: [number, number, number] = [
            view.readFloatLE(o + 144),
            view.readFloatLE(o + 148),
            view.readFloatLE(o + 152),
          ];
          rawNodes.push({ name, parent, dt, dq, scale, rot, tr });
        }

        const quatToMat3 = (q: [number, number, number, number]): [number, number, number, number, number, number, number, number, number] => {
          const [x, y, z, w] = q;
          const n = x * x + y * y + z * z + w * w;
          const s = n > 1e-8 ? 2.0 / n : 0;
          const wx = s * w * x, wy = s * w * y, wz = s * w * z;
          const xx = s * x * x, xy = s * x * y, xz = s * x * z;
          const yy = s * y * y, yz = s * y * z, zz = s * z * z;
          return [
            1 - (yy + zz), xy - wz, xz + wy,
            xy + wz, 1 - (xx + zz), yz - wx,
            xz - wy, yz + wx, 1 - (xx + yy),
          ];
        };

        const mulMat3 = (
          a: [number, number, number, number, number, number, number, number, number],
          b: [number, number, number, number, number, number, number, number, number],
        ): [number, number, number, number, number, number, number, number, number] => [
          a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
          a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
          a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
          a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
          a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
          a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
          a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
          a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
          a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
        ];

        for (let i = 0; i < rawNodes.length; i++) {
          const rn = rawNodes[i]!;
          const rotNorm = Math.abs(rn.rot[0]) + Math.abs(rn.rot[4]) + Math.abs(rn.rot[8]) + Math.abs(rn.rot[1]) + Math.abs(rn.rot[2]);
          const hasInverseMatrix = Number.isFinite(rn.scale) && Math.abs(rn.scale) > 1e-5 && rotNorm > 1e-4;

          let worldMat = quatToMat3(rn.dq);
          let worldPos: [number, number, number] = [...rn.dt];
          let pIdx = rn.parent;
          let depth = 0;
          while (pIdx >= 0 && pIdx < rawNodes.length && depth < 64) {
            const pn = rawNodes[pIdx]!;
            const pMat = quatToMat3(pn.dq);
            const rx = pMat[0] * worldPos[0] + pMat[1] * worldPos[1] + pMat[2] * worldPos[2] + pn.dt[0];
            const ry = pMat[3] * worldPos[0] + pMat[4] * worldPos[1] + pMat[5] * worldPos[2] + pn.dt[1];
            const rz = pMat[6] * worldPos[0] + pMat[7] * worldPos[1] + pMat[8] * worldPos[2] + pn.dt[2];
            worldPos = [rx, ry, rz];
            worldMat = mulMat3(pMat, worldMat);
            pIdx = pn.parent;
            depth++;
          }

          const tf: NodeTransform = {
            name: rn.name,
            invScale: hasInverseMatrix ? 1.0 / rn.scale : 1.0,
            rot: rn.rot,
            tr: rn.tr,
            hasInverseMatrix,
            worldPos,
            worldMat,
          };
          modNodeTransforms.push(tf);
          if (rn.name && !modNodeByName.has(rn.name)) {
            modNodeByName.set(rn.name, tf);
          }
        }
      }
    }
  }

  const transformNodeVertex = (nIndex: number, nName: string, vx: number, vy: number, vz: number): [number, number, number] => {
    const tf = modNodeTransforms[nIndex] ?? (nName ? modNodeByName.get(nName) : undefined);
    if (!tf) return [vx, vy, vz];
    if (tf.hasInverseMatrix) {
      const dx = (vx - tf.tr[0]) * tf.invScale;
      const dy = (vy - tf.tr[1]) * tf.invScale;
      const dz = (vz - tf.tr[2]) * tf.invScale;
      return [
        tf.rot[0] * dx + tf.rot[1] * dy + tf.rot[2] * dz,
        tf.rot[3] * dx + tf.rot[4] * dy + tf.rot[5] * dz,
        tf.rot[6] * dx + tf.rot[7] * dy + tf.rot[8] * dz,
      ];
    }
    return [
      tf.worldMat[0] * vx + tf.worldMat[1] * vy + tf.worldMat[2] * vz + tf.worldPos[0],
      tf.worldMat[3] * vx + tf.worldMat[4] * vy + tf.worldMat[5] * vz + tf.worldPos[1],
      tf.worldMat[6] * vx + tf.worldMat[7] * vy + tf.worldMat[8] * vz + tf.worldPos[2],
    ];
  };

  const linePositions: number[] = [];
  const objLines: string[] = [`# Collision model extracted from ${entry.path}`];
  let globalVertOffset = 1;
  let totalVertices = 0;
  let totalEdges = 0;
  let totalSurfaces = 0;

  if (nodesAt >= 0 && isRangeInBuffer(nodesAt, nodeCount * 64, view.length)) {
    for (let n = 0; n < nodeCount; n++) {
      const nOff = nodesAt + n * 64;
      const collNodeName = view.toString('ascii', nOff, nOff + 32).replace(/\0.*/g, '').trim().toLowerCase();
      const bspCount = view.readInt32LE(nOff + 52);
      const bspPtr = view.readUInt32LE(nOff + 56);
      if (bspCount <= 0 || bspPtr === 0) continue;
      const bspsAt = resolvePointer(bspPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
      if (!isRangeInBuffer(bspsAt, bspCount * 96, view.length)) continue;

      for (let b = 0; b < bspCount; b++) {
        const bOff = bspsAt + b * 96;
        // BSP block (96 bytes):
        // +12 planes (count, ptr), +60 surfaces (count, ptr), +72 edges (count, ptr), +84 vertices (count, ptr)
        const planeCount = view.readInt32LE(bOff + 12);
        const planePtr = view.readUInt32LE(bOff + 16);
        const surfCount = view.readInt32LE(bOff + 60);
        const surfPtr = view.readUInt32LE(bOff + 64);
        const edgeCount = view.readInt32LE(bOff + 72);
        const edgePtr = view.readUInt32LE(bOff + 76);
        const vertCount = view.readInt32LE(bOff + 84);
        const vertPtr = view.readUInt32LE(bOff + 88);

        if (vertCount <= 0 || edgeCount <= 0) continue;
        const vertsAt = resolvePointer(vertPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
        const edgesAt = resolvePointer(edgePtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
        if (!isRangeInBuffer(vertsAt, vertCount * 16, view.length) || !isRangeInBuffer(edgesAt, edgeCount * 24, view.length)) {
          continue;
        }

        const localVerts: [number, number, number][] = [];
        for (let v = 0; v < vertCount; v++) {
          const vAt = vertsAt + v * 16;
          const rawX = view.readFloatLE(vAt + 0);
          const rawY = view.readFloatLE(vAt + 4);
          const rawZ = view.readFloatLE(vAt + 8);
          const [x, y, z] = transformNodeVertex(n, collNodeName, rawX, rawY, rawZ);
          localVerts.push([x, y, z]);
          objLines.push(`v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}`);
        }

        const localEdges: Array<{
          v0: number;
          v1: number;
          fwdEdge: number;
          revEdge: number;
          leftSurf: number;
          rightSurf: number;
        }> = [];

        for (let e = 0; e < edgeCount; e++) {
          const eAt = edgesAt + e * 24;
          const v0 = view.readInt32LE(eAt + 0);
          const v1 = view.readInt32LE(eAt + 4);
          const fwdEdge = view.readInt32LE(eAt + 8);
          const revEdge = view.readInt32LE(eAt + 12);
          const leftSurf = view.readInt32LE(eAt + 16);
          const rightSurf = view.readInt32LE(eAt + 20);
          localEdges.push({ v0, v1, fwdEdge, revEdge, leftSurf, rightSurf });
          const p0 = localVerts[v0];
          const p1 = localVerts[v1];
          if (p0 && p1) {
            linePositions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
          }
        }

        // Reconstruct polygon rings per surface to emit OBJ faces
        if (surfCount > 0 && surfPtr !== 0) {
          const surfsAt = resolvePointer(surfPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
          const planesAt = planeCount > 0 ? resolvePointer(planePtr, header.tagDataOffset, tagIndex.baseMemoryAddress) : -1;
          if (isRangeInBuffer(surfsAt, surfCount * 12, view.length)) {
            for (let s = 0; s < surfCount; s++) {
              const sAt = surfsAt + s * 12;
              const firstEdge = view.readInt32LE(sAt + 4);
              if (firstEdge < 0 || firstEdge >= localEdges.length) continue;

              const ring: number[] = [];
              let currEdgeIdx = firstEdge;
              const visitedEdges = new Set<number>();
              while (currEdgeIdx >= 0 && currEdgeIdx < localEdges.length && !visitedEdges.has(currEdgeIdx)) {
                visitedEdges.add(currEdgeIdx);
                const ed = localEdges[currEdgeIdx]!;
                const isRight = ed.rightSurf === s;
                const startV = isRight ? ed.v1 : ed.v0;
                ring.push(startV);
                currEdgeIdx = isRight ? ed.revEdge : ed.fwdEdge;
                if (currEdgeIdx === firstEdge) break;
              }

              if (ring.length >= 3) {
                for (let k = 1; k + 1 < ring.length; k++) {
                  const a = globalVertOffset + ring[0]!;
                  const bIdx = globalVertOffset + ring[k]!;
                  const c = globalVertOffset + ring[k + 1]!;
                  objLines.push(`f ${a} ${bIdx} ${c}`);
                }
              }
              void planesAt;
            }
          }
        }

        totalVertices += vertCount;
        totalEdges += edgeCount;
        totalSurfaces += Math.max(0, surfCount);
        globalVertOffset += vertCount;
      }
    }
  }

  return {
    tagIndex: collTagIndex,
    tagPath: entry.path,
    vertexCount: totalVertices,
    edgeCount: totalEdges,
    surfaceCount: totalSurfaces,
    linePositions,
    objText: objLines.join('\n'),
  };
}

/**
 * Converts a `model_collision_geometry` (`coll`) tag into a visible `gbxmodel` (`mod2`) + `scenery` (`scen`) tag in-memory.
 */
export function convertCollisionToGbxmodelInMap(
  view: Buffer,
  collTagIndex: number,
  targetPath?: string,
): TagClassConversionResult {
  const wf = extractCollisionModelGeometry(view, collTagIndex);
  if (wf.vertexCount < 3 || wf.surfaceCount < 1) {
    throw new Error(`Collision tag "${wf.tagPath}" has no extractable 3D BSP surfaces.`);
  }

  const outPath = (targetPath?.trim() || `${wf.tagPath}_visible_coll`).replace(/\//g, '\\');
  const built = buildCustomObjectContainer({
    tagGroup: 'scenery',
    tagPath: outPath,
    objText: wf.objText,
    collisionMode: 'exact',
    itemName: `${outPath.split('\\').pop()} (Visible Collision)`,
  });

  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const plan = planAddInjection(
    { buffer: view, header, tagIndex },
    built.container,
    {},
    { allowEmbeddedRelocation: true },
  );
  if (plan.kind === 'refused') {
    throw new Error(`Cannot inject converted collision model: ${plan.reason}`);
  }
  const injected = applyInjectionWithReport(view, header, tagIndex, built.container, plan, {
    allowEmbeddedRelocation: true,
  });
  const newHeader = parseCacheFileHeader(injected.buffer);
  const newTagIndex = parseTagIndex(injected.buffer, newHeader);
  const gbxEntry = newTagIndex.entries.find((e) => e.path === outPath && e.primaryClassName === 'gbxmodel');

  return {
    buffer: injected.buffer,
    createdTagIndex: gbxEntry?.index ?? newTagIndex.entries.length - 1,
    createdTagPath: outPath,
    createdTagGroup: 'gbxmodel',
    summary: `Converted collision model "${wf.tagPath}" (${wf.surfaceCount} surfaces, ${wf.vertexCount} vertices) into visible gbxmodel & scenery at "${outPath}".`,
  };
}

/**
 * Converts a `scenario_structure_bsp` (`sbsp`) tag into a `gbxmodel` (`mod2`) + `scenery` (`scen`) tag in-memory.
 * `bspTagIndex` may be either a `0..N-1` index into `scenario.structure_bsps` or the tag index of a `scenario_structure_bsp` tag.
 */
export function convertSbspToSceneryInMap(
  view: Buffer,
  bspTagIndex?: number,
  targetPath?: string,
): TagClassConversionResult {
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);

  let resolvedBspIdx = bspTagIndex ?? 0;
  if (bspTagIndex !== undefined && bspTagIndex >= 0) {
    const sbspEntries = tagIndex.entries.filter((e) => e.primaryClassName === 'scenario_structure_bsp');
    if (bspTagIndex >= sbspEntries.length) {
      const matchIdx = sbspEntries.findIndex((e) => e.index === bspTagIndex);
      resolvedBspIdx = matchIdx >= 0 ? matchIdx : 0;
    }
  }

  const bspGeom = extractBspRenderMesh(view, header, tagIndex, resolvedBspIdx);
  if (bspGeom.submeshes.length === 0) {
    throw new Error('Selected BSP contains no renderable lightmap surfaces.');
  }

  const exportedObj = exportBspToObj(bspGeom);
  const bspPathName = bspGeom.bspNames?.[bspGeom.bspIndex] ?? `levels\\bsp\\bsp_${bspGeom.bspIndex}`;
  const outPath = (targetPath?.trim() || `${bspPathName}_bsp_scenery`).replace(/\//g, '\\');
  const built = buildCustomObjectContainer({
    tagGroup: 'scenery',
    tagPath: outPath,
    objText: exportedObj.objText,
    collisionMode: 'box',
    itemName: `${outPath.split('\\').pop()} (BSP Scenery)`,
  });

  const plan = planAddInjection(
    { buffer: view, header, tagIndex },
    built.container,
    {},
    { allowEmbeddedRelocation: true },
  );
  if (plan.kind === 'refused') {
    throw new Error(`Cannot inject converted BSP scenery: ${plan.reason}`);
  }
  const injected = applyInjectionWithReport(view, header, tagIndex, built.container, plan, {
    allowEmbeddedRelocation: true,
  });
  const newHeader = parseCacheFileHeader(injected.buffer);
  const newTagIndex = parseTagIndex(injected.buffer, newHeader);
  const scenEntry = newTagIndex.entries.find((e) => e.path === outPath && e.primaryClassName === 'scenery');

  return {
    buffer: injected.buffer,
    createdTagIndex: scenEntry?.index ?? newTagIndex.entries.length - 1,
    createdTagPath: outPath,
    createdTagGroup: 'scenery',
    summary: `Converted BSP "${bspPathName}" (${bspGeom.totalVertices} vertices, ${bspGeom.totalTriangles} triangles) into gbxmodel + scenery tag "${outPath}".`,
  };
}

/**
 * Converts between any of the 11 Halo CE `object` subclasses (`biped`, `vehicle`, `weapon`, `equipment`, `garbage`,
 * `projectile`, `scenery`, `device_machine`, `device_control`, `device_light_fixture`, `sound_scenery`)
 * by duplicating the tag, preserving the shared 380-byte base `Object` header (`bounding radius`, `model`,
 * `collision model`, `attachments`, `widgets`, `functions`, `change colors`), and grafting a donor tag's
 * subclass tail (`+380..structSize`, including `seats`, `camera tracks`, `powered mass points`, `physics`,
 * `animation graph`, and compatible node/marker tables) so a converted `scenery` -> `vehicle` (e.g. a boulder)
 * can spawn, collide, and be entered/driven in-game.
 */
export function convertObjectTagClassInMap(
  view: Buffer,
  sourceTagIndex: number,
  targetGroup: string,
  targetPath?: string,
): TagClassConversionResult {
  const spec = OBJECT_SUBCLASS_SPECS[targetGroup];
  if (!spec) {
    throw new Error(`Unsupported target object class "${targetGroup}".`);
  }

  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const sourceEntry = tagIndex.entries[sourceTagIndex];
  if (!sourceEntry) {
    throw new Error(`Source tag #${sourceTagIndex} not found.`);
  }
  if (!sourceEntry.primaryClassName || !OBJECT_SUBCLASS_SPECS[sourceEntry.primaryClassName]) {
    throw new Error(`Source tag "${sourceEntry.path}" (${sourceEntry.primaryClassName}) is not one of the 11 object subclasses.`);
  }

  // Find a donor tag of `targetGroup` in the map to supply subclass fields (+380..structSize), physics, seats, and rig nodes
  const donorCandidates = tagIndex.entries.filter(
    (e) => e.primaryClassName === targetGroup && !e.isExternal && e.index !== sourceTagIndex,
  );
  const preferredDonor =
    donorCandidates.find((e) =>
      targetGroup === 'vehicle'
        ? e.path.includes('warthog') || e.path.includes('ghost')
        : targetGroup === 'weapon'
          ? e.path.includes('assault rifle') || e.path.includes('pistol')
          : targetGroup === 'biped'
            ? e.path.includes('cyborg') || e.path.includes('marine')
            : true,
    ) ?? donorCandidates[0];

  const outPath = (targetPath?.trim() || `${sourceEntry.path}_as_${targetGroup}`).replace(/\//g, '\\');
  const dup = duplicateTagInMap(view, header, tagIndex, sourceTagIndex, outPath);
  let outBuf = dup.buffer;

  let curHeader = parseCacheFileHeader(outBuf);
  let curTagIndex = parseTagIndex(outBuf, curHeader);

  // If we have a donor tag and are converting across classes (e.g. scenery -> vehicle/biped/weapon),
  // duplicate the source's gbxmodel & collision model and graft the donor's node/marker tables so
  // Halo CE's animation graph & seat entry markers work without touching the original scenery's model/collision.
  let graftedModelTagId: number | null = null;
  let graftedModelPath: string | null = null;
  let graftedCollTagId: number | null = null;
  let graftedCollPath: string | null = null;

  const srcDataAtInitial = resolveTagDataPointer(
    curTagIndex.entries[sourceTagIndex]!.tagDataPointerOrResourceIndex,
    curHeader,
    curTagIndex.baseMemoryAddress,
  );
  const donorDataAtInitial = preferredDonor
    ? resolveTagDataPointer(
        curTagIndex.entries[preferredDonor.index]!.tagDataPointerOrResourceIndex,
        curHeader,
        curTagIndex.baseMemoryAddress,
      )
    : -1;

  if (
    preferredDonor &&
    donorDataAtInitial >= 0 &&
    isRangeInBuffer(srcDataAtInitial, 160, outBuf.length) &&
    isRangeInBuffer(donorDataAtInitial, 160, outBuf.length)
  ) {
    const srcModelTagId = outBuf.readUInt32LE(srcDataAtInitial + 52);
    const donorModelTagId = outBuf.readUInt32LE(donorDataAtInitial + 52);
    const srcModelIdx = srcModelTagId & 0xffff;
    const donorModelIdx = donorModelTagId & 0xffff;

    if (
      srcModelTagId !== 0xffffffff &&
      donorModelTagId !== 0xffffffff &&
      curTagIndex.entries[srcModelIdx] &&
      curTagIndex.entries[donorModelIdx]
    ) {
      const modelDup = duplicateTagInMap(outBuf, curHeader, curTagIndex, srcModelIdx, `${outPath}_model`);
      outBuf = modelDup.buffer;
      curHeader = parseCacheFileHeader(outBuf);
      curTagIndex = parseTagIndex(outBuf, curHeader);
      const newModelEntry = curTagIndex.entries[modelDup.newTagIndex]!;
      graftedModelTagId = newModelEntry.tagId;
      graftedModelPath = newModelEntry.path;

      const newModelAt = resolveTagDataPointer(
        newModelEntry.tagDataPointerOrResourceIndex,
        curHeader,
        curTagIndex.baseMemoryAddress,
      );
      const donorModelAt = resolveTagDataPointer(
        curTagIndex.entries[donorModelIdx]!.tagDataPointerOrResourceIndex,
        curHeader,
        curTagIndex.baseMemoryAddress,
      );

      if (isRangeInBuffer(newModelAt, 232, outBuf.length) && isRangeInBuffer(donorModelAt, 232, outBuf.length)) {
        // Copy node_list_checksum (+4) and detail node counts (+28..+38)
        outBuf.writeInt32LE(outBuf.readInt32LE(donorModelAt + 4), newModelAt + 4);
        donorCopyRange(outBuf, donorModelAt + 28, newModelAt + 28, 10);
        // Copy top-level markers reflexive (+172..+184) and nodes reflexive (+184..+196), then deep-clone them
        // so their reflexive arrays never overlap the donor gbxmodel's memory range.
        donorCopyRange(outBuf, donorModelAt + 172, newModelAt + 172, 24);
        outBuf = deepCloneReflexiveAtOffset(outBuf, curHeader, curTagIndex, newModelAt + 172, 'GBXModelMarker');
        curHeader = parseCacheFileHeader(outBuf);
        curTagIndex = parseTagIndex(outBuf, curHeader);
        outBuf = deepCloneReflexiveAtOffset(outBuf, curHeader, curTagIndex, newModelAt + 184, 'GBXModelNode');
        curHeader = parseCacheFileHeader(outBuf);
        curTagIndex = parseTagIndex(outBuf, curHeader);

        // Clone region[0] + permutation[0] so permutation[0].markers (+76..+88) includes donor's seat/weapon markers
        const srcRegCount = outBuf.readUInt32LE(newModelAt + 196);
        const srcRegPtr = outBuf.readUInt32LE(newModelAt + 200);
        const donorRegCount = outBuf.readUInt32LE(donorModelAt + 196);
        const donorRegPtr = outBuf.readUInt32LE(donorModelAt + 200);
        if (srcRegCount > 0 && donorRegCount > 0) {
          const srcRegAt = resolvePointer(srcRegPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
          const donorRegAt = resolvePointer(donorRegPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
          if (
            isRangeInBuffer(srcRegAt, srcRegCount * 76, outBuf.length) &&
            isRangeInBuffer(donorRegAt, 76, outBuf.length)
          ) {
            const srcPermCount = outBuf.readUInt32LE(srcRegAt + 64);
            const srcPermPtr = outBuf.readUInt32LE(srcRegAt + 68);
            const donorPermCount = outBuf.readUInt32LE(donorRegAt + 64);
            const donorPermPtr = outBuf.readUInt32LE(donorRegAt + 68);
            if (srcPermCount > 0 && donorPermCount > 0) {
              const srcPermAt = resolvePointer(srcPermPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
              const donorPermAt = resolvePointer(donorPermPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
              if (
                isRangeInBuffer(srcPermAt, srcPermCount * 88, outBuf.length) &&
                isRangeInBuffer(donorPermAt, 88, outBuf.length)
              ) {
                const clonedRegs = Buffer.from(outBuf.subarray(srcRegAt, srcRegAt + srcRegCount * 76));
                const clonedPerms = Buffer.from(outBuf.subarray(srcPermAt, srcPermAt + srcPermCount * 88));
                // Copy donor permutation[0].markers reflexive (+76..+88) into cloned permutation[0]
                outBuf.copy(clonedPerms, 76, donorPermAt + 76, donorPermAt + 88);

                const align1 = (outBuf.length + 3) & ~3;
                const pad1 = Buffer.alloc(align1 - outBuf.length, 0);
                const newRegsOffset = align1;
                const newPermsOffset = align1 + clonedRegs.length;
                const newRegsPtr = (curTagIndex.baseMemoryAddress + (newRegsOffset - curHeader.tagDataOffset)) >>> 0;
                const newPermsPtr = (curTagIndex.baseMemoryAddress + (newPermsOffset - curHeader.tagDataOffset)) >>> 0;

                clonedRegs.writeUInt32LE(newPermsPtr, 68);
                outBuf.writeUInt32LE(newRegsPtr, newModelAt + 200);

                outBuf = Buffer.concat([outBuf, pad1, clonedRegs, clonedPerms]);
                const delta = pad1.length + clonedRegs.length + clonedPerms.length;
                outBuf.writeUInt32LE(outBuf.length >>> 0, 0x08);
                outBuf.writeUInt32LE((curHeader.tagDataSize + delta) >>> 0, 0x14);
                curHeader = parseCacheFileHeader(outBuf);
                curTagIndex = parseTagIndex(outBuf, curHeader);

                outBuf = deepCloneReflexiveAtOffset(
                  outBuf,
                  curHeader,
                  curTagIndex,
                  newPermsOffset + 76,
                  'GBXModelRegionPermutationMarker',
                );
                curHeader = parseCacheFileHeader(outBuf);
                curTagIndex = parseTagIndex(outBuf, curHeader);
              }
            }
          }
        }
      }
    }

    // Also duplicate collision model and match donor's collision node count while keeping boulder's BSP on node 0
    const srcDataAt2 = resolveTagDataPointer(
      curTagIndex.entries[sourceTagIndex]!.tagDataPointerOrResourceIndex,
      curHeader,
      curTagIndex.baseMemoryAddress,
    );
    const donorDataAt2 = resolveTagDataPointer(
      curTagIndex.entries[preferredDonor.index]!.tagDataPointerOrResourceIndex,
      curHeader,
      curTagIndex.baseMemoryAddress,
    );
    const srcCollTagId = outBuf.readUInt32LE(srcDataAt2 + 124);
    const donorCollTagId = outBuf.readUInt32LE(donorDataAt2 + 124);
    const srcCollIdx = srcCollTagId & 0xffff;
    const donorCollIdx = donorCollTagId & 0xffff;

    if (
      srcCollTagId !== 0xffffffff &&
      donorCollTagId !== 0xffffffff &&
      curTagIndex.entries[srcCollIdx] &&
      curTagIndex.entries[donorCollIdx]
    ) {
      const collDup = duplicateTagInMap(outBuf, curHeader, curTagIndex, srcCollIdx, `${outPath}_collision`);
      outBuf = collDup.buffer;
      curHeader = parseCacheFileHeader(outBuf);
      curTagIndex = parseTagIndex(outBuf, curHeader);
      const newCollEntry = curTagIndex.entries[collDup.newTagIndex]!;
      graftedCollTagId = newCollEntry.tagId;
      graftedCollPath = newCollEntry.path;

      const newCollAt = resolveTagDataPointer(
        newCollEntry.tagDataPointerOrResourceIndex,
        curHeader,
        curTagIndex.baseMemoryAddress,
      );
      const donorCollAt = resolveTagDataPointer(
        curTagIndex.entries[donorCollIdx]!.tagDataPointerOrResourceIndex,
        curHeader,
        curTagIndex.baseMemoryAddress,
      );

      if (isRangeInBuffer(newCollAt, 664, outBuf.length) && isRangeInBuffer(donorCollAt, 664, outBuf.length)) {
        const srcNodesCount = outBuf.readUInt32LE(newCollAt + 652);
        const srcNodesPtr = outBuf.readUInt32LE(newCollAt + 656);
        const donorNodesCount = outBuf.readUInt32LE(donorCollAt + 652);
        const donorNodesPtr = outBuf.readUInt32LE(donorCollAt + 656);

        if (srcNodesCount > 0 && donorNodesCount > 0) {
          const srcNodesAt = resolvePointer(srcNodesPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
          const donorNodesAt = resolvePointer(donorNodesPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
          if (
            isRangeInBuffer(srcNodesAt, 64, outBuf.length) &&
            isRangeInBuffer(donorNodesAt, donorNodesCount * 64, outBuf.length)
          ) {
            const newCollNodes = Buffer.from(outBuf.subarray(donorNodesAt, donorNodesAt + donorNodesCount * 64));
            // Clear BSP reflexives on child nodes 1..N and place the source object's 3D collision BSP on node 0
            for (let n = 0; n < donorNodesCount; n++) {
              newCollNodes.writeUInt32LE(0, n * 64 + 52);
              newCollNodes.writeUInt32LE(0, n * 64 + 56);
              newCollNodes.writeUInt32LE(0, n * 64 + 60);
            }
            outBuf.copy(newCollNodes, 52, srcNodesAt + 52, srcNodesAt + 64);

            const align2 = (outBuf.length + 3) & ~3;
            const pad2 = Buffer.alloc(align2 - outBuf.length, 0);
            const newNodesPtr = (curTagIndex.baseMemoryAddress + (align2 - curHeader.tagDataOffset)) >>> 0;
            outBuf.writeUInt32LE(donorNodesCount, newCollAt + 652);
            outBuf.writeUInt32LE(newNodesPtr, newCollAt + 656);

            outBuf = Buffer.concat([outBuf, pad2, newCollNodes]);
            const delta2 = pad2.length + newCollNodes.length;
            outBuf.writeUInt32LE(outBuf.length >>> 0, 0x08);
            outBuf.writeUInt32LE((curHeader.tagDataSize + delta2) >>> 0, 0x14);
            curHeader = parseCacheFileHeader(outBuf);
            curTagIndex = parseTagIndex(outBuf, curHeader);
          }
        }
      }
    }
  }

  const newEntry = curTagIndex.entries[dup.newTagIndex]!;
  const oldDataAt = resolveTagDataPointer(newEntry.tagDataPointerOrResourceIndex, curHeader, curTagIndex.baseMemoryAddress);

  // Allocate target struct buffer at the end of the map:
  // 1. Pre-fill with donor tag's full struct (so +380..structSize has valid seats, camera, physics params, HUD, etc.)
  // 2. Overlay the source tag's 380-byte base `Object` header (bounding radius, model, collision, attachments)
  // 3. Inherit donor's `animation graph` (+56) and `physics` (+128) if missing on the source tag
  const alignedEnd = (outBuf.length + 3) & ~3;
  const pad = Buffer.alloc(alignedEnd - outBuf.length, 0);
  const newStructBuf = Buffer.alloc(spec.structSize, 0);
  const targetStructName = getGroupStructName(targetGroup);

  if (preferredDonor) {
    const donorAt = resolveTagDataPointer(
      curTagIndex.entries[preferredDonor.index]!.tagDataPointerOrResourceIndex,
      curHeader,
      curTagIndex.baseMemoryAddress,
    );
    if (isRangeInBuffer(donorAt, spec.structSize, outBuf.length)) {
      outBuf.copy(newStructBuf, 0, donorAt, donorAt + spec.structSize);
    }
  }

  outBuf.copy(newStructBuf, 0, oldDataAt, Math.min(outBuf.length, oldDataAt + 380));

  // If we grafted a rig-compatible model & collision model, wire them into +40 (model) and +112 (collision model)
  if (graftedModelTagId !== null && graftedModelPath !== null) {
    newStructBuf.writeUInt32LE(fourCCFromString('mod2'), 40);
    newStructBuf.writeUInt32LE(graftedModelTagId >>> 0, 52);
  }
  if (graftedCollTagId !== null && graftedCollPath !== null) {
    newStructBuf.writeUInt32LE(fourCCFromString('coll'), 112);
    newStructBuf.writeUInt32LE(graftedCollTagId >>> 0, 124);
  }

  // Inherit donor's animation graph (+56..+72) and physics (+128..+144) if missing on source
  if (preferredDonor) {
    const donorAt = resolveTagDataPointer(
      curTagIndex.entries[preferredDonor.index]!.tagDataPointerOrResourceIndex,
      curHeader,
      curTagIndex.baseMemoryAddress,
    );
    if (isRangeInBuffer(donorAt, 160, outBuf.length)) {
      if (newStructBuf.readUInt32LE(68) === 0xffffffff) {
        outBuf.copy(newStructBuf, 56, donorAt + 56, donorAt + 72);
      }
      if (newStructBuf.readUInt32LE(140) === 0xffffffff) {
        outBuf.copy(newStructBuf, 128, donorAt + 128, donorAt + 144);
      }
    }
  }

  // Ensure every unset TagDependency in the new struct has a valid FourCC and NULL_TAG_ID (0xFFFFFFFF)
  if (targetStructName) {
    sanitizeStructDependencies(newStructBuf, 0, targetStructName);
  }

  // Write the new object_type enum at offset +0x00 of the Object struct
  newStructBuf.writeInt16LE(spec.objectTypeEnum, 0);
  // Clear predicted_resources reflexive at +368 so stale resource indices aren't kept
  newStructBuf.writeUInt32LE(0, 368);
  newStructBuf.writeUInt32LE(0, 372);

  const prevSize = outBuf.length;
  outBuf = Buffer.concat([outBuf, pad, newStructBuf]);
  const addedBytes = outBuf.length - prevSize;
  outBuf.writeUInt32LE(outBuf.length >>> 0, 0x08);
  outBuf.writeUInt32LE((curHeader.tagDataSize + addedBytes) >>> 0, 0x14);

  // Update the TagIndex entry's primary/secondary/tertiary FourCCs and data pointer
  const tagHeaderSize = curHeader.engine === 5 ? 0x24 : TAG_DATA_HEADER_PC_SIZE;
  const entryOffset = curHeader.tagDataOffset + tagHeaderSize + dup.newTagIndex * TAG_ENTRY_SIZE;
  outBuf.writeUInt32LE(fourCCFromString(spec.fourCC), entryOffset + 0x00);
  outBuf.writeUInt32LE(fourCCFromString(spec.secondaryFourCC), entryOffset + 0x04);
  outBuf.writeUInt32LE(spec.tertiaryFourCC ? fourCCFromString(spec.tertiaryFourCC) : 0xffffffff, entryOffset + 0x08);

  const newDataPtr = (curTagIndex.baseMemoryAddress + (alignedEnd - curHeader.tagDataOffset)) >>> 0;
  outBuf.writeUInt32LE(newDataPtr, entryOffset + 0x14);

  curHeader = parseCacheFileHeader(outBuf);
  curTagIndex = parseTagIndex(outBuf, curHeader);

  // Deep-clone all TagReflexive blocks on the converted tag (e.g. powered_seats, weapons, seats,
  // camera_tracks, new_hud_interfaces, attachments, widgets, functions, change_colors) so none of them
  // overlap the donor tag's memory addresses in OpenCE's cache validator!
  if (targetStructName) {
    outBuf = deepCloneStructReflexives(outBuf, curHeader, curTagIndex, alignedEnd, targetStructName);
  }

  const donorNote = preferredDonor
    ? ` Inherited ${targetGroup} seats, physics, and rig markers from "${preferredDonor.path}".`
    : '';

  return {
    buffer: outBuf,
    createdTagIndex: dup.newTagIndex,
    createdTagPath: outPath,
    createdTagGroup: targetGroup,
    summary: `Converted "${sourceEntry.path}" (${sourceEntry.primaryClassName}) -> "${outPath}" (${targetGroup}) preserving base Object properties, model, and collision.${donorNote}`,
  };
}

function donorCopyRange(buf: Buffer, srcOff: number, dstOff: number, length: number): void {
  buf.copy(buf, dstOff, srcOff, srcOff + length);
}

/**
 * Ensures any zero-initialized `TagDependency` field in `buf` at `baseOffset` has a valid FourCC
 * and `tagId = NULL_TAG_ID` (`0xFFFFFFFF`) so OpenCE never rejects `00000000` dependencies.
 */
function sanitizeStructDependencies(buf: Buffer, baseOffset: number, structName: string): void {
  const resolved = resolveStruct(structName);
  for (const f of resolved.fields) {
    if (f.def.type !== 'TagDependency') continue;
    const off = baseOffset + f.offset;
    if (off + 16 > buf.length) continue;
    const fourcc = buf.readUInt32LE(off);
    const tagId = buf.readUInt32LE(off + 12);
    if (fourcc === 0 || tagId === 0) {
      const defaultClassName = f.def.classes?.[0];
      let defaultFourCC = NULL_TAG_ID;
      if (defaultClassName) {
        try {
          const grpStruct = getGroupStructName(defaultClassName);
          if (grpStruct) {
            const grpDef = resolveStruct(grpStruct);
            if (grpDef.tagClass && grpDef.tagClass.length === 4) {
              defaultFourCC = fourCCFromString(grpDef.tagClass);
            }
          }
        } catch {
          defaultFourCC = NULL_TAG_ID;
        }
      }
      buf.writeUInt32LE(fourcc !== 0 ? fourcc : defaultFourCC, off + 0);
      buf.writeUInt32LE(0, off + 4);
      buf.writeUInt32LE(0, off + 8);
      buf.writeUInt32LE(NULL_TAG_ID, off + 12);
    }
  }
}

/**
 * Deep-clones a single `TagReflexive` header at `refHeaderAbsOffset` (`count` at +0, `ptr` at +4)
 * whose elements are of type `childStructName` into fresh 4-byte-aligned memory at the end of `buf`,
 * and recursively deep-clones any nested `TagReflexive` fields inside each child element.
 */
export function deepCloneReflexiveAtOffset(
  buf: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  refHeaderAbsOffset: number,
  childStructName: string,
): Buffer {
  if (!isRangeInBuffer(refHeaderAbsOffset, 12, buf.length)) return buf;
  const count = buf.readUInt32LE(refHeaderAbsOffset);
  const oldPtr = buf.readUInt32LE(refHeaderAbsOffset + 4);
  if (count === 0 || oldPtr === 0) {
    buf.writeUInt32LE(0, refHeaderAbsOffset);
    buf.writeUInt32LE(0, refHeaderAbsOffset + 4);
    buf.writeUInt32LE(0, refHeaderAbsOffset + 8);
    return buf;
  }

  let childStruct;
  try {
    childStruct = resolveStruct(childStructName);
  } catch {
    return buf;
  }
  const elemSize = childStruct.totalSize;
  const totalBytes = count * elemSize;
  const oldArrayAt = resolvePointer(oldPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(oldArrayAt, totalBytes, buf.length)) return buf;

  const alignedStart = (buf.length + 3) & ~3;
  const pad = Buffer.alloc(alignedStart - buf.length, 0);
  const clonedSlice = Buffer.from(buf.subarray(oldArrayAt, oldArrayAt + totalBytes));
  const newPtr = (tagIndex.baseMemoryAddress + (alignedStart - header.tagDataOffset)) >>> 0;

  let out: Buffer = Buffer.concat([buf, pad, clonedSlice]);
  const delta = pad.length + clonedSlice.length;
  out.writeUInt32LE(newPtr, refHeaderAbsOffset + 4);
  out.writeUInt32LE(0, refHeaderAbsOffset + 8);
  out.writeUInt32LE(out.length >>> 0, 0x08);
  out.writeUInt32LE((header.tagDataSize + delta) >>> 0, 0x14);

  let curHeader = parseCacheFileHeader(out);
  let curTagIndex = parseTagIndex(out, curHeader);

  for (let i = 0; i < count; i++) {
    const elemAbs = alignedStart + i * elemSize;
    sanitizeStructDependencies(out, elemAbs, childStructName);
    out = deepCloneStructReflexives(out, curHeader, curTagIndex, elemAbs, childStructName);
    curHeader = parseCacheFileHeader(out);
    curTagIndex = parseTagIndex(out, curHeader);
  }

  return out;
}

/**
 * Deep-clones all `TagReflexive` fields inside the struct at `structAbsOffset` (`structName`)
 * into fresh 4-byte-aligned memory at the end of `buf` so no reflexive blocks overlap another tag.
 */
export function deepCloneStructReflexives(
  buf: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  structAbsOffset: number,
  structName: string,
): Buffer {
  let resolved;
  try {
    resolved = resolveStruct(structName);
  } catch {
    return buf;
  }

  let out = buf;
  let curHeader = header;
  let curTagIndex = tagIndex;

  for (const f of resolved.fields) {
    if (f.def.type !== 'TagReflexive' || !f.def.struct) continue;
    out = deepCloneReflexiveAtOffset(out, curHeader, curTagIndex, structAbsOffset + f.offset, f.def.struct);
    curHeader = parseCacheFileHeader(out);
    curTagIndex = parseTagIndex(out, curHeader);
  }

  return out;
}


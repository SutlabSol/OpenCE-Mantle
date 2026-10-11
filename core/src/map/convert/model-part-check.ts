import type { CacheFileHeader } from '../header';
import { resolveTagDataPointer, type TagIndex } from '../tag-index';
import { decodeStruct, resolvePointer, resolveStruct, type DecodedFieldValue } from '../definitions/engine';

/**
 * The model checks OpenCE runs when it loads a Custom Edition map, mirrored so the converter can
 * refuse a map OpenCE would stop on. Format reference only, no code copied: OpenCE (CC0,
 * github.com/OpenCommunityEdition/OpenCE, read at 6399ed9 = build 185):
 *   - `gbxmodel_part_check` (port/linux/game/cache_file_formats.c): each part's strip is a
 *     precompiled strip (type 1), its vertices uncompressed (type 4), at most 22 local nodes,
 *     strip triangle count >= 1, the strip (count + 2 indices) inside the index part of the model
 *     data and 2-aligned, 1 to 0xFFFF vertices inside the vertex part and 4-aligned. Refused as
 *     "bad model part" at load.
 *   - `custom_edition_models_convert` (port/linux/game/custom_edition_geometry.c): first
 *     `model_local_nodes_make` for every model of 44 (RASTERIZER_MAXIMUM_NODES_PER_MODEL) to 64 nodes
 *     whose parts have no local nodes (each part gets the nodes its vertices name, at most 22, else
 *     the model is left as it is); then per model `custom_edition_model_part_shaders_bound` (a part
 *     naming a shader past the model's gets its last one; nothing when the model has none) and
 *     `custom_edition_model_verify`: 1 to 64 nodes, and 44+ only with local nodes; then
 *     `custom_edition_model_part_verify` for every part: shader, centroid nodes, previous / next part
 *     in [-1, part count), local node rules, **each of the first `strip triangle count + 2` strip
 *     indices < the part's vertex count** (0xFFFF included: there is no restart value here), each
 *     vertex's two node indices inside [0, local node count or node count), and every normal,
 *     binormal and tangent component |x| <= 1.005 (NaN fails). OpenCE stops at the first failing
 *     part ("part P of geometry G of the model '...' names a node, vertex, shader or part that does
 *     not exist, ..."), then "game_load() failed." (fatal). This check reports every failing part.
 * Part layout (0x84) and vertex layout (0x44) are OpenCE's `custom_edition_model_part` and
 * `model_vertex_uncompressed`; the model's own blocks are found with the schema engine (offsets
 * equal OpenCE's `struct model`: flags 0x0, nodes 0xB8, geometries 0xD0, shaders 0xDC).
 * Measured: 0 problems on the 5 CE sample maps and HaloMD heh_2, crossing, barrier (all load in
 * OpenCE); theisland_3: model #2574, see PRD 2026-10-12. Decision on the model-level node count:
 * SOURCES.md "Converter: model part check".
 */

/** OpenCE `custom_edition_model_part` / cache_file_formats.c GBXMODEL_PART_* offsets. */
const PART = {
  shaderIndex: 0x04,
  previousPart: 0x06,
  nextPart: 0x07,
  centroidPrimaryNode: 0x08,
  centroidSecondaryNode: 0x0a,
  stripType: 0x44,
  stripTriangleCount: 0x48,
  stripOffset: 0x4c,
  vertexType: 0x54,
  vertexCount: 0x58,
  vertexOffset: 0x64,
  localNodeCount: 0x6b,
  localNodeIndices: 0x6c,
} as const;
/** OpenCE `model_vertex_uncompressed`: normal, binormal, tangent (3 floats each), two int16 nodes. */
const VERTEX_BYTES = 0x44;
const VERTEX_VECTORS = [0x0c, 0x18, 0x24] as const;
const VERTEX_NODES = 0x38;
const STRIP_INDEX_BYTES = 2;
const STRIP_TYPE_PRECOMPILED = 1;
const VERTEX_TYPE_UNCOMPRESSED = 4;
const MAXIMUM_LOCAL_NODES = 22;
const MAXIMUM_VERTICES_PER_BUFFER = 0xffff;
const MAXIMUM_NODES_PER_MODEL = 64;
const RASTERIZER_MAXIMUM_NODES_PER_MODEL = 44;
const PARTS_HAVE_LOCAL_NODES = 1 << 1;
const MAXIMUM_COMPRESSIBLE_COMPONENT = Math.fround(1.005);
/** Bad strip positions listed per part (the count is always given). */
const MAX_LISTED_INDICES = 40;

export interface BadStripIndex {
  position: number;
  value: number;
}

export interface ModelPartProblem {
  tagIndex: number;
  tagPath: string;
  /** Null for a model-level problem (node count). */
  geometryIndex: number | null;
  partIndex: number | null;
  vertexCount: number | null;
  /** Strip indices checked (strip triangle count + 2). */
  stripIndexCount: number | null;
  /** Every strip index >= the vertex count (position in the strip, value). */
  badStripIndices: BadStripIndex[];
  reasons: string[];
  /** One line for the dialog and the logs. */
  text: string;
}

export interface ModelPartReport {
  problems: ModelPartProblem[];
  modelsChecked: number;
  partsChecked: number;
}

interface PartView {
  geometryIndex: number;
  partIndex: number;
  partCount: number;
  /** File offset of the 0x84-byte part. */
  at: number;
  layoutOk: boolean;
  layoutReasons: string[];
  vertexCount: number;
  stripIndexCount: number;
  vertexAt: number;
  stripAt: number;
}

function blockOf(value: DecodedFieldValue | undefined): { count: number; pointer: number } {
  if (!value || value.kind !== 'reflexive') return { count: 0, pointer: 0 };
  return { count: value.value.count, pointer: value.value.pointerLow };
}

const signed8 = (b: Buffer, at: number) => b.readInt8(at);

export function checkModelParts(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ModelPartReport {
  const geometrySize = resolveStruct('GBXModelGeometry').totalSize;
  const base = tagIndex.baseMemoryAddress;
  const modelDataAt = tagIndex.modelDataFileOffset;
  const indexDataOffset = tagIndex.vertexSize;
  const indexDataBytes = tagIndex.modelDataSize - indexDataOffset;
  const problems: ModelPartProblem[] = [];
  let modelsChecked = 0;
  let partsChecked = 0;

  for (const entry of tagIndex.entries) {
    if (entry.isExternal || entry.primaryClassName !== 'gbxmodel') continue;
    modelsChecked++;
    const modelAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, base);
    const model = decodeStruct(buffer, modelAt, 'GBXModel');
    const flags = buffer.readUInt32LE(modelAt); // OpenCE struct model flags at 0x0
    const nodeCount = blockOf(model.get('nodes')).count;
    const shaderCount = blockOf(model.get('shaders')).count;
    const geometries = blockOf(model.get('geometries'));
    const label = `#${entry.index} ${entry.path}`;

    // Every part, with gbxmodel_part_check's layout rules (which also make the reads below safe).
    const parts: PartView[] = [];
    const geometriesAt = geometries.count > 0 ? resolvePointer(geometries.pointer, header.tagDataOffset, base) : 0;
    for (let g = 0; g < geometries.count; g++) {
      const geometry = decodeStruct(buffer, geometriesAt + g * geometrySize, 'GBXModelGeometry');
      const block = blockOf(geometry.get('parts'));
      const partsAt = block.count > 0 ? resolvePointer(block.pointer, header.tagDataOffset, base) : 0;
      for (let p = 0; p < block.count; p++) {
        const at = partsAt + p * 0x84;
        const triangleCount = buffer.readInt32LE(at + PART.stripTriangleCount);
        const stripOffset = buffer.readUInt32LE(at + PART.stripOffset);
        const vertexCount = buffer.readInt32LE(at + PART.vertexCount);
        const vertexOffset = buffer.readUInt32LE(at + PART.vertexOffset);
        const stripIndexCount = triangleCount + 2;
        const reasons: string[] = [];
        if (buffer.readInt16LE(at + PART.stripType) !== STRIP_TYPE_PRECOMPILED) reasons.push(`strip type ${buffer.readInt16LE(at + PART.stripType)} (only 1, precompiled strip, loads)`);
        if (buffer.readInt16LE(at + PART.vertexType) !== VERTEX_TYPE_UNCOMPRESSED) reasons.push(`vertex type ${buffer.readInt16LE(at + PART.vertexType)} (only 4, uncompressed, loads)`);
        if (buffer[at + PART.localNodeCount] > MAXIMUM_LOCAL_NODES) reasons.push(`${buffer[at + PART.localNodeCount]} local nodes (at most ${MAXIMUM_LOCAL_NODES})`);
        if (triangleCount < 1 || stripIndexCount * STRIP_INDEX_BYTES > indexDataBytes || stripOffset + stripIndexCount * STRIP_INDEX_BYTES > indexDataBytes) {
          reasons.push(`strip of ${triangleCount} triangles at index offset ${stripOffset} is not inside the model index data`);
        } else if ((indexDataOffset + stripOffset) % STRIP_INDEX_BYTES !== 0) reasons.push('strip is not 2-aligned');
        if (vertexCount < 1 || vertexCount > MAXIMUM_VERTICES_PER_BUFFER || vertexOffset + vertexCount * VERTEX_BYTES > indexDataOffset) {
          reasons.push(`${vertexCount} vertices at vertex offset ${vertexOffset} are not inside the model vertex data`);
        } else if (vertexOffset % 4 !== 0) reasons.push('vertices are not 4-aligned');
        parts.push({
          geometryIndex: g,
          partIndex: p,
          partCount: block.count,
          at,
          layoutOk: reasons.length === 0,
          layoutReasons: reasons,
          vertexCount,
          stripIndexCount,
          vertexAt: modelDataAt + vertexOffset,
          stripAt: modelDataAt + indexDataOffset + stripOffset,
        });
      }
    }
    partsChecked += parts.length;

    const partProblem = (part: PartView, reasons: string[], bad: BadStripIndex[]) => {
      const shown = bad.slice(0, MAX_LISTED_INDICES).map((b) => `${b.value}@${b.position}`).join(', ');
      const strip = bad.length > 0 ? [`${bad.length} of ${part.stripIndexCount} strip indices are past its ${part.vertexCount} vertices (value@position: ${shown}${bad.length > MAX_LISTED_INDICES ? ', ...' : ''})`] : [];
      problems.push({
        tagIndex: entry.index,
        tagPath: entry.path,
        geometryIndex: part.geometryIndex,
        partIndex: part.partIndex,
        vertexCount: part.vertexCount,
        stripIndexCount: part.stripIndexCount,
        badStripIndices: bad,
        reasons,
        text: `${label}: geometry ${part.geometryIndex} part ${part.partIndex}: ${[...reasons, ...strip].join('; ')}`,
      });
    };
    const modelProblem = (reason: string) => {
      problems.push({ tagIndex: entry.index, tagPath: entry.path, geometryIndex: null, partIndex: null, vertexCount: null, stripIndexCount: null, badStripIndices: [], reasons: [reason], text: `${label}: ${reason}` });
    };

    // Layout failures stop OpenCE at load, before the model checks; report them and go no further.
    const badLayout = parts.filter((p) => !p.layoutOk);
    if (badLayout.length > 0) {
      for (const part of badLayout) partProblem(part, part.layoutReasons, []);
      continue;
    }

    // model_local_nodes_make: a model of 44-64 nodes without local nodes gets them when every part's
    // vertices name valid nodes, at most 22 per part. Its vertices then name local nodes, all valid.
    let localNodes = (flags & PARTS_HAVE_LOCAL_NODES) !== 0;
    let localNodesMade = false;
    if (nodeCount >= RASTERIZER_MAXIMUM_NODES_PER_MODEL && !localNodes && nodeCount <= MAXIMUM_NODES_PER_MODEL) {
      localNodesMade = parts.every((part) => {
        const used = new Set<number>();
        for (let v = 0; v < part.vertexCount; v++) {
          for (const slot of [0, 1]) {
            const node = buffer.readInt16LE(part.vertexAt + v * VERTEX_BYTES + VERTEX_NODES + slot * 2);
            if (node < 0 || node >= nodeCount) return false;
            used.add(node);
            if (used.size > MAXIMUM_LOCAL_NODES) return false;
          }
        }
        return true;
      });
      localNodes = localNodesMade;
    }

    // custom_edition_model_verify: node count.
    if (nodeCount < 1 || nodeCount > MAXIMUM_NODES_PER_MODEL || (nodeCount >= RASTERIZER_MAXIMUM_NODES_PER_MODEL && !localNodes)) {
      modelProblem(`${nodeCount} nodes; OpenCE draws models of 1 to ${RASTERIZER_MAXIMUM_NODES_PER_MODEL - 1} nodes, or up to ${MAXIMUM_NODES_PER_MODEL} whose parts have (or can be given) at most ${MAXIMUM_LOCAL_NODES} local nodes each`);
      continue;
    }

    // custom_edition_model_part_verify, every part (OpenCE stops at the first).
    for (const part of parts) {
      const at = part.at;
      const reasons: string[] = [];
      // After custom_edition_model_part_shaders_bound only a model without shaders fails here.
      if (shaderCount < 1) reasons.push('the model has no shaders');
      const primary = buffer.readInt16LE(at + PART.centroidPrimaryNode);
      const secondary = buffer.readInt16LE(at + PART.centroidSecondaryNode);
      if (primary < 0 || primary >= nodeCount) reasons.push(`centroid primary node ${primary} (model has ${nodeCount})`);
      if (secondary < 0 || secondary >= nodeCount) reasons.push(`centroid secondary node ${secondary} (model has ${nodeCount})`);
      const previous = signed8(buffer, at + PART.previousPart);
      const next = signed8(buffer, at + PART.nextPart);
      if (previous < -1 || previous >= part.partCount) reasons.push(`previous part ${previous} (geometry has ${part.partCount})`);
      if (next < -1 || next >= part.partCount) reasons.push(`next part ${next} (geometry has ${part.partCount})`);

      // Local node table as the part holds it, or as model_local_nodes_make would write it.
      const localCount = buffer[at + PART.localNodeCount];
      let nodeLimit = nodeCount;
      if (localNodes && !localNodesMade) {
        nodeLimit = localCount;
        if (localCount === 0) reasons.push('the model has local nodes but this part has none');
        for (let n = 0; n < localCount; n++) {
          const node = buffer[at + PART.localNodeIndices + n];
          if (node >= nodeCount) reasons.push(`local node ${n} names node ${node} (model has ${nodeCount})`);
        }
      }

      const bad: BadStripIndex[] = [];
      for (let k = 0; k < part.stripIndexCount; k++) {
        const value = buffer.readUInt16LE(part.stripAt + k * STRIP_INDEX_BYTES);
        if (value >= part.vertexCount) bad.push({ position: k, value });
      }

      let badNodes = 0;
      let badVectors = 0;
      for (let v = 0; v < part.vertexCount; v++) {
        const vertexAt = part.vertexAt + v * VERTEX_BYTES;
        if (!localNodesMade) {
          const n0 = buffer.readInt16LE(vertexAt + VERTEX_NODES);
          const n1 = buffer.readInt16LE(vertexAt + VERTEX_NODES + 2);
          if (n0 < 0 || n0 >= nodeLimit || n1 < 0 || n1 >= nodeLimit) badNodes++;
        }
        let vectorOk = true;
        for (const vector of VERTEX_VECTORS) {
          for (let c = 0; c < 3; c++) {
            const x = buffer.readFloatLE(vertexAt + vector + c * 4);
            if (!(Math.abs(x) <= MAXIMUM_COMPRESSIBLE_COMPONENT)) vectorOk = false;
          }
        }
        if (!vectorOk) badVectors++;
      }
      if (badNodes > 0) reasons.push(`${badNodes} vertices name a node outside [0, ${nodeLimit})`);
      if (badVectors > 0) reasons.push(`${badVectors} vertices have a normal, binormal or tangent component past ${1.005} (or NaN)`);

      if (reasons.length > 0 || bad.length > 0) partProblem(part, reasons, bad);
    }
  }

  return { problems, modelsChecked, partsChecked };
}

/**
 * Stage 1 (capture only, NOT wired into tag-extractor.ts/tag-injector.ts - relocation stays off
 * in the app): recovers the real vertex + triangle index bytes for every `gbxmodel` geometry
 * part, which live in the separate "model data" region and are addressed by byte offsets
 * (vertexOffset/triangleOffset), not by the normal TagReflexive/TagDataOffset pointer
 * mechanisms everything else in this codebase uses. See PRD.md "gbxmodel geometry plan" for the
 * real-byte research this is built on.
 *
 * Vertex byte size is exact: vertexCount * {68 for uncompressed, 32 for compressed}, confirmed
 * with 0 mismatches across 1112 real parts (bloodgulch+coldsnap).
 *
 * Triangle byte size has NO closed-form formula (strip-join/restart count isn't stored) - it is
 * recovered from the NEIGHBOR GAP: sorting every part in the whole map by its absolute triangle
 * offset, a part's byte size is "next part's start minus mine" (or region end for the globally
 * last part). This requires scanning every gbxmodel in the WHOLE map, not just the tag being
 * captured - a read-only cost paid once at extraction time, never at injection time.
 *
 * The gap size is occasionally (confirmed in 37% of real parts) exactly 2 bytes larger than the
 * real index data, with a single trailing non-0xFFFF word that is always out of range (it never
 * appears anywhere else, including mid-buffer) - build-tool scratch-memory leftover, not real
 * geometry. It is trimmed. Index 0xFFFF is a legitimate primitive-restart sentinel wherever it
 * appears (not just trailing) and is never flagged as out-of-range.
 */
import { resolveStruct, decodeStruct, resolvePointer, type DecodedFieldValue } from './definitions/engine';
import { resolveTagDataPointer, type TagIndex } from './tag-index';
import type { CacheFileHeader } from './header';

const VERTEX_BYTES_BY_TYPE: Record<number, number> = { 4: 68, 5: 32 }; // 4=uncompressed, 5=compressed
const PRIMITIVE_RESTART_INDEX = 0xffff;

export interface GbxmodelPartBoundary {
  originalIndex: number;
  tagPath: string;
  geometryIndex: number;
  partIndex: number;
  vertexType: number;
  vertexCount: number;
  vertexAbsoluteOffset: number;
  vertexByteSize: number;
  triangleBufferType: number;
  triangleCount: number;
  triangleAbsoluteOffset: number;
  triangleByteSize: number;
  blockedReason?: string;
}

export interface CapturedGbxmodelPart {
  geometryIndex: number;
  partIndex: number;
  vertexType: number;
  vertexCount: number;
  vertexBytes: Buffer;
  triangleBufferType: number;
  triangleCount: number;
  triangleBytes: Buffer;
}

export type GbxmodelGeometryCapture = { blocked: false; parts: CapturedGbxmodelPart[] } | { blocked: true; reason: string };

function numeric(value: DecodedFieldValue | undefined): number | undefined {
  if (!value) return undefined;
  if (value.kind === 'basic' || value.kind === 'enum') return value.value as number;
  return undefined;
}

/**
 * Same-reader: walks every non-external `gbxmodel` tag in the WHOLE map (not just a selection),
 * decoding with the same `resolveStruct`/`decodeStruct`/`resolvePointer` primitives the rest of
 * this codebase uses - a shared blind spot in those primitives would not be caught by this.
 */
export function scanGbxmodelGeometryBoundaries(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex): GbxmodelPartBoundary[] {
  const geomSize = resolveStruct('GBXModelGeometry').totalSize;
  const partSize = resolveStruct('GBXModelGeometryPart').totalSize;
  const gbxEntries = tagIndex.entries.filter((e) => !e.isExternal && e.primaryClassName === 'gbxmodel');

  const raw: Omit<GbxmodelPartBoundary, 'triangleByteSize'>[] = [];
  for (const entry of gbxEntries) {
    const fileOffset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const decoded = decodeStruct(buffer, fileOffset, 'GBXModel');
    const geometries = decoded.get('geometries');
    if (!geometries || geometries.kind !== 'reflexive' || geometries.value.count === 0) continue;
    const geomBase = resolvePointer(geometries.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let g = 0; g < geometries.value.count; g++) {
      const geom = decodeStruct(buffer, geomBase + g * geomSize, 'GBXModelGeometry');
      const parts = geom.get('parts');
      if (!parts || parts.kind !== 'reflexive' || parts.value.count === 0) continue;
      const partsBase = resolvePointer(parts.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
      for (let p = 0; p < parts.value.count; p++) {
        const part = decodeStruct(buffer, partsBase + p * partSize, 'GBXModelGeometryPart');
        const vertexType = numeric(part.get('vertex type')) ?? -1;
        const vertexCount = numeric(part.get('vertex count')) ?? 0;
        const vertexOffset = numeric(part.get('vertex offset')) ?? 0;
        const triangleBufferType = numeric(part.get('triangle buffer type')) ?? -1;
        const triangleCount = numeric(part.get('triangle count')) ?? 0;
        const triangleOffset = numeric(part.get('triangle offset')) ?? 0;
        raw.push({
          originalIndex: entry.index,
          tagPath: entry.path,
          geometryIndex: g,
          partIndex: p,
          vertexType,
          vertexCount,
          vertexAbsoluteOffset: tagIndex.modelDataFileOffset + vertexOffset,
          vertexByteSize: vertexCount * (VERTEX_BYTES_BY_TYPE[vertexType] ?? 0),
          triangleBufferType,
          triangleCount,
          triangleAbsoluteOffset: tagIndex.modelDataFileOffset + tagIndex.vertexSize + triangleOffset,
        });
      }
    }
  }

  const sortedByTriangle = [...raw].sort((a, b) => a.triangleAbsoluteOffset - b.triangleAbsoluteOffset);
  const regionEnd = header.tagDataOffset;
  const result: GbxmodelPartBoundary[] = [];
  for (let i = 0; i < sortedByTriangle.length; i++) {
    const cur = sortedByTriangle[i];
    const next = i + 1 < sortedByTriangle.length ? sortedByTriangle[i + 1].triangleAbsoluteOffset : regionEnd;
    let gapIndexCount = (next - cur.triangleAbsoluteOffset) / 2;
    let blockedReason: string | undefined;

    if (!Number.isInteger(gapIndexCount) || gapIndexCount < 0) {
      blockedReason = `triangle gap is not a whole number of 2-byte indices (${next - cur.triangleAbsoluteOffset} bytes)`;
      gapIndexCount = 0;
    } else if (VERTEX_BYTES_BY_TYPE[cur.vertexType] === undefined) {
      blockedReason = `unrecognized vertex type ${cur.vertexType} (only 4=uncompressed/5=compressed are known)`;
    } else if (cur.vertexAbsoluteOffset < tagIndex.modelDataFileOffset || cur.vertexAbsoluteOffset + cur.vertexByteSize > header.tagDataOffset) {
      blockedReason = 'vertex data resolves outside the model data region';
    } else if (cur.triangleAbsoluteOffset < tagIndex.modelDataFileOffset || next > header.tagDataOffset) {
      blockedReason = 'triangle data resolves outside the model data region';
    } else {
      // Known build-tool artifact: at most ONE trailing non-restart out-of-range word, never more
      // than 1, confirmed across 1112 real parts (bloodgulch+coldsnap) - trim it if present.
      if (gapIndexCount > 0) {
        const lastIndexValue = buffer.readUInt16LE(cur.triangleAbsoluteOffset + (gapIndexCount - 1) * 2);
        if (lastIndexValue !== PRIMITIVE_RESTART_INDEX && lastIndexValue >= cur.vertexCount) gapIndexCount -= 1;
      }
      if (cur.triangleBufferType !== 1) {
        // Every real part checked (1112 across bloodgulch+coldsnap) is "triangle strip" (1).
        // "triangle list" (0) has zero real samples to derive/verify a minimum-size formula
        // against - block rather than guess.
        blockedReason = `triangle buffer type ${cur.triangleBufferType} ("triangle strip" is the only type verified against real data") has no verified minimum-size formula`;
      } else if (gapIndexCount < cur.triangleCount + 2) {
        blockedReason = `triangle region (${gapIndexCount} indices after trim) is smaller than the structural minimum for ${cur.triangleCount} triangles (${cur.triangleCount + 2})`;
      } else {
        for (let k = 0; k < gapIndexCount; k++) {
          const v = buffer.readUInt16LE(cur.triangleAbsoluteOffset + k * 2);
          if (v !== PRIMITIVE_RESTART_INDEX && v >= cur.vertexCount) {
            blockedReason = `index value ${v} at position ${k} is >= this part's own vertex count (${cur.vertexCount}) and is not the primitive-restart sentinel`;
            break;
          }
        }
      }
    }

    result.push({ ...cur, triangleByteSize: gapIndexCount * 2, blockedReason });
  }
  return result;
}

/**
 * Captures every geometry part of ONE gbxmodel tag using a previously computed whole-map
 * boundary scan. Any single part failing validation BLOCKS THE WHOLE TAG - never a partial or
 * silently-dropped capture (same contract as bitmap/sound embedded capture and the Issue 1
 * TagDataOffset fix).
 */
export function captureGbxmodelGeometry(buffer: Buffer, originalIndex: number, boundaries: GbxmodelPartBoundary[]): GbxmodelGeometryCapture {
  const mine = boundaries.filter((b) => b.originalIndex === originalIndex).sort((a, b) => a.geometryIndex - b.geometryIndex || a.partIndex - b.partIndex);
  const blocked = mine.find((b) => b.blockedReason);
  if (blocked) return { blocked: true, reason: `geometry[${blocked.geometryIndex}].part[${blocked.partIndex}]: ${blocked.blockedReason}` };

  const parts: CapturedGbxmodelPart[] = mine.map((b) => ({
    geometryIndex: b.geometryIndex,
    partIndex: b.partIndex,
    vertexType: b.vertexType,
    vertexCount: b.vertexCount,
    vertexBytes: Buffer.from(buffer.subarray(b.vertexAbsoluteOffset, b.vertexAbsoluteOffset + b.vertexByteSize)),
    triangleBufferType: b.triangleBufferType,
    triangleCount: b.triangleCount,
    triangleBytes: Buffer.from(buffer.subarray(b.triangleAbsoluteOffset, b.triangleAbsoluteOffset + b.triangleByteSize)),
  }));
  return { blocked: false, parts };
}

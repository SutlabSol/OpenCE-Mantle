import { describe, expect, it } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { resolveStruct, decodeStruct, resolvePointer } from '../src/map/definitions/engine';
import { resolveTagDataPointer } from '../src/map/tag-index';
import { scanGbxmodelGeometryBoundaries, captureGbxmodelGeometry } from '../src/map/gbxmodel-geometry';
import { hasSampleMap, readSampleMap } from './helpers/sample-maps';

/**
 * Design-verification only (same-reader, test-file-local simulation) for Stage 2 of the
 * gbxmodel geometry plan (PRD.md). NONE of this is wired into tag-injector.ts - relocation stays
 * off in the app, Stage 2 has not started.
 */

describe.skipIf(!hasSampleMap('coldsnap.map'))('same-reader: no-patch claim, ALL 665 coldsnap.map parts (not a 40-part sample)', () => {
  it('every existing part\'s triangleOffset resolves to identical bytes after inserting bytes at the vertex/triangle boundary, with zero patches', () => {
    const buffer = readSampleMap('coldsnap.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('coldsnap.map did not parse');
    const { header, tagIndex } = inspected;

    const partSize = resolveStruct('GBXModelGeometryPart').totalSize;
    const geomSize = resolveStruct('GBXModelGeometry').totalSize;
    const gbxEntries = tagIndex.entries.filter((e) => !e.isExternal && e.primaryClassName === 'gbxmodel');
    interface P { originalIndex: number; partStructAbs: number; triangleOffsetOld: number; triangleCount: number; }
    const parts: P[] = [];
    for (const e of gbxEntries) {
      const fileOffset = resolveTagDataPointer(e.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
      const decoded = decodeStruct(buffer, fileOffset, 'GBXModel');
      const geometries = decoded.get('geometries');
      if (!geometries || geometries.kind !== 'reflexive') continue;
      const geomBase = resolvePointer(geometries.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
      for (let g = 0; g < geometries.value.count; g++) {
        const geom = decodeStruct(buffer, geomBase + g * geomSize, 'GBXModelGeometry');
        const partsField = geom.get('parts');
        if (!partsField || partsField.kind !== 'reflexive') continue;
        const partsBase = resolvePointer(partsField.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
        for (let p = 0; p < partsField.value.count; p++) {
          const partAbs = partsBase + p * partSize;
          const part = decodeStruct(buffer, partAbs, 'GBXModelGeometryPart');
          const triOff = (part.get('triangle offset') as { kind: string; value: number }).value;
          const triCount = (part.get('triangle count') as { kind: string; value: number }).value;
          parts.push({ originalIndex: e.index, partStructAbs: partAbs, triangleOffsetOld: triOff, triangleCount: triCount });
        }
      }
    }
    expect(parts.length).toBe(665); // real count for this map, confirmed by the Stage 1 sweep - not asserted blind

    const A = tagIndex.modelDataFileOffset + tagIndex.vertexSize; // insertion point: end of vertex region
    const N = 4096;
    const padding = Buffer.alloc(N, 0xab);
    const newBuffer = Buffer.concat([buffer.subarray(0, A), padding, buffer.subarray(A)]);
    const newVertexSize = tagIndex.vertexSize + N;

    let mismatches = 0;
    for (const p of parts) {
      const newPartStructAbs = p.partStructAbs + N; // the part struct itself lives in tag data, after the insertion point
      const partAtNewLoc = decodeStruct(newBuffer, newPartStructAbs, 'GBXModelGeometryPart');
      const triOffInNewBuffer = (partAtNewLoc.get('triangle offset') as { kind: string; value: number }).value; // read, never written
      if (triOffInNewBuffer !== p.triangleOffsetOld) { mismatches++; continue; }
      const oldAbs = tagIndex.modelDataFileOffset + tagIndex.vertexSize + p.triangleOffsetOld;
      const newAbs = tagIndex.modelDataFileOffset + newVertexSize + triOffInNewBuffer; // modelDataFileOffset itself is unchanged - insertion is strictly after it
      const len = Math.min(p.triangleCount * 2, 64);
      if (!buffer.subarray(oldAbs, oldAbs + len).equals(newBuffer.subarray(newAbs, newAbs + len))) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe.skipIf(!hasSampleMap('coldsnap.map'))('same-reader: combined embedded+vertex+triangle insertion design (test-file-local simulation, NOT wired into tag-injector.ts)', () => {
  it('one injection combining all 3 insertion kinds: header/sub-header fields match the field table, new part resolves correctly, and every pre-existing part still resolves (independent region-boundary check)', () => {
    const buffer = readSampleMap('coldsnap.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('coldsnap.map did not parse');
    const { header, tagIndex } = inspected;

    // Real payloads (not synthetic filler for V/T): reuse the warthog's own captured vertex +
    // triangle bytes (Stage 1 capture, already proven byte-identical) as the "new part" being
    // injected. E (embedded) payload is a plain recognizable buffer - embedded bitmap/sound
    // byte-level semantics are already covered by embedded-relocation.test.ts; this test's only
    // job is the 3-insertion-points-together arithmetic.
    const boundaries = scanGbxmodelGeometryBoundaries(buffer, header, tagIndex);
    const warthog = tagIndex.entries.find((e) => e.path === 'vehicles\\coldsnap_hogs\\warthog' && e.primaryClassName === 'gbxmodel')!;
    const capture = captureGbxmodelGeometry(buffer, warthog.index, boundaries);
    expect(capture.blocked).toBe(false);
    if (capture.blocked) return;
    const newPartSource = capture.parts.find((p) => p.geometryIndex === 0 && p.partIndex === 0)!;

    const E = 2048;
    const embeddedPayload = Buffer.alloc(E, 0xee);
    const V = newPartSource.vertexBytes.length;
    const T = newPartSource.triangleBytes.length;

    const oldModelDataFileOffset = tagIndex.modelDataFileOffset;
    const oldVertexSize = tagIndex.vertexSize;
    const oldModelDataSize = tagIndex.modelDataSize;
    const oldTagDataOffset = header.tagDataOffset;
    const oldDecompressedFileSize = header.decompressedFileSize;

    // Field table (order of insertion: embedded before modelDataFileOffset, vertex at the
    // vertex/triangle boundary, triangle at the end of the triangle region = old tagDataOffset).
    const newModelDataFileOffset = oldModelDataFileOffset + E;
    const newVertexSize = oldVertexSize + V;
    const newModelDataSize = oldModelDataSize + V + T;
    const newTagDataOffset = oldTagDataOffset + E + V + T;
    const newDecompressedFileSize = oldDecompressedFileSize + E + V + T; // no tag-struct append (S=0) in this focused test

    expect(newTagDataOffset).toBe(newModelDataFileOffset + newModelDataSize); // region bookkeeping is internally consistent

    // Physically build the new buffer: insert at the 3 points in descending-offset order so
    // earlier splices don't invalidate later absolute positions.
    const triangleInsertAt = oldTagDataOffset; // end of triangle region = old tag data start
    const vertexInsertAt = oldModelDataFileOffset + oldVertexSize; // end of vertex region
    const embeddedInsertAt = oldModelDataFileOffset;
    let b = Buffer.concat([buffer.subarray(0, triangleInsertAt), newPartSource.triangleBytes, buffer.subarray(triangleInsertAt)]);
    b = Buffer.concat([b.subarray(0, vertexInsertAt), newPartSource.vertexBytes, b.subarray(vertexInsertAt)]);
    b = Buffer.concat([b.subarray(0, embeddedInsertAt), embeddedPayload, b.subarray(embeddedInsertAt)]);
    expect(b.length).toBe(buffer.length + E + V + T);

    // New part's own fields (not patched into any real tag here - just the arithmetic the real
    // injector would need to write into the new part's struct).
    const newPartVertexOffset = oldVertexSize;
    const newPartTriangleOffset = oldModelDataSize - oldVertexSize; // old triangle-section size
    expect(b.subarray(newModelDataFileOffset + newPartVertexOffset, newModelDataFileOffset + newPartVertexOffset + V).equals(newPartSource.vertexBytes)).toBe(true);
    expect(b.subarray(newModelDataFileOffset + newVertexSize + newPartTriangleOffset, newModelDataFileOffset + newVertexSize + newPartTriangleOffset + T).equals(newPartSource.triangleBytes)).toBe(true);

    // Independent region-boundary check: re-scan EVERY pre-existing part (not just the sample
    // above) against the NEW buffer/fields and confirm each one's vertex+triangle bytes are
    // still byte-identical to the ORIGINAL, with zero patches - the whole point of this plan.
    const gbxEntries = tagIndex.entries.filter((e) => !e.isExternal && e.primaryClassName === 'gbxmodel');
    const partSize = resolveStruct('GBXModelGeometryPart').totalSize;
    const geomSize = resolveStruct('GBXModelGeometry').totalSize;
    let checkedParts = 0;
    let outOfRegion = 0;
    let byteMismatches = 0;
    for (const e of gbxEntries) {
      // All 3 insertions (embedded before modelDataFileOffset, vertex at the vertex/triangle
      // boundary, triangle at old tagDataOffset) land strictly before tag data - it shifts by
      // the full E+V+T.
      const trueFileOffset = resolveTagDataPointer(e.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress) + E + V + T;
      const decoded = decodeStruct(b, trueFileOffset, 'GBXModel');
      const geometries = decoded.get('geometries');
      if (!geometries || geometries.kind !== 'reflexive') continue;
      const geomBase = resolvePointer(geometries.value.pointerLow, newTagDataOffset, tagIndex.baseMemoryAddress);
      for (let g = 0; g < geometries.value.count; g++) {
        const geom = decodeStruct(b, geomBase + g * geomSize, 'GBXModelGeometry');
        const partsField = geom.get('parts');
        if (!partsField || partsField.kind !== 'reflexive') continue;
        const partsBase = resolvePointer(partsField.value.pointerLow, newTagDataOffset, tagIndex.baseMemoryAddress);
        for (let p = 0; p < partsField.value.count; p++) {
          const part = decodeStruct(b, partsBase + p * partSize, 'GBXModelGeometryPart');
          const vType = (part.get('vertex type') as { kind: string; value: number }).value;
          const vCount = (part.get('vertex count') as { kind: string; value: number }).value;
          const vOff = (part.get('vertex offset') as { kind: string; value: number }).value;
          const triOff = (part.get('triangle offset') as { kind: string; value: number }).value;
          const triCount = (part.get('triangle count') as { kind: string; value: number }).value;
          const bytesPerVertex = vType === 4 ? 68 : vType === 5 ? 32 : 0;
          checkedParts++;
          const newVertexAbs = newModelDataFileOffset + vOff;
          const newTriangleAbs = newModelDataFileOffset + newVertexSize + triOff;
          if (newVertexAbs < newModelDataFileOffset || newVertexAbs + vCount * bytesPerVertex > newTagDataOffset) { outOfRegion++; continue; }
          if (newTriangleAbs < newModelDataFileOffset || newTriangleAbs > newTagDataOffset) { outOfRegion++; continue; }
          const oldVertexAbs = oldModelDataFileOffset + vOff;
          const oldTriangleAbs = oldModelDataFileOffset + oldVertexSize + triOff;
          if (!buffer.subarray(oldVertexAbs, oldVertexAbs + vCount * bytesPerVertex).equals(b.subarray(newVertexAbs, newVertexAbs + vCount * bytesPerVertex))) byteMismatches++;
          const triLen = Math.min(triCount * 2, 64);
          if (!buffer.subarray(oldTriangleAbs, oldTriangleAbs + triLen).equals(b.subarray(newTriangleAbs, newTriangleAbs + triLen))) byteMismatches++;
        }
      }
    }
    expect(checkedParts).toBe(665);
    expect(outOfRegion).toBe(0);
    expect(byteMismatches).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { scanGbxmodelGeometryBoundaries, captureGbxmodelGeometry } from '../src/map/gbxmodel-geometry';
import { resolveStruct, decodeStruct, resolvePointer } from '../src/map/definitions/engine';
import { resolveTagDataPointer } from '../src/map/tag-index';
import { hasSampleMaps, readSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';

/**
 * Stage 1 of the gbxmodel geometry plan (PRD.md): CAPTURE ONLY. `gbxmodel-geometry.ts` is NOT
 * wired into `tag-extractor.ts`/`tag-injector.ts` - any tag whose closure includes a `gbxmodel`
 * is still unconditionally blocked by `dependency-walker.ts`'s existing `uncapturedData` warning.
 * Relocation stays off in the app. All tests here are same-reader (re-parse with our own
 * decodeStruct/resolveStruct/resolvePointer primitives - this proves internal consistency with
 * our own reader, not that the real Halo CE/OpenCE engine would accept the result).
 */

const SWEEP_MAPS = ['bloodgulch.map', 'coldsnap.map'];

describe('same-reader: gbxmodel geometry capture sweep (Stage 1)', () => {
  for (const mapName of SWEEP_MAPS) {
    const have = hasSampleMaps([mapName]);
    const title = have ? `${mapName}: every gbxmodel tag is captured or blocked, never dropped` : `${mapName}: SKIPPED - ${missingSampleMapsMessage([mapName])}`;
    it.skipIf(!have)(title, () => {
      const buffer = readSampleMap(mapName);
      const inspected = inspectCustomEditionMap(buffer);
      if (inspected.status !== 'ok') throw new Error(`${mapName} did not parse`);
      const { header, tagIndex } = inspected;
      const boundaries = scanGbxmodelGeometryBoundaries(buffer, header, tagIndex);
      const gbxEntries = tagIndex.entries.filter((e) => !e.isExternal && e.primaryClassName === 'gbxmodel');

      let captured = 0;
      let blocked = 0;
      for (const e of gbxEntries) {
        const result = captureGbxmodelGeometry(buffer, e.index, boundaries);
        if (result.blocked) blocked++;
        else captured++;
      }
      // eslint-disable-next-line no-console
      console.log(`${mapName}: gbxmodel tags=${gbxEntries.length} parts=${boundaries.length} captured=${captured} blocked=${blocked} dropped=0 (not a real outcome - every tag is captured or blocked)`);
      expect(captured + blocked).toBe(gbxEntries.length); // every tag accounted for, none silently skipped
      expect(blocked).toBe(0); // real finding for these 2 samples - all real parts are triangle-strip and validate cleanly
    });
  }
});

describe.skipIf(!hasSampleMaps(['coldsnap.map']))('same-reader: gbxmodel geometry byte-identical capture + index validation (coldsnap.map)', () => {
  const buffer = readSampleMap('coldsnap.map');
  const inspected = inspectCustomEditionMap(buffer);
  if (inspected.status !== 'ok') throw new Error('coldsnap.map did not parse');
  const { header, tagIndex } = inspected;
  const boundaries = scanGbxmodelGeometryBoundaries(buffer, header, tagIndex);
  const warthog = tagIndex.entries.find((e) => e.path === 'vehicles\\coldsnap_hogs\\warthog' && e.primaryClassName === 'gbxmodel')!;

  it('captured vertex and triangle bytes are byte-identical to the source map slice', () => {
    const result = captureGbxmodelGeometry(buffer, warthog.index, boundaries);
    expect(result.blocked).toBe(false);
    if (result.blocked) return;
    expect(result.parts.length).toBeGreaterThan(0);
    const b0 = boundaries.find((b) => b.originalIndex === warthog.index && b.geometryIndex === 0 && b.partIndex === 0)!;
    const p0 = result.parts.find((p) => p.geometryIndex === 0 && p.partIndex === 0)!;
    expect(p0.vertexBytes.equals(buffer.subarray(b0.vertexAbsoluteOffset, b0.vertexAbsoluteOffset + b0.vertexByteSize))).toBe(true);
    expect(p0.triangleBytes.equals(buffer.subarray(b0.triangleAbsoluteOffset, b0.triangleAbsoluteOffset + b0.triangleByteSize))).toBe(true);
    expect(p0.vertexCount).toBe(205);
    expect(p0.triangleCount).toBe(329);
  });

  it('every captured triangle index is either the 0xFFFF restart sentinel or < that part\'s own vertex count', () => {
    const gbxEntries = tagIndex.entries.filter((e) => !e.isExternal && e.primaryClassName === 'gbxmodel');
    let totalIndices = 0;
    for (const e of gbxEntries) {
      const result = captureGbxmodelGeometry(buffer, e.index, boundaries);
      if (result.blocked) continue;
      for (const part of result.parts) {
        for (let k = 0; k < part.triangleBytes.length / 2; k++) {
          const v = part.triangleBytes.readUInt16LE(k * 2);
          totalIndices++;
          expect(v === 0xffff || v < part.vertexCount).toBe(true);
        }
      }
    }
    expect(totalIndices).toBeGreaterThan(300000); // sanity: real data was actually checked, not an empty loop
  });

  it('negative test: a non-restart index >= vertex count in the MIDDLE of the buffer blocks the whole tag (never a silent partial capture)', () => {
    const b0 = boundaries.find((b) => b.originalIndex === warthog.index && b.geometryIndex === 0 && b.partIndex === 0)!;
    const corrupted = Buffer.from(buffer);
    corrupted.writeUInt16LE(60000, b0.triangleAbsoluteOffset + 4); // position 2, well before the trailing trim zone
    const corruptedBoundaries = scanGbxmodelGeometryBoundaries(corrupted, header, tagIndex);
    const result = captureGbxmodelGeometry(corrupted, warthog.index, corruptedBoundaries);
    expect(result.blocked).toBe(true);
    if (!result.blocked) return;
    expect(result.reason).toContain('is not the primitive-restart sentinel');
  });

  it('negative test: truncation/corruption that shrinks the available triangle bytes below the structural minimum blocks that tag (never a partial capture)', () => {
    // Corrupt the stored "triangle count" field itself to a value the real neighbor-gap cannot
    // possibly satisfy - a direct, deterministic way to simulate "this part's triangle data was
    // truncated/corrupted" without needing to resize the whole file.
    const triangleCountFieldOffset = resolveStruct('GBXModelGeometryPart').fields.find((f) => f.name === 'triangle count')!.offset;
    const fileOffset = resolveTagDataPointer(warthog.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const decoded = decodeStruct(buffer, fileOffset, 'GBXModel');
    const geometries = decoded.get('geometries');
    if (!geometries || geometries.kind !== 'reflexive') throw new Error('fixture: warthog has no geometries');
    const geomBase = resolvePointer(geometries.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    const geom0 = decodeStruct(buffer, geomBase, 'GBXModelGeometry');
    const parts = geom0.get('parts');
    if (!parts || parts.kind !== 'reflexive') throw new Error('fixture: warthog geometry[0] has no parts');
    const partsBase = resolvePointer(parts.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);

    const corrupted = Buffer.from(buffer);
    corrupted.writeUInt32LE(50000, partsBase + triangleCountFieldOffset); // part[0]'s own "triangle count"
    const corruptedBoundaries = scanGbxmodelGeometryBoundaries(corrupted, header, tagIndex);
    const result = captureGbxmodelGeometry(corrupted, warthog.index, corruptedBoundaries);
    expect(result.blocked).toBe(true);
    if (!result.blocked) return;
    expect(result.reason).toContain('smaller than the structural minimum');
  });
});

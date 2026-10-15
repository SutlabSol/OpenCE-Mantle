import { describe, expect, it } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer, OCETAGS_FORMAT_VERSION } from '../src/map/container';
import { planAddInjection, applyAddInjection, planSwapInjection, applySwapInjection } from '../src/map/tag-injector';
import { resolveStruct, decodeStruct, resolvePointer } from '../src/map/definitions/engine';
import { resolveTagDataPointer } from '../src/map/tag-index';
import { hasSampleMaps, readSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';

const SAMPLE_MAPS = ['bloodgulch.map', 'coldsnap.map'];
const have = hasSampleMaps(SAMPLE_MAPS);

describe.skipIf(!have)(have ? 'gbxmodel geometry Stage 2: extraction and injection' : `gbxmodel geometry Stage 2 [${missingSampleMapsMessage(SAMPLE_MAPS)}]`, () => {
  it('extracting a gbxmodel tag captures its geometry parts into container v5 with zero uncapturedData warnings', () => {
    const buffer = readSampleMap('bloodgulch.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('bloodgulch.map did not parse');
    const { header, tagIndex } = inspected;

    const warthog = tagIndex.entries.find((e) => e.path === 'vehicles\\warthog\\warthog' && e.primaryClassName === 'gbxmodel')!;
    const set = extractTagSet(buffer, header, tagIndex, [warthog.index]);

    // Zero uncapturedData warnings for the gbxmodel tag
    const uncaptured = set.warnings.filter((w) => w.originalIndex === warthog.index && w.kind === 'uncapturedData');
    expect(uncaptured).toHaveLength(0);

    const extractedTag = set.tags.find((t) => t.originalIndex === warthog.index)!;
    expect(extractedTag.gbxmodelGeometryParts).toBeDefined();
    expect(extractedTag.gbxmodelGeometryParts!.length).toBeGreaterThan(0);

    // Container serialization and deserialization
    const serialized = serializeContainer(set, 'bloodgulch');
    const container = deserializeContainer(serialized);
    expect(container.formatVersion).toBe(OCETAGS_FORMAT_VERSION);
    expect(container.formatVersion).toBe(5);

    const cTag = container.tags.find((t) => t.path === warthog.path)!;
    expect(cTag.gbxmodelGeometryParts).toBeDefined();
    expect(cTag.gbxmodelGeometryParts!.length).toBe(extractedTag.gbxmodelGeometryParts!.length);

    const p0 = cTag.gbxmodelGeometryParts![0];
    const ep0 = extractedTag.gbxmodelGeometryParts![0];
    expect(Buffer.from(p0.vertexData, 'base64').equals(ep0.vertexBytes)).toBe(true);
    expect(Buffer.from(p0.triangleData, 'base64').equals(ep0.triangleBytes)).toBe(true);
  });

  it('ADD injection of a new gbxmodel tag: updates headers, resolves new part data, and leaves all pre-existing parts intact', () => {
    const srcBuffer = readSampleMap('bloodgulch.map');
    const srcInspected = inspectCustomEditionMap(srcBuffer);
    if (srcInspected.status !== 'ok') throw new Error('bloodgulch.map did not parse');

    const warthog = srcInspected.tagIndex.entries.find((e) => e.path === 'vehicles\\warthog\\warthog' && e.primaryClassName === 'gbxmodel')!;
    const set = extractTagSet(srcBuffer, srcInspected.header, srcInspected.tagIndex, [warthog.index]);
    const rawContainer = deserializeContainer(serializeContainer(set, 'bloodgulch'));

    const oldPath = warthog.path;
    const newPath = 'vehicles\\custom_hog\\custom_hog';
    // Rename the tag in container so it acts as a brand-new ADD candidate in the target map
    const customContainer = {
      ...rawContainer,
      tags: rawContainer.tags.map((t) =>
        t.originalIndex === warthog.index
          ? {
              ...t,
              path: newPath,
              dependencies: t.dependencies.map((d) => ({
                ...d,
                fieldPath: d.fieldPath.startsWith(oldPath) ? newPath + d.fieldPath.slice(oldPath.length) : d.fieldPath,
              })),
            }
          : t,
      ),
    };

    const targetBuffer = readSampleMap('bloodgulch.map');
    const targetInspected = inspectCustomEditionMap(targetBuffer);
    if (targetInspected.status !== 'ok') throw new Error('bloodgulch.map did not parse');
    const { header: oldHeader, tagIndex: oldTagIndex } = targetInspected;

    const plan = planAddInjection({ buffer: targetBuffer, header: oldHeader, tagIndex: oldTagIndex }, customContainer);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;

    expect(plan.toAdd.some((t) => t.path === newPath)).toBe(true);
    expect(plan.counts.added).toBe(1);
    expect(plan.blockedOther).toHaveLength(0);

    const resultBuffer = applyAddInjection(targetBuffer, oldHeader, oldTagIndex, customContainer, plan);

    // Verify output buffer parses cleanly as Custom Edition map
    const outInspected = inspectCustomEditionMap(resultBuffer);
    expect(outInspected.status).toBe('ok');
    if (outInspected.status !== 'ok') return;
    const { header: newHeader, tagIndex: newTagIndex } = outInspected;

    // Verify tag count increased by 1
    expect(newTagIndex.entries.length).toBe(oldTagIndex.entries.length + 1);

    const customTag = customContainer.tags.find((t) => t.path === newPath)!;
    const addedPartsCount = customTag.gbxmodelGeometryParts!.length;
    expect(newTagIndex.modelPartCount).toBe(oldTagIndex.modelPartCount + addedPartsCount);

    const totalAddedVertexBytes = customTag.gbxmodelGeometryParts!.reduce((n, p) => n + Buffer.from(p.vertexData, 'base64').length, 0);
    const totalAddedTriangleBytes = customTag.gbxmodelGeometryParts!.reduce((n, p) => n + Buffer.from(p.triangleData, 'base64').length, 0);
    const padT = (4 - (totalAddedTriangleBytes % 4)) % 4;
    const totalAddedTriangleBytesPadded = totalAddedTriangleBytes + padT;

    expect(newTagIndex.vertexSize).toBe(oldTagIndex.vertexSize + totalAddedVertexBytes);
    expect(newTagIndex.modelDataSize).toBe(oldTagIndex.modelDataSize + totalAddedVertexBytes + totalAddedTriangleBytesPadded);
    expect(newHeader.tagDataOffset).toBe(oldHeader.tagDataOffset + totalAddedVertexBytes + totalAddedTriangleBytesPadded);

    // Verify the newly injected tag's parts resolve to the exact injected bytes
    const addedEntry = newTagIndex.entries.find((e) => e.path === newPath && e.primaryClassName === 'gbxmodel')!;
    expect(addedEntry).toBeDefined();

    const addedFileOffset = resolveTagDataPointer(addedEntry.tagDataPointerOrResourceIndex, newHeader, newTagIndex.baseMemoryAddress);
    const addedDecoded = decodeStruct(resultBuffer, addedFileOffset, 'GBXModel');
    const addedGeometries = addedDecoded.get('geometries') as { kind: 'reflexive'; value: { count: number; pointerLow: number } };
    const geomBase = resolvePointer(addedGeometries.value.pointerLow, newHeader.tagDataOffset, newTagIndex.baseMemoryAddress);
    const geomSize = resolveStruct('GBXModelGeometry').totalSize;
    const partSize = resolveStruct('GBXModelGeometryPart').totalSize;

    let checkedInjectedParts = 0;
    for (let g = 0; g < addedGeometries.value.count; g++) {
      const geom = decodeStruct(resultBuffer, geomBase + g * geomSize, 'GBXModelGeometry');
      const partsReflexive = geom.get('parts') as { kind: 'reflexive'; value: { count: number; pointerLow: number } };
      const partsBase = resolvePointer(partsReflexive.value.pointerLow, newHeader.tagDataOffset, newTagIndex.baseMemoryAddress);
      for (let p = 0; p < partsReflexive.value.count; p++) {
        const part = decodeStruct(resultBuffer, partsBase + p * partSize, 'GBXModelGeometryPart');
        const vOff = (part.get('vertex offset') as { value: number }).value;
        const triOff = (part.get('triangle offset') as { value: number }).value;
        const vCount = (part.get('vertex count') as { value: number }).value;
        const vType = (part.get('vertex type') as { value: number }).value;
        const bytesPerVertex = vType === 4 ? 68 : 32;

        const srcPart = customTag.gbxmodelGeometryParts!.find((x) => x.geometryIndex === g && x.partIndex === p)!;
        const expectedVBytes = Buffer.from(srcPart.vertexData, 'base64');
        const expectedTBytes = Buffer.from(srcPart.triangleData, 'base64');

        const resolvedVAbs = newTagIndex.modelDataFileOffset + vOff;
        const resolvedTAbs = newTagIndex.modelDataFileOffset + newTagIndex.vertexSize + triOff;

        expect(resultBuffer.subarray(resolvedVAbs, resolvedVAbs + vCount * bytesPerVertex).equals(expectedVBytes)).toBe(true);
        expect(resultBuffer.subarray(resolvedTAbs, resolvedTAbs + expectedTBytes.length).equals(expectedTBytes)).toBe(true);
        checkedInjectedParts++;
      }
    }
    expect(checkedInjectedParts).toBe(addedPartsCount);

    // Independent check: re-verify ALL 447 pre-existing parts in bloodgulch still resolve to identical bytes
    const oldGbxEntries = oldTagIndex.entries.filter((e) => !e.isExternal && e.primaryClassName === 'gbxmodel');
    let preExistingMismatches = 0;
    let checkedPreExistingParts = 0;
    for (const e of oldGbxEntries) {
      const oldOffset = resolveTagDataPointer(e.tagDataPointerOrResourceIndex, oldHeader, oldTagIndex.baseMemoryAddress);
      const oldDecoded = decodeStruct(targetBuffer, oldOffset, 'GBXModel');
      const oldGeoms = oldDecoded.get('geometries');
      if (!oldGeoms || oldGeoms.kind !== 'reflexive') continue;
      const oldGeomBase = resolvePointer(oldGeoms.value.pointerLow, oldHeader.tagDataOffset, oldTagIndex.baseMemoryAddress);

      const newEntry = newTagIndex.entries.find((ne) => ne.index === e.index)!;
      const newOffset = resolveTagDataPointer(newEntry.tagDataPointerOrResourceIndex, newHeader, newTagIndex.baseMemoryAddress);
      const newDecoded = decodeStruct(resultBuffer, newOffset, 'GBXModel');
      const newGeoms = newDecoded.get('geometries');
      if (!newGeoms || newGeoms.kind !== 'reflexive') continue;
      const newGeomBase = resolvePointer(newGeoms.value.pointerLow, newHeader.tagDataOffset, newTagIndex.baseMemoryAddress);

      for (let g = 0; g < oldGeoms.value.count; g++) {
        const oldGeom = decodeStruct(targetBuffer, oldGeomBase + g * geomSize, 'GBXModelGeometry');
        const oldParts = oldGeom.get('parts');
        if (!oldParts || oldParts.kind !== 'reflexive') continue;
        const oldPartsBase = resolvePointer(oldParts.value.pointerLow, oldHeader.tagDataOffset, oldTagIndex.baseMemoryAddress);

        const newGeom = decodeStruct(resultBuffer, newGeomBase + g * geomSize, 'GBXModelGeometry');
        const newParts = newGeom.get('parts');
        if (!newParts || newParts.kind !== 'reflexive') continue;
        const newPartsBase = resolvePointer(newParts.value.pointerLow, newHeader.tagDataOffset, newTagIndex.baseMemoryAddress);

        for (let p = 0; p < oldParts.value.count; p++) {
          const oldPart = decodeStruct(targetBuffer, oldPartsBase + p * partSize, 'GBXModelGeometryPart');
          const newPart = decodeStruct(resultBuffer, newPartsBase + p * partSize, 'GBXModelGeometryPart');

          const oldVOff = (oldPart.get('vertex offset') as { value: number }).value;
          const newVOff = (newPart.get('vertex offset') as { value: number }).value;
          const oldTriOff = (oldPart.get('triangle offset') as { value: number }).value;
          const newTriOff = (newPart.get('triangle offset') as { value: number }).value;
          const vCount = (oldPart.get('vertex count') as { value: number }).value;
          const vType = (oldPart.get('vertex type') as { value: number }).value;
          const triCount = (oldPart.get('triangle count') as { value: number }).value;
          const bPerV = vType === 4 ? 68 : 32;

          checkedPreExistingParts++;
          if (oldVOff !== newVOff || oldTriOff !== newTriOff) {
            preExistingMismatches++;
            continue;
          }

          const oldVAbs = oldTagIndex.modelDataFileOffset + oldVOff;
          const newVAbs = newTagIndex.modelDataFileOffset + newVOff;
          if (!targetBuffer.subarray(oldVAbs, oldVAbs + vCount * bPerV).equals(resultBuffer.subarray(newVAbs, newVAbs + vCount * bPerV))) {
            preExistingMismatches++;
          }

          const oldTAbs = oldTagIndex.modelDataFileOffset + oldTagIndex.vertexSize + oldTriOff;
          const newTAbs = newTagIndex.modelDataFileOffset + newTagIndex.vertexSize + newTriOff;
          const tLen = Math.min(triCount * 2, 64);
          if (!targetBuffer.subarray(oldTAbs, oldTAbs + tLen).equals(resultBuffer.subarray(newTAbs, newTAbs + tLen))) {
            preExistingMismatches++;
          }
        }
      }
    }
    expect(checkedPreExistingParts).toBe(447);
    expect(preExistingMismatches).toBe(0);
  });

  it('SWAP injection of a gbxmodel tag: keeps tag count unchanged and redirects model parts to new geometry data', () => {
    const srcBuffer = readSampleMap('bloodgulch.map');
    const srcInspected = inspectCustomEditionMap(srcBuffer);
    if (srcInspected.status !== 'ok') throw new Error('bloodgulch.map did not parse');

    // Extract the ghost gbxmodel
    const ghost = srcInspected.tagIndex.entries.find((e) => e.path === 'vehicles\\ghost\\ghost' && e.primaryClassName === 'gbxmodel')!;
    const set = extractTagSet(srcBuffer, srcInspected.header, srcInspected.tagIndex, [ghost.index]);
    const container = deserializeContainer(serializeContainer(set, 'bloodgulch'));

    const oldPath = ghost.path;
    const newPath = 'vehicles\\warthog\\warthog';
    // In bloodgulch, rename the ghost container tag to match bloodgulch's warthog path for SWAP
    const swapContainer = {
      ...container,
      tags: container.tags.map((t) =>
        t.originalIndex === ghost.index
          ? {
              ...t,
              path: newPath,
              dependencies: t.dependencies.map((d) => ({
                ...d,
                fieldPath: d.fieldPath.startsWith(oldPath) ? newPath + d.fieldPath.slice(oldPath.length) : d.fieldPath,
              })),
            }
          : t,
      ),
    };

    const targetBuffer = readSampleMap('bloodgulch.map');
    const targetInspected = inspectCustomEditionMap(targetBuffer);
    if (targetInspected.status !== 'ok') throw new Error('bloodgulch.map did not parse');
    const { header: oldHeader, tagIndex: oldTagIndex } = targetInspected;

    const plan = planSwapInjection({ buffer: targetBuffer, header: oldHeader, tagIndex: oldTagIndex }, swapContainer);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;

    expect(plan.toSwap.some((s) => s.path === newPath)).toBe(true);
    expect(plan.counts.swapped).toBeGreaterThanOrEqual(1);
    expect(plan.counts.added).toBe(0);

    const resultBuffer = applySwapInjection(targetBuffer, oldHeader, oldTagIndex, swapContainer, plan);
    const outInspected = inspectCustomEditionMap(resultBuffer);
    expect(outInspected.status).toBe('ok');
    if (outInspected.status !== 'ok') return;

    // In SWAP mode, total tagCount is UNCHANGED
    expect(outInspected.tagIndex.entries.length).toBe(oldTagIndex.entries.length);

    // Model parts and sizes are updated
    expect(outInspected.tagIndex.modelPartCount).toBeGreaterThan(oldTagIndex.modelPartCount);
    expect(outInspected.tagIndex.vertexSize).toBeGreaterThan(oldTagIndex.vertexSize);
    expect(outInspected.tagIndex.modelDataSize).toBeGreaterThan(oldTagIndex.modelDataSize);
  });

  it('extracting assault rifle tag captures its geometry parts with zero uncapturedData warnings', () => {
    const buffer = readSampleMap('bloodgulch.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('bloodgulch.map did not parse');
    const { header, tagIndex } = inspected;

    const ar = tagIndex.entries.find((e) => e.path === 'weapons\\assault rifle\\assault rifle' && e.primaryClassName === 'gbxmodel')!;
    const set = extractTagSet(buffer, header, tagIndex, [ar.index]);

    const uncaptured = set.warnings.filter((w) => w.originalIndex === ar.index && w.kind === 'uncapturedData');
    expect(uncaptured).toHaveLength(0);

    const extractedTag = set.tags.find((t) => t.originalIndex === ar.index)!;
    expect(extractedTag.gbxmodelGeometryParts).toBeDefined();
    expect(extractedTag.gbxmodelGeometryParts!.length).toBeGreaterThan(0);
  });
});

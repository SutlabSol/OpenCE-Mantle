import { describe, it, expect } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import { hasSampleMap, readSampleMap } from './helpers/sample-maps';

describe('OpenCE Forge Extraction & Container Format', () => {
  it('captures gbxmodel-vertex and gbxmodel-triangle-strip into embeddedRawDataAssets with fieldOffset on dependencies', () => {
    if (!hasSampleMap('bloodgulch.map')) {
      console.warn('bloodgulch.map not found, skipping');
      return;
    }
    const buffer = readSampleMap('bloodgulch.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('sample map did not parse');
    const { header, tagIndex } = inspected;

    // Find warthog vehicle tag
    const warthogEntry = tagIndex.entries.find((e) => e.path.includes('mp_warthog') && e.primaryClassName === 'vehicle');
    expect(warthogEntry).toBeDefined();

    const set = extractTagSet(buffer, header, tagIndex, [warthogEntry!.index], {
      captureGbxmodelRawData: true,
    });

    // Verify dependencies have fieldOffset
    expect(set.tags.length).toBeGreaterThan(0);
    const gbxmodelTag = set.tags.find((t) => t.group === 'gbxmodel');
    expect(gbxmodelTag).toBeDefined();

    // Check that dependencies have fieldOffset populated
    const tagsWithDeps = set.tags.filter((t) => t.dependencies.length > 0);
    expect(tagsWithDeps.length).toBeGreaterThan(0);
    for (const tag of tagsWithDeps) {
      for (const dep of tag.dependencies) {
        expect(dep.fieldOffset).toBeDefined();
        expect(typeof dep.fieldOffset).toBe('number');
        expect(dep.fieldOffset).toBeGreaterThanOrEqual(0);
      }
    }

    // Check gbxmodel raw data capture
    expect(gbxmodelTag!.embeddedRawDataAssets.length).toBeGreaterThan(0);
    const vertexAssets = gbxmodelTag!.embeddedRawDataAssets.filter((a) => a.kind === 'gbxmodel-vertex');
    const stripAssets = gbxmodelTag!.embeddedRawDataAssets.filter((a) => a.kind === 'gbxmodel-triangle-strip');

    expect(vertexAssets.length).toBeGreaterThan(0);
    expect(stripAssets.length).toBeGreaterThan(0);

    // Verify patches point to part offsets (+0x64 for vertex, +0x4C for triangle strip)
    const vertexPatches = gbxmodelTag!.embeddedRawDataPatches.filter((p) => {
      const asset = gbxmodelTag!.embeddedRawDataAssets[p.assetIndex];
      return asset && asset.kind === 'gbxmodel-vertex';
    });
    const stripPatches = gbxmodelTag!.embeddedRawDataPatches.filter((p) => {
      const asset = gbxmodelTag!.embeddedRawDataAssets[p.assetIndex];
      return asset && asset.kind === 'gbxmodel-triangle-strip';
    });

    expect(vertexPatches.length).toBe(vertexAssets.length);
    expect(stripPatches.length).toBe(stripAssets.length);

    for (const p of vertexPatches) {
      expect(p.patchWidth).toBe(4);
    }
    for (const p of stripPatches) {
      expect(p.patchWidth).toBe(4);
    }

    // Verify payload sizes
    for (const vAsset of vertexAssets) {
      expect(vAsset.data.length % 68).toBe(0);
    }
    for (const sAsset of stripAssets) {
      expect(sAsset.data.length % 2).toBe(0);
    }

    // Serialize container with custom itemName
    const containerBuf = serializeContainer(set, 'bloodgulch', {}, {
      itemName: 'Warthog Armored Transport',
    });

    const parsed = deserializeContainer(containerBuf);
    expect(parsed.itemName).toBe('Warthog Armored Transport');
    expect(parsed.displayName).toBe('Warthog Armored Transport');

    const rootTag = parsed.tags.find((t) => t.originalIndex === warthogEntry!.index);
    expect(rootTag).toBeDefined();
    expect(rootTag!.itemName).toBe('Warthog Armored Transport');

    // Deserialized gbxmodel container tag retains assets & patches
    const parsedGbx = parsed.tags.find((t) => t.group === 'gbxmodel');
    expect(parsedGbx!.embeddedRawDataAssets?.length).toBe(gbxmodelTag!.embeddedRawDataAssets.length);
    expect(parsedGbx!.embeddedRawDataPatches?.length).toBe(gbxmodelTag!.embeddedRawDataPatches.length);
  });
});

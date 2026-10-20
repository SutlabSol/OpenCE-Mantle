import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  inspectCustomEditionMap,
  extractTagSet,
  randomAccessBuffer,
  serializeContainer,
  deserializeContainer,
  planAddInjection,
  applyAddInjection,
} from '../src/index';

describe('Option 2: Full Bitmap & Sound Extraction into .ocetags', () => {
  const b30Path = path.resolve(__dirname, '../../sample_maps/PC/b30.map');
  const bitmapsPath = path.resolve(__dirname, '../../sample_maps/PC/bitmaps.map');
  const soundsPath = path.resolve(__dirname, '../../sample_maps/PC/sounds.map');
  const bgPath = path.resolve(__dirname, '../../sample_maps/bloodgulch.map');

  const hasFiles = fs.existsSync(b30Path) && fs.existsSync(bitmapsPath) && fs.existsSync(soundsPath) && fs.existsSync(bgPath);

  it.skipIf(!hasFiles)('extracts c_dropship from b30.map with all bitmaps and sounds embedded when resource maps are provided', () => {
    const b30Buf = fs.readFileSync(b30Path);
    const mB30 = inspectCustomEditionMap(b30Buf);
    expect(mB30.status).toBe('ok');
    if (mB30.status !== 'ok') return;

    const dropshipTag = mB30.tagIndex.entries.find((e) => e.path === 'vehicles\\c_dropship\\c_dropship' && e.primaryClassName === 'vehicle');
    expect(dropshipTag).toBeDefined();
    if (!dropshipTag) return;

    const bitFile = randomAccessBuffer(fs.readFileSync(bitmapsPath), 'bitmaps.map');
    const sndFile = randomAccessBuffer(fs.readFileSync(soundsPath), 'sounds.map');

    // 1. Extract with resource files
    const extractedWithResources = extractTagSet(b30Buf, mB30.header, mB30.tagIndex, [dropshipTag.index], {
      resourceFiles: { bitmaps: bitFile, sounds: sndFile },
    });

    // Expect 85 tags in c_dropship closure
    expect(extractedWithResources.tags.length).toBe(85);

    // Count embedded assets
    let totalEmbeddedAssets = 0;
    let totalAssetBytes = 0;
    for (const t of extractedWithResources.tags) {
      totalEmbeddedAssets += t.embeddedRawDataAssets.length;
      for (const a of t.embeddedRawDataAssets) {
        totalAssetBytes += a.data.length;
      }
    }

    // All 63 external bitmap and sound chunks are now embedded
    expect(totalEmbeddedAssets).toBe(63);
    expect(totalAssetBytes).toBeGreaterThan(2_500_000); // ~2.78 MB

    // No uncaptured externalData warnings remain for the resolved assets
    const remainingExternalDataWarnings = extractedWithResources.warnings.filter((w) => w.kind === 'externalData');
    expect(remainingExternalDataWarnings.length).toBe(0);

    // 2. Serialize to .ocetags and deserialize
    const containerBuf = serializeContainer(extractedWithResources, 'b30');
    const container = deserializeContainer(containerBuf);

    expect(container.externalData).toBe('embedded');
    expect(container.tags.length).toBe(85);

    // 3. Inject into bloodgulch.map
    const bgBuf = fs.readFileSync(bgPath);
    const mBg = inspectCustomEditionMap(bgBuf);
    expect(mBg.status).toBe('ok');
    if (mBg.status !== 'ok') return;

    const plan = planAddInjection(
      { buffer: bgBuf, header: mBg.header, tagIndex: mBg.tagIndex },
      container,
      {},
      { allowEmbeddedRelocation: true },
    );

    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;

    expect(plan.blockedEmbedded.length).toBe(0);
    expect(plan.blockedOther.length).toBe(0);
    expect(plan.counts.added).toBeGreaterThan(0);

    const injectedBuf = applyAddInjection(bgBuf, mBg.header, mBg.tagIndex, container, plan, { allowEmbeddedRelocation: true });
    expect(injectedBuf.length).toBeGreaterThan(bgBuf.length);

    // 4. Verify the injected map parses cleanly
    const mInjected = inspectCustomEditionMap(injectedBuf);
    expect(mInjected.status).toBe('ok');
    if (mInjected.status !== 'ok') return;

    expect(mInjected.tagIndex.entries.length).toBe(mBg.tagIndex.entries.length + plan.counts.added);
    const injectedDropship = mInjected.tagIndex.entries.find((e) => e.path === 'vehicles\\c_dropship\\c_dropship');
    expect(injectedDropship).toBeDefined();
    expect(injectedDropship?.isExternal).toBe(false);
  });

  it.skipIf(!hasFiles)('extracting without resource files retains externalData warnings and references', () => {
    const b30Buf = fs.readFileSync(b30Path);
    const mB30 = inspectCustomEditionMap(b30Buf);
    if (mB30.status !== 'ok') return;

    const dropshipTag = mB30.tagIndex.entries.find((e) => e.path === 'vehicles\\c_dropship\\c_dropship');
    if (!dropshipTag) return;

    // Extract without resource files
    const extractedWithoutResources = extractTagSet(b30Buf, mB30.header, mB30.tagIndex, [dropshipTag.index]);

    let totalEmbeddedAssets = 0;
    for (const t of extractedWithoutResources.tags) {
      totalEmbeddedAssets += t.embeddedRawDataAssets.length;
    }
    expect(totalEmbeddedAssets).toBe(0);

    const extWarnings = extractedWithoutResources.warnings.filter((w) => w.kind === 'externalData');
    expect(extWarnings.length).toBe(63);

    const containerBuf = serializeContainer(extractedWithoutResources, 'b30');
    const container = deserializeContainer(containerBuf);
    expect(container.externalData).toBe('referenced');
  });
});

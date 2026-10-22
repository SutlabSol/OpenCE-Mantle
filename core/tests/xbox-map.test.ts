import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ensureXboxMapDecompressed,
  inspectCustomEditionMap,
  extractBspRenderMesh,
  extractScenarioPlacements,
  extractModelRenderGeometry,
  decodeBitmapTagImage,
  inspectSoundTag,
  decodeSoundPermutationPcm,
  verifyEmbeddedData,
  CacheFileEngine,
} from '../src/index';

const XBOX_DIR = path.resolve(__dirname, '../../sample_maps/xbox');
const hasXboxMaps = fs.existsSync(path.join(XBOX_DIR, 'bloodgulch.map'));

describe.skipIf(!hasXboxMaps)('Milestone 15: Xbox (v5) Cache File Support', () => {
  it('inflates and inspects Xbox bloodgulch.map, b30.map, and ui.map', () => {
    for (const name of ['bloodgulch.map', 'b30.map', 'ui.map']) {
      const raw = fs.readFileSync(path.join(XBOX_DIR, name));
      const buf = ensureXboxMapDecompressed(raw);
      expect(buf.length).toBeGreaterThan(raw.length);
      const res = inspectCustomEditionMap(buf);
      expect(res.status).toBe('ok');
      if (res.status === 'ok') {
        expect(res.header.engine).toBe(CacheFileEngine.XBOX);
        expect(res.tagIndex.baseMemoryAddress).toBe(0x803a6000);
        expect(res.tagIndex.entries.every((e) => !e.isExternal)).toBe(true);
      }
    }
  });

  it('extracts compressed 3D BSP, scenario placements, models (mode), swizzled bitmaps, and sounds from Xbox bloodgulch.map', () => {
    const raw = fs.readFileSync(path.join(XBOX_DIR, 'bloodgulch.map'));
    const buf = ensureXboxMapDecompressed(raw);
    const res = inspectCustomEditionMap(buf);
    if (res.status !== 'ok') throw new Error('Failed to inspect Xbox bloodgulch.map');

    const bsp = extractBspRenderMesh(buf, res.header, res.tagIndex, 0);
    expect(bsp.submeshes.length).toBe(79);
    expect(bsp.totalVertices).toBe(5790);
    expect(bsp.totalTriangles).toBe(5503);

    const scnr = extractScenarioPlacements(buf, res.header, res.tagIndex);
    expect(scnr.objects.length).toBe(363);
    expect(scnr.objects.filter((o) => o.modelTagId !== null).length).toBe(363);

    const modeTags = res.tagIndex.entries.filter((e) => e.primaryClassName === 'model');
    expect(modeTags.length).toBeGreaterThan(0);
    const warthogModel = modeTags.find((e) => e.path.includes('warthog')) ?? modeTags[0];
    const geom = extractModelRenderGeometry(buf, res.header, res.tagIndex, warthogModel.tagId, 4);
    expect(geom.submeshes.length).toBeGreaterThan(0);
    expect(geom.submeshes[0].vertexCount).toBeGreaterThan(0);

    const bitmTags = res.tagIndex.entries.filter((e) => e.primaryClassName === 'bitmap');
    let decodedCount = 0;
    for (const b of bitmTags.slice(0, 15)) {
      const tex = decodeBitmapTagImage(buf, res.header, res.tagIndex, b.tagId, 0);
      if (tex && tex.rgbaData.length === tex.width * tex.height * 4) decodedCount++;
    }
    expect(decodedCount).toBe(15);

    const sndTags = res.tagIndex.entries.filter((e) => e.primaryClassName === 'sound');
    const sndInfo = inspectSoundTag(buf, res.header, res.tagIndex, sndTags[0].tagId);
    expect(sndInfo.pitchRanges.length).toBeGreaterThan(0);
    const pcm = decodeSoundPermutationPcm(buf, res.header, res.tagIndex, sndTags[0].tagId, 0, 0);
    expect(pcm.pcmSamples.length).toBeGreaterThan(0);

    const verified = verifyEmbeddedData(buf, res.header, res.tagIndex);
    expect(verified.counts.embedded).toBe(1432);
    expect(verified.counts.external).toBe(0);
    expect(verified.counts.embeddedOutOfBounds).toBe(0);
    expect(verified.counts.blockedTags).toBe(0);
  });
});

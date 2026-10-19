import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import { sampleMapPath, hasSampleMap } from './helpers/sample-maps';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractBspRenderMesh } from '../src/render/bsp-geometry';
import {
  decodeDxt1,
  decodeDxt3,
  decodeDxt5,
  resolveShaderBaseBitmapTagId,
  readBitmapImageDescriptor,
  decodeBitmapTagImage,
  BitmapTextureError,
  BitmapFormat,
} from '../src/render/bitmap-textures';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex } from '../src/map/tag-index';

describe('Bitmap Texture Decoder (bitmap-textures)', () => {
  describe('Pure DXT algorithmic decoding', () => {
    it('decodes DXT1 opaque 4-color block correctly', () => {
      // 8-byte DXT1 block:
      // c0 = 0xF800 (Pure Red), c1 = 0x001F (Pure Blue), c0 > c1
      // indices = 0xE4 (11 10 01 00: pixel0=c0, pixel1=c1, pixel2=col2, pixel3=col3)
      const block = Buffer.alloc(8);
      block.writeUInt16LE(0xf800, 0); // Red
      block.writeUInt16LE(0x001f, 2); // Blue
      block.writeUInt32LE(0x000000e4, 4); // row 0: c0, c1, col2, col3

      const rgba = decodeDxt1(block, 0, 4, 4);
      expect(rgba.length).toBe(4 * 4 * 4);

      // Pixel (0, 0) is c0 (Red)
      expect(rgba[0]).toBe(255);
      expect(rgba[1]).toBe(0);
      expect(rgba[2]).toBe(0);
      expect(rgba[3]).toBe(255);

      // Pixel (1, 0) is c1 (Blue)
      expect(rgba[4]).toBe(0);
      expect(rgba[5]).toBe(0);
      expect(rgba[6]).toBe(255);
      expect(rgba[7]).toBe(255);

      // Pixel (2, 0) is 2/3 Red + 1/3 Blue
      expect(rgba[8]).toBe(170);
      expect(rgba[9]).toBe(0);
      expect(rgba[10]).toBe(85);
      expect(rgba[11]).toBe(255);

      // Pixel (3, 0) is 1/3 Red + 2/3 Blue
      expect(rgba[12]).toBe(85);
      expect(rgba[13]).toBe(0);
      expect(rgba[14]).toBe(170);
      expect(rgba[15]).toBe(255);
    });

    it('decodes DXT1 1-bit transparent block (c0 <= c1)', () => {
      const block = Buffer.alloc(8);
      block.writeUInt16LE(0x001f, 0); // Blue
      block.writeUInt16LE(0xf800, 2); // Red (c0 < c1)
      block.writeUInt32LE(0x000000c0, 4); // pixel 3 uses color index 3 (transparent)

      const rgba = decodeDxt1(block, 0, 4, 4);
      // Pixel 3 is transparent
      expect(rgba[12]).toBe(0);
      expect(rgba[13]).toBe(0);
      expect(rgba[14]).toBe(0);
      expect(rgba[15]).toBe(0);
    });

    it('decodes DXT3 explicit 4-bit alpha block', () => {
      // 16 bytes: 8 bytes alpha (4-bit per pixel) + 8 bytes DXT1 color
      const block = Buffer.alloc(16);
      // Alpha: pixel 0 has alpha 0x0F (255), pixel 1 has alpha 0x08 (136)
      block[0] = 0x8f; // low nibble = 0xf, high nibble = 0x8

      // Color: pure green
      block.writeUInt16LE(0x07e0, 8);
      block.writeUInt16LE(0x07e0, 10);
      block.writeUInt32LE(0x00000000, 12);

      const rgba = decodeDxt3(block, 0, 4, 4);
      expect(rgba[0]).toBe(0);
      expect(rgba[1]).toBe(255);
      expect(rgba[2]).toBe(0);
      expect(rgba[3]).toBe(255); // Alpha 0xF -> 255

      expect(rgba[4]).toBe(0);
      expect(rgba[5]).toBe(255);
      expect(rgba[6]).toBe(0);
      expect(rgba[7]).toBe(136); // Alpha 0x8 -> 136
    });

    it('decodes DXT5 interpolated alpha block', () => {
      // 16 bytes: 8 bytes interpolated alpha + 8 bytes DXT1 color
      const block = Buffer.alloc(16);
      block[0] = 255; // a0
      block[1] = 0;   // a1 (a0 > a1, 8-level interpolation)
      // Alpha indices: index 0 for pixel 0, index 1 for pixel 1
      // 3 bits per pixel: pixel 0 = 0 (255), pixel 1 = 1 (0)
      block[2] = 0x08; // 000 001 000 ...

      // Color: pure white
      block.writeUInt16LE(0xffff, 8);
      block.writeUInt16LE(0xffff, 10);
      block.writeUInt32LE(0x00000000, 12);

      const rgba = decodeDxt5(block, 0, 4, 4);
      expect(rgba[3]).toBe(255); // a0
      expect(rgba[7]).toBe(0);   // a1
    });

    it('throws BitmapTextureError on truncated DXT blocks', () => {
      const truncated = Buffer.alloc(4);
      expect(() => decodeDxt1(truncated, 0, 4, 4)).toThrow(BitmapTextureError);
      expect(() => decodeDxt3(truncated, 0, 4, 4)).toThrow(BitmapTextureError);
      expect(() => decodeDxt5(truncated, 0, 4, 4)).toThrow(BitmapTextureError);
    });
  });

  describe('Real map texture resolution & decoding (bloodgulch.map)', () => {
    const hasBloodgulch = hasSampleMap('bloodgulch.map');
    const hasBitmaps = hasSampleMap('bitmaps.map');

    let buffer: Buffer;
    let bitmapsBuffer: Buffer;
    let header: CacheFileHeader;
    let tagIndex: TagIndex;

    beforeAll(() => {
      if (hasBloodgulch) {
        buffer = fs.readFileSync(sampleMapPath('bloodgulch.map'));
        const inspection = inspectCustomEditionMap(buffer);
        if (inspection.status !== 'ok') throw new Error(inspection.status);
        header = inspection.header;
        tagIndex = inspection.tagIndex;
      }
      if (hasBitmaps) {
        bitmapsBuffer = fs.readFileSync(sampleMapPath('bitmaps.map'));
      }
    });

    it.skipIf(!hasBloodgulch)('resolves shader base diffuse bitmap tag ID from BSP material shader', () => {
      const bsp = extractBspRenderMesh(buffer, header, tagIndex, 0);
      const sm0 = bsp.submeshes[0];

      const baseBitmapTagId = resolveShaderBaseBitmapTagId(buffer, header, tagIndex, sm0.shaderTagId);
      expect(baseBitmapTagId).not.toBeNull();
      expect(baseBitmapTagId).toBeGreaterThan(0);

      // Verify resolved tag is actually a bitmap tag
      const bitmapEntry = tagIndex.entries.find((e) => e.tagId === baseBitmapTagId);
      expect(bitmapEntry).toBeDefined();
      expect(bitmapEntry?.primaryClassName).toBe('bitmap');
      expect(bitmapEntry?.path).toContain('blood cliff rock');
    });

    it.skipIf(!hasBloodgulch || !hasBitmaps)('reads bitmap descriptor and decodes image plate from external bitmaps.map', () => {
      const bsp = extractBspRenderMesh(buffer, header, tagIndex, 0);
      const sm0 = bsp.submeshes[0];
      const baseBitmapTagId = resolveShaderBaseBitmapTagId(buffer, header, tagIndex, sm0.shaderTagId)!;

      const desc = readBitmapImageDescriptor(buffer, header, tagIndex, baseBitmapTagId, 0, bitmapsBuffer);
      expect(desc.width).toBeGreaterThan(0);
      expect(desc.height).toBeGreaterThan(0);
      expect(desc.pixelsSize).toBeGreaterThan(0);

      const tex = decodeBitmapTagImage(buffer, header, tagIndex, baseBitmapTagId, 0, bitmapsBuffer);
      expect(tex.width).toBe(desc.width);
      expect(tex.height).toBe(desc.height);
      expect(tex.rgbaData.length).toBe(desc.width * desc.height * 4);
      expect(tex.format).toBe(desc.format);

      // Verify pixel buffer has non-zero valid data
      let hasColor = false;
      for (let i = 0; i < tex.rgbaData.length; i += 4) {
        if (tex.rgbaData[i] > 0 || tex.rgbaData[i + 1] > 0 || tex.rgbaData[i + 2] > 0) {
          hasColor = true;
          break;
        }
      }
      expect(hasColor).toBe(true);
    });

    it.skipIf(!hasBloodgulch || !hasBitmaps)('decodes BSP lightmap bitmap plate (R5G6B5 format)', () => {
      const bsp = extractBspRenderMesh(buffer, header, tagIndex, 0);
      const lightmapTagId = bsp.lightmapsBitmapTagId;

      const desc = readBitmapImageDescriptor(buffer, header, tagIndex, lightmapTagId, 0, bitmapsBuffer);
      expect(desc.width).toBe(256);
      expect(desc.height).toBe(128);
      expect(desc.format).toBe(BitmapFormat.R5G6B5);

      const tex = decodeBitmapTagImage(buffer, header, tagIndex, lightmapTagId, 0, bitmapsBuffer);
      expect(tex.width).toBe(256);
      expect(tex.height).toBe(128);
      expect(tex.rgbaData.length).toBe(256 * 128 * 4);
    });

    it.skipIf(!hasBloodgulch)('throws descriptive error if external bitmaps.map is missing when required', () => {
      const bsp = extractBspRenderMesh(buffer, header, tagIndex, 0);
      expect(() => {
        readBitmapImageDescriptor(buffer, header, tagIndex, bsp.lightmapsBitmapTagId, 0, undefined);
      }).toThrow(/External bitmaps\.map buffer is required/);
    });
  });
});

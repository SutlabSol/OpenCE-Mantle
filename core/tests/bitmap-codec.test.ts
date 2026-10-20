import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import { sampleMapPath, hasSampleMap } from './helpers/sample-maps';
import { inspectCustomEditionMap } from '../src/map/open-map';
import {
  encodeRgbaToPng,
  decodePngToRgba,
  encodeToDds,
  encodeRgbaToDxt1,
  encodeRgbaToDxt5,
  inspectBitmapTag,
  replaceBitmapImageData,
} from '../src/render/bitmap-codec';
import { decodeDxt1, decodeDxt5, BitmapFormat } from '../src/render/bitmap-textures';

describe('Bitmap Codec Unit Tests (bitmap-codec)', () => {
  describe('PNG Encoding & Decoding Roundtrip', () => {
    it('encodes and decodes RGBA8888 image without data loss', () => {
      const width = 8;
      const height = 8;
      const original = new Uint8Array(width * height * 4);
      for (let i = 0; i < original.length; i += 4) {
        original[i + 0] = (i * 7) % 256; // R
        original[i + 1] = (i * 13) % 256; // G
        original[i + 2] = (i * 29) % 256; // B
        original[i + 3] = (i * 17) % 256; // A
      }

      const png = encodeRgbaToPng(original, width, height);
      expect(png.length).toBeGreaterThan(16);
      expect(png.readUInt32BE(0)).toBe(0x89504e47); // PNG signature

      const decoded = decodePngToRgba(png);
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(decoded.rgba).toEqual(original);
    });
  });

  describe('DDS Container Encoding', () => {
    it('writes valid DDS header with correct magic and format descriptors', () => {
      const width = 16;
      const height = 16;
      const rawDxt1 = new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4) * 8);
      const dds = encodeToDds(rawDxt1, width, height, BitmapFormat.DXT1);

      expect(dds.readUInt32LE(0)).toBe(0x20534444); // "DDS "
      expect(dds.readUInt32LE(4)).toBe(124); // header size
      expect(dds.readUInt32LE(12)).toBe(height);
      expect(dds.readUInt32LE(16)).toBe(width);
      expect(dds.toString('ascii', 84, 88)).toBe('DXT1');
      expect(dds.length).toBe(128 + rawDxt1.length);
    });
  });

  describe('DXT Compression', () => {
    it('encodes RGBA pixels into DXT1 and decodes back with close fidelity', () => {
      const width = 4;
      const height = 4;
      const rgba = new Uint8Array(width * height * 4);
      // Pure Green Block
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i + 0] = 0;
        rgba[i + 1] = 255;
        rgba[i + 2] = 0;
        rgba[i + 3] = 255;
      }

      const dxt1 = encodeRgbaToDxt1(rgba, width, height);
      expect(dxt1.length).toBe(8); // Single 4x4 block = 8 bytes

      const decoded = decodeDxt1(dxt1, 0, width, height);
      expect(decoded[0]).toBe(0);
      expect(decoded[1]).toBe(255);
      expect(decoded[2]).toBe(0);
      expect(decoded[3]).toBe(255);
    });

    it('encodes RGBA pixels with varying alpha into DXT5', () => {
      const width = 4;
      const height = 4;
      const rgba = new Uint8Array(width * height * 4);
      // Half transparent red
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i + 0] = 255;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 128;
      }

      const dxt5 = encodeRgbaToDxt5(rgba, width, height);
      expect(dxt5.length).toBe(16); // Single 4x4 block = 16 bytes

      const decoded = decodeDxt5(dxt5, 0, width, height);
      expect(decoded[0]).toBeGreaterThan(240); // Red channel preserved
      expect(Math.abs(decoded[3] - 128)).toBeLessThanOrEqual(16); // Alpha close to 128
    });
  });

  describe('Sample Map Inspection & Replacement', () => {
    const haveBg = hasSampleMap('bloodgulch.map');
    const haveBitmaps = hasSampleMap('bitmaps.map');

    it.skipIf(!haveBg || !haveBitmaps)('inspects a real bitmap tag in bloodgulch.map', () => {
      const buf = fs.readFileSync(sampleMapPath('bloodgulch.map'));
      const bitmapsBuf = fs.readFileSync(sampleMapPath('bitmaps.map'));
      const inspected = inspectCustomEditionMap(buf);
      if (inspected.status !== 'ok') throw new Error('parse failed');

      // Find any bitmap tag
      const bitmEntry = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'bitmap');
      expect(bitmEntry).toBeDefined();

      const summary = inspectBitmapTag(
        buf,
        inspected.header,
        inspected.tagIndex,
        bitmEntry!.tagId,
        bitmapsBuf,
      );

      expect(summary.tagId).toBe(bitmEntry!.tagId);
      expect(summary.images.length).toBeGreaterThan(0);
      expect(summary.images[0].width).toBeGreaterThan(0);
      expect(summary.images[0].height).toBeGreaterThan(0);
    });

    it.skipIf(!haveBg || !haveBitmaps)('replaces bitmap image data, internalizes, and updates metadata descriptor', () => {
      const buf = Buffer.from(fs.readFileSync(sampleMapPath('bloodgulch.map')));
      const bitmapsBuf = fs.readFileSync(sampleMapPath('bitmaps.map'));
      const inspected = inspectCustomEditionMap(buf);
      if (inspected.status !== 'ok') throw new Error('parse failed');

      const bitmEntry = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'bitmap');
      expect(bitmEntry).toBeDefined();

      const fakePixels = new Uint8Array(64).fill(0xaa);
      const updated = replaceBitmapImageData(
        buf,
        inspected.header,
        inspected.tagIndex,
        bitmEntry!.tagId,
        0,
        fakePixels,
        8,
        8,
        BitmapFormat.DXT1,
        bitmapsBuf,
      );

      // Verify inspected summary reflects new dimensions
      const newSummary = inspectBitmapTag(
        updated,
        inspected.header,
        inspected.tagIndex,
        bitmEntry!.tagId,
        bitmapsBuf,
      );
      expect(newSummary.images[0].width).toBe(8);
      expect(newSummary.images[0].height).toBe(8);
      expect(newSummary.images[0].format).toBe(BitmapFormat.DXT1);
      expect(newSummary.images[0].pixelDataSize).toBe(64);
      expect(newSummary.images[0].isExternal).toBe(false); // Internalized
    });
  });
});

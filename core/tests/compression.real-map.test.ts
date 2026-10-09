import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { compressCustomEditionMap, decompressCustomEditionMap } from '../src/map/compression';
import { inspectCustomEditionMap } from '../src/map/open-map';

/**
 * Validates the Milestone 2 round-trip requirement against the real maps the user supplied
 * (bloodgulch.map, ui.map). These are uncompressed, so we validate the inverse direction of
 * the brief's requirement: compress(original) -> decompress -> must equal original
 * byte-for-byte, then decompress -> recompress -> decompress again must still match.
 * Skipped automatically if the sample maps aren't present on disk (e.g. a fresh clone).
 */
const SAMPLE_DIR = '/app/sample_maps';
const samples = ['bloodgulch.map', 'ui.map'].filter((name) => fs.existsSync(`${SAMPLE_DIR}/${name}`));

describe.skipIf(samples.length === 0)('real map compression round trip', () => {
  for (const name of samples) {
    it(`${name}: compress -> decompress reproduces the original byte-for-byte`, async () => {
      const original = fs.readFileSync(`${SAMPLE_DIR}/${name}`);

      const inspected = inspectCustomEditionMap(original);
      expect(inspected.status).toBe('ok');

      const compressed = await compressCustomEditionMap(original, 19);
      expect(compressed.length).toBeLessThan(original.length);

      const decompressed = await decompressCustomEditionMap(compressed);
      expect(decompressed.length).toBe(original.length);
      expect(Buffer.compare(decompressed, original)).toBe(0);
    }, 60_000);

    it(`${name}: decompress -> recompress -> decompress is byte-identical (brief's stated requirement)`, async () => {
      const original = fs.readFileSync(`${SAMPLE_DIR}/${name}`);
      const compressedOnce = await compressCustomEditionMap(original, 19);
      const decompressedOnce = await decompressCustomEditionMap(compressedOnce);
      const compressedTwice = await compressCustomEditionMap(decompressedOnce, 19);
      const decompressedTwice = await decompressCustomEditionMap(compressedTwice);
      expect(Buffer.compare(decompressedOnce, decompressedTwice)).toBe(0);
      expect(Buffer.compare(decompressedTwice, original)).toBe(0);
    }, 60_000);
  }
});

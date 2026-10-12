import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { RandomAccessFile } from '../../src/map/convert/resource-files';
import { sampleIn, sampleMapPath } from './sample-maps';

/**
 * Shared by the converter Phase 2 tests (`convert-demo*.real-map.test.ts`): sample names, read-only
 * resource files, and raw-byte helpers (fixed format offsets only, none of the converter's code).
 */

export const DEMO_BASE = 0x4bf10000;
export const CE_BASE = 0x40440000;
export const TAG_SPACE = 23 * 1024 * 1024;

export const MACDEMO = {
  bloodgulch: sampleIn('macDemo', 'bloodgulch.map'),
  ui: sampleIn('macDemo', 'ui.map'),
  b30: sampleIn('macDemo', 'b30.map'),
  mgm: sampleIn('macDemo', 'bloodgulch-MGMWeaponCollab.map'),
  paranoia: sampleIn('macDemo', 'bloodgulch-ParanoiaV2.map'),
  trueInfection: sampleIn('macDemo', 'bloodgulch-TrueInfectionV2.map'),
  zombiemod: sampleIn('macDemo', 'bloodgulch-Zombiemod.map'),
} as const;
export const MACDEMO_RES = { bitmaps: sampleIn('macDemo', 'bitmaps.map'), sounds: sampleIn('macDemo', 'sounds.map') };

export function openReadOnly(file: string): RandomAccessFile & { close(): void } {
  const fd = fs.openSync(file, 'r');
  return {
    label: path.basename(file),
    size: fs.fstatSync(fd).size,
    read(offset: number, length: number) {
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, offset);
      return n === length ? buf : buf.subarray(0, n);
    },
    close: () => fs.closeSync(fd),
  };
}

/** Opens the two resource files (sample names) read-only for `run`, then closes them. */
export function withResources<T>(files: { bitmaps: string; sounds: string }, run: (r: { bitmaps: RandomAccessFile; sounds: RandomAccessFile }) => T): T {
  const bitmaps = openReadOnly(sampleMapPath(files.bitmaps));
  const sounds = openReadOnly(sampleMapPath(files.sounds));
  try {
    return run({ bitmaps, sounds });
  } finally {
    bitmaps.close();
    sounds.close();
  }
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Raw demo header fields (memory/demo-converter.md): tag data offset 0x5EC, size 0x2C4. */
export const rawDemo = (b: Buffer) => ({ tdo: b.readUInt32LE(0x5ec), tds: b.readUInt32LE(0x2c4) });

/** Offsets of the 32-bit words (stepping 4 from `start`) where a and b differ, inside [start, end). */
export function changedWords(a: Buffer, b: Buffer, start: number, end: number): number[] {
  const out: number[] = [];
  for (let at = start; at + 4 <= end; at += 4) if (a.readUInt32LE(at) !== b.readUInt32LE(at)) out.push(at);
  return out;
}

/** Changed bytes in [start, end) that lie outside every word in `words` (0 = nothing changed between them). */
export function bytesOutside(a: Buffer, b: Buffer, start: number, end: number, words: number[]): number {
  const covered = new Set(words);
  let n = 0;
  for (let i = start; i < end; i++) if (a[i] !== b[i] && !covered.has(start + Math.floor((i - start) / 4) * 4)) n++;
  return n;
}

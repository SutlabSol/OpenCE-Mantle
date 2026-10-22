import { CorruptMapError } from './errors';
import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';
import { resolveTagDataPointer } from './tag-index';
import { resolveStruct, decodeStruct, resolvePointer, getGroupStructName, isRangeInBuffer } from './definitions/engine';

/**
 * The cache file header's `crc32` (offset 0x64): CRC-32 (reflected polynomial 0xEDB88320, register
 * seeded 0xFFFFFFFF) run over each region in order, with NO final XOR. Equivalently: the standard
 * CRC-32 of the regions concatenated, bit-inverted. Regions, in order (`ceCrcRegions`): every BSP
 * in the scenario's "structure bsps" order (bsp start, bsp size), then model data
 * (modelDataFileOffset, modelDataSize), then tag data (tagDataOffset, tagDataSize).
 * Recipe from the user (2026-10-11); confirmed: reproduces the stored crc32 of all 5 CE sample maps.
 * Kept separate from CE parsing so the Demo/HaloMD converter can reuse it with its own regions.
 */

export interface CrcRegion {
  offset: number;
  size: number;
  label: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC register over `regions` of `buffer`, seeded 0xFFFFFFFF, no final XOR (the value Halo stores). Throws if a region is out of bounds. */
export function computeCacheCrc32(buffer: Buffer, regions: CrcRegion[]): number {
  let crc = 0xffffffff;
  for (const r of regions) {
    if (!isRangeInBuffer(r.offset, r.size, buffer.length)) {
      throw new CorruptMapError(`Cannot compute the map checksum: ${r.label} (file offset ${r.offset}, ${r.size} bytes) is outside the file.`);
    }
    for (let i = r.offset, end = r.offset + r.size; i < end; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

/**
 * The scenario's "structure bsps" as file regions (bsp start, bsp size), in order, found through
 * the schema. `purpose` starts every error message ("Cannot compute the map checksum", ...).
 */
export function ceStructureBspRegions(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex, purpose = 'Cannot compute the map checksum'): CrcRegion[] {
  const regions: CrcRegion[] = [];
  const scenario = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  if (!scenario || scenario.tagId !== tagIndex.scenarioTagId >>> 0 || scenario.isExternal) {
    throw new CorruptMapError(`${purpose}: the scenario tag ID in the tag data header does not name a scenario tag in this map.`);
  }
  const scenarioStruct = getGroupStructName('scenario')!;
  const scenarioAt = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(scenarioAt, resolveStruct(scenarioStruct).totalSize, buffer.length)) {
    throw new CorruptMapError(`${purpose}: the scenario tag data is outside the file.`);
  }
  const bsps = decodeStruct(buffer, scenarioAt, scenarioStruct).get('structure bsps');
  if (bsps?.kind === 'reflexive' && bsps.value.count > 0) {
    const field = resolveStruct(scenarioStruct).fields.find((f) => f.name === 'structure bsps')!;
    const bspStruct = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
    if (!bspStruct) throw new CorruptMapError(`${purpose}: "structure bsps" is not a block list in this build's definitions.`);
    const size = resolveStruct(bspStruct).totalSize;
    const base = resolvePointer(bsps.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(base, bsps.value.count * size, buffer.length)) {
      throw new CorruptMapError(`${purpose}: the scenario's structure BSP list is outside the file.`);
    }
    for (let i = 0; i < bsps.value.count; i++) {
      const d = decodeStruct(buffer, base + i * size, bspStruct);
      const start = d.get('bsp start');
      const length = d.get('bsp size');
      if (start?.kind !== 'basic' || length?.kind !== 'basic') throw new CorruptMapError(`${purpose}: unexpected structure BSP layout.`);
      regions.push({ offset: Number(start.value), size: Number(length.value), label: `structure bsp ${i}` });
    }
  }
  return regions;
}

/** The CRC regions of an uncompressed Custom Edition (609) or Xbox (5) map, found through the schema (scenario "structure bsps"). */
export function ceCrcRegions(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex): CrcRegion[] {
  const regions = ceStructureBspRegions(buffer, header, tagIndex);
  if (header.engine !== 5 && tagIndex.modelDataSize > 0) {
    regions.push({ offset: tagIndex.modelDataFileOffset, size: tagIndex.modelDataSize, label: 'model data' });
  }
  regions.push({ offset: header.tagDataOffset, size: header.tagDataSize, label: 'tag data' });
  return regions;
}

/**
 * Computes the 32-bit compensation word to write at `header.tagDataOffset + 0x08` (`tagFileChecksums`)
 * so that `computeCacheCrc32` over `ceCrcRegions(buffer, header, tagIndex)` equals `targetCrc32` exactly.
 *
 * Uses GF(2) linearity of CRC32: flipping bit `b` (0..31) of the 32-bit word at `tagDataOffset + 0x08`
 * XORs the final CRC32 register with a fixed basis vector `basis[b]`. Solving the 32x32 linear system
 * over GF(2) produces the exact 4-byte value needed.
 */
export function computeCrc32Compensation(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  targetCrc32: number,
): number {
  const regions = ceCrcRegions(buffer, header, tagIndex);
  const patchOffset = header.tagDataOffset + 0x08;
  if (!isRangeInBuffer(patchOffset, 4, buffer.length)) {
    throw new CorruptMapError('Cannot spoof map CRC32: tag data header checksum offset is outside the file.');
  }

  // Work on a scratch copy with 0 at patchOffset to measure the zero-input baseline CRC
  const work = Buffer.from(buffer);
  work.writeUInt32LE(0, patchOffset);
  const baseCrc = computeCacheCrc32(work, regions) >>> 0;

  const tagRegion = regions[regions.length - 1];
  const stepOneZeroByte = (state: number): number => (CRC_TABLE[state & 0xff] ^ (state >>> 8)) >>> 0;

  // Build 32x32 GF(2) matrix M where column j (0..31) is the image of (1 << j) after 1 zero byte
  const matMul = (A: Uint32Array, B: Uint32Array): Uint32Array => {
    const C = new Uint32Array(32);
    for (let j = 0; j < 32; j++) {
      const col = B[j];
      let acc = 0;
      for (let k = 0; k < 32; k++) {
        if ((col >>> k) & 1) acc = (acc ^ A[k]) >>> 0;
      }
      C[j] = acc >>> 0;
    }
    return C;
  };

  let M: Uint32Array = new Uint32Array(32);
  let P: Uint32Array = new Uint32Array(32);
  for (let j = 0; j < 32; j++) {
    M[j] = stepOneZeroByte((1 << j) >>> 0);
    P[j] = (1 << j) >>> 0;
  }

  let exp = tagRegion.offset + tagRegion.size - (patchOffset + 4);
  while (exp > 0) {
    if (exp & 1) P = matMul(P, M) as Uint32Array<ArrayBuffer>;
    M = matMul(M, M) as Uint32Array<ArrayBuffer>;
    exp = Math.floor(exp / 2);
  }

  const applyP = (v: number): number => {
    let acc = 0;
    for (let k = 0; k < 32; k++) {
      if ((v >>> k) & 1) acc = (acc ^ P[k]) >>> 0;
    }
    return acc >>> 0;
  };

  // For each input bit b (0..31) of the 32-bit word at patchOffset:
  // Feed the 4 bytes of `(1 << b)` into a zero register, then apply P (advances through `exp` zero bytes).
  const basis = new Uint32Array(32);
  for (let b = 0; b < 32; b++) {
    const word = (1 << b) >>> 0;
    let c = 0;
    c = CRC_TABLE[(c ^ (word & 0xff)) & 0xff] ^ (c >>> 8);
    c = CRC_TABLE[(c ^ ((word >>> 8) & 0xff)) & 0xff] ^ (c >>> 8);
    c = CRC_TABLE[(c ^ ((word >>> 16) & 0xff)) & 0xff] ^ (c >>> 8);
    c = CRC_TABLE[(c ^ ((word >>> 24) & 0xff)) & 0xff] ^ (c >>> 8);
    basis[b] = applyP(c >>> 0);
  }

  const diff = ((targetCrc32 >>> 0) ^ baseCrc) >>> 0;
  const rows = new Uint32Array(32);
  const rhs = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    let mask = 0;
    for (let b = 0; b < 32; b++) {
      if ((basis[b] >>> i) & 1) mask = (mask | ((1 << b) >>> 0)) >>> 0;
    }
    rows[i] = mask >>> 0;
    rhs[i] = (diff >>> i) & 1;
  }

  // Gaussian elimination over GF(2)
  for (let col = 0; col < 32; col++) {
    let pivot = -1;
    for (let r = col; r < 32; r++) {
      if ((rows[r] >>> col) & 1) {
        pivot = r;
        break;
      }
    }
    if (pivot === -1) continue;
    if (pivot !== col) {
      const tmpR = rows[col];
      rows[col] = rows[pivot];
      rows[pivot] = tmpR;
      const tmpB = rhs[col];
      rhs[col] = rhs[pivot];
      rhs[pivot] = tmpB;
    }
    for (let r = 0; r < 32; r++) {
      if (r !== col && ((rows[r] >>> col) & 1)) {
        rows[r] = (rows[r] ^ rows[col]) >>> 0;
        rhs[r] ^= rhs[col];
      }
    }
  }

  let solution = 0;
  for (let col = 0; col < 32; col++) {
    if (rhs[col]) {
      solution = (solution | ((1 << col) >>> 0)) >>> 0;
    }
  }

  return solution >>> 0;
}

/**
 * Spoofs a Custom Edition `.map` buffer's CRC32 to match `targetCrc32` by writing the computed
 * GF(2) compensation value into `tag_index_header.tagFileChecksums` (`tagDataOffset + 0x08`)
 * and updating `header.crc32` (`0x64`). Returns a new Buffer with `computeCacheCrc32 === targetCrc32`.
 */
export function spoofCacheCrc32(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  targetCrc32: number,
): { buffer: Buffer; header: CacheFileHeader; tagIndex: TagIndex; compensationWord: number; crc32: number } {
  const target = targetCrc32 >>> 0;
  const out = Buffer.from(buffer);
  const compensationWord = computeCrc32Compensation(out, header, tagIndex, target);
  const patchOffset = header.tagDataOffset + 0x08;
  out.writeUInt32LE(compensationWord >>> 0, patchOffset);
  out.writeUInt32LE(target, 0x64);

  const newHeader: CacheFileHeader = {
    ...header,
    crc32: target,
  };
  const newTagIndex: TagIndex = {
    ...tagIndex,
    tagChecksum: compensationWord >>> 0,
  };

  return {
    buffer: out,
    header: newHeader,
    tagIndex: newTagIndex,
    compensationWord: compensationWord >>> 0,
    crc32: target,
  };
}

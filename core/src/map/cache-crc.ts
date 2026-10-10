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

/** The CRC regions of an uncompressed Custom Edition (609) map, found through the schema (scenario "structure bsps"). */
export function ceCrcRegions(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex): CrcRegion[] {
  const regions = ceStructureBspRegions(buffer, header, tagIndex);
  regions.push({ offset: tagIndex.modelDataFileOffset, size: tagIndex.modelDataSize, label: 'model data' });
  regions.push({ offset: header.tagDataOffset, size: header.tagDataSize, label: 'tag data' });
  return regions;
}

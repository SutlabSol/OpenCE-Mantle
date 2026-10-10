import { TAG_STRING_SIZE } from '../constants/cache-file';
import { parseCacheFileHeader } from './header';
import { parseTagIndex } from './tag-index';
import { ceCrcRegions, computeCacheCrc32 } from './cache-crc';

/**
 * The last step before any map is written to disk (File > Save As, Inject): the header's scenario
 * name is set from the chosen file name, and the header `crc32` is recomputed (`cache-crc.ts`).
 * Only those two header fields can change: scenario name at 0x20 (32 bytes) and crc32 at 0x64
 * (4 bytes). The sub-header's tag-file checksum (tag data +0x8) is left as it is - nothing here
 * recomputes it and whether anything validates it is unverified. Shared with the Demo/HaloMD
 * converter, which produces a CE 609 map and finalizes it the same way.
 */

const SCENARIO_NAME_OFFSET = 0x20;
const CRC32_OFFSET = 0x64;
/** 32-byte field, NUL-terminated. */
export const MAX_SCENARIO_NAME_LENGTH = TAG_STRING_SIZE - 1;

export interface ScenarioNameResult {
  name: string;
  warnings: string[];
}

/** Scenario name for a file name: the base name without its extension, printable ASCII only, at most 31 characters. */
export function scenarioNameFromFileName(fileName: string): ScenarioNameResult {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  const warnings: string[] = [];
  let name = '';
  const replaced = new Set<string>();
  for (const ch of stem) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) name += ch;
    else {
      name += '_';
      replaced.add(ch);
    }
  }
  if (replaced.size > 0) {
    warnings.push(`The file name contains characters the map header can't store (${[...replaced].map((c) => `"${c}"`).join(', ')}); they were replaced with "_" in the map's internal name.`);
  }
  if (name.length > MAX_SCENARIO_NAME_LENGTH) {
    warnings.push(`The file name is longer than ${MAX_SCENARIO_NAME_LENGTH} characters; the map's internal name was shortened to "${name.slice(0, MAX_SCENARIO_NAME_LENGTH)}". The game may not load a map whose internal name differs from its file name - choose a shorter name.`);
    name = name.slice(0, MAX_SCENARIO_NAME_LENGTH);
  }
  if (name.length === 0) throw new Error('The chosen file name gives an empty map name. Choose a file name with at least one character before ".map".');
  return { name, warnings };
}

export interface FinalizeResult {
  buffer: Buffer;
  scenarioName: string;
  previousScenarioName: string;
  crc32: number;
  previousCrc32: number;
  warnings: string[];
}

/**
 * Returns a copy of an uncompressed Custom Edition map with the scenario name set from `fileName`
 * and the crc32 recomputed. Never mutates `map`. When the name is unchanged its 32 bytes are left
 * untouched, so finalizing an unmodified map under its own name is byte-identical.
 */
export function finalizeForSave(map: Buffer, options: { fileName: string }): FinalizeResult {
  const header = parseCacheFileHeader(map);
  const tagIndex = parseTagIndex(map, header);
  const { name, warnings } = scenarioNameFromFileName(options.fileName);
  const out = Buffer.from(map);
  if (header.scenarioName !== name) {
    out.fill(0, SCENARIO_NAME_OFFSET, SCENARIO_NAME_OFFSET + TAG_STRING_SIZE);
    out.write(name, SCENARIO_NAME_OFFSET, 'ascii');
  }
  const crc32 = computeCacheCrc32(out, ceCrcRegions(out, header, tagIndex));
  out.writeUInt32LE(crc32, CRC32_OFFSET);
  return { buffer: out, scenarioName: name, previousScenarioName: header.scenarioName, crc32, previousCrc32: header.crc32 >>> 0, warnings };
}

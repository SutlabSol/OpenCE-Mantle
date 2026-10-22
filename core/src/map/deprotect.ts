import { TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../constants/cache-file';
import {
  fourCCFromString,
  fourCCToString,
  lookupTagClass,
  lookupTagClassByName,
  NULL_TAG_ID,
  TAG_CLASS_NONE,
} from '../constants/tag-classes';
import { readCString } from '../binary/strings';
import type { CacheFileHeader } from './header';
import { parseCacheFileHeader } from './header';
import { parseTagIndex, resolveTagDataPointer, type TagIndex } from './tag-index';
import { renameTagInMap } from './tag-index-editor';
import {
  decodeStruct,
  decodeValueField,
  getGroupDefinition,
  getGroupStructName,
  isRangeInBuffer,
  resolvePointer,
  resolveStruct,
  type ResolvedStruct,
} from './definitions/engine';
import type { DecodedReflexive } from './definitions/codec';
import { BITMAP_DATA_OFFSETS, checkDrawableBitmaps, requiredPixelDataSize } from './convert/bitmap-check';
import { checkModelParts } from './convert/model-part-check';
import { DATA_ARRAY_COUNT, DATA_ARRAY_ELEMENT_SIZE, DATA_ARRAY_HEADER_SIZE, DATA_ARRAY_MAXIMUM_COUNT, SCRIPT_NODE_SIZE } from './convert/tag-data-repairs';

/**
 * Milestone 13.5 — MEK Bug-Fix, Deprotection & Integrity Suite:
 * 1. 3-Stage Map Deprotector:
 *    - Stage 1: Root-to-Leaf Tag Class Repair (`scnr`, `matg`, `DeLa`, polymorphic `obje` / `shdr` / `bitm` discriminators, and dependency walking).
 *    - Stage 2: Scenario Script Scraping (`scnr.script_syntax_data` nodes with `type in 24..31` and `flags === 6` to recover original tag paths from `script_string_data`).
 *    - Stage 3: Heuristic Priority Renaming (`<protected>`, `<zteam>`, empty, or duplicate paths -> semantic hierarchy paths).
 * 2. Asset Integrity Repairs:
 *    - Truncated bitmap mipmap count clamping (`repairTruncatedBitmapMipmaps`, fixing TrueInfectionV2 #3849).
 *    - Corrupted model part triangle strip index clamping (`repairCorruptedModelPartStrips`, fixing theisland_3 #2574).
 */

const OBJECT_TYPE_MAP: Record<number, string> = {
  0: 'biped',
  1: 'vehicle',
  2: 'weapon',
  3: 'equipment',
  4: 'garbage',
  5: 'projectile',
  6: 'scenery',
  7: 'device_machine',
  8: 'device_control',
  9: 'device_light_fixture',
  10: 'placeholder',
  11: 'sound_scenery',
};

const SHADER_TYPE_MAP: Record<number, string> = {
  3: 'shader_environment',
  4: 'shader_model',
  5: 'shader_transparent_generic',
  6: 'shader_transparent_chicago',
  7: 'shader_transparent_chicago_extended',
  8: 'shader_transparent_water',
  9: 'shader_transparent_glass',
  10: 'shader_transparent_meter',
  11: 'shader_transparent_plasma',
};

/** HaloScript syntax node types 24..31 correspond to literal tag reference types in Halo CE. */
const SCRIPT_TAG_REF_NODE_TYPE_CLASSES: Record<number, string> = {
  24: 'sound',
  25: 'effect',
  26: 'damage_effect',
  27: 'sound_looping',
  28: 'model_animations',
  29: 'actor_variant',
  30: 'damage_effect',
  31: 'object',
};

export interface DeprotectInspectionReport {
  totalTags: number;
  protectedClassCount: number;
  protectedNameCount: number;
  duplicateNameCount: number;
  scriptRecoverableNamesCount: number;
  truncatedBitmapCount: number;
  corruptedModelPartCount: number;
  headerCrc32: number;
  tagChecksum: number;
  details: string[];
}

export interface DeprotectOptions {
  repairClasses?: boolean;
  scrapeScriptPaths?: boolean;
  heuristicRename?: boolean;
  repairBitmaps?: boolean;
  repairModelStrips?: boolean;
}

export interface DeprotectResult {
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
  classesRepaired: number;
  scriptPathsRecovered: number;
  heuristicPathsRenamed: number;
  bitmapsRepaired: number;
  modelPartsRepaired: number;
  stripIndicesClamped: number;
  log: string[];
}

function isProtectedPathName(path: string): boolean {
  const trimmed = path.trim().toLowerCase();
  if (!trimmed) return true;
  if (trimmed.includes('protected') || trimmed.includes('zteam') || trimmed.includes('hek+') || trimmed.includes(' obfuscated')) {
    return true;
  }
  // Check for control chars or non-printable chars
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return true;
  }
  return false;
}

/**
 * Resolves the Primary, Secondary, and Tertiary class FourCCs for a given concrete tag class name.
 * For example:
 * - `biped` -> `['bipd', 'unit', 'obje']`
 * - `shader_model` -> `['soso', 'shdr', null]`
 * - `scenery` -> `['scen', 'obje', null]`
 */
export function resolveClassHierarchyFourCCs(className: string): {
  primaryFourCC: number;
  secondaryFourCC: number;
  tertiaryFourCC: number;
} {
  const info = lookupTagClassByName(className);
  if (!info) {
    throw new Error(`Unknown tag class name "${className}"`);
  }
  const primaryFourCC = fourCCFromString(info.groupId);
  let secondaryFourCC = TAG_CLASS_NONE;
  let tertiaryFourCC = TAG_CLASS_NONE;
  if (info.parent) {
    const parentInfo = lookupTagClassByName(info.parent);
    if (parentInfo) {
      secondaryFourCC = fourCCFromString(parentInfo.groupId);
      if (parentInfo.parent) {
        const grandParentInfo = lookupTagClassByName(parentInfo.parent);
        if (grandParentInfo) {
          tertiaryFourCC = fourCCFromString(grandParentInfo.groupId);
        }
      }
    }
  }
  return { primaryFourCC, secondaryFourCC, tertiaryFourCC };
}

/**
 * Checks if a tag struct at `rootOffset` looks like a valid `Bitmap` tag with `BitmapData` entries starting with `'bitm'`.
 */
function looksLikeBitmapTag(buffer: Buffer, header: CacheFileHeader, baseMemoryAddress: number, rootOffset: number): boolean {
  if (!isRangeInBuffer(rootOffset, 0x6c, buffer.length)) return false;
  const count = buffer.readUInt32LE(rootOffset + 0x60);
  const ptr = buffer.readUInt32LE(rootOffset + 0x64);
  if (count === 0 || count > 2048) return false;
  const dataOffset = resolvePointer(ptr, header.tagDataOffset, baseMemoryAddress);
  if (!isRangeInBuffer(dataOffset, 48, buffer.length)) return false;
  return buffer.readUInt32LE(dataOffset) === 0x6269746d; // 'bitm'
}

/**
 * Infers the concrete subclass for polymorphic `object` (`obje`) or `shader` (`shdr`) or `unit` / `item` / `device` tags
 * by inspecting the discriminator enum in the tag's base struct.
 */
export function inferConcreteClassFromStruct(
  buffer: Buffer,
  header: CacheFileHeader,
  baseMemoryAddress: number,
  tagDataPointer: number,
  candidateClass: string,
): string {
  const rootOffset = resolveTagDataPointer(tagDataPointer, header, baseMemoryAddress);
  if (
    candidateClass === 'object' ||
    candidateClass === 'unit' ||
    candidateClass === 'item' ||
    candidateClass === 'device' ||
    OBJECT_TYPE_MAP[0] === candidateClass ||
    Object.values(OBJECT_TYPE_MAP).includes(candidateClass)
  ) {
    if (isRangeInBuffer(rootOffset, 2, buffer.length)) {
      const objType = buffer.readInt16LE(rootOffset);
      if (objType in OBJECT_TYPE_MAP) {
        return OBJECT_TYPE_MAP[objType];
      }
    }
  }
  if (candidateClass === 'shader' || candidateClass.startsWith('shader_')) {
    if (isRangeInBuffer(rootOffset + 0x24, 2, buffer.length)) {
      const shdrType = buffer.readInt16LE(rootOffset + 0x24);
      if (shdrType in SHADER_TYPE_MAP) {
        return SHADER_TYPE_MAP[shdrType];
      }
    }
  }
  if (candidateClass === 'bitmap' || looksLikeBitmapTag(buffer, header, baseMemoryAddress, rootOffset)) {
    if (looksLikeBitmapTag(buffer, header, baseMemoryAddress, rootOffset)) {
      return 'bitmap';
    }
  }
  return candidateClass;
}

/**
 * Writes the repaired class hierarchy into both `buffer` and `tagIndex.entries[tagIdx]`.
 */
function writeTagClassToEntry(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagIdx: number,
  className: string,
): boolean {
  const entry = tagIndex.entries[tagIdx];
  if (!entry) return false;
  const { primaryFourCC, secondaryFourCC, tertiaryFourCC } = resolveClassHierarchyFourCCs(className);
  const changed =
    entry.primaryClassName !== className ||
    entry.primaryClassFourCC !== primaryFourCC ||
    (entry.secondaryClassFourCC ?? TAG_CLASS_NONE) !== secondaryFourCC ||
    (entry.tertiaryClassFourCC ?? TAG_CLASS_NONE) !== tertiaryFourCC;

  const entryOffset = header.tagDataOffset + TAG_DATA_HEADER_PC_SIZE + tagIdx * TAG_ENTRY_SIZE;
  if (isRangeInBuffer(entryOffset, TAG_ENTRY_SIZE, buffer.length)) {
    buffer.writeUInt32LE(primaryFourCC >>> 0, entryOffset + 0x00);
    buffer.writeUInt32LE(secondaryFourCC >>> 0, entryOffset + 0x04);
    buffer.writeUInt32LE(tertiaryFourCC >>> 0, entryOffset + 0x08);
  }
  entry.primaryClassFourCC = primaryFourCC;
  entry.secondaryClassFourCC = secondaryFourCC === TAG_CLASS_NONE ? null : secondaryFourCC;
  entry.tertiaryClassFourCC = tertiaryFourCC === TAG_CLASS_NONE ? null : tertiaryFourCC;
  entry.primaryClassName = className;
  return changed;
}

/**
 * Stage 1: Root-to-Leaf Tag Class Repair.
 * Walks from `scenario` (`scenarioTagId`), `globals\globals` (`matg`), and `ui_widget_definition` (`DeLa`) roots,
 * plus scans all tags for polymorphic `object` (`+0x00`), `shader` (`+0x24`), and `bitmap` (`BitmapData + 0x00 == 'bitm'`) signatures,
 * repairing wiped/spoofed FourCCs in `TagIndex` and `TagDependency` slots.
 */
export function repairProtectedTagClasses(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): { classesRepaired: number; log: string[] } {
  let classesRepaired = 0;
  const log: string[] = [];

  const queue: number[] = [];
  const visited = new Set<number>();

  const assignClass = (idx: number, rawClassName: string, reason: string) => {
    const entry = tagIndex.entries[idx];
    if (!entry) return;
    const concrete = entry.isExternal
      ? rawClassName
      : inferConcreteClassFromStruct(buffer, header, tagIndex.baseMemoryAddress, entry.tagDataPointerOrResourceIndex, rawClassName);
    if (!lookupTagClassByName(concrete)) return;
    if (writeTagClassToEntry(buffer, header, tagIndex, idx, concrete)) {
      classesRepaired++;
      log.push(`Repaired tag #${idx} ("${entry.path}") class -> ${concrete} (${reason})`);
    }
    if (!visited.has(idx)) {
      queue.push(idx);
    }
  };

  // 1. Seed scenario tag from tagIndex.scenarioTagId
  const scnrIndex = tagIndex.scenarioTagId & 0xffff;
  if (tagIndex.entries[scnrIndex]) {
    assignClass(scnrIndex, 'scenario', 'scenarioTagId root');
  } else if (tagIndex.entries[0]) {
    assignClass(0, 'scenario', 'index 0 fallback root');
  }

  // 2. Seed globals\globals and known roots or already-valid classes
  for (const entry of tagIndex.entries) {
    const lowerPath = entry.path.toLowerCase();
    if (lowerPath === 'globals\\globals' && entry.primaryClassName !== 'globals') {
      assignClass(entry.index, 'globals', 'globals\\globals path');
    } else if (!entry.isExternal && entry.primaryClassName === null) {
      // Check if it's a bitmap tag by its BitmapData 'bitm' signature
      const rootOff = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
      if (looksLikeBitmapTag(buffer, header, tagIndex.baseMemoryAddress, rootOff)) {
        assignClass(entry.index, 'bitmap', 'BitmapData "bitm" signature');
      }
    } else if (entry.primaryClassName) {
      // Check if polymorphic class (e.g. 'object' or 'shader') needs refinement to concrete subclass
      const concrete = entry.isExternal
        ? entry.primaryClassName
        : inferConcreteClassFromStruct(
            buffer,
            header,
            tagIndex.baseMemoryAddress,
            entry.tagDataPointerOrResourceIndex,
            entry.primaryClassName,
          );
      if (concrete !== entry.primaryClassName && lookupTagClassByName(concrete)) {
        assignClass(entry.index, concrete, `polymorphic ${entry.primaryClassName} discriminator`);
      } else {
        queue.push(entry.index);
      }
    }
  }

  // 3. BFS walk through schema-defined TagDependency and TagReflexive blocks
  const walkStruct = (structDef: ResolvedStruct, baseAbs: number, depth: number) => {
    if (depth > 8) return;
    if (!isRangeInBuffer(baseAbs, structDef.totalSize, buffer.length)) return;

    for (const f of structDef.fields) {
      const absOffset = baseAbs + f.offset;
      if (f.def.type === 'TagDependency') {
        if (!isRangeInBuffer(absOffset, 16, buffer.length)) continue;
        const depFourCC = buffer.readUInt32LE(absOffset);
        const tagId = buffer.readUInt32LE(absOffset + 12);
        if (tagId === NULL_TAG_ID || tagId === 0) continue;
        const targetIdx = tagId & 0xffff;
        const targetEntry = tagIndex.entries[targetIdx];
        if (!targetEntry || targetEntry.tagId !== tagId >>> 0) continue;

        let inferredClass: string | null = targetEntry.primaryClassName;
        if (!inferredClass) {
          const fromDepFourCC = lookupTagClass(depFourCC);
          if (fromDepFourCC) {
            inferredClass = fromDepFourCC.name;
          } else if (f.def.classes && f.def.classes.length > 0 && f.def.classes[0] !== '*') {
            const firstAllowed = f.def.classes[0];
            const byCode = firstAllowed.length === 4 ? lookupTagClass(fourCCFromString(firstAllowed)) : null;
            const byName = lookupTagClassByName(firstAllowed);
            inferredClass = byCode?.name ?? byName?.name ?? null;
          }
        }
        if (inferredClass) {
          assignClass(targetIdx, inferredClass, `dependency "${f.name}"`);
          // Also repair the 4-byte FourCC inside the TagDependency slot if it was wiped
          const concreteEntry = tagIndex.entries[targetIdx];
          if (concreteEntry.primaryClassName) {
            const info = lookupTagClassByName(concreteEntry.primaryClassName);
            if (info) {
              const expectedFourCC = fourCCFromString(info.groupId);
              if (depFourCC !== expectedFourCC) {
                buffer.writeUInt32LE(expectedFourCC >>> 0, absOffset);
              }
            }
          }
        }
      } else if (f.def.type === 'TagReflexive' && f.def.struct) {
        if (!isRangeInBuffer(absOffset, 12, buffer.length)) continue;
        const decoded = decodeValueField(buffer, absOffset, f.def);
        const ref = decoded.value as DecodedReflexive;
        if (ref.count <= 0 || ref.count > 8192) continue;
        let childStruct: ResolvedStruct;
        try {
          childStruct = resolveStruct(f.def.struct);
        } catch {
          continue;
        }
        const childBase = resolvePointer(ref.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
        if (!isRangeInBuffer(childBase, ref.count * childStruct.totalSize, buffer.length)) continue;
        for (let i = 0; i < ref.count; i++) {
          walkStruct(childStruct, childBase + i * childStruct.totalSize, depth + 1);
        }
      }
    }
  };

  while (queue.length > 0) {
    const idx = queue.shift()!;
    if (visited.has(idx)) continue;
    visited.add(idx);
    const entry = tagIndex.entries[idx];
    if (!entry || entry.isExternal || !entry.primaryClassName) continue;
    let structDef: ResolvedStruct;
    try {
      structDef = getGroupDefinition(entry.primaryClassName);
    } catch {
      continue;
    }
    const rootOffset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    walkStruct(structDef, rootOffset, 0);
  }

  return { classesRepaired, log };
}

/**
 * Stage 2: Scenario Script Scraping.
 * Inspects `scnr.script_syntax_data` (56-byte header + 20-byte nodes). Nodes with `type in 24..31` and `flags === 6`
 * store a `tag_id` in `data` (`+0x0C`) and a string offset into `scnr.script_string_data` (`+0x10`) containing
 * the original uncorrupted tag path compiled by Tool.
 */
export function scrapeScenarioScriptTagPaths(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): Map<number, { path: string; nodeType: number }> {
  const recovered = new Map<number, { path: string; nodeType: number }>();
  const scnrIdx = tagIndex.scenarioTagId & 0xffff;
  const scnrEntry = tagIndex.entries[scnrIdx];
  if (!scnrEntry || scnrEntry.isExternal) return recovered;

  const scenarioStruct = getGroupStructName('scenario');
  if (!scenarioStruct) return recovered;
  const scnrOffset = resolveTagDataPointer(scnrEntry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(scnrOffset, resolveStruct(scenarioStruct).totalSize, buffer.length)) return recovered;

  const decoded = decodeStruct(buffer, scnrOffset, scenarioStruct);
  const syntaxField = decoded.get('script syntax data');
  const stringsField = decoded.get('script string data');
  if (syntaxField?.kind !== 'tagDataOffset' || stringsField?.kind !== 'tagDataOffset') return recovered;
  if (syntaxField.value.size < DATA_ARRAY_HEADER_SIZE || stringsField.value.size <= 0) return recovered;

  const syntaxOffset = resolvePointer(syntaxField.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
  const stringsOffset = resolvePointer(stringsField.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
  if (
    !isRangeInBuffer(syntaxOffset, DATA_ARRAY_HEADER_SIZE, buffer.length) ||
    !isRangeInBuffer(stringsOffset, stringsField.value.size, buffer.length)
  ) {
    return recovered;
  }

  const maxNodes = buffer.readInt16LE(syntaxOffset + DATA_ARRAY_MAXIMUM_COUNT);
  const elemSize = buffer.readInt16LE(syntaxOffset + DATA_ARRAY_ELEMENT_SIZE);
  const countNodes = buffer.readInt16LE(syntaxOffset + DATA_ARRAY_COUNT);
  if (elemSize !== SCRIPT_NODE_SIZE || maxNodes <= 0) return recovered;

  const nodesToScan = Math.min(Math.max(countNodes, 0), maxNodes);
  for (let i = 0; i < nodesToScan; i++) {
    const nodeAt = syntaxOffset + DATA_ARRAY_HEADER_SIZE + i * SCRIPT_NODE_SIZE;
    if (!isRangeInBuffer(nodeAt, SCRIPT_NODE_SIZE, buffer.length)) break;
    const datumSalt = buffer.readUInt16LE(nodeAt + 0x00);
    if (datumSalt === 0) continue; // Free slot
    const nodeType = buffer.readInt16LE(nodeAt + 0x04);
    const nodeFlags = buffer.readUInt16LE(nodeAt + 0x06);
    if (nodeType >= 24 && nodeType <= 31 && nodeFlags === 6) {
      const stringOff = buffer.readUInt32LE(nodeAt + 0x10);
      const tagId = buffer.readUInt32LE(nodeAt + 0x0c);
      if (tagId === NULL_TAG_ID || tagId === 0) continue;
      const tagIdx = tagId & 0xffff;
      if (tagIdx >= tagIndex.entries.length) continue;
      if (stringOff < stringsField.value.size) {
        const strVal = readCString(buffer, stringsOffset + stringOff);
        const cleaned = strVal.trim().replace(/\//g, '\\');
        if (cleaned.length > 0 && !isProtectedPathName(cleaned) && cleaned.toLowerCase() !== 'none') {
          recovered.set(tagIdx, { path: cleaned, nodeType });
        }
      }
    }
  }

  return recovered;
}

/**
 * Stage 4a: Truncated Bitmap Mipmap Count Clamping (`repairTruncatedBitmapMipmaps`).
 * Fixes bitmaps where `pixelsSize < requiredPixelDataSize(values)` (such as `TrueInfectionV2` `#3849`)
 * by reducing `mipmapCount` (`BitmapData + 0x14`) to the highest mip level that fits inside `pixelsSize`.
 */
export function repairTruncatedBitmapMipmaps(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): { bitmapsRepaired: number; log: string[] } {
  let bitmapsRepaired = 0;
  const log: string[] = [];
  const bitmapSize = resolveStruct('BitmapData').totalSize;
  const groupSize = resolveStruct('Bitmap').totalSize;

  for (const e of tagIndex.entries) {
    if (e.primaryClassName !== 'bitmap' || e.isExternal) continue;
    const root = resolveTagDataPointer(e.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(root, groupSize, buffer.length)) continue;
    const list = decodeStruct(buffer, root, 'Bitmap').get('bitmap data');
    if (list?.kind !== 'reflexive') continue;
    for (let i = 0; i < list.value.count; i++) {
      const at = resolveTagDataPointer((list.value.pointerLow + i * bitmapSize) >>> 0, header, tagIndex.baseMemoryAddress);
      if (!isRangeInBuffer(at, bitmapSize, buffer.length)) break;
      const signature = buffer.readUInt32LE(at);
      const width = buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.width);
      const height = buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.height);
      const depth = buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.depth);
      const type = buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.type);
      const format = buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.format);
      const flags = buffer.readUInt16LE(at + BITMAP_DATA_OFFSETS.flags) & ~0x100;
      const mipmapCount = buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.mipmapCount);
      const pixelsSize = buffer.readInt32LE(at + BITMAP_DATA_OFFSETS.pixelsSize);

      if (signature !== 0x6269746d || width <= 0 || height <= 0 || depth <= 0 || mipmapCount <= 0) continue;
      const needed = requiredPixelDataSize({
        signature,
        width,
        height,
        depth,
        type,
        format,
        flags,
        mipmapCount,
        pixelsSize,
      });
      if (pixelsSize < needed) {
        let curWidth = width;
        let curHeight = height;
        let curDepth = depth;
        let clampedMipmaps = mipmapCount;
        // First try reducing mipmapCount alone
        let fits = false;
        for (let m = mipmapCount; m >= 0; m--) {
          const tryNeeded = requiredPixelDataSize({
            signature,
            width: curWidth,
            height: curHeight,
            depth: curDepth,
            type,
            format,
            flags,
            mipmapCount: m,
            pixelsSize,
          });
          if (pixelsSize >= tryNeeded) {
            clampedMipmaps = m;
            fits = true;
            break;
          }
        }
        // If even mipmapCount = 0 doesn't fit (e.g. a 256x256 texture whose dimensions were spoofed to 512x512
        // like TrueInfectionV2 #3849), step down dimensions by powers of 2 and find the highest valid mipmapCount.
        if (!fits) {
          while ((curWidth > 1 || curHeight > 1) && !fits) {
            curWidth = Math.max(1, curWidth >> 1);
            curHeight = Math.max(1, curHeight >> 1);
            const maxMip = Math.max(0, 31 - Math.clz32(Math.max(curWidth, curHeight, curDepth)));
            for (let m = Math.min(mipmapCount, maxMip); m >= 0; m--) {
              const tryNeeded = requiredPixelDataSize({
                signature,
                width: curWidth,
                height: curHeight,
                depth: curDepth,
                type,
                format,
                flags,
                mipmapCount: m,
                pixelsSize,
              });
              if (pixelsSize >= tryNeeded) {
                clampedMipmaps = m;
                fits = true;
                break;
              }
            }
          }
        }
        buffer.writeInt16LE(curWidth, at + BITMAP_DATA_OFFSETS.width);
        buffer.writeInt16LE(curHeight, at + BITMAP_DATA_OFFSETS.height);
        buffer.writeInt16LE(clampedMipmaps, at + BITMAP_DATA_OFFSETS.mipmapCount);
        bitmapsRepaired++;
        log.push(
          `Clamped truncated bitmap #${e.index} "${e.path}" bitmap ${i}: ${width}x${height} (${mipmapCount} mips) -> ${curWidth}x${curHeight} (${clampedMipmaps} mips, ${pixelsSize} bytes available)`,
        );
      }
    }
  }

  return { bitmapsRepaired, log };
}

/**
 * Stage 4b: Corrupted Model Part Triangle Strip Clamping (`repairCorruptedModelPartStrips`).
 * Fixes `gbxmodel` geometry parts whose triangle strip indices exceed `vertexCount - 1`
 * (such as `theisland_3` `#2574`) by clamping out-of-range strip indices to a neighboring valid vertex index
 * (creating a zero-area degenerate triangle rather than crashing OpenCE's vertex buffer verifier).
 */
export function repairCorruptedModelPartStrips(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): { modelPartsRepaired: number; stripIndicesClamped: number; log: string[] } {
  let modelPartsRepaired = 0;
  let stripIndicesClamped = 0;
  const log: string[] = [];

  const geometrySize = resolveStruct('GBXModelGeometry').totalSize;
  const base = tagIndex.baseMemoryAddress;
  const modelDataAt = tagIndex.modelDataFileOffset;
  const indexDataOffset = tagIndex.vertexSize;

  for (const entry of tagIndex.entries) {
    if (entry.isExternal || entry.primaryClassName !== 'gbxmodel') continue;
    const modelAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, base);
    if (!isRangeInBuffer(modelAt, resolveStruct('GBXModel').totalSize, buffer.length)) continue;
    const model = decodeStruct(buffer, modelAt, 'GBXModel');
    const geometries = model.get('geometries');
    if (!geometries || geometries.kind !== 'reflexive' || geometries.value.count <= 0) continue;

    const geometriesAt = resolvePointer(geometries.value.pointerLow, header.tagDataOffset, base);
    for (let g = 0; g < geometries.value.count; g++) {
      const gAt = geometriesAt + g * geometrySize;
      if (!isRangeInBuffer(gAt, geometrySize, buffer.length)) break;
      const geometry = decodeStruct(buffer, gAt, 'GBXModelGeometry');
      const parts = geometry.get('parts');
      if (!parts || parts.kind !== 'reflexive' || parts.value.count <= 0) continue;

      const partsAt = resolvePointer(parts.value.pointerLow, header.tagDataOffset, base);
      for (let p = 0; p < parts.value.count; p++) {
        const at = partsAt + p * 0x84;
        if (!isRangeInBuffer(at, 0x84, buffer.length)) break;
        const triangleCount = buffer.readInt32LE(at + 0x48);
        const stripOffset = buffer.readUInt32LE(at + 0x4c);
        const vertexCount = buffer.readInt32LE(at + 0x58);
        const stripIndexCount = triangleCount + 2;
        if (vertexCount <= 0 || triangleCount < 1) continue;

        const stripAt = modelDataAt + indexDataOffset + stripOffset;
        if (!isRangeInBuffer(stripAt, stripIndexCount * 2, buffer.length)) continue;

        let clampedInPart = 0;
        let lastValidVertex = Math.max(0, vertexCount - 1);
        // Find first valid vertex in strip if any
        for (let k = 0; k < stripIndexCount; k++) {
          const val = buffer.readUInt16LE(stripAt + k * 2);
          if (val < vertexCount) {
            lastValidVertex = val;
            break;
          }
        }
        for (let k = 0; k < stripIndexCount; k++) {
          const val = buffer.readUInt16LE(stripAt + k * 2);
          if (val >= vertexCount) {
            buffer.writeUInt16LE(lastValidVertex, stripAt + k * 2);
            clampedInPart++;
            stripIndicesClamped++;
          } else {
            lastValidVertex = val;
          }
        }
        if (clampedInPart > 0) {
          modelPartsRepaired++;
          log.push(
            `Clamped ${clampedInPart} out-of-range strip indices on #${entry.index} "${entry.path}" geometry ${g} part ${p} (vertexCount=${vertexCount})`,
          );
        }
      }
    }
  }

  return { modelPartsRepaired, stripIndicesClamped, log };
}

/**
 * Inspects a loaded map for protection artifacts (obfuscated classes, `<protected>` names, script-recoverable paths,
 * duplicate tag names) and asset integrity defects (truncated bitmap mipmaps, out-of-bounds model strip indices).
 */
export function inspectMapProtectionAndIntegrity(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): DeprotectInspectionReport {
  let protectedClassCount = 0;
  let protectedNameCount = 0;
  let duplicateNameCount = 0;
  const seenKey = new Set<string>();
  const details: string[] = [];

  for (const e of tagIndex.entries) {
    if (!e.primaryClassName) {
      protectedClassCount++;
    } else if (!e.isExternal && (e.primaryClassName === 'object' || e.primaryClassName === 'shader')) {
      protectedClassCount++;
    }
    if (isProtectedPathName(e.path)) {
      protectedNameCount++;
    }
    const key = `${e.primaryClassName ?? fourCCToString(e.primaryClassFourCC)}:${e.path.toLowerCase()}`;
    if (seenKey.has(key)) {
      duplicateNameCount++;
    } else {
      seenKey.add(key);
    }
  }

  const scriptMap = scrapeScenarioScriptTagPaths(buffer, header, tagIndex);
  let scriptRecoverableNamesCount = 0;
  for (const [idx, info] of scriptMap.entries()) {
    const entry = tagIndex.entries[idx];
    if (entry && (isProtectedPathName(entry.path) || entry.path.toLowerCase() !== info.path.toLowerCase())) {
      scriptRecoverableNamesCount++;
    }
  }

  const bmpReport = checkDrawableBitmaps(buffer, header, tagIndex, { ignoreExternalBit: true });
  const modelReport = checkModelParts(buffer, header, tagIndex);

  if (protectedClassCount > 0) details.push(`${protectedClassCount} tag(s) have obfuscated or base polymorphic classes.`);
  if (protectedNameCount > 0) details.push(`${protectedNameCount} tag(s) have protected/corrupted path strings (e.g. "<protected>").`);
  if ( duplicateNameCount > 0) details.push(`${duplicateNameCount} tag(s) share duplicate (class, path) names.`);
  if (scriptRecoverableNamesCount > 0) details.push(`${scriptRecoverableNamesCount} tag path(s) can be recovered from compiled HaloScript syntax nodes.`);
  if (bmpReport.problems.length > 0) details.push(`${bmpReport.problems.length} bitmap(s) have drawable/mipmap truncation issues.`);
  if (modelReport.problems.length > 0) details.push(`${modelReport.problems.length} model part(s) have out-of-range strip index or geometry issues.`);

  return {
    totalTags: tagIndex.entries.length,
    protectedClassCount,
    protectedNameCount,
    duplicateNameCount,
    scriptRecoverableNamesCount,
    truncatedBitmapCount: bmpReport.problems.length,
    corruptedModelPartCount: modelReport.problems.length,
    headerCrc32: header.crc32 >>> 0,
    tagChecksum: tagIndex.tagChecksum >>> 0,
    details,
  };
}

function defaultFolderPrefixForClass(className: string | null, scenarioName: string): string {
  switch (className) {
    case 'scenario':
    case 'scenario_structure_bsp':
      return `levels\\${scenarioName}\\${scenarioName}`;
    case 'globals':
      return 'globals\\globals';
    case 'biped':
      return 'characters\\biped';
    case 'vehicle':
      return 'vehicles\\vehicle';
    case 'weapon':
      return 'weapons\\weapon';
    case 'equipment':
      return 'powerups\\equipment';
    case 'projectile':
      return 'weapons\\projectile';
    case 'scenery':
      return 'scenery\\scenery';
    case 'sound':
      return 'sound\\sfx\\sound';
    case 'sound_looping':
      return 'sound\\looping\\sound_looping';
    case 'bitmap':
      return 'bitmaps\\bitmap';
    case 'gbxmodel':
      return 'models\\model';
    case 'model_collision_geometry':
      return 'models\\collision';
    case 'model_animations':
      return 'models\\animations';
    case 'ui_widget_definition':
    case 'ui_widget_collection':
      return 'ui\\shell\\widget';
    default:
      if (className?.startsWith('shader')) return `shaders\\${className}`;
      return `repaired\\${className ?? 'tag'}`;
  }
}

/**
 * Executes the 3-Stage Map Deprotector and Asset Integrity Suite on a map buffer.
 */
export function deprotectAndRepairMap(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  options: DeprotectOptions = {},
): DeprotectResult {
  const {
    repairClasses = true,
    scrapeScriptPaths = true,
    heuristicRename = true,
    repairBitmaps = true,
    repairModelStrips = true,
  } = options;

  let workBuffer: Buffer = Buffer.from(buffer);
  let workHeader = { ...header };
  let workTagIndex: TagIndex = {
    ...tagIndex,
    entries: tagIndex.entries.map((e) => ({ ...e })),
  };
  const log: string[] = [];

  let classesRepaired = 0;
  let scriptPathsRecovered = 0;
  let heuristicPathsRenamed = 0;
  let bitmapsRepaired = 0;
  let modelPartsRepaired = 0;
  let stripIndicesClamped = 0;

  // Stage 1: Root-to-Leaf Tag Class Repair
  if (repairClasses) {
    const res1 = repairProtectedTagClasses(workBuffer, workHeader, workTagIndex);
    classesRepaired = res1.classesRepaired;
    log.push(...res1.log);
  }

  // Stage 2: Scenario Script Scraping
  if (scrapeScriptPaths) {
    const recovered = scrapeScenarioScriptTagPaths(workBuffer, workHeader, workTagIndex);
    for (const [idx, info] of recovered.entries()) {
      const entry = workTagIndex.entries[idx];
      if (!entry) continue;
      // Also repair class from script node type if still unknown
      if (!entry.primaryClassName && info.nodeType in SCRIPT_TAG_REF_NODE_TYPE_CLASSES) {
        const nodeClass = SCRIPT_TAG_REF_NODE_TYPE_CLASSES[info.nodeType];
        const concrete = entry.isExternal
          ? nodeClass
          : inferConcreteClassFromStruct(workBuffer, workHeader, workTagIndex.baseMemoryAddress, entry.tagDataPointerOrResourceIndex, nodeClass);
        if (writeTagClassToEntry(workBuffer, workHeader, workTagIndex, idx, concrete)) {
          classesRepaired++;
        }
      }
      if (isProtectedPathName(entry.path)) {
        try {
          const ren = renameTagInMap(workBuffer, workHeader, workTagIndex, idx, info.path);
          workBuffer = ren.buffer;
          workHeader = parseCacheFileHeader(workBuffer);
          scriptPathsRecovered++;
          log.push(`Recovered tag #${idx} path from HaloScript -> "${info.path}"`);
        } catch {
          // If duplicate path exists, append index suffix
          try {
            const fallbackPath = `${info.path}_${idx}`;
            const ren = renameTagInMap(workBuffer, workHeader, workTagIndex, idx, fallbackPath);
            workBuffer = ren.buffer;
            workHeader = parseCacheFileHeader(workBuffer);
            scriptPathsRecovered++;
            log.push(`Recovered tag #${idx} path from HaloScript -> "${fallbackPath}"`);
          } catch {
            // Ignore
          }
        }
      }
    }
  }

  // Stage 3: Heuristic Priority Renaming
  if (heuristicRename) {
    const scnrName = workHeader.scenarioName || 'map';
    const seenKeys = new Set<string>();

    // First register all clean, non-duplicate names
    for (const entry of workTagIndex.entries) {
      if (!isProtectedPathName(entry.path)) {
        const key = `${entry.primaryClassName ?? entry.primaryClassFourCC}:${entry.path.toLowerCase()}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
        }
      }
    }

    const usedKeys = new Set<string>();
    for (let i = 0; i < workTagIndex.entries.length; i++) {
      const entry = workTagIndex.entries[i];
      const classKey = entry.primaryClassName ?? fourCCToString(entry.primaryClassFourCC);
      const currentKey = `${classKey}:${entry.path.toLowerCase()}`;
      const needsRename = isProtectedPathName(entry.path) || usedKeys.has(currentKey);

      if (!needsRename) {
        usedKeys.add(currentKey);
        continue;
      }

      let basePrefix = defaultFolderPrefixForClass(entry.primaryClassName, scnrName);
      let candidate =
        entry.primaryClassName === 'scenario' || entry.primaryClassName === 'globals'
          ? basePrefix
          : `${basePrefix}_${i}`;
      let suffix = 1;
      while (usedKeys.has(`${classKey}:${candidate.toLowerCase()}`) || seenKeys.has(`${classKey}:${candidate.toLowerCase()}`)) {
        candidate = `${basePrefix}_${i}_${suffix++}`;
      }

      try {
        const ren = renameTagInMap(workBuffer, workHeader, workTagIndex, i, candidate);
        workBuffer = ren.buffer;
        workHeader = parseCacheFileHeader(workBuffer);
        usedKeys.add(`${classKey}:${candidate.toLowerCase()}`);
        seenKeys.add(`${classKey}:${candidate.toLowerCase()}`);
        heuristicPathsRenamed++;
        log.push(`Renamed protected/duplicate tag #${i} (${classKey}) -> "${candidate}"`);
      } catch {
        // Ignore if rename fails
      }
    }
  }

  // Stage 4a: Bitmap Mipmap Truncation Repair
  if (repairBitmaps) {
    const bmpRes = repairTruncatedBitmapMipmaps(workBuffer, workHeader, workTagIndex);
    bitmapsRepaired = bmpRes.bitmapsRepaired;
    log.push(...bmpRes.log);
  }

  // Stage 4b: Model Part Strip Index Clamping
  if (repairModelStrips) {
    const modRes = repairCorruptedModelPartStrips(workBuffer, workHeader, workTagIndex);
    modelPartsRepaired = modRes.modelPartsRepaired;
    stripIndicesClamped = modRes.stripIndicesClamped;
    log.push(...modRes.log);
  }

  // Re-parse tagIndex cleanly if all classes are valid, otherwise preserve our updated workTagIndex
  try {
    workHeader = parseCacheFileHeader(workBuffer);
    workTagIndex = parseTagIndex(workBuffer, workHeader);
  } catch {
    // Keep workTagIndex
  }

  return {
    buffer: workBuffer,
    header: workHeader,
    tagIndex: workTagIndex,
    classesRepaired,
    scriptPathsRecovered,
    heuristicPathsRenamed,
    bitmapsRepaired,
    modelPartsRepaired,
    stripIndicesClamped,
    log,
  };
}

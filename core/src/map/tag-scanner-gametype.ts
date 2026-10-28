import { parseCacheFileHeader } from './header';
import { parseTagIndex, resolveTagDataPointer } from './tag-index';
import { getGroupStructName, isRangeInBuffer, resolvePointer, resolveStruct } from './definitions/engine';
import { NULL_TAG_ID, fourCCFromString } from '../constants/tag-classes';

export interface TagErrorFinding {
  tagIndex: number;
  tagId: number;
  tagPath: string;
  tagGroup: string;
  fieldPath: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface MapTagScanReport {
  totalTagsScanned: number;
  errorCount: number;
  warningCount: number;
  findings: TagErrorFinding[];
}

export interface GlobalTagReplaceResult {
  buffer: Buffer;
  replacedCount: number;
  affectedTags: Array<{ tagIndex: number; tagPath: string; tagGroup: string; fieldPath: string }>;
}

export interface GlobalFieldReplaceOptions {
  fieldNameQuery: string;
  tagGroupFilter?: string;
  matchValue?: string;
  newValue: string;
}

export interface GlobalFieldReplaceResult {
  buffer: Buffer;
  replacedCount: number;
  affectedFields: Array<{
    tagIndex: number;
    tagPath: string;
    tagGroup: string;
    fieldPath: string;
    oldValue: string;
    newValue: string;
  }>;
}

export type HaloGameMode = 'ctf' | 'slayer' | 'oddball' | 'king' | 'race';

export interface HaloGametypeConfig {
  name: string;
  gameMode: HaloGameMode;
  teamPlay: boolean;
  scoreLimit: number;
  timeLimitMinutes: number;
  shieldsEnabled: boolean;
  startingEquipment: 'default' | 'custom' | 'pistols' | 'rifles' | 'plasma' | 'snipers' | 'rockets' | 'shotguns';
  vehicleRespawnSeconds: number;
  friendlyFire: boolean;
  motionTracker: boolean;
  infiniteGrenades: boolean;
}

const GAME_MODE_CODES: Record<HaloGameMode, number> = {
  ctf: 1,
  slayer: 2,
  oddball: 3,
  king: 4,
  race: 5,
};

const CODE_TO_GAME_MODE: Record<number, HaloGameMode> = {
  1: 'ctf',
  2: 'slayer',
  3: 'oddball',
  4: 'king',
  5: 'race',
};

const STARTING_WEAPON_CODES: Record<HaloGametypeConfig['startingEquipment'], number> = {
  default: 0,
  custom: 1,
  pistols: 2,
  rifles: 3,
  plasma: 4,
  snipers: 5,
  rockets: 6,
  shotguns: 7,
};

const CODE_TO_STARTING_WEAPON: Record<number, HaloGametypeConfig['startingEquipment']> = {
  0: 'default',
  1: 'custom',
  2: 'pistols',
  3: 'rifles',
  4: 'plasma',
  5: 'snipers',
  6: 'rockets',
  7: 'shotguns',
};

/**
 * Scans all tags in the open map for broken dependency tag IDs, out-of-bounds reflexive pointers,
 * and invalid bounding radii.
 */
export function scanMapTagsForErrors(view: Buffer): MapTagScanReport {
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const validTagIds = new Set<number>(
    tagIndex.entries
      .filter((e) => e.tagId !== NULL_TAG_ID && e.primaryClassFourCC !== 0xffffffff && !e.path.startsWith('~'))
      .map((e) => e.tagId),
  );
  const findings: TagErrorFinding[] = [];

  for (const entry of tagIndex.entries) {
    if (
      entry.isExternal ||
      !entry.primaryClassName ||
      entry.tagId === NULL_TAG_ID ||
      entry.primaryClassFourCC === 0xffffffff ||
      entry.path.startsWith('~')
    ) {
      continue;
    }
    const groupName = entry.primaryClassName;
    const structName = getGroupStructName(groupName);
    if (!structName) continue;

    const resolved = resolveStruct(structName);
    const baseAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(baseAt, resolved.totalSize, view.length)) {
      findings.push({
        tagIndex: entry.index,
        tagId: entry.tagId,
        tagPath: entry.path,
        tagGroup: groupName,
        fieldPath: '<root>',
        severity: 'error',
        message: `Root struct (${resolved.totalSize} bytes) at file offset 0x${baseAt.toString(16)} extends outside map buffer.`,
      });
      continue;
    }

    for (const field of resolved.fields) {
      const fAt = baseAt + field.offset;
      if (field.def.type === 'TagDependency') {
        const depTagId = view.readUInt32LE(fAt + 12);
        if (depTagId !== NULL_TAG_ID && depTagId !== 0 && !validTagIds.has(depTagId)) {
          findings.push({
            tagIndex: entry.index,
            tagId: entry.tagId,
            tagPath: entry.path,
            tagGroup: groupName,
            fieldPath: field.name,
            severity: 'error',
            message: `Broken TagDependency "${field.name}": references non-existent Tag ID 0x${depTagId.toString(16).toUpperCase()}.`,
          });
        }
      } else if (field.def.type === 'TagReflexive' && field.def.struct) {
        const count = view.readInt32LE(fAt);
        const ptr = view.readUInt32LE(fAt + 4);
        if (count < 0 || count > 65535) {
          findings.push({
            tagIndex: entry.index,
            tagId: entry.tagId,
            tagPath: entry.path,
            tagGroup: groupName,
            fieldPath: field.name,
            severity: 'error',
            message: `Corrupt reflexive block "${field.name}" count (${count}).`,
          });
        } else if (count > 0) {
          const childStruct = resolveStruct(field.def.struct);
          const childAt = resolvePointer(ptr, header.tagDataOffset, tagIndex.baseMemoryAddress);
          if (!isRangeInBuffer(childAt, count * childStruct.totalSize, view.length)) {
            findings.push({
              tagIndex: entry.index,
              tagId: entry.tagId,
              tagPath: entry.path,
              tagGroup: groupName,
              fieldPath: field.name,
              severity: 'error',
              message: `Reflexive block "${field.name}" (${count} elements) points outside buffer bounds (ptr 0x${ptr.toString(16)}).`,
            });
          }
        }
      } else if (field.name === 'bounding radius' && field.def.type === 'float') {
        const r = view.readFloatLE(fAt);
        if (!Number.isFinite(r) || r < 0) {
          findings.push({
            tagIndex: entry.index,
            tagId: entry.tagId,
            tagPath: entry.path,
            tagGroup: groupName,
            fieldPath: field.name,
            severity: 'warning',
            message: `Object has invalid bounding radius (${r}).`,
          });
        }
      }
    }
  }

  return {
    totalTagsScanned: tagIndex.entries.length,
    errorCount: findings.filter((f) => f.severity === 'error').length,
    warningCount: findings.filter((f) => f.severity === 'warning').length,
    findings,
  };
}

/**
 * Globally searches all tags in the map for any `TagDependency` pointing to `fromTagId` and replaces it with `toTagId`.
 */
export function globalReplaceTagReference(
  view: Buffer,
  fromTagId: number,
  toTagId: number,
): GlobalTagReplaceResult {
  const out = Buffer.from(view);
  const header = parseCacheFileHeader(out);
  const tagIndex = parseTagIndex(out, header);
  const targetEntry = tagIndex.entries.find((e) => e.tagId === toTagId);
  const affectedTags: GlobalTagReplaceResult['affectedTags'] = [];

  const scanStructRecursive = (
    structName: string,
    baseAt: number,
    pathPrefix: string,
    owner: (typeof tagIndex.entries)[number],
    depth: number,
  ) => {
    if (depth > 4) return;
    const resolved = resolveStruct(structName);
    if (!isRangeInBuffer(baseAt, resolved.totalSize, out.length)) return;

    for (const field of resolved.fields) {
      const fAt = baseAt + field.offset;
      const fieldPath = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;
      if (field.def.type === 'TagDependency') {
        const currentId = out.readUInt32LE(fAt + 12);
        if (currentId === (fromTagId >>> 0)) {
          out.writeUInt32LE(toTagId >>> 0, fAt + 12);
          if (targetEntry) {
            out.writeUInt32LE(targetEntry.primaryClassFourCC >>> 0, fAt + 0);
            const pathPtrOffset =
              header.tagDataOffset +
              (header.engine === 5 ? 0x24 : 0x28) +
              targetEntry.index * 32 +
              0x10;
            const targetPathPtr = out.readUInt32LE(pathPtrOffset);
            out.writeUInt32LE(targetPathPtr, fAt + 4);
          } else if (toTagId === NULL_TAG_ID) {
            out.writeUInt32LE(0, fAt + 4);
            out.writeUInt32LE(0, fAt + 8);
          }
          affectedTags.push({
            tagIndex: owner.index,
            tagPath: owner.path,
            tagGroup: owner.primaryClassName ?? 'unknown',
            fieldPath,
          });
        }
      } else if (field.def.type === 'TagReflexive' && field.def.struct) {
        const count = out.readInt32LE(fAt);
        const ptr = out.readUInt32LE(fAt + 4);
        if (count > 0 && count <= 8192) {
          const childStructName = field.def.struct;
          const childStruct = resolveStruct(childStructName);
          const childAt = resolvePointer(ptr, header.tagDataOffset, tagIndex.baseMemoryAddress);
          if (isRangeInBuffer(childAt, count * childStruct.totalSize, out.length)) {
            if (childStructName === 'PredictedResource' && childStruct.totalSize === 8) {
              const kept: Buffer[] = [];
              let modifiedPred = false;
              for (let i = 0; i < count; i++) {
                const elemOff = childAt + i * 8;
                const predTagId = out.readUInt32LE(elemOff + 4);
                if (predTagId === (fromTagId >>> 0)) {
                  modifiedPred = true;
                  if (toTagId !== NULL_TAG_ID) {
                    const copy = Buffer.from(out.subarray(elemOff, elemOff + 8));
                    copy.writeUInt32LE(toTagId >>> 0, 4);
                    kept.push(copy);
                  }
                } else {
                  kept.push(Buffer.from(out.subarray(elemOff, elemOff + 8)));
                }
              }
              if (modifiedPred) {
                out.fill(0, childAt, childAt + count * 8);
                for (let i = 0; i < kept.length; i++) {
                  kept[i]!.copy(out, childAt + i * 8);
                }
                out.writeInt32LE(kept.length, fAt);
                if (kept.length === 0) {
                  out.writeUInt32LE(0, fAt + 4);
                }
              }
            } else {
              for (let i = 0; i < count; i++) {
                scanStructRecursive(
                  childStructName,
                  childAt + i * childStruct.totalSize,
                  `${fieldPath}[${i}]`,
                  owner,
                  depth + 1,
                );
              }
            }
          }
        }
      }
    }
  };

  for (const entry of tagIndex.entries) {
    if (entry.isExternal || !entry.primaryClassName || entry.path.startsWith('~')) continue;
    const structName = getGroupStructName(entry.primaryClassName);
    if (!structName) continue;
    const baseAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    scanStructRecursive(structName, baseAt, '', entry, 0);
  }

  return {
    buffer: out,
    replacedCount: affectedTags.length,
    affectedTags,
  };
}

function computeHaloBlamCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let b = 0; b < 8; b++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ~crc >>> 0;
}

/**
 * Builds a binary 136-byte (`0x88`) Halo CE multiplayer gametype `blam.lst` buffer.
 */
export function buildHaloGametypeBlamLst(config: HaloGametypeConfig): Buffer {
  const buf = Buffer.alloc(0x88, 0);
  const cleanName = config.name.slice(0, 23);
  for (let i = 0; i < cleanName.length; i++) {
    buf.writeUInt16LE(cleanName.charCodeAt(i), i * 2);
  }

  buf.writeUInt32LE(GAME_MODE_CODES[config.gameMode] ?? 2, 0x30);
  buf.writeUInt32LE(config.teamPlay ? 1 : 0, 0x34);

  // Player trait bitflags at 0x38: bit 0 = shields, bit 2 = motion tracker, bit 5 = friendly fire, bit 7 = infinite grenades
  let traitFlags = 0;
  if (config.shieldsEnabled) traitFlags |= 1 << 0;
  if (config.motionTracker) traitFlags |= 1 << 2;
  if (config.friendlyFire) traitFlags |= 1 << 5;
  if (config.infiniteGrenades) traitFlags |= 1 << 7;
  buf.writeUInt32LE(traitFlags >>> 0, 0x38);

  buf.writeUInt32LE(STARTING_WEAPON_CODES[config.startingEquipment] ?? 0, 0x3c);
  buf.writeUInt32LE(Math.max(1, config.scoreLimit), 0x40);
  buf.writeUInt32LE(Math.max(0, config.timeLimitMinutes) * 30 * 60, 0x44); // in ticks (30 ticks/s)
  buf.writeUInt32LE(Math.max(0, config.vehicleRespawnSeconds) * 30, 0x48);

  // Compute CRC32 over the first 0x68 bytes and store ~crc at 0x68
  const crc = computeHaloBlamCrc32(buf.subarray(0, 0x68));
  buf.writeUInt32LE(~crc >>> 0, 0x68);
  void fourCCFromString;
  return buf;
}

/**
 * Parses a 136-byte (`0x88`) Halo CE `blam.lst` gametype file into `HaloGametypeConfig`.
 */
export function parseHaloGametypeBlamLst(buf: Buffer): HaloGametypeConfig {
  if (buf.length < 0x6c) {
    throw new Error(`Invalid blam.lst file size (${buf.length} bytes; expected 136 bytes).`);
  }
  const chars: string[] = [];
  for (let i = 0; i < 24; i++) {
    const code = buf.readUInt16LE(i * 2);
    if (code === 0) break;
    chars.push(String.fromCharCode(code));
  }
  const gameModeCode = buf.readUInt32LE(0x30);
  const teamPlay = buf.readUInt32LE(0x34) !== 0;
  const traitFlags = buf.readUInt32LE(0x38);
  const equipCode = buf.readUInt32LE(0x3c);
  const scoreLimit = buf.readUInt32LE(0x40);
  const timeLimitTicks = buf.readUInt32LE(0x44);
  const vehicleRespawnTicks = buf.readUInt32LE(0x48);

  return {
    name: chars.join('') || 'Custom Gametype',
    gameMode: CODE_TO_GAME_MODE[gameModeCode] ?? 'slayer',
    teamPlay,
    scoreLimit: scoreLimit || 25,
    timeLimitMinutes: Math.round(timeLimitTicks / (30 * 60)),
    shieldsEnabled: (traitFlags & (1 << 0)) !== 0,
    motionTracker: (traitFlags & (1 << 2)) !== 0,
    friendlyFire: (traitFlags & (1 << 5)) !== 0,
    infiniteGrenades: (traitFlags & (1 << 7)) !== 0,
    startingEquipment: CODE_TO_STARTING_WEAPON[equipCode] ?? 'default',
    vehicleRespawnSeconds: Math.round(vehicleRespawnTicks / 30),
  };
}

/**
 * Globally searches all tags in the open map for scalar/string fields matching `fieldNameQuery`
 * (optionally filtered by `tagGroupFilter` and `matchValue`) and writes `newValue` in-place.
 */
export function globalReplaceTagFieldValue(
  view: Buffer,
  options: GlobalFieldReplaceOptions,
): GlobalFieldReplaceResult {
  const query = options.fieldNameQuery.trim().toLowerCase();
  if (!query) {
    throw new Error('Field name query is required.');
  }
  const groupFilter = options.tagGroupFilter?.trim().toLowerCase() || '';
  const matchRaw = options.matchValue?.trim() ?? '';
  const hasMatchFilter = matchRaw.length > 0;
  const matchNum = hasMatchFilter ? Number.parseFloat(matchRaw) : NaN;
  const newRaw = options.newValue.trim();
  const newNum = Number.parseFloat(newRaw);

  const out = Buffer.from(view);
  const header = parseCacheFileHeader(out);
  const tagIndex = parseTagIndex(out, header);
  const affectedFields: GlobalFieldReplaceResult['affectedFields'] = [];

  const scanStruct = (
    structName: string,
    baseAt: number,
    pathPrefix: string,
    owner: (typeof tagIndex.entries)[number],
    depth: number,
  ) => {
    if (depth > 4) return;
    const resolved = resolveStruct(structName);
    if (!isRangeInBuffer(baseAt, resolved.totalSize, out.length)) return;

    for (const field of resolved.fields) {
      const fAt = baseAt + field.offset;
      const fieldPath = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;
      const fType = field.def.type;

      if (fType === 'TagReflexive' && field.def.struct) {
        const count = out.readInt32LE(fAt);
        const ptr = out.readUInt32LE(fAt + 4);
        if (count > 0 && count <= 4096 && ptr > 0) {
          const childStruct = resolveStruct(field.def.struct);
          const childAt = resolvePointer(ptr, header.tagDataOffset, tagIndex.baseMemoryAddress);
          if (isRangeInBuffer(childAt, count * childStruct.totalSize, out.length)) {
            for (let i = 0; i < count; i++) {
              scanStruct(
                field.def.struct,
                childAt + i * childStruct.totalSize,
                `${fieldPath}[${i}]`,
                owner,
                depth + 1,
              );
            }
          }
        }
        continue;
      }

      if (!field.name.toLowerCase().includes(query) && !fieldPath.toLowerCase().includes(query)) {
        continue;
      }

      if (fType === 'float' || fType === 'Fraction' || fType === 'Angle') {
        if (!Number.isFinite(newNum)) continue;
        const curVal = out.readFloatLE(fAt);
        if (hasMatchFilter && (!Number.isFinite(matchNum) || Math.abs(curVal - matchNum) > 1e-3)) {
          continue;
        }
        out.writeFloatLE(newNum, fAt);
        affectedFields.push({
          tagIndex: owner.index,
          tagPath: owner.path,
          tagGroup: owner.primaryClassName ?? 'unknown',
          fieldPath,
          oldValue: Number(curVal.toFixed(4)).toString(),
          newValue: Number(newNum.toFixed(4)).toString(),
        });
      } else if (
        fType === 'int16' ||
        fType === 'uint16' ||
        fType === 'Index' ||
        fType === 'int32' ||
        fType === 'uint32' ||
        fType === 'int8' ||
        fType === 'uint8'
      ) {
        if (!Number.isFinite(newNum)) continue;
        const intTarget = Math.round(newNum);
        const curInt =
          fType === 'int8'
            ? out.readInt8(fAt)
            : fType === 'uint8'
              ? out.readUInt8(fAt)
              : fType === 'int16' || fType === 'Index'
                ? out.readInt16LE(fAt)
                : fType === 'uint16'
                  ? out.readUInt16LE(fAt)
                  : fType === 'int32'
                    ? out.readInt32LE(fAt)
                    : out.readUInt32LE(fAt);
        if (hasMatchFilter && (!Number.isFinite(matchNum) || curInt !== Math.round(matchNum))) {
          continue;
        }
        if (fType === 'int8') out.writeInt8(Math.max(-128, Math.min(127, intTarget)), fAt);
        else if (fType === 'uint8') out.writeUInt8(Math.max(0, Math.min(255, intTarget)), fAt);
        else if (fType === 'int16' || fType === 'Index') out.writeInt16LE(Math.max(-32768, Math.min(32767, intTarget)), fAt);
        else if (fType === 'uint16') out.writeUInt16LE(Math.max(0, Math.min(65535, intTarget)), fAt);
        else if (fType === 'int32') out.writeInt32LE(intTarget, fAt);
        else out.writeUInt32LE(intTarget >>> 0, fAt);

        affectedFields.push({
          tagIndex: owner.index,
          tagPath: owner.path,
          tagGroup: owner.primaryClassName ?? 'unknown',
          fieldPath,
          oldValue: String(curInt),
          newValue: String(intTarget),
        });
      } else if (fType === 'TagString') {
        const z = out.indexOf(0, fAt);
        const curStr = out.toString('latin1', fAt, z >= fAt && z < fAt + 32 ? z : fAt + 32).trim();
        if (hasMatchFilter && !curStr.toLowerCase().includes(matchRaw.toLowerCase())) {
          continue;
        }
        out.fill(0, fAt, fAt + 32);
        out.write(newRaw.slice(0, 31), fAt, 'latin1');
        affectedFields.push({
          tagIndex: owner.index,
          tagPath: owner.path,
          tagGroup: owner.primaryClassName ?? 'unknown',
          fieldPath,
          oldValue: curStr,
          newValue: newRaw.slice(0, 31),
        });
      }
    }
  };

  for (const entry of tagIndex.entries) {
    if (entry.isExternal || !entry.primaryClassName || entry.path.startsWith('~')) continue;
    if (
      groupFilter &&
      entry.primaryClassName.toLowerCase() !== groupFilter
    ) {
      continue;
    }
    const structName = getGroupStructName(entry.primaryClassName);
    if (!structName) continue;
    const baseAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    scanStruct(structName, baseAt, '', entry, 0);
  }

  return {
    buffer: out,
    replacedCount: affectedFields.length,
    affectedFields,
  };
}


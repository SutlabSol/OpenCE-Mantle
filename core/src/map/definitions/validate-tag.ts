import { fourCCToString } from '../../constants/tag-classes';
import { resolveStruct, decodeStruct, encodeStruct } from './engine';
import type { DecodedFieldValue } from './engine';
import type { TagIndex } from '../tag-index';

/** Caps full recursive decode+round-trip of a single reflexive array; the rest is bounds-checked only. */
const MAX_ELEMENTS_FULLY_VALIDATED_PER_REFLEXIVE = 2000;

export interface TagValidationStats {
  structsVisited: number;
  dependenciesChecked: number;
  reflexivesChecked: number;
  elementsBoundsChecked: number;
}

export interface TagValidationResult {
  errors: string[];
  stats: TagValidationStats;
}

/** NULL tag id sentinel (0xFFFFFFFF), see TagDependency / TagID. */
const NULL_TAG_ID = 0xffffffff;

/**
 * Abstract Halo CE tag "base classes" used in TagDependency `classes` lists. These are not a
 * literal fourcc match - Invader's own compiler treats them as accepting any of their listed
 * concrete subtypes (confirmed this session in invader/src/tag/parser/compile/object.cpp,
 * `recursively_get_all_predicted_resources_from_struct`: the switch falls through every
 * `shader_*` fourcc AND `TAG_FOURCC_GBXMODEL` into the same branch as the abstract classes).
 */
const ABSTRACT_CLASS_EXPANSIONS: Record<string, string[]> = {
  model: ['model', 'gbxmodel'],
  item: ['item', 'weapon', 'equipment', 'garbage'],
  unit: ['unit', 'biped', 'vehicle'],
  device: ['device', 'device_control', 'device_light_fixture', 'device_machine'],
  object: [
    'object',
    'biped',
    'vehicle',
    'weapon',
    'equipment',
    'garbage',
    'projectile',
    'scenery',
    'device_control',
    'device_light_fixture',
    'device_machine',
    'placeholder',
    'sound_scenery',
  ],
  shader: [
    'shader',
    'shader_environment',
    'shader_model',
    'shader_transparent_chicago',
    'shader_transparent_chicago_extended',
    'shader_transparent_generic',
    'shader_transparent_glass',
    'shader_transparent_meter',
    'shader_transparent_plasma',
    'shader_transparent_water',
  ],
};

function classAccepts(classes: string[], actualClassName: string): boolean {
  if (classes.includes('*')) return true;
  if (classes.includes(actualClassName)) return true;
  return classes.some((c) => ABSTRACT_CLASS_EXPANSIONS[c]?.includes(actualClassName));
}

function validateDependency(
  dep: { fourcc: number; tagId: number },
  classes: string[],
  tagIndex: TagIndex,
  context: string,
  errors: string[],
): void {
  if (dep.tagId === NULL_TAG_ID) return;
  const idx = dep.tagId & 0xffff;
  if (idx >= tagIndex.entries.length) {
    errors.push(`${context}: dependency tag_id index ${idx} is out of range (tag count ${tagIndex.entries.length}).`);
    return;
  }
  const referenced = tagIndex.entries[idx];
  if (referenced.primaryClassFourCC !== dep.fourcc) {
    errors.push(
      `${context}: dependency fourcc "${fourCCToString(dep.fourcc)}" does not match referenced tag #${idx} ` +
        `(${referenced.path}) actual class "${fourCCToString(referenced.primaryClassFourCC)}".`,
    );
    return;
  }
  if (referenced.primaryClassName === null || !classAccepts(classes, referenced.primaryClassName)) {
    errors.push(
      `${context}: dependency resolves to tag #${idx} (${referenced.path}, class=${referenced.primaryClassName}) ` +
        `which is not in this field's allowed classes [${classes.join(', ')}].`,
    );
  }
}

function roundTripCheck(
  buffer: Buffer,
  fileOffset: number,
  structName: string,
  totalSize: number,
  decoded: Map<string, DecodedFieldValue>,
  context: string,
  errors: string[],
): void {
  const reEncoded = Buffer.alloc(totalSize);
  buffer.copy(reEncoded, 0, fileOffset, fileOffset + totalSize);
  try {
    encodeStruct(reEncoded, 0, structName, decoded);
  } catch (error) {
    errors.push(`${context}: failed to re-encode: ${(error as Error).message}`);
    return;
  }
  const original = buffer.subarray(fileOffset, fileOffset + totalSize);
  if (!reEncoded.equals(original)) {
    let firstDiff = -1;
    for (let i = 0; i < totalSize; i++) {
      if (reEncoded[i] !== original[i]) {
        firstDiff = i;
        break;
      }
    }
    errors.push(`${context}: round-trip encode did not reproduce original bytes (first mismatch at struct-relative offset ${firstDiff}).`);
  }
}

/**
 * Recursively decodes+validates one tag struct instance: round-trip byte-identity, all
 * TagDependency fields resolve or are null, all TagReflexive children are in-bounds (and are
 * recursively validated the same way, up to a per-array cap for performance).
 *
 * `fileOffsetAnchor`/`baseMemoryAddress` together convert a virtual pointer found inside this
 * struct to an absolute file offset: `fileOffsetAnchor + (pointer - baseMemoryAddress)`. For a
 * normal tag this anchor is `header.tagDataOffset`; for a `scenario_structure_bsp` tag it is
 * that BSP's own `bsp_start` (see `locateStructureBsp`) - Invader's tag.cpp uses the exact same
 * two-anchor formula (`base_struct_offset`/`base_struct_pointer`) for this reason.
 *
 * Fields marked `nonCached` are skipped (not dependency/reflexive-validated): Invader's JSON
 * explicitly documents these as "gets dereferenced on map build" - i.e. leftover/meaningless
 * bytes in a compiled cache tag, not a real reference. Their bytes are still preserved
 * byte-for-byte by the round-trip check regardless.
 */
export function validateStructInstance(
  buffer: Buffer,
  tagIndex: TagIndex,
  structName: string,
  fileOffset: number,
  fileOffsetAnchor: number,
  baseMemoryAddress: number,
  context: string,
  errors: string[],
  stats: TagValidationStats,
): void {
  const resolved = resolveStruct(structName);
  stats.structsVisited++;

  if (fileOffset < 0 || fileOffset + resolved.totalSize > buffer.length) {
    errors.push(`${context}: struct "${structName}" at file offset ${fileOffset} (size ${resolved.totalSize}) is out of bounds of the file.`);
    return;
  }

  const decoded = decodeStruct(buffer, fileOffset, structName);
  roundTripCheck(buffer, fileOffset, structName, resolved.totalSize, decoded, context, errors);

  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value) continue;
    if (field.def.nonCached) continue;
    const fieldContext = `${context}.${field.name}`;

    if (value.kind === 'dependency') {
      stats.dependenciesChecked++;
      const classes = field.def.type === 'TagDependency' ? field.def.classes ?? [] : [];
      validateDependency(value.value, classes, tagIndex, fieldContext, errors);
    } else if (value.kind === 'reflexive') {
      stats.reflexivesChecked++;
      const { count, pointerLow } = value.value;
      if (count === 0) continue;
      const childStructName = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
      if (!childStructName) continue;
      const childSize = resolveStruct(childStructName).totalSize;
      const childBaseOffset = fileOffsetAnchor + (pointerLow - baseMemoryAddress);

      if (childBaseOffset < 0 || childBaseOffset + count * childSize > buffer.length) {
        errors.push(
          `${fieldContext}: reflexive of ${count}x "${childStructName}" at file offset ${childBaseOffset} is out of bounds of the file.`,
        );
        continue;
      }
      stats.elementsBoundsChecked += count;

      const fullyValidateCount = Math.min(count, MAX_ELEMENTS_FULLY_VALIDATED_PER_REFLEXIVE);
      for (let i = 0; i < fullyValidateCount; i++) {
        validateStructInstance(
          buffer,
          tagIndex,
          childStructName,
          childBaseOffset + i * childSize,
          fileOffsetAnchor,
          baseMemoryAddress,
          `${fieldContext}[${i}]`,
          errors,
          stats,
        );
      }
    }
  }
}

/**
 * Locates a `scenario_structure_bsp` tag's base file offset and its OWN virtual base memory
 * address, which (unlike every other internal tag) are NOT derived from the main tag array's
 * base memory address. Instead they come from the owning Scenario tag's "structure bsps"
 * reflexive (`ScenarioBSP`: bsp_start, bsp_size, bsp_address, pad, structure_bsp dependency) -
 * SOURCE (read this session): invader/src/tag/hek/definition/scenario.json `ScenarioBSP` struct.
 *
 * Critically, `bsp_start` does NOT point directly at the `ScenarioStructureBSP` root struct -
 * it points at a 24-byte "cache header" (meta_pointer + 2x compressed-lightmap-material
 * count/pointer pairs + a "sbsp" signature as the last 4 bytes) that only Reclaimer documents
 * (Invader's JSON has no equivalent). The real root struct is found by resolving
 * `meta_pointer` as a virtual address against `bsp_address`, i.e.
 * `fileOffset = bsp_start + (meta_pointer - bsp_address)`.
 * SOURCE (read this session, then confirmed by reading real bytes in bloodgulch.map/ui.map -
 * every field in the result became plausible simultaneously, e.g. world bounds became a
 * sane bounding box and reflexive counts became small sane numbers instead of billions):
 * reclaimer/reclaimer/hek/defs/sbsp.py `sbsp_meta_header_def` comment:
 * "to convert these pointers to offsets, do: pointer - bsp_magic".
 */
export function locateStructureBsp(
  buffer: Buffer,
  tagIndex: TagIndex,
  scenarioFileOffset: number,
  scenarioFileOffsetAnchor: number,
  scenarioBaseMemoryAddress: number,
  targetTagId: number,
): { fileOffset: number; fileOffsetAnchor: number; baseMemoryAddress: number } | null {
  const decodedScenario = decodeStruct(buffer, scenarioFileOffset, 'Scenario');
  const bspsField = decodedScenario.get('structure bsps');
  if (!bspsField || bspsField.kind !== 'reflexive') return null;
  const { count, pointerLow } = bspsField.value;
  if (count === 0) return null;

  const childSize = resolveStruct('ScenarioBSP').totalSize;
  const arrayOffset = scenarioFileOffsetAnchor + (pointerLow - scenarioBaseMemoryAddress);

  for (let i = 0; i < count; i++) {
    const entryOffset = arrayOffset + i * childSize;
    const decoded = decodeStruct(buffer, entryOffset, 'ScenarioBSP');
    const dep = decoded.get('structure bsp');
    if (!dep || dep.kind !== 'dependency') continue;
    if (dep.value.tagId !== targetTagId) continue;

    const bspStart = (decoded.get('bsp start') as { kind: 'basic'; value: number }).value;
    const bspAddress = (decoded.get('bsp address') as { kind: 'basic'; value: number }).value;
    if (bspStart + 24 > buffer.length) return null;
    const metaPointer = buffer.readUInt32LE(bspStart + 0);
    return { fileOffset: bspStart + (metaPointer - bspAddress), fileOffsetAnchor: bspStart, baseMemoryAddress: bspAddress };
  }
  return null;
}

/**
 * Generic, data-driven schema engine for Halo CE tag definitions.
 *
 * Loads every `groups/*.json` file (statically imported via `definitions-index.ts` so the
 * bundler inlines them - see that file's header comment), builds one global registry of
 * enums/bitfields/structs (definitions can reference each other across files, exactly like
 * Invader's own build does), and resolves each struct's field byte offsets by walking its
 * field list in declaration order (parent-struct fields from `inherits` first, then its own
 * fields). A struct's declared `sizeBytes` (when present) is a ground-truth check: if the
 * computed layout doesn't add up to it, that is a malformed definition and `resolveStruct`
 * throws immediately rather than silently producing wrong offsets.
 *
 * This file has NO per-tag hardcoded parsing - every tag group is handled by the same
 * generic field-walking code, driven entirely by the JSON data.
 */
import { ALL_DEFINITION_FILES } from './definitions-index';
import { BASIC_TYPE_SIZES } from './basic-types';
import type { DefinitionEnum, DefinitionBitfield, DefinitionStruct, DefinitionValueField } from './types';
import {
  decodeBasicUnit,
  encodeBasicUnit,
  decodeDependency,
  encodeDependency,
  decodeReflexive,
  encodeReflexive,
  decodeTagDataOffset,
  encodeTagDataOffset,
} from './codec';
import type { DecodedDependency, DecodedReflexive, DecodedTagDataOffset } from './codec';

export class DefinitionLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitionLoadError';
  }
}

export interface ResolvedField {
  name: string;
  offset: number;
  size: number;
  def: DefinitionValueField;
}

export interface ResolvedStruct {
  name: string;
  tagClass?: string;
  totalSize: number;
  /** Non-pad fields only, in physical order, with absolute offsets from the struct's base. */
  fields: ResolvedField[];
  /** False if this tag group is not extractable yet (see `DefinitionStruct.extractable`). Undefined/true = extractable. */
  extractable?: boolean;
  notExtractableReason?: string;
}

export type DecodedFieldValue =
  | { kind: 'enum'; value: number }
  | { kind: 'bitfield'; value: number; width: 8 | 16 | 32 }
  | { kind: 'dependency'; value: DecodedDependency }
  | { kind: 'reflexive'; value: DecodedReflexive }
  | { kind: 'tagDataOffset'; value: DecodedTagDataOffset }
  | { kind: 'basic'; type: string; value: unknown }
  | { kind: 'array'; type: string; value: unknown[] }
  | { kind: 'bounds'; type: string; value: [unknown, unknown] };

const enums = new Map<string, DefinitionEnum>();
const bitfields = new Map<string, DefinitionBitfield>();
const structs = new Map<string, DefinitionStruct>();
const tagGroupNameToStructName = new Map<string, string>();

for (const file of ALL_DEFINITION_FILES) {
  for (const entry of file) {
    if (entry.kind === 'enum') {
      if (enums.has(entry.name)) throw new DefinitionLoadError(`Duplicate enum name "${entry.name}" across definition files.`);
      enums.set(entry.name, entry);
    } else if (entry.kind === 'bitfield') {
      if (bitfields.has(entry.name)) throw new DefinitionLoadError(`Duplicate bitfield name "${entry.name}" across definition files.`);
      bitfields.set(entry.name, entry);
    } else {
      if (structs.has(entry.name)) throw new DefinitionLoadError(`Duplicate struct name "${entry.name}" across definition files.`);
      structs.set(entry.name, entry);
      if (entry.tagClass) {
        if (tagGroupNameToStructName.has(entry.tagClass)) {
          throw new DefinitionLoadError(`Duplicate tag group "${entry.tagClass}" across definition files.`);
        }
        tagGroupNameToStructName.set(entry.tagClass, entry.name);
      }
    }
  }
}

function basicUnitSize(type: string): number {
  const size = BASIC_TYPE_SIZES[type];
  if (size === undefined) {
    throw new DefinitionLoadError(`Unknown basic field type "${type}".`);
  }
  return size;
}

function fieldSize(structName: string, field: DefinitionValueField): number {
  if (field.type === 'TagDependency') {
    if (!field.classes || field.classes.length === 0) {
      throw new DefinitionLoadError(`Struct "${structName}" field "${field.name}" is a TagDependency with no "classes".`);
    }
    return BASIC_TYPE_SIZES.TagDependency;
  }
  if (field.type === 'TagReflexive') {
    if (!field.struct) {
      throw new DefinitionLoadError(`Struct "${structName}" field "${field.name}" is a TagReflexive with no "struct".`);
    }
    if (!structs.has(field.struct)) {
      throw new DefinitionLoadError(
        `Struct "${structName}" field "${field.name}" is a TagReflexive pointing to undefined struct "${field.struct}".`,
      );
    }
    return BASIC_TYPE_SIZES.TagReflexive;
  }
  if (field.type === 'TagDataOffset') {
    return BASIC_TYPE_SIZES.TagDataOffset;
  }
  const enumDef = enums.get(field.type);
  if (enumDef) return 2;
  const bitfieldDef = bitfields.get(field.type);
  if (bitfieldDef) return bitfieldDef.width / 8;

  let base = basicUnitSize(field.type);
  if (field.bounds) base *= 2;
  if (field.count && field.count > 1) base *= field.count;
  return base;
}

const structResolutionCache = new Map<string, ResolvedStruct>();

export function resolveStruct(name: string, _visiting: Set<string> = new Set()): ResolvedStruct {
  const cached = structResolutionCache.get(name);
  if (cached) return cached;

  if (_visiting.has(name)) {
    throw new DefinitionLoadError(`Cyclic "inherits" chain detected involving struct "${name}".`);
  }
  const def = structs.get(name);
  if (!def) {
    throw new DefinitionLoadError(`Unknown struct "${name}".`);
  }
  _visiting.add(name);

  const fields: ResolvedField[] = [];
  let offset = 0;

  if (def.inherits) {
    const parent = resolveStruct(def.inherits, _visiting);
    fields.push(...parent.fields);
    offset = parent.totalSize;
  }

  for (const f of def.fields) {
    if (f.kind === 'pad') {
      offset += f.size;
      continue;
    }
    const size = fieldSize(name, f);
    fields.push({ name: f.name, offset, size, def: f });
    offset += size;
  }

  const totalSize = offset;
  if (def.sizeBytes !== undefined && def.sizeBytes !== totalSize) {
    throw new DefinitionLoadError(
      `Struct "${name}" computed layout size ${totalSize} bytes does not match declared size ${def.sizeBytes} bytes. ` +
        `This means the field list/basic type sizes used to derive this struct are wrong.`,
    );
  }

  const resolved: ResolvedStruct = {
    name,
    tagClass: def.tagClass,
    totalSize,
    fields,
    extractable: def.extractable,
    notExtractableReason: def.notExtractableReason,
  };
  structResolutionCache.set(name, resolved);
  _visiting.delete(name);
  return resolved;
}

/**
 * Converts a virtual-address pointer found inside a tag struct to an absolute file offset:
 * `fileOffsetAnchor + (pointer - baseMemoryAddress)`. For a normal tag `fileOffsetAnchor` is
 * `header.tagDataOffset`; for a `scenario_structure_bsp` tag it is that BSP's own `bsp_start`
 * (see `dependency-walker.ts` / `validate-tag.ts` `locateStructureBsp`). Invader's tag.cpp uses
 * this exact two-anchor formula (`base_struct_offset`/`base_struct_pointer`).
 */
export function resolvePointer(pointer: number, fileOffsetAnchor: number, baseMemoryAddress: number): number {
  return fileOffsetAnchor + (pointer - baseMemoryAddress);
}

/**
 * True if `[start, start + size)` lies entirely inside a buffer of `bufferLength` bytes. The one
 * bounds rule shared by `dependency-walker.ts` and `tag-extractor.ts` for pointer-resolved data
 * (TagReflexive arrays, TagDataOffset bytes), so the walker's warning and the extractor's skip
 * can never disagree. A negative `start` is always out of bounds - never let it reach
 * `Buffer.subarray`, which would treat it as an offset from the END of the file.
 */
export function isRangeInBuffer(start: number, size: number, bufferLength: number): boolean {
  return Number.isSafeInteger(start) && Number.isSafeInteger(size) && start >= 0 && size >= 0 && start + size <= bufferLength;
}

export function getAllTagGroupNames(): string[] {
  return Array.from(tagGroupNameToStructName.keys());
}

export function getBitfieldDefinition(name: string): DefinitionBitfield | undefined {
  return bitfields.get(name);
}

export function getEnumDefinition(name: string): DefinitionEnum | undefined {
  return enums.get(name);
}

export function getGroupStructName(tagGroupName: string): string | null {
  return tagGroupNameToStructName.get(tagGroupName) ?? null;
}

export function getGroupDefinition(tagGroupName: string): ResolvedStruct {
  const structName = tagGroupNameToStructName.get(tagGroupName);
  if (!structName) {
    throw new DefinitionLoadError(`No tag group definition registered for "${tagGroupName}".`);
  }
  return resolveStruct(structName);
}

/** Resolves every struct/enum/bitfield in the registry; throws DefinitionLoadError on the first problem found. */
export function validateAllDefinitions(): { structCount: number; enumCount: number; bitfieldCount: number; tagGroupCount: number } {
  for (const name of structs.keys()) {
    resolveStruct(name);
  }
  return {
    structCount: structs.size,
    enumCount: enums.size,
    bitfieldCount: bitfields.size,
    tagGroupCount: tagGroupNameToStructName.size,
  };
}

export function decodeValueField(buffer: Buffer, absOffset: number, field: DefinitionValueField): DecodedFieldValue {
  if (field.type === 'TagDependency') return { kind: 'dependency', value: decodeDependency(buffer, absOffset) };
  if (field.type === 'TagReflexive') return { kind: 'reflexive', value: decodeReflexive(buffer, absOffset) };
  if (field.type === 'TagDataOffset') return { kind: 'tagDataOffset', value: decodeTagDataOffset(buffer, absOffset) };
  if (enums.has(field.type)) return { kind: 'enum', value: buffer.readUInt16LE(absOffset) };
  const bitfieldDef = bitfields.get(field.type);
  if (bitfieldDef) {
    const value = bitfieldDef.width === 8 ? buffer.readUInt8(absOffset) : bitfieldDef.width === 16 ? buffer.readUInt16LE(absOffset) : buffer.readUInt32LE(absOffset);
    return { kind: 'bitfield', value, width: bitfieldDef.width };
  }
  if (field.bounds) {
    const unitSize = basicUnitSize(field.type);
    return {
      kind: 'bounds',
      type: field.type,
      value: [decodeBasicUnit(buffer, absOffset, field.type), decodeBasicUnit(buffer, absOffset + unitSize, field.type)],
    };
  }
  if (field.count && field.count > 1) {
    const unitSize = basicUnitSize(field.type);
    const out: unknown[] = [];
    for (let i = 0; i < field.count; i++) out.push(decodeBasicUnit(buffer, absOffset + i * unitSize, field.type));
    return { kind: 'array', type: field.type, value: out };
  }
  return { kind: 'basic', type: field.type, value: decodeBasicUnit(buffer, absOffset, field.type) };
}

export function encodeValueField(buffer: Buffer, absOffset: number, decoded: DecodedFieldValue): void {
  switch (decoded.kind) {
    case 'dependency':
      encodeDependency(buffer, absOffset, decoded.value);
      return;
    case 'reflexive':
      encodeReflexive(buffer, absOffset, decoded.value);
      return;
    case 'tagDataOffset':
      encodeTagDataOffset(buffer, absOffset, decoded.value);
      return;
    case 'enum':
      buffer.writeUInt16LE(decoded.value, absOffset);
      return;
    case 'bitfield':
      if (decoded.width === 8) buffer.writeUInt8(decoded.value, absOffset);
      else if (decoded.width === 16) buffer.writeUInt16LE(decoded.value, absOffset);
      else buffer.writeUInt32LE(decoded.value, absOffset);
      return;
    case 'bounds': {
      const unitSize = basicUnitSize(decoded.type);
      encodeBasicUnit(buffer, absOffset, decoded.type, decoded.value[0]);
      encodeBasicUnit(buffer, absOffset + unitSize, decoded.type, decoded.value[1]);
      return;
    }
    case 'array': {
      const unitSize = basicUnitSize(decoded.type);
      decoded.value.forEach((v, i) => encodeBasicUnit(buffer, absOffset + i * unitSize, decoded.type, v));
      return;
    }
    case 'basic':
      encodeBasicUnit(buffer, absOffset, decoded.type, decoded.value);
      return;
  }
}

/** Decodes every field of `structName` at `baseOffset` into a name -> value map. Pad bytes are skipped. */
export function decodeStruct(buffer: Buffer, baseOffset: number, structName: string): Map<string, DecodedFieldValue> {
  const resolved = resolveStruct(structName);
  const out = new Map<string, DecodedFieldValue>();
  for (const field of resolved.fields) {
    out.set(field.name, decodeValueField(buffer, baseOffset + field.offset, field.def));
  }
  return out;
}

/** Re-serializes a previously-decoded struct back into `buffer` at `baseOffset`. */
export function encodeStruct(buffer: Buffer, baseOffset: number, structName: string, decoded: Map<string, DecodedFieldValue>): void {
  const resolved = resolveStruct(structName);
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value) {
      throw new DefinitionLoadError(`encodeStruct: missing decoded value for field "${field.name}" in struct "${structName}".`);
    }
    encodeValueField(buffer, baseOffset + field.offset, value);
  }
}

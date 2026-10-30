import { parseCacheFileHeader, type CacheFileHeader } from './header';
import { parseTagIndex, resolveTagDataPointer, type TagIndex } from './tag-index';
import {
  getGroupDefinition,
  getEnumDefinition,
  getBitfieldDefinition,
  resolvePointer,
  resolveStruct,
  isRangeInBuffer,
  decodeValueField,
  encodeValueField,
  type ResolvedStruct,
  type ResolvedField,
} from './definitions/engine';
import type { DecodedReflexive } from './definitions/codec';
import { TAG_ENTRY_SIZE, TAG_DATA_HEADER_PC_SIZE } from '../constants/cache-file';
import { NULL_TAG_ID } from '../constants/tag-classes';
import { postprocessTagFields } from './tag-postprocess';

/** Safety cap on nested TagReflexive recursion depth (guards against corrupt/circular data). */
export const MAX_REFLEXIVE_DEPTH = 8;

/** Safety cap on child elements decoded per TagReflexive block (matches the dependency walker's intent). */
export const MAX_REFLEXIVE_CHILDREN = 4096;

export type TagFieldKind =
  | 'number'
  | 'bounds'
  | 'enum'
  | 'bitfield'
  | 'string'
  | 'dependency'
  | 'composite'
  | 'reflexive'
  | 'unsupported';

export interface TagFieldDescriptor {
  name: string;
  kind: TagFieldKind;
  type: string;
  offset: number;
  size: number;
  value: unknown;
  /** For enums: list of named options (index matches value) */
  enumOptions?: string[];
  /** For bitfields: flag names (bit index matches array index) */
  bitfieldFlags?: string[];
  /** Bitfield width in bits (8, 16, 32) */
  bitfieldWidth?: 8 | 16 | 32;
  /** For TagDependency: allowed group/class names */
  dependencyClasses?: string[];
  /** For TagDependency: current target tag summary */
  dependencyTarget?: {
    tagId: number;
    path: string;
    group: string;
  } | null;
  /** For bounds: component type (e.g. float) */
  boundsType?: string;
  /** For reflexive: child struct name (e.g. "weapon_projectile") */
  reflexiveStruct?: string;
  /** For reflexive: number of children decoded */
  reflexiveCount?: number;
  /** For reflexive: decoded child struct instances (recursive, read-only). */
  children?: TagReflexiveElement[];
  /** Read-only or unsupported reason if not editable */
  readOnly?: boolean;
  readOnlyReason?: string;
}

/**
 * One decoded element of a `TagReflexive` block: the struct instance the corresponding child
 * pointer points at (at absolute file offset `structBase`), with every field of that struct
 * decoded the same way the root struct's fields are (absolute offsets, same descriptor shape).
 * `fields` is populated lazily-ish: any failure to resolve/validate the struct (unknown struct
 * name, out-of-bounds pointer, corrupt layout) leaves `fields` empty rather than throwing.
 */
export interface TagReflexiveElement {
  /** Struct name, from the parent field's `struct` reference (e.g. "weapon_projectile"). */
  structName: string;
  /** Absolute file offset of the first byte of this element's struct within the map. */
  structBase: number;
  /** Decoded struct fields, in physical order. Same shape as the root-struct field descriptors. */
  fields: TagFieldDescriptor[];
}

export interface TagFieldsResult {
  tagIndex: number;
  tagId: number;
  tagPath: string;
  group: string;
  structName: string;
  fields: TagFieldDescriptor[];
}

export class TagFieldEditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagFieldEditorError';
  }
}

/**
 * Ensures an external `loc.map` resource tag (such as `font`, `unicode_string_list`, or `hud_message_text`)
 * has an allocated in-map base struct so its fields, reflexives, and dependencies can be inspected and edited
 * directly without throwing an external-resource error.
 */
export function ensureExternalTagInternalized(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
): { buffer: Buffer; header: CacheFileHeader; tagIndex: TagIndex; changed: boolean } {
  const entry = tagIndex.entries[tagEntryIndex];
  if (!entry || !entry.isExternal) {
    return { buffer, header, tagIndex, changed: false };
  }
  const group = entry.primaryClassName;
  if (!group || group === 'sound' || group === 'bitmap') {
    return { buffer, header, tagIndex, changed: false };
  }

  let structDef: ResolvedStruct;
  try {
    structDef = getGroupDefinition(group);
  } catch {
    return { buffer, header, tagIndex, changed: false };
  }

  const prePad = (4 - ((buffer.length - header.tagDataOffset) % 4)) % 4;
  const structBytes = (structDef.totalSize + 15) & ~15;
  const totalAlloc = prePad + structBytes;
  const newRootFileOffset = buffer.length + prePad;
  const newVirtualPtr = (tagIndex.baseMemoryAddress + (newRootFileOffset - header.tagDataOffset)) >>> 0;

  const out = Buffer.alloc(buffer.length + totalAlloc);
  buffer.copy(out, 0, 0, buffer.length);
  out.fill(0, newRootFileOffset, newRootFileOffset + structBytes);

  // Initialize any TagDependency slots on the root struct to NULL_TAG_ID
  for (const f of structDef.fields) {
    if (f.def.type === 'TagDependency') {
      const fccStr = (f.def.classes && f.def.classes[0]) ? 'font' : '    ';
      const fcc =
        ((fccStr.charCodeAt(0) & 0xff) << 24) |
        ((fccStr.charCodeAt(1) & 0xff) << 16) |
        ((fccStr.charCodeAt(2) & 0xff) << 8) |
        (fccStr.charCodeAt(3) & 0xff);
      out.writeUInt32LE(fcc >>> 0, newRootFileOffset + f.offset + 0);
      out.writeUInt32LE(0, newRootFileOffset + f.offset + 4);
      out.writeUInt32LE(0, newRootFileOffset + f.offset + 8);
      out.writeUInt32LE(NULL_TAG_ID, newRootFileOffset + f.offset + 12);
    }
  }

  // Provide sensible default font metrics for newly internalized .font tags
  if (group === 'font' && structDef.totalSize >= 16) {
    out.writeInt16LE(14, newRootFileOffset + 0x04); // ascending height
    out.writeInt16LE(4, newRootFileOffset + 0x06);  // descending height
    out.writeInt16LE(2, newRootFileOffset + 0x08);  // leading height
    out.writeInt16LE(1, newRootFileOffset + 0x0a);  // leading width
  }

  const tagHeaderSize = header.engine === 5 ? 36 : TAG_DATA_HEADER_PC_SIZE;
  const entryPos = header.tagDataOffset + tagHeaderSize + tagEntryIndex * TAG_ENTRY_SIZE;
  out.writeUInt32LE(newVirtualPtr, entryPos + 0x14);
  out.writeUInt32LE(0, entryPos + 0x18); // isExternal = 0 (now in-map!)

  const newFileSize = out.length;
  const newTagDataSize = out.length - header.tagDataOffset;
  out.writeUInt32LE(newFileSize, 0x08);
  out.writeUInt32LE(newTagDataSize, 0x14);

  const newHeader = parseCacheFileHeader(out);
  const newTagIndex = parseTagIndex(out, newHeader);
  return { buffer: out, header: newHeader, tagIndex: newTagIndex, changed: true };
}

/**
 * Resolves the root struct file offset for a tag entry in the map buffer.
 */
function resolveTagRootOffset(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
): { structDef: ResolvedStruct; rootFileOffset: number; group: string } {
  const entry = tagIndex.entries[tagEntryIndex];
  if (!entry) {
    throw new TagFieldEditorError(`Tag entry #${tagEntryIndex} not found in tag index.`);
  }

  const group = entry.primaryClassName;
  if (!group) {
    throw new TagFieldEditorError(`Tag #${tagEntryIndex} has unknown primary class FourCC.`);
  }

  if (entry.isExternal && group !== 'sound') {
    throw new TagFieldEditorError(`Tag "${entry.path}" is an external resource tag with no in-map base struct.`);
  }

  const structDef = getGroupDefinition(group);
  const rootFileOffset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);

  if (rootFileOffset < 0 || rootFileOffset + structDef.totalSize > buffer.length) {
    throw new TagFieldEditorError(`Tag "${entry.path}" struct offset (0x${rootFileOffset.toString(16)}) is out of bounds of the map.`);
  }

  return { structDef, rootFileOffset, group };
}

/**
 * Decodes every field of `structDef`, whose root instance starts at `baseAbs` (an ABSOLUTE
 * file offset inside `buffer`), into a `TagFieldDescriptor[]` in physical order. Each
 * descriptor carries its own absolute `offset`, so the same rendering works for the root
 * struct and for any reflexive child struct at any depth.
 *
 * For a `TagReflexive` field where `depth < MAX_REFLEXIVE_DEPTH`, the child struct array is
 * followed recursively: each element becomes a `TagReflexiveElement` whose `fields` is this
 * very function invoked at the element's absolute offset and `depth + 1`. Any failure
 * (unknown child struct, out-of-bounds pointer, depth cap, corrupt count) is reported via
 * `readOnly` + `readOnlyReason` on the descriptor together with an empty `children`, rather
 * than throwing - so one corrupt reflexive cannot break the rest of the read-only decode.
 */
function buildStructFields(
  buffer: Buffer,
  tagIndex: TagIndex,
  structDef: ResolvedStruct,
  baseAbs: number,
  fileOffsetAnchor: number,
  baseMemoryAddress: number,
  tagByTagId: Map<number, (typeof tagIndex.entries)[0]>,
  depth: number,
): TagFieldDescriptor[] {
  const fields: TagFieldDescriptor[] = [];

  for (const f of structDef.fields) {
    const absOffset = baseAbs + f.offset;
    const decoded = decodeValueField(buffer, absOffset, f.def);

    if (f.def.type === 'TagReflexive') {
      const ref = decoded.value as DecodedReflexive;
      const childStructName = f.def.struct;

      const children: TagReflexiveElement[] = [];
      let blockReason: string | undefined;
      if (!childStructName) {
        blockReason = 'TagReflexive has no known child struct name.';
      } else if (depth >= MAX_REFLEXIVE_DEPTH) {
        blockReason = `Recursion capped at depth ${MAX_REFLEXIVE_DEPTH}.`;
      } else {
        let childResolved: ResolvedStruct | null = null;
        try { childResolved = resolveStruct(childStructName); } catch { childResolved = null; }
        if (!childResolved) {
          blockReason = `Unknown TagReflexive target struct "${childStructName}".`;
        } else if (ref.count === 0) {
          blockReason = 'Reflexive has 0 elements.';
        } else {
          const childBase = resolvePointer(ref.pointerLow, fileOffsetAnchor, baseMemoryAddress);
          const totalBytes = ref.count * childResolved.totalSize;
          if (!isRangeInBuffer(childBase, totalBytes, buffer.length)) {
            blockReason = `Reflexive block (${ref.count} × ${childResolved.totalSize} B at 0x${childBase.toString(16)}) is out of bounds (map is ${buffer.length} B).`;
          } else {
            const n = Math.min(ref.count, MAX_REFLEXIVE_CHILDREN);
            if (n < ref.count) blockReason = `Reflexive truncated from ${ref.count} to ${n} elements (MAX_REFLEXIVE_CHILDREN).`;
            const r = childResolved;
            for (let i = 0; i < n; i++) {
              const structBase = childBase + i * r.totalSize;
              const structFields = buildStructFields(buffer, tagIndex, r, structBase, fileOffsetAnchor, baseMemoryAddress, tagByTagId, depth + 1);
              children.push({ structName: r.name, structBase, fields: structFields });
            }
          }
        }
      }

      fields.push({
        name: f.name,
        kind: 'reflexive',
        type: 'TagReflexive',
        offset: absOffset,
        size: f.size,
        value: ref,
        readOnly: true,
        readOnlyReason: blockReason ?? 'TagReflexive has no in-place write support (read-only decode).',
        reflexiveStruct: childStructName,
        reflexiveCount: ref.count,
        children,
      });
      continue;
    }

    if (f.def.type === 'TagDataOffset') {
      fields.push({
        name: f.name,
        kind: 'unsupported',
        type: 'TagDataOffset',
        offset: absOffset,
        size: f.size,
        value: decoded.value,
        readOnly: true,
        readOnlyReason: 'Raw data offset (relocation required)',
      });
      continue;
    }

    if (f.def.type === 'TagDependency') {
      const depVal = decoded.value as { fourcc: number; pathPointer: number; pathSize: number; tagId: number };
      const isNull = depVal.tagId === NULL_TAG_ID || depVal.tagId === 0;
      let targetInfo: TagFieldDescriptor['dependencyTarget'] = null;
      if (!isNull) {
        const targetEntry = tagByTagId.get(depVal.tagId);
        if (targetEntry) {
          targetInfo = { tagId: targetEntry.tagId, path: targetEntry.path, group: targetEntry.primaryClassName ?? '' };
        } else {
          targetInfo = { tagId: depVal.tagId, path: `Unknown (0x${depVal.tagId.toString(16)})`, group: '' };
        }
      }
      fields.push({
        name: f.name,
        kind: 'dependency',
        type: 'TagDependency',
        offset: absOffset,
        size: f.size,
        value: depVal.tagId,
        dependencyClasses: f.def.classes,
        dependencyTarget: targetInfo,
      });
      continue;
    }

    const enumDef = getEnumDefinition(f.def.type);
    if (enumDef) {
      fields.push({ name: f.name, kind: 'enum', type: f.def.type, offset: absOffset, size: f.size, value: decoded.value, enumOptions: enumDef.options });
      continue;
    }

    const bitfieldDef = getBitfieldDefinition(f.def.type);
    if (bitfieldDef) {
      fields.push({ name: f.name, kind: 'bitfield', type: f.def.type, offset: absOffset, size: f.size, value: decoded.value, bitfieldFlags: bitfieldDef.fields, bitfieldWidth: bitfieldDef.width });
      continue;
    }

    if (f.def.bounds) {
      fields.push({ name: f.name, kind: 'bounds', type: f.def.type, offset: absOffset, size: f.size, value: decoded.value, boundsType: f.def.type });
      continue;
    }

    if (f.def.type === 'TagString') {
      const strVal = decoded.value as { text: string };
      fields.push({ name: f.name, kind: 'string', type: 'TagString', offset: absOffset, size: f.size, value: strVal.text });
      continue;
    }

    if (Array.isArray(decoded.value)) {
      fields.push({ name: f.name, kind: 'composite', type: f.def.type, offset: absOffset, size: f.size, value: decoded.value });
      continue;
    }

    // Basic numeric types (float, int8/16/32, uint8/16/32, Angle, Fraction, etc.)
    fields.push({ name: f.name, kind: 'number', type: f.def.type, offset: absOffset, size: f.size, value: decoded.value });
  }

  return fields;
}

/**
 * Reads and decodes all root-struct fields for the specified tag entry, including a recursive
 * read-only decode of every `TagReflexive` child array (bounded by {@link MAX_REFLEXIVE_DEPTH}
 * and {@link MAX_REFLEXIVE_CHILDREN}). Pointer anchors follow the same rule as
 * `tag-extractor.ts`: the file-offset anchor is the tag data header (`header.tagDataOffset`),
 * and the virtual-memory base is the tag index's `baseMemoryAddress`.
 */
export function readTagFieldValues(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
): TagFieldsResult {
  const entry = tagIndex.entries[tagEntryIndex];
  if (entry && entry.isExternal && entry.primaryClassName && entry.primaryClassName !== 'sound') {
    const group = entry.primaryClassName;
    const structDef = getGroupDefinition(group);
    const synthBuf = Buffer.alloc(structDef.totalSize, 0);
    for (const f of structDef.fields) {
      if (f.def.type === 'TagDependency') {
        synthBuf.writeUInt32LE(NULL_TAG_ID, f.offset + 12);
      }
    }
    if (group === 'font' && structDef.totalSize >= 16) {
      synthBuf.writeInt16LE(14, 0x04);
      synthBuf.writeInt16LE(4, 0x06);
      synthBuf.writeInt16LE(2, 0x08);
      synthBuf.writeInt16LE(1, 0x0a);
    }
    const tagByTagId = new Map<number, (typeof tagIndex.entries)[0]>();
    for (const e of tagIndex.entries) {
      tagByTagId.set(e.tagId, e);
    }
    const fields = buildStructFields(
      synthBuf,
      tagIndex,
      structDef,
      0,
      0,
      tagIndex.baseMemoryAddress,
      tagByTagId,
      0,
    );
    return { tagIndex: tagEntryIndex, tagId: entry.tagId, tagPath: entry.path, group, structName: structDef.name, fields };
  }

  const { structDef, rootFileOffset, group } = resolveTagRootOffset(buffer, header, tagIndex, tagEntryIndex);

  // Map tagId -> TagIndexEntry for quick dependency lookups
  const tagByTagId = new Map<number, (typeof tagIndex.entries)[0]>();
  for (const e of tagIndex.entries) {
    tagByTagId.set(e.tagId, e);
  }

  const fields = buildStructFields(
    buffer,
    tagIndex,
    structDef,
    rootFileOffset,
    header.tagDataOffset,
    tagIndex.baseMemoryAddress,
    tagByTagId,
    0,
  );

  return { tagIndex: tagEntryIndex, tagId: entry.tagId, tagPath: entry.path, group, structName: structDef.name, fields };
}


/**
 * Resolves a (possibly dotted reflexive) field path to the concrete field and its absolute file offset, so
 * `writeTagFieldValue` can target root-struct fields as well as fields nested any number of levels inside
 * `TagReflexive` blocks. `fieldPath` is either a plain root-struct field name (e.g. `autoaim angle`) or a
 * dotted reflexive path whose leading segments are `<reflexiveField>[<index>]` steps (e.g.
 * `magazines[0].magazine objects[0].rounds`). Every intermediate segment must name a `TagReflexive` field
 * on the current struct; the final segment is the leaf field name on the reached child struct. Any
 * structural failure (unknown field, not a reflexive, out-of-range index, out-of-bounds pointer) throws
 * {@link TagFieldEditorError}.
 */
function resolveTargetField(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  structDef: ResolvedStruct,
  rootFileOffset: number,
  fieldPath: string,
): { field: ResolvedField; absOffset: number } {
  // Fast path: a root-struct field whose exact name matches the whole path (no reflexive traversal).
  const direct = structDef.fields.find((f) => f.name === fieldPath);
  if (direct) {
    return { field: direct, absOffset: rootFileOffset + direct.offset };
  }

  const segments = fieldPath.split('.');
  let currentStruct = structDef;
  let currentBase = rootFileOffset;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i === segments.length - 1) {
      // Final segment: the leaf field name on the current struct.
      const leaf = currentStruct.fields.find((f) => f.name === seg);
      if (!leaf) {
        throw new TagFieldEditorError(`Struct "${currentStruct.name}" has no field named "${seg}" (path "${fieldPath}").`);
      }
      return { field: leaf, absOffset: currentBase + leaf.offset };
    }

    // Intermediate segments must each be a `<reflexiveField>[<index>]` step.
    const refDepth = i + 1;
    if (refDepth >= MAX_REFLEXIVE_DEPTH) {
      throw new TagFieldEditorError(`Reflexive path "${fieldPath}" exceeds the maximum nesting depth of ${MAX_REFLEXIVE_DEPTH - 1}.`);
    }
    const m = seg.match(/^(.+)\[(\d+)\]$/);
    if (!m) {
      throw new TagFieldEditorError(`Segment "${seg}" in path "${fieldPath}" is not a valid reflexive step (expected form name[<index>]).`);
    }
    const refName = m[1];
    const index = Number(m[2]);

    const field = currentStruct.fields.find((f) => f.name === refName);
    if (!field) {
      throw new TagFieldEditorError(`Struct "${currentStruct.name}" has no field named "${refName}" (path "${fieldPath}").`);
    }
    if (field.def.type !== 'TagReflexive' || !field.def.struct) {
      throw new TagFieldEditorError(`Field "${refName}" in struct "${currentStruct.name}" is not a TagReflexive with a known child struct.`);
    }

    const ref = decodeValueField(buffer, currentBase + field.offset, field.def).value as DecodedReflexive;
    if (index < 0 || index >= ref.count || index >= MAX_REFLEXIVE_CHILDREN) {
      throw new TagFieldEditorError(`Reflexive index ${index} is out of range for "${refName}" (it has ${ref.count} element(s)).`);
    }

    let childStruct: ResolvedStruct;
    try {
      childStruct = resolveStruct(field.def.struct);
    } catch {
      throw new TagFieldEditorError(`TagReflexive "${refName}" targets an unknown child struct "${field.def.struct}".`);
    }

    const childBase = resolvePointer(ref.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(childBase, ref.count * childStruct.totalSize, buffer.length)) {
      throw new TagFieldEditorError(`Reflexive block "${refName}" (child struct "${childStruct.name}") is out of bounds of the map.`);
    }

    currentStruct = childStruct;
    currentBase = childBase + index * childStruct.totalSize;
  }

  throw new TagFieldEditorError(`Empty or invalid field path "${fieldPath}".`);
}

/**
 * Writes a single struct field value in-place into the in-memory map buffer. `fieldName` may be a
 * root-struct field name or a dotted reflexive path (see {@link resolveTargetField}); nested reflexive
 * fields are written exactly like root fields because the resolved absolute offset is what every
 * encoding branch below uses.
 */
export function writeTagFieldValue(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
  fieldName: string,
  newValue: unknown,
): { fieldName: string; newValue: unknown; fieldOffset: number } {
  const { structDef, rootFileOffset } = resolveTagRootOffset(buffer, header, tagIndex, tagEntryIndex);

  const { field, absOffset } = resolveTargetField(buffer, header, tagIndex, structDef, rootFileOffset, fieldName);

  if (field.def.type === 'TagReflexive' || field.def.type === 'TagDataOffset') {
    throw new TagFieldEditorError(`In-place editing of ${field.def.type} is not supported.`);
  }

  if (field.def.type === 'TagDependency') {
    let targetTagId: number = NULL_TAG_ID;
    if (typeof newValue === 'number') {
      targetTagId = newValue;
    } else if (typeof newValue === 'object' && newValue !== null && 'tagId' in newValue) {
      targetTagId = (newValue as { tagId: number }).tagId;
    } else if (newValue === null || newValue === undefined || newValue === '') {
      targetTagId = NULL_TAG_ID;
    } else {
      throw new TagFieldEditorError(`Invalid TagDependency value: ${JSON.stringify(newValue)}`);
    }

    if (targetTagId === NULL_TAG_ID || targetTagId === -1 || (targetTagId >>> 0) === NULL_TAG_ID) {
      encodeValueField(buffer, absOffset, {
        kind: 'dependency',
        value: { fourcc: NULL_TAG_ID, pathPointer: 0, pathSize: 0, tagId: NULL_TAG_ID },
      });
      return { fieldName, newValue: NULL_TAG_ID, fieldOffset: absOffset };
    }

    // Resolve target entry in map
    const targetEntry = tagIndex.entries.find((e) => e.tagId === targetTagId);
    if (!targetEntry) {
      throw new TagFieldEditorError(`Target tag ID 0x${targetTagId.toString(16)} not found in this map.`);
    }

    const tagHeaderSize = header.engine === 5 ? 0x24 : TAG_DATA_HEADER_PC_SIZE;
    const tagArrayFileOffset = header.tagDataOffset + tagHeaderSize;
    const pathPointer = buffer.readUInt32LE(tagArrayFileOffset + targetEntry.index * TAG_ENTRY_SIZE + 0x10);

    encodeValueField(buffer, absOffset, {
      kind: 'dependency',
      value: {
        fourcc: targetEntry.primaryClassFourCC,
        pathPointer,
        pathSize: 0,
        tagId: targetEntry.tagId,
      },
    });
    postprocessTagFields(buffer, header, tagIndex, tagEntryIndex, fieldName);

    return { fieldName, newValue: targetEntry.tagId, fieldOffset: absOffset };
  }

  const enumDef = getEnumDefinition(field.def.type);
  if (enumDef) {
    let intVal: number;
    if (typeof newValue === 'string') {
      const idx = enumDef.options.indexOf(newValue);
      if (idx === -1) {
        throw new TagFieldEditorError(`"${newValue}" is not a valid option for enum "${enumDef.name}".`);
      }
      intVal = idx;
    } else {
      intVal = Number(newValue);
      if (intVal < 0 || intVal >= enumDef.options.length) {
        throw new TagFieldEditorError(`Value ${intVal} is out of range for enum "${enumDef.name}".`);
      }
    }
    encodeValueField(buffer, absOffset, { kind: 'enum', value: intVal });
    return { fieldName, newValue: intVal, fieldOffset: absOffset };
  }

  const bitfieldDef = getBitfieldDefinition(field.def.type);
  if (bitfieldDef) {
    const bitVal = Number(newValue) >>> 0;
    encodeValueField(buffer, absOffset, { kind: 'bitfield', value: bitVal, width: bitfieldDef.width });
    return { fieldName, newValue: bitVal, fieldOffset: absOffset };
  }

  if (field.def.bounds) {
    if (!Array.isArray(newValue) || newValue.length !== 2) {
      throw new TagFieldEditorError(`Field "${fieldName}" expects a [from, to] bounds array.`);
    }
    const boundsVal: [number, number] = [Number(newValue[0]), Number(newValue[1])];
    encodeValueField(buffer, absOffset, { kind: 'bounds', type: field.def.type, value: boundsVal });
    postprocessTagFields(buffer, header, tagIndex, tagEntryIndex, fieldName);
    return { fieldName, newValue: boundsVal, fieldOffset: absOffset };
  }

  if (field.def.type === 'TagString') {
    const text = typeof newValue === 'string' ? newValue : String(newValue ?? '');
    encodeValueField(buffer, absOffset, { kind: 'basic', type: 'TagString', value: { text } });
    return { fieldName, newValue: text, fieldOffset: absOffset };
  }

  if (Array.isArray(newValue)) {
    encodeValueField(buffer, absOffset, {
      kind: field.def.count && field.def.count > 1 ? 'array' : 'basic',
      type: field.def.type,
      value: newValue.map(Number),
    });
    postprocessTagFields(buffer, header, tagIndex, tagEntryIndex, fieldName);
    return { fieldName, newValue, fieldOffset: absOffset };
  }

  // Basic numeric field
  const numVal = Number(newValue);
  if (Number.isNaN(numVal)) {
    throw new TagFieldEditorError(`Field "${fieldName}" expects a numeric value, got ${JSON.stringify(newValue)}`);
  }
  encodeValueField(buffer, absOffset, { kind: 'basic', type: field.def.type, value: numVal });
  postprocessTagFields(buffer, header, tagIndex, tagEntryIndex, fieldName);
  return { fieldName, newValue: numVal, fieldOffset: absOffset };
}

export interface AddReflexiveChunkResult {
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
  newElementIndex: number;
  newElementOffset: number;
  newCount: number;
}

/**
 * Appends a new element chunk to a TagReflexive array in the map buffer.
 * If `cloneFromIndex` is >= 0 and < oldCount, copies the existing element's fields;
 * otherwise zero-fills the new chunk. Allocates at the end of tag data and updates
 * the reflexive's count and pointer.
 */
export function addReflexiveChunk(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
  reflexiveFieldPath: string,
  cloneFromIndex: number = -1,
): AddReflexiveChunkResult {
  const { structDef, rootFileOffset } = resolveTagRootOffset(buffer, header, tagIndex, tagEntryIndex);
  const { field, absOffset: refFieldAbsOffset } = resolveTargetField(buffer, header, tagIndex, structDef, rootFileOffset, reflexiveFieldPath);

  if (field.def.type !== 'TagReflexive' || !field.def.struct) {
    throw new TagFieldEditorError(`Field "${reflexiveFieldPath}" is not a TagReflexive with a known child struct.`);
  }

  const childStruct = resolveStruct(field.def.struct);
  const elementSize = childStruct.totalSize;

  const oldCount = buffer.readUInt32LE(refFieldAbsOffset);
  const oldPointerLow = buffer.readUInt32LE(refFieldAbsOffset + 4);
  const newCount = oldCount + 1;

  const prePad = (4 - ((buffer.length - header.tagDataOffset) % 4)) % 4;
  const newArrayBytes = newCount * elementSize;
  const postPad = (4 - (newArrayBytes % 4)) % 4;
  const totalAlloc = prePad + newArrayBytes + postPad;

  const newArrayOffset = buffer.length + prePad;
  const newVirtualPointer = tagIndex.baseMemoryAddress + (newArrayOffset - header.tagDataOffset);

  const out = Buffer.alloc(buffer.length + totalAlloc);
  buffer.copy(out, 0, 0, buffer.length);

  // Copy existing elements if any
  let oldChildBase = 0;
  if (oldCount > 0 && oldPointerLow > 0) {
    oldChildBase = resolvePointer(oldPointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (isRangeInBuffer(oldChildBase, oldCount * elementSize, buffer.length)) {
      buffer.copy(out, newArrayOffset, oldChildBase, oldChildBase + oldCount * elementSize);
    }
  }

  const newElementOffset = newArrayOffset + oldCount * elementSize;
  if (cloneFromIndex >= 0 && cloneFromIndex < oldCount && oldChildBase > 0) {
    buffer.copy(out, newElementOffset, oldChildBase + cloneFromIndex * elementSize, oldChildBase + (cloneFromIndex + 1) * elementSize);
  } else {
    out.fill(0, newElementOffset, newElementOffset + elementSize);
    for (const cf of childStruct.fields) {
      if (cf.def.type === 'TagDependency') {
        out.writeUInt32LE(NULL_TAG_ID, newElementOffset + cf.offset + 0);
        out.writeUInt32LE(0, newElementOffset + cf.offset + 4);
        out.writeUInt32LE(0, newElementOffset + cf.offset + 8);
        out.writeUInt32LE(NULL_TAG_ID, newElementOffset + cf.offset + 12);
      } else if (cf.def.type === 'Index' && cf.name === 'name') {
        out.writeUInt16LE(0xffff, newElementOffset + cf.offset);
      }
    }
  }

  // Update reflexive header
  out.writeUInt32LE(newCount, refFieldAbsOffset);
  out.writeUInt32LE(newVirtualPointer, refFieldAbsOffset + 4);
  out.writeUInt32LE(0, refFieldAbsOffset + 8);

  // Update header file size & tag data size
  const newFileSize = out.length;
  const newTagDataSize = out.length - header.tagDataOffset;
  out.writeUInt32LE(newFileSize, 0x08);
  out.writeUInt32LE(newTagDataSize, 0x14);

  const newHeader: CacheFileHeader = {
    ...header,
    decompressedFileSize: newFileSize,
    tagDataSize: newTagDataSize,
  };

  const newTagIndex: TagIndex = {
    ...tagIndex,
  };

  return {
    buffer: out,
    header: newHeader,
    tagIndex: newTagIndex,
    newElementIndex: oldCount,
    newElementOffset,
    newCount,
  };
}

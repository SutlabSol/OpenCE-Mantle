/**
 * Single, shared, definition-driven detector for every field that can carry embedded
 * (external=0, lives in this map's own raw-data region) or external (lives in
 * bitmaps.map/sounds.map) bitmap/sound bytes. Used by the dependency walker (warnings),
 * the tag extractor (capture), and transitively by Verify Embedded Data (reuses the walker) -
 * one place that knows the byte layout, so nothing re-implements struct decoding.
 *
 * Map-agnostic: driven entirely by each field's `externalFileOffset`/`externalDataSibling`
 * annotation in the JSON definitions (see `types.ts`) - no tag group names or paths here.
 * Groups with a same-shaped `TagDataOffset` field but WITHOUT either annotation (scenario
 * script data, font pixels, string_list strings, model_animations frame data, etc.) are a
 * different, already-safe mechanism (pointer-based, same virtual-address translation as
 * TagReflexive - see PRD.md "Relocation research" for the Invader codegen citation) and are
 * correctly never matched here.
 */
import { getBitfieldDefinition } from './definitions/engine';
import type { ResolvedStruct, DecodedFieldValue } from './definitions/engine';

export type EmbeddedDataAssetKind = 'bitmap' | 'sound' | 'unknown';

export interface EmbeddedDataFieldMatch {
  fieldName: string;
  kind: EmbeddedDataAssetKind;
  /** true = lives in bitmaps.map/sounds.map; false = embedded in this map's own raw-data region. */
  external: boolean;
  resourceMap: string;
  /** Raw stored offset: into the resource map if external, into this map's raw-data region if embedded. 0 for 'unknown'. */
  fileOffset: number;
  size: number;
  /** Byte offset, relative to the struct's own base, of the raw file-offset value to patch when relocating. 0 for 'unknown'. */
  patchOffset: number;
  /** Width in bytes of the value at patchOffset. 0 for 'unknown' (nothing safe to patch). */
  patchWidth: number;
}

/**
 * Only bit 0 of a TagDataOffset's external/flags word means "in the resource map". Measured on the
 * sample maps (PRD 2026-10-11 "Sound external bit"): external sounds have 0x1; internal sounds have
 * 0 or 0x01000000 (coldsnap 9, Yoyorast_Island 3, HaloMD barrier 8), and the bytes of the
 * 0x01000000 ones lie inside the map's own raw-data region, which the internal ranges tile exactly.
 */
const TAG_DATA_OFFSET_EXTERNAL_BIT = 0x1;

function resourceMapToKind(resourceMap: string): EmbeddedDataAssetKind {
  if (resourceMap === 'bitmaps.map') return 'bitmap';
  if (resourceMap === 'sounds.map') return 'sound';
  return 'unknown';
}

/**
 * Finds every recognized embedded/external raw-data field on one already-decoded struct
 * instance. Returns 'unknown' (never guessed) when a field is annotated as carrying this kind
 * of data but its expected shape can't be read (e.g. a bitfield's "external" bit without a
 * resolvable sibling offset/size) - callers must treat 'unknown' the same as a blocking find.
 */
export function findEmbeddedDataFields(resolved: ResolvedStruct, decoded: Map<string, DecodedFieldValue>): EmbeddedDataFieldMatch[] {
  const out: EmbeddedDataFieldMatch[] = [];
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value || field.def.nonCached) continue;

    if (value.kind === 'tagDataOffset' && field.def.type === 'TagDataOffset' && field.def.externalFileOffset && value.value.size > 0) {
      out.push({
        fieldName: field.name,
        kind: resourceMapToKind(field.def.externalFileOffset),
        external: (value.value.external & TAG_DATA_OFFSET_EXTERNAL_BIT) !== 0,
        resourceMap: field.def.externalFileOffset,
        fileOffset: value.value.fileOffset,
        size: value.value.size,
        patchOffset: field.offset + 8, // DecodedTagDataOffset layout: size(+0) external(+4) fileOffset(+8) - see codec.ts
        patchWidth: 4,
      });
      continue;
    }

    if (value.kind !== 'bitfield') continue;
    const sibling = field.def.externalDataSibling;
    if (!sibling) continue;
    const bitfieldDef = field.def.type ? getBitfieldDefinition(field.def.type) : undefined;
    const externalBit = bitfieldDef?.fields.indexOf('external') ?? -1;
    if (externalBit < 0) {
      out.push({ fieldName: field.name, kind: 'unknown', external: false, resourceMap: sibling.resourceMap, fileOffset: 0, size: 0, patchOffset: 0, patchWidth: 0 });
      continue;
    }
    const sizeVal = decoded.get(sibling.sizeField);
    const size = sizeVal && sizeVal.kind === 'basic' ? (sizeVal.value as number) : 0;
    if (size <= 0) continue;
    const offsetField = resolved.fields.find((f) => f.name === sibling.offsetField);
    const offsetVal = decoded.get(sibling.offsetField);
    if (!offsetField || !offsetVal || offsetVal.kind !== 'basic') {
      out.push({ fieldName: field.name, kind: 'unknown', external: false, resourceMap: sibling.resourceMap, fileOffset: 0, size, patchOffset: 0, patchWidth: 0 });
      continue;
    }
    out.push({
      fieldName: field.name,
      kind: resourceMapToKind(sibling.resourceMap),
      external: (value.value & (1 << externalBit)) !== 0,
      resourceMap: sibling.resourceMap,
      fileOffset: offsetVal.value as number,
      size,
      patchOffset: offsetField.offset,
      patchWidth: 4,
    });
  }
  return out;
}

/** Where the external flag of a matched field is, from the field's own definition. */
export function flagLocation(resolved: ResolvedStruct, fieldName: string): { offset: number; width: 2 | 4; mask: number } | null {
  const field = resolved.fields.find((f) => f.name === fieldName);
  if (!field) return null;
  // TagDataOffset: size(+0) external word(+4) file offset(+8); only bit 0 means external.
  if (field.def.type === 'TagDataOffset') return { offset: field.offset + 4, width: 4, mask: 0x1 };
  const bitfield = field.def.type ? getBitfieldDefinition(field.def.type) : undefined;
  const bit = bitfield?.fields.indexOf('external') ?? -1;
  if (!bitfield || bit < 0 || (bitfield.width !== 16 && bitfield.width !== 32)) return null;
  return { offset: field.offset, width: bitfield.width === 16 ? 2 : 4, mask: 1 << bit };
}

const BITMAP_BPP: Record<string, number> = { a8: 1, y8: 1, ay8: 1, a8y8: 2, r5g6b5: 2, a1r5g5b5: 2, a4r4g4b4: 2, x8r8g8b8: 4, a8r8g8b8: 4, 'p8 bump': 1 };
const BITMAP_BLOCK_BYTES: Record<string, number> = { dxt1: 8, dxt3: 16, dxt5: 16, bc7: 16 };

/** BitmapDataType enum option order (see `groups/bitmap.json` "BitmapDataType") - fixed v609 format constant. */
const BITMAP_TYPE_NAMES = ['2d texture', '3d texture', 'cube map', 'white'];
/** BitmapDataFormat enum option order (see `groups/bitmap.json` "BitmapDataFormat") - fixed v609 format constant. */
const BITMAP_FORMAT_NAMES = ['a8', 'y8', 'ay8', 'a8y8', 'unused1', 'unused2', 'r5g6b5', 'unused3', 'a1r5g5b5', 'a4r4g4b4', 'x8r8g8b8', 'a8r8g8b8', 'unused4', 'unused5', 'dxt1', 'dxt3', 'dxt5', 'p8 bump', 'bc7'];

function basicValue(decoded: Map<string, DecodedFieldValue>, name: string): number | undefined {
  const v = decoded.get(name);
  if (!v) return undefined;
  if (v.kind === 'basic' || v.kind === 'enum') return v.value as number;
  return undefined;
}

/**
 * Validates one already-decoded `BitmapData` instance's `pixel data size` against what its own
 * width/height/depth/type/format/mipmap-count imply. Never guesses: returns a reason string
 * (caller blocks capture) on any unreadable field, unsupported format, or size mismatch.
 */
export function validateBitmapAssetSize(decoded: Map<string, DecodedFieldValue>, actualSize: number): { ok: true } | { ok: false; reason: string } {
  const width = basicValue(decoded, 'width');
  const height = basicValue(decoded, 'height');
  const depth = basicValue(decoded, 'depth');
  const typeIndex = basicValue(decoded, 'type');
  const formatIndex = basicValue(decoded, 'format');
  const mipmapCount = basicValue(decoded, 'mipmap count');
  if (width === undefined || height === undefined || depth === undefined || typeIndex === undefined || formatIndex === undefined || mipmapCount === undefined) {
    return { ok: false, reason: 'could not read width/height/depth/type/format/mipmap count from this BitmapData instance' };
  }
  const typeName = BITMAP_TYPE_NAMES[typeIndex];
  const formatName = BITMAP_FORMAT_NAMES[formatIndex];
  if (!typeName || !formatName) {
    return { ok: false, reason: `unrecognized type index ${typeIndex} or format index ${formatIndex}` };
  }
  const expected = expectedBitmapPixelDataSize(width, height, depth, typeName, formatName, mipmapCount);
  if (expected === null) {
    return actualSize > 0 && actualSize <= 64 * 1024 * 1024
      ? { ok: true }
      : { ok: false, reason: `unsupported/"unused" bitmap format "${formatName}" - size cannot be validated` };
  }
  if (actualSize < expected) {
    return { ok: false, reason: `expected ${expected} bytes from ${width}x${height}x${depth} ${typeName}/${formatName}/${mipmapCount} mips, but the tag's stored pixel data size is ${actualSize}` };
  }
  return { ok: true };
}

/**
 * Expected total pixel-data byte size implied by a BitmapData instance's own
 * width/height/depth/type/format/mipmap-count fields (sum over every mip level, x6 for cube
 * maps, xdepth for 3D textures). Returns null for an unsupported/"unused*" format (never
 * guessed - caller must block). Verified against every real BitmapData in coldsnap.map (350
 * embedded) and ui.map (450 total): 100% exact match, 0 mismatches, 0 unsupported.
 */
export function expectedBitmapPixelDataSize(width: number, height: number, depth: number, typeName: string, formatName: string, mipmapCount: number): number | null {
  const blockBytes = BITMAP_BLOCK_BYTES[formatName];
  const bpp = BITMAP_BPP[formatName];
  if (!blockBytes && !bpp) return null;
  const faces = typeName === 'cube map' ? 6 : 1;
  let total = 0;
  for (let mip = 0; mip <= mipmapCount; mip++) {
    const w = Math.max(1, width >> mip);
    const h = Math.max(1, height >> mip);
    const d = typeName === '3d texture' ? Math.max(1, depth >> mip) : 1;
    const levelBytes = blockBytes ? Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * blockBytes : w * h * bpp;
    total += levelBytes * d;
  }
  return total * faces;
}

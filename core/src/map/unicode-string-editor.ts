import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';
import { resolveTagDataPointer } from './tag-index';
import { resolvePointer, isRangeInBuffer } from './definitions/engine';

export class UnicodeStringEditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnicodeStringEditorError';
  }
}

export interface UnicodeStringItem {
  index: number;
  text: string;
  byteLength: number;
  allocatedBytes: number;
  maxChars: number;
  fileOffset: number;
  pointer: number;
}

export interface UnicodeStringListResult {
  tagIndex: number;
  tagId: number;
  tagPath: string;
  strings: UnicodeStringItem[];
  isExternal?: boolean;
  externalNote?: string;
}

/** Size in bytes of a single UnicodeStringListString reflexive element (contains 1 TagDataOffset = 20 B). */
const UNICODE_STRING_ELEMENT_SIZE = 20;

/**
 * Decodes all UTF-16LE strings in a `unicode_string_list` ('ustr') tag.
 */
export function readUnicodeStringList(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
): UnicodeStringListResult {
  const entry = tagIndex.entries[tagEntryIndex];
  if (!entry) {
    throw new UnicodeStringEditorError(`Tag #${tagEntryIndex} not found in map.`);
  }

  if (entry.primaryClassName !== 'unicode_string_list' && entry.primaryClassFourCC !== 0x75737472) {
    throw new UnicodeStringEditorError(`Tag #${tagEntryIndex} ("${entry.path}") is not a unicode_string_list tag.`);
  }

  if (entry.isExternal) {
    return {
      tagIndex: tagEntryIndex,
      tagId: entry.tagId,
      tagPath: entry.path,
      strings: [],
      isExternal: true,
      externalNote: 'Tag data is stored in external resource map (loc.map). In-place editing is only supported for map-embedded unicode string lists.',
    };
  }

  const rootOffset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(rootOffset, 12, buffer.length)) {
    throw new UnicodeStringEditorError(`Root struct offset 0x${rootOffset.toString(16)} is out of bounds.`);
  }

  // UnicodeStringList has 1 field: strings (TagReflexive, 12 bytes: count, pointerLow, pointerHigh)
  const count = buffer.readUInt32LE(rootOffset + 0);
  const pointerLow = buffer.readUInt32LE(rootOffset + 4);

  if (count === 0) {
    return {
      tagIndex: tagEntryIndex,
      tagId: entry.tagId,
      tagPath: entry.path,
      strings: [],
    };
  }

  const reflexiveBase = resolvePointer(pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
  const totalReflexiveSize = count * UNICODE_STRING_ELEMENT_SIZE;
  if (!isRangeInBuffer(reflexiveBase, totalReflexiveSize, buffer.length)) {
    throw new UnicodeStringEditorError(
      `Reflexive block (${count} items at 0x${reflexiveBase.toString(16)}) is out of bounds.`,
    );
  }

  const strings: UnicodeStringItem[] = [];

  for (let i = 0; i < count; i++) {
    const elOffset = reflexiveBase + i * UNICODE_STRING_ELEMENT_SIZE;
    const size = buffer.readUInt32LE(elOffset + 0);
    const strPointerLow = buffer.readUInt32LE(elOffset + 12);

    if (size === 0 || strPointerLow === 0) {
      strings.push({
        index: i,
        text: '',
        byteLength: 0,
        allocatedBytes: size,
        maxChars: Math.floor(size / 2),
        fileOffset: 0,
        pointer: strPointerLow,
      });
      continue;
    }

    const strFileOffset = resolveTagDataPointer(strPointerLow, header, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(strFileOffset, size, buffer.length)) {
      strings.push({
        index: i,
        text: '[Out of bounds]',
        byteLength: size,
        allocatedBytes: size,
        maxChars: Math.floor(size / 2),
        fileOffset: strFileOffset,
        pointer: strPointerLow,
      });
      continue;
    }

    const rawStr = buffer.toString('utf16le', strFileOffset, strFileOffset + size);
    // Strip trailing null characters for clean editing in UI
    const text = rawStr.replace(/\0+$/, '');

    strings.push({
      index: i,
      text,
      byteLength: size,
      allocatedBytes: size,
      maxChars: Math.floor(size / 2),
      fileOffset: strFileOffset,
      pointer: strPointerLow,
    });
  }

  return {
    tagIndex: tagEntryIndex,
    tagId: entry.tagId,
    tagPath: entry.path,
    strings,
  };
}

/**
 * Writes a UTF-16LE string in-place into an existing `unicode_string_list` entry.
 */
export function writeUnicodeString(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
  stringIndex: number,
  newText: string,
): { ok: boolean; newText: string; bytesWritten: number } {
  const list = readUnicodeStringList(buffer, header, tagIndex, tagEntryIndex);
  const target = list.strings[stringIndex];
  if (!target) {
    throw new UnicodeStringEditorError(`String index #${stringIndex} out of bounds (tag has ${list.strings.length} strings).`);
  }

  // Include 1 null character (2 bytes) if allocatedBytes allows, or match exactly
  const encodedTextBytes = Buffer.byteLength(newText, 'utf16le');
  if (encodedTextBytes > target.allocatedBytes) {
    throw new UnicodeStringEditorError(
      `New string is ${newText.length} characters (${encodedTextBytes} bytes), which exceeds the allocated capacity of ${target.allocatedBytes} bytes (${target.maxChars} chars).`,
    );
  }

  if (target.fileOffset <= 0 || !isRangeInBuffer(target.fileOffset, target.allocatedBytes, buffer.length)) {
    throw new UnicodeStringEditorError(`String buffer offset 0x${target.fileOffset.toString(16)} is invalid.`);
  }

  // Write new string
  buffer.write(newText, target.fileOffset, 'utf16le');

  // Null pad remainder
  const nullStart = target.fileOffset + encodedTextBytes;
  const paddingBytes = target.allocatedBytes - encodedTextBytes;
  if (paddingBytes > 0) {
    buffer.fill(0, nullStart, target.fileOffset + target.allocatedBytes);
  }

  return {
    ok: true,
    newText,
    bytesWritten: encodedTextBytes,
  };
}

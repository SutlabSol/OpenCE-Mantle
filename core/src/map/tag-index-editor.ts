import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';
import { resolveTagDataPointer } from './tag-index';
import { extractTagSet } from './tag-extractor';
import { planAddInjection, applyInjectionWithReport, normalizeTagPath, computeNewTagId } from './tag-injector';
import {
  OCETAGS_MAGIC,
  OCETAGS_FORMAT_VERSION,
  type OceContainer,
  type OceContainerTag,
} from './container';
import { TAG_ENTRY_SIZE, TAG_DATA_HEADER_PC_SIZE } from '../constants/cache-file';

export class TagIndexEditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagIndexEditorError';
  }
}

/**
 * Renames a tag's file path in the open map buffer.
 *
 * If the new path fits within the existing null-terminated string capacity, it is written in-place.
 * If longer, the path is appended to the end of the tag data section, header sizes updated,
 * and the tag index entry's path pointer rewritten.
 */
export function renameTagInMap(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
  newPath: string,
): { buffer: Buffer; path: string } {
  const entry = tagIndex.entries[tagEntryIndex];
  if (!entry) {
    throw new TagIndexEditorError(`Tag #${tagEntryIndex} not found in map.`);
  }

  const cleanPath = newPath.trim().replace(/\//g, '\\');
  if (!cleanPath) {
    throw new TagIndexEditorError('Tag path cannot be empty.');
  }

  const normalizedNew = normalizeTagPath(cleanPath);
  const exists = tagIndex.entries.some(
    (e, idx) => idx !== tagEntryIndex && normalizeTagPath(e.path) === normalizedNew && e.primaryClassName === entry.primaryClassName,
  );
  if (exists) {
    throw new TagIndexEditorError(`A tag with path "${cleanPath}" and class "${entry.primaryClassName}" already exists.`);
  }

  const tagArrayFileOffset = header.tagDataOffset + TAG_DATA_HEADER_PC_SIZE;
  const entryOffset = tagArrayFileOffset + tagEntryIndex * TAG_ENTRY_SIZE;
  const pathPointer = buffer.readUInt32LE(entryOffset + 0x10);
  const pathFileOffset = resolveTagDataPointer(pathPointer, header, tagIndex.baseMemoryAddress);

  const oldPathLength = entry.path.length;
  if (cleanPath.length <= oldPathLength) {
    // In-place replacement
    buffer.write(cleanPath, pathFileOffset, 'ascii');
    buffer.fill(0, pathFileOffset + cleanPath.length, pathFileOffset + oldPathLength + 1);
    entry.path = cleanPath;
    return { buffer, path: cleanPath };
  }

  // Path is longer: append at the end of the map buffer
  const newPathBytes = Buffer.from(cleanPath + '\0', 'ascii');
  const pad = (4 - (newPathBytes.length % 4)) % 4;
  const paddedBytes = pad > 0 ? Buffer.concat([newPathBytes, Buffer.alloc(pad, 0)]) : newPathBytes;

  const newOffset = buffer.length;
  const outBuffer = Buffer.concat([buffer, paddedBytes]);

  // Update header fileLength (0x08) and tagDataSize (0x14)
  outBuffer.writeUInt32LE(outBuffer.length, 0x08);
  outBuffer.writeUInt32LE(header.tagDataSize + paddedBytes.length, 0x14);

  // Update tag index entry path pointer
  const newPathPointer = (tagIndex.baseMemoryAddress + (newOffset - header.tagDataOffset)) >>> 0;
  outBuffer.writeUInt32LE(newPathPointer, entryOffset + 0x10);

  entry.path = cleanPath;
  return { buffer: outBuffer, path: cleanPath };
}

/**
 * Duplicates a tag in the map tag index, copying its struct data, allocating a new tag ID
 * using the Eschaton/Halo CE convention `0xE1740000 + n * 0x10001` (`computeNewTagId`),
 * and shifting pointers safely through the verified injector pipeline.
 */
export function duplicateTagInMap(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  sourceTagEntryIndex: number,
  newPath: string,
): { buffer: Buffer; newTagIndex: number; newTagId: number; path: string } {
  const sourceEntry = tagIndex.entries[sourceTagEntryIndex];
  if (!sourceEntry) {
    throw new TagIndexEditorError(`Source tag #${sourceTagEntryIndex} not found in map.`);
  }

  const cleanPath = newPath.trim().replace(/\//g, '\\');
  if (!cleanPath) {
    throw new TagIndexEditorError('New tag path cannot be empty.');
  }

  const normalizedNew = normalizeTagPath(cleanPath);
  const exists = tagIndex.entries.some(
    (e) => normalizeTagPath(e.path) === normalizedNew && e.primaryClassName === sourceEntry.primaryClassName,
  );
  if (exists) {
    throw new TagIndexEditorError(`A tag with path "${cleanPath}" and class "${sourceEntry.primaryClassName}" already exists.`);
  }

  // Extract the source tag and its closure
  const extractedSet = extractTagSet(buffer, header, tagIndex, [sourceTagEntryIndex]);
  const rootExtracted = extractedSet.tags.find((t) => t.originalIndex === sourceTagEntryIndex);
  if (!rootExtracted) {
    throw new TagIndexEditorError(`Failed to extract source tag "${sourceEntry.path}".`);
  }

  const oldRootPath = rootExtracted.path;
  const containerTags: OceContainerTag[] = extractedSet.tags.map((t) => {
    const isRoot = t.originalIndex === sourceTagEntryIndex;
    return {
      originalIndex: t.originalIndex,
      group: t.group,
      path: isRoot ? cleanPath : t.path,
      structName: t.structName,
      data: t.data.toString('base64'),
      dependencies: t.dependencies.map((d) => {
        if (isRoot && d.fieldPath.startsWith(oldRootPath)) {
          return {
            ...d,
            fieldPath: cleanPath + d.fieldPath.slice(oldRootPath.length),
          };
        }
        return d;
      }),
      secondaryClassFourCC: t.secondaryClassFourCC,
      tertiaryClassFourCC: t.tertiaryClassFourCC,
      embeddedRawDataAssets: t.embeddedRawDataAssets.map((a) => ({ kind: a.kind, data: a.data.toString('base64') })),
      embeddedRawDataPatches: t.embeddedRawDataPatches.map((p) => ({ ...p })),
      injectionBlockers: t.injectionBlockers.map((b) => ({ ...b })),
      gbxmodelGeometryParts: t.gbxmodelGeometryParts?.map((p) => ({
        geometryIndex: p.geometryIndex,
        partIndex: p.partIndex,
        vertexType: p.vertexType,
        vertexCount: p.vertexCount,
        vertexData: p.vertexBytes.toString('base64'),
        triangleBufferType: p.triangleBufferType,
        triangleCount: p.triangleCount,
        triangleData: p.triangleBytes.toString('base64'),
      })),
    };
  });

  const container: OceContainer = {
    magic: OCETAGS_MAGIC,
    formatVersion: OCETAGS_FORMAT_VERSION,
    sourceMapName: header.scenarioName,
    createdAt: new Date().toISOString(),
    hasUnresolvedBspReferences: false,
    rootOriginalIndices: [sourceTagEntryIndex],
    tags: containerTags,
    notExtracted: [],
    warnings: [],
    resourceMapIdentities: {},
    externalResourceRefs: [],
    externalData: 'referenced',
  };

  const plan = planAddInjection(
    { buffer, header, tagIndex },
    container,
    {},
    { allowEmbeddedRelocation: true },
  );

  if (plan.kind === 'refused') {
    throw new TagIndexEditorError(`Cannot duplicate tag: ${plan.reason}`);
  }

  if (plan.toAdd.length === 0) {
    const blockers = [...plan.blockedOther, ...plan.blockedEmbedded];
    const reasons = blockers.map((b) => `${b.path}: ${b.reasons.join('; ')}`).join('\n');
    throw new TagIndexEditorError(`Cannot duplicate tag: no tags were planned for addition. Reasons:\n${reasons}`);
  }

  const report = applyInjectionWithReport(
    buffer,
    header,
    tagIndex,
    container,
    plan,
    { allowEmbeddedRelocation: true },
  );

  const rootLocalIndex = containerTags.findIndex((t) => t.originalIndex === sourceTagEntryIndex);
  const newTagId = plan.resolvedTagIdByLocalIndex.get(rootLocalIndex) ?? computeNewTagId(tagIndex.entries.length);
  const newTagIndex = tagIndex.entries.length;

  return {
    buffer: report.buffer,
    newTagIndex,
    newTagId,
    path: cleanPath,
  };
}

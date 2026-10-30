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
import { NULL_TAG_ID } from '../constants/tag-classes';
import { globalReplaceTagReference } from './tag-scanner-gametype';
import { extractScenarioPlacements, deleteScenarioPlacement } from '../render/scenario-objects';

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

  const tagHeaderSize = header.engine === 5 ? 0x24 : TAG_DATA_HEADER_PC_SIZE;
  const tagArrayFileOffset = header.tagDataOffset + tagHeaderSize;
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
  outBuffer.writeUInt32LE((outBuffer.length - header.tagDataOffset) >>> 0, 0x14);

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

  // Special case for scenario_structure_bsp ('sbsp', 0x73627370): its struct resides in the BSP region (via ScenarioBSP),
  // so we allocate a new TagEntry slot via a 64B Wind placeholder and convert the new TagEntry to 'sbsp' with pointer 0.
  if (sourceEntry.primaryClassFourCC === 0x73627370 || sourceEntry.primaryClassName === 'scenario_structure_bsp') {
    const sbspContainer: OceContainer = {
      magic: OCETAGS_MAGIC,
      formatVersion: OCETAGS_FORMAT_VERSION,
      sourceMapName: header.scenarioName,
      createdAt: new Date().toISOString(),
      hasUnresolvedBspReferences: false,
      rootOriginalIndices: [sourceTagEntryIndex],
      tags: [
        {
          originalIndex: sourceTagEntryIndex,
          group: 'wind',
          path: cleanPath,
          structName: 'Wind',
          data: Buffer.alloc(64, 0).toString('base64'),
          dependencies: [],
          secondaryClassFourCC: 0xffffffff,
          tertiaryClassFourCC: 0xffffffff,
          embeddedRawDataAssets: [],
          embeddedRawDataPatches: [],
          injectionBlockers: [],
        },
      ],
      notExtracted: [],
      warnings: [],
      resourceMapIdentities: {},
      externalResourceRefs: [],
      externalData: 'referenced',
    };
    const sbspPlan = planAddInjection({ buffer, header, tagIndex }, sbspContainer, {}, { allowEmbeddedRelocation: true });
    if (sbspPlan.kind === 'refused') {
      throw new TagIndexEditorError(`Cannot allocate sbsp tag entry: ${sbspPlan.reason}`);
    }
    const sbspReport = applyInjectionWithReport(buffer, header, tagIndex, sbspContainer, sbspPlan, {
      allowEmbeddedRelocation: true,
    });
    const newSbspTagId = sbspPlan.resolvedTagIdByLocalIndex.get(0) ?? computeNewTagId(tagIndex.entries.length);
    const newSbspIdx = newSbspTagId & 0xffff;
    const curTagOff = sbspReport.buffer.readUInt32LE(0x10);
    const tagHeaderSize = header.engine === 5 ? 0x24 : 0x28;
    const slotEntryOff = curTagOff + tagHeaderSize + newSbspIdx * 32;
    if (slotEntryOff + 32 <= sbspReport.buffer.length) {
      sbspReport.buffer.writeUInt32LE(0x73627370, slotEntryOff + 0x00); // 'sbsp'
      sbspReport.buffer.writeUInt32LE(0xffffffff, slotEntryOff + 0x04);
      sbspReport.buffer.writeUInt32LE(0xffffffff, slotEntryOff + 0x08);
      sbspReport.buffer.writeUInt32LE(0, slotEntryOff + 0x14); // sbsp tagDataPointer = 0
    }
    return {
      buffer: sbspReport.buffer,
      newTagIndex: newSbspIdx,
      newTagId: newSbspTagId,
      path: cleanPath,
    };
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

/**
 * Safely deletes a tag from the map buffer by scrubbing all incoming TagDependency
 * references across the entire map to NULL_TAG_ID (0xFFFFFFFF) and tombstoning the
 * 32-byte tag index entry in-place so no other tag's index or salt shifts.
 */
export function deleteTagInMap(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
): { buffer: Buffer; deletedPath: string; deletedGroup: string; scrubbedReferencesCount: number } {
  const entry = tagIndex.entries[tagEntryIndex];
  if (!entry || entry.tagId === NULL_TAG_ID || entry.primaryClassFourCC === 0xffffffff || entry.path.startsWith('~')) {
    throw new TagIndexEditorError(`Tag #${tagEntryIndex} not found or already deleted.`);
  }

  const groupName = entry.primaryClassName ?? 'unknown';
  if (groupName === 'scenario' || groupName === 'scenario_structure_bsp') {
    throw new TagIndexEditorError(`Cannot delete root "${groupName}" tag ("${entry.path}") because the map cannot load without it.`);
  }

  const deletedPath = entry.path;
  let workingBuf = Buffer.from(buffer);

  // Step 0: Remove any Scenario 3D placements referencing this tag (e.g. scenery, vehicles, bipeds, weapons, equipment)
  // in descending index order so no placement is left pointing at a nulled-out palette slot
  try {
    const placements = extractScenarioPlacements(workingBuf, header, tagIndex);
    const matchingPlacements = placements.objects
      .filter((o) => o.objectTagId === entry.tagId || o.resolvedItemTagId === entry.tagId || o.modelTagId === entry.tagId)
      .sort((a, b) => {
        const idxA = parseInt(a.id.split('-')[1] ?? '0', 10);
        const idxB = parseInt(b.id.split('-')[1] ?? '0', 10);
        return idxB - idxA;
      });
    for (const p of matchingPlacements) {
      deleteScenarioPlacement(workingBuf, header, tagIndex, p.id);
    }
  } catch {
    // Ignore if scenario placements cannot be parsed
  }

  // Step 1: Scrub all incoming TagDependency and PredictedResource references across all tags in the map to NULL_TAG_ID (0xFFFFFFFF)
  const scrubRes = globalReplaceTagReference(workingBuf, entry.tagId, NULL_TAG_ID);
  let out: Buffer = Buffer.from(scrubRes.buffer);

  // Step 2: Convert the 32-byte Tag Index Entry in-place into an inert 64-byte 'wind' tag with preserved tagId
  // so OpenCE's cache loader validation `(tag_handle & 0xFFFF) == index` and pointer checks pass 100% cleanly
  const tagHeaderSize = header.engine === 5 ? 0x24 : TAG_DATA_HEADER_PC_SIZE;
  const tagArrayFileOffset = header.tagDataOffset + tagHeaderSize;
  const entryOffset = tagArrayFileOffset + tagEntryIndex * TAG_ENTRY_SIZE;
  const pathPointer = out.readUInt32LE(entryOffset + 0x10);
  try {
    const pathFileOffset = resolveTagDataPointer(pathPointer, header, tagIndex.baseMemoryAddress);
    if (pathFileOffset >= 0 && pathFileOffset + deletedPath.length + 1 <= out.length) {
      out.fill(0, pathFileOffset, pathFileOffset + deletedPath.length + 1);
      out.writeUInt8(0x7e, pathFileOffset); // '~' tombstone marker (valid non-empty string inside tag data)
    }
  } catch {
    // Ignore if path pointer was external or invalid
  }

  // Allocate 64 zero bytes at end of tag data for inert 'wind' (0x77696e64) struct
  const padBytes = (4 - ((out.length - header.tagDataOffset) % 4)) % 4;
  const windFileOff = out.length + padBytes;
  const windMemPtr = (tagIndex.baseMemoryAddress + (windFileOff - header.tagDataOffset)) >>> 0;
  out = Buffer.concat([out, Buffer.alloc(padBytes + 64, 0)]);
  out.writeUInt32LE(out.length >>> 0, 0x08);
  out.writeUInt32LE((out.length - header.tagDataOffset) >>> 0, 0x14);

  out.writeUInt32LE(0x77696e64, entryOffset + 0x00); // primaryClassFourCC = 'wind' (64B pure floats, 0 deps/reflexives)
  out.writeUInt32LE(0xffffffff, entryOffset + 0x04); // secondaryClassFourCC = NONE
  out.writeUInt32LE(0xffffffff, entryOffset + 0x08); // tertiaryClassFourCC = NONE
  out.writeUInt32LE(entry.tagId >>> 0, entryOffset + 0x0c); // Preserve tagId so (tag_handle & 0xFFFF) === tagEntryIndex!
  out.writeUInt32LE(windMemPtr, entryOffset + 0x14); // Valid pointer to 64 zero bytes inside tag data
  out.writeUInt32LE(0, entryOffset + 0x18); // isExternal = 0

  return {
    buffer: out,
    deletedPath,
    deletedGroup: groupName,
    scrubbedReferencesCount: scrubRes.replacedCount,
  };
}

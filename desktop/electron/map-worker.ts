import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  inspectCustomEditionMap,
  compressCustomEditionMap,
  decompressCustomEditionMap,
  ensureXboxMapDecompressed,
  estimateTagFootprints,
  walkDependencies,
  extractTagSet,
  serializeContainer,
  deserializeContainer,
  planAddInjection,
  planSwapInjection,
  applyAddInjection,
  applySwapInjection,
  hydrateExternalRawDataInContainer,
  autoLinkExternalResourceMapsInContainer,
  reclaimOrphanedScriptSyntaxBlocks,
  computeResourceMapIdentity,
  getGroupDefinition,
  validateAllDefinitions,
  verifyEmbeddedData,
  formatEmbeddedDataReport,
  classifyMapLayout,
  describeUnsupportedLayout,
  isConvertibleRetailLayout,
  preflightRetailConversion,
  convertRetailToCustomEdition,
  preflightDemoConversion,
  convertDemoToCustomEdition,
  ConversionRefusedError,
  AllTagsExcludedError,
  OperationCancelledError,
  ContainerFormatError,
  getAllTagGroupNames,
  OCETAGS_FORMAT_VERSION,
  readTagFieldValues,
  writeTagFieldValue,
  addReflexiveChunk,
  ensureExternalTagInternalized,
  TagFieldEditorError,
  listTagDependencySlots,
  setTagDependencySlot,
  TagDependencySwapError,
  extractBspRenderMesh,
  updateBspVerticesInMap,
  decodeBitmapTagImage,
  resolveShaderBaseBitmapTagId,
  BITM_FOURCC,
  extractScenarioPlacements,
  extractModelRenderGeometry,
  updateModelVerticesInMap,
  updateScenarioPlacement,
  updateScenarioWorldBounds,
  type ScenarioWorldBounds,
  duplicateScenarioPlacement,
  addScenarioPlacement,
  swapScenarioPlacement,
  deleteScenarioPlacement,
  findReferencingTags,
  readUnicodeStringList,
  writeUnicodeString,
  UnicodeStringEditorError,
  renameTagInMap,
  duplicateTagInMap,
  deleteTagInMap,
  TagIndexEditorError,
  CacheFileEngine,
  bspSwapPreflight,
  performBspSwap,
  type BspSwapOptions,
  inspectBitmapTag,
  replaceBitmapImageData,
  encodeBitmapWithMipmaps,
  encodeRgbaToPng,
  decodePngToRgba,
  encodeToDds,
  BitmapFormat,
  inspectSoundTag,
  decodeSoundPermutationPcm,
  replaceSoundPermutationData,
  encodePcmToWav,
  decodeWavToPcm,
  encodeXboxAdpcmMono,
  encodeXboxAdpcmStereo,
  conformPcmToSoundTag,
  computeMouthDataEnvelope,
  SoundFormat,
  exportModelToObj,
  exportBspToObj,
  exportModelToGlb,
  exportBspToGlb,
  buildCustomObjectContainer,
  extractTemplateRigFromMap,
  resizeRgbaToPowerOfTwo,
  stripUvWireframeOverlayFromRgba,
  decodeDxt1,
  decodeDxt3,
  decodeDxt5,
  inspectMapProtectionAndIntegrity,
  deprotectAndRepairMap,
  spoofCacheCrc32,
  repairTruncatedBitmapMipmaps,
  repairCorruptedModelPartStrips,
  parseCacheFileHeader,
  parseTagIndex,
  decompileScenarioScripts,
  compileHaloScriptIntoScenario,
  ensureScenarioScriptEntities,
  extractCollisionModelGeometry,
  convertCollisionToGbxmodelInMap,
  convertSbspToSceneryInMap,
  convertObjectTagClassInMap,
  cleanOpenSauceYeloScenario,
  scanMapTagsForErrors,
  globalReplaceTagReference,
  globalReplaceTagFieldValue,
  convertJmsToObjText,
  convertColladaDaeToObjText,
  compileJmaIntoModelAnimationsTag,
  compileJmsMassPointsIntoPhysicsTag,
  decompileGbxmodelToJmsText,
  decompileModelAnimationsToJmaText,
  decompilePhysicsToJmsText,
  compileStringsIntoTag,
  inspectMeterTag,
  compileCanvasAtlasIntoFontTag,
  exportOpenCeModPackageFromMap,
  importLegacyTagsIntoMap,
  compareMaps,
  injectProceduralWorldIntoMapBsp,
  scaleObjectAndCoupledPhysicsInMap,
  inspectMapHudAndUiTargets,
  applyLiveHudEdit,
  applyLiveWeaponStatEdit,
  injectHudElementBitmap,
  inspectUiWidgetCanvas,
  updateUiWidgetPlacement,
  saveUnicodeStringListTable,
} from '../../core/src/index';
import { deployMccModPackage } from './mcc-deploy';
import type { CacheFileHeader, TagIndex, OceContainer, InjectionPlan, ResourceMapConfig, WalkerWarning, FinalizeResult, RandomAccessFile, ConversionResourceFiles, ResourceKind, ResourceMapIdentity } from '../../core/src/index';
import { writeFinalizedMap as writeFinalizedMapWith } from '../../core/src/map/write-map';
export { describeMapWriteError } from '../../core/src/map/write-map';
import type {
  LoadMapResult,
  WorkerRequest,
  DependencyWalkSummary,
  DependencyTagInfo,
  DependencyNotExtractedInfo,
  DependencyWarningInfo,
  GetDependenciesResult,
  ExtractTagsResult,
  PlanInjectResult,
  ApplyInjectResult,
  SaveMapResult,
  OpenMapSummary,
  InjectPlanSummary,
  InjectionMode,
  ResourceMapKind,
  VerifyEmbeddedDataResult,
  ConvertPreflightResult,
  ConvertMapResult,
  ConvertRepairChoice,
  BatchExtractMode,
  BatchExtractTagReport,
  BatchExtractSummary,
  BatchExtractResult,
  BatchExtractManifest,
  BatchExtractManifestFileEntry,
  BatchExtractManifestItem,
  GetTagFieldsResult,
  BuildCustomObjectRequest,
  BuildCustomObjectResult,
  UpdateTagFieldResult,
  AddReflexiveChunkResult,
  GetDependencySlotsResult,
  SetDependencySlotResult,
  GetBspRenderMeshResult,
  GetBitmapTextureResult,
  GetScenarioObjectsResult,
  GetModelRenderGeometryResult,
  ModelRenderGeometry,
  UpdateScenarioPlacementResult,
  DuplicateScenarioPlacementResult,
  AddScenarioPlacementResult,
  SwapScenarioPlacementResult,
  DeleteScenarioPlacementResult,
  ScenarioObjectKind,
  GetReferencingTagsResult,
  GetUnicodeStringsResult,
  SetUnicodeStringResult,
  RenameTagResult,
  DuplicateTagResult,
  DeleteTagResult,
  HaloBitmapVersion,
  Export3dResult,
  InspectDeprotectResult,
  DeprotectMapResult,
  SpoofMapCrc32Result,
} from './shared-types';
import {
  sanitizeMapName,
  sanitizeTagRelativePath,
  commitStagedFiles,
  discardStagedFiles,
  generateBatchReportText,
  writeManifestAndReport,
} from './batch-extract-fs';
import { isBackupFilePath, BACKUP_FILE_SAVE_MESSAGE } from './map-file-rules';

/**
 * Persistent, stateful worker (one per app session, started eagerly - see `worker-manager.ts`).
 * The open map's buffer/header/tagIndex is parsed once in `runInspect` and kept here; every
 * later request (`getDependencies`/`extractTags`) reuses it instead of re-reading/re-sending it.
 * Inject replaces the held map in memory (`modified`); only `saveMap` / `saveMapAs` write a map.
 * All file I/O lives here, not in `/core` - `/core` stays pure (no fs/worker_threads imports).
 */
export interface LoadedMap {
  filePath: string;
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
  /** In-memory changes not yet written by Save / Save As. */
  modified?: boolean;
  /** `filePath` on disk when it was opened or last saved; Save refuses when it differs (changed by something else). */
  diskStat?: { size: number; mtimeMs: number } | null;
}

/** File operations used to write maps; replaceable in tests to simulate a full disk or a locked file. */
const realMapFs = { writeFileSync: fs.writeFileSync, renameSync: fs.renameSync };
let mapFs = realMapFs;
export function __setMapFsForTest(ops: Partial<typeof realMapFs> | null): void {
  mapFs = ops ? { ...realMapFs, ...ops } : realMapFs;
}

let currentMap: LoadedMap | null = null;
let currentInject: { container: OceContainer; plan: InjectionPlan } | null = null;
const modelGeometryCache = new Map<string, ModelRenderGeometry>();
const cancelledRequests = new Set<string>();

type Sink = (msg: { type: string; requestId?: string; [key: string]: unknown }) => void;
let sink: Sink = (msg) => parentPort?.postMessage(msg);

/**
 * A resource map (bitmaps.map / sounds.map) opened read-only and read by offset - the worker's own
 * `RandomAccessFile` (core has no fs; see `core/scripts/convert-external.ts` for the same helper).
 * `null` when the path is not a file.
 */
function openResourceReadOnly(file: string): { file: RandomAccessFile; close: () => void } | null {
  if (!fs.existsSync(file)) return null;
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  return {
    file: {
      label: file,
      size,
      read(offset, length) {
        const buf = Buffer.alloc(length);
        let done = 0;
        while (done < length) {
          const n = fs.readSync(fd, buf, done, length - done, offset + done);
          if (n === 0) break;
          done += n;
        }
        return done === length ? buf : buf.subarray(0, done);
      },
    },
    close: () => fs.closeSync(fd),
  };
}

/** The supplied source-game resource maps, opened read-only (an unreadable path is left out). */
function openConversionResources(paths: Partial<Record<ResourceKind, string | undefined>>): { files: ConversionResourceFiles; close: () => void } {
  const handles: { file: RandomAccessFile; close: () => void }[] = [];
  const files: ConversionResourceFiles = {};
  for (const [kind, p] of Object.entries(paths) as [ResourceKind, string | undefined][]) {
    if (!p) continue;
    const h = openResourceReadOnly(p);
    if (h) {
      handles.push(h);
      files[kind] = h.file;
    }
  }
  return { files, close: () => handles.forEach((h) => h.close()) };
}

/** Test-only hook: redirect posted messages to a capture array instead of `parentPort` (which is null outside a real worker thread). */
export function __setSinkForTest(fn: Sink): void {
  sink = fn;
}
/** Test-only hook: inject an already-parsed map, skipping the real `inspect` file-read step. */
export function __setCurrentMapForTest(map: LoadedMap | null): void {
  currentMap = map;
}
/** Test-only hook: the map the worker holds now (after inject / save). */
export function __getCurrentMapForTest(): LoadedMap | null {
  return currentMap;
}
/** Test-only hook: mirrors what a real `{ type: 'cancel' }` message does. */
export function __cancelForTest(requestId: string): void {
  cancelledRequests.add(requestId);
}

function progress(requestId: string, stage: string, percent: number) {
  sink({ type: 'progress', requestId, stage, percent });
}
function sendResult(requestId: string, payload: unknown) {
  sink({ type: 'result', requestId, payload });
}
function sendError(requestId: string, code: string, message: string) {
  sink({ type: 'error', requestId, code, message });
}

function handleTaskError(requestId: string, err: unknown) {
  if (err instanceof OperationCancelledError) return sendError(requestId, 'CANCELLED', 'Cancelled by user.');
  if (err instanceof AllTagsExcludedError) return sendError(requestId, 'BSP_ONLY_SELECTION', err.message);
  sendError(requestId, 'UNEXPECTED_ERROR', err instanceof Error ? err.message : String(err));
}

/** Gives core's `walkDependencies`/`extractTagSet` a pollable AbortSignal tied to a 'cancel' message for this requestId. */
function makeCancelController(requestId: string): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const interval = setInterval(() => {
    if (cancelledRequests.has(requestId)) controller.abort();
  }, 150);
  return { signal: controller.signal, stop: () => clearInterval(interval) };
}

function sizeByIndex(header: CacheFileHeader, tagIndex: TagIndex): Map<number, number | null> {
  return new Map(estimateTagFootprints(header, tagIndex).map((f) => [f.tagIndex, f.estimatedSize]));
}

function toWarningInfo(w: WalkerWarning): DependencyWarningInfo {
  return { originalIndex: w.originalIndex, path: w.path, group: w.group, kind: w.kind, message: w.message };
}

function diskStatOf(filePath: string): { size: number; mtimeMs: number } {
  const s = fs.statSync(filePath);
  return { size: s.size, mtimeMs: s.mtimeMs };
}

/** What the renderer shows for the held map. `fileSizeOnDisk` is the in-memory size (what Save would write). */
export function summarizeOpenMap(map: LoadedMap): OpenMapSummary {
  const sizes = sizeByIndex(map.header, map.tagIndex);
  const engine = map.header.engine;
  let mapEdition: HaloBitmapVersion = 'ce';
  const fpLower = (map.filePath || '').toLowerCase();
  if (engine === CacheFileEngine.XBOX) {
    mapEdition = 'xbox';
  } else if (engine === CacheFileEngine.MCC_CEA || fpLower.includes('mcc')) {
    mapEdition = 'mcc';
  } else if (fpLower.includes('halomd')) {
    mapEdition = 'halomd';
  } else if (engine === 7) {
    mapEdition = 'pc';
  } else {
    try {
      const layout = classifyMapLayout(map.buffer);
      if (layout.kind === 'demo') {
        mapEdition = 'demo';
      } else if (layout.kind === 'mcc') {
        mapEdition = 'mcc';
      } else if (layout.kind === 'retail') {
        mapEdition = fpLower.includes('halomd') ? 'halomd' : 'pc';
      }
    } catch {
      // default to ce
    }
  }

  return {
    status: 'ok',
    filePath: map.filePath,
    modified: !!map.modified,
    header: {
      scenarioName: map.header.scenarioName,
      buildString: map.header.buildString,
      mapType: map.header.mapType,
      crc32: map.header.crc32,
      tagDataOffset: map.header.tagDataOffset,
      tagDataSize: map.header.tagDataSize,
      decompressedFileSize: map.header.decompressedFileSize,
      fileSizeOnDisk: map.buffer.length,
      tagCount: map.tagIndex.tagCount,
      engine,
      mapEdition,
    },
    tags: map.tagIndex.entries
      .filter((e) => e.tagId !== 0xffffffff && e.primaryClassFourCC !== 0xffffffff && !e.path.startsWith('~'))
      .map((e) => ({
        index: e.index,
        tagId: e.tagId,
        primaryClassName: e.primaryClassName ?? '?',
        path: e.path,
        isExternal: e.isExternal,
        estimatedSize: sizes.get(e.index) ?? null,
      })),
  };
}

/** Parses `buffer` as the new held map, or throws (the held map is then left as it was). */
function reparse(filePath: string, buffer: Buffer, modified: boolean, diskStat: LoadedMap['diskStat']): LoadedMap {
  modelGeometryCache.clear();
  const inspected = inspectCustomEditionMap(buffer);
  if (inspected.status !== 'ok') throw new Error(`The result could not be read back as a Custom Edition map (${inspected.status}).`);
  return { filePath, buffer, header: inspected.header, tagIndex: inspected.tagIndex, modified, diskStat };
}

export async function runInspect(task: { requestId: string; filePath: string }) {
  progress(task.requestId, 'Reading file', 10);
  const buffer = ensureXboxMapDecompressed(fs.readFileSync(task.filePath));
  const diskStat = diskStatOf(task.filePath);
  progress(task.requestId, 'Parsing header and tag index', 50);
  currentInject = null;
  modelGeometryCache.clear();

  // Demo maps and non-convertible retail maps are reported as unsupported (with Convert offered for demo).
  // Standard PC retail maps (convertible layout at 0x40440000) are opened and editable directly.
  const layout = classifyMapLayout(buffer);
  if (layout.kind === 'demo' || (layout.kind === 'retail' && !isConvertibleRetailLayout(layout))) {
    currentMap = null;
    progress(task.requestId, 'Done', 100);
    return sendResult(task.requestId, {
      status: 'unsupported',
      filePath: task.filePath,
      message: describeUnsupportedLayout(layout)!,
      layout: layout.kind,
      convertible: layout.kind === 'demo',
    } satisfies LoadMapResult);
  }

  const inspected = inspectCustomEditionMap(buffer);
  let payload: LoadMapResult;
  if (inspected.status === 'ok') {
    currentMap = { filePath: task.filePath, buffer, header: inspected.header, tagIndex: inspected.tagIndex, modified: false, diskStat };
    payload = summarizeOpenMap(currentMap);
  } else if (inspected.status === 'compressed') {
    // Nothing of a compressed map is held: it can't be edited, injected into or saved until decompressed.
    currentMap = null;
    payload = { status: 'compressed', filePath: task.filePath };
  } else {
    currentMap = null;
    payload = { status: 'unsupported', filePath: task.filePath, message: inspected.message };
  }
  progress(task.requestId, 'Done', 100);
  sendResult(task.requestId, payload);
}

async function runCompression(task: { requestId: string; type: 'compress' | 'decompress'; filePath: string; outputPath: string }) {
  progress(task.requestId, 'Reading file', 10);
  const buffer = fs.readFileSync(task.filePath);
  progress(task.requestId, task.type === 'decompress' ? 'Decompressing (zstd)' : 'Compressing (zstd level 19)', 35);
  const output = task.type === 'decompress' ? await decompressCustomEditionMap(buffer) : await compressCustomEditionMap(buffer, 19);
  progress(task.requestId, 'Writing output file', 85);
  fs.writeFileSync(task.outputPath, output);
  progress(task.requestId, 'Done', 100);
  sendResult(task.requestId, { outputPath: task.outputPath, originalSize: buffer.length, newSize: output.length });
}

export function runGetDependencies(task: { requestId: string; originalIndices: number[] }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  const cancelCtl = makeCancelController(task.requestId);
  try {
    const walk = walkDependencies(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.originalIndices, {
      signal: cancelCtl.signal,
      onProgress: (visited, queued) => progress(task.requestId, `Walking dependencies (${visited} visited, ${queued} queued)`, Math.min(95, 10 + visited)),
    });
    const sizes = sizeByIndex(currentMap.header, currentMap.tagIndex);

    const extractableTags: DependencyTagInfo[] = [];
    const notExtractedTags: DependencyNotExtractedInfo[] = [];
    for (const t of walk.tags) {
      const def = getGroupDefinition(t.group);
      if (def.extractable === false) {
        notExtractedTags.push({
          originalIndex: t.originalIndex,
          path: t.path,
          group: t.group,
          reason: def.notExtractableReason ?? `"${t.group}" tags are not extractable yet.`,
          requiredBy: t.requiredBy,
        });
      } else {
        extractableTags.push({ originalIndex: t.originalIndex, path: t.path, group: t.group, status: t.status, estimatedSize: sizes.get(t.originalIndex) ?? null, requiredBy: t.requiredBy });
      }
    }
    const externalTags: DependencyTagInfo[] = walk.externalTags.map((t) => ({ originalIndex: t.originalIndex, path: t.path, group: t.group, status: t.status, estimatedSize: null, requiredBy: t.requiredBy }));
    const totalEstimatedSize = extractableTags.reduce((sum, t) => sum + (t.estimatedSize ?? 0), 0);

    const summary: DependencyWalkSummary = {
      requestedOriginalIndices: task.originalIndices,
      extractableTags,
      notExtractedTags,
      externalTags,
      warnings: walk.warnings.map(toWarningInfo),
      totalEstimatedSize,
      allExcluded: extractableTags.length === 0 && notExtractedTags.length > 0,
    };
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, { ok: true, summary } satisfies GetDependenciesResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  } finally {
    cancelCtl.stop();
    cancelledRequests.delete(task.requestId);
  }
}

export function runExtractTags(task: {
  requestId: string;
  originalIndices: number[];
  outputPath: string;
  sourceMapName: string;
  resourceMapPaths?: Partial<Record<ResourceMapKind, string>>;
  itemName?: string;
  itemNames?: Record<number, string>;
  captureGbxmodelRawData?: boolean;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  const cancelCtl = makeCancelController(task.requestId);
  const tempPath = `${task.outputPath}.tmp-${randomUUID()}`;
  const pendingTemps: string[] = [];
  const resources = openConversionResources({
    bitmaps: task.resourceMapPaths?.bitmaps,
    sounds: task.resourceMapPaths?.sounds,
  });
  try {
    if (task.originalIndices.length === 1) {
      progress(task.requestId, 'Walking dependencies', 5);
      const set = extractTagSet(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.originalIndices, {
        signal: cancelCtl.signal,
        resourceFiles: resources.files,
        captureGbxmodelRawData: task.captureGbxmodelRawData,
        onProgress: (i, total) => progress(task.requestId, `Extracting tag ${i + 1} of ${total}`, 10 + Math.round((i / Math.max(1, total)) * 70)),
      });
      if (cancelledRequests.has(task.requestId)) throw new OperationCancelledError();

      progress(task.requestId, 'Writing container file', 90);
      const tagItemName = task.itemNames?.[task.originalIndices[0]] ?? task.itemName;
      const containerBuffer = serializeContainer(set, task.sourceMapName, {}, {
        itemName: tagItemName,
        displayName: tagItemName,
        itemNames: task.itemNames,
      });
      // Temp-file-then-rename so a crash/cancel/failure never leaves a partial file at outputPath.
      fs.writeFileSync(tempPath, containerBuffer);
      fs.renameSync(tempPath, task.outputPath);

      progress(task.requestId, 'Done', 100);
      sendResult(task.requestId, {
        ok: true,
        outputPath: task.outputPath,
        tagCount: set.tags.length,
        fileSizeBytes: containerBuffer.length,
        carriedOverWarnings: set.warnings.map(toWarningInfo),
      } satisfies ExtractTagsResult);
      return;
    }

    // Multiple selected tags: one self-contained <name>.<group>.ocetags per tag, all written into the chosen folder.
    const writtenFiles: string[] = [];
    let totalTags = 0;
    let totalBytes = 0;
    const allWarnings = new Array<ReturnType<typeof toWarningInfo>>();
    for (let i = 0; i < task.originalIndices.length; i++) {
      if (cancelledRequests.has(task.requestId)) throw new OperationCancelledError();
      const origIndex = task.originalIndices[i];
      const entry = currentMap.tagIndex.entries[origIndex];
      const leaf = (entry.path.split('\\').pop() ?? 'tag').replace(/[^a-z0-9_-]+/gi, '_') || 'tag';
      const filename = `${leaf}.${entry.primaryClassName ?? 'tag'}.ocetags`;
      const targetFile = path.join(task.outputPath, filename);
      progress(task.requestId, `Extracting ${i + 1} of ${task.originalIndices.length}: ${entry.path}`, Math.round((i / task.originalIndices.length) * 100));
      const set = extractTagSet(currentMap.buffer, currentMap.header, currentMap.tagIndex, [origIndex], {
        signal: cancelCtl.signal,
        resourceFiles: resources.files,
        captureGbxmodelRawData: task.captureGbxmodelRawData,
      });
      if (cancelledRequests.has(task.requestId)) throw new OperationCancelledError();
      const tagItemName = task.itemNames?.[origIndex] ?? task.itemName;
      const buf = serializeContainer(set, task.sourceMapName, {}, {
        itemName: tagItemName,
        displayName: tagItemName,
      });
      const tmp = `${targetFile}.tmp-${randomUUID()}`;
      pendingTemps.push(tmp);
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, targetFile);
      pendingTemps.pop();
      writtenFiles.push(targetFile);
      totalTags += set.tags.length;
      totalBytes += buf.length;
      allWarnings.push(...set.warnings.map(toWarningInfo));
    }
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, {
      ok: true,
      outputPath: task.outputPath,
      tagCount: totalTags,
      fileSizeBytes: totalBytes,
      carriedOverWarnings: allWarnings,
      outputFiles: writtenFiles,
    } satisfies ExtractTagsResult);
    return;
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      for (const p of pendingTemps) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch {
      /* best-effort cleanup only */
    }
    handleTaskError(task.requestId, err);
  } finally {
    resources.close();
    cancelCtl.stop();
    cancelledRequests.delete(task.requestId);
  }
}

export function runBatchExtract(task: {
  requestId: string;
  parentDir: string;
  sourceMapName: string;
  mode: BatchExtractMode;
  extractFormat?: 'ocetags' | 'data_source';
  resourceMapPaths: Partial<Record<ResourceMapKind, string>>;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');

  const cancelCtl = makeCancelController(task.requestId);
  const startTime = Date.now();
  const mapName = sanitizeMapName(task.sourceMapName || currentMap.filePath);
  const targetDir = path.join(task.parentDir, mapName);
  const stagingDir = path.join(targetDir, `.staging-${randomUUID()}`);

  const entries = currentMap.tagIndex.entries;
  const knownGroups = new Set(getAllTagGroupNames());

  const reports: BatchExtractTagReport[] = [];
  const manifestFiles: BatchExtractManifestFileEntry[] = [];
  const blockedManifest: BatchExtractManifestItem[] = [];
  const externalManifest: BatchExtractManifestItem[] = [];

  let extractedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let totalBytesWritten = 0;
  const batchResources = openConversionResources({
    bitmaps: task.resourceMapPaths?.bitmaps,
    sounds: task.resourceMapPaths?.sounds,
  });

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    // Resource map identities if configured
    const resourceMapIdentities: Partial<Record<'bitmaps' | 'sounds' | 'loc', ResourceMapIdentity>> = {};
    for (const kind of ['bitmaps', 'sounds', 'loc'] as ResourceMapKind[]) {
      const p = task.resourceMapPaths?.[kind];
      if (!p) continue;
      try {
        if (fs.existsSync(p)) {
          resourceMapIdentities[kind] = computeResourceMapIdentity(fs.readFileSync(p));
        }
      } catch {
        /* ignore unreadable */
      }
    }

    interface CandidateTag {
      index: number;
      entry: (typeof entries)[number];
      group: string;
      fullRelativePath: string;
      finalDest: string;
    }
    const candidates: CandidateTag[] = [];

    for (const entry of entries) {
      const group = entry.primaryClassName ?? 'unknown';

      if (entry.isExternal) {
        reports.push({
          path: entry.path,
          group,
          status: 'external',
          reason: 'Tag data lives in external resource map (bitmaps.map/sounds.map/loc.map).',
        });
        externalManifest.push({
          path: entry.path,
          group,
          reason: 'External resource map tag',
        });
        continue;
      }

      if (!knownGroups.has(group)) {
        const reason = `Unrecognized tag class "${group}" - no definition registered.`;
        reports.push({
          path: entry.path,
          group,
          status: 'blocked',
          reason,
        });
        blockedManifest.push({
          path: entry.path,
          group,
          reason,
        });
        continue;
      }

      const def = getGroupDefinition(group);
      if (def.extractable === false) {
        const reason = def.notExtractableReason ?? `"${group}" tags are not extractable yet.`;
        reports.push({
          path: entry.path,
          group,
          status: 'blocked',
          reason,
        });
        blockedManifest.push({
          path: entry.path,
          group,
          reason,
        });
        continue;
      }

      const { fullRelativePath } = sanitizeTagRelativePath(entry.path, group);
      const finalDest = path.join(targetDir, fullRelativePath);
      candidates.push({
        index: entry.index,
        entry,
        group,
        fullRelativePath,
        finalDest,
      });
    }

    const totalExtractable = candidates.length;

    for (let i = 0; i < candidates.length; i++) {
      if (cancelledRequests.has(task.requestId)) {
        throw new OperationCancelledError();
      }

      const candidate = candidates[i];
      const percent = totalExtractable > 0 ? Math.round((i / totalExtractable) * 100) : 100;
      progress(task.requestId, `Extracting ${i + 1} of ${totalExtractable}: ${candidate.entry.path}`, percent);

      // In skip mode, if target file already exists, skip it
      if (task.mode === 'skip' && fs.existsSync(candidate.finalDest)) {
        skippedCount++;
        reports.push({
          path: candidate.entry.path,
          group: candidate.group,
          status: 'skipped-existing',
          outputPath: candidate.finalDest,
        });
        continue;
      }

      try {
        if (task.extractFormat === 'data_source') {
          let outBuf: Buffer | null = null;
          let outExt = `.${candidate.group}.json`;
          const baseRelWithoutOcetags = candidate.fullRelativePath.replace(/\.ocetags$/i, '');

          if (candidate.group === 'gbxmodel' || candidate.group === 'model') {
            const jmsRes = decompileGbxmodelToJmsText(currentMap.buffer, candidate.index);
            outBuf = Buffer.from(jmsRes.jmsText, 'utf8');
            outExt = '.jms';
          } else if (candidate.group === 'model_animations') {
            const jmaRes = decompileModelAnimationsToJmaText(currentMap.buffer, candidate.index, 0);
            outBuf = Buffer.from(jmaRes.jmaText, 'utf8');
            outExt = '.jma';
          } else if (candidate.group === 'physics') {
            const physRes = decompilePhysicsToJmsText(currentMap.buffer, candidate.index);
            outBuf = Buffer.from(physRes.jmsText, 'utf8');
            outExt = '.physics.jms';
          } else if (candidate.group === 'bitmap') {
            const extBitmaps = getBitmapsBuffer(task.resourceMapPaths?.bitmaps);
            const decoded = decodeBitmapTagImage(
              currentMap.buffer,
              currentMap.header,
              currentMap.tagIndex,
              candidate.entry.tagId,
              0,
              extBitmaps,
            );
            if (decoded) {
              outBuf = encodeRgbaToPng(decoded.rgbaData, decoded.width, decoded.height);
              outExt = '.png';
            }
          } else if (candidate.group === 'sound') {
            const extSounds = getSoundsBuffer(task.resourceMapPaths?.sounds);
            const audio = decodeSoundPermutationPcm(
              currentMap.buffer,
              currentMap.header,
              currentMap.tagIndex,
              candidate.entry.tagId,
              0,
              0,
              extSounds,
            );
            outBuf = encodePcmToWav(audio.pcmSamples, audio.sampleRate, audio.channels);
            outExt = '.wav';
          } else if (candidate.group === 'unicode_string_list' || candidate.group === 'string_list') {
            const strList = readUnicodeStringList(
              currentMap.buffer,
              currentMap.header,
              currentMap.tagIndex,
              candidate.index,
            );
            const txt = strList.strings.map((s) => `${s.text}\r\n###END-STRING###`).join('\r\n');
            outBuf = Buffer.from(txt, 'utf8');
            outExt = '.txt';
          } else if (candidate.group === 'scenario') {
            const hscRes = decompileScenarioScripts(currentMap.buffer);
            outBuf = Buffer.from(hscRes.hscSource, 'utf8');
            outExt = '.hsc';
          }

          if (!outBuf) {
            const fields = readTagFieldValues(
              currentMap.buffer,
              currentMap.header,
              currentMap.tagIndex,
              candidate.index,
            );
            outBuf = Buffer.from(JSON.stringify(fields, null, 2), 'utf8');
            outExt = `.${candidate.group}.fields.json`;
          }

          const dataRelPath = path.join('data', `${baseRelWithoutOcetags}${outExt}`);
          const stagedDest = path.join(stagingDir, dataRelPath);
          const finalDataDest = path.join(targetDir, dataRelPath);
          fs.mkdirSync(path.dirname(stagedDest), { recursive: true });
          fs.writeFileSync(stagedDest, outBuf);

          extractedCount++;
          totalBytesWritten += outBuf.length;
          manifestFiles.push({
            path: candidate.entry.path,
            group: candidate.group,
            relativePath: dataRelPath,
            sizeBytes: outBuf.length,
            tagCount: 1,
          });
          reports.push({
            path: candidate.entry.path,
            group: candidate.group,
            status: 'extracted',
            outputPath: finalDataDest,
            sizeBytes: outBuf.length,
            tagCount: 1,
          });
          continue;
        }

        const set = extractTagSet(currentMap.buffer, currentMap.header, currentMap.tagIndex, [candidate.index], {
          signal: cancelCtl.signal,
          resourceFiles: batchResources.files,
        });

        if (cancelledRequests.has(task.requestId)) {
          throw new OperationCancelledError();
        }

        const buf = serializeContainer(set, task.sourceMapName, resourceMapIdentities);
        const stagedDest = path.join(stagingDir, candidate.fullRelativePath);
        fs.mkdirSync(path.dirname(stagedDest), { recursive: true });
        fs.writeFileSync(stagedDest, buf);

        extractedCount++;
        totalBytesWritten += buf.length;
        manifestFiles.push({
          path: candidate.entry.path,
          group: candidate.group,
          relativePath: candidate.fullRelativePath,
          sizeBytes: buf.length,
          tagCount: set.tags.length,
        });
        reports.push({
          path: candidate.entry.path,
          group: candidate.group,
          status: 'extracted',
          outputPath: candidate.finalDest,
          sizeBytes: buf.length,
          tagCount: set.tags.length,
          warnings: set.warnings.map(toWarningInfo),
        });
      } catch (err) {
        if (err instanceof OperationCancelledError) throw err;
        failedCount++;
        const msg = err instanceof Error ? err.message : String(err);
        reports.push({
          path: candidate.entry.path,
          group: candidate.group,
          status: 'failed',
          reason: msg,
        });
        blockedManifest.push({
          path: candidate.entry.path,
          group: candidate.group,
          reason: `Extraction failed: ${msg}`,
        });
      }
    }

    // Extraction completed without cancellation. Commit staging.
    progress(task.requestId, 'Committing extracted files', 98);
    commitStagedFiles(stagingDir, targetDir);

    const elapsedMs = Date.now() - startTime;
    const manifest: BatchExtractManifest = {
      manifestVersion: 1,
      toolVersion: '0.1.0',
      containerVersion: OCETAGS_FORMAT_VERSION,
      extractedAt: new Date().toISOString(),
      mapFileName: path.basename(currentMap.filePath),
      scenarioName: currentMap.header.scenarioName || path.basename(currentMap.filePath, '.map'),
      summary: {
        totalTagsInMap: entries.length,
        extractedCount,
        skippedExistingCount: skippedCount,
        externalCount: externalManifest.length,
        blockedCount: blockedManifest.length,
        failedCount,
        totalBytesWritten,
      },
      files: manifestFiles,
      blocked: blockedManifest,
      external: externalManifest,
    };

    const reportText = generateBatchReportText(manifest);
    const { manifestPath, reportPath } = writeManifestAndReport(targetDir, manifest, reportText);

    progress(task.requestId, 'Done', 100);

    const summary: BatchExtractSummary = {
      mapName,
      targetDir,
      totalTagsInMap: entries.length,
      extractedCount,
      skippedCount,
      blockedCount: blockedManifest.length,
      externalCount: externalManifest.length,
      failedCount,
      totalBytesWritten,
      elapsedMs,
      tags: reports,
      manifestPath,
      reportPath,
    };

    sendResult(task.requestId, { ok: true, summary } satisfies BatchExtractResult);
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      const elapsedMs = Date.now() - startTime;
      const partialSummary: BatchExtractSummary = {
        mapName,
        targetDir,
        totalTagsInMap: entries.length,
        extractedCount,
        skippedCount,
        blockedCount: blockedManifest.length,
        externalCount: externalManifest.length,
        failedCount,
        totalBytesWritten,
        elapsedMs,
        tags: reports,
        stagingDir,
      };
      sendResult(task.requestId, {
        ok: false,
        code: 'CANCELLED',
        message: 'Extraction was cancelled.',
        partialSummary,
        stagingDir,
        targetDir,
      } satisfies BatchExtractResult);
      return;
    }
    discardStagedFiles(stagingDir);
    handleTaskError(task.requestId, err);
  } finally {
    batchResources.close();
    cancelCtl.stop();
    cancelledRequests.delete(task.requestId);
  }
}

function summarizePlan(containerPath: string, container: OceContainer, plan: InjectionPlan): InjectPlanSummary {
  return {
    mode: plan.mode,
    containerPath,
    sourceMapName: container.sourceMapName,
    counts: plan.counts,
    toAdd: plan.toAdd.map((t) => ({ path: t.path, group: t.group })),
    toSwap: plan.toSwap.map((s) => ({ path: s.path, group: s.group })),
    reused: Array.from(plan.reusedByLocalIndex.keys()).map((li) => ({ path: container.tags[li].path, group: container.tags[li].group })),
    blockedEmbedded: plan.blockedEmbedded.map((b) => ({ path: b.path, group: b.group, reasons: b.reasons })),
    blockedOther: plan.blockedOther.map((b) => ({ path: b.path, group: b.group, reasons: b.reasons })),
    externalRefStatuses: plan.externalRefStatuses.map((r) => ({ path: r.path, group: container.tags[r.localIndex]?.group ?? '', resourceMap: r.resourceMap, status: r.status })),
    refusedRoots: plan.refusedRoots.map((r) => ({ path: r.path, reasons: r.reasons })),
    classConflicts: plan.classConflicts ?? [],
  };
}

export function runPlanInject(task: {
  requestId: string;
  containerPath: string;
  mode: InjectionMode;
  resourceMapPaths: Partial<Record<ResourceMapKind, string>>;
  fallbackPcResourcePaths?: Partial<Record<ResourceMapKind, string>>;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open to inject into.');
  try {
    progress(task.requestId, 'Reading container file', 10);
    const containerBuffer = fs.readFileSync(task.containerPath);
    const container = deserializeContainer(containerBuffer);

    // Automatically reclaim any orphaned 380,076-byte script syntax blocks in the target map before planning injection
    if (currentMap.header.engine === 609) {
      const compactedBuf = reclaimOrphanedScriptSyntaxBlocks(currentMap.buffer);
      if (compactedBuf.length < currentMap.buffer.length) {
        reloadCurrentMapFromBuffer(compactedBuf);
      }
    }

    // Auto-detect any bitmaps or sounds in the injected container that already exist in Custom Edition's
    // bitmaps.map / sounds.map so we link them as external resource tags (isExternal = 1) instead of internalizing them!
    if (currentMap.header.engine === 609) {
      const mapDir = path.dirname(currentMap.filePath);
      const findCeResourceFile = (kind: 'bitmaps' | 'sounds'): string | undefined => {
        const candidates = [
          task.resourceMapPaths?.[kind],
          path.join(mapDir, `${kind}.map`),
          path.resolve(mapDir, '..', `${kind}.map`),
          path.resolve(process.cwd(), 'sample_maps', `${kind}.map`),
          path.resolve(process.cwd(), '..', 'sample_maps', `${kind}.map`),
        ].filter((p): p is string => !!p && fs.existsSync(p));
        for (const cand of candidates) {
          try {
            const res = openConversionResources({ [kind]: cand });
            try {
              const file = res.files[kind];
              if (file) {
                const probe = Buffer.alloc(0);
                void probe;
                // Check if this resource map has Custom Edition `__pixels` / `__permutations` entry pairs
                const hdr = file.read(0, 16);
                const pathsOff = hdr.readUInt32LE(4);
                const tableOff = hdr.readUInt32LE(8);
                if (pathsOff >= 16 && tableOff > pathsOff && tableOff <= file.size) {
                  const samplePaths = file.read(pathsOff, Math.min(4096, tableOff - pathsOff)).toString('latin1');
                  if (samplePaths.includes('__pixels') || samplePaths.includes('__permutations')) {
                    return cand;
                  }
                }
              }
            } finally {
              res.close();
            }
          } catch {
            /* ignore unreadable candidate */
          }
        }
        return undefined;
      };
      const ceRes = openConversionResources({
        bitmaps: findCeResourceFile('bitmaps'),
        sounds: findCeResourceFile('sounds'),
      });
      try {
        autoLinkExternalResourceMapsInContainer(container, ceRes.files);
      } finally {
        ceRes.close();
      }
    }

    const hydrateRes = openConversionResources({
      bitmaps: task.fallbackPcResourcePaths?.bitmaps ?? task.resourceMapPaths?.bitmaps,
      sounds: task.fallbackPcResourcePaths?.sounds ?? task.resourceMapPaths?.sounds,
    });
    try {
      hydrateExternalRawDataInContainer(container, hydrateRes.files);
    } finally {
      hydrateRes.close();
    }

    progress(task.requestId, 'Checking configured resource maps', 40);
    const resourceMapConfig: ResourceMapConfig = {};
    for (const kind of ['bitmaps', 'sounds', 'loc'] as ResourceMapKind[]) {
      const p = task.resourceMapPaths[kind];
      if (!p) continue;
      try {
        resourceMapConfig[kind] = { identity: computeResourceMapIdentity(fs.readFileSync(p)) };
      } catch {
        /* unreadable/invalid configured resource map - treated as not configured for this plan */
      }
    }

    progress(task.requestId, 'Planning injection', 70);
    const planResult = task.mode === 'swap'
      ? planSwapInjection(currentMap, container, resourceMapConfig, { allowEmbeddedRelocation: true })
      : planAddInjection(currentMap, container, resourceMapConfig, { allowEmbeddedRelocation: true });
    if (planResult.kind === 'refused') {
      currentInject = null;
      return sendError(task.requestId, 'PLAN_REFUSED', planResult.reason);
    }
    currentInject = { container, plan: planResult };
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, { ok: true, plan: summarizePlan(task.containerPath, container, planResult) } satisfies PlanInjectResult);
  } catch (err) {
    currentInject = null;
    if (err instanceof ContainerFormatError) return sendError(task.requestId, 'CONTAINER_FORMAT_ERROR', err.message);
    handleTaskError(task.requestId, err);
  }
}

/** Shown after every map save: CRC32 and name are now written; the sub-header's tag-file checksum is not. */
export const TAG_FILE_CHECKSUM_WARNING =
  'The header checksum (CRC32) and the internal map name were updated. The separate tag-file checksum (tag data header +0x8) was not recalculated; whether the game checks it is unverified.';

/**
 * The one way a map leaves this worker: core's `writeFinalizedMap` (scenario name from the file
 * name, header CRC32, temp file in the same folder + rename; shared with the developer convert
 * script) with this worker's file operations. Throws a `WRITE_FAILED` error with a plain message
 * (temp file already removed) when writing fails.
 */
function writeFinalizedMap(map: Buffer, outputPath: string, stillOpenNote?: string): FinalizeResult {
  return writeFinalizedMapWith(map, outputPath, { writeFileSync: mapFs.writeFileSync, renameSync: mapFs.renameSync, removeIfExists: removeTempFile }, stillOpenNote);
}

function isOpenMapPath(outputPath: string): boolean {
  return !!currentMap && path.resolve(outputPath).toLowerCase() === path.resolve(currentMap.filePath).toLowerCase();
}

function removeTempFile(tempPath: string): void {
  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch {
    /* best-effort cleanup only */
  }
}

function sendWriteError(requestId: string, err: unknown) {
  const e = err as Error & { code?: string };
  if (e?.code === 'WRITE_FAILED') return sendError(requestId, 'WRITE_FAILED', e.message);
  handleTaskError(requestId, err);
}

/** After a successful write, `outputPath` becomes the open, unmodified map holding exactly the bytes written. */
function saved(requestId: string, outputPath: string, finalized: FinalizeResult) {
  currentMap = reparse(outputPath, finalized.buffer, false, diskStatOf(outputPath));
  progress(requestId, 'Done', 100);
  sendResult(requestId, {
    ok: true,
    outputPath,
    scenarioName: finalized.scenarioName,
    previousScenarioName: finalized.previousScenarioName,
    crc32: finalized.crc32,
    warnings: finalized.warnings,
    staleChecksumWarning: TAG_FILE_CHECKSUM_WARNING,
    map: summarizeOpenMap(currentMap),
  } satisfies SaveMapResult);
}

/**
 * File > Save: overwrites the open file - the one permitted overwrite of a source map (RULES.md).
 * Only while modified, never for a map opened from a .bak, and refused when the file on disk
 * changed (size or modified time) since it was opened or last saved.
 */
export function runSaveMap(task: { requestId: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  if (isBackupFilePath(currentMap.filePath)) return sendError(task.requestId, 'REFUSED_BACKUP_FILE', BACKUP_FILE_SAVE_MESSAGE);
  if (!currentMap.modified) return sendError(task.requestId, 'NOT_MODIFIED', 'There are no unsaved changes.');
  const target = currentMap.filePath;
  let onDisk: { size: number; mtimeMs: number } | null = null;
  try {
    onDisk = diskStatOf(target);
  } catch {
    /* missing - refused below */
  }
  const known = currentMap.diskStat;
  if (!onDisk || !known || onDisk.size !== known.size || onDisk.mtimeMs !== known.mtimeMs) {
    return sendError(
      task.requestId,
      'CHANGED_ON_DISK',
      `${path.basename(target)} ${onDisk ? 'was changed on disk by another program' : 'no longer exists on disk'} since it was opened, so Save will not overwrite it. Use File > Save As to keep your changes in a new file.`,
    );
  }
  try {
    progress(task.requestId, 'Writing map', 40);
    saved(task.requestId, target, writeFinalizedMap(currentMap.buffer, target));
  } catch (err) {
    sendWriteError(task.requestId, err);
  }
}

/** File > Save As: a new file (never the open one); afterwards it is the open map. */
export function runSaveMapAs(task: { requestId: string; outputPath: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  if (isOpenMapPath(task.outputPath)) return sendError(task.requestId, 'REFUSED_SOURCE_PATH', 'You cannot overwrite the open map with Save As. Use File > Save, or choose a different file name.');
  try {
    progress(task.requestId, 'Writing map', 40);
    saved(task.requestId, task.outputPath, writeFinalizedMap(currentMap.buffer, task.outputPath));
  } catch (err) {
    sendWriteError(task.requestId, err);
  }
}

/** Stages the current in-memory map to targetPath (e.g. custom_maps/_opence_tag_test.map) without altering the open map state. */
export function runStageTagTestMap(task: { requestId: string; targetPath: string; bitmapsPath?: string; soundsPath?: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    progress(task.requestId, 'Staging map for OpenCE Tag Test', 25);
    const target = task.targetPath;
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    let bufferCopy = Buffer.from(currentMap.buffer);

    if (currentMap.header.engine !== CacheFileEngine.CUSTOM_EDITION) {
      progress(task.requestId, 'Converting non-CE map to Custom Edition for OpenCE', 40);
      const mapDir = path.dirname(currentMap.filePath || '');
      const candidateRoots = [
        process.cwd(),
        path.resolve(process.cwd(), '..'),
        path.resolve(__dirname, '..'),
        path.resolve(__dirname, '../..'),
        'C:\\Users\\LeviB\\Projects\\OpenCE-Mantle',
      ];
      let bitmapsPath = task.bitmapsPath;
      let soundsPath = task.soundsPath;
      if (!bitmapsPath || !fs.existsSync(bitmapsPath)) {
        const localBmp = mapDir ? path.join(mapDir, 'bitmaps.map') : '';
        if (localBmp && fs.existsSync(localBmp)) {
          bitmapsPath = localBmp;
        } else {
          for (const root of candidateRoots) {
            const md = path.join(root, 'sample_maps/HaloMD/bitmaps.map');
            const pc = path.join(root, 'sample_maps/PC/bitmaps.map');
            if (fs.existsSync(md)) { bitmapsPath = md; break; }
            if (fs.existsSync(pc)) { bitmapsPath = pc; break; }
          }
        }
      }
      if (!soundsPath || !fs.existsSync(soundsPath)) {
        const localSnd = mapDir ? path.join(mapDir, 'sounds.map') : '';
        if (localSnd && fs.existsSync(localSnd)) {
          soundsPath = localSnd;
        } else if (bitmapsPath && fs.existsSync(path.join(path.dirname(bitmapsPath), 'sounds.map'))) {
          soundsPath = path.join(path.dirname(bitmapsPath), 'sounds.map');
        } else {
          for (const root of candidateRoots) {
            const md = path.join(root, 'sample_maps/HaloMD/sounds.map');
            const pc = path.join(root, 'sample_maps/PC/sounds.map');
            if (fs.existsSync(md)) { soundsPath = md; break; }
            if (fs.existsSync(pc)) { soundsPath = pc; break; }
          }
        }
      }
      const resources = openConversionResources({ bitmaps: bitmapsPath, sounds: soundsPath });
      try {
        const layout = classifyMapLayout(bufferCopy);
        const convert = layout.kind === 'demo' ? convertDemoToCustomEdition : convertRetailToCustomEdition;
        const converted = convert(bufferCopy, {
          acknowledgeScripts: true,
          repairs: {
            rebuildDecompressedFileSize: true,
            truncateFileToHeaderSize: true,
            stripTrailingBytes: true,
            extendModelDataSize: true,
            clampTagDataSize: true,
            clampScenarioBspSizes: true,
            clampTagArrayCount: true,
            alignTagData4: true,
            zeroMissingExternalData: true,
            clampOutOfRangeDependencies: true,
            dropUnrebasableTags: true,
            stripCorruptedSoundPermutations: true,
            stripInvalidBsp2dReferences: true,
            clampTruncatedBitmaps: true,
            repairCorruptedModelVertices: true,
          },
          resources: resources.files,
        });
        bufferCopy = Buffer.from(converted.buffer);
      } finally {
        resources.close();
      }
    } else {
      repairTruncatedBitmapMipmaps(bufferCopy, currentMap.header, currentMap.tagIndex);
      repairCorruptedModelPartStrips(bufferCopy, currentMap.header, currentMap.tagIndex);
    }

    progress(task.requestId, 'Writing staged map', 60);
    const finalized = writeFinalizedMap(bufferCopy, target, 'Staging for OpenCE Tag Test');
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, {
      ok: true,
      targetPath: target,
      crc32: finalized.crc32,
      scenarioName: finalized.scenarioName,
      mapType: currentMap.header.mapType,
    });
  } catch (err) {
    sendWriteError(task.requestId, err);
  }
}

const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Convert to Custom Edition, step 1: the read-only pre-flight report. Doesn't touch the held map. */
export function runConvertPreflight(task: { requestId: string; filePath: string; bitmapsPath?: string; soundsPath?: string }) {
  const resources = openConversionResources({ bitmaps: task.bitmapsPath, sounds: task.soundsPath });
  try {
    progress(task.requestId, 'Reading file', 10);
    const buffer = fs.readFileSync(task.filePath);
    progress(task.requestId, 'Checking the map', 40);
    const report = classifyMapLayout(buffer).kind === 'demo'
      ? preflightDemoConversion(buffer, resources.files)
      : preflightRetailConversion(buffer, resources.files);
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, { ok: true, sourceFileName: path.basename(task.filePath), report } satisfies ConvertPreflightResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  } finally {
    resources.close();
  }
}

/**
 * Convert to Custom Edition, step 2. Reads the source again (never writes it), converts the header
 * (version, build string), checks the result reads as a CE map, then writes it through the same
 * path as Save As (`writeFinalizedMap`: name from the file name, CRC32, temp file + rename).
 * Afterwards the output is the open, unmodified map.
 */
export function runConvertMap(task: { requestId: string; sourcePath: string; outputPath: string; acknowledgeScripts: boolean; repairs?: ConvertRepairChoice; bitmapsPath?: string; soundsPath?: string }) {
  if (samePath(task.sourcePath, task.outputPath)) return sendError(task.requestId, 'REFUSED_SOURCE_PATH', 'The converted map cannot overwrite the map it was converted from. Choose a different file name or folder.');
  if (isOpenMapPath(task.outputPath)) return sendError(task.requestId, 'REFUSED_OPEN_MAP', 'The converted map cannot overwrite the map that is open in the app. Choose a different file name.');
  if (isBackupFilePath(task.outputPath)) return sendError(task.requestId, 'REFUSED_BACKUP_FILE', 'The converted map cannot be written as a .bak file. Choose a .map file name.');
  const resources = openConversionResources({ bitmaps: task.bitmapsPath, sounds: task.soundsPath });
  try {
    progress(task.requestId, 'Reading file', 10);
    const source = fs.readFileSync(task.sourcePath);
    progress(task.requestId, 'Converting the header', 40);
    let copyPercent = -1;
    const convert = classifyMapLayout(source).kind === 'demo' ? convertDemoToCustomEdition : convertRetailToCustomEdition;
    const converted = convert(source, {
      acknowledgeScripts: task.acknowledgeScripts,
      repairs: task.repairs ?? {},
      resources: resources.files,
      onProgress: (bytesDone, bytesTotal) => {
        const percent = bytesTotal === 0 ? 100 : Math.floor((bytesDone / bytesTotal) * 100);
        if (percent >= copyPercent + 5 || percent === 100) {
          copyPercent = percent;
          progress(task.requestId, `Copying bitmap and sound data (${percent}%)`, 40 + Math.round(percent * 0.2));
        }
      },
    });
    if (inspectCustomEditionMap(converted.buffer).status !== 'ok') throw new Error('The converted map could not be read back as a Custom Edition map; nothing was written.');
    progress(task.requestId, 'Writing map', 60);
    const finalized = writeFinalizedMap(converted.buffer, task.outputPath, 'the source map was not changed');
    currentMap = reparse(task.outputPath, finalized.buffer, false, diskStatOf(task.outputPath));
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, {
      ok: true,
      sourcePath: task.sourcePath,
      outputPath: task.outputPath,
      scenarioName: finalized.scenarioName,
      previousScenarioName: finalized.previousScenarioName,
      crc32: finalized.crc32,
      previousCrc32: finalized.previousCrc32,
      warnings: finalized.warnings,
      staleChecksumWarning: TAG_FILE_CHECKSUM_WARNING,
      map: summarizeOpenMap(currentMap),
    } satisfies ConvertMapResult);
  } catch (err) {
    if (err instanceof ConversionRefusedError) return sendError(task.requestId, err.code, err.message);
    sendWriteError(task.requestId, err);
  } finally {
    resources.close();
  }
}

/**
 * Applies the reviewed plan to the held map IN MEMORY and marks it modified. Writes nothing to
 * disk. The next plan runs against this buffer, so injections stack. Not finalized (name/CRC32)
 * here - that happens only when saving.
 */
export function runApplyInject(task: { requestId: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  if (!currentInject) return sendError(task.requestId, 'NO_PLAN', 'Run "Inject Tags..." and review the plan before applying it.');
  try {
    progress(task.requestId, 'Applying to the open map (in memory)', 30);
    const injected = currentInject.plan.mode === 'swap'
      ? applySwapInjection(currentMap.buffer, currentMap.header, currentMap.tagIndex, currentInject.container, currentInject.plan, { allowEmbeddedRelocation: true })
      : applyAddInjection(currentMap.buffer, currentMap.header, currentMap.tagIndex, currentInject.container, currentInject.plan, { allowEmbeddedRelocation: true });
    progress(task.requestId, 'Re-reading the tag index', 80);
    currentMap = reparse(currentMap.filePath, injected, true, currentMap.diskStat);
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, {
      ok: true,
      addedCount: currentInject.plan.counts.added,
      reusedCount: currentInject.plan.counts.reused,
      swappedCount: currentInject.plan.counts.swapped,
      map: summarizeOpenMap(currentMap),
    } satisfies ApplyInjectResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  } finally {
    currentInject = null;
  }
}

export function runVerifyEmbeddedData(task: { requestId: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'Open and decompress a map before verifying embedded data.');
  try {
    progress(task.requestId, 'Checking bitmap/sound data', 40);
    const report = verifyEmbeddedData(currentMap.buffer, currentMap.header, currentMap.tagIndex);
    const mapLabel = currentMap.header.scenarioName || currentMap.filePath;
    const reportText = formatEmbeddedDataReport(report, mapLabel);
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, { ok: true, mapLabel, totalBitmapSoundTags: report.totalBitmapSoundTags, checkedTags: report.checkedTags, counts: report.counts, reportText } satisfies VerifyEmbeddedDataResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

function ensureMapTagInternalized(tagIndex: number) {
  if (!currentMap) return;
  const res = ensureExternalTagInternalized(currentMap.buffer, currentMap.header, currentMap.tagIndex, tagIndex);
  if (res.changed) {
    currentMap.buffer = res.buffer;
    currentMap.header = res.header;
    currentMap.tagIndex = res.tagIndex;
  }
}

/** M7a: Decodes all root-struct fields for the specified tag in the open map. */
export function runGetTagFields(task: { requestId: string; tagIndex: number }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    ensureMapTagInternalized(task.tagIndex);
    const data = readTagFieldValues(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex);
    sendResult(task.requestId, { ok: true, data } satisfies GetTagFieldsResult);
  } catch (err) {
    if (err instanceof TagFieldEditorError) {
      return sendError(task.requestId, 'TAG_FIELD_ERROR', err.message);
    }
    handleTaskError(task.requestId, err);
  }
}

/** M7a: Updates a single field value in-place in the open map in memory and marks it modified. */
export function runUpdateTagField(task: { requestId: string; tagIndex: number; fieldName: string; newValue: unknown }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    ensureMapTagInternalized(task.tagIndex);
    const res = writeTagFieldValue(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex, task.fieldName, task.newValue);
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      fieldName: res.fieldName,
      newValue: res.newValue,
      map: summarizeOpenMap(currentMap),
    } satisfies UpdateTagFieldResult);
  } catch (err) {
    if (err instanceof TagFieldEditorError) {
      return sendError(task.requestId, 'TAG_FIELD_ERROR', err.message);
    }
    handleTaskError(task.requestId, err);
  }
}

/** Tag Editor: appends or clones a child struct chunk in a TagReflexive array. */
export function runAddReflexiveChunk(task: {
  requestId: string;
  tagIndex: number;
  reflexiveFieldPath: string;
  cloneFromIndex?: number;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    ensureMapTagInternalized(task.tagIndex);
    const res = addReflexiveChunk(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.tagIndex,
      task.reflexiveFieldPath,
      task.cloneFromIndex ?? -1,
    );
    currentMap.buffer = res.buffer;
    currentMap.header = res.header;
    currentMap.tagIndex = res.tagIndex;
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      tagIndex: task.tagIndex,
      reflexiveFieldPath: task.reflexiveFieldPath,
      newElementIndex: res.newElementIndex,
      newCount: res.newCount,
      map: summarizeOpenMap(currentMap),
    } satisfies AddReflexiveChunkResult);
  } catch (err) {
    if (err instanceof TagFieldEditorError) {
      return sendError(task.requestId, 'TAG_FIELD_ERROR', err.message);
    }
    handleTaskError(task.requestId, err);
  }
}

/** Dependency Swapper: lists every dependency slot of a tag (nested blocks and null slots included). */
export function runGetDependencySlots(task: { requestId: string; tagIndex: number }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    ensureMapTagInternalized(task.tagIndex);
    const slots = listTagDependencySlots(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex);
    sendResult(task.requestId, { ok: true, slots } satisfies GetDependencySlotsResult);
  } catch (err) {
    if (err instanceof TagDependencySwapError) return sendError(task.requestId, 'DEPENDENCY_SLOT_ERROR', err.message);
    handleTaskError(task.requestId, err);
  }
}

/** Dependency Swapper: rewrites one slot in the held map in memory and marks it modified. */
export function runSetDependencySlot(task: { requestId: string; tagIndex: number; fieldPath: string; newTagId: number | null }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    ensureMapTagInternalized(task.tagIndex);
    const res = setTagDependencySlot(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex, task.fieldPath, task.newTagId);
    currentMap.modified = true;
    sendResult(task.requestId, { ok: true, fieldPath: res.fieldPath, newTagId: res.newTagId, map: summarizeOpenMap(currentMap) } satisfies SetDependencySlotResult);
  } catch (err) {
    if (err instanceof TagDependencySwapError) return sendError(task.requestId, 'DEPENDENCY_SLOT_ERROR', err.message);
    handleTaskError(task.requestId, err);
  }
}

let cachedBitmapsMap: { filePath: string; mtimeMs: number; buffer: Buffer } | null = null;
function getBitmapsBuffer(bitmapsPath?: string): Buffer | undefined {
  const isCeMap = currentMap?.header?.engine === 609;
  const isCompatibleBitmaps = (p: string): boolean => {
    try {
      if (!fs.existsSync(p)) return false;
      const sz = fs.statSync(p).size;
      if (isCeMap && sz > 240 * 1024 * 1024) return false; // Reject 317 MB PC/HaloMD bitmaps.map for Custom Edition maps
      return true;
    } catch {
      return false;
    }
  };
  let resolved = bitmapsPath && isCompatibleBitmaps(bitmapsPath) ? bitmapsPath : undefined;
  if (!resolved && currentMap?.filePath) {
    const mapDir = path.dirname(currentMap.filePath);
    const parentDir = path.dirname(mapDir);
    const candidates = [
      path.join(mapDir, 'bitmaps.map'),
      path.join(mapDir, 'custom edition', 'bitmaps.map'),
      path.join(parentDir, 'custom edition', 'bitmaps.map'),
      path.join(parentDir, 'bitmaps.map'),
      'C:\\Users\\LeviB\\Projects\\OpenCE-Mantle\\sample_maps\\custom edition\\bitmaps.map',
      'C:\\Users\\LeviB\\Desktop\\Halo CE Related\\OpenCE\\custom_maps\\bitmaps.map',
      'C:\\Users\\LeviB\\Projects\\OpenCE-MapExp\\build\\windows\\custom_maps\\bitmaps.map',
      'D:\\custom_maps\\bitmaps.map',
      'C:\\Program Files (x86)\\Microsoft Games\\Halo Custom Edition\\maps\\bitmaps.map',
      path.join(mapDir, 'PC', 'bitmaps.map'),
      path.join(parentDir, 'PC', 'bitmaps.map'),
      'C:\\Program Files (x86)\\Microsoft Games\\Halo\\maps\\bitmaps.map',
    ];
    for (const candidate of candidates) {
      if (isCompatibleBitmaps(candidate)) {
        resolved = candidate;
        break;
      }
    }
  }
  if (!resolved || !fs.existsSync(resolved)) return undefined;
  try {
    const stat = fs.statSync(resolved);
    if (cachedBitmapsMap && cachedBitmapsMap.filePath === resolved && cachedBitmapsMap.mtimeMs === stat.mtimeMs) {
      return cachedBitmapsMap.buffer;
    }
    const buffer = fs.readFileSync(resolved);
    cachedBitmapsMap = { filePath: resolved, mtimeMs: stat.mtimeMs, buffer };
    return buffer;
  } catch {
    return undefined;
  }
}

let cachedSoundsMap: { filePath: string; mtimeMs: number; buffer: Buffer } | null = null;
function getSoundsBuffer(soundsPath?: string): Buffer | undefined {
  let resolved = soundsPath;
  if ((!resolved || !fs.existsSync(resolved)) && currentMap?.filePath) {
    const mapDir = path.dirname(currentMap.filePath);
    const parentDir = path.dirname(mapDir);
    const candidates = [
      path.join(mapDir, 'sounds.map'),
      path.join(mapDir, 'custom edition', 'sounds.map'),
      path.join(mapDir, 'PC', 'sounds.map'),
      path.join(parentDir, 'custom edition', 'sounds.map'),
      path.join(parentDir, 'PC', 'sounds.map'),
      path.join(parentDir, 'sounds.map'),
      'D:\\custom_maps\\sounds.map',
      'C:\\Program Files (x86)\\Microsoft Games\\Halo Custom Edition\\maps\\sounds.map',
      'C:\\Program Files (x86)\\Microsoft Games\\Halo\\maps\\sounds.map',
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        resolved = candidate;
        break;
      }
    }
  }
  if (!resolved || !fs.existsSync(resolved)) return undefined;
  try {
    const stat = fs.statSync(resolved);
    if (cachedSoundsMap && cachedSoundsMap.filePath === resolved && cachedSoundsMap.mtimeMs === stat.mtimeMs) {
      return cachedSoundsMap.buffer;
    }
    const buffer = fs.readFileSync(resolved);
    cachedSoundsMap = { filePath: resolved, mtimeMs: stat.mtimeMs, buffer };
    return buffer;
  } catch {
    return undefined;
  }
}

/** Step 8.4: Extracts 3D Structure BSP render mesh for the open map. */
export function runGetBspRenderMesh(task: { requestId: string; bspIndex?: number }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const mesh = extractBspRenderMesh(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.bspIndex);
    sendResult(task.requestId, { ok: true, mesh } satisfies GetBspRenderMeshResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** Step 8.4: Decodes a bitmap or resolves and decodes a shader's diffuse texture for 3D rendering. */
export function runGetBitmapTexture(task: { requestId: string; bitmapTagId: number; imageIndex?: number; bitmapsPath?: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    let tagId = task.bitmapTagId;
    const entry = currentMap.tagIndex.entries.find((e) => e.tagId === tagId);
    if (entry && entry.primaryClassFourCC !== BITM_FOURCC) {
      const resolvedId = resolveShaderBaseBitmapTagId(currentMap.buffer, currentMap.header, currentMap.tagIndex, tagId);
      if (resolvedId !== null) {
        tagId = resolvedId;
      } else {
        return sendError(task.requestId, 'NO_DIFFUSE_BITMAP', `Shader tag 0x${tagId.toString(16)} does not reference a diffuse bitmap.`);
      }
    }
    const externalBitmaps = getBitmapsBuffer(task.bitmapsPath);
    const texture = decodeBitmapTagImage(currentMap.buffer, currentMap.header, currentMap.tagIndex, tagId, task.imageIndex ?? 0, externalBitmaps);
    sendResult(task.requestId, { ok: true, texture } satisfies GetBitmapTextureResult);
  } catch (err) {
    sendError(task.requestId, 'BITMAP_TEXTURE_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** M13.1: Inspects a bitmap tag's sequences, formats, and image plates. */
export function runGetBitmapInfo(task: { requestId: string; tagIndex: number; bitmapsPath?: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const entry = currentMap.tagIndex.entries[task.tagIndex];
    if (!entry) return sendError(task.requestId, 'TAG_NOT_FOUND', `Tag #${task.tagIndex} not found.`);
    const externalBitmaps = getBitmapsBuffer(task.bitmapsPath);
    const summary = inspectBitmapTag(currentMap.buffer, currentMap.header, currentMap.tagIndex, entry.tagId, externalBitmaps);
    sendResult(task.requestId, { ok: true, summary });
  } catch (err) {
    sendError(task.requestId, 'BITMAP_INFO_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** M13.1: Decodes an image plate to base64 PNG data URL for UI preview. */
export function runGetBitmapRgba(task: { requestId: string; tagIndex: number; imageIndex: number; bitmapsPath?: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const entry = currentMap.tagIndex.entries[task.tagIndex];
    if (!entry) return sendError(task.requestId, 'TAG_NOT_FOUND', `Tag #${task.tagIndex} not found.`);
    const externalBitmaps = getBitmapsBuffer(task.bitmapsPath);
    const texture = decodeBitmapTagImage(currentMap.buffer, currentMap.header, currentMap.tagIndex, entry.tagId, task.imageIndex, externalBitmaps);
    const pngBuffer = encodeRgbaToPng(texture.rgbaData, texture.width, texture.height);
    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    sendResult(task.requestId, {
      ok: true,
      width: texture.width,
      height: texture.height,
      dataUrl,
    });
  } catch (err) {
    sendError(task.requestId, 'BITMAP_RGBA_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** M13.1: Exports a bitmap image plate as PNG or DDS. */
export function runExportBitmap(task: {
  requestId: string;
  tagIndex: number;
  imageIndex: number;
  format: 'png' | 'dds';
  outputPath: string;
  bitmapsPath?: string;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const entry = currentMap.tagIndex.entries[task.tagIndex];
    if (!entry) return sendError(task.requestId, 'TAG_NOT_FOUND', `Tag #${task.tagIndex} not found.`);
    const externalBitmaps = getBitmapsBuffer(task.bitmapsPath);
    if (task.format === 'dds') {
      const summary = inspectBitmapTag(currentMap.buffer, currentMap.header, currentMap.tagIndex, entry.tagId, externalBitmaps);
      const img = summary.images[task.imageIndex];
      if (!img) return sendError(task.requestId, 'IMAGE_NOT_FOUND', `Image plate ${task.imageIndex} not found.`);
      const srcBuf = img.isExternal ? externalBitmaps : currentMap.buffer;
      if (!srcBuf) return sendError(task.requestId, 'EXTERNAL_BITMAPS_REQUIRED', 'External bitmaps.map required.');
      const rawBytes = srcBuf.subarray(img.pixelDataOffset, img.pixelDataOffset + img.pixelDataSize);
      const ddsBuffer = encodeToDds(rawBytes, img.width, img.height, img.format, img.mipmapCount);
      fs.writeFileSync(task.outputPath, ddsBuffer);
    } else {
      const texture = decodeBitmapTagImage(currentMap.buffer, currentMap.header, currentMap.tagIndex, entry.tagId, task.imageIndex, externalBitmaps);
      const pngBuffer = encodeRgbaToPng(texture.rgbaData, texture.width, texture.height);
      fs.writeFileSync(task.outputPath, pngBuffer);
    }
    sendResult(task.requestId, { ok: true, filePath: task.outputPath });
  } catch (err) {
    sendError(task.requestId, 'BITMAP_EXPORT_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** M13.1: Imports and replaces a bitmap image plate in-place or appended/internalized. */
export function runReplaceBitmapImage(task: {
  requestId: string;
  tagIndex: number;
  imageIndex: number;
  inputPath: string;
  targetFormat?: number;
  bitmapsPath?: string;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const entry = currentMap.tagIndex.entries[task.tagIndex];
    if (!entry) return sendError(task.requestId, 'TAG_NOT_FOUND', `Tag #${task.tagIndex} not found.`);
    if (!fs.existsSync(task.inputPath)) return sendError(task.requestId, 'FILE_NOT_FOUND', `Input file "${task.inputPath}" does not exist.`);

    const fileBuf = fs.readFileSync(task.inputPath);
    const externalBitmaps = getBitmapsBuffer(task.bitmapsPath);

    let pixels: Uint8Array;
    let width: number;
    let height: number;
    let chosenFormat = task.targetFormat;

    let mipmapCount = 0;

    // Check if DDS
    if (fileBuf.length > 128 && fileBuf.readUInt32LE(0) === 0x20534444) {
      height = fileBuf.readUInt32LE(12);
      width = fileBuf.readUInt32LE(16);
      const fourCC = fileBuf.toString('ascii', 84, 88);
      if (chosenFormat === undefined) {
        if (fourCC === 'DXT1') chosenFormat = BitmapFormat.DXT1;
        else if (fourCC === 'DXT3') chosenFormat = BitmapFormat.DXT3;
        else if (fourCC === 'DXT5') chosenFormat = BitmapFormat.DXT5;
        else chosenFormat = BitmapFormat.A8R8G8B8;
      }
      const ddsMips = fileBuf.readUInt32LE(28) || 1;
      mipmapCount = ddsMips > 1 ? ddsMips - 1 : 0;
      pixels = fileBuf.subarray(128);
    } else {
      // Decode PNG, strip any unpainted #38bdf8 UV guide lines, and resize to power-of-two dimensions (<= 1024)
      // required by Halo CE's Direct3D texture loader
      const decoded = decodePngToRgba(fileBuf);
      const cleanedRgba = stripUvWireframeOverlayFromRgba(decoded.rgba, decoded.width, decoded.height);
      const pot = resizeRgbaToPowerOfTwo(cleanedRgba, decoded.width, decoded.height, 1024);
      width = pot.width;
      height = pot.height;

      if (chosenFormat === undefined) {
        let hasAlpha = false;
        for (let i = 3; i < pot.rgba.length; i += 4) {
          if (pot.rgba[i] < 250) {
            hasAlpha = true;
            break;
          }
        }
        chosenFormat = hasAlpha ? BitmapFormat.DXT5 : BitmapFormat.DXT1;
      }

      // Generate complete mipmap chain down to 1x1 so vehicle/weapon shaders render at all LOD distances
      const encoded = encodeBitmapWithMipmaps(pot.rgba, width, height, chosenFormat, true);
      pixels = encoded.pixelData;
      mipmapCount = encoded.mipmapCount;
    }

    const updatedBuffer = replaceBitmapImageData(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      entry.tagId,
      task.imageIndex,
      pixels,
      width,
      height,
      chosenFormat,
      externalBitmaps,
      mipmapCount,
    );

    currentMap.buffer = updatedBuffer;
    const reInspected = inspectCustomEditionMap(currentMap.buffer);
    if (reInspected.status !== 'ok') {
      return sendError(task.requestId, 'REINSPECT_FAILED', 'Failed to inspect map after replacing bitmap.');
    }
    currentMap.header = reInspected.header;
    currentMap.tagIndex = reInspected.tagIndex;
    currentMap.modified = true;

    sendResult(task.requestId, {
      ok: true,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendError(task.requestId, 'BITMAP_REPLACE_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** M13.2: Inspects a sound tag's pitch ranges and permutations. */
export function runGetSoundInfo(task: { requestId: string; tagIndex: number; soundsPath?: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const entry = currentMap.tagIndex.entries[task.tagIndex];
    if (!entry) return sendError(task.requestId, 'TAG_NOT_FOUND', `Tag #${task.tagIndex} not found.`);
    const externalSounds = getSoundsBuffer(task.soundsPath);
    const summary = inspectSoundTag(currentMap.buffer, currentMap.header, currentMap.tagIndex, entry.tagId, externalSounds);
    sendResult(task.requestId, { ok: true, summary });
  } catch (err) {
    sendError(task.requestId, 'SOUND_INFO_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** M13.2: Decodes a sound permutation into base64 WAV data URL for audition playback. */
export function runGetSoundWav(task: {
  requestId: string;
  tagIndex: number;
  pitchRangeIndex: number;
  permutationIndex: number;
  soundsPath?: string;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const entry = currentMap.tagIndex.entries[task.tagIndex];
    if (!entry) return sendError(task.requestId, 'TAG_NOT_FOUND', `Tag #${task.tagIndex} not found.`);
    const externalSounds = getSoundsBuffer(task.soundsPath);
    const audio = decodeSoundPermutationPcm(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      entry.tagId,
      task.pitchRangeIndex,
      task.permutationIndex,
      externalSounds,
    );
    const wavBuffer = encodePcmToWav(audio.pcmSamples, audio.sampleRate, audio.channels);
    const dataUrl = `data:audio/wav;base64,${wavBuffer.toString('base64')}`;
    sendResult(task.requestId, {
      ok: true,
      dataUrl,
      sampleRate: audio.sampleRate,
      channels: audio.channels,
      durationSeconds: audio.durationSeconds,
    });
  } catch (err) {
    sendError(task.requestId, 'SOUND_WAV_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** M13.2: Exports a sound permutation as WAV on disk. */
export function runExportSound(task: {
  requestId: string;
  tagIndex: number;
  pitchRangeIndex: number;
  permutationIndex: number;
  outputPath: string;
  soundsPath?: string;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const entry = currentMap.tagIndex.entries[task.tagIndex];
    if (!entry) return sendError(task.requestId, 'TAG_NOT_FOUND', `Tag #${task.tagIndex} not found.`);
    const externalSounds = getSoundsBuffer(task.soundsPath);
    const audio = decodeSoundPermutationPcm(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      entry.tagId,
      task.pitchRangeIndex,
      task.permutationIndex,
      externalSounds,
    );
    const wavBuffer = encodePcmToWav(audio.pcmSamples, audio.sampleRate, audio.channels);
    fs.writeFileSync(task.outputPath, wavBuffer);
    sendResult(task.requestId, { ok: true, filePath: task.outputPath });
  } catch (err) {
    sendError(task.requestId, 'SOUND_EXPORT_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** M13.2: Imports a WAV file, encodes to Xbox ADPCM/PCM, and internalizes/replaces the sound permutation. */
export function runReplaceSound(task: {
  requestId: string;
  tagIndex: number;
  pitchRangeIndex: number;
  permutationIndex: number;
  inputPath: string;
  targetFormat?: number;
  soundsPath?: string;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const entry = currentMap.tagIndex.entries[task.tagIndex];
    if (!entry) return sendError(task.requestId, 'TAG_NOT_FOUND', `Tag #${task.tagIndex} not found.`);
    if (!fs.existsSync(task.inputPath)) return sendError(task.requestId, 'FILE_NOT_FOUND', `Input file "${task.inputPath}" does not exist.`);

    const wavFileBuf = fs.readFileSync(task.inputPath);
    const decodedWav = decodeWavToPcm(wavFileBuf);
    const externalSounds = getSoundsBuffer(task.soundsPath);
    const tagSummary = inspectSoundTag(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      entry.tagId,
      externalSounds,
    );
    const conformedPcm = conformPcmToSoundTag(
      decodedWav.pcmSamples,
      decodedWav.channels,
      decodedWav.sampleRate,
      tagSummary.channelCount,
      tagSummary.sampleRate,
    );

    let chosenFormat = task.targetFormat ?? SoundFormat.XboxADPCM;
    let newSamples: Uint8Array;

    if (chosenFormat === SoundFormat.XboxADPCM) {
      newSamples =
        tagSummary.channelCount === 2
          ? encodeXboxAdpcmStereo(conformedPcm)
          : encodeXboxAdpcmMono(conformedPcm);
    } else {
      chosenFormat = SoundFormat.PCM16;
      newSamples = new Uint8Array(conformedPcm.buffer, conformedPcm.byteOffset, conformedPcm.byteLength);
    }

    const mouthData = computeMouthDataEnvelope(conformedPcm, tagSummary.sampleRate, tagSummary.channelCount);

    const updatedBuffer = replaceSoundPermutationData(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      entry.tagId,
      task.pitchRangeIndex,
      task.permutationIndex,
      newSamples,
      chosenFormat,
      externalSounds,
      mouthData,
    );

    currentMap.buffer = updatedBuffer;
    const reInspected = inspectCustomEditionMap(currentMap.buffer);
    if (reInspected.status !== 'ok') {
      return sendError(task.requestId, 'REINSPECT_FAILED', 'Failed to inspect map after replacing sound.');
    }
    currentMap.header = reInspected.header;
    currentMap.tagIndex = reInspected.tagIndex;
    currentMap.modified = true;

    sendResult(task.requestId, {
      ok: true,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendError(task.requestId, 'SOUND_REPLACE_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** Step 8.5: Extracts placed scenario objects (vehicles, scenery, bipeds, weapons, spawns). */
export function runGetScenarioObjects(task: { requestId: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const summary = extractScenarioPlacements(currentMap.buffer, currentMap.header, currentMap.tagIndex);
    sendResult(task.requestId, { ok: true, summary } satisfies GetScenarioObjectsResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** Step 8.5: Extracts 3D model geometry for a gbxmodel tag. */
export function runGetModelGeometry(task: { requestId: string; modelTagId: number; lod?: number }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const lod = task.lod ?? 4;
    const cacheKey = `${task.modelTagId}:${lod}`;
    if (modelGeometryCache.has(cacheKey)) {
      return sendResult(task.requestId, { ok: true, geometry: modelGeometryCache.get(cacheKey)! } satisfies GetModelRenderGeometryResult);
    }
    const geometry = extractModelRenderGeometry(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.modelTagId, lod);
    modelGeometryCache.set(cacheKey, geometry);
    sendResult(task.requestId, { ok: true, geometry } satisfies GetModelRenderGeometryResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** M13.3: Exports a 3D model tag (gbxmodel) to OBJ or glTF .glb format. */
export function runExportModel3d(task: {
  requestId: string;
  modelTagId: number;
  lod?: number;
  format: 'obj' | 'glb';
  outputPath: string;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const dir = path.dirname(task.outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lod = task.lod ?? 4;
    const geometry = extractModelRenderGeometry(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.modelTagId, lod);
    if (task.format === 'glb') {
      const glbBytes = exportModelToGlb(geometry);
      fs.writeFileSync(task.outputPath, glbBytes);
    } else {
      const mtlFileName = path.basename(task.outputPath).replace(/\.obj$/i, '.mtl');
      const objRes = exportModelToObj(geometry, { mtlFileName });
      fs.writeFileSync(task.outputPath, objRes.objText, 'utf8');
      const mtlPath = task.outputPath.replace(/\.obj$/i, '.mtl');
      fs.writeFileSync(mtlPath, objRes.mtlText, 'utf8');
    }
    sendResult(task.requestId, { ok: true, filePath: task.outputPath } satisfies Export3dResult);
  } catch (err) {
    sendError(task.requestId, 'EXPORT_3D_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** M13.3: Exports Structure BSP geometry (sbsp) to OBJ or glTF .glb format. */
export function runExportBsp3d(task: {
  requestId: string;
  bspIndex: number;
  format: 'obj' | 'glb';
  outputPath: string;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const dir = path.dirname(task.outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const mesh = extractBspRenderMesh(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.bspIndex);
    if (task.format === 'glb') {
      const glbBytes = exportBspToGlb(mesh);
      fs.writeFileSync(task.outputPath, glbBytes);
    } else {
      const mtlFileName = path.basename(task.outputPath).replace(/\.obj$/i, '.mtl');
      const objRes = exportBspToObj(mesh, { mtlFileName });
      fs.writeFileSync(task.outputPath, objRes.objText, 'utf8');
      const mtlPath = task.outputPath.replace(/\.obj$/i, '.mtl');
      fs.writeFileSync(mtlPath, objRes.mtlText, 'utf8');
    }
    sendResult(task.requestId, { ok: true, filePath: task.outputPath } satisfies Export3dResult);
  } catch (err) {
    sendError(task.requestId, 'EXPORT_3D_ERROR', err instanceof Error ? err.message : String(err));
  }
}

/** Step 9: Updates a placed scenario object in the open map in memory. */
export function runUpdateScenarioPlacement(task: {
  requestId: string;
  placementId: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  paletteIndex?: number;
  teamIndex?: number;
  multiplayerSpawnFlags?: number;
  forceSpawn?: boolean;
  extents?: [number, number, number];
  name?: string;
  worldBounds?: ScenarioWorldBounds;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const summary =
      task.placementId === '__world_bounds__' && task.worldBounds
        ? updateScenarioWorldBounds(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.worldBounds)
        : updateScenarioPlacement(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.placementId, {
            position: task.position,
            rotation: task.rotation,
            paletteIndex: task.paletteIndex,
            teamIndex: task.teamIndex,
            multiplayerSpawnFlags: task.multiplayerSpawnFlags,
            forceSpawn: task.forceSpawn,
            extents: task.extents,
            name: task.name,
          });
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      summary,
      map: summarizeOpenMap(currentMap),
    } satisfies UpdateScenarioPlacementResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** Step 9: Duplicates an existing placed scenario object in the open map. */
export function runDuplicateScenarioPlacement(task: {
  requestId: string;
  placementId: string;
  offsetDelta?: [number, number, number];
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const res = duplicateScenarioPlacement(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.placementId, task.offsetDelta);
    currentMap.buffer = res.buffer;
    currentMap.header = res.header;
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      summary: res.summary,
      newPlacement: res.newPlacement,
      map: summarizeOpenMap(currentMap),
    } satisfies DuplicateScenarioPlacementResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** Step 9: Adds a new placed scenario object to the open map. */
export function runAddScenarioPlacement(task: {
  requestId: string;
  kind: ScenarioObjectKind;
  paletteIndex: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  teamIndex?: number;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const res = addScenarioPlacement(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.kind,
      task.paletteIndex,
      task.position,
      task.rotation,
      task.teamIndex,
    );
    currentMap.buffer = res.buffer;
    currentMap.header = res.header;
    if (res.tagIndex) {
      currentMap.tagIndex = res.tagIndex;
    }
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      summary: res.summary,
      newPlacement: res.newPlacement,
      map: summarizeOpenMap(currentMap),
    } satisfies AddScenarioPlacementResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** Step 9: Swaps an existing placed scenario object in the open map. */
export function runSwapScenarioPlacement(task: {
  requestId: string;
  placementId: string;
  newKind: ScenarioObjectKind;
  newPaletteIndex: number;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const res = swapScenarioPlacement(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.placementId,
      task.newKind,
      task.newPaletteIndex,
    );
    currentMap.buffer = res.buffer;
    currentMap.header = res.header;
    if (res.tagIndex) {
      currentMap.tagIndex = res.tagIndex;
    }
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      summary: res.summary,
      newPlacement: res.newPlacement,
      map: summarizeOpenMap(currentMap),
    } satisfies SwapScenarioPlacementResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** Step 9: Deletes a placed scenario object from the open map. */
export function runDeleteScenarioPlacement(task: {
  requestId: string;
  placementId: string;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const summary = deleteScenarioPlacement(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.placementId);
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      summary,
      map: summarizeOpenMap(currentMap),
    } satisfies DeleteScenarioPlacementResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** Milestone 9: Reverse dependency lookup ("Referencing Tags"). */
export function runGetReferencingTags(task: { requestId: string; tagIndex: number }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const referencingTags = findReferencingTags(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex);
    sendResult(task.requestId, { ok: true, referencingTags } satisfies GetReferencingTagsResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** Milestone 9: Reads unicode strings from a ustr tag. */
export function runGetUnicodeStrings(task: { requestId: string; tagIndex: number }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const result = readUnicodeStringList(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex);
    sendResult(task.requestId, { ok: true, result } satisfies GetUnicodeStringsResult);
  } catch (err) {
    if (err instanceof UnicodeStringEditorError) return sendError(task.requestId, 'UNICODE_STRING_ERROR', err.message);
    handleTaskError(task.requestId, err);
  }
}

/** Milestone 9: In-place edit of a unicode string in a ustr tag. */
export function runSetUnicodeString(task: { requestId: string; tagIndex: number; stringIndex: number; newText: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const res = writeUnicodeString(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex, task.stringIndex, task.newText);
    currentMap.modified = true;
    sendResult(task.requestId, { ok: true, newText: res.newText, map: summarizeOpenMap(currentMap) } satisfies SetUnicodeStringResult);
  } catch (err) {
    if (err instanceof UnicodeStringEditorError) return sendError(task.requestId, 'UNICODE_STRING_ERROR', err.message);
    handleTaskError(task.requestId, err);
  }
}

/** Milestone 9: Rename a tag path in the open map. */
export function runRenameTag(task: { requestId: string; tagIndex: number; newPath: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    modelGeometryCache.clear();
    const res = renameTagInMap(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex, task.newPath);
    currentMap.buffer = res.buffer;
    const reInspected = inspectCustomEditionMap(currentMap.buffer);
    if (reInspected.status !== 'ok') {
      return sendError(task.requestId, 'TAG_INDEX_ERROR', 'Failed to inspect map after renaming.');
    }
    currentMap.header = reInspected.header;
    currentMap.tagIndex = reInspected.tagIndex;
    currentMap.modified = true;
    sendResult(task.requestId, { ok: true, path: res.path, map: summarizeOpenMap(currentMap) } satisfies RenameTagResult);
  } catch (err) {
    if (err instanceof TagIndexEditorError) return sendError(task.requestId, 'TAG_INDEX_ERROR', err.message);
    handleTaskError(task.requestId, err);
  }
}

/** Milestone 9: Duplicate a tag in the open map tag index. */
export function runDuplicateTag(task: { requestId: string; tagIndex: number; newPath: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    modelGeometryCache.clear();
    const res = duplicateTagInMap(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex, task.newPath);
    currentMap.buffer = res.buffer;
    const reInspected = inspectCustomEditionMap(currentMap.buffer);
    if (reInspected.status !== 'ok') {
      return sendError(task.requestId, 'TAG_INDEX_ERROR', 'Failed to inspect map after duplicating.');
    }
    currentMap.header = reInspected.header;
    currentMap.tagIndex = reInspected.tagIndex;
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      newTagIndex: res.newTagIndex,
      newTagId: res.newTagId,
      path: res.path,
      map: summarizeOpenMap(currentMap),
    } satisfies DuplicateTagResult);
  } catch (err) {
    if (err instanceof TagIndexEditorError) return sendError(task.requestId, 'TAG_INDEX_ERROR', err.message);
    handleTaskError(task.requestId, err);
  }
}

/** Delete a tag from the open map and scrub all incoming references to NULL_TAG_ID. */
export function runDeleteTag(task: { requestId: string; tagIndex: number }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    modelGeometryCache.clear();
    const res = deleteTagInMap(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex);
    currentMap.buffer = res.buffer;
    const reInspected = inspectCustomEditionMap(currentMap.buffer);
    if (reInspected.status !== 'ok') {
      return sendError(task.requestId, 'TAG_INDEX_ERROR', 'Failed to inspect map after deleting tag.');
    }
    currentMap.header = reInspected.header;
    currentMap.tagIndex = reInspected.tagIndex;
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      deletedPath: res.deletedPath,
      deletedGroup: res.deletedGroup,
      scrubbedReferencesCount: res.scrubbedReferencesCount,
      map: summarizeOpenMap(currentMap),
    } satisfies DeleteTagResult);
  } catch (err) {
    if (err instanceof TagIndexEditorError) return sendError(task.requestId, 'TAG_INDEX_ERROR', err.message);
    handleTaskError(task.requestId, err);
  }
}

/** Milestone 10: Preflight BSP Swap. */
/** Milestone 10.2: Extract 3D Structure BSP render mesh from an external source map. */
export async function runGetSourceBspMesh(task: {
  requestId: string;
  sourceFilePath: string;
  bspIndex?: number;
}) {
  try {
    const sourceBuffer = ensureXboxMapDecompressed(await fs.promises.readFile(task.sourceFilePath));
    const inspected = inspectCustomEditionMap(sourceBuffer);
    if (inspected.status !== 'ok') {
      return sendError(task.requestId, 'INVALID_MAP', 'Failed to inspect source map.');
    }
    const mesh = extractBspRenderMesh(sourceBuffer, inspected.header, inspected.tagIndex, task.bspIndex ?? 0);
    sendResult(task.requestId, { ok: true, mesh } satisfies GetBspRenderMeshResult);
  } catch (err: any) {
    sendError(task.requestId, 'BSP_MESH_ERROR', err?.message || 'Failed to extract source BSP mesh.');
  }
}

/** Milestone 10: Preflight BSP Swap. */
export async function runBspSwapPreflight(task: {
  requestId: string;
  sourceFilePath: string;
  sourceBspIndex?: number;
  targetBspIndex?: number;
  sourceBspIndices?: number[];
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const sourceBuffer = ensureXboxMapDecompressed(await fs.promises.readFile(task.sourceFilePath));
    const result = bspSwapPreflight(sourceBuffer, currentMap.buffer, task.sourceBspIndex, task.targetBspIndex, task.sourceBspIndices);
    sendResult(task.requestId, result);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** Milestone 10: Perform BSP Swap in-memory. */
export async function runPerformBspSwap(task: {
  requestId: string;
  sourceFilePath: string;
  options: BspSwapOptions;
  resourceMapPaths?: Partial<Record<ResourceKind, string | undefined>>;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const mapDir = path.dirname(currentMap.filePath);
    const srcDir = path.dirname(task.sourceFilePath);
    const findResourceCandidate = (kind: 'bitmaps' | 'sounds', requireCeFormat: boolean): string | undefined => {
      const customOpt = kind === 'bitmaps' ? (task.options as any)?.customBitmapsPath : (task.options as any)?.customSoundsPath;
      const candidates = [
        customOpt,
        task.resourceMapPaths?.[kind],
        path.join(srcDir, `${kind}.map`),
        path.resolve(srcDir, '..', `${kind}.map`),
        path.join(mapDir, `${kind}.map`),
        path.resolve(mapDir, '..', `${kind}.map`),
        path.resolve(process.cwd(), 'sample_maps', `${kind}.map`),
        path.resolve(process.cwd(), '..', 'sample_maps', `${kind}.map`),
        `C:\\Program Files (x86)\\Microsoft Games\\Halo Custom Edition\\maps\\${kind}.map`,
        `C:\\Program Files\\Microsoft Games\\Halo Custom Edition\\maps\\${kind}.map`,
      ].filter((p): p is string => !!p && fs.existsSync(p));
      for (const cand of candidates) {
        if (!requireCeFormat) return cand;
        try {
          const res = openConversionResources({ [kind]: cand });
          try {
            const file = res.files[kind];
            if (file) {
              const hdr = file.read(0, 16);
              const pathsOff = hdr.readUInt32LE(4);
              const tableOff = hdr.readUInt32LE(8);
              if (pathsOff >= 16 && tableOff > pathsOff && tableOff <= file.size) {
                const samplePaths = file.read(pathsOff, Math.min(4096, tableOff - pathsOff)).toString('latin1');
                if (samplePaths.includes('__pixels') || samplePaths.includes('__permutations')) {
                  return cand;
                }
              }
            }
          } finally {
            res.close();
          }
        } catch {
          /* ignore unreadable candidate */
        }
      }
      return undefined;
    };

    const resources = openConversionResources({
      bitmaps: findResourceCandidate('bitmaps', false),
      sounds: findResourceCandidate('sounds', false),
    });
    const ceResources = openConversionResources({
      bitmaps: findResourceCandidate('bitmaps', true),
      sounds: findResourceCandidate('sounds', true),
    });
    try {
      const sourceBuffer = ensureXboxMapDecompressed(await fs.promises.readFile(task.sourceFilePath));
      const optionsWithResources: BspSwapOptions = {
        ...task.options,
        resourceFiles: resources.files,
        ceResourceFiles: ceResources.files,
      };
      const result = performBspSwap(sourceBuffer, currentMap.buffer, optionsWithResources);
      if (!result.ok) {
        return sendError(task.requestId, 'BSP_SWAP_ERROR', result.error || 'Failed to perform BSP swap.');
      }
      currentMap.buffer = result.buffer;
      const reInspected = inspectCustomEditionMap(currentMap.buffer);
      if (reInspected.status !== 'ok') {
        return sendError(task.requestId, 'BSP_SWAP_ERROR', 'Failed to inspect map after BSP swap.');
      }
      modelGeometryCache.clear();
      currentMap.header = reInspected.header;
      currentMap.tagIndex = reInspected.tagIndex;
      currentMap.modified = true;
      sendResult(task.requestId, {
        ...result,
        map: summarizeOpenMap(currentMap),
      });
    } finally {
      resources.close();
      ceResources.close();
    }
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

/** M13.4: Compiles a custom 3D object tag set (.obj + .png/.dds) into an .ocetags file and/or injects it directly into the open map. */
export function runBuildCustomObjectTag(task: {
  requestId: string;
  request: BuildCustomObjectRequest;
  resourceMapPaths?: Partial<Record<ResourceMapKind, string>>;
}) {
  const req = task.request;
  const needsInject = req.outputMode === 'inject' || req.outputMode === 'both';
  if (needsInject && !currentMap) {
    return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open to inject into.');
  }
  const resources = openConversionResources({
    bitmaps: task.resourceMapPaths?.bitmaps,
    sounds: task.resourceMapPaths?.sounds,
  });
  try {
    progress(task.requestId, 'Reading 3D mesh (.obj / .jms / .dae)...', 10);
    const readMeshAsObj = (filePath: string): string => {
      const raw = fs.readFileSync(filePath, 'utf8');
      const low = filePath.toLowerCase();
      if (low.endsWith('.jms')) {
        return convertJmsToObjText(raw).objText;
      }
      if (low.endsWith('.dae')) {
        return convertColladaDaeToObjText(raw).objText;
      }
      return raw;
    };
    let objText = req.objSourceText;
    if (!objText) {
      if (!req.objFilePath || !fs.existsSync(req.objFilePath)) {
        return sendError(task.requestId, 'FILE_NOT_FOUND', `3D model file not found: ${req.objFilePath}`);
      }
      objText = readMeshAsObj(req.objFilePath);
    }
    let collisionObjText: string | undefined;
    if (req.collisionObjFilePath && fs.existsSync(req.collisionObjFilePath)) {
      collisionObjText = readMeshAsObj(req.collisionObjFilePath);
    }

    let textureRgba: { rgba: Uint8Array; width: number; height: number } | undefined;
    if (req.texturePngDataUrl && req.texturePngDataUrl.startsWith('data:image/png;base64,')) {
      progress(task.requestId, 'Decoding painted UV texture...', 25);
      const b64 = req.texturePngDataUrl.slice('data:image/png;base64,'.length);
      textureRgba = decodePngToRgba(Buffer.from(b64, 'base64'));
    } else if (req.textureFilePath && fs.existsSync(req.textureFilePath)) {
      progress(task.requestId, 'Decoding UV texture...', 25);
      const texBuf = fs.readFileSync(req.textureFilePath);
      if (texBuf.length > 128 && texBuf.readUInt32LE(0) === 0x20534444) {
        const height = texBuf.readUInt32LE(12);
        const width = texBuf.readUInt32LE(16);
        const fourCC = texBuf.toString('ascii', 84, 88);
        const payload = texBuf.subarray(128);
        let rgba: Uint8Array;
        if (fourCC === 'DXT1') rgba = decodeDxt1(payload, 0, width, height);
        else if (fourCC === 'DXT3') rgba = decodeDxt3(payload, 0, width, height);
        else if (fourCC === 'DXT5') rgba = decodeDxt5(payload, 0, width, height);
        else {
          rgba = new Uint8Array(width * height * 4);
          for (let i = 0; i + 3 < payload.length && i + 3 < rgba.length; i += 4) {
            rgba[i + 0] = payload[i + 2];
            rgba[i + 1] = payload[i + 1];
            rgba[i + 2] = payload[i + 0];
            rgba[i + 3] = payload[i + 3];
          }
        }
        textureRgba = { rgba, width, height };
      } else {
        textureRgba = decodePngToRgba(texBuf);
      }
    }

    let templateExtractedSet: ReturnType<typeof extractTagSet> | undefined;
    let templateRig: ReturnType<typeof extractTemplateRigFromMap> | undefined;
    if (req.templateTagIndex !== undefined && req.templateTagIndex >= 0 && currentMap) {
      progress(task.requestId, 'Reading base template tag from open map...', 45);
      templateExtractedSet = extractTagSet(
        currentMap.buffer,
        currentMap.header,
        currentMap.tagIndex,
        [req.templateTagIndex],
        {
          resourceFiles: resources.files,
          captureGbxmodelRawData: true,
        },
      );
      templateRig = extractTemplateRigFromMap(
        currentMap.buffer,
        currentMap.header,
        currentMap.tagIndex,
        req.templateTagIndex,
      );
    }

    progress(task.requestId, 'Compiling GBXModel, 3D Collision BSP, Shader & Bitmap...', 65);
    const built = buildCustomObjectContainer({
      tagGroup: req.tagGroup,
      tagPath: req.tagPath,
      itemName: req.itemName,
      objText,
      collisionObjText,
      meshOptions: {
        scale: req.scale,
        flipYz: req.flipYz,
        centerOrigin: req.centerOrigin,
        forceAutoUv: req.forceAutoUv,
        uvUnwrapMode: req.uvUnwrapMode,
        targetCollisionFaces: req.targetCollisionFaces,
      },
      textureRgba,
      multiBoxCollision: req.multiBoxCollision,
      collisionMode: req.collisionMode,
      targetCollisionFaces: req.targetCollisionFaces,
      materialType: req.materialType,
      slotMaterialTypes: req.slotMaterialTypes,
      templateExtractedSet,
      templateRig,
      sourceMapName: currentMap ? path.basename(currentMap.filePath, '.map') : 'custom_object_builder',
    });

    if ((req.outputMode === 'ocetags' || req.outputMode === 'both') && req.outputOceTagsPath) {
      progress(task.requestId, 'Saving .ocetags file...', 80);
      const dir = path.dirname(req.outputOceTagsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(req.outputOceTagsPath, built.containerBuffer);
    }

    let injectedIntoMap = false;
    if (needsInject && currentMap) {
      progress(task.requestId, 'Injecting compiled object tags into open map...', 90);
      const rootAlreadyExists =
        built.container.tags.length === 5 &&
        currentMap.tagIndex.entries.some(
          (e) =>
            e.primaryClassName === built.rootTagGroup &&
            e.path.toLowerCase() === built.rootTagPath.toLowerCase(),
        );
      if (rootAlreadyExists) {
        built.container.rootOriginalIndices = [0, 1, 2, 3, 4];
      }
      const planResult = rootAlreadyExists
        ? planSwapInjection(
            currentMap,
            built.container,
            {},
            { allowEmbeddedRelocation: true },
          )
        : planAddInjection(
            currentMap,
            built.container,
            {},
            { allowEmbeddedRelocation: true },
          );
      if (planResult.kind === 'refused') {
        return sendError(task.requestId, 'INJECT_REFUSED', planResult.reason);
      }
      if (planResult.blockedOther.length > 0 || planResult.blockedEmbedded.length > 0) {
        const reasons = [...planResult.blockedOther, ...planResult.blockedEmbedded]
          .flatMap((b) => b.reasons)
          .join('; ');
        return sendError(task.requestId, 'INJECT_BLOCKED', `Tag injection blocked: ${reasons}`);
      }
      const nextBuffer = rootAlreadyExists
        ? applySwapInjection(
            currentMap.buffer,
            currentMap.header,
            currentMap.tagIndex,
            built.container,
            planResult,
            { allowEmbeddedRelocation: true },
          )
        : applyAddInjection(
            currentMap.buffer,
            currentMap.header,
            currentMap.tagIndex,
            built.container,
            planResult,
            { allowEmbeddedRelocation: true },
          );
      const reInspected = inspectCustomEditionMap(nextBuffer);
      if (reInspected.status !== 'ok') {
        return sendError(task.requestId, 'REINSPECT_FAILED', 'Failed to re-inspect map after injecting custom object.');
      }
      modelGeometryCache.clear();
      currentMap.buffer = nextBuffer;
      currentMap.header = reInspected.header;
      currentMap.tagIndex = reInspected.tagIndex;
      currentMap.modified = true;
      injectedIntoMap = true;

      if (req.placeAtPosition) {
        const scnrSummary = extractScenarioPlacements(currentMap.buffer, currentMap.header, currentMap.tagIndex);
        const palList =
          req.tagGroup === 'vehicle'
            ? scnrSummary.palettes.vehicles
            : req.tagGroup === 'weapon'
              ? scnrSummary.palettes.weapons
              : req.tagGroup === 'equipment'
                ? scnrSummary.palettes.equipment
                : scnrSummary.palettes.scenery;
        const palIdx = palList.findIndex(
          (p) => p.path.toLowerCase() === built.rootTagPath.toLowerCase(),
        );
        if (palIdx >= 0) {
          const placed = addScenarioPlacement(
            currentMap.buffer,
            currentMap.header,
            currentMap.tagIndex,
            req.tagGroup,
            palIdx,
            req.placeAtPosition,
            req.placeAtRotation ?? [0, 0, 0],
          );
          currentMap.buffer = placed.buffer;
          currentMap.header = placed.header;
          if (placed.tagIndex) {
            currentMap.tagIndex = placed.tagIndex;
          }
        }
      }
    }

    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, {
      ok: true,
      rootTagPath: built.rootTagPath,
      rootTagGroup: built.rootTagGroup,
      generatedTagPaths: built.generatedTagPaths,
      usedAutoUv: built.usedAutoUv,
      injectedIntoMap,
      outputOceTagsPath: req.outputOceTagsPath,
      map: currentMap ? summarizeOpenMap(currentMap) : undefined,
    } satisfies BuildCustomObjectResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  } finally {
    resources.close();
  }
}

function runInspectDeprotect(task: Extract<WorkerRequest, { type: 'inspectDeprotect' }>): void {
  if (!currentMap) {
    return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is currently open.');
  }
  try {
    const report = inspectMapProtectionAndIntegrity(currentMap.buffer, currentMap.header, currentMap.tagIndex);
    sendResult(task.requestId, { ok: true, report } satisfies InspectDeprotectResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

function runDeprotectMap(task: Extract<WorkerRequest, { type: 'deprotectMap' }>): void {
  if (!currentMap) {
    return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is currently open.');
  }
  try {
    progress(task.requestId, 'Running 3-Stage Map Deprotector & Asset Repairs...', 25);
    const res = deprotectAndRepairMap(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.options);
    modelGeometryCache.clear();
    currentMap.buffer = res.buffer;
    currentMap.header = res.header;
    currentMap.tagIndex = res.tagIndex;
    currentMap.modified = true;
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, {
      ok: true,
      classesRepaired: res.classesRepaired,
      scriptPathsRecovered: res.scriptPathsRecovered,
      heuristicPathsRenamed: res.heuristicPathsRenamed,
      bitmapsRepaired: res.bitmapsRepaired,
      modelPartsRepaired: res.modelPartsRepaired,
      stripIndicesClamped: res.stripIndicesClamped,
      log: res.log,
      map: summarizeOpenMap(currentMap),
    } satisfies DeprotectMapResult);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

function runSpoofMapCrc32(task: Extract<WorkerRequest, { type: 'spoofMapCrc32' }>): void {
  if (!currentMap) {
    return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is currently open.');
  }
  try {
    progress(task.requestId, 'Computing GF(2) CRC32 compensation...', 35);
    const res = spoofCacheCrc32(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.targetCrc32);
    currentMap.buffer = res.buffer;
    currentMap.header = res.header;
    currentMap.tagIndex = res.tagIndex;
    currentMap.modified = true;
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, {
      ok: true,
      compensationWord: res.compensationWord,
      crc32: res.crc32,
      map: summarizeOpenMap(currentMap),
    } satisfies SpoofMapCrc32Result);
  } catch (err) {
    handleTaskError(task.requestId, err);
  }
}

function refreshCurrentMapBuffer(newBuffer: Buffer): void {
  if (!currentMap) return;
  currentMap.buffer = newBuffer;
  currentMap.header = parseCacheFileHeader(newBuffer);
  currentMap.tagIndex = parseTagIndex(newBuffer, currentMap.header);
  currentMap.modified = true;
}

function runDecompileHaloScript(task: Extract<WorkerRequest, { type: 'decompileHaloScript' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = decompileScenarioScripts(currentMap.buffer);
    sendResult(task.requestId, {
      ok: true,
      hscSource: res.hscSource,
      scriptCount: res.scriptCount,
      globalCount: res.globalCount,
      syntaxNodeCount: res.syntaxNodeCount,
      scenarioEntities: res.scenarioEntities,
      scripts: res.scripts,
      globals: res.globals,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  }
}

function runCompileHaloScript(task: Extract<WorkerRequest, { type: 'compileHaloScript' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = compileHaloScriptIntoScenario(currentMap.buffer, task.hscSource);
    const hasErrors = res.diagnostics.some((d) => d.severity === 'error');
    if (hasErrors) {
      return sendResult(task.requestId, {
        ok: false,
        message: `Compilation failed with ${res.diagnostics.filter((d) => d.severity === 'error').length} syntax error(s).`,
        diagnostics: res.diagnostics,
      });
    }
    refreshCurrentMapBuffer(res.buffer);
    sendResult(task.requestId, {
      ok: true,
      compiledScripts: res.compiledScripts,
      compiledGlobals: res.compiledGlobals,
      syntaxNodesUsed: res.syntaxNodesUsed,
      diagnostics: res.diagnostics,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  }
}

function runSetupScenarioScriptEntities(task: Extract<WorkerRequest, { type: 'setupScenarioScriptEntities' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = ensureScenarioScriptEntities(currentMap.buffer, task.required);
    refreshCurrentMapBuffer(res.buffer);
    sendResult(task.requestId, {
      ok: true,
      addedObjectNames: res.addedObjectNames,
      addedTriggerVolumes: res.addedTriggerVolumes,
      addedCameraPoints: res.addedCameraPoints,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  }
}

function runExtractCollisionWireframe(task: Extract<WorkerRequest, { type: 'extractCollisionWireframe' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const wf = extractCollisionModelGeometry(currentMap.buffer, task.collTagIndex);
    sendResult(task.requestId, { ok: true, ...wf });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  }
}

function runConvertCollisionToGbxmodel(task: Extract<WorkerRequest, { type: 'convertCollisionToGbxmodel' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = convertCollisionToGbxmodelInMap(currentMap.buffer, task.collTagIndex, task.targetPath);
    refreshCurrentMapBuffer(res.buffer);
    const summary = summarizeOpenMap(currentMap);
    sendResult(task.requestId, {
      ok: true,
      createdTagIndex: res.createdTagIndex,
      createdTagPath: res.createdTagPath,
      createdTagGroup: res.createdTagGroup,
      summary: res.summary,
      tags: summary.tags,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  }
}

function runConvertSbspToScenery(task: Extract<WorkerRequest, { type: 'convertSbspToScenery' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = convertSbspToSceneryInMap(currentMap.buffer, task.bspTagIndex, task.targetPath);
    refreshCurrentMapBuffer(res.buffer);
    const summary = summarizeOpenMap(currentMap);
    sendResult(task.requestId, {
      ok: true,
      createdTagIndex: res.createdTagIndex,
      createdTagPath: res.createdTagPath,
      createdTagGroup: res.createdTagGroup,
      summary: res.summary,
      tags: summary.tags,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  }
}

function runConvertObjectTagClass(task: Extract<WorkerRequest, { type: 'convertObjectTagClass' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = convertObjectTagClassInMap(currentMap.buffer, task.sourceTagIndex, task.targetGroup, task.targetPath);
    refreshCurrentMapBuffer(res.buffer);
    const summary = summarizeOpenMap(currentMap);
    sendResult(task.requestId, {
      ok: true,
      createdTagIndex: res.createdTagIndex,
      createdTagPath: res.createdTagPath,
      createdTagGroup: res.createdTagGroup,
      summary: res.summary,
      tags: summary.tags,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  }
}

function runCleanOpenSauceYelo(task: Extract<WorkerRequest, { type: 'cleanOpenSauceYelo' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = cleanOpenSauceYeloScenario(currentMap.buffer);
    if (res.cleanedReferences > 0) {
      refreshCurrentMapBuffer(res.buffer);
    }
    sendResult(task.requestId, {
      ok: true,
      cleanedReferences: res.cleanedReferences,
      details: res.details,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  }
}

function runScanMapTagErrors(task: Extract<WorkerRequest, { type: 'scanMapTagErrors' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const report = scanMapTagsForErrors(currentMap.buffer);
    sendResult(task.requestId, { ok: true, ...report });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  }
}

function runGlobalReplaceTagReference(task: Extract<WorkerRequest, { type: 'globalReplaceTagReference' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = globalReplaceTagReference(currentMap.buffer, task.fromTagId, task.toTagId);
    if (res.replacedCount > 0) {
      refreshCurrentMapBuffer(res.buffer);
    }
    sendResult(task.requestId, {
      ok: true,
      replacedCount: res.replacedCount,
      affectedTags: res.affectedTags,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  }
}

function runExportOpenCeModFolder(task: Extract<WorkerRequest, { type: 'exportOpenCeModFolder' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  const resources = openConversionResources({
    bitmaps: task.bitmapsPath,
    sounds: task.soundsPath,
    loc: task.locPath,
  });
  try {
    const pkg = exportOpenCeModPackageFromMap(
      currentMap.buffer,
      task.rootTagIndices,
      {
        name: task.modName,
        version: task.version,
        author: task.author,
        description: task.description,
      },
      {
        includeDependencies: task.includeDependencies ?? false,
        replaceTargetTagIndex: task.replaceTargetTagIndex,
        resourceFiles: resources.files,
      },
    );
    const modDir = path.join(task.parentOutputDir, pkg.modFolderName);
    fs.mkdirSync(modDir, { recursive: true });
    const modTomlPath = path.join(modDir, 'mod.toml');
    fs.writeFileSync(modTomlPath, pkg.modToml, 'utf8');
    const writtenFiles: string[] = [modTomlPath];
    for (const tf of pkg.tagFiles) {
      const fullPath = path.join(modDir, ...tf.relativePath.split(/[\\/]+/));
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, tf.bytes);
      writtenFiles.push(fullPath);
    }
    sendResult(task.requestId, {
      ok: true,
      outputDir: modDir,
      modFolderName: pkg.modFolderName,
      tagCount: pkg.tagFiles.length,
      writtenFiles,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  } finally {
    resources.close();
  }
}

function runImportLegacyTags(task: Extract<WorkerRequest, { type: 'importLegacyTags' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  const resources = openConversionResources({
    bitmaps: task.bitmapsPath,
    sounds: task.soundsPath,
    loc: task.locPath,
  });
  try {
    const res = importLegacyTagsIntoMap(
      currentMap.buffer,
      task.inputPaths,
      resources.files,
      task.mode ?? 'add',
    );
    refreshCurrentMapBuffer(res.buffer);
    const summary = summarizeOpenMap(currentMap);
    sendResult(task.requestId, {
      ok: true,
      formatDetected: res.formatDetected,
      addedCount: res.addedCount,
      swappedCount: res.swappedCount,
      reusedCount: res.reusedCount,
      importedPaths: res.importedPaths,
      warnings: res.warnings,
      map: summary,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: (err as Error).message });
  } finally {
    resources.close();
  }
}

function runReplaceBitmapFromPngBytes(task: Extract<WorkerRequest, { type: 'replaceBitmapFromPngBytes' }>): void {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const entry = currentMap.tagIndex.entries[task.tagIndex];
    if (!entry) return sendError(task.requestId, 'TAG_NOT_FOUND', `Tag #${task.tagIndex} not found.`);
    const externalBitmaps = getBitmapsBuffer(task.bitmapsPath);
    const fileBuf = Buffer.from(task.pngBytes);
    const decoded = decodePngToRgba(fileBuf);
    const cleanedRgba = stripUvWireframeOverlayFromRgba(decoded.rgba, decoded.width, decoded.height);
    const pot = resizeRgbaToPowerOfTwo(cleanedRgba, decoded.width, decoded.height, 2048);
    const width = pot.width;
    const height = pot.height;

    let chosenFormat = task.targetFormat;
    if (chosenFormat === undefined) {
      let hasAlpha = false;
      for (let i = 3; i < pot.rgba.length; i += 4) {
        if (pot.rgba[i] < 250) {
          hasAlpha = true;
          break;
        }
      }
      chosenFormat = hasAlpha ? BitmapFormat.DXT5 : BitmapFormat.DXT1;
    }

    const encoded = encodeBitmapWithMipmaps(pot.rgba, width, height, chosenFormat, true);
    const updatedBuffer = replaceBitmapImageData(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      entry.tagId,
      task.imageIndex,
      encoded.pixelData,
      width,
      height,
      chosenFormat,
      externalBitmaps,
      encoded.mipmapCount,
    );

    currentMap.buffer = updatedBuffer;
    const reInspected = inspectCustomEditionMap(currentMap.buffer);
    if (reInspected.status !== 'ok') {
      return sendError(task.requestId, 'REINSPECT_FAILED', 'Failed to inspect map after replacing bitmap.');
    }
    currentMap.header = reInspected.header;
    currentMap.tagIndex = reInspected.tagIndex;
    currentMap.modified = true;

    sendResult(task.requestId, {
      ok: true,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendError(task.requestId, 'BITMAP_REPLACE_ERROR', err instanceof Error ? err.message : String(err));
  }
}

export function runUpdateBspVertices(task: {
  requestId: string;
  bspIndex: number;
  submeshUpdates: Array<{
    submeshIndex: number;
    positions: Float32Array | number[];
    normals?: Float32Array | number[];
    uvs?: Float32Array | number[];
    shaderTagId?: number;
    indices?: Uint16Array | Uint32Array | number[];
  }>;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const packedUpdates = task.submeshUpdates.map((u) => {
      const vCount = Math.floor(u.positions.length / 3);
      const vertices = new Float32Array(vCount * 8);
      for (let v = 0; v < vCount; v++) {
        const base = v * 8;
        vertices[base] = u.positions[v * 3] ?? 0;
        vertices[base + 1] = u.positions[v * 3 + 1] ?? 0;
        vertices[base + 2] = u.positions[v * 3 + 2] ?? 0;
        vertices[base + 3] = u.normals?.[v * 3] ?? 0;
        vertices[base + 4] = u.normals?.[v * 3 + 1] ?? 0;
        vertices[base + 5] = u.normals?.[v * 3 + 2] ?? 1;
        vertices[base + 6] = u.uvs?.[v * 2] ?? 0;
        vertices[base + 7] = u.uvs?.[v * 2 + 1] ?? 0;
      }
      return {
        submeshIndex: u.submeshIndex,
        vertices,
        shaderTagId: u.shaderTagId,
        indices: u.indices,
      };
    });
    const res = updateBspVerticesInMap(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.bspIndex,
      packedUpdates,
    );
    currentMap.modified = true;
    modelGeometryCache.clear();
    sendResult(task.requestId, {
      ok: true,
      updatedVertices: res.updatedVertices,
      updatedCollisionVertices: res.updatedCollisionVertices,
      updatedShaders: res.updatedShaders,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendError(task.requestId, 'BSP_UPDATE_ERROR', err instanceof Error ? err.message : String(err));
  }
}

export function runUpdateModelVertices(task: {
  requestId: string;
  modelTagId: number;
  lod?: number;
  submeshUpdates: Array<{
    submeshIndex: number;
    positions: Float32Array | number[];
    normals?: Float32Array | number[];
    uvs?: Float32Array | number[];
    shaderTagId?: number;
  }>;
}) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
    const packedUpdates = task.submeshUpdates.map((u) => {
      const vCount = Math.floor(u.positions.length / 3);
      const vertices = new Float32Array(vCount * 8);
      for (let v = 0; v < vCount; v++) {
        const base = v * 8;
        vertices[base] = u.positions[v * 3] ?? 0;
        vertices[base + 1] = u.positions[v * 3 + 1] ?? 0;
        vertices[base + 2] = u.positions[v * 3 + 2] ?? 0;
        vertices[base + 3] = u.normals?.[v * 3] ?? 0;
        vertices[base + 4] = u.normals?.[v * 3 + 1] ?? 0;
        vertices[base + 5] = u.normals?.[v * 3 + 2] ?? 1;
        vertices[base + 6] = u.uvs?.[v * 2] ?? 0;
        vertices[base + 7] = u.uvs?.[v * 2 + 1] ?? 0;
      }
      return {
        partIndex: u.submeshIndex,
        vertices,
        shaderTagId: u.shaderTagId,
      };
    });
    const res = updateModelVerticesInMap(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.modelTagId,
      packedUpdates,
      task.lod ?? 4,
    );
    currentMap.modified = true;
    modelGeometryCache.clear();
    sendResult(task.requestId, {
      ok: true,
      updatedVertices: res.updatedVertices,
      updatedShaders: res.updatedShaders,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendError(task.requestId, 'MODEL_UPDATE_ERROR', err instanceof Error ? err.message : String(err));
  }
}

export function runCompareMaps(task: Extract<WorkerRequest, { type: 'compareMaps' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open to compare against.' });
  }
  try {
    progress(task.requestId, 'Reading comparison map', 20);
    const otherBuf = ensureXboxMapDecompressed(fs.readFileSync(task.otherFilePath));
    progress(task.requestId, 'Computing semantic map diff', 60);
    const report = compareMaps(currentMap.buffer, otherBuf);
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, {
      ok: true,
      leftFileName: path.basename(currentMap.filePath),
      rightFileName: path.basename(task.otherFilePath),
      report,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

export function runDeployMccMod(task: Extract<WorkerRequest, { type: 'deployMccMod' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open to deploy.' });
  }
  try {
    progress(task.requestId, 'Packaging Steam MCC Mod & ModManifest.txt', 40);
    const scenarioName = currentMap.header.scenarioName || path.basename(currentMap.filePath, '.map');
    const result = deployMccModPackage(currentMap.buffer, scenarioName, {
      title: task.title,
      description: task.description,
      author: task.author,
      isMultiplayer: task.isMultiplayer ?? (currentMap.header.mapType === 1),
      targetRootDir: task.parentOutputDir,
      registerInModManifest: task.registerInModManifest,
      customManifestPath: task.modManifestPath,
    });
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, result);
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runGlobalReplaceTagFieldValue(task: Extract<WorkerRequest, { type: 'globalReplaceTagFieldValue' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = globalReplaceTagFieldValue(currentMap.buffer, {
      fieldNameQuery: task.fieldNameQuery,
      tagGroupFilter: task.tagGroupFilter,
      matchValue: task.matchValue,
      newValue: task.newValue,
    });
    if (res.replacedCount > 0) {
      refreshCurrentMapBuffer(res.buffer);
    }
    sendResult(task.requestId, {
      ok: true,
      replacedCount: res.replacedCount,
      affectedFields: res.affectedFields,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runCompileJmaAnimation(task: Extract<WorkerRequest, { type: 'compileJmaAnimation' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = compileJmaIntoModelAnimationsTag(
      currentMap.buffer,
      task.targetAntrTagIndex,
      task.jmaText,
      task.animName,
    );
    refreshCurrentMapBuffer(res.buffer);
    sendResult(task.requestId, {
      ok: true,
      animationName: res.animationName,
      frameCount: res.frameCount,
      nodeCount: res.nodeCount,
      frameSize: res.frameSize,
      replacedExisting: res.replacedExisting,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runCompileJmsPhysics(task: Extract<WorkerRequest, { type: 'compileJmsPhysics' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = compileJmsMassPointsIntoPhysicsTag(
      currentMap.buffer,
      task.targetPhysTagIndex,
      task.jmsText,
      task.totalMass,
    );
    refreshCurrentMapBuffer(res.buffer);
    sendResult(task.requestId, {
      ok: true,
      massPointCount: res.massPointCount,
      totalMass: res.totalMass,
      centerOfMass: res.centerOfMass,
      moments: res.moments,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runDecompileTagToSource(task: Extract<WorkerRequest, { type: 'decompileTagToSource' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const entry = currentMap.tagIndex.entries[task.tagIndex];
    if (!entry) {
      return sendResult(task.requestId, { ok: false, message: `Tag #${task.tagIndex} not found.` });
    }
    const cls = entry.primaryClassName;
    if (cls === 'gbxmodel' || cls === 'model') {
      const res = decompileGbxmodelToJmsText(currentMap.buffer, task.tagIndex);
      sendResult(task.requestId, {
        ok: true,
        kind: 'gbxmodel_jms',
        sourceText: res.jmsText,
        defaultExt: 'jms',
        tagPath: res.tagPath,
        summary: `${res.vertexCount} vertices, ${res.triangleCount} triangles, ${res.nodeCount} nodes, ${res.markerCount} markers`,
      });
    } else if (cls === 'model_animations') {
      const res = decompileModelAnimationsToJmaText(currentMap.buffer, task.tagIndex, task.animationIndex ?? 0);
      sendResult(task.requestId, {
        ok: true,
        kind: 'animations_jma',
        sourceText: res.jmaText,
        defaultExt: 'jma',
        tagPath: res.tagPath,
        animationName: res.animationName,
        summary: `Animation "${res.animationName}" (${res.frameCount} frames, ${res.nodeCount} nodes)`,
      });
    } else if (cls === 'physics') {
      const res = decompilePhysicsToJmsText(currentMap.buffer, task.tagIndex);
      sendResult(task.requestId, {
        ok: true,
        kind: 'physics_jms',
        sourceText: res.jmsText,
        defaultExt: 'jms',
        tagPath: res.tagPath,
        summary: `${res.massPointCount} #mass_* sphere markers (${res.totalMass} kg total mass)`,
      });
    } else {
      sendResult(task.requestId, {
        ok: false,
        message: `Tag "${entry.path}" (${cls}) cannot be decompiled to .jms/.jma source.`,
      });
    }
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runCompileStringsTag(task: Extract<WorkerRequest, { type: 'compileStringsTag' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = compileStringsIntoTag(currentMap.buffer, task.targetTagIndex, task.textContent);
    refreshCurrentMapBuffer(res.buffer);
    sendResult(task.requestId, {
      ok: true,
      tagPath: res.tagPath,
      tagGroup: res.tagGroup,
      entryCount: res.entryCount,
      messageNames: res.messageNames,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runInspectMeterTag(task: Extract<WorkerRequest, { type: 'inspectMeterTag' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = inspectMeterTag(currentMap.buffer, task.meterTagIndex);
    sendResult(task.requestId, { ok: true, ...res });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runCompileFontFromGlyphAtlas(task: Extract<WorkerRequest, { type: 'compileFontFromGlyphAtlas' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = compileCanvasAtlasIntoFontTag(currentMap.buffer, task.targetFontTagIndex, task.glyphSpec);
    refreshCurrentMapBuffer(res.buffer);
    sendResult(task.requestId, {
      ok: true,
      tagPath: res.tagPath,
      glyphCount: res.glyphCount,
      totalPixelBytes: res.totalPixelBytes,
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runInjectProceduralWorldBsp(task: Extract<WorkerRequest, { type: 'injectProceduralWorldBsp' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = injectProceduralWorldIntoMapBsp(currentMap.buffer, task.worldMesh, {
      bspIndex: task.bspIndex,
      shaderBindings: task.shaderBindings as any,
      collisionMode: task.collisionMode,
    });
    refreshCurrentMapBuffer(res.mapBuffer);
    sendResult(task.requestId, {
      ok: true,
      addedVertices: res.addedVertices,
      addedTriangles: res.addedTriangles,
      addedSubmeshes: res.addedSubmeshes,
      addedCollisionSurfaces: res.addedCollisionSurfaces,
      addedCollisionNodes3d: res.addedCollisionNodes3d,
      newBspSize: res.newBspSize,
      newBspAddress: res.newBspAddress,
      worldBounds: res.worldBounds,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runScaleCoupledPhysics(task: Extract<WorkerRequest, { type: 'scaleCoupledPhysics' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const summary = scaleObjectAndCoupledPhysicsInMap(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.objectTagId,
      task.scaleFactor,
    );
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      summary,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runInspectLiveHudCatalog(task: Extract<WorkerRequest, { type: 'inspectLiveHudCatalog' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const catalog = inspectMapHudAndUiTargets(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
    );
    sendResult(task.requestId, { ok: true, catalog });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runApplyLiveHudEdit(task: Extract<WorkerRequest, { type: 'applyLiveHudEdit' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = applyLiveHudEdit(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.request,
    );
    currentMap.buffer = res.buffer;
    currentMap.header = res.header;
    currentMap.tagIndex = res.tagIndex;
    currentMap.modified = true;
    const catalog = inspectMapHudAndUiTargets(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
    );
    sendResult(task.requestId, {
      ok: true,
      effectiveHudTagIndex: res.effectiveHudTagIndex,
      catalog,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runApplyLiveWeaponStatEdit(task: Extract<WorkerRequest, { type: 'applyLiveWeaponStatEdit' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = applyLiveWeaponStatEdit(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.request,
    );
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      writtenValue: res.writtenValue,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runInjectHudElementBitmap(task: Extract<WorkerRequest, { type: 'injectHudElementBitmap' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const externalBitmaps = getBitmapsBuffer(task.bitmapsPath);
    const res = injectHudElementBitmap(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.request,
      externalBitmaps,
    );
    currentMap.buffer = res.buffer;
    currentMap.header = res.header;
    currentMap.tagIndex = res.tagIndex;
    currentMap.modified = true;
    const catalog = inspectMapHudAndUiTargets(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
    );
    sendResult(task.requestId, {
      ok: true,
      bitmapTagIndex: res.bitmapTagIndex,
      bitmapTagId: res.bitmapTagId,
      bitmapPath: res.bitmapPath,
      width: res.width,
      height: res.height,
      format: res.format,
      catalog,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runInspectUiWidgetCanvas(task: Extract<WorkerRequest, { type: 'inspectUiWidgetCanvas' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const rootNode = inspectUiWidgetCanvas(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.widgetTagIndex,
    );
    if (!rootNode) {
      return sendResult(task.requestId, {
        ok: false,
        message: `Tag #${task.widgetTagIndex} is not a readable ui_widget_definition (DeLa) tag.`,
      });
    }
    sendResult(task.requestId, { ok: true, rootNode });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runUpdateUiWidgetPlacement(task: Extract<WorkerRequest, { type: 'updateUiWidgetPlacement' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    updateUiWidgetPlacement(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.request,
    );
    currentMap.modified = true;
    const rootTarget = task.request.parentTagIndex ?? task.request.widgetTagIndex;
    const rootNode = inspectUiWidgetCanvas(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      rootTarget,
    );
    sendResult(task.requestId, {
      ok: true,
      rootNode,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

function runSaveUnicodeStringTable(task: Extract<WorkerRequest, { type: 'saveUnicodeStringTable' }>): void {
  if (!currentMap) {
    return sendResult(task.requestId, { ok: false, message: 'No map is currently open.' });
  }
  try {
    const res = saveUnicodeStringListTable(
      currentMap.buffer,
      currentMap.header,
      currentMap.tagIndex,
      task.ustrTagIndex,
      task.strings,
    );
    currentMap.buffer = res.buffer;
    currentMap.header = res.header;
    currentMap.tagIndex = res.tagIndex;
    currentMap.modified = true;
    sendResult(task.requestId, {
      ok: true,
      entryCount: res.entryCount,
      map: summarizeOpenMap(currentMap),
    });
  } catch (err) {
    sendResult(task.requestId, { ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

parentPort?.on('message', async (task: WorkerRequest) => {
  try {
    if (task.type === 'cancel') {
      cancelledRequests.add(task.requestId);
      return;
    }
    if (task.type === 'inspect') await runInspect(task);
    else if (task.type === 'compress' || task.type === 'decompress') await runCompression(task);
    else if (task.type === 'getDependencies') runGetDependencies(task);
    else if (task.type === 'extractTags') runExtractTags(task);
    else if (task.type === 'planInject') runPlanInject(task);
    else if (task.type === 'applyInject') runApplyInject(task);
    else if (task.type === 'saveMap') runSaveMap(task);
    else if (task.type === 'saveMapAs') runSaveMapAs(task);
    else if (task.type === 'verifyEmbeddedData') runVerifyEmbeddedData(task);
    else if (task.type === 'convertPreflight') runConvertPreflight(task);
    else if (task.type === 'convertMap') runConvertMap(task);
    else if (task.type === 'batchExtract') runBatchExtract(task);
    else if (task.type === 'getTagFields') runGetTagFields(task);
    else if (task.type === 'updateTagField') runUpdateTagField(task);
    else if (task.type === 'addReflexiveChunk') runAddReflexiveChunk(task);
    else if (task.type === 'getDependencySlots') runGetDependencySlots(task);
    else if (task.type === 'setDependencySlot') runSetDependencySlot(task);
    else if (task.type === 'getBspRenderMesh') runGetBspRenderMesh(task);
    else if (task.type === 'getBitmapTexture') runGetBitmapTexture(task);
    else if (task.type === 'getScenarioObjects') runGetScenarioObjects(task);
    else if (task.type === 'getModelGeometry') runGetModelGeometry(task);
    else if (task.type === 'updateScenarioPlacement') runUpdateScenarioPlacement(task);
    else if (task.type === 'duplicateScenarioPlacement') runDuplicateScenarioPlacement(task);
    else if (task.type === 'addScenarioPlacement') runAddScenarioPlacement(task);
    else if (task.type === 'swapScenarioPlacement') runSwapScenarioPlacement(task);
    else if (task.type === 'deleteScenarioPlacement') runDeleteScenarioPlacement(task);
    else if (task.type === 'getReferencingTags') runGetReferencingTags(task);
    else if (task.type === 'getUnicodeStrings') runGetUnicodeStrings(task);
    else if (task.type === 'setUnicodeString') runSetUnicodeString(task);
    else if (task.type === 'renameTag') runRenameTag(task);
    else if (task.type === 'duplicateTag') runDuplicateTag(task);
    else if (task.type === 'deleteTag') runDeleteTag(task);
    else if (task.type === 'getSourceBspMesh') await runGetSourceBspMesh(task);
    else if (task.type === 'bspSwapPreflight') await runBspSwapPreflight(task);
    else if (task.type === 'performBspSwap') await runPerformBspSwap(task);
    else if (task.type === 'stageTagTestMap') runStageTagTestMap(task);
    else if (task.type === 'getBitmapInfo') runGetBitmapInfo(task);
    else if (task.type === 'getBitmapRgba') runGetBitmapRgba(task);
    else if (task.type === 'exportBitmap') runExportBitmap(task);
    else if (task.type === 'replaceBitmap') runReplaceBitmapImage(task);
    else if (task.type === 'getSoundInfo') runGetSoundInfo(task);
    else if (task.type === 'getSoundWav') runGetSoundWav(task);
    else if (task.type === 'exportSound') runExportSound(task);
    else if (task.type === 'replaceSound') runReplaceSound(task);
    else if (task.type === 'exportModel3d') runExportModel3d(task);
    else if (task.type === 'exportBsp3d') runExportBsp3d(task);
    else if (task.type === 'buildCustomObjectTag') runBuildCustomObjectTag(task);
    else if (task.type === 'inspectDeprotect') runInspectDeprotect(task);
    else if (task.type === 'deprotectMap') runDeprotectMap(task);
    else if (task.type === 'spoofMapCrc32') runSpoofMapCrc32(task);
    else if (task.type === 'decompileHaloScript') runDecompileHaloScript(task);
    else if (task.type === 'compileHaloScript') runCompileHaloScript(task);
    else if (task.type === 'setupScenarioScriptEntities') runSetupScenarioScriptEntities(task);
    else if (task.type === 'extractCollisionWireframe') runExtractCollisionWireframe(task);
    else if (task.type === 'convertCollisionToGbxmodel') runConvertCollisionToGbxmodel(task);
    else if (task.type === 'convertSbspToScenery') runConvertSbspToScenery(task);
    else if (task.type === 'convertObjectTagClass') runConvertObjectTagClass(task);
    else if (task.type === 'cleanOpenSauceYelo') runCleanOpenSauceYelo(task);
    else if (task.type === 'scanMapTagErrors') runScanMapTagErrors(task);
    else if (task.type === 'globalReplaceTagReference') runGlobalReplaceTagReference(task);
    else if (task.type === 'exportOpenCeModFolder') runExportOpenCeModFolder(task);
    else if (task.type === 'importLegacyTags') runImportLegacyTags(task);
    else if (task.type === 'replaceBitmapFromPngBytes') runReplaceBitmapFromPngBytes(task);
    else if (task.type === 'updateBspVertices') runUpdateBspVertices(task);
    else if (task.type === 'updateModelVertices') runUpdateModelVertices(task);
    else if (task.type === 'compareMaps') runCompareMaps(task);
    else if (task.type === 'deployMccMod') runDeployMccMod(task);
    else if (task.type === 'globalReplaceTagFieldValue') runGlobalReplaceTagFieldValue(task);
    else if (task.type === 'compileJmaAnimation') runCompileJmaAnimation(task);
    else if (task.type === 'compileJmsPhysics') runCompileJmsPhysics(task);
    else if (task.type === 'decompileTagToSource') runDecompileTagToSource(task);
    else if (task.type === 'compileStringsTag') runCompileStringsTag(task);
    else if (task.type === 'inspectMeterTag') runInspectMeterTag(task);
    else if (task.type === 'compileFontFromGlyphAtlas') runCompileFontFromGlyphAtlas(task);
    else if (task.type === 'injectProceduralWorldBsp') runInjectProceduralWorldBsp(task);
    else if (task.type === 'scaleCoupledPhysics') runScaleCoupledPhysics(task);
    else if (task.type === 'inspectLiveHudCatalog') runInspectLiveHudCatalog(task);
    else if (task.type === 'applyLiveHudEdit') runApplyLiveHudEdit(task);
    else if (task.type === 'applyLiveWeaponStatEdit') runApplyLiveWeaponStatEdit(task);
    else if (task.type === 'injectHudElementBitmap') runInjectHudElementBitmap(task);
    else if (task.type === 'inspectUiWidgetCanvas') runInspectUiWidgetCanvas(task);
    else if (task.type === 'updateUiWidgetPlacement') runUpdateUiWidgetPlacement(task);
    else if (task.type === 'saveUnicodeStringTable') runSaveUnicodeStringTable(task);
  } catch (err) {
    handleTaskError((task as { requestId: string }).requestId, err);
  }
});

// Startup self-check: every tag definition must resolve cleanly before the UI can trust this worker.
try {
  const stats = validateAllDefinitions();
  parentPort?.postMessage({ type: 'ready', info: `Worker loaded, definitions loaded (${stats.tagGroupCount} tag groups, ${stats.structCount} structs).` });
} catch (err) {
  parentPort?.postMessage({ type: 'ready', info: `Worker loaded, but definition validation FAILED: ${err instanceof Error ? err.message : String(err)}` });
}

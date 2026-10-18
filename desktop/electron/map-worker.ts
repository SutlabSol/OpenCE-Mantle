import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  inspectCustomEditionMap,
  compressCustomEditionMap,
  decompressCustomEditionMap,
  estimateTagFootprints,
  walkDependencies,
  extractTagSet,
  serializeContainer,
  deserializeContainer,
  planAddInjection,
  planSwapInjection,
  applyAddInjection,
  applySwapInjection,
  computeResourceMapIdentity,
  getGroupDefinition,
  validateAllDefinitions,
  verifyEmbeddedData,
  formatEmbeddedDataReport,
  finalizeForSave,
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
  TagFieldEditorError,
  listTagDependencySlots,
  setTagDependencySlot,
  TagDependencySwapError,
} from '../../core/src/index';
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
  UpdateTagFieldResult,
  GetDependencySlotsResult,
  SetDependencySlotResult,
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
    },
    tags: map.tagIndex.entries.map((e) => ({
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
  const inspected = inspectCustomEditionMap(buffer);
  if (inspected.status !== 'ok') throw new Error(`The result could not be read back as a Custom Edition map (${inspected.status}).`);
  return { filePath, buffer, header: inspected.header, tagIndex: inspected.tagIndex, modified, diskStat };
}

export async function runInspect(task: { requestId: string; filePath: string }) {
  progress(task.requestId, 'Reading file', 10);
  const buffer = fs.readFileSync(task.filePath);
  const diskStat = diskStatOf(task.filePath);
  progress(task.requestId, 'Parsing header and tag index', 50);
  currentInject = null;

  // Layouts the converter knows are reported as unsupported (with Convert offered for version 7)
  // before the CE reader sees them; the true demo layout would otherwise fail as "not a Halo map".
  const layout = classifyMapLayout(buffer);
  if (layout.kind === 'retail' || layout.kind === 'demo') {
    currentMap = null;
    progress(task.requestId, 'Done', 100);
    return sendResult(task.requestId, {
      status: 'unsupported',
      filePath: task.filePath,
      message: describeUnsupportedLayout(layout)!,
      layout: layout.kind,
      // Retail maps are convertible only at the CE base; a true demo map always converts via the Phase 2 demo converter.
      convertible: layout.kind === 'demo' ? true : isConvertibleRetailLayout(layout),
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

export function runExtractTags(task: { requestId: string; originalIndices: number[]; outputPath: string; sourceMapName: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  const cancelCtl = makeCancelController(task.requestId);
  const tempPath = `${task.outputPath}.tmp-${randomUUID()}`;
  const pendingTemps: string[] = [];
  try {
    if (task.originalIndices.length === 1) {
      progress(task.requestId, 'Walking dependencies', 5);
      const set = extractTagSet(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.originalIndices, {
        signal: cancelCtl.signal,
        onProgress: (i, total) => progress(task.requestId, `Extracting tag ${i + 1} of ${total}`, 10 + Math.round((i / Math.max(1, total)) * 70)),
      });
      if (cancelledRequests.has(task.requestId)) throw new OperationCancelledError();

      progress(task.requestId, 'Writing container file', 90);
      const containerBuffer = serializeContainer(set, task.sourceMapName);
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
      });
      if (cancelledRequests.has(task.requestId)) throw new OperationCancelledError();
      const buf = serializeContainer(set, task.sourceMapName);
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
    cancelCtl.stop();
    cancelledRequests.delete(task.requestId);
  }
}

export function runBatchExtract(task: {
  requestId: string;
  parentDir: string;
  sourceMapName: string;
  mode: BatchExtractMode;
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
        const set = extractTagSet(currentMap.buffer, currentMap.header, currentMap.tagIndex, [candidate.index], {
          signal: cancelCtl.signal,
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
  };
}

export function runPlanInject(task: { requestId: string; containerPath: string; mode: InjectionMode; resourceMapPaths: Partial<Record<ResourceMapKind, string>> }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open to inject into.');
  try {
    progress(task.requestId, 'Reading container file', 10);
    const containerBuffer = fs.readFileSync(task.containerPath);
    const container = deserializeContainer(containerBuffer);

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

/** M7a: Decodes all root-struct fields for the specified tag in the open map. */
export function runGetTagFields(task: { requestId: string; tagIndex: number }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
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

/** Dependency Swapper: lists every dependency slot of a tag (nested blocks and null slots included). */
export function runGetDependencySlots(task: { requestId: string; tagIndex: number }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  try {
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
    const res = setTagDependencySlot(currentMap.buffer, currentMap.header, currentMap.tagIndex, task.tagIndex, task.fieldPath, task.newTagId);
    currentMap.modified = true;
    sendResult(task.requestId, { ok: true, fieldPath: res.fieldPath, newTagId: res.newTagId, map: summarizeOpenMap(currentMap) } satisfies SetDependencySlotResult);
  } catch (err) {
    if (err instanceof TagDependencySwapError) return sendError(task.requestId, 'DEPENDENCY_SLOT_ERROR', err.message);
    handleTaskError(task.requestId, err);
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
    else if (task.type === 'getDependencySlots') runGetDependencySlots(task);
    else if (task.type === 'setDependencySlot') runSetDependencySlot(task);
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

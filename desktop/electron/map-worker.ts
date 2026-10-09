import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import {
  inspectCustomEditionMap,
  compressCustomEditionMap,
  decompressCustomEditionMap,
  estimateTagFootprints,
  walkDependencies,
  extractTagSet,
  serializeContainer,
  getGroupDefinition,
  validateAllDefinitions,
  AllTagsExcludedError,
  OperationCancelledError,
} from '../../core/src/index';
import type { CacheFileHeader, TagIndex } from '../../core/src/index';
import type {
  LoadMapResult,
  WorkerRequest,
  DependencyWalkSummary,
  DependencyTagInfo,
  DependencyNotExtractedInfo,
  DependencyWarningInfo,
  GetDependenciesResult,
  ExtractTagsResult,
} from './shared-types';

/**
 * Persistent, stateful worker (one per app session, started eagerly - see `worker-manager.ts`).
 * The open map's buffer/header/tagIndex is parsed once in `runInspect` and kept here; every
 * later request (`getDependencies`/`extractTags`) reuses it instead of re-reading/re-sending it.
 * All file I/O lives here, not in `/core` - `/core` stays pure (no fs/worker_threads imports).
 */
interface LoadedMap {
  filePath: string;
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
}

let currentMap: LoadedMap | null = null;
const cancelledRequests = new Set<string>();

function progress(requestId: string, stage: string, percent: number) {
  parentPort?.postMessage({ type: 'progress', requestId, stage, percent });
}
function sendResult(requestId: string, payload: unknown) {
  parentPort?.postMessage({ type: 'result', requestId, payload });
}
function sendError(requestId: string, code: string, message: string) {
  parentPort?.postMessage({ type: 'error', requestId, code, message });
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

function toWarningInfo(w: { originalIndex: number; path: string; group: string; kind: string; message: string }): DependencyWarningInfo {
  return { originalIndex: w.originalIndex, path: w.path, group: w.group, kind: w.kind as DependencyWarningInfo['kind'], message: w.message };
}

async function runInspect(task: { requestId: string; filePath: string }) {
  progress(task.requestId, 'Reading file', 10);
  const buffer = fs.readFileSync(task.filePath);
  progress(task.requestId, 'Parsing header and tag index', 50);
  const inspected = inspectCustomEditionMap(buffer);

  let payload: LoadMapResult;
  if (inspected.status === 'ok') {
    currentMap = { filePath: task.filePath, buffer, header: inspected.header, tagIndex: inspected.tagIndex };
    const sizes = sizeByIndex(inspected.header, inspected.tagIndex);
    payload = {
      status: 'ok',
      filePath: task.filePath,
      header: {
        scenarioName: inspected.header.scenarioName,
        buildString: inspected.header.buildString,
        mapType: inspected.header.mapType,
        crc32: inspected.header.crc32,
        tagDataOffset: inspected.header.tagDataOffset,
        tagDataSize: inspected.header.tagDataSize,
        decompressedFileSize: inspected.header.decompressedFileSize,
        fileSizeOnDisk: buffer.length,
        tagCount: inspected.tagIndex.tagCount,
      },
      tags: inspected.tagIndex.entries.map((e) => ({
        index: e.index,
        tagId: e.tagId,
        primaryClassName: e.primaryClassName ?? '?',
        path: e.path,
        isExternal: e.isExternal,
        estimatedSize: sizes.get(e.index) ?? null,
      })),
    };
  } else if (inspected.status === 'compressed') {
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

function runGetDependencies(task: { requestId: string; originalIndices: number[] }) {
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

function runExtractTags(task: { requestId: string; originalIndices: number[]; outputPath: string; sourceMapName: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  const cancelCtl = makeCancelController(task.requestId);
  const tempPath = `${task.outputPath}.tmp-${randomUUID()}`;
  try {
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
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      /* best-effort cleanup only */
    }
    handleTaskError(task.requestId, err);
  } finally {
    cancelCtl.stop();
    cancelledRequests.delete(task.requestId);
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

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
  deserializeContainer,
  planAddInjection,
  applyAddInjection,
  computeResourceMapIdentity,
  getGroupDefinition,
  validateAllDefinitions,
  AllTagsExcludedError,
  OperationCancelledError,
  ContainerFormatError,
} from '../../core/src/index';
import type { CacheFileHeader, TagIndex, OceContainer, AddInjectionPlan, ResourceMapConfig } from '../../core/src/index';
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
  InjectPlanSummary,
  ResourceMapKind,
} from './shared-types';

/**
 * Persistent, stateful worker (one per app session, started eagerly - see `worker-manager.ts`).
 * The open map's buffer/header/tagIndex is parsed once in `runInspect` and kept here; every
 * later request (`getDependencies`/`extractTags`) reuses it instead of re-reading/re-sending it.
 * All file I/O lives here, not in `/core` - `/core` stays pure (no fs/worker_threads imports).
 */
export interface LoadedMap {
  filePath: string;
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
}

let currentMap: LoadedMap | null = null;
let currentInject: { container: OceContainer; plan: AddInjectionPlan } | null = null;
const cancelledRequests = new Set<string>();

type Sink = (msg: { type: string; requestId?: string; [key: string]: unknown }) => void;
let sink: Sink = (msg) => parentPort?.postMessage(msg);

/** Test-only hook: redirect posted messages to a capture array instead of `parentPort` (which is null outside a real worker thread). */
export function __setSinkForTest(fn: Sink): void {
  sink = fn;
}
/** Test-only hook: inject an already-parsed map, skipping the real `inspect` file-read step. */
export function __setCurrentMapForTest(map: LoadedMap | null): void {
  currentMap = map;
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

function summarizePlan(containerPath: string, container: OceContainer, plan: AddInjectionPlan): InjectPlanSummary {
  return {
    containerPath,
    sourceMapName: container.sourceMapName,
    counts: plan.counts,
    toAdd: plan.toAdd.map((t) => ({ path: t.path, group: t.group })),
    reused: Array.from(plan.reusedByLocalIndex.keys()).map((li) => ({ path: container.tags[li].path, group: container.tags[li].group })),
    blockedEmbedded: plan.blockedEmbedded.map((b) => ({ path: b.path, group: b.group, reasons: b.reasons })),
    blockedOther: plan.blockedOther.map((b) => ({ path: b.path, group: b.group, reasons: b.reasons })),
    externalRefStatuses: plan.externalRefStatuses.map((r) => ({ path: r.path, group: container.tags[r.localIndex]?.group ?? '', resourceMap: r.resourceMap, status: r.status })),
    refusedRoots: plan.refusedRoots.map((r) => ({ path: r.path, reasons: r.reasons })),
  };
}

export function runPlanInject(task: { requestId: string; containerPath: string; resourceMapPaths: Partial<Record<ResourceMapKind, string>> }) {
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
    const planResult = planAddInjection(currentMap.tagIndex, container, resourceMapConfig);
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

export function runApplyInject(task: { requestId: string; outputPath: string }) {
  if (!currentMap) return sendError(task.requestId, 'NO_MAP_LOADED', 'No map is open.');
  if (!currentInject) return sendError(task.requestId, 'NO_PLAN', 'Run "Inject Tags..." and review the plan before applying it.');
  const tempPath = `${task.outputPath}.tmp-${randomUUID()}`;
  try {
    progress(task.requestId, 'Writing tag data', 30);
    const injected = applyAddInjection(currentMap.buffer, currentMap.header, currentMap.tagIndex, currentInject.container, currentInject.plan);
    progress(task.requestId, 'Writing output file', 80);
    fs.writeFileSync(tempPath, injected);
    fs.renameSync(tempPath, task.outputPath);
    progress(task.requestId, 'Done', 100);
    sendResult(task.requestId, {
      ok: true,
      outputPath: task.outputPath,
      addedCount: currentInject.plan.counts.added,
      reusedCount: currentInject.plan.counts.reused,
      staleChecksumWarning: 'This map\'s CRC32 and tag checksum are now stale (recalculating them is Milestone 6) - some tools/servers that verify them may reject it until then.',
    } satisfies ApplyInjectResult);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      /* best-effort cleanup only */
    }
    handleTaskError(task.requestId, err);
  } finally {
    currentInject = null;
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

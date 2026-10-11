/** Shared IPC contract between main, preload, and renderer. Kept dependency-free (no Electron types). */

import type { WarningKind } from '../../core/src/map/dependency-walker';
import type { RetailConversionReport } from '../../core/src/map/convert/retail-to-ce';
import type { TagDataRepairId } from '../../core/src/map/convert/tag-data-repairs';

export interface MapHeaderSummary {
  scenarioName: string;
  buildString: string;
  mapType: number;
  crc32: number;
  tagDataOffset: number;
  tagDataSize: number;
  decompressedFileSize: number;
  fileSizeOnDisk: number;
  tagCount: number;
}

export interface TagEntrySummary {
  index: number;
  tagId: number;
  primaryClassName: string;
  path: string;
  isExternal: boolean;
  estimatedSize: number | null;
}

export type LoadMapResult =
  /** `modified`: the worker's in-memory map has changes (Inject) not yet written by File > Save / Save As. Absent = false. */
  | { status: 'ok'; filePath: string; header: MapHeaderSummary; tags: TagEntrySummary[]; modified?: boolean }
  | { status: 'compressed'; filePath: string }
  /** `layout`: set for layouts the converter knows (retail 7, true demo 6). `convertible`: Convert to Custom Edition is offered. */
  | { status: 'unsupported'; filePath: string; message: string; layout?: 'retail' | 'demo'; convertible?: boolean }
  | { status: 'error'; message: string };

export interface ProgressEvent {
  taskId: string;
  stage: string;
  percent: number;
}

export interface LogEvent {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface CompressionResult {
  outputPath: string;
  originalSize: number;
  newSize: number;
}

/* ----------------------------- M4: dependency walk + extraction ----------------------------- */

export type DependencyTagStatus = 'ok' | 'bsp' | 'external' | 'uncertain' | 'noDefinition';

/** One extractable (or external) tag in a dependency dialog's tag list. */
export interface DependencyTagInfo {
  originalIndex: number;
  path: string;
  group: string;
  status: DependencyTagStatus;
  estimatedSize: number | null;
  /** Paths of tags that pulled this one in. Empty = one of the tags the user selected directly. */
  requiredBy: string[];
}

/** A tag that was reached but is excluded from extraction (e.g. scenario_structure_bsp). */
export interface DependencyNotExtractedInfo {
  originalIndex: number;
  path: string;
  group: string;
  reason: string;
  requiredBy: string[];
}

/** Derived from core's `WARNING_KINDS` so the two lists can't drift. */
export type DependencyWarningKind = WarningKind;

export interface DependencyWarningInfo {
  originalIndex: number;
  path: string;
  group: string;
  kind: DependencyWarningKind;
  message: string;
}

/** Result of a read-only `getDependencies` walk, used to populate the Dependency dialog. */
export interface DependencyWalkSummary {
  requestedOriginalIndices: number[];
  extractableTags: DependencyTagInfo[];
  notExtractedTags: DependencyNotExtractedInfo[];
  externalTags: DependencyTagInfo[];
  warnings: DependencyWarningInfo[];
  totalEstimatedSize: number;
  /** True when every reachable tag is non-extractable (e.g. a BSP-only selection) - nothing to write. */
  allExcluded: boolean;
}

export type GetDependenciesResult =
  | { ok: true; summary: DependencyWalkSummary }
  | { ok: false; code: string; message: string };

export interface ExtractTagsRequest {
  originalIndices: number[];
  /** Base file name (no extension) suggested for the native Save As dialog. */
  suggestedFileName: string;
}

export type ExtractTagsResult =
  | { ok: true; outputPath: string; tagCount: number; fileSizeBytes: number; carriedOverWarnings: DependencyWarningInfo[] }
  | { ok: false; code: 'CANCELLED'; message: string }
  | { ok: false; code: string; message: string };

export interface AppSettings {
  lastExtractDir: string | null;
  resourceMaps: { bitmaps: string | null; sounds: string | null; loc: string | null };
}

/* ------------------------------- M5 Step A: ADD-mode injection ------------------------------- */

export type ResourceMapKind = 'bitmaps' | 'sounds' | 'loc';

/** One row of the Settings "Resource Maps" section. */
export type ResourceMapStatus =
  | { state: 'not-configured' }
  | { state: 'missing-or-unreadable'; path: string; error: string }
  | { state: 'ok'; path: string; fileSizeBytes: number; entryCount: number };

export type ResourceMapPickResult = { ok: true; status: ResourceMapStatus } | { ok: false; code: 'CANCELLED' } | { ok: false; code: string; message: string };

export interface InjectPlanTagSummary {
  path: string;
  group: string;
}
export interface InjectPlanBlockedSummary extends InjectPlanTagSummary {
  reasons: string[];
}
export interface InjectPlanExternalRefSummary extends InjectPlanTagSummary {
  resourceMap: string;
  status: 'match' | 'mismatch' | 'unconfigured-on-target' | 'unverified-at-extraction';
}
export interface InjectPlanRefusedRootSummary {
  path: string;
  reasons: string[];
}

export type InjectionMode = 'add' | 'swap';

export interface InjectPlanSummary {
  mode: InjectionMode;
  containerPath: string;
  sourceMapName: string;
  counts: { totalInClosure: number; reused: number; swapped: number; added: number; blockedEmbedded: number; blockedOther: number; externalReferenced: number };
  toAdd: InjectPlanTagSummary[];
  toSwap: InjectPlanTagSummary[];
  reused: InjectPlanTagSummary[];
  blockedEmbedded: InjectPlanBlockedSummary[];
  blockedOther: InjectPlanBlockedSummary[];
  externalRefStatuses: InjectPlanExternalRefSummary[];
  refusedRoots: InjectPlanRefusedRootSummary[];
}

export type PlanInjectResult = { ok: true; plan: InjectPlanSummary } | { ok: false; code: string; message: string };

/** The open map as the renderer shows it (tag browser, info panel). */
export type OpenMapSummary = Extract<LoadMapResult, { status: 'ok' }>;

/** Inject applies to the worker's in-memory map only; nothing is written to disk. `map` is the refreshed, modified map. */
export type ApplyInjectResult =
  | { ok: true; addedCount: number; reusedCount: number; swappedCount: number; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

/**
 * File > Save (overwrites the open file) and File > Save As (writes a new file, which then becomes
 * the open map): scenario name set from the file name, header CRC32 recomputed. `map` is the open
 * map afterwards (not modified).
 */
export type SaveMapResult =
  | { ok: true; outputPath: string; scenarioName: string; previousScenarioName: string; crc32: number; warnings: string[]; staleChecksumWarning: string; map: OpenMapSummary }
  | { ok: false; code: string; message: string };
export type SaveMapAsResult = SaveMapResult;

/** File > Discard Changes: `map` is the file reopened from disk. */
export type DiscardChangesResult = { ok: true; map: LoadMapResult } | { ok: false; code: string; message: string };

export interface VerifyEmbeddedDataCounts {
  embedded: number;
  external: number;
  embeddedInBounds: number;
  embeddedOutOfBounds: number;
  overlapping: number;
  unreadable: number;
  blockedTags: number;
}

export type VerifyEmbeddedDataResult =
  | { ok: true; mapLabel: string; totalBitmapSoundTags: number; checkedTags: number; counts: VerifyEmbeddedDataCounts; reportText: string }
  | { ok: false; code: string; message: string };

/* ---------------------- Converter Phase 1: retail layout (7) -> Custom Edition (609) ---------------------- */

export type { RetailConversionReport, TagDataRepairId };

/** The tag data repairs ticked in the Convert dialog (see `RetailConversionReport.repairs`). */
export type ConvertRepairChoice = Partial<Record<TagDataRepairId, boolean>>;

/** Pre-flight for Convert to Custom Edition. Main keeps the source path; the renderer only gets its file name. */
export type ConvertPreflightResult = { ok: true; sourceFileName: string; report: RetailConversionReport } | { ok: false; code: string; message: string };

/**
 * The converted map was written to a new file (temp file + rename; name and CRC32 set by
 * finalizeForSave) and is now the open, unmodified map. The source file is never written.
 */
export type ConvertMapResult =
  | {
      ok: true;
      sourcePath: string;
      outputPath: string;
      scenarioName: string;
      previousScenarioName: string;
      crc32: number;
      previousCrc32: number;
      warnings: string[];
      staleChecksumWarning: string;
      map: OpenMapSummary;
    }
  | { ok: false; code: string; message: string };

/* --------------------------- main <-> worker thread protocol (internal) --------------------------- */

export type WorkerRequest =
  | { type: 'inspect'; requestId: string; filePath: string }
  | { type: 'compress' | 'decompress'; requestId: string; filePath: string; outputPath: string }
  | { type: 'getDependencies'; requestId: string; originalIndices: number[] }
  | { type: 'extractTags'; requestId: string; originalIndices: number[]; outputPath: string; sourceMapName: string }
  | { type: 'planInject'; requestId: string; containerPath: string; mode: InjectionMode; resourceMapPaths: Partial<Record<ResourceMapKind, string>> }
  | { type: 'applyInject'; requestId: string }
  | { type: 'saveMap'; requestId: string }
  | { type: 'saveMapAs'; requestId: string; outputPath: string }
  | { type: 'verifyEmbeddedData'; requestId: string }
  | { type: 'convertPreflight'; requestId: string; filePath: string }
  | { type: 'convertMap'; requestId: string; sourcePath: string; outputPath: string; acknowledgeScripts: boolean; repairs: ConvertRepairChoice }
  | { type: 'cancel'; requestId: string };

export type WorkerResponse =
  | { type: 'ready'; info: string }
  | { type: 'progress'; requestId: string; stage: string; percent: number }
  | { type: 'result'; requestId: string; payload: unknown }
  | { type: 'error'; requestId: string; code: string; message: string };

/* --------------------------------------------- API --------------------------------------------- */

export interface OpenceApi {
  /** null: cancelled (in the file dialog, or in the unsaved-changes prompt). */
  openMapDialog(): Promise<LoadMapResult | null>;
  /** null: cancelled in the unsaved-changes prompt; the current map stays open. */
  loadMap(filePath: string): Promise<LoadMapResult | null>;
  decompressMap(filePath: string): Promise<CompressionResult | null>;
  recompressMap(filePath: string): Promise<CompressionResult | null>;
  getDependencies(originalIndices: number[]): Promise<GetDependenciesResult>;
  extractTags(request: ExtractTagsRequest): Promise<ExtractTagsResult>;
  cancelExtraction(): void;
  pickResourceMap(kind: ResourceMapKind): Promise<ResourceMapPickResult>;
  getResourceMapStatuses(): Promise<Record<ResourceMapKind, ResourceMapStatus>>;
  pickInjectContainer(): Promise<{ path: string } | null>;
  planInject(containerPath: string, mode: InjectionMode): Promise<PlanInjectResult>;
  /** Applies the reviewed plan to the open map in memory. Writes nothing; File > Save / Save As do. */
  applyInject(): Promise<ApplyInjectResult>;
  /** File > Save: overwrites the open file (temp file + atomic rename). Only while modified; never for a .bak. */
  saveMap(): Promise<SaveMapResult>;
  /** File > Save As: main shows the native dialog, refuses the open map's own path, and has the worker write the copy. */
  saveMapAs(): Promise<SaveMapAsResult>;
  /** File > Discard Changes: asks, then reopens the open file from disk. null: cancelled. */
  discardChanges(): Promise<DiscardChangesResult | null>;
  verifyEmbeddedData(): Promise<VerifyEmbeddedDataResult>;
  /**
   * Convert to Custom Edition, step 1: 'open' checks the map just opened (the unsupported banner);
   * 'pick' shows a file dialog first. null: the file dialog was cancelled.
   */
  convertPreflight(source: 'open' | 'pick'): Promise<ConvertPreflightResult | null>;
  /** Step 2: converts the map from the last pre-flight. Main shows the Save dialog and refuses the source path. */
  convertMap(acknowledgeScripts: boolean, repairs: ConvertRepairChoice): Promise<ConvertMapResult>;
  openContainingFolder(filePath: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  notImplemented(feature: string): void;
  showAbout(): Promise<void>;
  getAppVersion(): Promise<string>;
  getRecentMaps(): Promise<string[]>;
  onProgress(cb: (e: ProgressEvent) => void): () => void;
  onLog(cb: (e: LogEvent) => void): () => void;
  onMenuAction(cb: (action: string) => void): () => void;
  onMapLoaded(cb: (result: LoadMapResult) => void): () => void;
  /** The open map changed in place (Inject applied, saved, discarded): refresh it, keep the selection. */
  onMapUpdated(cb: (result: OpenMapSummary) => void): () => void;
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    opence: OpenceApi;
  }
}

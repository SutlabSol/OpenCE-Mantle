/** Shared IPC contract between main, preload, and renderer. Kept dependency-free (no Electron types). */

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
  | { status: 'ok'; filePath: string; header: MapHeaderSummary; tags: TagEntrySummary[] }
  | { status: 'compressed'; filePath: string }
  | { status: 'unsupported'; filePath: string; message: string }
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

export type DependencyWarningKind = 'uncertainGroup' | 'noDefinition' | 'externalTag' | 'externalData' | 'embeddedRawData' | 'bspTag';

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

export interface InjectPlanSummary {
  containerPath: string;
  sourceMapName: string;
  counts: { totalInClosure: number; reused: number; added: number; blockedEmbedded: number; blockedOther: number; externalReferenced: number };
  toAdd: InjectPlanTagSummary[];
  reused: InjectPlanTagSummary[];
  blockedEmbedded: InjectPlanBlockedSummary[];
  blockedOther: InjectPlanBlockedSummary[];
  externalRefStatuses: InjectPlanExternalRefSummary[];
  refusedRoots: InjectPlanRefusedRootSummary[];
}

export type PlanInjectResult = { ok: true; plan: InjectPlanSummary } | { ok: false; code: string; message: string };

export type ApplyInjectResult =
  | { ok: true; outputPath: string; addedCount: number; reusedCount: number; staleChecksumWarning: string }
  | { ok: false; code: 'CANCELLED'; message: string }
  | { ok: false; code: string; message: string };

/* --------------------------- main <-> worker thread protocol (internal) --------------------------- */

export type WorkerRequest =
  | { type: 'inspect'; requestId: string; filePath: string }
  | { type: 'compress' | 'decompress'; requestId: string; filePath: string; outputPath: string }
  | { type: 'getDependencies'; requestId: string; originalIndices: number[] }
  | { type: 'extractTags'; requestId: string; originalIndices: number[]; outputPath: string; sourceMapName: string }
  | { type: 'planInject'; requestId: string; containerPath: string; resourceMapPaths: Partial<Record<ResourceMapKind, string>> }
  | { type: 'applyInject'; requestId: string; outputPath: string }
  | { type: 'cancel'; requestId: string };

export type WorkerResponse =
  | { type: 'ready'; info: string }
  | { type: 'progress'; requestId: string; stage: string; percent: number }
  | { type: 'result'; requestId: string; payload: unknown }
  | { type: 'error'; requestId: string; code: string; message: string };

/* --------------------------------------------- API --------------------------------------------- */

export interface OpenceApi {
  openMapDialog(): Promise<LoadMapResult | null>;
  loadMap(filePath: string): Promise<LoadMapResult>;
  decompressMap(filePath: string): Promise<CompressionResult | null>;
  recompressMap(filePath: string): Promise<CompressionResult | null>;
  getDependencies(originalIndices: number[]): Promise<GetDependenciesResult>;
  extractTags(request: ExtractTagsRequest): Promise<ExtractTagsResult>;
  cancelExtraction(): void;
  pickResourceMap(kind: ResourceMapKind): Promise<ResourceMapPickResult>;
  getResourceMapStatuses(): Promise<Record<ResourceMapKind, ResourceMapStatus>>;
  pickInjectContainer(): Promise<{ path: string } | null>;
  planInject(containerPath: string): Promise<PlanInjectResult>;
  applyInject(): Promise<ApplyInjectResult>;
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
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    opence: OpenceApi;
  }
}

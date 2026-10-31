import type { WarningKind } from '../../core/src/map/dependency-walker';
import type { RetailConversionReport } from '../../core/src/map/convert/retail-to-ce';
import type { TagDataRepairId } from '../../core/src/map/convert/tag-data-repairs';
import type { TagFieldDescriptor, TagFieldsResult, TagFieldKind, TagReflexiveElement } from '../../core/src/map/tag-field-editor';
import type { TagDependencySlot } from '../../core/src/map/tag-dependency-swapper';
import type { BspRenderMesh } from '../../core/src/render/bsp-geometry';
import type { DecodedRgbaTexture } from '../../core/src/render/bitmap-textures';
import type {
  ScenarioObjectPlacement,
  ScenarioPlacementsSummary,
  ScenarioObjectKind,
  ScenarioPaletteItem,
} from '../../core/src/render/scenario-objects';
import type { ModelRenderGeometry } from '../../core/src/render/model-geometry';
import type { ReferencingTagSummary } from '../../core/src/map/tag-reverse-dependencies';
import type { UnicodeStringItem, UnicodeStringListResult } from '../../core/src/map/unicode-string-editor';
import type {
  BspInfo,
  BspSwapPreflightResult,
  BspSwapOptions,
  BspSwapResult,
  BspModelSwapOptions,
  BspModelPreflightResult,
  BspModelSwapResult,
} from '../../core/src/map/bsp-swapper';
import type { BitmapTagSummary, BitmapImageInfo, BitmapSequenceInfo } from '../../core/src/render/bitmap-codec';
import type { SoundTagSummary, SoundPitchRangeInfo, SoundPermutationInfo } from '../../core/src/render/sound-codec';
import type { WrlDiagnostics, WrlPoint, WrlSegment, WrlFace, WrlSubmeshMatch, ToolDiagnostic, ToolLogReview } from '../../core/src/render/wrl-diagnostics';
import type { MeshIntegrityReview } from '../../core/src/render/mesh-integrity';
import type { MapComparisonReport, MapDifferenceRow, MapDifferenceCategory } from '../../core/src/map/map-compare';
import type { ClassConflictInfo } from '../../core/src/map/tag-injector';
import type {
  LiveHudCatalog,
  LiveWeaponEntry,
  LiveVehicleEntry,
  LiveHudLevel,
  LiveHudElementItem,
  LiveWeaponStatField,
  LiveUiWidgetSummary,
  ApplyLiveHudEditRequest,
  ApplyLiveWeaponStatEditRequest,
  GuidedHudBitmapInjectRequest,
  UiWidgetCanvasNode,
  UpdateUiWidgetPlacementRequest,
  LiveMemoryPatch,
  LiveHudSessionSetupInfo,
} from '../../core/src/map/live-hud-editor';
import type {
  LooseTagsWorkspaceIndex,
  LooseWorkspaceTagEntry,
  LooseTagDependencyRef,
  BrokenLooseTagDependency,
  ContentExplorerNodeResult,
  ContentExplorerRelationItem,
  AutoFixDependenciesReport,
  BlockOrganizerPlanItem,
  BlamFunctionCurveParams,
  BlamFunctionCurveEvaluation,
  HudMessageSafetyReport,
  HaloStringMarkupToken,
  StringsCsvImportPreview,
  HaloScriptDocEntry,
  ToolCommandSchema,
  ToolCommandArgSchema,
} from '../../core/src/map/baboon-features';

export type {
  TagFieldDescriptor,
  TagFieldsResult,
  TagFieldKind,
  TagReflexiveElement,
  TagDependencySlot,
  BspRenderMesh,
  DecodedRgbaTexture,
  ScenarioObjectPlacement,
  ScenarioPlacementsSummary,
  ScenarioObjectKind,
  ScenarioPaletteItem,
  ModelRenderGeometry,
  ReferencingTagSummary,
  UnicodeStringItem,
  UnicodeStringListResult,
  BspInfo,
  BspSwapPreflightResult,
  BspSwapOptions,
  BspSwapResult,
  BspModelSwapOptions,
  BspModelPreflightResult,
  BspModelSwapResult,
  BitmapTagSummary,
  BitmapImageInfo,
  BitmapSequenceInfo,
  SoundTagSummary,
  SoundPitchRangeInfo,
  SoundPermutationInfo,
  WrlDiagnostics,
  WrlPoint,
  WrlSegment,
  WrlFace,
  WrlSubmeshMatch,
  ToolDiagnostic,
  ToolLogReview,
  MeshIntegrityReview,
  MapComparisonReport,
  MapDifferenceRow,
  MapDifferenceCategory,
  ClassConflictInfo,
  LiveHudCatalog,
  LiveWeaponEntry,
  LiveVehicleEntry,
  LiveHudLevel,
  LiveHudElementItem,
  LiveWeaponStatField,
  LiveUiWidgetSummary,
  ApplyLiveHudEditRequest,
  ApplyLiveWeaponStatEditRequest,
  GuidedHudBitmapInjectRequest,
  UiWidgetCanvasNode,
  UpdateUiWidgetPlacementRequest,
  LiveMemoryPatch,
  LiveHudSessionSetupInfo,
  LooseTagsWorkspaceIndex,
  LooseWorkspaceTagEntry,
  LooseTagDependencyRef,
  BrokenLooseTagDependency,
  ContentExplorerNodeResult,
  ContentExplorerRelationItem,
  AutoFixDependenciesReport,
  BlockOrganizerPlanItem,
  BlamFunctionCurveParams,
  BlamFunctionCurveEvaluation,
  HudMessageSafetyReport,
  HaloStringMarkupToken,
  StringsCsvImportPreview,
  HaloScriptDocEntry,
  ToolCommandSchema,
  ToolCommandArgSchema,
};

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
  engine?: number;
  mapEdition?: HaloBitmapVersion;
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
  /** Output tag format: 'blam' (default standard 64-byte 'blam' loose tags) or 'ocetags' (secondary OpenCE container). */
  format?: 'blam' | 'ocetags';
  /** Custom item name for OpenCE Forge export (e.g. "Gauss Sniper"). */
  itemName?: string;
  /** Optional map of originalIndex -> custom item name when extracting multiple items. */
  itemNames?: Record<number, string>;
  /** Whether to capture gbxmodel raw data (vertices and triangle strips) into embeddedRawDataAssets. */
  captureGbxmodelRawData?: boolean;
}

export type ExtractTagsResult =
  | { ok: true; outputPath: string; tagCount: number; fileSizeBytes: number; carriedOverWarnings: DependencyWarningInfo[]; outputFiles?: string[]; format?: 'blam' | 'ocetags' }
  | { ok: false; code: 'CANCELLED'; message: string }
  | { ok: false; code: string; message: string };

/* ------------------------------- Roadmap Item C: Whole Map Batch Extract ------------------------------- */

export type BatchExtractMode = 'skip' | 'replace';
export type BatchExtractFormat = 'blam' | 'ocetags' | 'data_source';

export interface BatchExtractManifestFileEntry {
  path: string;
  group: string;
  relativePath: string;
  sizeBytes: number;
  tagCount: number;
}

export interface BatchExtractManifestItem {
  path: string;
  group: string;
  reason: string;
}

export interface BatchExtractManifest {
  manifestVersion: 1;
  toolVersion: string;
  containerVersion: number;
  extractedAt: string;
  mapFileName: string;
  scenarioName: string;
  mapCrc32?: number;
  summary: {
    totalTagsInMap: number;
    extractedCount: number;
    skippedExistingCount: number;
    externalCount: number;
    blockedCount: number;
    failedCount: number;
    totalBytesWritten: number;
  };
  files: BatchExtractManifestFileEntry[];
  blocked: BatchExtractManifestItem[];
  external: BatchExtractManifestItem[];
}

export interface BatchExtractTagReport {
  path: string;
  group: string;
  status: 'extracted' | 'skipped-existing' | 'blocked' | 'external' | 'failed';
  reason?: string;
  outputPath?: string;
  sizeBytes?: number;
  tagCount?: number;
  warnings?: DependencyWarningInfo[];
}

export interface BatchExtractSummary {
  mapName: string;
  targetDir: string;
  totalTagsInMap: number;
  extractedCount: number;
  skippedCount: number;
  blockedCount: number;
  externalCount: number;
  failedCount: number;
  totalBytesWritten: number;
  elapsedMs: number;
  tags: BatchExtractTagReport[];
  manifestPath?: string;
  reportPath?: string;
  stagingDir?: string;
}

export interface BatchExtractPreflightResult {
  ok: true;
  mapName: string;
  scenarioName: string;
  parentDir: string;
  targetDir: string;
  totalTags: number;
  extractableCount: number;
  externalCount: number;
  blockedCount: number;
  estimatedTotalBytes: number;
  freeSpaceBytes: number | null;
  existingFileCount: number;
}

export type BatchExtractResult =
  | { ok: true; summary: BatchExtractSummary }
  | { ok: false; code: 'CANCELLED'; message: string; partialSummary?: BatchExtractSummary; stagingDir?: string; targetDir?: string }
  | { ok: false; code: string; message: string };

export interface FinalizeBatchExtractRequest {
  action: 'keep' | 'delete';
  stagingDir: string;
  targetDir: string;
  summary?: BatchExtractSummary;
}

export interface VersionResourceMaps {
  bitmaps: string | null;
  sounds: string | null;
  loc?: string | null;
}

export type AppThemeId = 'dark' | 'light' | 'forerunner' | 'classic-ce' | 'covenant' | 'unsc';

export interface BspTopDownWireframeData {
  aspect: number;
  totalVertices: number;
  totalTriangles: number;
  bspCount: number;
  segments: Array<[number, number, number, number, number, number, number]>;
}

export interface RecentMapCardEntry {
  filePath: string;
  fileName: string;
  scenarioName: string;
  engine: number;
  mapEdition: string;
  mapType: number;
  tagCount: number;
  fileSizeBytes: number;
  lastOpenedAt: number;
  pinned?: boolean;
  wireframe: BspTopDownWireframeData | null;
}

export interface OpenMapTabSession {
  sessionId: string;
  filePath: string;
  fileName: string;
  scenarioName: string;
  modified: boolean;
  detachedWindowId?: number | null;
  map: Extract<LoadMapResult, { status: 'ok' }>;
}

export interface AppSettings {
  lastExtractDir: string | null;
  resourceMaps: { bitmaps: string | null; sounds: string | null; loc: string | null };
  versionResourceMaps?: Partial<Record<HaloBitmapVersion, VersionResourceMaps>>;
  openCeDirectory?: string | null;
  openCeExecutablePath?: string | null;
  /** Whether to automatically check GitHub Releases for a newer version when the app launches (default: true). */
  checkForUpdatesOnLaunch?: boolean;
  /** Whether to automatically download a newer release in the background once detected (default: false). */
  autoDownloadUpdates?: boolean;
  /** Version string the user clicked "Skip This Version" on, if any. */
  skippedUpdateVersion?: string | null;
  /** Selected UI & Blueprint theme (default: 'dark'). */
  theme?: AppThemeId;
}

export interface UpdateReleaseAsset {
  name: string;
  browserDownloadUrl: string;
  sizeBytes: number;
}

export type UpdateDownloadStage = 'downloading' | 'ready' | 'applying' | 'error';

export interface UpdateDownloadProgressEvent {
  stage: UpdateDownloadStage;
  version: string;
  assetName: string;
  installMode: 'installer' | 'portable';
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  downloadedFilePath?: string;
  error?: string;
}

export type DownloadUpdateResult =
  | {
      ok: true;
      version: string;
      assetName: string;
      installMode: 'installer' | 'portable';
      downloadedFilePath: string;
      sizeBytes: number;
    }
  | {
      ok: false;
      error: string;
    };

export type UpdateCheckResult =
  | {
      ok: true;
      currentVersion: string;
      latestVersion: string;
      updateAvailable: boolean;
      releaseName: string;
      releaseNotes: string;
      publishedAt: string | null;
      htmlUrl: string;
      installerAsset: UpdateReleaseAsset | null;
      portableAsset: UpdateReleaseAsset | null;
      checkedAt: string;
    }
  | {
      ok: false;
      currentVersion: string;
      error: string;
      checkedAt: string;
    };

/* ------------------------------- M5 Step A: ADD-mode injection ------------------------------- */

export type ResourceMapKind = 'bitmaps' | 'sounds' | 'loc';

/** One row of the Settings "Resource Maps" section. */
export type ResourceMapStatus =
  | { state: 'not-configured' }
  | { state: 'missing-or-unreadable'; path: string; error: string }
  | { state: 'ok'; path: string; fileSizeBytes: number; entryCount: number };

export type ResourceMapPickResult = { ok: true; status: ResourceMapStatus } | { ok: false; code: 'CANCELLED' } | { ok: false; code: string; message: string };

export type HaloBitmapVersion = 'halomd' | 'ce' | 'pc' | 'demo' | 'mcc' | 'xbox';

export interface BitmapIdentificationEntry {
  index: number;
  name: string;
  dataOffset: number;
  size: number;
}

export interface BitmapIdentificationResult {
  ok: boolean;
  error?: string;
  filePath: string;
  fileSizeBytes: number;
  resourceKind?: 'bitmaps' | 'sounds' | 'loc';
  entryCount: number;
  tableOffset: number;
  detectedVersion: HaloBitmapVersion | 'unknown';
  versionMatchConfidence: 'exact' | 'likely' | 'mismatch';
  versionNote?: string;
  entries: BitmapIdentificationEntry[];
  compatibility?: {
    hasOpenMap: boolean;
    openMapName?: string;
    totalExternalBitmaps: number;
    matchedExternalBitmaps: number;
    missingBitmaps: string[];
    isCompatible: boolean;
  };
}

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
  classConflicts?: ClassConflictInfo[];
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

/** The source game's bitmap and sound maps (e.g. HaloMD's bitmaps.map / sounds.map), optionally chosen per convert run. */
export interface ConvertResourcePaths {
  bitmaps?: string;
  sounds?: string;
}

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

export interface GetBitmapInfoResult {
  ok: boolean;
  summary?: BitmapTagSummary;
  code?: string;
  message?: string;
}

export interface GetBitmapRgbaResult {
  ok: boolean;
  width?: number;
  height?: number;
  dataUrl?: string;
  code?: string;
  message?: string;
}

export interface ExportBitmapResult {
  ok: boolean;
  filePath?: string;
  code?: string;
  message?: string;
}

export interface ReplaceBitmapResult {
  ok: boolean;
  map?: OpenMapSummary;
  code?: string;
  message?: string;
}

export interface GetSoundInfoResult {
  ok: boolean;
  summary?: SoundTagSummary;
  code?: string;
  message?: string;
}

export interface GetSoundWavResult {
  ok: boolean;
  dataUrl?: string;
  sampleRate?: number;
  channels?: number;
  durationSeconds?: number;
  code?: string;
  message?: string;
}

export interface ExportSoundResult {
  ok: boolean;
  filePath?: string;
  code?: string;
  message?: string;
}

export interface ReplaceSoundResult {
  ok: boolean;
  map?: OpenMapSummary;
  code?: string;
  message?: string;
}

export interface Export3dResult {
  ok: boolean;
  filePath?: string;
  code?: string;
  message?: string;
}

export type WorkerRequest =
  | { type: 'inspect'; requestId: string; filePath: string; sessionId?: string }
  | { type: 'activateMapSession'; requestId: string; sessionId: string }
  | { type: 'closeMapSession'; requestId: string; sessionId: string }
  | { type: 'compress' | 'decompress'; requestId: string; filePath: string; outputPath: string }
  | { type: 'getDependencies'; requestId: string; originalIndices: number[] }
  | {
      type: 'extractTags';
      requestId: string;
      originalIndices: number[];
      outputPath: string;
      sourceMapName: string;
      format?: 'blam' | 'ocetags';
      resourceMapPaths?: Partial<Record<ResourceMapKind, string>>;
      itemName?: string;
      itemNames?: Record<number, string>;
      captureGbxmodelRawData?: boolean;
    }
  | { type: 'planInject'; requestId: string; containerPath: string; mode: InjectionMode; resourceMapPaths: Partial<Record<ResourceMapKind, string>>; fallbackPcResourcePaths?: Partial<Record<ResourceMapKind, string>> }
  | { type: 'applyInject'; requestId: string }
  | { type: 'saveMap'; requestId: string }
  | { type: 'saveMapAs'; requestId: string; outputPath: string }
  | { type: 'verifyEmbeddedData'; requestId: string }
  | { type: 'convertPreflight'; requestId: string; filePath: string; bitmapsPath?: string; soundsPath?: string }
  | { type: 'convertMap'; requestId: string; sourcePath: string; outputPath: string; acknowledgeScripts: boolean; repairs: ConvertRepairChoice; bitmapsPath?: string; soundsPath?: string }
  | {
      type: 'batchExtract';
      requestId: string;
      parentDir: string;
      sourceMapName: string;
      mode: BatchExtractMode;
      extractFormat?: BatchExtractFormat;
      resourceMapPaths: Partial<Record<ResourceMapKind, string>>;
    }
  | { type: 'getTagFields'; requestId: string; tagIndex: number }
  | { type: 'updateTagField'; requestId: string; tagIndex: number; fieldName: string; newValue: unknown }
  | { type: 'addReflexiveChunk'; requestId: string; tagIndex: number; reflexiveFieldPath: string; cloneFromIndex?: number }
  | { type: 'getDependencySlots'; requestId: string; tagIndex: number }
  | { type: 'setDependencySlot'; requestId: string; tagIndex: number; fieldPath: string; newTagId: number | null }
  | { type: 'getBspRenderMesh'; requestId: string; bspIndex?: number }
  | { type: 'getBitmapTexture'; requestId: string; bitmapTagId: number; imageIndex?: number; bitmapsPath?: string }
  | { type: 'getScenarioObjects'; requestId: string }
  | { type: 'getModelGeometry'; requestId: string; modelTagId: number; lod?: number }
  | {
      type: 'updateScenarioPlacement';
      requestId: string;
      placementId: string;
      position?: [number, number, number];
      rotation?: [number, number, number];
      paletteIndex?: number;
      teamIndex?: number;
      multiplayerSpawnFlags?: number;
      forceSpawn?: boolean;
    }
  | {
      type: 'duplicateScenarioPlacement';
      requestId: string;
      placementId: string;
      offsetDelta?: [number, number, number];
    }
  | {
      type: 'addScenarioPlacement';
      requestId: string;
      kind: ScenarioObjectKind;
      paletteIndex: number;
      position: [number, number, number];
      rotation?: [number, number, number];
      teamIndex?: number;
    }
  | {
      type: 'swapScenarioPlacement';
      requestId: string;
      placementId: string;
      newKind: ScenarioObjectKind;
      newPaletteIndex: number;
    }
  | {
      type: 'deleteScenarioPlacement';
      requestId: string;
      placementId: string;
    }
  | { type: 'getReferencingTags'; requestId: string; tagIndex: number }
  | { type: 'getUnicodeStrings'; requestId: string; tagIndex: number }
  | { type: 'setUnicodeString'; requestId: string; tagIndex: number; stringIndex: number; newText: string }
  | { type: 'renameTag'; requestId: string; tagIndex: number; newPath: string }
  | { type: 'duplicateTag'; requestId: string; tagIndex: number; newPath: string }
  | { type: 'deleteTag'; requestId: string; tagIndex: number }
  | { type: 'bspSwapPreflight'; requestId: string; sourceFilePath: string; sourceBspIndex?: number; targetBspIndex?: number; sourceBspIndices?: number[] }
  | { type: 'getSourceBspMesh'; requestId: string; sourceFilePath: string; bspIndex?: number }
  | { type: 'performBspSwap'; requestId: string; sourceFilePath: string; options: BspSwapOptions; resourceMapPaths?: Partial<Record<ResourceMapKind, string | undefined>> }
  | { type: 'bspModelPreflight'; requestId: string; modelPath: string; targetBspIndex?: number; options?: BspModelSwapOptions }
  | { type: 'bspSwapFromModelFile'; requestId: string; modelPath: string; options?: BspModelSwapOptions }
  | { type: 'stageTagTestMap'; requestId: string; targetPath: string; bitmapsPath?: string; soundsPath?: string; liveHudMode?: boolean }
  | { type: 'getBitmapInfo'; requestId: string; tagIndex: number; bitmapsPath?: string }
  | { type: 'getBitmapRgba'; requestId: string; tagIndex: number; imageIndex: number; bitmapsPath?: string }
  | { type: 'exportBitmap'; requestId: string; tagIndex: number; imageIndex: number; format: 'png' | 'dds'; outputPath: string; bitmapsPath?: string }
  | { type: 'replaceBitmap'; requestId: string; tagIndex: number; imageIndex: number; inputPath: string; targetFormat?: number; bitmapsPath?: string }
  | { type: 'getSoundInfo'; requestId: string; tagIndex: number; soundsPath?: string }
  | { type: 'getSoundWav'; requestId: string; tagIndex: number; pitchRangeIndex: number; permutationIndex: number; soundsPath?: string }
  | { type: 'exportSound'; requestId: string; tagIndex: number; pitchRangeIndex: number; permutationIndex: number; outputPath: string; soundsPath?: string }
  | { type: 'replaceSound'; requestId: string; tagIndex: number; pitchRangeIndex: number; permutationIndex: number; inputPath: string; targetFormat?: number; soundsPath?: string }
  | { type: 'exportModel3d'; requestId: string; modelTagId: number; lod?: number; format: 'obj' | 'glb'; outputPath: string }
  | { type: 'exportBsp3d'; requestId: string; bspIndex: number; format: 'obj' | 'glb'; outputPath: string }
  | {
      type: 'buildCustomObjectTag';
      requestId: string;
      request: BuildCustomObjectRequest;
      resourceMapPaths?: Partial<Record<ResourceMapKind, string>>;
    }
  | { type: 'inspectDeprotect'; requestId: string }
  | { type: 'deprotectMap'; requestId: string; options?: DeprotectMapOptions }
  | { type: 'spoofMapCrc32'; requestId: string; targetCrc32: number }
  | { type: 'decompileHaloScript'; requestId: string }
  | { type: 'compileHaloScript'; requestId: string; hscSource: string }
  | {
      type: 'setupScenarioScriptEntities';
      requestId: string;
      required: { objectNames?: string[]; triggerVolumes?: string[]; cameraPoints?: string[] };
    }
  | { type: 'extractCollisionWireframe'; requestId: string; collTagIndex: number }
  | { type: 'convertCollisionToGbxmodel'; requestId: string; collTagIndex: number; targetPath?: string }
  | { type: 'convertSbspToScenery'; requestId: string; bspTagIndex?: number; targetPath?: string }
  | { type: 'convertObjectTagClass'; requestId: string; sourceTagIndex: number; targetGroup: string; targetPath?: string }
  | { type: 'cleanOpenSauceYelo'; requestId: string }
  | { type: 'scanMapTagErrors'; requestId: string }
  | { type: 'globalReplaceTagReference'; requestId: string; fromTagId: number; toTagId: number }
  | {
      type: 'exportOpenCeModFolder';
      requestId: string;
      rootTagIndices: number[];
      modName: string;
      version?: string;
      author?: string;
      description?: string;
      includeDependencies?: boolean;
      replaceTargetTagIndex?: number;
      parentOutputDir: string;
      bitmapsPath?: string;
      soundsPath?: string;
      locPath?: string;
    }
  | {
      type: 'importLegacyTags';
      requestId: string;
      inputPaths: string[];
      mode?: 'add' | 'swap';
      bitmapsPath?: string;
      soundsPath?: string;
      locPath?: string;
    }
  | {
      type: 'replaceBitmapFromPngBytes';
      requestId: string;
      tagIndex: number;
      imageIndex: number;
      pngBytes: Uint8Array;
      targetFormat?: number;
      bitmapsPath?: string;
    }
  | {
      type: 'updateBspVertices';
      requestId: string;
      bspIndex: number;
      submeshUpdates: Array<{
        submeshIndex: number;
        positions: Float32Array | number[];
        normals?: Float32Array | number[];
        uvs?: Float32Array | number[];
        shaderTagId?: number;
      }>;
    }
  | {
      type: 'updateModelVertices';
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
    }
  | { type: 'compareMaps'; requestId: string; otherFilePath: string }
  | {
      type: 'deployMccMod';
      requestId: string;
      parentOutputDir: string;
      title: string;
      description?: string;
      author?: string;
      isMultiplayer?: boolean;
      registerInModManifest?: boolean;
      modManifestPath?: string;
    }
  | {
      type: 'globalReplaceTagFieldValue';
      requestId: string;
      fieldNameQuery: string;
      tagGroupFilter?: string;
      matchValue?: string;
      newValue: string;
    }
  | {
      type: 'compileJmaAnimation';
      requestId: string;
      targetAntrTagIndex: number;
      jmaText: string;
      animName?: string;
    }
  | {
      type: 'compileJmsPhysics';
      requestId: string;
      targetPhysTagIndex: number;
      jmsText: string;
      totalMass?: number;
    }
  | {
      type: 'decompileTagToSource';
      requestId: string;
      tagIndex: number;
      animationIndex?: number;
    }
  | {
      type: 'compileStringsTag';
      requestId: string;
      targetTagIndex: number;
      textContent: string;
    }
  | {
      type: 'inspectMeterTag';
      requestId: string;
      meterTagIndex: number;
    }
  | {
      type: 'compileFontFromGlyphAtlas';
      requestId: string;
      targetFontTagIndex: number;
      glyphSpec: {
        ascendingHeight: number;
        descendingHeight: number;
        leadingHeight: number;
        leadingWidth: number;
        glyphs: Array<{
          charCode: number;
          characterWidth: number;
          bitmapWidth: number;
          bitmapHeight: number;
          bitmapOriginX: number;
          bitmapOriginY: number;
          alphaPixels: number[];
        }>;
      };
    }
  | {
      type: 'injectProceduralWorldBsp';
      requestId: string;
      worldMesh: any;
      bspIndex?: number;
      shaderBindings?: Record<string, { tagId: number; path: string; classFourCC: string }>;
      collisionMode?: 'auto' | 'exact';
    }
  | {
      type: 'scaleCoupledPhysics';
      requestId: string;
      objectTagId: number;
      scaleFactor: number;
    }
  | {
      type: 'inspectLiveHudCatalog';
      requestId: string;
    }
  | {
      type: 'applyLiveHudEdit';
      requestId: string;
      request: ApplyLiveHudEditRequest;
    }
  | {
      type: 'applyLiveWeaponStatEdit';
      requestId: string;
      request: ApplyLiveWeaponStatEditRequest;
    }
  | {
      type: 'injectHudElementBitmap';
      requestId: string;
      request: GuidedHudBitmapInjectRequest;
      bitmapsPath?: string;
    }
  | {
      type: 'inspectUiWidgetCanvas';
      requestId: string;
      widgetTagIndex: number;
    }
  | {
      type: 'updateUiWidgetPlacement';
      requestId: string;
      request: UpdateUiWidgetPlacementRequest;
    }
  | {
      type: 'saveUnicodeStringTable';
      requestId: string;
      ustrTagIndex: number;
      strings: string[];
    }
  | {
      type: 'inspectContentExplorer';
      requestId: string;
      tagIndex: number;
    }
  | {
      type: 'autoFixTagDependencies';
      requestId: string;
      tagIndex?: number;
    }
  | {
      type: 'refactorMoveFolderInMap';
      requestId: string;
      oldFolderPrefix: string;
      newFolderPrefix: string;
    }
  | {
      type: 'reorganizeReflexiveBlock';
      requestId: string;
      tagIndex: number;
      reflexiveFieldPath: string;
      plan: BlockOrganizerPlanItem[];
    }
  | {
      type: 'exportReflexiveTsv';
      requestId: string;
      tagIndex: number;
      reflexiveFieldPath: string;
    }
  | {
      type: 'importReflexiveTsv';
      requestId: string;
      tagIndex: number;
      reflexiveFieldPath: string;
      tsvText: string;
    }
  | {
      type: 'analyzeHudMessageSafety';
      requestId: string;
      tagIndex: number;
    }
  | {
      type: 'exportStringsCsv';
      requestId: string;
      tagIndex: number;
    }
  | {
      type: 'previewStringsCsvImport';
      requestId: string;
      tagIndex: number;
      csvText: string;
      mode: 'amend' | 'replace';
    }
  | {
      type: 'runMapFixAction';
      requestId: string;
      action: MapFixActionKind;
      filePath?: string;
      outputPath?: string;
      bitmapsPath?: string;
      soundsPath?: string;
      locPath?: string;
      ceBitmapsPath?: string;
      ceSoundsPath?: string;
      ceLocPath?: string;
    }
  | { type: 'cancel'; requestId: string };

export type MapFixActionKind = 'ce' | 'mcc' | 'demo' | 'halomd' | 'xbox';

export interface MapFixScriptMutationDto {
  scriptName: string;
  nodeIndex: number;
  kind?: 'function_call' | 'global_set';
  targetName?: string;
  expression?: string;
  reason?: string;
  action: 'neutralized' | 'converted_to_game_revert' | 'already_fixed';
}

export interface MapFixReportDto {
  action: MapFixActionKind;
  ok: boolean;
  isPlaceholder?: boolean;
  message: string;
  filePath?: string;
  backupPath?: string;
  readOnlyCleared?: boolean;
  sourceEngineVersion?: number;
  targetEngineVersion?: number;
  mapName?: string;
  previousCrc32?: number;
  newCrc32?: number;
  sourceByteLength?: number;
  outputByteLength?: number;
  pointersRebased?: number;
  externalRangesInternalized?: number;
  externalTagsLinkedToCe?: number;
  modelsConverted?: number;
  bspsDecompressed?: number;
  bitmapsDeswizzled?: number;
  p8BitmapsConverted?: number;
  scriptFix?: {
    totalScripts?: number;
    scriptsChecked?: number;
    totalGlobals?: number;
    totalSyntaxNodes: number;
    nodesNeutralized: number;
    nodesConvertedToGameRevert: number;
    nodesAlreadyFixed?: number;
    alreadyFixedNodes?: number;
    affectedScripts?: string[];
    fixedNodes?: MapFixScriptMutationDto[];
    mutations?: MapFixScriptMutationDto[];
  };
  details: string[];
  map?: OpenMapSummary;
}

export type RunMapFixActionResult =
  | ({ ok: true } & MapFixReportDto)
  | { ok: false; cancelled?: boolean; code?: string; message: string };

export interface DeprotectInspectionSummary {
  totalTags: number;
  protectedClassCount: number;
  protectedNameCount: number;
  duplicateNameCount: number;
  scriptRecoverableNamesCount: number;
  truncatedBitmapCount: number;
  corruptedModelPartCount: number;
  headerCrc32: number;
  tagChecksum: number;
  details: string[];
}

export interface DeprotectMapOptions {
  repairClasses?: boolean;
  scrapeScriptPaths?: boolean;
  heuristicRename?: boolean;
  repairBitmaps?: boolean;
  repairModelStrips?: boolean;
}

export type InspectDeprotectResult =
  | { ok: true; report: DeprotectInspectionSummary }
  | { ok: false; code: string; message: string };

export type DeprotectMapResult =
  | {
      ok: true;
      classesRepaired: number;
      scriptPathsRecovered: number;
      heuristicPathsRenamed: number;
      bitmapsRepaired: number;
      modelPartsRepaired: number;
      stripIndicesClamped: number;
      log: string[];
      map: OpenMapSummary;
    }
  | { ok: false; code: string; message: string };

export type SpoofMapCrc32Result =
  | {
      ok: true;
      compensationWord: number;
      crc32: number;
      map: OpenMapSummary;
    }
  | { ok: false; code: string; message: string };

export type CustomObjectTagGroup = 'scenery' | 'weapon' | 'vehicle' | 'equipment';

export interface BuildCustomObjectRequest {
  tagGroup: CustomObjectTagGroup;
  tagPath: string;
  itemName?: string;
  objFilePath: string;
  objSourceText?: string;
  collisionObjFilePath?: string;
  textureFilePath?: string;
  texturePngDataUrl?: string;
  scale?: number;
  flipYz?: boolean;
  centerOrigin?: boolean;
  forceAutoUv?: boolean;
  uvUnwrapMode?: 'box' | 'per_triangle' | 'smart';
  multiBoxCollision?: boolean;
  collisionMode?: 'auto' | 'exact' | 'box';
  targetCollisionFaces?: number;
  materialType?: number;
  slotMaterialTypes?: number[];
  templateTagIndex?: number;
  outputMode: 'inject' | 'ocetags' | 'both';
  outputOceTagsPath?: string;
  placeAtPosition?: [number, number, number];
  placeAtRotation?: [number, number, number];
}

export interface BuildCustomObjectSuccess {
  ok: true;
  rootTagPath: string;
  rootTagGroup: CustomObjectTagGroup;
  generatedTagPaths: { group: string; path: string }[];
  usedAutoUv: boolean;
  injectedIntoMap: boolean;
  outputOceTagsPath?: string;
  map?: OpenMapSummary;
}

export type BuildCustomObjectResult = BuildCustomObjectSuccess | { ok: false; code: string; message: string };

export interface ExportUvTemplateResult {
  ok: boolean;
  outputPath?: string;
  usedAutoUv?: boolean;
  previewDataUrl?: string;
  error?: string;
}

export type GetReferencingTagsResult =
  | { ok: true; referencingTags: ReferencingTagSummary[] }
  | { ok: false; code: string; message: string };

export type GetUnicodeStringsResult =
  | { ok: true; result: UnicodeStringListResult }
  | { ok: false; code: string; message: string };

export type SetUnicodeStringResult =
  | { ok: true; newText: string; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type RenameTagResult =
  | { ok: true; path: string; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type DuplicateTagResult =
  | { ok: true; newTagIndex: number; newTagId: number; path: string; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type DeleteTagResult =
  | { ok: true; deletedPath: string; deletedGroup: string; scrubbedReferencesCount: number; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type GetBspRenderMeshResult =
  | {
      ok: true;
      mesh: BspRenderMesh;
      shaderTextures?: Record<string, { width: number; height: number; rgbaData: Uint8Array }>;
    }
  | { ok: false; code: string; message: string };

export type GetBitmapTextureResult =
  | { ok: true; texture: DecodedRgbaTexture }
  | { ok: false; code: string; message: string };

export type GetScenarioObjectsResult =
  | { ok: true; summary: ScenarioPlacementsSummary }
  | { ok: false; code: string; message: string };

export type GetModelRenderGeometryResult =
  | { ok: true; geometry: ModelRenderGeometry }
  | { ok: false; code: string; message: string };

export type UpdateScenarioPlacementResult =
  | { ok: true; summary: ScenarioPlacementsSummary; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type DuplicateScenarioPlacementResult =
  | { ok: true; summary: ScenarioPlacementsSummary; newPlacement: ScenarioObjectPlacement; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type AddScenarioPlacementResult =
  | { ok: true; summary: ScenarioPlacementsSummary; newPlacement: ScenarioObjectPlacement; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type SwapScenarioPlacementResult =
  | { ok: true; summary: ScenarioPlacementsSummary; newPlacement: ScenarioObjectPlacement; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type DeleteScenarioPlacementResult =
  | { ok: true; summary: ScenarioPlacementsSummary; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type GetDependencySlotsResult =
  | { ok: true; slots: TagDependencySlot[] }
  | { ok: false; code: string; message: string };

export type SetDependencySlotResult =
  | { ok: true; fieldPath: string; newTagId: number; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type GetTagFieldsResult =
  | { ok: true; data: TagFieldsResult }
  | { ok: false; code: string; message: string };

export type UpdateTagFieldResult =
  | { ok: true; fieldName: string; newValue: unknown; map: OpenMapSummary }
  | { ok: false; code: string; message: string };

export type AddReflexiveChunkResult =
  | {
      ok: true;
      tagIndex: number;
      reflexiveFieldPath: string;
      newElementIndex: number;
      newCount: number;
      map: OpenMapSummary;
    }
  | { ok: false; code: string; message: string };

export type WorkerResponse =
  | { type: 'ready'; info: string }
  | { type: 'progress'; requestId: string; stage: string; percent: number }
  | { type: 'result'; requestId: string; payload: unknown }
  | { type: 'error'; requestId: string; code: string; message: string };

/* -------------------------------- M12: OpenCE Tag Test -------------------------------- */

export interface TagTestStatus {
  state: 'stopped' | 'launching' | 'running' | 'error';
  pid?: number;
  telnetConnected: boolean;
  error?: string;
  mapName?: string;
  liveHudMode?: boolean;
  heldWeaponTagId?: number | null;
  drivenVehicleTagId?: number | null;
  haloWindowRect?: { left: number; top: number; width: number; height: number } | null;
}

export interface TagTestLaunchOptions {
  windowed?: boolean;
  resolution?: string;
  liveHudMode?: boolean;
}

export interface TagTestLogEntry {
  source: 'telnet' | 'stdout' | 'debug_txt';
  text: string;
  timestamp: number;
  tagPathLink?: string;
  tagIndexLink?: number;
}

export interface StageTagTestMapResult {
  ok: true;
  targetPath: string;
  crc32: number;
  scenarioName: string;
  mapType?: number;
  liveHudSetup?: LiveHudSessionSetupInfo;
}

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
  batchExtractPreflight(): Promise<BatchExtractPreflightResult | null>;
  startBatchExtract(options: { parentDir: string; mode: BatchExtractMode; extractFormat?: BatchExtractFormat }): Promise<BatchExtractResult>;
  cancelBatchExtract(): void;
  finalizeBatchExtract(request: FinalizeBatchExtractRequest): Promise<{ ok: boolean; message?: string }>;
  pickResourceMap(kind: ResourceMapKind): Promise<ResourceMapPickResult>;
  getResourceMapStatuses(): Promise<Record<ResourceMapKind, ResourceMapStatus>>;
  pickInjectContainer(): Promise<{ path: string; paths: string[] } | null>;
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
  convertPreflight(source: 'open' | 'pick', resourcePaths?: ConvertResourcePaths): Promise<ConvertPreflightResult | null>;
  /** Step 2: converts the map from the last pre-flight. Main shows the Save dialog and refuses the source path. */
  convertMap(acknowledgeScripts: boolean, repairs: ConvertRepairChoice, resourcePaths?: ConvertResourcePaths): Promise<ConvertMapResult>;
  /** Source-game bitmap/sound map picker for Convert (no settings persistence). null: cancelled. */
  pickConvertResource(kind: 'bitmaps' | 'sounds'): Promise<{ path: string } | null>;
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
  /** M7a: fetch decoded fields and schema for the focused tag in the open map. */
  getTagFields(tagIndex: number): Promise<GetTagFieldsResult>;
  /** M7a: edit a root struct field value in memory in the open map. */
  updateTagField(tagIndex: number, fieldName: string, newValue: unknown): Promise<UpdateTagFieldResult>;
  /** Tag Editor: Add or clone a child chunk in a TagReflexive array. */
  addReflexiveChunk?(tagIndex: number, reflexiveFieldPath: string, cloneFromIndex?: number): Promise<AddReflexiveChunkResult>;
  /** Dependency Swapper: every dependency slot of the tag (nested blocks and null slots included). */
  getDependencySlots(tagIndex: number): Promise<GetDependencySlotsResult>;
  /** Dependency Swapper: point one slot at any tag of the open map (null clears it). In memory only. */
  setDependencySlot(tagIndex: number, fieldPath: string, newTagId: number | null): Promise<SetDependencySlotResult>;
  /** Step 8.4: Extract 3D BSP render geometry for the open map. */
  getBspRenderMesh(bspIndex?: number): Promise<GetBspRenderMeshResult>;
  /** Step 8.4: Decode a bitmap or shader's diffuse texture for 3D rendering. */
  getBitmapTexture(bitmapTagId: number, imageIndex?: number): Promise<GetBitmapTextureResult>;
  /** Step 8.5: Extract placed scenario objects (vehicles, scenery, spawns, weapons) from the open map. */
  getScenarioObjects(): Promise<GetScenarioObjectsResult>;
  /** Step 8.5: Extract 3D model geometry for a gbxmodel tag. */
  getModelGeometry(modelTagId: number, lod?: number): Promise<GetModelRenderGeometryResult>;
  /** Step 9: Update a placed scenario object in memory in the open map. */
  updateScenarioPlacement(
    placementId: string,
    updates: {
      position?: [number, number, number];
      rotation?: [number, number, number];
      paletteIndex?: number;
      teamIndex?: number;
      multiplayerSpawnFlags?: number;
      forceSpawn?: boolean;
    },
  ): Promise<UpdateScenarioPlacementResult>;
  /** Step 9: Duplicate an existing placed scenario object in the open map. */
  duplicateScenarioPlacement(
    placementId: string,
    offsetDelta?: [number, number, number],
  ): Promise<DuplicateScenarioPlacementResult>;
  /** Step 9: Add a new placed scenario object to the open map. */
  addScenarioPlacement(
    kind: ScenarioObjectKind,
    paletteIndex: number,
    position: [number, number, number],
    rotation?: [number, number, number],
    teamIndex?: number,
  ): Promise<AddScenarioPlacementResult>;
  /** Step 9: Swap an existing placed scenario object with another object. */
  swapScenarioPlacement(
    placementId: string,
    newKind: ScenarioObjectKind,
    newPaletteIndex: number,
  ): Promise<SwapScenarioPlacementResult>;
  /** Step 9: Delete a placed scenario object from the open map. */
  deleteScenarioPlacement(placementId: string): Promise<DeleteScenarioPlacementResult>;
  /** Milestone 9: Reverse dependency lookup ("Referencing Tags"). */
  getReferencingTags(tagIndex: number): Promise<GetReferencingTagsResult>;
  /** Milestone 9: Fetch unicode strings from a ustr tag. */
  getUnicodeStrings(tagIndex: number): Promise<GetUnicodeStringsResult>;
  /** Milestone 9: In-place edit a unicode string in a ustr tag. */
  setUnicodeString(tagIndex: number, stringIndex: number, newText: string): Promise<SetUnicodeStringResult>;
  /** Milestone 9: Rename a tag in the map. */
  renameTag(tagIndex: number, newPath: string): Promise<RenameTagResult>;
  /** Milestone 9: Duplicate a tag in the map. */
  duplicateTag(tagIndex: number, newPath: string): Promise<DuplicateTagResult>;
  /** Delete a tag from the map and scrub all incoming references to NULL_TAG_ID. */
  deleteTag(tagIndex: number): Promise<DeleteTagResult>;
  /** Milestone 10: BSP Swapper - pick a source map file. */
  pickBspSourceMap(): Promise<{ path: string | null }>;
  pickBspResource?(kind: 'bitmaps' | 'sounds'): Promise<{ path: string | null }>;
  /** Milestone 10: BSP Swapper - preflight swap between source and target map. */
  bspSwapPreflight(sourceFilePath: string, sourceBspIndex?: number, targetBspIndex?: number, sourceBspIndices?: number[]): Promise<BspSwapPreflightResult>;
  /** Milestone 10.2: Extract 3D BSP render geometry from any map file. */
  getSourceBspMesh?(sourceFilePath: string, bspIndex?: number): Promise<GetBspRenderMeshResult>;
  /** Milestone 10: BSP Swapper - perform swap into currently open map. */
  performBspSwap(sourceFilePath: string, options: BspSwapOptions): Promise<BspSwapResult>;
  /** Part 2: Direct 3D Model File (.glb / .gltf / .obj / .jms) BSP Replacement & Merge. */
  pickBspModelFile(): Promise<{ path: string | null }>;
  bspModelPreflight(
    modelPath: string,
    targetBspIndex?: number,
    options?: BspModelSwapOptions,
  ): Promise<BspModelPreflightResult>;
  bspSwapFromModelFile(
    modelPath: string,
    options?: BspModelSwapOptions,
  ): Promise<BspModelSwapResult & { map?: OpenMapSummary }>;
  /** Tools > Identify Resource Maps: reads and validates a bitmaps.map or sounds.map file for a specific Halo edition. */
  identifyResourceMap(filePath: string, expectedVersion?: HaloBitmapVersion, expectedKind?: 'bitmaps' | 'sounds'): Promise<BitmapIdentificationResult>;
  setResourceMapPath(kind: ResourceMapKind, filePath: string): Promise<{ ok: boolean }>;
  detectDefaultResourceMapPaths(): Promise<Record<HaloBitmapVersion, string | null>>;
  getVersionSettings?(): Promise<Partial<Record<HaloBitmapVersion, VersionResourceMaps>>>;
  setVersionSettings?(version: HaloBitmapVersion, maps: { bitmaps?: string | null; sounds?: string | null; loc?: string | null }): Promise<{ ok: boolean }>;
  /** M12: OpenCE Tag Test runner & live control deck */
  tagTestLaunch(options?: TagTestLaunchOptions): Promise<{ ok: boolean; error?: string }>;
  tagTestStop(): Promise<{ ok: boolean; error?: string }>;
  tagTestSendCommand(command: string): Promise<{ ok: boolean; response?: string; error?: string }>;
  tagTestHotReload(): Promise<{ ok: boolean; error?: string }>;
  tagTestGetStatus(): Promise<TagTestStatus>;
  onTagTestLog(cb: (entry: TagTestLogEntry) => void): () => void;
  onTagTestStatusChange(cb: (status: TagTestStatus) => void): () => void;
  pickOpenCeDirectory(): Promise<{ path: string | null }>;
  getOpenCeConfig(): Promise<{ directory: string | null; executable: string | null; exists: boolean }>;
  setOpenCeDirectory(dir: string | null): Promise<{ ok: boolean }>;
  /** M13.1: Bitmap / Texture Editor & Injector */
  getBitmapInfo(tagIndex: number): Promise<GetBitmapInfoResult>;
  getBitmapRgba(tagIndex: number, imageIndex: number): Promise<GetBitmapRgbaResult>;
  pickExportBitmapPath(defaultName: string, format: 'png' | 'dds'): Promise<{ path: string | null }>;
  exportBitmapImage(tagIndex: number, imageIndex: number, format: 'png' | 'dds', outputPath: string): Promise<ExportBitmapResult>;
  pickImportBitmapPath(): Promise<{ path: string | null }>;
  replaceBitmapImage(tagIndex: number, imageIndex: number, inputPath: string, targetFormat?: number): Promise<ReplaceBitmapResult>;
  /** M13.2: Sound Audition Player & Injector */
  getSoundInfo(tagIndex: number): Promise<GetSoundInfoResult>;
  getSoundWav(tagIndex: number, pitchRangeIndex: number, permutationIndex: number): Promise<GetSoundWavResult>;
  pickExportSoundPath(defaultName: string): Promise<{ path: string | null }>;
  exportSoundWav(tagIndex: number, pitchRangeIndex: number, permutationIndex: number, outputPath: string): Promise<ExportSoundResult>;
  pickImportSoundPath(): Promise<{ path: string | null }>;
  replaceSoundWav(tagIndex: number, pitchRangeIndex: number, permutationIndex: number, inputPath: string, targetFormat?: number): Promise<ReplaceSoundResult>;
  /** M13.3: 3D Model & BSP Exporter */
  exportModel3d(modelTagId: number, lod: number | undefined, format: 'obj' | 'glb', outputPath: string): Promise<Export3dResult>;
  exportBsp3d(bspIndex: number, format: 'obj' | 'glb', outputPath: string): Promise<Export3dResult>;
  pickExport3dPath(defaultName: string, format: 'obj' | 'glb'): Promise<{ path: string | null; format?: 'obj' | 'glb' }>;
  pickObjFile(): Promise<{ path: string | null }>;
  analyzeCollisionObj(filePath?: string, options?: { scale?: number; flipYz?: boolean; centerOrigin?: boolean; forceAutoUv?: boolean; uvUnwrapMode?: 'box' | 'per_triangle' | 'smart' }): Promise<{ ok: boolean; summary?: any; filePath?: string; error?: string }>;
  exportUvTemplate(options: {
    objFilePath: string;
    size?: number;
    scale?: number;
    flipYz?: boolean;
    centerOrigin?: boolean;
    forceAutoUv?: boolean;
    uvUnwrapMode?: 'box' | 'per_triangle' | 'smart';
    previewOnly?: boolean;
  }): Promise<ExportUvTemplateResult>;
  buildCustomObjectTag(request: BuildCustomObjectRequest): Promise<BuildCustomObjectResult>;
  pickSaveOceTagsPath(defaultName: string): Promise<{ path: string | null }>;
  pickExportDirectory(): Promise<{ path: string | null }>;
  /** M13.5: MEK Deprotection, Asset Integrity & CRC32 Spoofer */
  inspectDeprotect?(): Promise<InspectDeprotectResult>;
  deprotectMap?(options?: DeprotectMapOptions): Promise<DeprotectMapResult>;
  spoofMapCrc32?(targetCrc32: number): Promise<SpoofMapCrc32Result>;
  /** M14: HaloScript (.hsc) Decompiler, Compiler & Scenario Setup */
  decompileHaloScript?(): Promise<{
    ok: true;
    hscSource: string;
    scriptCount: number;
    globalCount: number;
    syntaxNodeCount: number;
    scenarioEntities: {
      objectNames: string[];
      triggerVolumes: string[];
      cutsceneCameraPoints: string[];
      cutsceneFlags: string[];
      encounters: string[];
      recordedAnimations: string[];
    };
    scripts?: Array<{ name: string; scriptType: string; returnType?: string; rootNodeIndex?: number; bodySource: string }>;
    globals?: Array<{ name: string; type: string; initNodeIndex?: number; valueSource: string }>;
  } | { ok: false; message: string }>;
  compileHaloScript?(hscSource: string): Promise<{
    ok: true;
    compiledScripts: number;
    compiledGlobals: number;
    syntaxNodesUsed: number;
    diagnostics: Array<{ line: number; severity: 'error' | 'warning'; message: string }>;
  } | {
    ok: false;
    message: string;
    diagnostics?: Array<{ line: number; severity: 'error' | 'warning'; message: string }>;
  }>;
  setupScenarioScriptEntities?(required: {
    objectNames?: string[];
    triggerVolumes?: string[];
    cameraPoints?: string[];
  }): Promise<{
    ok: true;
    addedObjectNames: string[];
    addedTriggerVolumes: string[];
    addedCameraPoints: string[];
  } | { ok: false; message: string }>;
  /** M15–M19: Universal Tag Class Converter, 3D Collision Wireframe, Yelo Cleaner, Error Scanner & Global Search/Replace */
  extractCollisionWireframe?(collTagIndex: number): Promise<{
    ok: true;
    tagIndex: number;
    tagPath: string;
    vertexCount: number;
    edgeCount: number;
    surfaceCount: number;
    linePositions: number[];
    objText: string;
  } | { ok: false; message: string }>;
  convertCollisionToGbxmodel?(collTagIndex: number, targetPath?: string): Promise<{
    ok: true;
    createdTagIndex: number;
    createdTagPath: string;
    createdTagGroup: string;
    summary: string;
    tags: TagEntrySummary[];
  } | { ok: false; message: string }>;
  convertSbspToScenery?(bspTagIndex?: number, targetPath?: string): Promise<{
    ok: true;
    createdTagIndex: number;
    createdTagPath: string;
    createdTagGroup: string;
    summary: string;
    tags: TagEntrySummary[];
  } | { ok: false; message: string }>;
  convertObjectTagClass?(sourceTagIndex: number, targetGroup: string, targetPath?: string): Promise<{
    ok: true;
    createdTagIndex: number;
    createdTagPath: string;
    createdTagGroup: string;
    summary: string;
    tags: TagEntrySummary[];
  } | { ok: false; message: string }>;
  cleanOpenSauceYelo?(): Promise<{
    ok: true;
    cleanedReferences: number;
    details: string[];
  } | { ok: false; message: string }>;
  scanMapTagErrors?(): Promise<{
    ok: true;
    totalTagsScanned: number;
    errorCount: number;
    warningCount: number;
    findings: Array<{
      tagIndex: number;
      tagId: number;
      tagPath: string;
      tagGroup: string;
      fieldPath: string;
      severity: 'error' | 'warning';
      message: string;
    }>;
  } | { ok: false; message: string }>;
  globalReplaceTagReference?(fromTagId: number, toTagId: number): Promise<{
    ok: true;
    replacedCount: number;
    affectedTags: Array<{ tagIndex: number; tagPath: string; tagGroup: string; fieldPath: string }>;
  } | { ok: false; message: string }>;
  globalReplaceTagFieldValue?(options: {
    fieldNameQuery: string;
    tagGroupFilter?: string;
    matchValue?: string;
    newValue: string;
  }): Promise<
    | {
        ok: true;
        replacedCount: number;
        affectedFields: Array<{
          tagIndex: number;
          tagPath: string;
          tagGroup: string;
          fieldPath: string;
          oldValue: string;
          newValue: string;
        }>;
      }
    | { ok: false; message: string }
  >;
  compileJmaAnimation?(
    targetAntrTagIndex: number,
    animName?: string,
  ): Promise<
    | {
        ok: true;
        fileName: string;
        animationName: string;
        frameCount: number;
        nodeCount: number;
        frameSize: number;
        replacedExisting: boolean;
      }
    | { ok: false; cancelled?: boolean; message: string }
  >;
  compileJmsPhysics?(
    targetPhysTagIndex: number,
    totalMass?: number,
  ): Promise<
    | {
        ok: true;
        fileName: string;
        massPointCount: number;
        totalMass: number;
        centerOfMass: [number, number, number];
        moments: [number, number, number];
      }
    | { ok: false; cancelled?: boolean; message: string }
  >;
  decompileTagToSource?(
    tagIndex: number,
    animationIndex?: number,
  ): Promise<
    | {
        ok: true;
        outputPath: string;
        kind: 'gbxmodel_jms' | 'animations_jma' | 'physics_jms';
        tagPath: string;
        summary: string;
      }
    | { ok: false; cancelled?: boolean; message: string }
  >;
  compileStringsTag?(
    targetTagIndex: number,
    textContent?: string,
  ): Promise<
    | {
        ok: true;
        tagPath: string;
        tagGroup: string;
        entryCount: number;
        messageNames: string[];
        fileName?: string;
      }
    | { ok: false; cancelled?: boolean; message: string }
  >;
  inspectMeterTag?(
    meterTagIndex: number,
  ): Promise<
    | {
        ok: true;
        tagPath: string;
        width: number;
        height: number;
        interpolateColors: number;
        anchorColors: number;
        emptyColorHex: string;
        fullColorHex: string;
        unmaskDistance: number;
        maskDistance: number;
        encodedBytes: number;
        previewRgba: number[];
      }
    | { ok: false; message: string }
  >;
  compileFontFromGlyphAtlas?(
    targetFontTagIndex: number,
    glyphSpec: {
      ascendingHeight: number;
      descendingHeight: number;
      leadingHeight: number;
      leadingWidth: number;
      glyphs: Array<{
        charCode: number;
        characterWidth: number;
        bitmapWidth: number;
        bitmapHeight: number;
        bitmapOriginX: number;
        bitmapOriginY: number;
        alphaPixels: number[];
      }>;
    },
  ): Promise<
    | {
        ok: true;
        tagPath: string;
        glyphCount: number;
        totalPixelBytes: number;
      }
    | { ok: false; message: string }
  >;
  exportOpenCeModFolder?(options: {
    rootTagIndices: number[];
    modName: string;
    version?: string;
    author?: string;
    description?: string;
    includeDependencies?: boolean;
    replaceTargetTagIndex?: number;
  }): Promise<{
    ok: true;
    outputDir: string;
    modFolderName: string;
    tagCount: number;
    writtenFiles: string[];
  } | { ok: false; message: string }>;
  importLegacyTags?(
    sourceMode: 'file' | 'folder',
    injectMode?: 'add' | 'swap',
  ): Promise<{
    ok: true;
    sourcePath: string;
    formatDetected: 'hek_loose' | 'hmt_meta_xml';
    addedCount: number;
    swappedCount: number;
    reusedCount: number;
    importedPaths: string[];
    warnings: string[];
    map: OpenMapSummary;
  } | { ok: false; message: string }>;
  replaceBitmapFromDataUrl?(
    tagIndex: number,
    imageIndex: number,
    pngDataUrl: string,
    targetFormat?: number,
  ): Promise<ReplaceBitmapResult>;
  getCustomBrushTextures?(): Promise<{
    ok: true;
    texturesDir: string;
    textures: Array<{ name: string; filePath: string; dataUrl: string }>;
  }>;
  openCustomTexturesFolder?(): Promise<{ ok: boolean; texturesDir: string }>;
  updateBspVertices?(
    bspIndex: number,
    submeshUpdates: Array<{
      submeshIndex: number;
      positions: Float32Array | number[];
      normals?: Float32Array | number[];
      uvs?: Float32Array | number[];
      shaderTagId?: number;
    }>,
  ): Promise<{ ok: true; updatedVertices: number; updatedCollisionVertices: number; map: OpenMapSummary } | { ok: false; message: string }>;
  updateModelVertices?(
    modelTagId: number,
    submeshUpdates: Array<{
      submeshIndex: number;
      positions: Float32Array | number[];
      normals?: Float32Array | number[];
      uvs?: Float32Array | number[];
      shaderTagId?: number;
    }>,
    lod?: number,
  ): Promise<{ ok: true; updatedVertices: number; updatedShaders?: number; map: OpenMapSummary } | { ok: false; message: string }>;
  tagTestSetAlwaysOnTop(flag: boolean): Promise<void>;
  tagTestIsAlwaysOnTop(): Promise<boolean>;
  tagTestTriggerFlycam(): Promise<{ ok: boolean; message?: string }>;
  onTagTestHotkeyAction?(
    cb: (payload: { action: string; flag?: string; value?: number; label?: string }) => void,
  ): () => void;
  setAlwaysOnTop(flag: boolean): Promise<void>;
  isAlwaysOnTop(): Promise<boolean>;
  getPathForFile(file: File): string;
  /** Guilty Spark Item 1: Pick and parse a .wrl (VRML 1.0) error geometry file or tool.exe build log. */
  pickWrlOrToolLog?(): Promise<
    | { ok: true; kind: 'wrl' | 'log'; fileName: string; wrl?: WrlDiagnostics; logReview?: ToolLogReview }
    | { ok: false; cancelled?: boolean; message: string }
  >;
  /** Guilty Spark Item 7: Compare the currently open map with another .map file on disk. */
  compareWithAnotherMap?(): Promise<
    | { ok: true; leftFileName: string; rightFileName: string; report: MapComparisonReport }
    | { ok: false; cancelled?: boolean; message: string }
  >;
  /** Guilty Spark Item 8: Discover Steam MCC installation & ModManifest.txt status. */
  discoverSteamMcc?(): Promise<{
    ok: true;
    mccInstallPaths: string[];
    defaultModManifestPath: string;
    manifestExists: boolean;
    registeredRoots: string[];
  }>;
  /** Guilty Spark Item 8: Package & deploy the open map as a Steam MCC mod and optionally register in ModManifest.txt. */
  deployMccMod?(options: {
    title: string;
    description?: string;
    author?: string;
    isMultiplayer?: boolean;
    registerInModManifest?: boolean;
  }): Promise<
    | {
        ok: true;
        modFolderPath: string;
        mapOutputPath: string;
        modInfoPath: string;
        manifestRegistered: boolean;
        manifestPath?: string;
      }
    | { ok: false; cancelled?: boolean; message: string }
  >;
  /** v0.6.8: Inject procedural Tunnel/Cave, Multi-Style Bridge, or FastGen / Multi-Map World Merger mesh directly into the map's Structure BSP. */
  injectProceduralWorldBsp?(options: {
    worldMesh: any;
    bspIndex?: number;
    shaderBindings?: Record<string, { tagId: number; path: string; classFourCC: string }>;
    collisionMode?: 'auto' | 'exact';
    donorMapFilePath?: string;
  }): Promise<
    | {
        ok: true;
        addedVertices: number;
        addedTriangles: number;
        addedSubmeshes: number;
        addedCollisionSurfaces: number;
        addedCollisionNodes3d: number;
        newBspSize: number;
        newBspAddress: number;
        worldBounds: [number, number, number, number, number, number];
        map: OpenMapSummary;
      }
    | { ok: false; message: string }
  >;
  /** v0.6.8: Coupled Vehicle, Weapon, Equipment & Scenery Dimensional Physics Resizer (0.1x - 5.0x). */
  scaleCoupledPhysics?(
    objectTagId: number,
    scaleFactor: number,
  ): Promise<
    | {
        ok: true;
        summary: {
          objectTagId: number;
          objectPath: string;
          objectClass: string;
          scaleFactor: number;
          scaledGbxmodelVertices: number;
          scaledCollisionVertices: number;
          scaledCollisionPlanes: number;
          scaledPhysicsMassPoints: number;
          scaledVehicleSuspensions: number;
          updatedWeaponOrEquipmentScale: boolean;
          newPhysicsMass?: number;
        };
        map: OpenMapSummary;
      }
    | { ok: false; message: string }
  >;
  /** Check GitHub Releases for a newer version of OpenCE Mantle. */
  checkForUpdates?(): Promise<UpdateCheckResult>;
  /** Toggle whether OpenCE Mantle checks for updates automatically on launch. */
  setCheckForUpdatesOnLaunch?(enabled: boolean): Promise<{ ok: true; checkForUpdatesOnLaunch: boolean }>;
  /** Toggle whether OpenCE Mantle automatically downloads detected updates in the background. */
  setAutoDownloadUpdates?(enabled: boolean): Promise<{ ok: true; autoDownloadUpdates: boolean }>;
  /** Record a release version string to skip automatic prompts for (or null to clear). */
  setSkippedUpdateVersion?(version: string | null): Promise<{ ok: true; skippedUpdateVersion: string | null }>;
  /** Open an external GitHub release / download URL in the system default browser. */
  openExternalUrl?(url: string): Promise<{ ok: boolean; message?: string }>;
  /** Stream and stage the update binary (Installer or Portable) in the background with live progress events. */
  downloadUpdate?(options?: {
    mode?: 'auto' | 'installer' | 'portable';
    assetUrl?: string;
    assetName?: string;
    version?: string;
  }): Promise<DownloadUpdateResult>;
  /** Apply the staged update binary (silent NSIS install or self-replacing portable swap) and restart OpenCE Mantle. */
  applyUpdateAndRestart?(
    downloadedFilePath?: string,
    installMode?: 'installer' | 'portable',
  ): Promise<{ ok: boolean; message?: string }>;
  /** Subscribe to live download progress events from the background updater. */
  onUpdateDownloadProgress?(cb: (evt: UpdateDownloadProgressEvent) => void): () => void;
  /** v0.6.8: Inspect all Weapon HUDs, Vehicle HUDs, Unit HUDs, Global HUDs, UI Widgets (DeLa), and Unicode String Lists (ustr) in the open map. */
  inspectLiveHudCatalog?(): Promise<
    | { ok: true; catalog: LiveHudCatalog }
    | { ok: false; message: string }
  >;
  /** v0.6.8: Apply a live HUD placement, scale, visibility, or anchor edit in-place (with automatic shared wphi forking when scope='this_one'). */
  applyLiveHudEdit?(
    request: ApplyLiveHudEditRequest,
  ): Promise<
    | { ok: true; effectiveHudTagIndex: number; catalog: LiveHudCatalog; map: OpenMapSummary; memoryPatches?: LiveMemoryPatch[] }
    | { ok: false; message: string }
  >;
  /** v0.6.8: Apply a live weapon/trigger/magazine/projectile/damage stat edit in-place. */
  applyLiveWeaponStatEdit?(
    request: ApplyLiveWeaponStatEditRequest,
  ): Promise<
    | { ok: true; writtenValue: unknown; map: OpenMapSummary; memoryPatches?: LiveMemoryPatch[] }
    | { ok: false; message: string }
  >;
  /** Blink a HUD element in-game by temporarily offsetting its anchor X by +4000 in halo.exe RAM for 1.2s. */
  blinkLiveHudElement?(offsetVirtualAddress: number, originalX: number): Promise<{ ok: boolean }>;
  /** Immediately equip a Spartan-holdable weapon into Player 0's hands in halo.exe. */
  equipLiveHudWeapon?(weaponTagId: number): Promise<{ ok: boolean; message?: string }>;
  /** Spawn a specific vehicle tag near Player 0 in halo.exe. */
  spawnLiveHudVehicle?(vehicleTagId: number): Promise<{ ok: boolean; message?: string }>;
  /** Re-spawn all Spartan-holdable weapons and all vehicle tags around Player 0 in halo.exe. */
  spawnAllLiveHudArsenal?(): Promise<{ ok: boolean; message?: string }>;
  /** v0.6.8: Guided HUD Bitmap Injector — embeds/replaces a HUD element's bitmap in the open map buffer (never modifying bitmaps.map). */
  injectHudElementBitmap?(
    request: GuidedHudBitmapInjectRequest,
  ): Promise<
    | {
        ok: true;
        bitmapTagIndex: number;
        bitmapTagId: number;
        bitmapPath: string;
        width: number;
        height: number;
        format: number;
        catalog: LiveHudCatalog;
        map: OpenMapSummary;
      }
    | { ok: false; message: string }
  >;
  /** v0.6.8: Visual ui.map Studio — inspect a ui_widget_definition ('DeLa') tag's 640x480 layout tree. */
  inspectUiWidgetCanvas?(
    widgetTagIndex: number,
  ): Promise<
    | { ok: true; rootNode: UiWidgetCanvasNode }
    | { ok: false; message: string }
  >;
  /** v0.6.8: Visual ui.map Studio — update a ui_widget_definition ('DeLa') bounds and/or child_widgets offset in-place. */
  updateUiWidgetPlacement?(
    request: UpdateUiWidgetPlacementRequest,
  ): Promise<
    | { ok: true; rootNode: UiWidgetCanvasNode | null; map: OpenMapSummary }
    | { ok: false; message: string }
  >;
  /** v0.6.8: Save an entire array of UTF-16LE strings into a unicode_string_list ('ustr') tag. */
  saveUnicodeStringTable?(
    ustrTagIndex: number,
    strings: string[],
  ): Promise<
    | { ok: true; entryCount: number; map: OpenMapSummary }
    | { ok: false; message: string }
  >;
  /** Baboon Feature 1: Inspect Content Explorer (Referenced by Parents / References Children + Reference Jump). */
  inspectContentExplorer?(
    tagIndex: number,
  ): Promise<{ ok: true; node: ContentExplorerNodeResult } | { ok: false; message: string }>;
  /** Baboon Feature 2: Auto-fix broken TagDependency references by unique (group, leaf_name) matching. */
  autoFixTagDependencies?(
    tagIndex?: number,
  ): Promise<{ ok: true; report: AutoFixDependenciesReport; map: OpenMapSummary } | { ok: false; message: string }>;
  /** Baboon Feature 3: Rename or move an entire folder prefix of tags in the open map. */
  refactorMoveFolderInMap?(
    oldFolderPrefix: string,
    newFolderPrefix: string,
  ): Promise<
    | {
        ok: true;
        renamedTags: Array<{ tagIndex: number; group: string; oldPath: string; newPath: string }>;
        map: OpenMapSummary;
      }
    | { ok: false; message: string }
  >;
  /** Baboon Feature 4: Staged Reflexive Block Organizer (reorder, duplicate, insert, delete, rename). */
  reorganizeReflexiveBlock?(
    tagIndex: number,
    reflexiveFieldPath: string,
    plan: BlockOrganizerPlanItem[],
  ): Promise<
    | { ok: true; oldCount: number; newCount: number; map: OpenMapSummary }
    | { ok: false; message: string }
  >;
  /** Baboon Feature 5: Export a reflexive block to spreadsheet TSV. */
  exportReflexiveTsv?(
    tagIndex: number,
    reflexiveFieldPath: string,
  ): Promise<
    | { ok: true; tsv: string; rowCount: number; columnNames: string[] }
    | { ok: false; message: string }
  >;
  /** Baboon Feature 6: Import spreadsheet TSV rows into a reflexive block. */
  importReflexiveTsv?(
    tagIndex: number,
    reflexiveFieldPath: string,
    tsvText: string,
  ): Promise<
    | { ok: true; updatedRows: number; updatedCells: number; map: OpenMapSummary }
    | { ok: false; message: string }
  >;
  /** Baboon Feature 7: Evaluate a Blam Function Curve (Periodic, Transition, Linear, Spline) & color stops. */
  evaluateFunctionCurve?(
    params: BlamFunctionCurveParams,
    sampleCount?: number,
  ): Promise<{ ok: true; evaluation: BlamFunctionCurveEvaluation } | { ok: false; message: string }>;
  /** Baboon Feature 8: Analyze HUD Message Text (hmt) Global vs Mission fixed-index safety. */
  analyzeHudMessageSafety?(
    tagIndex: number,
  ): Promise<{ ok: true; report: HudMessageSafetyReport } | { ok: false; message: string }>;
  /** Baboon Feature 9: Export Unicode String List (ustr) to RFC-4180 CSV. */
  exportStringsCsv?(
    tagIndex: number,
  ): Promise<{ ok: true; csv: string } | { ok: false; message: string }>;
  /** Baboon Feature 10: Preview CSV Amend / Replace import into a Unicode String List (ustr). */
  previewStringsCsvImport?(
    tagIndex: number,
    csvText: string,
    mode: 'amend' | 'replace',
  ): Promise<{ ok: true; preview: StringsCsvImportPreview } | { ok: false; message: string }>;
  /** Baboon Feature 11: Open & scan a standard Blam loose `tags/` directory workspace. */
  openLooseTagsWorkspace?(
    tagsDir?: string,
  ): Promise<{ ok: true; workspace: LooseTagsWorkspaceIndex } | { ok: false; cancelled?: boolean; message: string }>;
  /** Baboon Feature 12: Read decoded fields of a 64-byte `'blam'` loose tag file on disk. */
  readLooseTagFields?(
    filePath: string,
    tagPath: string,
    group?: string,
  ): Promise<{ ok: true; fields: TagFieldsResult } | { ok: false; message: string }>;
  /** Baboon Feature 13: Update a field in a 64-byte `'blam'` loose tag file on disk in-place. */
  writeLooseTagField?(
    filePath: string,
    tagPath: string,
    fieldPath: string,
    newValue: unknown,
    group?: string,
  ): Promise<{ ok: true; fields: TagFieldsResult } | { ok: false; message: string }>;
  /** Baboon Feature 14: Auto-fix broken TagDependency paths across a `tags/` workspace on disk. */
  fixLooseWorkspaceDependencies?(
    tagsDir: string,
    targetRelativePath?: string,
  ): Promise<{ ok: true; report: AutoFixDependenciesReport; workspace: LooseTagsWorkspaceIndex } | { ok: false; message: string }>;
  /** Baboon Feature 15: Move/rename a loose 64-byte `'blam'` tag file on disk and rewrite all referencing tags. */
  refactorMoveLooseTag?(
    tagsDir: string,
    oldTagPath: string,
    group: string,
    newTagPath: string,
  ): Promise<
    | {
        ok: true;
        oldFilePath: string;
        newFilePath: string;
        rewrittenReferencingFiles: string[];
        workspace: LooseTagsWorkspaceIndex;
      }
    | { ok: false; message: string }
  >;
  /** Baboon Feature 16: Git Review for a `tags/` workspace (git status, branch, recent commits, semantic diff). */
  inspectGitTagsWorkspace?(
    tagsDir: string,
  ): Promise<
    | {
        ok: true;
        isGitRepo: boolean;
        branch: string;
        modifiedFiles: Array<{ relativePath: string; status: string }>;
        recentCommits: Array<{ hash: string; date: string; message: string }>;
      }
    | { ok: false; message: string }
  >;
  diffGitLooseTag?(
    tagsDir: string,
    relativePath: string,
    commitRef?: string,
  ): Promise<{ ok: true; rows: MapDifferenceRow[] } | { ok: false; message: string }>;
  /** Baboon Feature 17: Multi-engine HaloScript function & global reference catalog. */
  queryHaloScriptCatalog?(
    query?: string,
    engineFilter?: string,
  ): Promise<{ ok: true; entries: HaloScriptDocEntry[] }>;
  /** Baboon Feature 18: Visual `tool.exe` Command Catalog & Runner. */
  getToolCommands?(
    game?: 'haloce' | 'haloce_mcc' | 'halo2_mcc' | 'halo3_mcc' | 'halo3odst_mcc' | 'haloreach_mcc',
  ): Promise<{ ok: true; commands: ToolCommandSchema[] }>;
  runToolExeCommand?(options: {
    toolExePath?: string;
    workingDir?: string;
    commandName: string;
    args: string[];
  }): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number; commandLine: string }>;
  /** Baboon Feature 19: Win32 `WM_DROPFILES` drag-and-drop delivery to running Sapien / Guerilla windows. */
  dropTagToExternalWindow?(
    filePath: string,
    targetWindowTitle?: string,
  ): Promise<{ ok: boolean; targetWindow?: string; message?: string }>;

  /* --- v0.6.9 Workspace Launcher, Frameless Window Controls, Themes, Multi-Map Tabs & Multi-Monitor Tear-Off --- */
  windowMinimize?(): Promise<void>;
  windowToggleMaximize?(): Promise<boolean>;
  windowClose?(): Promise<void>;
  windowIsMaximized?(): Promise<boolean>;
  onWindowMaximizedChange?(cb: (isMaximized: boolean) => void): () => void;

  getTheme?(): Promise<AppThemeId>;
  setTheme?(theme: AppThemeId): Promise<{ ok: true; theme: AppThemeId }>;
  onThemeChanged?(cb: (theme: AppThemeId) => void): () => void;

  getRecentMapCards?(): Promise<RecentMapCardEntry[]>;
  togglePinRecentMap?(filePath: string): Promise<RecentMapCardEntry[]>;
  removeRecentMap?(filePath: string): Promise<RecentMapCardEntry[]>;
  revealInExplorer?(filePath: string): Promise<void>;

  listOpenMapSessions?(): Promise<{ activeSessionId: string | null; sessions: OpenMapTabSession[] }>;
  switchActiveMapSession?(sessionId: string): Promise<{ ok: boolean; session?: OpenMapTabSession; message?: string }>;
  closeMapSession?(sessionId: string): Promise<{ ok: boolean; activeSessionId: string | null; sessions: OpenMapTabSession[] }>;
  detachMapTabToWindow?(
    sessionId: string,
    coords?: { screenX?: number; screenY?: number },
  ): Promise<{ ok: boolean; windowId?: number }>;
  redockMapTabToMainWindow?(sessionId: string): Promise<{ ok: boolean }>;
  onOpenMapSessionsChanged?(
    cb: (payload: { activeSessionId: string | null; sessions: OpenMapTabSession[] }) => void,
  ): () => void;

  /** Toolbar -> Fixes dropdown actions (`Fix CE Map`, `Fix MCC Map`, `Fix Halo Demo Map`, `Fix Halo MD Map`, `Fix Xbox Map`). */
  runMapFixAction(
    action: MapFixActionKind,
    options?: { useOpenMap?: boolean; filePath?: string; outputPath?: string },
  ): Promise<RunMapFixActionResult>;
}

declare global {
  interface Window {
    opence: OpenceApi;
  }
}

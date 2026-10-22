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
import type { BspInfo, BspSwapPreflightResult, BspSwapOptions, BspSwapResult } from '../../core/src/map/bsp-swapper';
import type { BitmapTagSummary, BitmapImageInfo, BitmapSequenceInfo } from '../../core/src/render/bitmap-codec';
import type { SoundTagSummary, SoundPitchRangeInfo, SoundPermutationInfo } from '../../core/src/render/sound-codec';

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
  BitmapTagSummary,
  BitmapImageInfo,
  BitmapSequenceInfo,
  SoundTagSummary,
  SoundPitchRangeInfo,
  SoundPermutationInfo,
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
  /** Custom item name for OpenCE Forge export (e.g. "Gauss Sniper"). */
  itemName?: string;
  /** Optional map of originalIndex -> custom item name when extracting multiple items. */
  itemNames?: Record<number, string>;
  /** Whether to capture gbxmodel raw data (vertices and triangle strips) into embeddedRawDataAssets. */
  captureGbxmodelRawData?: boolean;
}

export type ExtractTagsResult =
  | { ok: true; outputPath: string; tagCount: number; fileSizeBytes: number; carriedOverWarnings: DependencyWarningInfo[]; outputFiles?: string[] }
  | { ok: false; code: 'CANCELLED'; message: string }
  | { ok: false; code: string; message: string };

/* ------------------------------- Roadmap Item C: Whole Map Batch Extract ------------------------------- */

export type BatchExtractMode = 'skip' | 'replace';

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

export interface AppSettings {
  lastExtractDir: string | null;
  resourceMaps: { bitmaps: string | null; sounds: string | null; loc: string | null };
  versionResourceMaps?: Partial<Record<HaloBitmapVersion, VersionResourceMaps>>;
  openCeDirectory?: string | null;
  openCeExecutablePath?: string | null;
}

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
  | { type: 'inspect'; requestId: string; filePath: string }
  | { type: 'compress' | 'decompress'; requestId: string; filePath: string; outputPath: string }
  | { type: 'getDependencies'; requestId: string; originalIndices: number[] }
  | {
      type: 'extractTags';
      requestId: string;
      originalIndices: number[];
      outputPath: string;
      sourceMapName: string;
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
  | { type: 'bspSwapPreflight'; requestId: string; sourceFilePath: string; sourceBspIndex?: number; targetBspIndex?: number; sourceBspIndices?: number[] }
  | { type: 'getSourceBspMesh'; requestId: string; sourceFilePath: string; bspIndex?: number }
  | { type: 'performBspSwap'; requestId: string; sourceFilePath: string; options: BspSwapOptions; resourceMapPaths?: Partial<Record<ResourceMapKind, string | undefined>> }
  | { type: 'stageTagTestMap'; requestId: string; targetPath: string; bitmapsPath?: string; soundsPath?: string }
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
  | { type: 'cancel'; requestId: string };

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
  collisionObjFilePath?: string;
  textureFilePath?: string;
  scale?: number;
  flipYz?: boolean;
  centerOrigin?: boolean;
  forceAutoUv?: boolean;
  multiBoxCollision?: boolean;
  materialType?: number;
  slotMaterialTypes?: number[];
  templateTagIndex?: number;
  outputMode: 'inject' | 'ocetags' | 'both';
  outputOceTagsPath?: string;
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

export type GetBspRenderMeshResult =
  | { ok: true; mesh: BspRenderMesh }
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
}

export interface TagTestLaunchOptions {
  windowed?: boolean;
  resolution?: string;
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
  startBatchExtract(options: { parentDir: string; mode: BatchExtractMode }): Promise<BatchExtractResult>;
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
  /** Milestone 10: BSP Swapper - pick a source map file. */
  pickBspSourceMap(): Promise<{ path: string | null }>;
  pickBspResource?(kind: 'bitmaps' | 'sounds'): Promise<{ path: string | null }>;
  /** Milestone 10: BSP Swapper - preflight swap between source and target map. */
  bspSwapPreflight(sourceFilePath: string, sourceBspIndex?: number, targetBspIndex?: number, sourceBspIndices?: number[]): Promise<BspSwapPreflightResult>;
  /** Milestone 10.2: Extract 3D BSP render geometry from any map file. */
  getSourceBspMesh?(sourceFilePath: string, bspIndex?: number): Promise<GetBspRenderMeshResult>;
  /** Milestone 10: BSP Swapper - perform swap into currently open map. */
  performBspSwap(sourceFilePath: string, options: BspSwapOptions): Promise<BspSwapResult>;
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
  analyzeCollisionObj(filePath?: string, options?: { scale?: number; flipYz?: boolean; centerOrigin?: boolean; forceAutoUv?: boolean }): Promise<{ ok: boolean; summary?: any; filePath?: string; error?: string }>;
  exportUvTemplate(options: {
    objFilePath: string;
    size?: number;
    scale?: number;
    flipYz?: boolean;
    centerOrigin?: boolean;
    forceAutoUv?: boolean;
    previewOnly?: boolean;
  }): Promise<ExportUvTemplateResult>;
  buildCustomObjectTag(request: BuildCustomObjectRequest): Promise<BuildCustomObjectResult>;
  pickSaveOceTagsPath(defaultName: string): Promise<{ path: string | null }>;
  pickExportDirectory(): Promise<{ path: string | null }>;
  /** M13.5: MEK Deprotection, Asset Integrity & CRC32 Spoofer */
  inspectDeprotect?(): Promise<InspectDeprotectResult>;
  deprotectMap?(options?: DeprotectMapOptions): Promise<DeprotectMapResult>;
  spoofMapCrc32?(targetCrc32: number): Promise<SpoofMapCrc32Result>;
  tagTestSetAlwaysOnTop(flag: boolean): Promise<void>;
  tagTestIsAlwaysOnTop(): Promise<boolean>;
  tagTestTriggerFlycam(): Promise<{ ok: boolean; message?: string }>;
  setAlwaysOnTop(flag: boolean): Promise<void>;
  isAlwaysOnTop(): Promise<boolean>;
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    opence: OpenceApi;
  }
}

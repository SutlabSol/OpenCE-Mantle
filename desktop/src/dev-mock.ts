import type {
  OpenMapSummary,
  SaveMapResult,
  LoadMapResult,
  OpenceApi,
  ProgressEvent,
  LogEvent,
  GetDependenciesResult,
  ExtractTagsRequest,
  ExtractTagsResult,
  AppSettings,
  ResourceMapKind,
  ResourceMapStatus,
  ResourceMapPickResult,
  PlanInjectResult,
  ApplyInjectResult,
  SaveMapAsResult,
  InjectionMode,
  ConvertMapResult,
  GetTagFieldsResult,
  UpdateTagFieldResult,
  AddReflexiveChunkResult,
  GetDependencySlotsResult,
  SetDependencySlotResult,
  GetBspRenderMeshResult,
  GetBitmapTextureResult,
  GetScenarioObjectsResult,
  GetModelRenderGeometryResult,
  UpdateScenarioPlacementResult,
  DuplicateScenarioPlacementResult,
  AddScenarioPlacementResult,
  SwapScenarioPlacementResult,
  DeleteScenarioPlacementResult,
  ScenarioPlacementsSummary,
  ScenarioObjectPlacement,
  ScenarioObjectKind,
  GetReferencingTagsResult,
  GetUnicodeStringsResult,
  SetUnicodeStringResult,
  RenameTagResult,
  DuplicateTagResult,
} from '../electron/shared-types';
import { parseMockScenario, buildMockSummary, buildMockInjectPlan, buildMockVerifyEmbeddedDataResult, buildMockConvertReport, buildMockRepairConvertReport, buildMockModelPartsConvertReport, buildMockAlignConvertReport } from './test-fixtures/dependency-fixtures';

/**
 * Dev-only mock of window.opence, used when previewing the renderer in a plain browser
 * (no Electron main/preload present). Mirrors real inspectCustomEditionMap()/getDependencies()/
 * extractTags() output shapes so the UI - including the M4 DependencyDialog - can be visually
 * verified without the full desktop shell. Never used in the packaged app (main.ts/preload.ts
 * always provide the real API there); only loaded via a dynamic import gated on DEV in main.tsx,
 * so production bundles never include this file or its fixtures.
 *
 * Scenario selectable via `?mock=<name>` (see MOCK_SCENARIOS in test-fixtures/dependency-fixtures.ts):
 * clean, scenario-bsp, external-data, spheroid, blocked-data, bsp-only, large-list, deps-error, extract-error, slow-progress.
 */
const sampleTags = [
  { index: 0, tagId: 0xe1740000, primaryClassName: 'scenario', path: 'levels\\test\\bloodgulch\\bloodgulch', isExternal: false, estimatedSize: 215040 },
  { index: 1, tagId: 0xe1740001, primaryClassName: 'scenario_structure_bsp', path: 'levels\\test\\bloodgulch\\bloodgulch', isExternal: false, estimatedSize: null },
  { index: 2, tagId: 0xe1740002, primaryClassName: 'globals', path: 'globals\\globals', isExternal: false, estimatedSize: 4096 },
  { index: 3, tagId: 0xe1740003, primaryClassName: 'biped', path: 'characters\\masterchief\\masterchief', isExternal: false, estimatedSize: 8432 },
  { index: 4, tagId: 0xe1740004, primaryClassName: 'vehicle', path: 'vehicles\\warthog\\warthog', isExternal: false, estimatedSize: 12044 },
  { index: 5, tagId: 0xe1740005, primaryClassName: 'weapon', path: 'weapons\\pistol\\pistol', isExternal: false, estimatedSize: 6210 },
  { index: 6, tagId: 0xe1740006, primaryClassName: 'bitmap', path: 'levels\\test\\bloodgulch\\clear afternoon\\bitmaps\\cloud mask', isExternal: true, estimatedSize: null },
  { index: 7, tagId: 0xe1740007, primaryClassName: 'sound', path: 'sound\\sfx\\weapons\\pistol\\fire', isExternal: true, estimatedSize: null },
  { index: 8, tagId: 0xe1740008, primaryClassName: 'shader_environment', path: 'levels\\test\\bloodgulch\\shaders\\dirt', isExternal: false, estimatedSize: 1536 },
  { index: 9, tagId: 0xe1740009, primaryClassName: 'scenery', path: 'scenery\\rocks\\rock01', isExternal: false, estimatedSize: 3244 },
];

function mockLoadResult(filePath: string): LoadMapResult {
  return {
    status: 'ok',
    filePath,
    header: {
      scenarioName: 'bloodgulch',
      buildString: '01.00.01.0609',
      mapType: 1,
      crc32: 0x7b309554,
      tagDataOffset: 0x800,
      tagDataSize: 5213288,
      decompressedFileSize: 13936092,
      fileSizeOnDisk: 13936092,
      tagCount: 2455,
    },
    tags: sampleTags,
  };
}

export function installDevMock() {
  if (window.opence) return;
  (window as unknown as { __OPENCE_MOCK__: boolean }).__OPENCE_MOCK__ = true;

  const scenario = parseMockScenario(window.location.search);
  const progressListeners = new Set<(e: ProgressEvent) => void>();
  const logListeners = new Set<(e: LogEvent) => void>();
  let extractCancelled = false;
  let lastInjectMode: InjectionMode = 'add';
  /** The mock's "open map", so Inject -> modified -> Save behaves like the real app. */
  let currentMock: OpenMapSummary | null = null;
  const updatedListeners = new Set<(m: OpenMapSummary) => void>();
  const loadedListeners = new Set<(m: LoadMapResult) => void>();
  const mockResourceMapStatuses: Record<ResourceMapKind, ResourceMapStatus> = {
    bitmaps: { state: 'not-configured' },
    sounds: { state: 'not-configured' },
    loc: { state: 'not-configured' },
  };

  const fakeProgress = async (taskId: string) => {
    for (const [stage, percent] of [['Reading file', 10], ['Processing', 50], ['Writing file', 85], ['Done', 100]] as const) {
      await new Promise((r) => setTimeout(r, 180));
      progressListeners.forEach((cb) => cb({ taskId, stage, percent }));
    }
  };

  let mockScenarioSummary: ScenarioPlacementsSummary = {
    scenarioTagId: 0xe1740000,
    scenarioPath: 'levels\\test\\bloodgulch\\bloodgulch',
    totalObjects: 3,
    objects: [
      {
        id: 'vehicle-0',
        kind: 'vehicle',
        paletteIndex: 0,
        nameIndex: 0,
        objectTagId: 0xe1740004,
        objectPath: 'vehicles\\warthog\\mp_warthog',
        modelTagId: 0xe1740003,
        position: [10, 10, 0],
        rotation: [0, 0, 0],
      },
      {
        id: 'scenery-0',
        kind: 'scenery',
        paletteIndex: 0,
        nameIndex: 0,
        objectTagId: 0xe1740009,
        objectPath: 'scenery\\rocks\\rock01',
        modelTagId: 0xe1740003,
        position: [-15, 20, 0],
        rotation: [0.5, 0, 0],
      },
      {
        id: 'spawn-0',
        kind: 'spawn',
        paletteIndex: 0,
        nameIndex: -1,
        objectTagId: 0xffffffff,
        objectPath: 'Player Spawn (Red)',
        modelTagId: 0xffffffff,
        position: [0, -30, 1],
        rotation: [1.57, 0, 0],
        teamIndex: 0,
      },
    ],
    counts: {
      vehicles: 1,
      scenery: 1,
      bipeds: 0,
      weapons: 0,
      equipment: 0,
      spawns: 1,
    },
    palettes: {
      vehicles: [{ paletteIndex: 0, tagId: 0xe1740004, path: 'vehicles\\warthog\\mp_warthog', name: 'mp_warthog' }],
      scenery: [{ paletteIndex: 0, tagId: 0xe1740009, path: 'scenery\\rocks\\rock01', name: 'rock01' }],
      bipeds: [],
      weapons: [],
      equipment: [{ paletteIndex: 0, tagId: 0xe174000a, path: 'item collections\\single weapons\\assault rifle', name: 'assault rifle' }],
    },
  };

  const mock: OpenceApi = {
    openMapDialog: async () => {
      if (scenario === 'convert-retail' || scenario === 'convert-scripts' || scenario === 'convert-repairs' || scenario === 'convert-model-parts' || scenario === 'convert-align') {
        currentMock = null;
        return { status: 'unsupported', filePath: 'C:/HaloMD/maps/heh_2.map', message: 'This is a retail-layout map (cache version 7), for example a HaloMD or Mac demo map. It can be converted to a Custom Edition (609) map with "Convert to Custom Edition...". (mock)', layout: 'retail', convertible: true };
      }
      const r = mockLoadResult('C:/HaloCE/maps/bloodgulch.map');
      currentMock = r.status === 'ok' ? r : null;
      return r;
    },
    loadMap: async (filePath) => {
      const r = mockLoadResult(filePath);
      currentMock = r.status === 'ok' ? r : null;
      return r;
    },
    decompressMap: async (filePath) => {
      await fakeProgress('decompress');
      return { outputPath: filePath.replace('.map', '_decompressed.map'), originalSize: 4_100_000, newSize: 13_936_092 };
    },
    recompressMap: async (filePath) => {
      await fakeProgress('compress');
      return { outputPath: filePath.replace('.map', '_compressed.map'), originalSize: 13_936_092, newSize: 4_100_000 };
    },
    getDependencies: async (originalIndices): Promise<GetDependenciesResult> => {
      logListeners.forEach((cb) => cb({ level: 'info', message: `Extract requested: ${originalIndices.length} tag(s) selected.`, timestamp: Date.now() }));
      for (const [stage, percent] of [['Walking dependencies', 40], ['Done', 100]] as const) {
        await new Promise((r) => setTimeout(r, 150));
        progressListeners.forEach((cb) => cb({ taskId: 'getDependencies', stage, percent }));
      }
      if (scenario === 'deps-error') return { ok: false, code: 'UNEXPECTED_ERROR', message: 'Simulated dependency walk failure for testing (?mock=deps-error).' };
      return { ok: true, summary: buildMockSummary(scenario) };
    },
    extractTags: async (request: ExtractTagsRequest): Promise<ExtractTagsResult> => {
      extractCancelled = false;
      const summary = buildMockSummary(scenario);
      if (summary.allExcluded) return { ok: false, code: 'BSP_ONLY_SELECTION', message: 'Nothing in this selection can be extracted yet (only scenario_structure_bsp tags).' };

      const ticks = scenario === 'slow-progress' ? 10 : 3;
      for (let i = 0; i < ticks; i++) {
        if (extractCancelled) {
          progressListeners.forEach((cb) => cb({ taskId: 'extract', stage: 'Cancelled', percent: 0 }));
          return { ok: false, code: 'CANCELLED', message: 'Extraction was cancelled.' };
        }
        await new Promise((r) => setTimeout(r, scenario === 'slow-progress' ? 250 : 120));
        const percent = Math.round(((i + 1) / ticks) * 100);
        progressListeners.forEach((cb) => cb({ taskId: 'extract', stage: `Extracting tag ${i + 1} of ${ticks}`, percent }));
      }
      if (scenario === 'extract-error') return { ok: false, code: 'UNEXPECTED_ERROR', message: 'Simulated extraction failure for testing (?mock=extract-error).' };

      const outputPath = `C:\\Users\\Dev\\Documents\\${request.suggestedFileName}.ocetags`;
      logListeners.forEach((cb) => cb({ level: 'info', message: `Extracted ${summary.extractableTags.length} tag(s) to ${outputPath}`, timestamp: Date.now() }));
      return { ok: true, outputPath, tagCount: summary.extractableTags.length, fileSizeBytes: 182_300, carriedOverWarnings: summary.warnings };
    },
    cancelExtraction: () => {
      extractCancelled = true;
    },
    batchExtractPreflight: async () => ({
      ok: true,
      mapName: 'bloodgulch',
      scenarioName: 'levels\\test\\bloodgulch\\bloodgulch',
      parentDir: 'C:\\Users\\Dev\\Documents',
      targetDir: 'C:\\Users\\Dev\\Documents\\bloodgulch',
      totalTags: 2455,
      extractableCount: 2345,
      externalCount: 108,
      blockedCount: 2,
      estimatedTotalBytes: 18_400_000,
      freeSpaceBytes: 100_000_000_000,
      existingFileCount: 0,
    }),
    startBatchExtract: async (options) => {
      extractCancelled = false;
      const ticks = 5;
      for (let i = 0; i < ticks; i++) {
        if (extractCancelled) {
          return {
            ok: false,
            code: 'CANCELLED',
            message: 'Extraction was cancelled.',
            stagingDir: `${options.parentDir}\\bloodgulch\\.staging-mock`,
            targetDir: `${options.parentDir}\\bloodgulch`,
            partialSummary: {
              mapName: 'bloodgulch',
              targetDir: `${options.parentDir}\\bloodgulch`,
              totalTagsInMap: 2455,
              extractedCount: (i + 1) * 200,
              skippedCount: 0,
              blockedCount: 2,
              externalCount: 108,
              failedCount: 0,
              totalBytesWritten: 2_000_000,
              elapsedMs: 500,
              tags: [],
            },
          };
        }
        await new Promise((r) => setTimeout(r, 100));
        const percent = Math.round(((i + 1) / ticks) * 100);
        progressListeners.forEach((cb) => cb({ taskId: 'batchExtract', stage: `Extracting tag ${(i + 1) * 450} of 2345`, percent }));
      }
      return {
        ok: true,
        summary: {
          mapName: 'bloodgulch',
          targetDir: `${options.parentDir}\\bloodgulch`,
          totalTagsInMap: 2455,
          extractedCount: 2345,
          skippedCount: 0,
          blockedCount: 2,
          externalCount: 108,
          failedCount: 0,
          totalBytesWritten: 18_400_000,
          elapsedMs: 1200,
          tags: [],
          manifestPath: `${options.parentDir}\\bloodgulch\\manifest.json`,
          reportPath: `${options.parentDir}\\bloodgulch\\batch-extract-report.txt`,
        },
      };
    },
    cancelBatchExtract: () => {
      extractCancelled = true;
    },
    finalizeBatchExtract: async () => ({ ok: true }),
    openContainingFolder: async (filePath: string) => {
      logListeners.forEach((cb) => cb({ level: 'info', message: `(mock) Would open containing folder for ${filePath}`, timestamp: Date.now() }));
    },
    getSettings: async (): Promise<AppSettings> => ({ lastExtractDir: null, resourceMaps: { bitmaps: null, sounds: null, loc: null } }),
    notImplemented: (feature) => logListeners.forEach((cb) => cb({ level: 'warn', message: `${feature} not implemented yet`, timestamp: Date.now() })),
    showAbout: async () => logListeners.forEach((cb) => cb({ level: 'info', message: 'About OpenCE Modding Tool v0.1.0-dev', timestamp: Date.now() })),
    getAppVersion: async () => '0.1.0-dev',
    getRecentMaps: async () => ['C:/HaloCE/maps/bloodgulch.map'],
    pickResourceMap: async (kind): Promise<ResourceMapPickResult> => {
      const status: ResourceMapStatus = { state: 'ok', path: `C:\\HaloCE\\${kind}.map`, fileSizeBytes: 123_547_749, entryCount: 1706 };
      mockResourceMapStatuses[kind] = status;
      logListeners.forEach((cb) => cb({ level: 'info', message: `(mock) ${kind}.map set to ${status.path}`, timestamp: Date.now() }));
      return { ok: true, status };
    },
    getResourceMapStatuses: async () => ({ ...mockResourceMapStatuses }),
    identifyResourceMap: async (filePath: string, expectedVersion?: string) => ({
      ok: true,
      filePath,
      fileSizeBytes: 34_369_536,
      entryCount: 1568,
      tableOffset: 0x01e42000,
      detectedVersion: (expectedVersion as any) || 'ce',
      versionMatchConfidence: 'exact',
      entries: [
        { index: 0, name: 'ui/hud/bitmaps/hud_numbers', dataOffset: 0x10, size: 4096 },
        { index: 1, name: 'characters/cyborg/bitmaps/cyborg', dataOffset: 0x1010, size: 65536 },
        { index: 2, name: 'vehicles/warthog/bitmaps/warthog', dataOffset: 0x11010, size: 131072 },
      ],
    }),
    setResourceMapPath: async (kind, filePath) => {
      mockResourceMapStatuses[kind] = { state: 'ok', path: filePath, fileSizeBytes: 34_369_536, entryCount: 1568 };
      return { ok: true };
    },
    detectDefaultResourceMapPaths: async () => ({
      halomd: 'C:\\HaloMD\\maps\\bitmaps.map',
      ce: 'C:\\Program Files (x86)\\Microsoft Games\\Halo Custom Edition\\maps\\bitmaps.map',
      pc: 'C:\\Program Files (x86)\\Microsoft Games\\Halo\\maps\\bitmaps.map',
      demo: 'C:\\Program Files (x86)\\Microsoft Games\\Halo Demo\\maps\\bitmaps.map',
      mcc: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Halo The Master Chief Collection\\halo1\\maps\\bitmaps.map',
    }),
    getVersionSettings: async () => ({}),
    setVersionSettings: async () => ({ ok: true }),
    pickConvertResource: async (kind: 'bitmaps' | 'sounds') => {
      return { path: `C:\\HaloMD\\maps\\${kind}.map` };
    },
    pickInjectContainer: async () => ({ path: 'C:/mock/extracted.ocetags', paths: ['C:/mock/extracted.ocetags'] }),
    planInject: async (containerPath, mode) => {
      lastInjectMode = mode;
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true, plan: buildMockInjectPlan(scenario, containerPath, mode) };
    },
    applyInject: async (): Promise<ApplyInjectResult> => {
      await fakeProgress('applyInject');
      const plan = buildMockInjectPlan(scenario, 'mock.ocetags', lastInjectMode);
      const base = currentMock ?? (mockLoadResult('C:/HaloCE/maps/bloodgulch.map') as OpenMapSummary);
      const added = plan.toAdd.map((t, i) => ({ index: base.tags.length + i, tagId: 0xe000 + base.tags.length + i, primaryClassName: t.group, path: t.path, isExternal: false, estimatedSize: null }));
      currentMock = { ...base, modified: true, tags: [...base.tags, ...added], header: { ...base.header, tagCount: base.header.tagCount + added.length } };
      updatedListeners.forEach((cb) => cb(currentMock!));
      logListeners.forEach((cb) => cb({ level: 'info', message: `(mock) Injected in memory: ${plan.counts.added} added, ${plan.counts.swapped} swapped, ${plan.counts.reused} reused. Not saved yet.`, timestamp: Date.now() }));
      return { ok: true, addedCount: plan.counts.added, reusedCount: plan.counts.reused, swappedCount: plan.counts.swapped, map: currentMock };
    },
    saveMap: async (): Promise<SaveMapResult> => {
      if (!currentMock?.modified) return { ok: false, code: 'NOT_MODIFIED', message: 'There are no unsaved changes.' };
      await fakeProgress('saveMap');
      currentMock = { ...currentMock, modified: false };
      updatedListeners.forEach((cb) => cb(currentMock!));
      const result = { ok: true as const, outputPath: currentMock.filePath, scenarioName: 'bloodgulch', previousScenarioName: 'bloodgulch', crc32: 0x1a2b3c4d, warnings: [], staleChecksumWarning: 'The separate tag-file checksum was not recalculated (mock).', map: currentMock };
      logListeners.forEach((cb) => cb({ level: 'info', message: `(mock) Saved ${result.outputPath} - map name "${result.scenarioName}", CRC32 0x1a2b3c4d`, timestamp: Date.now() }));
      return result;
    },
    saveMapAs: async (): Promise<SaveMapAsResult> => {
      await fakeProgress('saveMapAs');
      const map: OpenMapSummary = { ...(currentMock ?? (mockLoadResult('C:/HaloCE/maps/bloodgulch.map') as OpenMapSummary)), filePath: 'C:\\HaloCE\\maps\\bloodgulch_copy.map', modified: false };
      currentMock = map;
      updatedListeners.forEach((cb) => cb(map));
      const result = { ok: true as const, outputPath: map.filePath, scenarioName: 'bloodgulch_copy', previousScenarioName: 'bloodgulch', crc32: 0x1a2b3c4d, warnings: [], staleChecksumWarning: 'The separate tag-file checksum was not recalculated (mock).', map };
      logListeners.forEach((cb) => cb({ level: 'info', message: `(mock) Saved ${result.outputPath} - map name "${result.scenarioName}" (changed from "bloodgulch" to match the file name), CRC32 0x1a2b3c4d`, timestamp: Date.now() }));
      return result;
    },
    discardChanges: async () => {
      if (!currentMock?.modified) return null;
      currentMock = mockLoadResult(currentMock.filePath) as OpenMapSummary;
      logListeners.forEach((cb) => cb({ level: 'info', message: '(mock) Discarded unsaved changes; reopened from disk.', timestamp: Date.now() }));
      return { ok: true as const, map: currentMock };
    },
    convertPreflight: async () => {
      await fakeProgress('convertPreflight');
      if (scenario === 'convert-repairs') return { ok: true, sourceFileName: 'theisland_3.map', report: buildMockRepairConvertReport() };
      if (scenario === 'convert-align') return { ok: true, sourceFileName: 'heh_2.map', report: buildMockAlignConvertReport() };
      if (scenario === 'convert-model-parts') return { ok: true, sourceFileName: 'theisland_3.map', report: buildMockModelPartsConvertReport() };
      return { ok: true, sourceFileName: 'heh_2.map', report: buildMockConvertReport(scenario === 'convert-scripts') };
    },
    convertMap: async (acknowledgeScripts, repairs): Promise<ConvertMapResult> => {
      if ((scenario === 'convert-repairs' || scenario === 'convert-align') && !repairs?.alignTagData) return { ok: false, code: 'REPAIR_REQUIRED', message: 'OpenCE needs the tag data alignment. Tick it to convert. (mock)' };
      if (scenario === 'convert-repairs' && !repairs?.scriptSyntaxData) return { ok: false, code: 'REPAIR_REQUIRED', message: 'OpenCE refuses this map without the script data repair. Tick it to convert. (mock)' };
      if (scenario === 'convert-scripts' && !acknowledgeScripts) return { ok: false, code: 'ACKNOWLEDGEMENT_REQUIRED', message: 'Confirm the script warning first. (mock)' };
      await fakeProgress('convertMap');
      const base = mockLoadResult('C:/HaloCE/maps/heh_2_ce.map') as OpenMapSummary;
      const map: OpenMapSummary = { ...base, header: { ...base.header, scenarioName: 'heh_2_ce', buildString: '01.00.00.0609', crc32: 0xd1c331e9, tagCount: 2410 } };
      currentMock = map;
      loadedListeners.forEach((cb) => cb(map));
      logListeners.forEach((cb) => cb({ level: 'info', message: '(mock) Converted to C:/HaloCE/maps/heh_2_ce.map - map name "heh_2_ce", CRC32 0x00000000 -> 0xD1C331E9. heh_2.map was not changed.', timestamp: Date.now() }));
      return { ok: true, sourcePath: 'C:/HaloMD/maps/heh_2.map', outputPath: map.filePath, scenarioName: 'heh_2_ce', previousScenarioName: 'heh_2', crc32: 0xd1c331e9, previousCrc32: 0, warnings: [], staleChecksumWarning: 'The separate tag-file checksum was not recalculated (mock).', map };
    },
    verifyEmbeddedData: async () => {
      await fakeProgress('verifyEmbeddedData');
      return buildMockVerifyEmbeddedDataResult(scenario);
    },
    getTagFields: async (tagIndex: number): Promise<GetTagFieldsResult> => {
      const tag = sampleTags.find((t) => t.index === tagIndex);
      if (!tag) return { ok: false, code: 'NOT_FOUND', message: 'Tag not found' };
      return {
        ok: true,
        data: {
          tagIndex: tag.index,
          tagId: tag.tagId,
          tagPath: tag.path,
          group: tag.primaryClassName,
          structName: tag.primaryClassName,
          fields: [
            { name: 'autoaim angle', kind: 'number', type: 'Angle', offset: 0, size: 4, value: 0.125 },
            { name: 'autoaim range', kind: 'number', type: 'float', offset: 4, size: 4, value: 15.0 },
            { name: 'rounds per second', kind: 'bounds', type: 'float', offset: 8, size: 8, value: [5.0, 10.0] },
            { name: 'flags', kind: 'bitfield', type: 'WeaponFlags', offset: 16, size: 4, value: 1, bitfieldFlags: ['vertical recoil', 'silenced', 'secondary trigger'], bitfieldWidth: 32 },
            { name: 'label', kind: 'string', type: 'TagString', offset: 20, size: 32, value: 'Assault Rifle' },
            { name: 'ready effect', kind: 'dependency', type: 'TagDependency', offset: 52, size: 16, value: 0xe1740007, dependencyClasses: ['effect', 'sound'], dependencyTarget: { tagId: 0xe1740007, path: 'sound\\sfx\\weapons\\pistol\\fire', group: 'sound' } },
          ],
        },
      };
    },
    updateTagField: async (_tagIndex: number, fieldName: string, newValue: unknown): Promise<UpdateTagFieldResult> => {
      if (!currentMock) return { ok: false, code: 'NO_MAP', message: 'No map open' };
      currentMock = { ...currentMock, modified: true };
      updatedListeners.forEach((cb) => cb(currentMock!));
      return { ok: true, fieldName, newValue, map: currentMock };
    },
    addReflexiveChunk: async (tagIndex: number, reflexiveFieldPath: string, _cloneFromIndex?: number): Promise<AddReflexiveChunkResult> => {
      if (!currentMock) return { ok: false, code: 'NO_MAP', message: 'No map open' };
      currentMock = { ...currentMock, modified: true };
      updatedListeners.forEach((cb) => cb(currentMock!));
      return { ok: true, tagIndex, reflexiveFieldPath, newElementIndex: 1, newCount: 2, map: currentMock };
    },
    getDependencySlots: async (): Promise<GetDependencySlotsResult> => ({
      ok: true,
      slots: [
        { fieldPath: 'model', fieldName: 'model', allowedClasses: ['gbxmodel'], currentTagId: 0xe1740003, currentPath: 'weapons\\assault rifle\\fp\\fp', currentGroup: 'gbxmodel' },
        { fieldPath: 'triggers[0].projectile', fieldName: 'projectile', allowedClasses: ['projectile'], currentTagId: 0xe1740007, currentPath: 'weapons\\assault rifle\\bullet', currentGroup: 'projectile' },
        { fieldPath: 'triggers[0].firing effect', fieldName: 'firing effect', allowedClasses: ['effect'], currentTagId: 0xffffffff, currentPath: null, currentGroup: null },
      ],
    }),
    setDependencySlot: async (_tagIndex: number, fieldPath: string, newTagId: number | null): Promise<SetDependencySlotResult> => {
      if (!currentMock) return { ok: false, code: 'NO_MAP', message: 'No map open' };
      currentMock = { ...currentMock, modified: true };
      updatedListeners.forEach((cb) => cb(currentMock!));
      return { ok: true, fieldPath, newTagId: newTagId ?? 0xffffffff, map: currentMock };
    },
    getBspRenderMesh: async (): Promise<GetBspRenderMeshResult> => ({
      ok: true,
      mesh: {
        bspIndex: 0,
        bspTagId: 0xe1740001,
        lightmapsBitmapTagId: 0xffffffff,
        worldBounds: [-100, -100, -10, 100, 100, 50],
        totalVertices: 4,
        totalTriangles: 2,
        submeshes: [
          {
            submeshIndex: 0,
            lightmapIndex: 0,
            lightmapBitmapIndex: -1,
            shaderTagId: 0xe1740008,
            shaderPermutation: 0,
            vertexCount: 4,
            vertices: new Float32Array([
              -100, -100, 0,  0, 0, 1,  0, 0,
               100, -100, 0,  0, 0, 1,  1, 0,
               100,  100, 0,  0, 0, 1,  1, 1,
              -100,  100, 0,  0, 0, 1,  0, 1,
            ]),
            lightmapUvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
            indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
            boundingBox: [-100, -100, 0, 100, 100, 0],
          },
        ],
      },
    }),
    getBitmapTexture: async (): Promise<GetBitmapTextureResult> => {
      const width = 64;
      const height = 64;
      const rgbaData = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const c = ((x >> 3) ^ (y >> 3)) & 1 ? 200 : 70;
          rgbaData[idx + 0] = c;
          rgbaData[idx + 1] = c;
          rgbaData[idx + 2] = c;
          rgbaData[idx + 3] = 255;
        }
      }
      return {
        ok: true,
        texture: {
          width,
          height,
          format: 10,
          rgbaData,
        },
      };
    },
    getScenarioObjects: async (): Promise<GetScenarioObjectsResult> => ({
      ok: true,
      summary: mockScenarioSummary,
    }),
    updateScenarioPlacement: async (placementId, updates): Promise<UpdateScenarioPlacementResult> => {
      if (!currentMock) return { ok: false, code: 'NO_MAP', message: 'No map open' };
      const obj = mockScenarioSummary.objects.find((o) => o.id === placementId);
      if (obj) {
        if (updates.position) obj.position = [...updates.position];
        if (updates.rotation) obj.rotation = [...updates.rotation];
        if (updates.paletteIndex !== undefined) obj.paletteIndex = updates.paletteIndex;
        if (updates.teamIndex !== undefined) obj.teamIndex = updates.teamIndex;
      }
      currentMock = { ...currentMock, modified: true };
      updatedListeners.forEach((cb) => cb(currentMock!));
      return { ok: true, summary: mockScenarioSummary, map: currentMock };
    },
    duplicateScenarioPlacement: async (placementId, offsetDelta): Promise<DuplicateScenarioPlacementResult> => {
      if (!currentMock) return { ok: false, code: 'NO_MAP', message: 'No map open' };
      const source = mockScenarioSummary.objects.find((o) => o.id === placementId);
      if (!source) return { ok: false, code: 'NOT_FOUND', message: `Object ${placementId} not found` };
      const delta = offsetDelta ?? [1.5, 1.5, 0];
      const kindKey = (source.kind === 'spawn' ? 'spawns' : `${source.kind}s`) as keyof typeof mockScenarioSummary.counts;
      const kindCount = mockScenarioSummary.counts[kindKey] || 0;
      const newPlacement: ScenarioObjectPlacement = {
        ...source,
        id: `${source.kind}-${kindCount}`,
        position: [source.position[0] + delta[0], source.position[1] + delta[1], source.position[2] + delta[2]],
      };
      mockScenarioSummary = {
        ...mockScenarioSummary,
        totalObjects: mockScenarioSummary.totalObjects + 1,
        objects: [...mockScenarioSummary.objects, newPlacement],
        counts: {
          ...mockScenarioSummary.counts,
          [kindKey]: kindCount + 1,
        },
      };
      currentMock = { ...currentMock, modified: true };
      updatedListeners.forEach((cb) => cb(currentMock!));
      return { ok: true, summary: mockScenarioSummary, newPlacement, map: currentMock };
    },
    addScenarioPlacement: async (kind, paletteIndex, position, rotation, teamIndex): Promise<AddScenarioPlacementResult> => {
      if (!currentMock) return { ok: false, code: 'NO_MAP', message: 'No map open' };
      const kindKey = (kind === 'spawn' ? 'spawns' : `${kind}s`) as keyof typeof mockScenarioSummary.counts;
      const kindCount = mockScenarioSummary.counts[kindKey] || 0;
      const palList = mockScenarioSummary.palettes[kind === 'spawn' || kind === 'equipment' ? 'vehicles' : (`${kind}s` as keyof typeof mockScenarioSummary.palettes)] || [];
      const pal = palList[paletteIndex];
      const newPlacement: ScenarioObjectPlacement = {
        id: `${kind}-${kindCount}`,
        kind,
        paletteIndex,
        nameIndex: -1,
        objectTagId: pal?.tagId ?? 0xffffffff,
        objectPath: pal?.path ?? `${kind}`,
        modelTagId: 0xffffffff,
        position: [...position],
        rotation: rotation ? [...rotation] : [0, 0, 0],
        teamIndex,
      };
      mockScenarioSummary = {
        ...mockScenarioSummary,
        totalObjects: mockScenarioSummary.totalObjects + 1,
        objects: [...mockScenarioSummary.objects, newPlacement],
        counts: {
          ...mockScenarioSummary.counts,
          [kindKey]: kindCount + 1,
        },
      };
      currentMock = { ...currentMock, modified: true };
      updatedListeners.forEach((cb) => cb(currentMock!));
      return { ok: true, summary: mockScenarioSummary, newPlacement, map: currentMock };
    },
    swapScenarioPlacement: async (placementId, newKind, newPaletteIndex): Promise<SwapScenarioPlacementResult> => {
      if (!currentMock) return { ok: false, code: 'NO_MAP', message: 'No map open' };
      const target = mockScenarioSummary.objects.find((o) => o.id === placementId);
      if (!target) return { ok: false, code: 'NOT_FOUND', message: `Object ${placementId} not found` };
      const pos = [...target.position] as [number, number, number];
      const rot = [...target.rotation] as [number, number, number];
      const team = target.teamIndex;
      const kindKey = (target.kind === 'spawn' ? 'spawns' : `${target.kind}s`) as keyof typeof mockScenarioSummary.counts;
      mockScenarioSummary = {
        ...mockScenarioSummary,
        totalObjects: mockScenarioSummary.totalObjects - 1,
        objects: mockScenarioSummary.objects.filter((o) => o.id !== placementId),
        counts: {
          ...mockScenarioSummary.counts,
          [kindKey]: Math.max(0, (mockScenarioSummary.counts[kindKey] || 0) - 1),
        },
      };
      const newKindKey = (newKind === 'spawn' ? 'spawns' : `${newKind}s`) as keyof typeof mockScenarioSummary.counts;
      const newKindCount = mockScenarioSummary.counts[newKindKey] || 0;
      const palList = mockScenarioSummary.palettes[newKind === 'spawn' || newKind === 'equipment' ? 'vehicles' : (`${newKind}s` as keyof typeof mockScenarioSummary.palettes)] || [];
      const pal = palList[newPaletteIndex];
      const newPlacement: ScenarioObjectPlacement = {
        id: `${newKind}-${newKindCount}`,
        kind: newKind,
        paletteIndex: newPaletteIndex,
        nameIndex: -1,
        objectTagId: pal?.tagId ?? 0xffffffff,
        objectPath: pal?.path ?? `${newKind}`,
        modelTagId: 0xffffffff,
        position: pos,
        rotation: rot,
        teamIndex: team,
      };
      mockScenarioSummary = {
        ...mockScenarioSummary,
        totalObjects: mockScenarioSummary.totalObjects + 1,
        objects: [...mockScenarioSummary.objects, newPlacement],
        counts: {
          ...mockScenarioSummary.counts,
          [newKindKey]: newKindCount + 1,
        },
      };
      currentMock = { ...currentMock, modified: true };
      updatedListeners.forEach((cb) => cb(currentMock!));
      return { ok: true, summary: mockScenarioSummary, newPlacement, map: currentMock };
    },
    deleteScenarioPlacement: async (placementId): Promise<DeleteScenarioPlacementResult> => {
      if (!currentMock) return { ok: false, code: 'NO_MAP', message: 'No map open' };
      const target = mockScenarioSummary.objects.find((o) => o.id === placementId);
      if (target) {
        const kindKey = (target.kind === 'spawn' ? 'spawns' : `${target.kind}s`) as keyof typeof mockScenarioSummary.counts;
        mockScenarioSummary = {
          ...mockScenarioSummary,
          totalObjects: mockScenarioSummary.totalObjects - 1,
          objects: mockScenarioSummary.objects.filter((o) => o.id !== placementId),
          counts: {
            ...mockScenarioSummary.counts,
            [kindKey]: Math.max(0, (mockScenarioSummary.counts[kindKey] ?? 0) - 1),
          },
        };
      }
      currentMock = { ...currentMock, modified: true };
      updatedListeners.forEach((cb) => cb(currentMock!));
      return { ok: true, summary: mockScenarioSummary, map: currentMock };
    },
    getModelGeometry: async (modelTagId: number): Promise<GetModelRenderGeometryResult> => ({
      ok: true,
      geometry: {
        modelTagId,
        modelPath: 'vehicles\\warthog\\warthog',
        lodLevel: 4,
        uScale: 1,
        vScale: 1,
        totalVertices: 8,
        totalTriangles: 12,
        submeshes: [
          {
            partIndex: 0,
            shaderIndex: 0,
            shaderTagId: 0xe1740008,
            vertexCount: 8,
            // A simple 2x2x2 cube
            vertices: new Float32Array([
              -1, -1, -1,  0, 0, -1,  0, 0,
               1, -1, -1,  0, 0, -1,  1, 0,
               1,  1, -1,  0, 0, -1,  1, 1,
              -1,  1, -1,  0, 0, -1,  0, 1,
              -1, -1,  1,  0, 0,  1,  0, 0,
               1, -1,  1,  0, 0,  1,  1, 0,
               1,  1,  1,  0, 0,  1,  1, 1,
              -1,  1,  1,  0, 0,  1,  0, 1,
            ]),
            indices: new Uint16Array([
              0, 1, 2, 0, 2, 3, // back
              4, 6, 5, 4, 7, 6, // front
              4, 5, 1, 4, 1, 0, // bottom
              3, 2, 6, 3, 6, 7, // top
              0, 3, 7, 0, 7, 4, // left
              1, 5, 6, 1, 6, 2, // right
            ]),
            boundingBox: [-1, -1, -1, 1, 1, 1],
          },
        ],
      },
    }),
    getReferencingTags: async (tagIndex: number): Promise<GetReferencingTagsResult> => ({
      ok: true,
      referencingTags: [
        {
          sourceTagIndex: 0,
          sourceTagId: 0xe1740000,
          sourcePath: 'levels\\test\\bloodgulch\\bloodgulch',
          sourceGroup: 'scenario',
          fieldPath: 'weapons[0].weapon',
        },
        {
          sourceTagIndex: 4,
          sourceTagId: 0xe1740004,
          sourcePath: 'globals\\globals',
          sourceGroup: 'globals',
          fieldPath: 'player information[0].unit',
        },
      ],
    }),
    getUnicodeStrings: async (tagIndex: number): Promise<GetUnicodeStringsResult> => ({
      ok: true,
      result: {
        tagIndex,
        tagId: 0xe1740010,
        tagPath: 'ui\\hud\\hud messages',
        strings: [
          { index: 0, text: 'Press [action] to swap weapons', byteLength: 62, allocatedBytes: 64, maxChars: 32, fileOffset: 1000, pointer: 0x40100000 },
          { index: 1, text: 'Reloading...', byteLength: 24, allocatedBytes: 32, maxChars: 16, fileOffset: 1064, pointer: 0x40100040 },
          { index: 2, text: 'Out of Ammo', byteLength: 22, allocatedBytes: 32, maxChars: 16, fileOffset: 1096, pointer: 0x40100060 },
        ],
      },
    }),
    setUnicodeString: async (tagIndex: number, stringIndex: number, newText: string): Promise<SetUnicodeStringResult> => {
      if (currentMock) {
        currentMock = { ...currentMock, modified: true };
        updatedListeners.forEach((cb) => cb(currentMock!));
      }
      return { ok: true, newText, map: currentMock! };
    },
    renameTag: async (tagIndex: number, newPath: string): Promise<RenameTagResult> => {
      if (currentMock) {
        currentMock = {
          ...currentMock,
          modified: true,
          tags: currentMock.tags.map((t) => (t.index === tagIndex ? { ...t, path: newPath } : t)),
        };
        updatedListeners.forEach((cb) => cb(currentMock!));
      }
      return { ok: true, path: newPath, map: currentMock! };
    },
    duplicateTag: async (tagIndex: number, newPath: string): Promise<DuplicateTagResult> => {
      const newTagIndex = currentMock ? currentMock.tags.length : tagIndex + 100;
      const newTagId = 0xe1740000 + newTagIndex * 0x10001;
      if (currentMock) {
        const source = currentMock.tags.find((t) => t.index === tagIndex) ?? currentMock.tags[0];
        const newTag = { ...source, index: newTagIndex, tagId: newTagId, path: newPath };
        currentMock = {
          ...currentMock,
          modified: true,
          tags: [...currentMock.tags, newTag],
        };
        updatedListeners.forEach((cb) => cb(currentMock!));
      }
      return { ok: true, newTagIndex, newTagId, path: newPath, map: currentMock! };
    },
    getSourceBspMesh: async (_sourceFilePath?: string, bspIndex = 0): Promise<GetBspRenderMeshResult> => ({
      ok: true,
      mesh: {
        bspIndex,
        bspCount: 2,
        bspNames: ['levels\\b30\\b30a', 'levels\\b30\\b30b'],
        bspTagId: 0xef7b0e05,
        lightmapsBitmapTagId: 0xef7c0e06,
        worldBounds: [-200, -200, -20, 200, 200, 50],
        totalVertices: bspIndex === 0 ? 50936 : 44105,
        totalTriangles: bspIndex === 0 ? 35105 : 25208,
        submeshes: [
          {
            submeshIndex: 0,
            lightmapIndex: 0,
            lightmapBitmapIndex: 0,
            shaderTagId: 0,
            shaderPermutation: 0,
            vertexCount: 4,
            vertices: new Float32Array([
              -50, -50, 0, 0, 0, 1, 0, 0,
              50, -50, 0, 0, 0, 1, 1, 0,
              50, 50, 0, 0, 0, 1, 1, 1,
              -50, 50, 0, 0, 0, 1, 0, 1,
            ]),
            lightmapUvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
            indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
            boundingBox: [-50, -50, 0, 50, 50, 0],
          },
        ],
      },
    }),
    pickBspSourceMap: async () => ({ path: 'C:\\HaloPC\\maps\\b30.map' }),
    pickBspResource: async () => ({ path: 'C:\\HaloPC\\maps\\bitmaps.map' }),
    bspSwapPreflight: async (_sourceFilePath, _srcIdx, _dstIdx, _sourceBspIndices) => ({
      ok: true,
      sourceBsps: [
        {
          index: 0,
          path: 'levels\\b30\\b30a',
          tagId: 0xef7b0e05,
          bspStart: 2048,
          bspSize: 8413184,
          bspAddress: 0x4133a000,
          vertexCount: 50936,
          triangleCount: 35105,
          submeshCount: 117,
          worldBounds: [-200, -200, -20, 200, 200, 50],
          hasDobc: true,
          hasDecals: true,
        },
        {
          index: 1,
          path: 'levels\\b30\\b30b',
          tagId: 0xefe10e6b,
          bspStart: 8415232,
          bspSize: 5566464,
          bspAddress: 0x415f1000,
          vertexCount: 44105,
          triangleCount: 25208,
          submeshCount: 177,
          worldBounds: [-42, -37, -108, 29, -7, 18],
          hasDobc: true,
          hasDecals: true,
        },
      ],
      targetBsps: [
        {
          index: 0,
          path: 'levels\\test\\bloodgulch\\bloodgulch',
          tagId: 0xeb0b0ab5,
          bspStart: 2048,
          bspSize: 1517568,
          bspAddress: 0x419cd800,
          vertexCount: 5762,
          triangleCount: 5503,
          submeshCount: 79,
          worldBounds: [-100, -100, -10, 100, 100, 30],
          hasDobc: false,
          hasDecals: false,
        },
      ],
      selectedSourceBsp: {
        index: 0,
        path: 'levels\\b30\\b30a',
        tagId: 0xef7b0e05,
        bspStart: 2048,
        bspSize: 8413184,
        bspAddress: 0x4133a000,
        vertexCount: 50936,
        triangleCount: 35105,
        submeshCount: 117,
        worldBounds: [-200, -200, -20, 200, 200, 50],
        hasDobc: true,
        hasDecals: true,
      },
      selectedTargetBsp: {
        index: 0,
        path: 'levels\\test\\bloodgulch\\bloodgulch',
        tagId: 0xeb0b0ab5,
        bspStart: 2048,
        bspSize: 1517568,
        bspAddress: 0x419cd800,
        vertexCount: 5762,
        triangleCount: 5503,
        submeshCount: 79,
        worldBounds: [-100, -100, -10, 100, 100, 30],
        hasDobc: false,
        hasDecals: false,
      },
      sizeDelta: 6895616,
      estimatedNewSize: 20831812,
      warnings: ['Source BSP contains Detail Objects (DOBC). Stripping recommended for multiplayer.'],
    }),
    performBspSwap: async (_sourceFilePath, options) => {
      if (currentMock) {
        currentMock = { ...currentMock, modified: true };
        updatedListeners.forEach((cb) => cb(currentMock!));
      }
      return {
        ok: true,
        buffer: Buffer.alloc(0),
        summary: {
          sourceBspName: 'levels\\b30\\b30a',
          targetBspName: 'levels\\test\\bloodgulch\\bloodgulch',
          oldSize: 13936196,
          newSize: 20831812,
          delta: 6895616,
          strippedDobc: options.stripDobcAndDecals ?? true,
          strippedDecals: options.stripDobcAndDecals ?? true,
          relocatedSpawns: options.relocateGroundObjects ? 16 : 0,
        },
      };
    },
    onProgress: (cb) => {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
    onLog: (cb) => {
      logListeners.add(cb);
      return () => logListeners.delete(cb);
    },
    onMenuAction: () => () => {},
    onMapLoaded: (cb) => {
      loadedListeners.add(cb);
      return () => loadedListeners.delete(cb);
    },
    onMapUpdated: (cb) => {
      updatedListeners.add(cb);
      return () => updatedListeners.delete(cb);
    },
    // M12: OpenCE Tag Test
    tagTestLaunch: async () => ({ ok: true }),
    tagTestStop: async () => ({ ok: true }),
    tagTestSendCommand: async (cmd: string) => ({ ok: true, response: `(mock response to "${cmd}")` }),
    tagTestHotReload: async () => ({ ok: true }),
    tagTestGetStatus: async () => ({ state: 'stopped', telnetConnected: false }),
    onTagTestLog: () => () => {},
    onTagTestStatusChange: () => () => {},
    pickOpenCeDirectory: async () => ({ path: 'C:\\Games\\Halo Custom Edition' }),
    getOpenCeConfig: async () => ({ directory: 'C:\\Games\\Halo Custom Edition', executable: 'C:\\Games\\Halo Custom Edition\\haloce.exe', exists: true }),
    setOpenCeDirectory: async () => ({ ok: true }),

    // M13.1: Bitmap Editor
    getBitmapInfo: async () => ({ ok: true }),
    getBitmapRgba: async () => ({ ok: true }),
    pickExportBitmapPath: async () => ({ path: 'C:\\exports\\bitmap.png' }),
    exportBitmapImage: async () => ({ ok: true }),
    pickImportBitmapPath: async () => ({ path: 'C:\\imports\\bitmap.png' }),
    replaceBitmapImage: async () => ({ ok: true }),
    getPathForFile: (file) => (file as unknown as { path?: string }).path ?? file.name,
  };

  window.opence = mock;
}

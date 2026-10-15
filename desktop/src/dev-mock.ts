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
    getPathForFile: (file) => (file as unknown as { path?: string }).path ?? file.name,
  };

  window.opence = mock;
}

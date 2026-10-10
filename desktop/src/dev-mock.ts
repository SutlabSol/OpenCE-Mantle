import type {
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
} from '../electron/shared-types';
import { parseMockScenario, buildMockSummary, buildMockInjectPlan, buildMockVerifyEmbeddedDataResult } from './test-fixtures/dependency-fixtures';

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
    openMapDialog: async () => mockLoadResult('C:/HaloCE/maps/bloodgulch.map'),
    loadMap: async (filePath) => mockLoadResult(filePath),
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
    pickInjectContainer: async () => ({ path: 'C:\\Users\\Dev\\Documents\\ui_ticker.ocetags' }),
    planInject: async (containerPath, mode) => {
      lastInjectMode = mode;
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true, plan: buildMockInjectPlan(scenario, containerPath, mode) };
    },
    applyInject: async (): Promise<ApplyInjectResult> => {
      await fakeProgress('applyInject');
      const plan = buildMockInjectPlan(scenario, 'mock.ocetags', lastInjectMode);
      return {
        ok: true,
        outputPath: 'C:\\HaloCE\\maps\\bloodgulch_injected.map',
        addedCount: plan.counts.added,
        reusedCount: plan.counts.reused,
        swappedCount: plan.counts.swapped,
        scenarioName: 'bloodgulch_injected',
        crc32: 0x43d032f3,
        warnings: [],
        staleChecksumWarning:
          'The header checksum (CRC32) and the internal map name were updated. The separate tag-file checksum (tag data header +0x8) was not recalculated; whether the game checks it is unverified.',
      };
    },
    saveMapAs: async (): Promise<SaveMapAsResult> => {
      await fakeProgress('saveMapAs');
      const result = { ok: true as const, outputPath: 'C:\\HaloCE\\maps\\bloodgulch_copy.map', scenarioName: 'bloodgulch_copy', crc32: 0x1a2b3c4d, warnings: [], staleChecksumWarning: 'The separate tag-file checksum was not recalculated (mock).' };
      logListeners.forEach((cb) => cb({ level: 'info', message: `(mock) Saved ${result.outputPath} - map name "${result.scenarioName}", CRC32 0x${result.crc32.toString(16).padStart(8, '0')}`, timestamp: Date.now() }));
      return result;
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
    onMapLoaded: () => () => {},
    getPathForFile: (file) => (file as unknown as { path?: string }).path ?? file.name,
  };

  window.opence = mock;
}

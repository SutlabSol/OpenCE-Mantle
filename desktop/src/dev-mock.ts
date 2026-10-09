import type { LoadMapResult, OpenceApi, ProgressEvent, LogEvent } from '../electron/shared-types';

/**
 * Dev-only mock of window.opence, used when previewing the renderer in a plain browser
 * (no Electron main/preload present). Mirrors real inspectCustomEditionMap() output shape
 * for bloodgulch.map so the UI can be visually verified without the full desktop shell.
 * Never used in the packaged app (main.ts/preload.ts always provide the real API there).
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

  const progressListeners = new Set<(e: ProgressEvent) => void>();
  const logListeners = new Set<(e: LogEvent) => void>();

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
    notImplemented: (feature) => logListeners.forEach((cb) => cb({ level: 'warn', message: `${feature} not implemented yet`, timestamp: Date.now() })),
    showAbout: async () => logListeners.forEach((cb) => cb({ level: 'info', message: 'About OpenCE Modding Tool v0.1.0-dev', timestamp: Date.now() })),
    getAppVersion: async () => '0.1.0-dev',
    getRecentMaps: async () => ['C:/HaloCE/maps/bloodgulch.map'],
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
    getPathForFile: (file) => (file as any).path ?? file.name,
  };

  window.opence = mock;
}

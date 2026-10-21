import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  OpenceApi,
  ProgressEvent,
  LogEvent,
  LoadMapResult,
  ExtractTagsRequest,
  ResourceMapKind,
  InjectionMode,
  OpenMapSummary,
  ConvertRepairChoice,
  ConvertResourcePaths,
  HaloBitmapVersion,
  TagTestStatus,
  TagTestLaunchOptions,
  TagTestLogEntry,
} from './shared-types';

const api: OpenceApi = {
  openMapDialog: () => ipcRenderer.invoke('dialog:openMap'),
  loadMap: (filePath: string) => ipcRenderer.invoke('map:load', filePath),
  decompressMap: (filePath: string) => ipcRenderer.invoke('map:decompress', filePath),
  recompressMap: (filePath: string) => ipcRenderer.invoke('map:recompress', filePath),
  getDependencies: (originalIndices: number[]) => ipcRenderer.invoke('deps:get', originalIndices),
  extractTags: (request: ExtractTagsRequest) => ipcRenderer.invoke('tags:extract', request),
  cancelExtraction: () => ipcRenderer.send('tags:cancelExtract'),
  batchExtractPreflight: () => ipcRenderer.invoke('tags:batchExtractPreflight'),
  startBatchExtract: (options) => ipcRenderer.invoke('tags:startBatchExtract', options),
  cancelBatchExtract: () => ipcRenderer.send('tags:cancelBatchExtract'),
  finalizeBatchExtract: (request) => ipcRenderer.invoke('tags:finalizeBatchExtract', request),
  pickResourceMap: (kind: ResourceMapKind) => ipcRenderer.invoke('resourceMaps:pick', kind),
  getResourceMapStatuses: () => ipcRenderer.invoke('resourceMaps:getStatuses'),
  identifyResourceMap: (filePath, expectedVersion, expectedKind) => ipcRenderer.invoke('resourceMaps:identify', filePath, expectedVersion, expectedKind),
  setResourceMapPath: (kind, filePath) => ipcRenderer.invoke('resourceMaps:setPath', kind, filePath),
  detectDefaultResourceMapPaths: () => ipcRenderer.invoke('resourceMaps:detectDefaultPaths'),
  getVersionSettings: () => ipcRenderer.invoke('resourceMaps:getVersionSettings'),
  setVersionSettings: (version: HaloBitmapVersion, maps: { bitmaps?: string | null; sounds?: string | null; loc?: string | null }) =>
    ipcRenderer.invoke('resourceMaps:setVersionSettings', version, maps),
  pickInjectContainer: () => ipcRenderer.invoke('tags:pickInjectContainer'),
  planInject: (containerPath: string, mode: InjectionMode) => ipcRenderer.invoke('tags:planInject', containerPath, mode),
  applyInject: () => ipcRenderer.invoke('tags:applyInject'),
  saveMap: () => ipcRenderer.invoke('map:save'),
  saveMapAs: () => ipcRenderer.invoke('map:saveAs'),
  discardChanges: () => ipcRenderer.invoke('map:discard'),
  verifyEmbeddedData: () => ipcRenderer.invoke('tags:verifyEmbeddedData'),
  getTagFields: (tagIndex: number) => ipcRenderer.invoke('tags:getFields', tagIndex),
  updateTagField: (tagIndex: number, fieldName: string, newValue: unknown) => ipcRenderer.invoke('tags:updateField', tagIndex, fieldName, newValue),
  addReflexiveChunk: (tagIndex: number, reflexiveFieldPath: string, cloneFromIndex?: number) =>
    ipcRenderer.invoke('tags:addReflexiveChunk', tagIndex, reflexiveFieldPath, cloneFromIndex),
  getDependencySlots: (tagIndex: number) => ipcRenderer.invoke('tags:getDependencySlots', tagIndex),
  setDependencySlot: (tagIndex: number, fieldPath: string, newTagId: number | null) => ipcRenderer.invoke('tags:setDependencySlot', tagIndex, fieldPath, newTagId),
  getReferencingTags: (tagIndex: number) => ipcRenderer.invoke('tags:getReferencingTags', tagIndex),
  getUnicodeStrings: (tagIndex: number) => ipcRenderer.invoke('tags:getUnicodeStrings', tagIndex),
  setUnicodeString: (tagIndex: number, stringIndex: number, newText: string) => ipcRenderer.invoke('tags:setUnicodeString', tagIndex, stringIndex, newText),
  renameTag: (tagIndex: number, newPath: string) => ipcRenderer.invoke('tags:renameTag', tagIndex, newPath),
  duplicateTag: (tagIndex: number, newPath: string) => ipcRenderer.invoke('tags:duplicateTag', tagIndex, newPath),
  pickBspSourceMap: () => ipcRenderer.invoke('dialog:pickBspSourceMap'),
  pickBspResource: (kind: 'bitmaps' | 'sounds') => ipcRenderer.invoke('dialog:pickBspResource', kind),
  bspSwapPreflight: (sourceFilePath: string, sourceBspIndex?: number, targetBspIndex?: number, sourceBspIndices?: number[]) =>
    ipcRenderer.invoke('bsp:swapPreflight', sourceFilePath, sourceBspIndex, targetBspIndex, sourceBspIndices),
  getSourceBspMesh: (sourceFilePath: string, bspIndex?: number) =>
    ipcRenderer.invoke('bsp:getSourceMesh', sourceFilePath, bspIndex),
  performBspSwap: (sourceFilePath: string, options: any) =>
    ipcRenderer.invoke('bsp:performSwap', sourceFilePath, options),
  getBspRenderMesh: (bspIndex?: number) => ipcRenderer.invoke('render:getBspMesh', bspIndex),
  getBitmapTexture: (bitmapTagId: number, imageIndex?: number) => ipcRenderer.invoke('render:getBitmapTexture', bitmapTagId, imageIndex),
  getScenarioObjects: () => ipcRenderer.invoke('render:getScenarioObjects'),
  getModelGeometry: (modelTagId: number, lod?: number) => ipcRenderer.invoke('render:getModelGeometry', modelTagId, lod),
  updateScenarioPlacement: (placementId: string, updates: any) => ipcRenderer.invoke('render:updateScenarioPlacement', placementId, updates),
  duplicateScenarioPlacement: (placementId: string, offsetDelta?: [number, number, number]) =>
    ipcRenderer.invoke('render:duplicateScenarioPlacement', placementId, offsetDelta),
  addScenarioPlacement: (
    kind: any,
    paletteIndex: number,
    position: [number, number, number],
    rotation?: [number, number, number],
    teamIndex?: number,
  ) => ipcRenderer.invoke('render:addScenarioPlacement', kind, paletteIndex, position, rotation, teamIndex),
  swapScenarioPlacement: (
    placementId: string,
    newKind: any,
    newPaletteIndex: number,
  ) => ipcRenderer.invoke('render:swapScenarioPlacement', placementId, newKind, newPaletteIndex),
  deleteScenarioPlacement: (placementId: string) => ipcRenderer.invoke('render:deleteScenarioPlacement', placementId),
  getBitmapInfo: (tagIndex: number) => ipcRenderer.invoke('bitmap:getInfo', tagIndex),
  getBitmapRgba: (tagIndex: number, imageIndex: number) => ipcRenderer.invoke('bitmap:getRgba', tagIndex, imageIndex),
  pickExportBitmapPath: (defaultName: string, format: 'png' | 'dds') =>
    ipcRenderer.invoke('dialog:pickExportBitmapPath', defaultName, format),
  exportBitmapImage: (tagIndex: number, imageIndex: number, format: 'png' | 'dds', outputPath: string) =>
    ipcRenderer.invoke('bitmap:export', tagIndex, imageIndex, format, outputPath),
  pickImportBitmapPath: () => ipcRenderer.invoke('dialog:pickImportBitmapPath'),
  replaceBitmapImage: (tagIndex: number, imageIndex: number, inputPath: string, targetFormat?: number) =>
    ipcRenderer.invoke('bitmap:replace', tagIndex, imageIndex, inputPath, targetFormat),
  getSoundInfo: (tagIndex: number) => ipcRenderer.invoke('sound:getInfo', tagIndex),
  getSoundWav: (tagIndex: number, pitchRangeIndex: number, permutationIndex: number) =>
    ipcRenderer.invoke('sound:getWav', tagIndex, pitchRangeIndex, permutationIndex),
  pickExportSoundPath: (defaultName: string) => ipcRenderer.invoke('dialog:pickExportSoundPath', defaultName),
  exportSoundWav: (tagIndex: number, pitchRangeIndex: number, permutationIndex: number, outputPath: string) =>
    ipcRenderer.invoke('sound:export', tagIndex, pitchRangeIndex, permutationIndex, outputPath),
  pickImportSoundPath: () => ipcRenderer.invoke('dialog:pickImportSoundPath'),
  replaceSoundWav: (tagIndex: number, pitchRangeIndex: number, permutationIndex: number, inputPath: string) =>
    ipcRenderer.invoke('sound:replace', tagIndex, pitchRangeIndex, permutationIndex, inputPath),
  pickExport3dPath: (defaultName: string, format: 'obj' | 'glb') =>
    ipcRenderer.invoke('dialog:pickExport3dPath', defaultName, format),
  pickObjFile: () => ipcRenderer.invoke('dialog:pickObjFile'),
  analyzeCollisionObj: (filePath?: string) => ipcRenderer.invoke('collision:analyzeObj', filePath),
  pickExportDirectory: () => ipcRenderer.invoke('dialog:pickExportDirectory'),
  exportModel3d: (modelTagId: number, lod: number | undefined, format: 'obj' | 'glb', outputPath: string) =>
    ipcRenderer.invoke('3d:exportModel', modelTagId, lod, format, outputPath),
  exportBsp3d: (bspIndex: number, format: 'obj' | 'glb', outputPath: string) =>
    ipcRenderer.invoke('3d:exportBsp', bspIndex, format, outputPath),
  convertPreflight: (source: 'open' | 'pick', resourcePaths?: ConvertResourcePaths) => ipcRenderer.invoke('map:convertPreflight', source, resourcePaths),
  convertMap: (acknowledgeScripts: boolean, repairs: ConvertRepairChoice, resourcePaths?: ConvertResourcePaths) => ipcRenderer.invoke('map:convert', acknowledgeScripts, repairs, resourcePaths),
  pickConvertResource: (kind: 'bitmaps' | 'sounds' | 'loc') => ipcRenderer.invoke('dialog:pickConvertResource', kind),
  openContainingFolder: (filePath: string) => ipcRenderer.invoke('app:openContainingFolder', filePath),
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  notImplemented: (feature: string) => ipcRenderer.send('app:notImplemented', feature),
  showAbout: () => ipcRenderer.invoke('app:showAbout'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getRecentMaps: () => ipcRenderer.invoke('app:recentMaps'),
  onProgress: (cb: (e: ProgressEvent) => void) => {
    const listener = (_: unknown, data: ProgressEvent) => cb(data);
    ipcRenderer.on('map:progress', listener);
    return () => ipcRenderer.removeListener('map:progress', listener);
  },
  onLog: (cb: (e: LogEvent) => void) => {
    const listener = (_: unknown, data: LogEvent) => cb(data);
    ipcRenderer.on('app:log', listener);
    return () => ipcRenderer.removeListener('app:log', listener);
  },
  onMenuAction: (cb: (action: string) => void) => {
    const listener = (_: unknown, action: string) => cb(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
  onMapLoaded: (cb: (result: LoadMapResult) => void) => {
    const listener = (_: unknown, data: LoadMapResult) => cb(data);
    ipcRenderer.on('map:loaded', listener);
    return () => ipcRenderer.removeListener('map:loaded', listener);
  },
  onMapUpdated: (cb: (result: OpenMapSummary) => void) => {
    const listener = (_: unknown, data: OpenMapSummary) => cb(data);
    ipcRenderer.on('map:updated', listener);
    return () => ipcRenderer.removeListener('map:updated', listener);
  },
  // M12: OpenCE Tag Test
  tagTestLaunch: (options?: TagTestLaunchOptions) => ipcRenderer.invoke('tagTest:launch', options),
  tagTestStop: () => ipcRenderer.invoke('tagTest:stop'),
  tagTestSendCommand: (command: string) => ipcRenderer.invoke('tagTest:sendCommand', command),
  tagTestHotReload: () => ipcRenderer.invoke('tagTest:hotReload'),
  tagTestGetStatus: () => ipcRenderer.invoke('tagTest:getStatus'),
  onTagTestLog: (cb: (entry: TagTestLogEntry) => void) => {
    const listener = (_: unknown, data: TagTestLogEntry) => cb(data);
    ipcRenderer.on('tagTest:log', listener);
    return () => ipcRenderer.removeListener('tagTest:log', listener);
  },
  onTagTestStatusChange: (cb: (status: TagTestStatus) => void) => {
    const listener = (_: unknown, data: TagTestStatus) => cb(data);
    ipcRenderer.on('tagTest:status', listener);
    return () => ipcRenderer.removeListener('tagTest:status', listener);
  },
  pickOpenCeDirectory: () => ipcRenderer.invoke('tagTest:pickDir'),
  getOpenCeConfig: () => ipcRenderer.invoke('tagTest:getConfig'),
  setOpenCeDirectory: (dir: string | null) => ipcRenderer.invoke('tagTest:setDir', dir),
  tagTestSetAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('tagTest:setAlwaysOnTop', flag),
  tagTestIsAlwaysOnTop: () => ipcRenderer.invoke('tagTest:isAlwaysOnTop'),
  tagTestTriggerFlycam: () => ipcRenderer.invoke('tagTest:triggerFlycam'),
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:isAlwaysOnTop'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('opence', api);

"use strict";

// electron/preload.ts
var import_electron = require("electron");
var api = {
  openMapDialog: () => import_electron.ipcRenderer.invoke("dialog:openMap"),
  loadMap: (filePath) => import_electron.ipcRenderer.invoke("map:load", filePath),
  decompressMap: (filePath) => import_electron.ipcRenderer.invoke("map:decompress", filePath),
  recompressMap: (filePath) => import_electron.ipcRenderer.invoke("map:recompress", filePath),
  getDependencies: (originalIndices) => import_electron.ipcRenderer.invoke("deps:get", originalIndices),
  extractTags: (request) => import_electron.ipcRenderer.invoke("tags:extract", request),
  cancelExtraction: () => import_electron.ipcRenderer.send("tags:cancelExtract"),
  batchExtractPreflight: () => import_electron.ipcRenderer.invoke("tags:batchExtractPreflight"),
  startBatchExtract: (options) => import_electron.ipcRenderer.invoke("tags:startBatchExtract", options),
  cancelBatchExtract: () => import_electron.ipcRenderer.send("tags:cancelBatchExtract"),
  finalizeBatchExtract: (request) => import_electron.ipcRenderer.invoke("tags:finalizeBatchExtract", request),
  pickResourceMap: (kind) => import_electron.ipcRenderer.invoke("resourceMaps:pick", kind),
  getResourceMapStatuses: () => import_electron.ipcRenderer.invoke("resourceMaps:getStatuses"),
  identifyResourceMap: (filePath, expectedVersion, expectedKind) => import_electron.ipcRenderer.invoke("resourceMaps:identify", filePath, expectedVersion, expectedKind),
  setResourceMapPath: (kind, filePath) => import_electron.ipcRenderer.invoke("resourceMaps:setPath", kind, filePath),
  detectDefaultResourceMapPaths: () => import_electron.ipcRenderer.invoke("resourceMaps:detectDefaultPaths"),
  getVersionSettings: () => import_electron.ipcRenderer.invoke("resourceMaps:getVersionSettings"),
  setVersionSettings: (version, maps) => import_electron.ipcRenderer.invoke("resourceMaps:setVersionSettings", version, maps),
  pickInjectContainer: () => import_electron.ipcRenderer.invoke("tags:pickInjectContainer"),
  planInject: (containerPath, mode) => import_electron.ipcRenderer.invoke("tags:planInject", containerPath, mode),
  applyInject: () => import_electron.ipcRenderer.invoke("tags:applyInject"),
  saveMap: () => import_electron.ipcRenderer.invoke("map:save"),
  saveMapAs: () => import_electron.ipcRenderer.invoke("map:saveAs"),
  discardChanges: () => import_electron.ipcRenderer.invoke("map:discard"),
  verifyEmbeddedData: () => import_electron.ipcRenderer.invoke("tags:verifyEmbeddedData"),
  getTagFields: (tagIndex) => import_electron.ipcRenderer.invoke("tags:getFields", tagIndex),
  updateTagField: (tagIndex, fieldName, newValue) => import_electron.ipcRenderer.invoke("tags:updateField", tagIndex, fieldName, newValue),
  addReflexiveChunk: (tagIndex, reflexiveFieldPath, cloneFromIndex) => import_electron.ipcRenderer.invoke("tags:addReflexiveChunk", tagIndex, reflexiveFieldPath, cloneFromIndex),
  getDependencySlots: (tagIndex) => import_electron.ipcRenderer.invoke("tags:getDependencySlots", tagIndex),
  setDependencySlot: (tagIndex, fieldPath, newTagId) => import_electron.ipcRenderer.invoke("tags:setDependencySlot", tagIndex, fieldPath, newTagId),
  getReferencingTags: (tagIndex) => import_electron.ipcRenderer.invoke("tags:getReferencingTags", tagIndex),
  getUnicodeStrings: (tagIndex) => import_electron.ipcRenderer.invoke("tags:getUnicodeStrings", tagIndex),
  setUnicodeString: (tagIndex, stringIndex, newText) => import_electron.ipcRenderer.invoke("tags:setUnicodeString", tagIndex, stringIndex, newText),
  renameTag: (tagIndex, newPath) => import_electron.ipcRenderer.invoke("tags:renameTag", tagIndex, newPath),
  duplicateTag: (tagIndex, newPath) => import_electron.ipcRenderer.invoke("tags:duplicateTag", tagIndex, newPath),
  pickBspSourceMap: () => import_electron.ipcRenderer.invoke("dialog:pickBspSourceMap"),
  pickBspResource: (kind) => import_electron.ipcRenderer.invoke("dialog:pickBspResource", kind),
  bspSwapPreflight: (sourceFilePath, sourceBspIndex, targetBspIndex, sourceBspIndices) => import_electron.ipcRenderer.invoke("bsp:swapPreflight", sourceFilePath, sourceBspIndex, targetBspIndex, sourceBspIndices),
  getSourceBspMesh: (sourceFilePath, bspIndex) => import_electron.ipcRenderer.invoke("bsp:getSourceMesh", sourceFilePath, bspIndex),
  performBspSwap: (sourceFilePath, options) => import_electron.ipcRenderer.invoke("bsp:performSwap", sourceFilePath, options),
  getBspRenderMesh: (bspIndex) => import_electron.ipcRenderer.invoke("render:getBspMesh", bspIndex),
  getBitmapTexture: (bitmapTagId, imageIndex) => import_electron.ipcRenderer.invoke("render:getBitmapTexture", bitmapTagId, imageIndex),
  getScenarioObjects: () => import_electron.ipcRenderer.invoke("render:getScenarioObjects"),
  getModelGeometry: (modelTagId, lod) => import_electron.ipcRenderer.invoke("render:getModelGeometry", modelTagId, lod),
  updateScenarioPlacement: (placementId, updates) => import_electron.ipcRenderer.invoke("render:updateScenarioPlacement", placementId, updates),
  duplicateScenarioPlacement: (placementId, offsetDelta) => import_electron.ipcRenderer.invoke("render:duplicateScenarioPlacement", placementId, offsetDelta),
  addScenarioPlacement: (kind, paletteIndex, position, rotation, teamIndex) => import_electron.ipcRenderer.invoke("render:addScenarioPlacement", kind, paletteIndex, position, rotation, teamIndex),
  swapScenarioPlacement: (placementId, newKind, newPaletteIndex) => import_electron.ipcRenderer.invoke("render:swapScenarioPlacement", placementId, newKind, newPaletteIndex),
  deleteScenarioPlacement: (placementId) => import_electron.ipcRenderer.invoke("render:deleteScenarioPlacement", placementId),
  getBitmapInfo: (tagIndex) => import_electron.ipcRenderer.invoke("bitmap:getInfo", tagIndex),
  getBitmapRgba: (tagIndex, imageIndex) => import_electron.ipcRenderer.invoke("bitmap:getRgba", tagIndex, imageIndex),
  pickExportBitmapPath: (defaultName, format) => import_electron.ipcRenderer.invoke("dialog:pickExportBitmapPath", defaultName, format),
  exportBitmapImage: (tagIndex, imageIndex, format, outputPath) => import_electron.ipcRenderer.invoke("bitmap:export", tagIndex, imageIndex, format, outputPath),
  pickImportBitmapPath: () => import_electron.ipcRenderer.invoke("dialog:pickImportBitmapPath"),
  replaceBitmapImage: (tagIndex, imageIndex, inputPath, targetFormat) => import_electron.ipcRenderer.invoke("bitmap:replace", tagIndex, imageIndex, inputPath, targetFormat),
  getSoundInfo: (tagIndex) => import_electron.ipcRenderer.invoke("sound:getInfo", tagIndex),
  getSoundWav: (tagIndex, pitchRangeIndex, permutationIndex) => import_electron.ipcRenderer.invoke("sound:getWav", tagIndex, pitchRangeIndex, permutationIndex),
  pickExportSoundPath: (defaultName) => import_electron.ipcRenderer.invoke("dialog:pickExportSoundPath", defaultName),
  exportSoundWav: (tagIndex, pitchRangeIndex, permutationIndex, outputPath) => import_electron.ipcRenderer.invoke("sound:export", tagIndex, pitchRangeIndex, permutationIndex, outputPath),
  pickImportSoundPath: () => import_electron.ipcRenderer.invoke("dialog:pickImportSoundPath"),
  replaceSoundWav: (tagIndex, pitchRangeIndex, permutationIndex, inputPath) => import_electron.ipcRenderer.invoke("sound:replace", tagIndex, pitchRangeIndex, permutationIndex, inputPath),
  pickExport3dPath: (defaultName, format) => import_electron.ipcRenderer.invoke("dialog:pickExport3dPath", defaultName, format),
  pickObjFile: () => import_electron.ipcRenderer.invoke("dialog:pickObjFile"),
  analyzeCollisionObj: (filePath, options) => import_electron.ipcRenderer.invoke("collision:analyzeObj", filePath, options),
  exportUvTemplate: (options) => import_electron.ipcRenderer.invoke("objectBuilder:exportUvTemplate", options),
  pickSaveOceTagsPath: (defaultName) => import_electron.ipcRenderer.invoke("objectBuilder:pickSaveOceTagsPath", defaultName),
  buildCustomObjectTag: (request) => import_electron.ipcRenderer.invoke("objectBuilder:build", request),
  pickExportDirectory: () => import_electron.ipcRenderer.invoke("dialog:pickExportDirectory"),
  inspectDeprotect: () => import_electron.ipcRenderer.invoke("deprotect:inspect"),
  deprotectMap: (options) => import_electron.ipcRenderer.invoke("deprotect:run", options),
  spoofMapCrc32: (targetCrc32) => import_electron.ipcRenderer.invoke("deprotect:spoofCrc32", targetCrc32),
  exportModel3d: (modelTagId, lod, format, outputPath) => import_electron.ipcRenderer.invoke("3d:exportModel", modelTagId, lod, format, outputPath),
  exportBsp3d: (bspIndex, format, outputPath) => import_electron.ipcRenderer.invoke("3d:exportBsp", bspIndex, format, outputPath),
  convertPreflight: (source, resourcePaths) => import_electron.ipcRenderer.invoke("map:convertPreflight", source, resourcePaths),
  convertMap: (acknowledgeScripts, repairs, resourcePaths) => import_electron.ipcRenderer.invoke("map:convert", acknowledgeScripts, repairs, resourcePaths),
  pickConvertResource: (kind) => import_electron.ipcRenderer.invoke("dialog:pickConvertResource", kind),
  openContainingFolder: (filePath) => import_electron.ipcRenderer.invoke("app:openContainingFolder", filePath),
  getSettings: () => import_electron.ipcRenderer.invoke("app:getSettings"),
  notImplemented: (feature) => import_electron.ipcRenderer.send("app:notImplemented", feature),
  showAbout: () => import_electron.ipcRenderer.invoke("app:showAbout"),
  getAppVersion: () => import_electron.ipcRenderer.invoke("app:version"),
  getRecentMaps: () => import_electron.ipcRenderer.invoke("app:recentMaps"),
  onProgress: (cb) => {
    const listener = (_, data) => cb(data);
    import_electron.ipcRenderer.on("map:progress", listener);
    return () => import_electron.ipcRenderer.removeListener("map:progress", listener);
  },
  onLog: (cb) => {
    const listener = (_, data) => cb(data);
    import_electron.ipcRenderer.on("app:log", listener);
    return () => import_electron.ipcRenderer.removeListener("app:log", listener);
  },
  onMenuAction: (cb) => {
    const listener = (_, action) => cb(action);
    import_electron.ipcRenderer.on("menu:action", listener);
    return () => import_electron.ipcRenderer.removeListener("menu:action", listener);
  },
  onMapLoaded: (cb) => {
    const listener = (_, data) => cb(data);
    import_electron.ipcRenderer.on("map:loaded", listener);
    return () => import_electron.ipcRenderer.removeListener("map:loaded", listener);
  },
  onMapUpdated: (cb) => {
    const listener = (_, data) => cb(data);
    import_electron.ipcRenderer.on("map:updated", listener);
    return () => import_electron.ipcRenderer.removeListener("map:updated", listener);
  },
  // M12: OpenCE Tag Test
  tagTestLaunch: (options) => import_electron.ipcRenderer.invoke("tagTest:launch", options),
  tagTestStop: () => import_electron.ipcRenderer.invoke("tagTest:stop"),
  tagTestSendCommand: (command) => import_electron.ipcRenderer.invoke("tagTest:sendCommand", command),
  tagTestHotReload: () => import_electron.ipcRenderer.invoke("tagTest:hotReload"),
  tagTestGetStatus: () => import_electron.ipcRenderer.invoke("tagTest:getStatus"),
  onTagTestLog: (cb) => {
    const listener = (_, data) => cb(data);
    import_electron.ipcRenderer.on("tagTest:log", listener);
    return () => import_electron.ipcRenderer.removeListener("tagTest:log", listener);
  },
  onTagTestStatusChange: (cb) => {
    const listener = (_, data) => cb(data);
    import_electron.ipcRenderer.on("tagTest:status", listener);
    return () => import_electron.ipcRenderer.removeListener("tagTest:status", listener);
  },
  pickOpenCeDirectory: () => import_electron.ipcRenderer.invoke("tagTest:pickDir"),
  getOpenCeConfig: () => import_electron.ipcRenderer.invoke("tagTest:getConfig"),
  setOpenCeDirectory: (dir) => import_electron.ipcRenderer.invoke("tagTest:setDir", dir),
  tagTestSetAlwaysOnTop: (flag) => import_electron.ipcRenderer.invoke("tagTest:setAlwaysOnTop", flag),
  tagTestIsAlwaysOnTop: () => import_electron.ipcRenderer.invoke("tagTest:isAlwaysOnTop"),
  tagTestTriggerFlycam: () => import_electron.ipcRenderer.invoke("tagTest:triggerFlycam"),
  setAlwaysOnTop: (flag) => import_electron.ipcRenderer.invoke("window:setAlwaysOnTop", flag),
  isAlwaysOnTop: () => import_electron.ipcRenderer.invoke("window:isAlwaysOnTop"),
  getPathForFile: (file) => import_electron.webUtils.getPathForFile(file)
};
import_electron.contextBridge.exposeInMainWorld("opence", api);
//# sourceMappingURL=preload.js.map

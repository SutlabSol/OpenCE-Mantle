import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { OpenceApi, ProgressEvent, LogEvent, LoadMapResult, ExtractTagsRequest, ResourceMapKind, InjectionMode } from './shared-types';

const api: OpenceApi = {
  openMapDialog: () => ipcRenderer.invoke('dialog:openMap'),
  loadMap: (filePath: string) => ipcRenderer.invoke('map:load', filePath),
  decompressMap: (filePath: string) => ipcRenderer.invoke('map:decompress', filePath),
  recompressMap: (filePath: string) => ipcRenderer.invoke('map:recompress', filePath),
  getDependencies: (originalIndices: number[]) => ipcRenderer.invoke('deps:get', originalIndices),
  extractTags: (request: ExtractTagsRequest) => ipcRenderer.invoke('tags:extract', request),
  cancelExtraction: () => ipcRenderer.send('tags:cancelExtract'),
  pickResourceMap: (kind: ResourceMapKind) => ipcRenderer.invoke('resourceMaps:pick', kind),
  getResourceMapStatuses: () => ipcRenderer.invoke('resourceMaps:getStatuses'),
  pickInjectContainer: () => ipcRenderer.invoke('tags:pickInjectContainer'),
  planInject: (containerPath: string, mode: InjectionMode) => ipcRenderer.invoke('tags:planInject', containerPath, mode),
  applyInject: () => ipcRenderer.invoke('tags:applyInject'),
  saveMapAs: () => ipcRenderer.invoke('map:saveAs'),
  verifyEmbeddedData: () => ipcRenderer.invoke('tags:verifyEmbeddedData'),
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
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('opence', api);

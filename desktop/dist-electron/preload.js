"use strict";

// electron/preload.ts
var import_electron = require("electron");
var api = {
  openMapDialog: () => import_electron.ipcRenderer.invoke("dialog:openMap"),
  loadMap: (filePath) => import_electron.ipcRenderer.invoke("map:load", filePath),
  decompressMap: (filePath) => import_electron.ipcRenderer.invoke("map:decompress", filePath),
  recompressMap: (filePath) => import_electron.ipcRenderer.invoke("map:recompress", filePath),
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
  getPathForFile: (file) => import_electron.webUtils.getPathForFile(file)
};
import_electron.contextBridge.exposeInMainWorld("opence", api);
//# sourceMappingURL=preload.js.map

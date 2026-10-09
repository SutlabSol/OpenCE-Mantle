"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    openMapDialog: () => electron_1.ipcRenderer.invoke('dialog:openMap'),
    loadMap: (filePath) => electron_1.ipcRenderer.invoke('map:load', filePath),
    decompressMap: (filePath) => electron_1.ipcRenderer.invoke('map:decompress', filePath),
    recompressMap: (filePath) => electron_1.ipcRenderer.invoke('map:recompress', filePath),
    notImplemented: (feature) => electron_1.ipcRenderer.send('app:notImplemented', feature),
    getAppVersion: () => electron_1.ipcRenderer.invoke('app:version'),
    getRecentMaps: () => electron_1.ipcRenderer.invoke('app:recentMaps'),
    onProgress: (cb) => {
        const listener = (_, data) => cb(data);
        electron_1.ipcRenderer.on('map:progress', listener);
        return () => electron_1.ipcRenderer.removeListener('map:progress', listener);
    },
    onLog: (cb) => {
        const listener = (_, data) => cb(data);
        electron_1.ipcRenderer.on('app:log', listener);
        return () => electron_1.ipcRenderer.removeListener('app:log', listener);
    },
    onMenuAction: (cb) => {
        const listener = (_, action) => cb(action);
        electron_1.ipcRenderer.on('menu:action', listener);
        return () => electron_1.ipcRenderer.removeListener('menu:action', listener);
    },
    onMapLoaded: (cb) => {
        const listener = (_, data) => cb(data);
        electron_1.ipcRenderer.on('map:loaded', listener);
        return () => electron_1.ipcRenderer.removeListener('map:loaded', listener);
    },
    getPathForFile: (file) => electron_1.webUtils.getPathForFile(file),
};
electron_1.contextBridge.exposeInMainWorld('opence', api);

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const recent_maps_1 = require("./recent-maps");
const worker_task_1 = require("./worker-task");
let mainWindow = null;
let currentMapPath = null;
let currentMapCompressed = false;
const isDev = !electron_1.app.isPackaged;
function sendLog(level, message) {
    mainWindow?.webContents.send('app:log', { level, message, timestamp: Date.now() });
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: '#15171c',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
    buildMenu();
}
async function loadMapAtPath(filePath) {
    sendLog('info', `Opening ${filePath}`);
    try {
        const result = await (0, worker_task_1.runMapWorkerTask)({ type: 'inspect', filePath }, (stage, percent) => {
            mainWindow?.webContents.send('map:progress', { taskId: 'load', stage, percent });
        });
        if (result.status === 'ok') {
            currentMapPath = filePath;
            currentMapCompressed = false;
            (0, recent_maps_1.addRecentMap)(filePath);
            buildMenu();
            sendLog('info', `Parsed "${result.header.scenarioName}" - ${result.tags.length} tags`);
        }
        else if (result.status === 'compressed') {
            currentMapPath = filePath;
            currentMapCompressed = true;
            (0, recent_maps_1.addRecentMap)(filePath);
            buildMenu();
            sendLog('warn', 'This map is compressed - decompress it to browse tags.');
        }
        else if (result.status === 'unsupported') {
            currentMapPath = null;
            sendLog('error', result.message);
        }
        return result;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendLog('error', `Failed to open map: ${message}`);
        return { status: 'error', message };
    }
}
async function openMapFlow() {
    if (!mainWindow)
        return;
    const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(mainWindow, {
        title: 'Open Halo CE Map',
        filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
        properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0)
        return;
    const result = await loadMapAtPath(filePaths[0]);
    mainWindow.webContents.send('map:loaded', result);
}
async function decompressFlow() {
    if (!mainWindow || !currentMapPath)
        return;
    const defaultPath = currentMapPath.replace(/\.map$/i, '_decompressed.map');
    const { canceled, filePath } = await electron_1.dialog.showSaveDialog(mainWindow, {
        title: 'Save decompressed map as',
        defaultPath,
        filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
    });
    if (canceled || !filePath)
        return null;
    sendLog('info', `Decompressing ${currentMapPath} -> ${filePath}`);
    const result = await (0, worker_task_1.runMapWorkerTask)({ type: 'decompress', filePath: currentMapPath, outputPath: filePath }, (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'decompress', stage, percent }));
    sendLog('info', `Decompressed: ${result.originalSize} -> ${result.newSize} bytes`);
    return result;
}
async function recompressFlow() {
    if (!mainWindow || !currentMapPath)
        return;
    const defaultPath = currentMapPath.replace(/\.map$/i, '_compressed.map');
    const { canceled, filePath } = await electron_1.dialog.showSaveDialog(mainWindow, {
        title: 'Save recompressed map as',
        defaultPath,
        filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
    });
    if (canceled || !filePath)
        return null;
    sendLog('info', `Compressing ${currentMapPath} -> ${filePath}`);
    const result = await (0, worker_task_1.runMapWorkerTask)({ type: 'compress', filePath: currentMapPath, outputPath: filePath }, (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'compress', stage, percent }));
    sendLog('info', `Compressed: ${result.originalSize} -> ${result.newSize} bytes`);
    return result;
}
function buildMenu() {
    const recents = (0, recent_maps_1.getRecentMaps)();
    const template = [
        {
            label: 'File',
            submenu: [
                { label: 'Open Map...', accelerator: 'CmdOrCtrl+O', click: () => openMapFlow() },
                { label: 'Save As...', click: () => mainWindow?.webContents.send('menu:action', 'save-as-stub') },
                {
                    label: 'Recent Maps',
                    submenu: recents.length > 0
                        ? recents.map((p) => ({ label: p, click: () => loadMapAtPath(p).then((r) => mainWindow?.webContents.send('map:loaded', r)) }))
                        : [{ label: '(none yet)', enabled: false }],
                },
                { type: 'separator' },
                { label: 'Exit', role: 'quit' },
            ],
        },
        {
            label: 'Tools',
            submenu: [
                { label: 'Decompress Map', click: () => decompressFlow() },
                { label: 'Recompress Map', click: () => recompressFlow() },
                { type: 'separator' },
                { label: 'Extract Tags...', click: () => mainWindow?.webContents.send('menu:action', 'extract-stub') },
                { label: 'Inject Tags...', click: () => mainWindow?.webContents.send('menu:action', 'inject-stub') },
            ],
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About OpenCE Modding Tool',
                    click: () => electron_1.dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: 'About',
                        message: `OpenCE Modding Tool v${electron_1.app.getVersion()}`,
                        detail: 'A free, non-commercial GUI tool for modding Halo: Custom Edition (PC, version 609) maps.\n\n' +
                            'Format references (GPL, not bundled): Invader, Reclaimer, Refinery, Mozzarilla, supyr_struct.\n' +
                            'Compression reference: Chimera.\nTarget runtime: OpenCE (OpenCommunityEdition/OpenCE).\n\n' +
                            'No Bungie/Microsoft assets are bundled; this tool only operates on files you supply.',
                    }),
                },
                {
                    label: 'View format references',
                    click: () => electron_1.shell.openExternal('https://github.com/SnowyMouse/invader/wiki'),
                },
            ],
        },
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
electron_1.app.whenReady().then(() => {
    electron_1.ipcMain.handle('dialog:openMap', async () => {
        if (!mainWindow)
            return null;
        const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: 'Open Halo CE Map',
            filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
            properties: ['openFile'],
        });
        if (canceled || filePaths.length === 0)
            return null;
        return loadMapAtPath(filePaths[0]);
    });
    electron_1.ipcMain.handle('map:load', (_e, filePath) => loadMapAtPath(filePath));
    electron_1.ipcMain.handle('map:decompress', () => decompressFlow());
    electron_1.ipcMain.handle('map:recompress', () => recompressFlow());
    electron_1.ipcMain.handle('app:version', () => electron_1.app.getVersion());
    electron_1.ipcMain.handle('app:recentMaps', () => (0, recent_maps_1.getRecentMaps)());
    electron_1.ipcMain.on('app:notImplemented', (_e, feature) => sendLog('warn', `${feature} is not implemented yet (coming in a later milestone).`));
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
// Drag-and-drop of a .map file onto the window dock/taskbar icon (macOS/Windows "open with").
electron_1.app.on('open-file', (_event, filePath) => {
    if (fs.existsSync(filePath)) {
        loadMapAtPath(filePath).then((r) => mainWindow?.webContents.send('map:loaded', r));
    }
});

import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getRecentMaps, addRecentMap } from './recent-maps';
import { runMapWorkerTask } from './worker-task';
import type { LoadMapResult, CompressionResult, LogEvent } from './shared-types';

let mainWindow: BrowserWindow | null = null;
let currentMapPath: string | null = null;
let currentMapCompressed = false;

const isDev = !app.isPackaged;

function sendLog(level: LogEvent['level'], message: string) {
  mainWindow?.webContents.send('app:log', { level, message, timestamp: Date.now() } satisfies LogEvent);
}

function createWindow() {
  mainWindow = new BrowserWindow({
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
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  buildMenu();
}

async function loadMapAtPath(filePath: string): Promise<LoadMapResult> {
  sendLog('info', `Opening ${filePath}`);
  try {
    const result = await runMapWorkerTask<LoadMapResult>({ type: 'inspect', filePath }, (stage, percent) => {
      mainWindow?.webContents.send('map:progress', { taskId: 'load', stage, percent });
    });

    if (result.status === 'ok') {
      currentMapPath = filePath;
      currentMapCompressed = false;
      addRecentMap(filePath);
      buildMenu();
      sendLog('info', `Parsed "${result.header.scenarioName}" - ${result.tags.length} tags`);
    } else if (result.status === 'compressed') {
      currentMapPath = filePath;
      currentMapCompressed = true;
      addRecentMap(filePath);
      buildMenu();
      sendLog('warn', 'This map is compressed - decompress it to browse tags.');
    } else if (result.status === 'unsupported') {
      currentMapPath = null;
      sendLog('error', result.message);
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendLog('error', `Failed to open map: ${message}`);
    return { status: 'error', message };
  }
}

async function openMapFlow() {
  if (!mainWindow) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Halo CE Map',
    filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return;
  const result = await loadMapAtPath(filePaths[0]);
  mainWindow.webContents.send('map:loaded', result);
}

async function decompressFlow() {
  if (!mainWindow || !currentMapPath) return;
  const defaultPath = currentMapPath.replace(/\.map$/i, '_decompressed.map');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save decompressed map as',
    defaultPath,
    filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
  });
  if (canceled || !filePath) return null;

  sendLog('info', `Decompressing ${currentMapPath} -> ${filePath}`);
  const result = await runMapWorkerTask<CompressionResult>(
    { type: 'decompress', filePath: currentMapPath, outputPath: filePath },
    (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'decompress', stage, percent }),
  );
  sendLog('info', `Decompressed: ${result.originalSize} -> ${result.newSize} bytes`);
  return result;
}

async function recompressFlow() {
  if (!mainWindow || !currentMapPath) return;
  const defaultPath = currentMapPath.replace(/\.map$/i, '_compressed.map');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save recompressed map as',
    defaultPath,
    filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
  });
  if (canceled || !filePath) return null;

  sendLog('info', `Compressing ${currentMapPath} -> ${filePath}`);
  const result = await runMapWorkerTask<CompressionResult>(
    { type: 'compress', filePath: currentMapPath, outputPath: filePath },
    (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'compress', stage, percent }),
  );
  sendLog('info', `Compressed: ${result.originalSize} -> ${result.newSize} bytes`);
  return result;
}

function showAboutDialog() {
  if (!mainWindow) return;
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About',
    message: `OpenCE Modding Tool v${app.getVersion()}`,
    detail:
      'A free, non-commercial GUI tool for modding Halo: Custom Edition (PC, version 609) maps.\n\n' +
      'Format references (GPL, not bundled): Invader, Reclaimer, Refinery, Mozzarilla, supyr_struct.\n' +
      'Compression reference: Chimera.\nTarget runtime: OpenCE (OpenCommunityEdition/OpenCE).\n\n' +
      'No Bungie/Microsoft assets are bundled; this tool only operates on files you supply.',
  });
}

function buildMenu() {
  const recents = getRecentMaps();
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Map...', accelerator: 'CmdOrCtrl+O', click: () => openMapFlow() },
        { label: 'Save As...', click: () => mainWindow?.webContents.send('menu:action', 'save-as-stub') },
        {
          label: 'Recent Maps',
          submenu:
            recents.length > 0
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
          click: () => showAboutDialog(),
        },
        {
          label: 'View format references',
          click: () => shell.openExternal('https://github.com/SnowyMouse/invader/wiki'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:openMap', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Halo CE Map',
      filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    return loadMapAtPath(filePaths[0]);
  });

  ipcMain.handle('map:load', (_e, filePath: string) => loadMapAtPath(filePath));
  ipcMain.handle('map:decompress', () => decompressFlow());
  ipcMain.handle('map:recompress', () => recompressFlow());
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:recentMaps', () => getRecentMaps());
  ipcMain.on('app:notImplemented', (_e, feature: string) => sendLog('warn', `${feature} is not implemented yet (coming in a later milestone).`));
  ipcMain.handle('app:showAbout', () => showAboutDialog());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Drag-and-drop of a .map file onto the window dock/taskbar icon (macOS/Windows "open with").
app.on('open-file', (_event, filePath) => {
  if (fs.existsSync(filePath)) {
    loadMapAtPath(filePath).then((r) => mainWindow?.webContents.send('map:loaded', r));
  }
});

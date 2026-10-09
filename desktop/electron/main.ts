import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { OCETAGS_EXTENSION, validateResourceMapFile } from '../../core/src/index';
import { getRecentMaps, addRecentMap } from './recent-maps';
import { getSettings, setLastExtractDir, setResourceMapPath } from './settings';
import { startWorker, sendWorkerRequest, cancelWorkerRequest } from './worker-manager';
import type {
  LoadMapResult,
  CompressionResult,
  LogEvent,
  GetDependenciesResult,
  ExtractTagsRequest,
  ExtractTagsResult,
  ResourceMapKind,
  ResourceMapStatus,
  ResourceMapPickResult,
  PlanInjectResult,
  ApplyInjectResult,
  InjectionMode,
} from './shared-types';

let mainWindow: BrowserWindow | null = null;
let currentMapPath: string | null = null;
let currentMapCompressed = false;
let currentMapScenarioName: string | null = null;
let currentExtractRequestId: string | null = null;
let currentInjectContainerPath: string | null = null;

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
    const { promise } = sendWorkerRequest<LoadMapResult>({ type: 'inspect', filePath }, sendLog, (stage, percent) => {
      mainWindow?.webContents.send('map:progress', { taskId: 'load', stage, percent });
    });
    const result = await promise;

    if (result.status === 'ok') {
      currentMapPath = filePath;
      currentMapCompressed = false;
      currentMapScenarioName = result.header.scenarioName;
      addRecentMap(filePath);
      buildMenu();
      sendLog('info', `Parsed "${result.header.scenarioName}" - ${result.tags.length} tags`);
    } else if (result.status === 'compressed') {
      currentMapPath = filePath;
      currentMapCompressed = true;
      currentMapScenarioName = null;
      addRecentMap(filePath);
      buildMenu();
      sendLog('warn', 'This map is compressed - decompress it to browse tags.');
    } else if (result.status === 'unsupported') {
      currentMapPath = null;
      currentMapScenarioName = null;
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
  const { promise } = sendWorkerRequest<CompressionResult>(
    { type: 'decompress', filePath: currentMapPath, outputPath: filePath },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'decompress', stage, percent }),
  );
  const result = await promise;
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
  const { promise } = sendWorkerRequest<CompressionResult>(
    { type: 'compress', filePath: currentMapPath, outputPath: filePath },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'compress', stage, percent }),
  );
  const result = await promise;
  sendLog('info', `Compressed: ${result.originalSize} -> ${result.newSize} bytes`);
  return result;
}

/** Read-only: walks dependencies for the dependency dialog. Never touches disk beyond the already-open map. */
async function getDependenciesFlow(originalIndices: unknown): Promise<GetDependenciesResult> {
  if (!Array.isArray(originalIndices) || originalIndices.length === 0 || !originalIndices.every((n) => Number.isInteger(n) && n >= 0)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'No valid tags were selected.' };
  }
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'Open and decompress a map before extracting tags.' };
  }
  sendLog('info', `Extract requested: ${originalIndices.length} tag(s) selected.`);
  const { promise } = sendWorkerRequest<GetDependenciesResult>({ type: 'getDependencies', originalIndices }, sendLog, (stage, percent) =>
    mainWindow?.webContents.send('map:progress', { taskId: 'getDependencies', stage, percent }),
  );
  try {
    return await promise;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Dependency walk failed: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/**
 * Shows the native Save As dialog (never takes a path from the renderer), validates it, confirms
 * overwrite, then has the worker extract + write a single `.ocetags` container (temp-file-then-
 * rename, so a cancel/crash/failure never leaves a partial file at the destination).
 */
async function extractTagsFlow(request: ExtractTagsRequest): Promise<ExtractTagsResult> {
  if (!mainWindow) return { ok: false, code: 'NO_WINDOW', message: 'Application window is not available.' };
  if (!request || !Array.isArray(request.originalIndices) || request.originalIndices.length === 0 || !request.originalIndices.every((n) => Number.isInteger(n) && n >= 0)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'No valid tags were selected.' };
  }
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'Open and decompress a map before extracting tags.' };
  }

  const settings = getSettings();
  const defaultDir = settings.lastExtractDir && fs.existsSync(settings.lastExtractDir) ? settings.lastExtractDir : app.getPath('documents');
  const safeName = String(request.suggestedFileName || 'extracted_tags').replace(/[<>:"/\\|?*]/g, '_') || 'extracted_tags';
  const defaultPath = path.join(defaultDir, `${safeName}${OCETAGS_EXTENSION}`);

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Extract tags to...',
    defaultPath,
    filters: [{ name: 'OpenCE Tag Set', extensions: ['ocetags'] }],
  });
  if (canceled || !filePath) return { ok: false, code: 'CANCELLED', message: 'Save was cancelled.' };

  const resolvedTarget = path.resolve(filePath);
  const resolvedSourceMap = path.resolve(currentMapPath);
  const resolvedAppDir = path.resolve(app.getAppPath());
  if (resolvedTarget === resolvedSourceMap) {
    return { ok: false, code: 'REFUSED_SOURCE_PATH', message: 'You cannot overwrite the source map file. Choose a different location.' };
  }
  if (resolvedTarget === resolvedAppDir || resolvedTarget.startsWith(resolvedAppDir + path.sep)) {
    return { ok: false, code: 'REFUSED_APP_PATH', message: 'You cannot save inside the application install directory. Choose a different location.' };
  }

  if (fs.existsSync(resolvedTarget)) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Overwrite', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `"${path.basename(resolvedTarget)}" already exists.`,
      detail: 'Do you want to overwrite it?',
    });
    if (response !== 0) return { ok: false, code: 'CANCELLED', message: 'Save was cancelled.' };
  }

  setLastExtractDir(path.dirname(resolvedTarget));
  sendLog('info', `Extracting ${request.originalIndices.length} tag(s) to ${resolvedTarget}`);

  const { requestId, promise } = sendWorkerRequest<ExtractTagsResult>(
    {
      type: 'extractTags',
      originalIndices: request.originalIndices,
      outputPath: resolvedTarget,
      sourceMapName: currentMapScenarioName ?? path.basename(currentMapPath, '.map'),
    },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'extract', stage, percent }),
  );
  currentExtractRequestId = requestId;
  try {
    const payload = await promise;
    if (payload.ok) sendLog('info', `Extracted ${payload.tagCount} tag(s) to ${payload.outputPath}`);
    return payload;
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'CANCELLED') {
      sendLog('warn', 'Extraction cancelled - no file was written.');
      return { ok: false, code: 'CANCELLED', message: 'Extraction was cancelled.' };
    }
    sendLog('error', `Extraction failed: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  } finally {
    currentExtractRequestId = null;
  }
}

const RESOURCE_MAP_FILTER_NAMES: Record<ResourceMapKind, string> = { bitmaps: 'bitmaps.map', sounds: 'sounds.map', loc: 'loc.map' };

function readResourceMapStatus(kind: ResourceMapKind, filePath: string | null): ResourceMapStatus {
  if (!filePath) return { state: 'not-configured' };
  try {
    const buffer = fs.readFileSync(filePath);
    const result = validateResourceMapFile(buffer, kind);
    if (!result.ok) return { state: 'missing-or-unreadable', path: filePath, error: result.error };
    return { state: 'ok', path: filePath, fileSizeBytes: buffer.length, entryCount: result.identity.entryCount };
  } catch (err) {
    return { state: 'missing-or-unreadable', path: filePath, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Main process owns the picker and settings.json end-to-end - the renderer only ever receives a status back, never a path (user's explicit requirement). */
async function pickResourceMapFlow(kind: ResourceMapKind): Promise<ResourceMapPickResult> {
  if (!mainWindow) return { ok: false, code: 'NO_WINDOW', message: 'Application window is not available.' };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: `Pick ${RESOURCE_MAP_FILTER_NAMES[kind]}`,
    filters: [{ name: 'Halo CE Resource Map', extensions: ['map'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { ok: false, code: 'CANCELLED' };

  const status = readResourceMapStatus(kind, filePaths[0]);
  if (status.state !== 'ok') {
    sendLog('warn', `Rejected ${filePaths[0]} for the ${RESOURCE_MAP_FILTER_NAMES[kind]} slot: ${status.state === 'missing-or-unreadable' ? status.error : 'unknown error'}`);
    return { ok: true, status }; // not saved - picker shows the rejection, settings.json is untouched
  }
  setResourceMapPath(kind, filePaths[0]);
  sendLog('info', `${RESOURCE_MAP_FILTER_NAMES[kind]} set to ${filePaths[0]} (${status.entryCount} entries).`);
  return { ok: true, status };
}

function getResourceMapStatusesFlow(): Record<ResourceMapKind, ResourceMapStatus> {
  const settings = getSettings();
  return {
    bitmaps: readResourceMapStatus('bitmaps', settings.resourceMaps.bitmaps),
    sounds: readResourceMapStatus('sounds', settings.resourceMaps.sounds),
    loc: readResourceMapStatus('loc', settings.resourceMaps.loc),
  };
}

async function pickInjectContainerFlow(): Promise<{ path: string } | null> {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Inject tags from...',
    filters: [{ name: 'OpenCE Tag Set', extensions: ['ocetags'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  return { path: filePaths[0] };
}

async function planInjectFlow(containerPath: string, mode: InjectionMode): Promise<PlanInjectResult> {
  if (!currentMapPath || currentMapCompressed) return { ok: false, code: 'NO_MAP_LOADED', message: 'Open and decompress the target map before injecting tags into it.' };
  currentInjectContainerPath = containerPath;
  const settings = getSettings();
  const resourceMapPaths: Partial<Record<ResourceMapKind, string>> = {};
  for (const kind of ['bitmaps', 'sounds', 'loc'] as ResourceMapKind[]) {
    const p = settings.resourceMaps[kind];
    if (p) resourceMapPaths[kind] = p;
  }
  sendLog('info', `Planning ${mode === 'swap' ? 'swap' : 'add'} injection from ${containerPath}`);
  const { promise } = sendWorkerRequest<PlanInjectResult>({ type: 'planInject', containerPath, mode, resourceMapPaths }, sendLog, (stage, percent) =>
    mainWindow?.webContents.send('map:progress', { taskId: 'planInject', stage, percent }),
  );
  try {
    return await promise;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Injection plan failed: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

async function applyInjectFlow(): Promise<ApplyInjectResult> {
  if (!mainWindow) return { ok: false, code: 'NO_WINDOW', message: 'Application window is not available.' };
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (!currentInjectContainerPath) return { ok: false, code: 'NO_PLAN', message: 'Run "Inject Tags..." and review the plan before applying it.' };

  const defaultPath = currentMapPath.replace(/\.map$/i, '_injected.map');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save injected map as',
    defaultPath,
    filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
  });
  if (canceled || !filePath) return { ok: false, code: 'CANCELLED', message: 'Save was cancelled.' };

  const resolvedTarget = path.resolve(filePath);
  if (resolvedTarget === path.resolve(currentMapPath)) {
    return { ok: false, code: 'REFUSED_SOURCE_PATH', message: 'You cannot overwrite the map you are injecting into. Choose a different location.' };
  }
  if (fs.existsSync(resolvedTarget)) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Overwrite', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `"${path.basename(resolvedTarget)}" already exists.`,
      detail: 'Do you want to overwrite it?',
    });
    if (response !== 0) return { ok: false, code: 'CANCELLED', message: 'Save was cancelled.' };
  }

  sendLog('info', `Writing injected map to ${resolvedTarget}`);
  const { promise } = sendWorkerRequest<ApplyInjectResult>({ type: 'applyInject', outputPath: resolvedTarget }, sendLog, (stage, percent) =>
    mainWindow?.webContents.send('map:progress', { taskId: 'applyInject', stage, percent }),
  );
  try {
    const result = await promise;
    if (result.ok) sendLog('info', `Injected ${result.addedCount} tag(s), swapped ${result.swappedCount} (${result.reusedCount} reused) into ${result.outputPath}`);
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Injection failed: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  } finally {
    currentInjectContainerPath = null;
  }
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
        { label: 'Extract Tags...', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('menu:action', 'extract-tags') },
        { label: 'Inject Tags...', click: () => mainWindow?.webContents.send('menu:action', 'inject-tags') },
        { type: 'separator' },
        { label: 'Settings...', click: () => mainWindow?.webContents.send('menu:action', 'settings') },
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
  // Started eagerly so the "worker loaded, definitions loaded" self-check is visible at launch.
  startWorker(sendLog);

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
  ipcMain.handle('deps:get', (_e, originalIndices: unknown) => getDependenciesFlow(originalIndices));
  ipcMain.handle('tags:extract', (_e, request: ExtractTagsRequest) => extractTagsFlow(request));
  ipcMain.on('tags:cancelExtract', () => {
    if (currentExtractRequestId) cancelWorkerRequest(currentExtractRequestId, sendLog);
  });
  ipcMain.handle('resourceMaps:pick', (_e, kind: ResourceMapKind) => pickResourceMapFlow(kind));
  ipcMain.handle('resourceMaps:getStatuses', () => getResourceMapStatusesFlow());
  ipcMain.handle('tags:pickInjectContainer', () => pickInjectContainerFlow());
  ipcMain.handle('tags:planInject', (_e, containerPath: string, mode: InjectionMode) => planInjectFlow(containerPath, mode));
  ipcMain.handle('tags:applyInject', () => applyInjectFlow());
  ipcMain.handle('app:openContainingFolder', (_e, filePath: string) => {
    if (typeof filePath === 'string' && filePath) shell.showItemInFolder(filePath);
  });
  ipcMain.handle('app:getSettings', () => getSettings());
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

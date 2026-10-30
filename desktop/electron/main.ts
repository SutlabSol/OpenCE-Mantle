import { classifyMapLayout } from '../../core/src/map/convert/classify';
import { CacheFileEngine } from '../../core/src/constants/cache-file';
import { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, screen, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync, spawn } from 'child_process';
import {
  OCETAGS_EXTENSION,
  validateResourceMapFile,
  scenarioNameFromFileName,
  getAllTagGroupNames,
  getGroupDefinition,
  OCETAGS_FORMAT_VERSION,
  readResourceTable,
  parseAndAnalyzeObj,
  renderObjUvTemplatePng,
  convertJmsToObjText,
  convertColladaDaeToObjText,
  encodeRgbaToPng,
  parseHaloWrl,
  analyzeHaloToolLog,
  scanLooseTagsWorkspace,
  readLooseBlamTagFields,
  writeLooseBlamTagFieldValue,
  compareBlamLooseTagBuffers,
  fixBrokenTagDependenciesInWorkspace,
  refactorRenameOrMoveLooseTagOnDisk,
  evaluateBlamFunctionCurve,
  queryHaloScriptDocs,
  getToolCommandCatalog,
  runNativeToolCommand,
  type NativeToolCommandType,
  type LooseTagsWorkspaceIndex,
  type RandomAccessFile,
} from '../../core/src/index';
import { discoverSteamMccInstallations, decodeMccModManifest } from './mcc-deploy';
import {
  getRecentMaps,
  addRecentMap,
  getRecentMapCards,
  togglePinRecentMap,
  removeRecentMapEntry,
} from './recent-maps';
import {
  getSettings,
  setLastExtractDir,
  setResourceMapPath,
  setVersionResourceMaps,
  setOpenCeDirectory,
  setCheckForUpdatesOnLaunch,
  setAutoDownloadUpdates,
  setSkippedUpdateVersion,
  setAppTheme,
} from './settings';
import {
  checkForGitHubUpdates,
  downloadUpdateAsset,
  spawnUpdateApplyScript,
} from './update-checker';
import { tagTestRunner } from './tag-test-runner';
import { startWorker, sendWorkerRequest, cancelWorkerRequest } from './worker-manager';
import { saveMapAsFlow, registerSaveMapAsIpc, type SaveMapAsDeps } from './save-map-as';
import { saveMapFlow, confirmUnsavedChanges, SAVE_MAP_CHANNEL, type SaveMapDeps } from './save-map';
import { backupOnOpenFlow, isBackedUp } from './backup-on-open';
import { convertMapFlow, sanitizeRepairChoice, type ConvertMapDeps } from './convert-map';
import { isBackupFilePath, COMPRESSED_MAP_MESSAGE } from './map-file-rules';
import {
  sanitizeMapName,
  countExistingOcetagsFiles,
  getDriveFreeSpace,
  commitStagedFiles,
  discardStagedFiles,
  generateBatchReportText,
  writeManifestAndReport,
} from './batch-extract-fs';
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
  SaveMapAsResult,
  SaveMapResult,
  DiscardChangesResult,
  OpenMapSummary,
  InjectionMode,
  VerifyEmbeddedDataResult,
  ConvertPreflightResult,
  ConvertMapResult,
  ConvertResourcePaths,
  HaloBitmapVersion,
  BitmapIdentificationResult,
  BatchExtractMode,
  BatchExtractFormat,
  BatchExtractPreflightResult,
  BatchExtractResult,
  FinalizeBatchExtractRequest,
  BatchExtractManifest,
  GetTagFieldsResult,
  UpdateTagFieldResult,
  AddReflexiveChunkResult,
  GetDependencySlotsResult,
  SetDependencySlotResult,
  GetBspRenderMeshResult,
  GetBitmapTextureResult,
  GetScenarioObjectsResult,
  GetModelRenderGeometryResult,
  UpdateScenarioPlacementResult,
  DuplicateScenarioPlacementResult,
  AddScenarioPlacementResult,
  SwapScenarioPlacementResult,
  DeleteScenarioPlacementResult,
  ScenarioObjectKind,
  GetReferencingTagsResult,
  GetUnicodeStringsResult,
  SetUnicodeStringResult,
  RenameTagResult,
  DuplicateTagResult,
  DeleteTagResult,
  BspSwapPreflightResult,
  BspSwapOptions,
  BspSwapResult,
  Export3dResult,
  GetBitmapInfoResult,
  GetBitmapRgbaResult,
  ExportBitmapResult,
  ReplaceBitmapResult,
  GetSoundInfoResult,
  GetSoundWavResult,
  ExportSoundResult,
  ReplaceSoundResult,
  BuildCustomObjectRequest,
  BuildCustomObjectResult,
  ExportUvTemplateResult,
  DeprotectMapOptions,
  InspectDeprotectResult,
  DeprotectMapResult,
  SpoofMapCrc32Result,
  AppThemeId,
  OpenMapTabSession,
} from './shared-types';

let mainWindow: BrowserWindow | null = null;
const openMapSessions = new Map<string, OpenMapTabSession>();
let activeMapSessionId: string | null = null;
const detachedWindows = new Map<string, BrowserWindow>();

function normalizeSessionId(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function broadcastOpenMapSessions(): void {
  const payload = {
    activeSessionId: activeMapSessionId,
    sessions: Array.from(openMapSessions.values()),
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('map:sessionsChanged', payload);
    }
  }
}
let currentMapPath: string | null = null;
let currentMapCompressed = false;
let currentMapScenarioName: string | null = null;
let currentOpenMapSummary: OpenMapSummary | null = null;
/** The worker's in-memory map has changes (Inject) not written by Save / Save As yet. */
let currentMapModified = false;
/** A backup exists for this open (created, kept, or already identical). False when skipped or failed. */
let currentMapBackedUp = false;
/** No backup: the user already confirmed File > Save's overwrite during this open. */
let overwriteConfirmed = false;
let currentExtractRequestId: string | null = null;
let currentBatchExtractRequestId: string | null = null;
let currentInjectContainerPath: string | null = null;
/** The last map opened that the converter can convert (shown in the unsupported banner). */
let lastConvertiblePath: string | null = null;
/** The map the last Convert pre-flight checked; Convert converts exactly this file. */
let convertSourcePath: string | null = null;

const isDev = !app.isPackaged;

function sendLog(level: LogEvent['level'], message: string) {
  mainWindow?.webContents.send('app:log', { level, message, timestamp: Date.now() } satisfies LogEvent);
}

function getAppIconPath(): string | undefined {
  const icoCandidate = path.join(__dirname, '../build/icon.ico');
  const pngCandidate = path.join(__dirname, '../build/icon.png');
  if (process.platform === 'win32' && fs.existsSync(icoCandidate)) return icoCandidate;
  if (fs.existsSync(pngCandidate)) return pngCandidate;
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizedChanged', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizedChanged', false);
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  buildMenu();
  updateTitle();

  // Closing the window with unsaved changes: Save / Don't save / Cancel.
  let closeConfirmed = false;
  mainWindow.on('close', (event) => {
    const anyModified =
      currentMapModified || Array.from(openMapSessions.values()).some((s) => s.modified);
    if (closeConfirmed || !anyModified) return;
    event.preventDefault();
    void confirmUnsavedChanges(unsavedChangesDeps).then((ok) => {
      if (!ok) return;
      closeConfirmed = true;
      for (const detWin of detachedWindows.values()) {
        if (!detWin.isDestroyed()) detWin.close();
      }
      mainWindow?.close();
    });
  });
}

function updateTitle() {
  if (!mainWindow) return;
  const name = currentMapPath ? `${path.basename(currentMapPath)}${currentMapModified ? ' *' : ''} - ` : '';
  mainWindow.setTitle(`${name}OpenCE Mantle`);
}

/** After Inject / Save / Save As: main's copy of the open map's state, menu, title, and the renderer's view. */
function setOpenMapState(map: OpenMapSummary) {
  currentOpenMapSummary = map;
  currentMapPath = map.filePath;
  currentMapScenarioName = map.header.scenarioName;
  currentMapModified = !!map.modified;
  const sid = activeMapSessionId ?? normalizeSessionId(map.filePath);
  activeMapSessionId = sid;
  openMapSessions.set(sid, {
    sessionId: sid,
    filePath: map.filePath,
    fileName: path.basename(map.filePath),
    scenarioName: map.header.scenarioName,
    modified: !!map.modified,
    detachedWindowId: detachedWindows.get(sid)?.id ?? null,
    map,
  });
  buildMenu();
  updateTitle();
  mainWindow?.webContents.send('map:updated', map);
  const detWin = detachedWindows.get(sid);
  if (detWin && !detWin.isDestroyed()) {
    detWin.webContents.send('map:updated', map);
  }
  broadcastOpenMapSessions();
}

const unsavedChangesDeps = {
  isModified: () => currentMapModified,
  fileName: () => (currentMapPath ? path.basename(currentMapPath) : 'the open map'),
  ask: async (fileName: string): Promise<'save' | 'dont-save' | 'cancel'> => {
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: `Save changes to ${fileName}?`,
      detail: "Your injected tags are only in memory. If you don't save, they are lost.",
    });
    return response === 0 ? 'save' : response === 1 ? 'dont-save' : 'cancel';
  },
  save: () => runSaveMap(),
  log: sendLog,
};

/** Every way of opening another map goes through here. With multi-map tabs, previously open maps stay in memory; only prompt if reloading an already-open modified session. */
async function openMapGuarded(filePath: string): Promise<LoadMapResult | null> {
  const sid = normalizeSessionId(filePath);
  const existing = openMapSessions.get(sid);
  if (existing && existing.modified) {
    if (activeMapSessionId !== sid) {
      await switchActiveMapSessionFlow(sid);
    }
    if (!(await confirmUnsavedChanges(unsavedChangesDeps))) return null;
  }
  return loadMapAtPath(filePath, { askBackup: true });
}

/** Backup prompt, once per open of an uncompressed .map (see backup-on-open.ts). */
async function askBackup(filePath: string) {
  const outcome = await backupOnOpenFlow(filePath, {
    askCreateBackup: async (mapName, backupName) => {
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'question',
        buttons: ['Create backup', 'Skip'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message: `Create a backup copy of ${mapName} as ${backupName}?`,
        detail: 'File > Save overwrites the map you opened. The backup is written next to it, and Save never touches it.',
      });
      return response === 0 ? 'create' : 'skip';
    },
    askExistingBackup: async (backupName) => {
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        buttons: ['Keep existing', 'Replace', 'Skip'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: `${backupName} already exists and differs from the map you opened.`,
        detail: 'Keep existing leaves the old backup as it is. Replace overwrites it with a copy of the map you just opened.',
      });
      return response === 1 ? 'replace' : response === 2 ? 'skip' : 'keep';
    },
    showError: showErrorBox,
    log: sendLog,
  });
  currentMapBackedUp = isBackedUp(outcome);
  overwriteConfirmed = false;
}

async function showErrorBox(message: string, detail: string) {
  await dialog.showMessageBox(mainWindow!, { type: 'error', message, detail });
}

async function loadMapAtPath(filePath: string, options: { askBackup: boolean }): Promise<LoadMapResult> {
  sendLog('info', `Opening ${filePath}`);
  const sid = normalizeSessionId(filePath);
  try {
    const { promise } = sendWorkerRequest<LoadMapResult>({ type: 'inspect', filePath, sessionId: sid }, sendLog, (stage, percent) => {
      mainWindow?.webContents.send('map:progress', { taskId: 'load', stage, percent });
    });
    const result = await promise;

    currentMapModified = false;
    currentMapBackedUp = false;
    overwriteConfirmed = false;
    lastConvertiblePath = result.status === 'unsupported' && result.convertible ? filePath : null;
    if (result.status === 'ok') {
      currentOpenMapSummary = result;
      currentMapPath = filePath;
      currentMapCompressed = false;
      currentMapScenarioName = result.header.scenarioName;
      activeMapSessionId = sid;
      openMapSessions.set(sid, {
        sessionId: sid,
        filePath,
        fileName: path.basename(filePath),
        scenarioName: result.header.scenarioName,
        modified: false,
        detachedWindowId: detachedWindows.get(sid)?.id ?? null,
        map: result,
      });
      addRecentMap(filePath);
      buildMenu();
      updateTitle();
      broadcastOpenMapSessions();
      sendLog('info', `Parsed "${result.header.scenarioName}" - ${result.tags.length} tags`);

      // If the edition has configured or auto-detected resource maps, automatically activate them
      const resolvedRes = resolveResourceMapsForSource(filePath);
      if (resolvedRes.bitmapsPath) {
        setResourceMapPath('bitmaps', resolvedRes.bitmapsPath);
      }
      if (resolvedRes.soundsPath) {
        setResourceMapPath('sounds', resolvedRes.soundsPath);
      }

      if (options.askBackup) await askBackup(filePath);
    } else if (result.status === 'compressed') {
      currentOpenMapSummary = null;
      currentMapPath = filePath;
      currentMapCompressed = true;
      currentMapScenarioName = null;
      addRecentMap(filePath);
      buildMenu();
      updateTitle();
      sendLog('warn', 'This map is compressed - decompress it (Tools > Decompress Map) to browse tags. Nothing of it is held for editing.');
    } else if (result.status === 'unsupported') {
      currentOpenMapSummary = null;
      currentMapPath = null;
      currentMapScenarioName = null;
      buildMenu();
      updateTitle();
      sendLog('error', result.message);
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendLog('error', `Failed to open map: ${message}`);
    return { status: 'error', message };
  }
}

async function switchActiveMapSessionFlow(
  sessionId: string,
): Promise<{ ok: boolean; session?: OpenMapTabSession; message?: string }> {
  const target = openMapSessions.get(sessionId);
  if (!target) {
    return { ok: false, message: `Map session "${sessionId}" is not open.` };
  }
  try {
    const { promise } = sendWorkerRequest<
      { ok: true; map: OpenMapSummary } | { ok: false; message: string }
    >({ type: 'activateMapSession', sessionId }, sendLog);
    const res = await promise;
    if (!res.ok) {
      return { ok: false, message: res.message };
    }
    activeMapSessionId = sessionId;
    currentOpenMapSummary = res.map;
    currentMapPath = res.map.filePath;
    currentMapCompressed = false;
    currentMapScenarioName = res.map.header.scenarioName;
    currentMapModified = !!res.map.modified;
    const updatedSession: OpenMapTabSession = {
      sessionId,
      filePath: res.map.filePath,
      fileName: path.basename(res.map.filePath),
      scenarioName: res.map.header.scenarioName,
      modified: !!res.map.modified,
      detachedWindowId: detachedWindows.get(sessionId)?.id ?? null,
      map: res.map,
    };
    openMapSessions.set(sessionId, updatedSession);
    buildMenu();
    updateTitle();
    broadcastOpenMapSessions();
    return { ok: true, session: updatedSession };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function closeMapSessionFlow(
  sessionId: string,
): Promise<{ ok: boolean; activeSessionId: string | null; sessions: OpenMapTabSession[] }> {
  const existing = openMapSessions.get(sessionId);
  if (existing && existing.modified) {
    if (activeMapSessionId !== sessionId) {
      await switchActiveMapSessionFlow(sessionId);
    }
    if (!(await confirmUnsavedChanges(unsavedChangesDeps))) {
      return {
        ok: false,
        activeSessionId: activeMapSessionId,
        sessions: Array.from(openMapSessions.values()),
      };
    }
  }
  const detWin = detachedWindows.get(sessionId);
  if (detWin && !detWin.isDestroyed()) {
    detachedWindows.delete(sessionId);
    detWin.close();
  }
  openMapSessions.delete(sessionId);
  try {
    const { promise } = sendWorkerRequest<{
      ok: true;
      activeSessionId: string | null;
      map: OpenMapSummary | null;
    }>({ type: 'closeMapSession', sessionId }, sendLog);
    const res = await promise;
    activeMapSessionId = res.activeSessionId;
    if (res.map) {
      currentOpenMapSummary = res.map;
      currentMapPath = res.map.filePath;
      currentMapCompressed = false;
      currentMapScenarioName = res.map.header.scenarioName;
      currentMapModified = !!res.map.modified;
    } else {
      currentOpenMapSummary = null;
      currentMapPath = null;
      currentMapCompressed = false;
      currentMapScenarioName = null;
      currentMapModified = false;
    }
  } catch {
    activeMapSessionId = null;
  }
  buildMenu();
  updateTitle();
  broadcastOpenMapSessions();
  return {
    ok: true,
    activeSessionId: activeMapSessionId,
    sessions: Array.from(openMapSessions.values()),
  };
}

/** Open dialog (also accepts .bak backups). null = cancelled. */
async function openMapDialogFlow(): Promise<LoadMapResult | null> {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Halo CE Map',
    filters: [
      { name: 'Halo CE Map', extensions: ['map'] },
      { name: 'Map backup', extensions: ['bak'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  return openMapGuarded(filePaths[0]);
}

async function openMapFlow() {
  const result = await openMapDialogFlow();
  if (result) mainWindow?.webContents.send('map:loaded', result);
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
  if (currentMapModified) {
    // Recompress reads the file on disk, which doesn't have the in-memory changes.
    sendLog('warn', 'Recompress reads the map file on disk, which does not have your unsaved changes. Save first (File > Save or Save As), then recompress.');
    await showErrorBox('Save your changes before recompressing.', 'Recompress reads the map file on disk, which does not have your unsaved (injected) changes.');
    return null;
  }
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
 * Shows the native Save As or Folder dialog (never takes a path from the renderer), validates it,
 * confirms overwrite, then has the worker extract + write either standard Blam loose tag files
 * (`tags/<relative_path>.<group>` with 64-byte 'blam' headers, the default) or an `.ocetags` container.
 */
async function extractTagsFlow(request: ExtractTagsRequest): Promise<ExtractTagsResult> {
  if (!mainWindow) return { ok: false, code: 'NO_WINDOW', message: 'Application window is not available.' };
  if (!request || !Array.isArray(request.originalIndices) || request.originalIndices.length === 0 || !request.originalIndices.every((n) => Number.isInteger(n) && n >= 0)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'No valid tags were selected.' };
  }
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'Open and decompress a map before extracting tags.' };
  }

  const format: 'blam' | 'ocetags' = request.format ?? 'blam';
  const settings = getSettings();
  const defaultDir = settings.lastExtractDir && fs.existsSync(settings.lastExtractDir) ? settings.lastExtractDir : app.getPath('documents');
  const safeName = String(request.suggestedFileName || 'extracted_tags').replace(/[<>:"/\\|?*]/g, '_') || 'extracted_tags';
  const defaultPath = path.join(defaultDir, `${safeName}${OCETAGS_EXTENSION}`);

  let resolvedTarget: string;
  if (format === 'blam' || request.originalIndices.length > 1) {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title:
        format === 'blam'
          ? 'Choose folder to save standard Blam tags (tags\\<path>.<group>) to...'
          : 'Choose folder to save extracted tags to...',
      defaultPath: defaultDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return { ok: false, code: 'CANCELLED', message: 'Extraction was cancelled.' };
    resolvedTarget = path.resolve(filePaths[0]);
  } else {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Extract tags to (.ocetags)...',
      defaultPath,
      filters: [{ name: 'OpenCE Tag Set', extensions: ['ocetags'] }],
    });
    if (canceled || !filePath) return { ok: false, code: 'CANCELLED', message: 'Save was cancelled.' };
    resolvedTarget = path.resolve(filePath);
  }
  const resolvedSourceMap = path.resolve(currentMapPath);
  const resolvedAppDir = path.resolve(app.getAppPath());
  if (resolvedTarget === resolvedSourceMap) {
    return { ok: false, code: 'REFUSED_SOURCE_PATH', message: 'You cannot overwrite the source map file. Choose a different location.' };
  }
  if (resolvedTarget === resolvedAppDir || resolvedTarget.startsWith(resolvedAppDir + path.sep)) {
    return { ok: false, code: 'REFUSED_APP_PATH', message: 'You cannot save inside the application install directory. Choose a different location.' };
  }

  if (format === 'ocetags' && request.originalIndices.length === 1 && fs.existsSync(resolvedTarget)) {
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

  setLastExtractDir(format === 'blam' || request.originalIndices.length > 1 ? resolvedTarget : path.dirname(resolvedTarget));
  sendLog('info', `Extracting ${request.originalIndices.length} tag(s) (${format === 'blam' ? 'Standard Blam loose tags' : '.ocetags'}) to ${resolvedTarget}`);

  const resolvedSourceRes = resolveResourceMapsForSource(currentMapPath);
  const resourceMapPaths: Partial<Record<ResourceMapKind, string>> = {
    ...resolvedSourceRes.resourceMapPaths,
  };
  if (!resourceMapPaths.bitmaps && settings.resourceMaps?.bitmaps) resourceMapPaths.bitmaps = settings.resourceMaps.bitmaps;
  if (!resourceMapPaths.sounds && settings.resourceMaps?.sounds) resourceMapPaths.sounds = settings.resourceMaps.sounds;
  if (settings.resourceMaps?.loc) resourceMapPaths.loc = settings.resourceMaps.loc;

  const { requestId, promise } = sendWorkerRequest<ExtractTagsResult>(
    {
      type: 'extractTags',
      originalIndices: request.originalIndices,
      outputPath: resolvedTarget,
      sourceMapName: currentMapScenarioName ?? path.basename(currentMapPath, '.map'),
      resourceMapPaths,
      itemName: request.itemName,
      itemNames: request.itemNames,
      captureGbxmodelRawData: request.captureGbxmodelRawData,
      format,
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

async function batchExtractPreflightFlow(): Promise<BatchExtractPreflightResult | null> {
  if (!mainWindow) return null;
  if (!currentMapPath || currentMapCompressed || !currentOpenMapSummary) {
    await showErrorBox('No map open', 'Open and decompress a map before extracting tags.');
    return null;
  }

  const settings = getSettings();
  const defaultDir = settings.lastExtractDir && fs.existsSync(settings.lastExtractDir) ? settings.lastExtractDir : app.getPath('documents');

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose parent folder to export map to...',
    defaultPath: defaultDir,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (canceled || filePaths.length === 0) return null;
  const parentDir = path.resolve(filePaths[0]);

  const mapName = sanitizeMapName(currentMapScenarioName ?? path.basename(currentMapPath, '.map'));
  const targetDir = path.join(parentDir, mapName);

  const resolvedSourceMap = path.resolve(currentMapPath);
  const resolvedAppDir = path.resolve(app.getAppPath());
  if (targetDir === resolvedSourceMap) {
    await showErrorBox('Invalid location', 'You cannot extract into the source map file location. Choose a different folder.');
    return null;
  }
  if (targetDir === resolvedAppDir || targetDir.startsWith(resolvedAppDir + path.sep)) {
    await showErrorBox('Invalid location', 'You cannot save inside the application install directory. Choose a different folder.');
    return null;
  }

  setLastExtractDir(parentDir);

  const tags = currentOpenMapSummary.tags;
  const knownGroups = new Set(getAllTagGroupNames());

  let extractableCount = 0;
  let externalCount = 0;
  let blockedCount = 0;
  let estimatedTotalBytes = 0;

  for (const t of tags) {
    if (t.isExternal) {
      externalCount++;
      continue;
    }
    if (!knownGroups.has(t.primaryClassName)) {
      blockedCount++;
      continue;
    }
    const def = getGroupDefinition(t.primaryClassName);
    if (def.extractable === false) {
      blockedCount++;
      continue;
    }
    extractableCount++;
    estimatedTotalBytes += t.estimatedSize ?? 0;
  }

  const existingFileCount = countExistingOcetagsFiles(targetDir);
  const freeSpaceBytes = getDriveFreeSpace(parentDir);

  return {
    ok: true,
    mapName,
    scenarioName: currentMapScenarioName ?? mapName,
    parentDir,
    targetDir,
    totalTags: tags.length,
    extractableCount,
    externalCount,
    blockedCount,
    estimatedTotalBytes,
    freeSpaceBytes,
    existingFileCount,
  };
}

async function startBatchExtractFlow(options: {
  parentDir: string;
  mode: BatchExtractMode;
  extractFormat?: BatchExtractFormat;
}): Promise<BatchExtractResult> {
  if (!mainWindow) return { ok: false, code: 'NO_WINDOW', message: 'Application window is not available.' };
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }

  const settings = getSettings();
  const resolvedSourceRes = resolveResourceMapsForSource(currentMapPath);
  const resourceMapPaths: Partial<Record<ResourceMapKind, string>> = {
    ...resolvedSourceRes.resourceMapPaths,
  };
  for (const kind of ['bitmaps', 'sounds', 'loc'] as ResourceMapKind[]) {
    const p = settings.resourceMaps[kind];
    if (!resourceMapPaths[kind] && p) resourceMapPaths[kind] = p;
  }

  const sourceMapName = currentMapScenarioName ?? path.basename(currentMapPath, '.map');
  const effectiveFormat: BatchExtractFormat = options.extractFormat ?? 'blam';
  sendLog(
    'info',
    `Starting batch extraction of ${sourceMapName} to ${options.parentDir} (mode: ${options.mode}, format: ${effectiveFormat})...`,
  );

  const { requestId, promise } = sendWorkerRequest<BatchExtractResult>(
    {
      type: 'batchExtract',
      parentDir: options.parentDir,
      sourceMapName,
      mode: options.mode,
      extractFormat: effectiveFormat,
      resourceMapPaths,
    },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'batchExtract', stage, percent }),
  );
  currentBatchExtractRequestId = requestId;

  try {
    const result = await promise;
    if (result.ok) {
      sendLog(
        'info',
        `Batch extraction complete: ${result.summary.extractedCount} tags extracted to ${result.summary.targetDir} (${(result.summary.totalBytesWritten / 1024 / 1024).toFixed(2)} MB).`,
      );
    } else if (result.code === 'CANCELLED') {
      sendLog('warn', 'Batch extraction cancelled.');
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Batch extraction failed: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  } finally {
    currentBatchExtractRequestId = null;
  }
}

function cancelBatchExtractFlow() {
  if (currentBatchExtractRequestId) {
    cancelWorkerRequest(currentBatchExtractRequestId, sendLog);
  }
}

async function finalizeBatchExtractFlow(request: FinalizeBatchExtractRequest): Promise<{ ok: boolean; message?: string }> {
  try {
    if (request.action === 'keep') {
      commitStagedFiles(request.stagingDir, request.targetDir);
      if (request.summary) {
        const manifest: BatchExtractManifest = {
          manifestVersion: 1,
          toolVersion: '0.1.0',
          containerVersion: OCETAGS_FORMAT_VERSION,
          extractedAt: new Date().toISOString(),
          mapFileName: path.basename(currentMapPath ?? request.summary.mapName),
          scenarioName: currentMapScenarioName ?? request.summary.mapName,
          summary: {
            totalTagsInMap: request.summary.totalTagsInMap,
            extractedCount: request.summary.extractedCount,
            skippedExistingCount: request.summary.skippedCount,
            externalCount: request.summary.externalCount,
            blockedCount: request.summary.blockedCount,
            failedCount: request.summary.failedCount,
            totalBytesWritten: request.summary.totalBytesWritten,
          },
          files: request.summary.tags
            .filter((t) => t.status === 'extracted')
            .map((t) => ({
              path: t.path,
              group: t.group,
              relativePath: path.relative(request.targetDir, t.outputPath ?? ''),
              sizeBytes: t.sizeBytes ?? 0,
              tagCount: t.tagCount ?? 1,
            })),
          blocked: request.summary.tags
            .filter((t) => t.status === 'blocked')
            .map((t) => ({
              path: t.path,
              group: t.group,
              reason: t.reason ?? 'Blocked tag',
            })),
          external: request.summary.tags
            .filter((t) => t.status === 'external')
            .map((t) => ({
              path: t.path,
              group: t.group,
              reason: t.reason ?? 'External resource map tag',
            })),
        };
        const reportText = generateBatchReportText(manifest);
        writeManifestAndReport(request.targetDir, manifest, reportText);
      }
      sendLog('info', `Committed staged batch extraction files to ${request.targetDir}.`);
    } else {
      discardStagedFiles(request.stagingDir);
      sendLog('info', 'Cleaned up cancelled batch extraction staging directory.');
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendLog('error', `Failed to finalize batch extraction: ${msg}`);
    return { ok: false, message: msg };
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

function openRandomAccessFile(filePath: string): { file: RandomAccessFile; close: () => void } | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const label = path.basename(filePath);
    return {
      file: {
        label,
        size,
        read: (offset: number, length: number) => {
          const buf = Buffer.alloc(length);
          fs.readSync(fd, buf, 0, length, offset);
          return buf;
        },
      },
      close: () => fs.closeSync(fd),
    };
  } catch {
    return null;
  }
}

function identifyResourceMapFlow(
  filePath: string,
  expectedVersion?: HaloBitmapVersion,
  expectedKind?: 'bitmaps' | 'sounds',
): BitmapIdentificationResult {
  const handle = openRandomAccessFile(filePath);
  if (!handle) {
    return {
      ok: false,
      error: `Could not open file at ${filePath}. File may not exist or cannot be accessed.`,
      filePath,
      fileSizeBytes: 0,
      entryCount: 0,
      tableOffset: 0,
      detectedVersion: 'unknown',
      versionMatchConfidence: 'mismatch',
      entries: [],
    };
  }

  try {
    if (handle.file.size < 0x10) {
      return {
        ok: false,
        error: `${filePath} is too small to be a resource map.`,
        filePath,
        fileSizeBytes: handle.file.size,
        entryCount: 0,
        tableOffset: 0,
        detectedVersion: 'unknown',
        versionMatchConfidence: 'mismatch',
        entries: [],
      };
    }

    const header = handle.file.read(0, 0x10);
    const type = header.readUInt32LE(0x0);
    const tableOffset = header.readUInt32LE(0x8);

    // Determine resource kind (1 = bitmaps, 2 = sounds, 3 = loc)
    let kind: 'bitmaps' | 'sounds' = 'bitmaps';
    if (expectedKind) {
      kind = expectedKind;
    } else if (type === 2 || path.basename(filePath).toLowerCase().includes('sounds')) {
      kind = 'sounds';
    } else {
      kind = 'bitmaps';
    }

    const res = readResourceTable(handle.file, kind);
    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        filePath,
        fileSizeBytes: handle.file.size,
        entryCount: 0,
        tableOffset: 0,
        detectedVersion: 'unknown',
        versionMatchConfidence: 'mismatch',
        resourceKind: kind,
        entries: [],
      };
    }

    const { table } = res;
    const size = handle.file.size;
    const count = table.entries.length;
    const fpLower = (filePath || '').toLowerCase();

    // Heuristics for edition detection
    let detectedVersion: HaloBitmapVersion | 'unknown' = 'unknown';
    let versionNote: string | undefined = undefined;

    if (kind === 'sounds') {
      if (
        (size > 200 * 1024 * 1024 && size < 235 * 1024 * 1024 && count > 10000) ||
        count === 11102
      ) {
        // PC Retail & HaloMD sounds.map (100% byte-for-byte identical, 218,464,450 bytes, 11,102 entries)
        if (expectedVersion === 'halomd' || fpLower.includes('halomd')) {
          detectedVersion = 'halomd';
        } else {
          detectedVersion = 'pc';
        }
        versionNote = 'Halo PC Retail and HaloMD share identical sounds.map (218 MB, 11,102 entries).';
      } else if (
        (size > 35 * 1024 * 1024 && size < 50 * 1024 * 1024 && count > 600 && count < 900) ||
        count === 752
      ) {
        detectedVersion = 'ce';
      } else if (
        (size > 65 * 1024 * 1024 && size < 95 * 1024 * 1024 && count > 6500 && count < 8000) ||
        count === 7192 ||
        fpLower.includes('demo')
      ) {
        detectedVersion = 'demo';
      } else {
        detectedVersion = expectedVersion ?? 'unknown';
      }
    } else {
      // bitmaps
      if (
        expectedVersion === 'mcc' ||
        fpLower.includes('mcc') ||
        (size > 170 * 1024 * 1024 && size < 220 * 1024 * 1024 && count > 1750 && count < 1900) ||
        count === 1818
      ) {
        detectedVersion = 'mcc';
      } else if (
        (size > 300 * 1024 * 1024 && size < 335 * 1024 * 1024 && count > 3900 && count < 4300) ||
        count === 4099
      ) {
        // PC Retail & HaloMD bitmaps.map (99.98% identical, 317,199,907 bytes, 4,099 entries)
        if (expectedVersion === 'halomd' || fpLower.includes('halomd')) {
          detectedVersion = 'halomd';
        } else {
          detectedVersion = 'pc';
        }
        versionNote = 'Halo PC Retail and HaloMD share virtually identical bitmaps.map (317 MB, 4,099 entries).';
      } else if (
        (size > 110 * 1024 * 1024 && size < 140 * 1024 * 1024 && count > 1600 && count < 1800) ||
        count === 1706 ||
        (size < 40 * 1024 * 1024 && count === 1568)
      ) {
        detectedVersion = 'ce';
      } else if (
        (size < 95 * 1024 * 1024 && (count <= 1300 || fpLower.includes('demo'))) ||
        count === 1107
      ) {
        detectedVersion = 'demo';
      } else {
        detectedVersion = expectedVersion ?? 'unknown';
      }
    }

    let versionMatchConfidence: 'exact' | 'likely' | 'mismatch' = 'likely';
    if (expectedVersion) {
      if (expectedVersion === detectedVersion) {
        versionMatchConfidence = 'exact';
      } else if (
        (expectedVersion === 'pc' && detectedVersion === 'halomd') ||
        (expectedVersion === 'halomd' && detectedVersion === 'pc')
      ) {
        versionMatchConfidence = 'exact';
      } else if (
        (expectedVersion === 'ce' && (detectedVersion === 'pc' || detectedVersion === 'halomd')) ||
        ((expectedVersion === 'pc' || expectedVersion === 'halomd') && detectedVersion === 'ce')
      ) {
        versionMatchConfidence = 'likely';
      } else {
        versionMatchConfidence = 'mismatch';
      }
    }

    const entries = table.entries.map((e) => ({
      index: e.index,
      name: e.name,
      dataOffset: e.dataOffset,
      size: e.size,
    }));

    return {
      ok: true,
      filePath,
      fileSizeBytes: handle.file.size,
      resourceKind: kind,
      entryCount: table.entries.length,
      tableOffset,
      detectedVersion,
      versionMatchConfidence,
      versionNote,
      entries,
    };
  } finally {
    handle.close();
  }
}

function getSearchRoots(): string[] {
  const cwd = process.cwd();
  return [
    cwd,
    path.resolve(cwd, '..'),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..'),
    'C:\\Users\\LeviB\\Projects\\OpenCE-Mantle',
  ];
}

function detectDefaultResourceMapPathsFlow(): Record<HaloBitmapVersion, string | null> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const cwd = process.cwd();
  const searchRoots = getSearchRoots();

  const candidates: Record<HaloBitmapVersion, string[]> = {
    halomd: [
      ...searchRoots.map((r) => path.join(r, 'sample_maps/HaloMD/bitmaps.map')),
      path.join(home, 'Library/Application Support/HaloMD/GameData/Maps/bitmaps.map'),
      path.join(cwd, 'bitmaps.map'),
    ],
    ce: [
      ...searchRoots.map((r) => path.join(r, 'sample_maps/custom edition/bitmaps.map')),
      'C:\\Users\\LeviB\\Desktop\\Halo CE Related\\OpenCE\\custom_maps\\bitmaps.map',
      'C:\\Users\\LeviB\\Desktop\\Halo CE Related\\Halo CE - OpenCE\\custom_maps\\bitmaps.map',
      'C:\\Users\\LeviB\\Projects\\OpenCE-MapExp\\build\\windows\\custom_maps\\bitmaps.map',
      'C:\\Users\\LeviB\\Projects\\OpenCE-Forge\\FORGE CODE\\GAME MAPS\\CUSTOM EDITION DEFAULT MAPS\\bitmaps.map',
      'C:\\Program Files (x86)\\Microsoft Games\\Halo Custom Edition\\maps\\bitmaps.map',
      'C:\\Program Files\\Microsoft Games\\Halo Custom Edition\\maps\\bitmaps.map',
      path.join(cwd, 'maps/bitmaps.map'),
    ],
    pc: [
      ...searchRoots.map((r) => path.join(r, 'sample_maps/PC/bitmaps.map')),
      ...searchRoots.map((r) => path.join(r, 'sample_maps/HaloMD/bitmaps.map')),
      'C:\\Users\\LeviB\\Desktop\\Halo CE Related\\Halo CE\\MAPS\\bitmaps.map',
      'C:\\Users\\LeviB\\Projects\\OpenCE-Forge\\FORGE CODE\\GAME MAPS\\PC MAPS\\bitmaps.map',
      'C:\\Program Files (x86)\\Microsoft Games\\Halo\\maps\\bitmaps.map',
      'C:\\Program Files\\Microsoft Games\\Halo\\maps\\bitmaps.map',
    ],
    demo: [
      ...searchRoots.map((r) => path.join(r, 'sample_maps/MacDemo/bitmaps.map')),
      ...searchRoots.map((r) => path.join(r, 'sample_maps/Base Siege/bitmaps.map')),
      'C:\\Program Files (x86)\\Microsoft Games\\Halo Demo\\maps\\bitmaps.map',
      path.join(home, 'Applications/Halo Demo/Maps/bitmaps.map'),
    ],
    mcc: [
      ...searchRoots.map((r) => path.join(r, 'sample_maps/MCC/bitmaps.map')),
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Halo The Master Chief Collection\\halo1\\maps\\bitmaps.map',
      'C:\\Program Files\\Steam\\steamapps\\common\\Halo The Master Chief Collection\\halo1\\maps\\bitmaps.map',
      'D:\\SteamLibrary\\steamapps\\common\\Halo The Master Chief Collection\\halo1\\maps\\bitmaps.map',
      'E:\\SteamLibrary\\steamapps\\common\\Halo The Master Chief Collection\\halo1\\maps\\bitmaps.map',
    ],
    xbox: [],
  };

  const result: Record<HaloBitmapVersion, string | null> = {
    halomd: null,
    ce: null,
    pc: null,
    demo: null,
    mcc: null,
    xbox: null,
  };

  for (const ver of Object.keys(candidates) as HaloBitmapVersion[]) {
    for (const p of candidates[ver]) {
      try {
        if (fs.existsSync(p)) {
          result[ver] = p;
          break;
        }
      } catch {}
    }
  }

  return result;
}

async function pickInjectContainerFlow(): Promise<{ path: string; paths: string[] } | null> {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Inject tags from Standard Blam Loose Tag or OpenCE Tag Set...',
    filters: [
      {
        name: 'Standard Blam Loose Tags & OpenCE Containers',
        extensions: [
          'weapon',
          'biped',
          'vehicle',
          'scenery',
          'equipment',
          'garbage',
          'projectile',
          'device_machine',
          'device_control',
          'device_light_fixture',
          'gbxmodel',
          'model',
          'model_animations',
          'model_collision_geometry',
          'physics',
          'bitmap',
          'sound',
          'effect',
          'damage_effect',
          'light',
          'light_volume',
          'contrail',
          'particle',
          'particle_system',
          'shader_model',
          'shader_environment',
          'shader_transparent_chicago',
          'shader_transparent_chicago_extended',
          'shader_transparent_generic',
          'shader_transparent_glass',
          'shader_transparent_meter',
          'shader_transparent_plasma',
          'shader_transparent_water',
          'item_collection',
          'weapon_hud_interface',
          'unit_hud_interface',
          'grenade_hud_interface',
          'hud_message_text',
          'unicode_string_list',
          'string_list',
          'ui_widget_definition',
          'ui_widget_collection',
          'scenario',
          'scenario_structure_bsp',
          'sky',
          'wind',
          'fog',
          'actor',
          'actor_variant',
          'globals',
          'ocetags',
          'meta',
        ],
      },
      { name: 'OpenCE Tag Set (*.ocetags)', extensions: ['ocetags'] },
      { name: 'All Files (*.*)', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || filePaths.length === 0) return null;
  return { path: filePaths[0], paths: filePaths };
}

async function planInjectFlow(containerPath: string, mode: InjectionMode): Promise<PlanInjectResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'Open the target map before injecting tags into it.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };
  currentInjectContainerPath = containerPath;
  const settings = getSettings();
  const resolvedSourceRes = resolveResourceMapsForSource(currentMapPath);
  const resourceMapPaths: Partial<Record<ResourceMapKind, string>> = {
    ...resolvedSourceRes.resourceMapPaths,
  };
  for (const kind of ['bitmaps', 'sounds', 'loc'] as ResourceMapKind[]) {
    const p = settings.resourceMaps[kind];
    if (!resourceMapPaths[kind] && p) resourceMapPaths[kind] = p;
  }
  const defaults = detectDefaultResourceMapPathsFlow();
  const pcBitmaps = settings.versionResourceMaps?.pc?.bitmaps ?? settings.versionResourceMaps?.halomd?.bitmaps ?? defaults.pc ?? defaults.halomd ?? undefined;
  let pcSounds = settings.versionResourceMaps?.pc?.sounds ?? settings.versionResourceMaps?.halomd?.sounds ?? undefined;
  if (!pcSounds && pcBitmaps) {
    const sib = path.join(path.dirname(pcBitmaps), 'sounds.map');
    if (fs.existsSync(sib)) pcSounds = sib;
  }
  const fallbackPcResourcePaths: Partial<Record<ResourceMapKind, string>> = {};
  if (pcBitmaps && fs.existsSync(pcBitmaps)) fallbackPcResourcePaths.bitmaps = pcBitmaps;
  if (pcSounds && fs.existsSync(pcSounds)) fallbackPcResourcePaths.sounds = pcSounds;

  sendLog('info', `Planning ${mode === 'swap' ? 'swap' : 'add'} injection from ${containerPath}`);
  const { promise } = sendWorkerRequest<PlanInjectResult>({ type: 'planInject', containerPath, mode, resourceMapPaths, fallbackPcResourcePaths }, sendLog, (stage, percent) =>
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

/**
 * Before any map is written: the map's internal (scenario) name will be set from the chosen file
 * name. If the file name can't be stored as-is (over 31 characters, or characters outside
 * printable ASCII), say what the name will be and let the user cancel. Returns false to cancel.
 */
async function confirmScenarioName(filePath: string): Promise<boolean> {
  let warnings: string[];
  try {
    warnings = scenarioNameFromFileName(path.basename(filePath)).warnings;
  } catch (err) {
    await dialog.showMessageBox(mainWindow!, { type: 'error', message: 'This file name cannot be used for a map.', detail: (err as Error).message });
    return false;
  }
  if (warnings.length === 0) return true;
  const { response } = await dialog.showMessageBox(mainWindow!, {
    type: 'warning',
    buttons: ['Save anyway', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: "The map's internal name will not match this file name.",
    detail: warnings.join('\n\n'),
  });
  return response === 0;
}

/** Applies the reviewed plan to the open map in memory (worker). Writes nothing; marks the map modified. */
async function applyInjectFlow(): Promise<ApplyInjectResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };
  if (!currentInjectContainerPath) return { ok: false, code: 'NO_PLAN', message: 'Run "Inject Tags..." and review the plan before applying it.' };

  const { promise } = sendWorkerRequest<ApplyInjectResult>({ type: 'applyInject' }, sendLog, (stage, percent) =>
    mainWindow?.webContents.send('map:progress', { taskId: 'applyInject', stage, percent }),
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog(
        'info',
        `Injected in memory: ${result.addedCount} added, ${result.swappedCount} swapped, ${result.reusedCount} reused - ${result.map.header.tagCount} tags now. Not saved yet: use File > Save or Save As.`,
      );
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Injection failed (the open map is unchanged): ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  } finally {
    currentInjectContainerPath = null;
  }
}

async function getTagFieldsFlow(tagIndex: number): Promise<GetTagFieldsResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<GetTagFieldsResult>({ type: 'getTagFields', tagIndex }, sendLog);
  try {
    return await promise;
  } catch (err) {
    const e = err as Error & { code?: string };
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

async function updateTagFieldFlow(tagIndex: number, fieldName: string, newValue: unknown): Promise<UpdateTagFieldResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<UpdateTagFieldResult>(
    { type: 'updateTagField', tagIndex, fieldName, newValue },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog('info', `Updated "${fieldName}" in tag #${tagIndex} (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Field update failed: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

async function addReflexiveChunkFlow(
  tagIndex: number,
  reflexiveFieldPath: string,
  cloneFromIndex?: number,
): Promise<AddReflexiveChunkResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<AddReflexiveChunkResult>(
    { type: 'addReflexiveChunk', tagIndex, reflexiveFieldPath, cloneFromIndex },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      const actionDesc = cloneFromIndex !== undefined && cloneFromIndex >= 0
        ? `Cloned element #${cloneFromIndex} in "${reflexiveFieldPath}" (element #${result.newElementIndex})`
        : `Added new element to "${reflexiveFieldPath}" (element #${result.newElementIndex})`;
      sendLog('info', `${actionDesc} in tag #${tagIndex} (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Add/clone reflexive chunk failed: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}


async function getDependencySlotsFlow(tagIndex: number): Promise<GetDependencySlotsResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };
  const { promise } = sendWorkerRequest<GetDependencySlotsResult>({ type: 'getDependencySlots', tagIndex }, sendLog);
  try {
    return await promise;
  } catch (err) {
    const e = err as Error & { code?: string };
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

async function setDependencySlotFlow(tagIndex: number, fieldPath: string, newTagId: number | null): Promise<SetDependencySlotResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };
  const { promise } = sendWorkerRequest<SetDependencySlotResult>({ type: 'setDependencySlot', tagIndex, fieldPath, newTagId }, sendLog);
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog('info', `Swapped dependency "${fieldPath}" of tag #${tagIndex} (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Dependency swap failed: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Step 8.4: Extracts 3D Structure BSP render mesh for the open map. */
async function getBspRenderMeshFlow(bspIndex?: number): Promise<GetBspRenderMeshResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const { promise } = sendWorkerRequest<GetBspRenderMeshResult>(
    { type: 'getBspRenderMesh', bspIndex },
    sendLog,
  );
  return promise;
}

/** Step 8.4: Decodes a bitmap or resolves and decodes a shader's diffuse texture for 3D rendering. */
async function getBitmapTextureFlow(bitmapTagId: number, imageIndex?: number): Promise<GetBitmapTextureResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const settings = getSettings();
  const bitmapsPath =
    resolveResourceMapsForSource(currentMapPath).bitmapsPath ?? settings.resourceMaps.bitmaps ?? undefined;
  const { promise } = sendWorkerRequest<GetBitmapTextureResult>(
    { type: 'getBitmapTexture', bitmapTagId, imageIndex, bitmapsPath },
    sendLog,
  );
  return promise;
}

/** Step 8.5: Extracts placed scenario objects (vehicles, scenery, spawns, weapons) from the open map. */
async function getScenarioObjectsFlow(): Promise<GetScenarioObjectsResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const { promise } = sendWorkerRequest<GetScenarioObjectsResult>(
    { type: 'getScenarioObjects' },
    sendLog,
  );
  return promise;
}

/** Step 8.5: Extracts 3D model geometry for a gbxmodel tag. */
async function getModelGeometryFlow(modelTagId: number, lod?: number): Promise<GetModelRenderGeometryResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const { promise } = sendWorkerRequest<GetModelRenderGeometryResult>(
    { type: 'getModelGeometry', modelTagId, lod },
    sendLog,
  );
  return promise;
}

/** M13.1: Bitmap / Texture Editor flows */
async function pickExportBitmapPathFlow(defaultName: string, format: 'png' | 'dds'): Promise<{ path: string | null }> {
  if (!mainWindow) return { path: null };
  const ext = format === 'dds' ? 'dds' : 'png';
  const res = await dialog.showSaveDialog(mainWindow, {
    title: `Export Bitmap as ${format.toUpperCase()}`,
    defaultPath: `${defaultName}.${ext}`,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  });
  return { path: res.canceled ? null : (res.filePath ?? null) };
}

async function pickImportBitmapPathFlow(): Promise<{ path: string | null }> {
  if (!mainWindow) return { path: null };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Bitmap Image',
    filters: [{ name: 'Bitmap Images (PNG, DDS)', extensions: ['png', 'dds'] }],
    properties: ['openFile'],
  });
  return { path: res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0] };
}

async function getBitmapInfoFlow(tagIndex: number): Promise<GetBitmapInfoResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const settings = getSettings();
  const bitmapsPath =
    resolveResourceMapsForSource(currentMapPath).bitmapsPath ?? settings.resourceMaps.bitmaps ?? undefined;
  const { promise } = sendWorkerRequest<GetBitmapInfoResult>(
    { type: 'getBitmapInfo', tagIndex, bitmapsPath },
    sendLog,
  );
  return promise;
}

async function getBitmapRgbaFlow(tagIndex: number, imageIndex: number): Promise<GetBitmapRgbaResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const settings = getSettings();
  const bitmapsPath =
    resolveResourceMapsForSource(currentMapPath).bitmapsPath ?? settings.resourceMaps.bitmaps ?? undefined;
  const { promise } = sendWorkerRequest<GetBitmapRgbaResult>(
    { type: 'getBitmapRgba', tagIndex, imageIndex, bitmapsPath },
    sendLog,
  );
  return promise;
}

async function exportBitmapFlow(tagIndex: number, imageIndex: number, format: 'png' | 'dds', outputPath: string): Promise<ExportBitmapResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const settings = getSettings();
  const bitmapsPath =
    resolveResourceMapsForSource(currentMapPath).bitmapsPath ?? settings.resourceMaps.bitmaps ?? undefined;
  const { promise } = sendWorkerRequest<ExportBitmapResult>(
    { type: 'exportBitmap', tagIndex, imageIndex, format, outputPath, bitmapsPath },
    sendLog,
  );
  return promise;
}

async function replaceBitmapFlow(tagIndex: number, imageIndex: number, inputPath: string, targetFormat?: number): Promise<ReplaceBitmapResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const settings = getSettings();
  const bitmapsPath =
    resolveResourceMapsForSource(currentMapPath).bitmapsPath ?? settings.resourceMaps.bitmaps ?? undefined;
  const { promise } = sendWorkerRequest<ReplaceBitmapResult>(
    { type: 'replaceBitmap', tagIndex, imageIndex, inputPath, targetFormat, bitmapsPath },
    sendLog,
  );
  const result = await promise;
  if (result.ok && result.map) {
    setOpenMapState(result.map);
  }
  return result;
}

/** M13.2: Sound Audition Player & Injector flows */
async function pickExportSoundPathFlow(defaultName: string): Promise<{ path: string | null }> {
  if (!mainWindow) return { path: null };
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Sound as WAV',
    defaultPath: `${defaultName}.wav`,
    filters: [{ name: 'WAV Audio (*.wav)', extensions: ['wav'] }],
  });
  return { path: res.canceled ? null : (res.filePath ?? null) };
}

async function pickImportSoundPathFlow(): Promise<{ path: string | null }> {
  if (!mainWindow) return { path: null };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Import WAV Audio',
    filters: [{ name: 'WAV Audio (*.wav)', extensions: ['wav'] }],
    properties: ['openFile'],
  });
  return { path: res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0] };
}

async function getSoundInfoFlow(tagIndex: number): Promise<GetSoundInfoResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const settings = getSettings();
  const soundsPath =
    resolveResourceMapsForSource(currentMapPath).soundsPath ?? settings.resourceMaps.sounds ?? undefined;
  const { promise } = sendWorkerRequest<GetSoundInfoResult>(
    { type: 'getSoundInfo', tagIndex, soundsPath },
    sendLog,
  );
  return promise;
}

async function getSoundWavFlow(tagIndex: number, pitchRangeIndex: number, permutationIndex: number): Promise<GetSoundWavResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const settings = getSettings();
  const soundsPath =
    resolveResourceMapsForSource(currentMapPath).soundsPath ?? settings.resourceMaps.sounds ?? undefined;
  const { promise } = sendWorkerRequest<GetSoundWavResult>(
    { type: 'getSoundWav', tagIndex, pitchRangeIndex, permutationIndex, soundsPath },
    sendLog,
  );
  return promise;
}

async function exportSoundFlow(
  tagIndex: number,
  pitchRangeIndex: number,
  permutationIndex: number,
  outputPath: string,
): Promise<ExportSoundResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const settings = getSettings();
  const soundsPath =
    resolveResourceMapsForSource(currentMapPath).soundsPath ?? settings.resourceMaps.sounds ?? undefined;
  const { promise } = sendWorkerRequest<ExportSoundResult>(
    { type: 'exportSound', tagIndex, pitchRangeIndex, permutationIndex, outputPath, soundsPath },
    sendLog,
  );
  return promise;
}

async function replaceSoundFlow(
  tagIndex: number,
  pitchRangeIndex: number,
  permutationIndex: number,
  inputPath: string,
  targetFormat?: number,
): Promise<ReplaceSoundResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const settings = getSettings();
  const soundsPath =
    resolveResourceMapsForSource(currentMapPath).soundsPath ?? settings.resourceMaps.sounds ?? undefined;
  const { promise } = sendWorkerRequest<ReplaceSoundResult>(
    { type: 'replaceSound', tagIndex, pitchRangeIndex, permutationIndex, inputPath, targetFormat, soundsPath },
    sendLog,
  );
  const result = await promise;
  if (result.ok && result.map) {
    setOpenMapState(result.map);
  }
  return result;
}

async function pickExport3dPathFlow(
  defaultName: string,
  format: 'obj' | 'glb',
): Promise<{ path: string | null; format?: 'obj' | 'glb' }> {
  if (!mainWindow) return { path: null };
  const filters =
    format === 'glb'
      ? [
          { name: 'glTF 2.0 Binary (*.glb)', extensions: ['glb'] },
          { name: 'Wavefront OBJ (*.obj)', extensions: ['obj'] },
          { name: 'All Files (*.*)', extensions: ['*'] },
        ]
      : [
          { name: 'Wavefront OBJ (*.obj)', extensions: ['obj'] },
          { name: 'glTF 2.0 Binary (*.glb)', extensions: ['glb'] },
          { name: 'All Files (*.*)', extensions: ['*'] },
        ];
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export 3D Model / BSP',
    defaultPath: defaultName,
    filters,
  });
  if (res.canceled || !res.filePath) return { path: null };
  const chosenFormat = res.filePath.toLowerCase().endsWith('.obj')
    ? 'obj'
    : res.filePath.toLowerCase().endsWith('.glb')
      ? 'glb'
      : format;
  return { path: res.filePath, format: chosenFormat };
}

async function pickExportDirectoryFlow(): Promise<{ path: string | null }> {
  if (!mainWindow) return { path: null };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Destination Folder for Hierarchy Export',
    properties: ['openDirectory', 'createDirectory'],
  });
  return { path: res.canceled || !res.filePaths[0] ? null : res.filePaths[0] };
}

function read3dMeshSourceAsObjText(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf8');
  const low = filePath.toLowerCase();
  if (low.endsWith('.jms')) {
    return convertJmsToObjText(raw).objText;
  }
  if (low.endsWith('.dae')) {
    return convertColladaDaeToObjText(raw).objText;
  }
  return raw;
}

async function pickObjFileFlow(): Promise<{ path: string | null }> {
  if (!mainWindow) return { path: null };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select 3D Model (.obj / .jms / .dae)',
    filters: [
      { name: '3D Models (*.obj;*.jms;*.dae)', extensions: ['obj', 'jms', 'dae'] },
      { name: 'Wavefront OBJ (*.obj)', extensions: ['obj'] },
      { name: 'Halo CE JMS (*.jms)', extensions: ['jms'] },
      { name: 'COLLADA DAE (*.dae)', extensions: ['dae'] },
      { name: 'All Files (*.*)', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return { path: res.canceled || !res.filePaths[0] ? null : res.filePaths[0] };
}

async function analyzeCollisionObjFlow(
  filePath?: string,
  options?: { scale?: number; flipYz?: boolean; centerOrigin?: boolean; forceAutoUv?: boolean; uvUnwrapMode?: 'box' | 'per_triangle' | 'smart' },
) {
  try {
    let p = filePath;
    if (!p) {
      const picked = await pickObjFileFlow();
      if (!picked.path) return { ok: false, error: 'Cancelled' };
      p = picked.path;
    }
    const text = read3dMeshSourceAsObjText(p);
    const summary = parseAndAnalyzeObj(text, options);
    return { ok: true, summary, filePath: p };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function exportUvTemplateFlow(options: {
  objFilePath: string;
  size?: number;
  scale?: number;
  flipYz?: boolean;
  centerOrigin?: boolean;
  forceAutoUv?: boolean;
  uvUnwrapMode?: 'box' | 'per_triangle' | 'smart';
  previewOnly?: boolean;
}): Promise<ExportUvTemplateResult> {
  try {
    if (!options.objFilePath || !fs.existsSync(options.objFilePath)) {
      return { ok: false, error: 'Select a valid .obj / .jms / .dae model file first.' };
    }
    const objText = read3dMeshSourceAsObjText(options.objFilePath);
    const size = options.size ?? (options.previewOnly ? 512 : 1024);
    const { pngBuffer, usedAutoUv } = renderObjUvTemplatePng(objText, size, {
      scale: options.scale,
      flipYz: options.flipYz,
      centerOrigin: options.centerOrigin,
      forceAutoUv: options.forceAutoUv,
      uvUnwrapMode: options.uvUnwrapMode,
    });
    const previewDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

    if (options.previewOnly) {
      return { ok: true, usedAutoUv, previewDataUrl };
    }

    if (!mainWindow) return { ok: false, error: 'Application window is not available.' };
    const baseName = path.basename(options.objFilePath, path.extname(options.objFilePath));
    const defaultPath = path.join(path.dirname(options.objFilePath), `${baseName}_uv_template.png`);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save UV Template Image (.png)',
      defaultPath,
      filters: [{ name: 'PNG Image (*.png)', extensions: ['png'] }],
    });
    if (canceled || !filePath) {
      return { ok: false, error: 'Cancelled' };
    }
    fs.writeFileSync(filePath, pngBuffer);
    sendLog('info', `Saved UV wireframe template to ${filePath}`);
    return { ok: true, outputPath: filePath, usedAutoUv, previewDataUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function pickSaveOceTagsPathFlow(defaultName: string): Promise<{ path: string | null }> {
  if (!mainWindow) return { path: null };
  const settings = getSettings();
  const baseDir = settings.lastExtractDir ?? (currentMapPath ? path.dirname(currentMapPath) : app.getPath('documents'));
  const cleanFile = defaultName.endsWith(OCETAGS_EXTENSION) ? defaultName : `${defaultName}${OCETAGS_EXTENSION}`;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Custom Object Tag Set (.ocetags)',
    defaultPath: path.join(baseDir, cleanFile),
    filters: [{ name: 'OpenCE Tag Set (*.ocetags)', extensions: ['ocetags'] }],
  });
  if (canceled || !filePath) return { path: null };
  setLastExtractDir(path.dirname(filePath));
  return { path: filePath };
}

async function buildCustomObjectTagFlow(request: BuildCustomObjectRequest): Promise<BuildCustomObjectResult> {
  const settings = getSettings();
  const resourceMapPaths: Partial<Record<ResourceMapKind, string>> = {};
  if (currentMapPath) {
    const resolved = resolveResourceMapsForSource(currentMapPath);
    Object.assign(resourceMapPaths, resolved.resourceMapPaths);
  }
  for (const kind of ['bitmaps', 'sounds', 'loc'] as ResourceMapKind[]) {
    const p = settings.resourceMaps[kind];
    if (!resourceMapPaths[kind] && p) resourceMapPaths[kind] = p;
  }

  sendLog('info', `Building custom ${request.tagGroup} tag "${request.tagPath}" from ${path.basename(request.objFilePath)}...`);
  const { promise } = sendWorkerRequest<BuildCustomObjectResult>(
    { type: 'buildCustomObjectTag', request, resourceMapPaths },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'buildCustomObjectTag', stage, percent }),
  );
  try {
    const result = await promise;
    if (result.ok) {
      if (result.injectedIntoMap && result.map) {
        setOpenMapState(result.map);
        sendLog('info', `Built and injected custom ${result.rootTagGroup} tag "${result.rootTagPath}" (${result.generatedTagPaths.length} tags) into the open map. Use File > Save to write changes.`);
      } else if (result.outputOceTagsPath) {
        sendLog('info', `Built and saved custom ${result.rootTagGroup} tag "${result.rootTagPath}" to ${result.outputOceTagsPath}.`);
      }
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Failed to build custom object tag: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

async function exportModel3dFlow(
  modelTagId: number,
  lod: number | undefined,
  format: 'obj' | 'glb',
  outputPath: string,
): Promise<Export3dResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const { promise } = sendWorkerRequest<Export3dResult>(
    { type: 'exportModel3d', modelTagId, lod, format, outputPath },
    sendLog,
  );
  return promise;
}

async function exportBsp3dFlow(
  bspIndex: number,
  format: 'obj' | 'glb',
  outputPath: string,
): Promise<Export3dResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const { promise } = sendWorkerRequest<Export3dResult>(
    { type: 'exportBsp3d', bspIndex, format, outputPath },
    sendLog,
  );
  return promise;
}

/** Step 9: Updates a placed scenario object in memory. */
async function updateScenarioPlacementFlow(
  placementId: string,
  updates: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    paletteIndex?: number;
    teamIndex?: number;
  },
): Promise<UpdateScenarioPlacementResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<UpdateScenarioPlacementResult>(
    { type: 'updateScenarioPlacement', placementId, ...updates },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog('info', `Updated scenario placement "${placementId}" (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Failed to update scenario placement: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Step 9: Duplicates an existing scenario object in memory. */
async function duplicateScenarioPlacementFlow(
  placementId: string,
  offsetDelta?: [number, number, number],
): Promise<DuplicateScenarioPlacementResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<DuplicateScenarioPlacementResult>(
    { type: 'duplicateScenarioPlacement', placementId, offsetDelta },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog('info', `Duplicated scenario placement "${placementId}" -> "${result.newPlacement.id}" (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Failed to duplicate scenario placement: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Step 9: Adds a new scenario object in memory. */
async function addScenarioPlacementFlow(
  kind: ScenarioObjectKind,
  paletteIndex: number,
  position: [number, number, number],
  rotation?: [number, number, number],
  teamIndex?: number,
): Promise<AddScenarioPlacementResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<AddScenarioPlacementResult>(
    { type: 'addScenarioPlacement', kind, paletteIndex, position, rotation, teamIndex },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog('info', `Added scenario placement "${result.newPlacement.id}" (${kind}) (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Failed to add scenario placement: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Step 9: Swaps a scenario object with another item in memory. */
async function swapScenarioPlacementFlow(
  placementId: string,
  newKind: ScenarioObjectKind,
  newPaletteIndex: number,
): Promise<SwapScenarioPlacementResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<SwapScenarioPlacementResult>(
    { type: 'swapScenarioPlacement', placementId, newKind, newPaletteIndex },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog('info', `Swapped scenario placement "${placementId}" -> "${result.newPlacement.id}" (${newKind}) (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Failed to swap scenario placement: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Step 9: Deletes a scenario object in memory. */
async function deleteScenarioPlacementFlow(placementId: string): Promise<DeleteScenarioPlacementResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<DeleteScenarioPlacementResult>(
    { type: 'deleteScenarioPlacement', placementId },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog('info', `Deleted scenario placement "${placementId}" (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Failed to delete scenario placement: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Milestone 9: Reverse dependency lookup ("Referencing Tags"). */
async function getReferencingTagsFlow(tagIndex: number): Promise<GetReferencingTagsResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const { promise } = sendWorkerRequest<GetReferencingTagsResult>(
    { type: 'getReferencingTags', tagIndex },
    sendLog,
  );
  return promise;
}

/** Milestone 9: Reads unicode strings from a ustr tag. */
async function getUnicodeStringsFlow(tagIndex: number): Promise<GetUnicodeStringsResult> {
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  }
  const { promise } = sendWorkerRequest<GetUnicodeStringsResult>(
    { type: 'getUnicodeStrings', tagIndex },
    sendLog,
  );
  return promise;
}

/** Milestone 9: In-place edit of a unicode string in a ustr tag. */
async function setUnicodeStringFlow(tagIndex: number, stringIndex: number, newText: string): Promise<SetUnicodeStringResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<SetUnicodeStringResult>(
    { type: 'setUnicodeString', tagIndex, stringIndex, newText },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog('info', `Edited unicode string #${stringIndex} in tag #${tagIndex} (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Failed to edit unicode string: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Milestone 9: Rename a tag path in the open map. */
async function renameTagFlow(tagIndex: number, newPath: string): Promise<RenameTagResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<RenameTagResult>(
    { type: 'renameTag', tagIndex, newPath },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog('info', `Renamed tag #${tagIndex} to "${result.path}" (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Failed to rename tag: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Milestone 9: Duplicate a tag in the open map tag index. */
async function duplicateTagFlow(tagIndex: number, newPath: string): Promise<DuplicateTagResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<DuplicateTagResult>(
    { type: 'duplicateTag', tagIndex, newPath },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog('info', `Duplicated tag #${tagIndex} -> tag #${result.newTagIndex} ("${result.path}") (in memory). Use File > Save to write changes.`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Failed to duplicate tag: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Delete a tag from the open map and scrub all incoming references to NULL_TAG_ID. */
async function deleteTagFlow(tagIndex: number): Promise<DeleteTagResult> {
  if (!currentMapPath) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (currentMapCompressed) return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };

  const { promise } = sendWorkerRequest<DeleteTagResult>(
    { type: 'deleteTag', tagIndex },
    sendLog,
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog(
        'info',
        `Deleted tag #${tagIndex} "${result.deletedPath}" (${result.deletedGroup}) and scrubbed ${result.scrubbedReferencesCount} incoming reference(s) to NULL_TAG_ID (in memory). Use File > Save to write changes.`,
      );
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Failed to delete tag: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

async function pickBspSourceMapFlow(): Promise<{ path: string | null }> {
  if (!mainWindow) return { path: null };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Source Map for BSP Swap',
    filters: [
      { name: 'Halo Map Files (*.map)', extensions: ['map'] },
      { name: 'All Files (*.*)', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { path: null };
  return { path: filePaths[0] };
}

function detectSourceMapEdition(filePath: string): HaloBitmapVersion {
  const fpLower = (filePath || '').toLowerCase();
  let buf = Buffer.alloc(2048);
  try {
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 2048, 0);
    fs.closeSync(fd);
  } catch {
    return 'ce';
  }
  if (buf.length < 2048) return 'ce';
  const engine = buf.readUInt32LE(0x4);
  if (engine === CacheFileEngine.MCC_CEA || fpLower.includes('mcc')) return 'mcc';
  if (fpLower.includes('halomd')) return 'halomd';
  if (engine === CacheFileEngine.RETAIL) return fpLower.includes('halomd') ? 'halomd' : 'pc';
  try {
    const layout = classifyMapLayout(buf);
    if (layout.kind === 'demo') return 'demo';
    if (layout.kind === 'mcc') return 'mcc';
    if (layout.kind === 'retail') return fpLower.includes('halomd') ? 'halomd' : 'pc';
  } catch {}
  return 'ce';
}

const EDITION_DISPLAY_NAMES: Record<HaloBitmapVersion, string> = {
  pc: 'Halo PC Retail (v7)',
  ce: 'Halo Custom Edition (v609)',
  demo: 'Halo Mac Demo (v6)',
  halomd: 'HaloMD (v7)',
  mcc: 'Halo MCC (CEA)',
  xbox: 'Halo Xbox Retail (v5)',
};

function isResourceMapCompatibleWithEdition(
  filePath: string | null | undefined,
  edition: HaloBitmapVersion,
  kind: 'bitmaps' | 'sounds',
): boolean {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const stat = fs.statSync(filePath);
    if (kind === 'bitmaps') {
      // Custom Edition bitmaps.map is ~123 MB (1706 entries); PC/HaloMD bitmaps.map is ~317 MB (4099 entries)
      if (edition === 'ce' && stat.size > 240 * 1024 * 1024) return false;
      if ((edition === 'pc' || edition === 'halomd') && stat.size < 240 * 1024 * 1024) return false;
    } else if (kind === 'sounds') {
      // Custom Edition sounds.map is ~41 MB (752 entries); PC/HaloMD sounds.map is ~218 MB (11102 entries)
      if (edition === 'ce' && stat.size > 120 * 1024 * 1024) return false;
      if ((edition === 'pc' || edition === 'halomd') && stat.size < 120 * 1024 * 1024) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveResourceMapsForSource(sourceFilePath: string, options?: BspSwapOptions): {
  edition: HaloBitmapVersion;
  editionName: string;
  bitmapsPath: string | null;
  soundsPath: string | null;
  resourceMapPaths: Partial<Record<ResourceMapKind, string>>;
} {
  const edition = detectSourceMapEdition(sourceFilePath);
  const editionName = EDITION_DISPLAY_NAMES[edition] || edition.toUpperCase();
  const settings = getSettings();
  const defaults = detectDefaultResourceMapPathsFlow();

  let bitmapsPath: string | null = options?.customBitmapsPath || null;
  let soundsPath: string | null = options?.customSoundsPath || null;

  // 1. Check user configured versionResourceMaps
  if (!bitmapsPath) {
    const userVer = settings.versionResourceMaps?.[edition];
    if (isResourceMapCompatibleWithEdition(userVer?.bitmaps, edition, 'bitmaps')) {
      bitmapsPath = userVer!.bitmaps!;
    }
  }
  if (!soundsPath) {
    const userVer = settings.versionResourceMaps?.[edition];
    if (isResourceMapCompatibleWithEdition(userVer?.sounds, edition, 'sounds')) {
      soundsPath = userVer!.sounds!;
    }
  }

  // 2. If CE, check general resourceMaps (only if actually a CE resource map!)
  if (edition === 'ce') {
    if (!bitmapsPath && isResourceMapCompatibleWithEdition(settings.resourceMaps.bitmaps, 'ce', 'bitmaps')) {
      bitmapsPath = settings.resourceMaps.bitmaps;
    }
    if (!soundsPath && isResourceMapCompatibleWithEdition(settings.resourceMaps.sounds, 'ce', 'sounds')) {
      soundsPath = settings.resourceMaps.sounds;
    }
  }

  // 3. Check alongside sourceFilePath (only if compatible with sourceFilePath's edition!)
  const donorDir = path.dirname(sourceFilePath);
  if (!bitmapsPath) {
    const localBmp = path.join(donorDir, 'bitmaps.map');
    if (isResourceMapCompatibleWithEdition(localBmp, edition, 'bitmaps')) bitmapsPath = localBmp;
  }
  if (!soundsPath) {
    const localSnd = path.join(donorDir, 'sounds.map');
    if (isResourceMapCompatibleWithEdition(localSnd, edition, 'sounds')) soundsPath = localSnd;
  }

  // 4. Check detectDefaultResourceMapPathsFlow
  if (!bitmapsPath && isResourceMapCompatibleWithEdition(defaults[edition], edition, 'bitmaps')) {
    bitmapsPath = defaults[edition];
  }
  // If PC edition and still not found, check HaloMD (uses identical PC bitmaps format)
  if (!bitmapsPath && edition === 'pc' && isResourceMapCompatibleWithEdition(defaults.halomd, 'pc', 'bitmaps')) {
    bitmapsPath = defaults.halomd;
  }
  if (!soundsPath && bitmapsPath) {
    const siblingSnd = path.join(path.dirname(bitmapsPath), 'sounds.map');
    if (isResourceMapCompatibleWithEdition(siblingSnd, edition, 'sounds')) soundsPath = siblingSnd;
  }
  if (!soundsPath && edition === 'pc') {
    const pcSoundsCandidates = [
      ...getSearchRoots().map((r) => path.join(r, 'sample_maps/PC/sounds.map')),
      'C:\\Users\\LeviB\\Projects\\OpenCE-Forge\\FORGE CODE\\GAME MAPS\\PC MAPS\\sounds.map',
      'C:\\Users\\LeviB\\Desktop\\Halo CE Related\\Halo CE\\MAPS\\sounds.map',
    ];
    for (const p of pcSoundsCandidates) {
      if (isResourceMapCompatibleWithEdition(p, 'pc', 'sounds')) { soundsPath = p; break; }
    }
  }

  // 5. Fallback for MCC sounds: MCC often shares sounds with CE
  if (edition === 'mcc' && !soundsPath) {
    const ceSounds = settings.versionResourceMaps?.ce?.sounds || settings.resourceMaps.sounds;
    if (ceSounds && fs.existsSync(ceSounds)) {
      soundsPath = ceSounds;
    }
  }

  const resourceMapPaths: Partial<Record<ResourceMapKind, string>> = {};
  if (bitmapsPath) resourceMapPaths.bitmaps = bitmapsPath;
  if (soundsPath) resourceMapPaths.sounds = soundsPath;

  return { edition, editionName, bitmapsPath, soundsPath, resourceMapPaths };
}

/** Milestone 10.2: Extracts 3D Structure BSP render mesh from an external source map. */
async function getSourceBspMeshFlow(sourceFilePath: string, bspIndex?: number): Promise<GetBspRenderMeshResult> {
  const { promise } = sendWorkerRequest<GetBspRenderMeshResult>(
    { type: 'getSourceBspMesh', sourceFilePath, bspIndex },
    sendLog,
  );
  return promise;
}

async function bspSwapPreflightFlow(
  sourceFilePath: string,
  sourceBspIndex?: number,
  targetBspIndex?: number,
  sourceBspIndices?: number[],
): Promise<BspSwapPreflightResult> {
  const resolved = resolveResourceMapsForSource(sourceFilePath);
  const { promise } = sendWorkerRequest<BspSwapPreflightResult>(
    { type: 'bspSwapPreflight', sourceFilePath, sourceBspIndex, targetBspIndex, sourceBspIndices },
    sendLog,
  );
  const res = await promise;
  return {
    ...res,
    sourceEdition: resolved.edition,
    sourceEditionName: resolved.editionName,
    sourceBitmapsPath: resolved.bitmapsPath,
    sourceSoundsPath: resolved.soundsPath,
  };
}

async function performBspSwapFlow(sourceFilePath: string, options: BspSwapOptions): Promise<BspSwapResult> {
  const resolved = resolveResourceMapsForSource(sourceFilePath, options);
  const resourceMapPaths = resolved.resourceMapPaths;
  const { promise } = sendWorkerRequest<BspSwapResult & { map?: OpenMapSummary }>(
    { type: 'performBspSwap', sourceFilePath, options, resourceMapPaths },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'performBspSwap', stage, percent }),
  );
  try {
    const result = await promise;
    if (result.ok && result.map) {
      setOpenMapState(result.map);
      sendLog('info', `Successfully swapped BSP: "${result.summary.sourceBspName}" into "${result.summary.targetBspName}"!`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `BSP swap failed: ${e.message}`);
    return {
      ok: false,
      buffer: Buffer.alloc(0),
      summary: { sourceBspName: '', targetBspName: '', oldSize: 0, newSize: 0, delta: 0, strippedDobc: false, strippedDecals: false, relocatedSpawns: 0 },
      error: e.message,
    };
  }
}

/** Main-process side of File > Save (native menu, renderer IPC, unsaved-changes prompt). Logic lives in save-map.ts. */
const saveMapDeps: SaveMapDeps = {
  getOpenMap: () =>
    mainWindow && currentMapPath
      ? { filePath: currentMapPath, compressed: currentMapCompressed, modified: currentMapModified, backedUp: currentMapBackedUp, overwriteConfirmed }
      : null,
  confirmOverwriteWithoutBackup: async (filePath) => {
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Overwrite', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: `Overwrite ${path.basename(filePath)} without a backup?`,
      detail: 'You skipped the backup copy when you opened this map, so the current file cannot be restored afterwards. Use File > Save As to keep it.',
    });
    return response === 0;
  },
  markOverwriteConfirmed: () => {
    overwriteConfirmed = true;
  },
  confirmScenarioName,
  showError: showErrorBox,
  runWorkerSave: () =>
    sendWorkerRequest<SaveMapResult>({ type: 'saveMap' }, sendLog, (stage, percent) => mainWindow?.webContents.send('map:progress', { taskId: 'saveMap', stage, percent })).promise,
  log: sendLog,
};

async function runSaveMap(): Promise<SaveMapResult> {
  const result = await saveMapFlow(saveMapDeps);
  if (result.ok) setOpenMapState(result.map);
  return result;
}

/** After Save As the new file is the open map; Save on it overwrites only it, so no backup prompt is needed for it. */
function afterSaveAs(result: SaveMapAsResult) {
  if (!result.ok) return;
  addRecentMap(result.outputPath);
  currentMapBackedUp = true;
  overwriteConfirmed = false;
  setOpenMapState(result.map);
}

async function runSaveMapAs(): Promise<SaveMapAsResult> {
  const result = await saveMapAsFlow(saveMapAsDeps);
  afterSaveAs(result);
  return result;
}

/** File > Discard Changes: asks, then reopens the open file from disk (no new backup prompt). null = cancelled. */
async function discardChangesFlow(): Promise<DiscardChangesResult | null> {
  if (!mainWindow || !currentMapPath || !currentMapModified) return null;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Discard changes', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: `Discard all unsaved changes to ${path.basename(currentMapPath)}?`,
    detail: 'The map is reopened from the file on disk. Injected tags that were not saved are lost.',
  });
  if (response !== 0) return null;
  const backedUp = currentMapBackedUp;
  const confirmed = overwriteConfirmed;
  const filePath = currentMapPath;
  const map = await loadMapAtPath(filePath, { askBackup: false });
  currentMapBackedUp = backedUp;
  overwriteConfirmed = confirmed;
  sendLog('info', `Discarded unsaved changes; reopened ${filePath} from disk.`);
  return { ok: true, map };
}

/** Main-process side of File > Save As (native menu and the renderer's `saveMapAs` IPC). Logic lives in save-map-as.ts. */
const saveMapAsDeps: SaveMapAsDeps = {
  getOpenMap: () => (mainWindow && currentMapPath ? { filePath: currentMapPath, compressed: currentMapCompressed } : null),
  showSaveDialog: async (defaultPath) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save map as',
      defaultPath,
      filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
    });
    return canceled || !filePath ? null : filePath;
  },
  confirmOverwrite: async (filePath) => {
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Overwrite', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `"${path.basename(filePath)}" already exists.`,
      detail: 'Do you want to overwrite it?',
    });
    return response === 0;
  },
  confirmScenarioName,
  showError: showErrorBox,
  runWorkerSave: (outputPath) =>
    sendWorkerRequest<SaveMapAsResult>({ type: 'saveMapAs', outputPath }, sendLog, (stage, percent) =>
      mainWindow?.webContents.send('map:progress', { taskId: 'saveMapAs', stage, percent }),
    ).promise,
  log: sendLog,
};

/** Native File > Save As is enabled only while a decompressed map is open (same rule as the renderer menu). */
function canSaveMapAs(): boolean {
  return !!currentMapPath && !currentMapCompressed;
}

/** File > Save: only with unsaved changes, and never for a map opened from a .bak (Save As only). */
function canSaveMap(): boolean {
  return canSaveMapAs() && currentMapModified && !isBackupFilePath(currentMapPath!);
}

/** Source-game bitmap/sound map picker for Convert (no settings persistence). Returns the selected file path; null on cancel. */
function pickConvertResourceFlow(kind: 'bitmaps' | 'sounds' | 'loc'): Promise<{ path: string } | null> {
  if (!mainWindow) return Promise.resolve(null);
  const title = kind === 'bitmaps' ? "Choose the source game's bitmaps.map" : "Choose the source game's sounds.map";
  return dialog.showOpenDialog(mainWindow, {
    title,
    filters: [{ name: 'Halo map', extensions: ['map'] }],
    properties: ['openFile'],
  }).then(({ canceled, filePaths }) => (canceled || filePaths.length === 0 ? null : { path: filePaths[0] }));
}

/** Convert to Custom Edition, step 1: picks the source ('open' = the map in the unsupported banner) and runs the read-only pre-flight. */
async function convertPreflightFlow(source: unknown, resourcePaths?: ConvertResourcePaths): Promise<ConvertPreflightResult | null> {
  if (!mainWindow) return { ok: false, code: 'NO_WINDOW', message: 'Application window is not available.' };
  let sourcePath: string | null;
  if (source === 'open') {
    sourcePath = lastConvertiblePath;
    if (!sourcePath) return { ok: false, code: 'NO_SOURCE', message: 'No convertible map is open. Use File > Convert to Custom Edition... to choose one.' };
  } else {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Convert to Custom Edition: choose a retail-layout (HaloMD) map',
      filters: [{ name: 'Halo map', extensions: ['map'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    sourcePath = filePaths[0];
  }
  convertSourcePath = sourcePath;
  sendLog('info', `Checking ${sourcePath} for conversion to Custom Edition...`);
  const { promise } = sendWorkerRequest<ConvertPreflightResult>({ type: 'convertPreflight', filePath: sourcePath, bitmapsPath: resourcePaths?.bitmaps, soundsPath: resourcePaths?.sounds }, sendLog, (stage, percent) =>
    mainWindow?.webContents.send('map:progress', { taskId: 'convertPreflight', stage, percent }),
  );
  try {
    const result = await promise;
    if (result.ok) {
      const counts = (s: string) => result.report.checks.filter((c) => c.status === s).length;
      sendLog(result.report.canConvert ? 'info' : 'warn', `${result.sourceFileName}: ${result.report.canConvert ? 'can be converted' : 'cannot be converted'} (${counts('refuse')} refused, ${counts('warn')} warning(s)).`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Convert check failed: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

const convertMapDeps: ConvertMapDeps = {
  getSourcePath: () => convertSourcePath,
  getOpenMapPath: () => currentMapPath,
  confirmUnsavedChanges: () => confirmUnsavedChanges(unsavedChangesDeps),
  showSaveDialog: async (defaultPath) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save converted Custom Edition map as',
      defaultPath,
      filters: [{ name: 'Halo CE Map', extensions: ['map'] }],
    });
    return canceled || !filePath ? null : filePath;
  },
  confirmOverwrite: saveMapAsDeps.confirmOverwrite,
  confirmScenarioName,
  showError: showErrorBox,
  runWorkerConvert: (sourcePath, outputPath, acknowledgeScripts, repairs, resourcePaths) =>
    sendWorkerRequest<ConvertMapResult>({ type: 'convertMap', sourcePath, outputPath, acknowledgeScripts, repairs, bitmapsPath: resourcePaths?.bitmaps, soundsPath: resourcePaths?.sounds }, sendLog, (stage, percent) =>
      mainWindow?.webContents.send('map:progress', { taskId: 'convertMap', stage, percent }),
    ).promise,
  log: sendLog,
};

/** Convert to Custom Edition, step 2. The output (a new file) becomes the open map; the source is never written. */
async function runConvertMap(acknowledgeScripts: unknown, repairs: unknown, resourcePaths?: unknown): Promise<ConvertMapResult> {
  const rp = resourcePaths && typeof resourcePaths === 'object' ? (resourcePaths as ConvertResourcePaths) : undefined;
  const result = await convertMapFlow(convertMapDeps, acknowledgeScripts === true, sanitizeRepairChoice(repairs), rp);
  if (result.ok) {
    addRecentMap(result.outputPath);
    currentMapPath = result.outputPath;
    currentMapCompressed = false;
    currentMapScenarioName = result.scenarioName;
    currentMapModified = false;
    // A new file nothing else depends on: File > Save on it overwrites only it (same rule as after Save As).
    currentMapBackedUp = true;
    overwriteConfirmed = false;
    lastConvertiblePath = null;
    convertSourcePath = null;
    buildMenu();
    updateTitle();
    mainWindow?.webContents.send('map:loaded', result.map);
  }
  return result;
}

async function verifyEmbeddedDataFlow(): Promise<VerifyEmbeddedDataResult> {
  if (!currentMapPath || currentMapCompressed) return { ok: false, code: 'NO_MAP_LOADED', message: 'Open and decompress a map before verifying embedded data.' };
  sendLog('info', 'Verifying embedded bitmap/sound data...');
  const { promise } = sendWorkerRequest<VerifyEmbeddedDataResult>({ type: 'verifyEmbeddedData' }, sendLog, (stage, percent) =>
    mainWindow?.webContents.send('map:progress', { taskId: 'verifyEmbeddedData', stage, percent }),
  );
  try {
    const result = await promise;
    if (result.ok) sendLog('info', `Embedded data check: ${result.counts.embedded} embedded, ${result.counts.external} external, ${result.counts.blockedTags} blocked.`);
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    sendLog('error', `Embedded data check failed: ${e.message}`);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

function getAppDisplayVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.displayVersion === 'string' && pkg.displayVersion.trim()) {
        return pkg.displayVersion.trim();
      }
      if (typeof pkg.version === 'string' && pkg.version.trim()) {
        return pkg.version.trim();
      }
    }
  } catch {
    // fallback to electron app.getVersion()
  }
  return app.getVersion();
}

function showAboutDialog() {
  if (!mainWindow) return;
  const pngIcon = path.join(__dirname, '../build/icon.png');
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About',
    icon: fs.existsSync(pngIcon) ? pngIcon : undefined,
    message: `OpenCE Mantle v${getAppDisplayVersion()}`,
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
        { label: 'Open Standard Blam tags/ Workspace...', click: () => mainWindow?.webContents.send('menu:action', 'open-loose-tags-workspace') },
        { id: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S', enabled: canSaveMap(), click: () => void runSaveMap() },
        { id: 'save-as', label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', enabled: canSaveMapAs(), click: () => void runSaveMapAs() },
        {
          id: 'discard',
          label: 'Discard Changes...',
          enabled: currentMapModified,
          click: () => void discardChangesFlow().then((r) => r?.ok && mainWindow?.webContents.send('map:loaded', r.map)),
        },
        {
          label: 'Recent Maps',
          submenu:
            recents.length > 0
              ? recents.map((p) => ({ label: p, click: () => openMapGuarded(p).then((r) => r && mainWindow?.webContents.send('map:loaded', r)) }))
              : [{ label: '(none yet)', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Convert to Custom Edition...', click: () => mainWindow?.webContents.send('menu:action', 'convert-map') },
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
        { label: 'Extract to OpenCE Forge...', click: () => mainWindow?.webContents.send('menu:action', 'extract-to-forge') },
        { label: 'Build New Object Tag...', click: () => mainWindow?.webContents.send('menu:action', 'build-object-tag') },
        { label: 'Extract Tags...', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('menu:action', 'extract-tags') },
        { label: 'Extract Whole Map...', click: () => mainWindow?.webContents.send('menu:action', 'extract-whole-map') },
        { label: 'Inject Tags...', click: () => mainWindow?.webContents.send('menu:action', 'inject-tags') },
        { label: 'Verify Embedded Data...', click: () => mainWindow?.webContents.send('menu:action', 'verify-embedded-data') },
        { label: 'Swap BSP...', click: () => mainWindow?.webContents.send('menu:action', 'swap-bsp') },
        { label: 'Compare With Another .map File...', click: () => mainWindow?.webContents.send('menu:action', 'compare-maps') },
        { type: 'separator' },
        { label: 'Live HUD Editing & Weapon Tag Editor...', click: () => mainWindow?.webContents.send('menu:action', 'live-hud-editor') },
        { label: 'Inject / Replace HUD Bitmap...', click: () => mainWindow?.webContents.send('menu:action', 'hud-bitmap-injector') },
        { label: 'UI.map Menu (DeLa) & String (ustr) Studio...', click: () => mainWindow?.webContents.send('menu:action', 'ui-map-studio') },
        { label: 'Content Explorer & Dependency Auto-Fix...', click: () => mainWindow?.webContents.send('menu:action', 'content-explorer') },
        { label: 'Visual tool.exe Command Runner...', click: () => mainWindow?.webContents.send('menu:action', 'tool-command-runner') },
        { label: 'Bitmap & 3D Model Library Browser...', click: () => mainWindow?.webContents.send('menu:action', 'asset-library-browser') },
        { type: 'separator' },
        {
          label: 'Identify Resource Maps',
          submenu: [
            { label: 'HaloMD...', click: () => mainWindow?.webContents.send('menu:action', 'identify-bitmaps:halomd') },
            { label: 'Custom Edition...', click: () => mainWindow?.webContents.send('menu:action', 'identify-bitmaps:ce') },
            { label: 'Halo PC...', click: () => mainWindow?.webContents.send('menu:action', 'identify-bitmaps:pc') },
            { label: 'Halo Mac Demo...', click: () => mainWindow?.webContents.send('menu:action', 'identify-bitmaps:demo') },
            { label: 'Halo MCC...', click: () => mainWindow?.webContents.send('menu:action', 'identify-bitmaps:mcc') },
          ],
        },
        { type: 'separator' },
        { label: 'Settings...', click: () => mainWindow?.webContents.send('menu:action', 'settings') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates...',
          click: () => mainWindow?.webContents.send('menu:action', 'check-for-updates'),
        },
        { type: 'separator' },
        {
          label: 'About OpenCE Mantle',
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
  mainWindow?.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  // Started eagerly so the "worker loaded, definitions loaded" self-check is visible at launch.
  startWorker(sendLog);

  ipcMain.handle('dialog:openMap', () => openMapDialogFlow());
  ipcMain.handle('map:load', (_e, filePath: string) => openMapGuarded(filePath));
  ipcMain.handle('map:decompress', () => decompressFlow());
  ipcMain.handle('map:recompress', () => recompressFlow());
  ipcMain.handle('deps:get', (_e, originalIndices: unknown) => getDependenciesFlow(originalIndices));
  ipcMain.handle('tags:extract', (_e, request: ExtractTagsRequest) => extractTagsFlow(request));
  ipcMain.on('tags:cancelExtract', () => {
    if (currentExtractRequestId) cancelWorkerRequest(currentExtractRequestId, sendLog);
  });
  ipcMain.handle('tags:batchExtractPreflight', () => batchExtractPreflightFlow());
  ipcMain.handle('tags:startBatchExtract', (_e, options: { parentDir: string; mode: BatchExtractMode }) => startBatchExtractFlow(options));
  ipcMain.on('tags:cancelBatchExtract', () => cancelBatchExtractFlow());
  ipcMain.handle('tags:finalizeBatchExtract', (_e, request: FinalizeBatchExtractRequest) => finalizeBatchExtractFlow(request));
  ipcMain.handle('resourceMaps:pick', (_e, kind: ResourceMapKind) => pickResourceMapFlow(kind));
  ipcMain.handle('resourceMaps:getStatuses', () => getResourceMapStatusesFlow());
  ipcMain.handle('resourceMaps:identify', (_e, filePath: string, expectedVersion?: HaloBitmapVersion, expectedKind?: 'bitmaps' | 'sounds') =>
    identifyResourceMapFlow(filePath, expectedVersion, expectedKind),
  );
  ipcMain.handle('resourceMaps:setPath', (_e, kind: ResourceMapKind, filePath: string) => {
    setResourceMapPath(kind, filePath);
    return { ok: true };
  });
  ipcMain.handle('resourceMaps:detectDefaultPaths', () => detectDefaultResourceMapPathsFlow());
  ipcMain.handle('resourceMaps:getVersionSettings', () => getSettings().versionResourceMaps ?? {});
  ipcMain.handle(
    'resourceMaps:setVersionSettings',
    (_e, version: HaloBitmapVersion, maps: { bitmaps?: string | null; sounds?: string | null; loc?: string | null }) => {
      setVersionResourceMaps(version, maps);
      if (currentOpenMapSummary) {
        const curEdition =
          currentOpenMapSummary.header.mapEdition ?? (currentOpenMapSummary.header.engine === 7 ? 'pc' : 'ce');
        if (curEdition === version) {
          if (maps.bitmaps !== undefined) setResourceMapPath('bitmaps', maps.bitmaps);
          if (maps.sounds !== undefined) setResourceMapPath('sounds', maps.sounds);
          if (maps.loc !== undefined) setResourceMapPath('loc', maps.loc);
        }
      }
      return { ok: true };
    },
  );
  ipcMain.handle('tags:pickInjectContainer', () => pickInjectContainerFlow());
  ipcMain.handle('tags:planInject', (_e, containerPath: string, mode: InjectionMode) => planInjectFlow(containerPath, mode));
  ipcMain.handle('tags:applyInject', () => applyInjectFlow());
  ipcMain.handle('tags:verifyEmbeddedData', () => verifyEmbeddedDataFlow());
  ipcMain.handle('tags:getFields', (_e, tagIndex: number) => getTagFieldsFlow(tagIndex));
  ipcMain.handle('tags:updateField', (_e, tagIndex: number, fieldName: string, newValue: unknown) => updateTagFieldFlow(tagIndex, fieldName, newValue));
  ipcMain.handle('tags:addReflexiveChunk', (_e, tagIndex: number, reflexiveFieldPath: string, cloneFromIndex?: number) =>
    addReflexiveChunkFlow(tagIndex, reflexiveFieldPath, cloneFromIndex),
  );
  ipcMain.handle('tags:getDependencySlots', (_e, tagIndex: number) => getDependencySlotsFlow(tagIndex));
  ipcMain.handle('tags:setDependencySlot', (_e, tagIndex: number, fieldPath: string, newTagId: number | null) => setDependencySlotFlow(tagIndex, fieldPath, newTagId));
  ipcMain.handle('tags:getReferencingTags', (_e, tagIndex: number) => getReferencingTagsFlow(tagIndex));
  ipcMain.handle('tags:getUnicodeStrings', (_e, tagIndex: number) => getUnicodeStringsFlow(tagIndex));
  ipcMain.handle('tags:setUnicodeString', (_e, tagIndex: number, stringIndex: number, newText: string) => setUnicodeStringFlow(tagIndex, stringIndex, newText));
  ipcMain.handle('tags:renameTag', (_e, tagIndex: number, newPath: string) => renameTagFlow(tagIndex, newPath));
  ipcMain.handle('tags:duplicateTag', (_e, tagIndex: number, newPath: string) => duplicateTagFlow(tagIndex, newPath));
  ipcMain.handle('tags:deleteTag', (_e, tagIndex: number) => deleteTagFlow(tagIndex));
  ipcMain.handle('dialog:pickBspSourceMap', () => pickBspSourceMapFlow());
  ipcMain.handle('dialog:pickBspResource', async (_e, kind: 'bitmaps' | 'sounds') => {
    if (!mainWindow) return { path: null };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: `Select ${kind === 'bitmaps' ? 'bitmaps.map' : 'sounds.map'} for Donor Map`,
      filters: [{ name: 'Halo Resource Map', extensions: ['map'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { path: null };
    return { path: filePaths[0] };
  });
  ipcMain.handle('bsp:swapPreflight', (_e, sourceFilePath: string, sourceBspIndex?: number, targetBspIndex?: number, sourceBspIndices?: number[]) =>
    bspSwapPreflightFlow(sourceFilePath, sourceBspIndex, targetBspIndex, sourceBspIndices),
  );
  ipcMain.handle('bsp:getSourceMesh', (_e, sourceFilePath: string, bspIndex?: number) =>
    getSourceBspMeshFlow(sourceFilePath, bspIndex),
  );
  ipcMain.handle('bsp:performSwap', (_e, sourceFilePath: string, options: BspSwapOptions) =>
    performBspSwapFlow(sourceFilePath, options),
  );
  ipcMain.handle('render:getBspMesh', (_e, bspIndex?: number) => getBspRenderMeshFlow(bspIndex));
  ipcMain.handle('render:getBitmapTexture', (_e, bitmapTagId: number, imageIndex?: number) => getBitmapTextureFlow(bitmapTagId, imageIndex));
  ipcMain.handle('render:getScenarioObjects', () => getScenarioObjectsFlow());
  ipcMain.handle('render:getModelGeometry', (_e, modelTagId: number, lod?: number) => getModelGeometryFlow(modelTagId, lod));
  ipcMain.handle('render:updateScenarioPlacement', (_e, placementId: string, updates: any) => updateScenarioPlacementFlow(placementId, updates));
  ipcMain.handle('render:duplicateScenarioPlacement', (_e, placementId: string, offsetDelta?: [number, number, number]) => duplicateScenarioPlacementFlow(placementId, offsetDelta));
  ipcMain.handle('render:addScenarioPlacement', (_e, kind: ScenarioObjectKind, paletteIndex: number, position: [number, number, number], rotation?: [number, number, number], teamIndex?: number) =>
    addScenarioPlacementFlow(kind, paletteIndex, position, rotation, teamIndex),
  );
  ipcMain.handle('render:swapScenarioPlacement', (_e, placementId: string, newKind: ScenarioObjectKind, newPaletteIndex: number) =>
    swapScenarioPlacementFlow(placementId, newKind, newPaletteIndex),
  );
  ipcMain.handle('render:deleteScenarioPlacement', (_e, placementId: string) => deleteScenarioPlacementFlow(placementId));
  ipcMain.handle('bitmap:getInfo', (_e, tagIndex: number) => getBitmapInfoFlow(tagIndex));
  ipcMain.handle('bitmap:getRgba', (_e, tagIndex: number, imageIndex: number) => getBitmapRgbaFlow(tagIndex, imageIndex));
  ipcMain.handle('dialog:pickExportBitmapPath', (_e, defaultName: string, format: 'png' | 'dds') => pickExportBitmapPathFlow(defaultName, format));
  ipcMain.handle('bitmap:export', (_e, tagIndex: number, imageIndex: number, format: 'png' | 'dds', outputPath: string) =>
    exportBitmapFlow(tagIndex, imageIndex, format, outputPath),
  );
  ipcMain.handle('dialog:pickImportBitmapPath', () => pickImportBitmapPathFlow());
  ipcMain.handle('bitmap:replace', (_e, tagIndex: number, imageIndex: number, inputPath: string, targetFormat?: number) =>
    replaceBitmapFlow(tagIndex, imageIndex, inputPath, targetFormat),
  );
  ipcMain.handle('sound:getInfo', (_e, tagIndex: number) => getSoundInfoFlow(tagIndex));
  ipcMain.handle('sound:getWav', (_e, tagIndex: number, pitchRangeIndex: number, permutationIndex: number) =>
    getSoundWavFlow(tagIndex, pitchRangeIndex, permutationIndex),
  );
  ipcMain.handle('dialog:pickExportSoundPath', (_e, defaultName: string) => pickExportSoundPathFlow(defaultName));
  ipcMain.handle('sound:export', (_e, tagIndex: number, pitchRangeIndex: number, permutationIndex: number, outputPath: string) =>
    exportSoundFlow(tagIndex, pitchRangeIndex, permutationIndex, outputPath),
  );
  ipcMain.handle('dialog:pickImportSoundPath', () => pickImportSoundPathFlow());
  ipcMain.handle('sound:replace', (_e, tagIndex: number, pitchRangeIndex: number, permutationIndex: number, inputPath: string, targetFormat?: number) =>
    replaceSoundFlow(tagIndex, pitchRangeIndex, permutationIndex, inputPath, targetFormat),
  );
  ipcMain.handle('dialog:pickExport3dPath', (_e, defaultName: string, format: 'obj' | 'glb') => pickExport3dPathFlow(defaultName, format));
  ipcMain.handle('dialog:pickExportDirectory', () => pickExportDirectoryFlow());
  ipcMain.handle('dialog:pickObjFile', () => pickObjFileFlow());
  ipcMain.handle('collision:analyzeObj', (_e, filePath?: string, options?: { scale?: number; flipYz?: boolean; centerOrigin?: boolean; forceAutoUv?: boolean }) =>
    analyzeCollisionObjFlow(filePath, options),
  );
  ipcMain.handle('objectBuilder:exportUvTemplate', (_e, options: {
    objFilePath: string;
    size?: number;
    scale?: number;
    flipYz?: boolean;
    centerOrigin?: boolean;
    forceAutoUv?: boolean;
    previewOnly?: boolean;
  }) => exportUvTemplateFlow(options));
  ipcMain.handle('objectBuilder:pickSaveOceTagsPath', (_e, defaultName: string) => pickSaveOceTagsPathFlow(defaultName));
  ipcMain.handle('objectBuilder:build', (_e, request: BuildCustomObjectRequest) => buildCustomObjectTagFlow(request));
  ipcMain.handle('deprotect:inspect', async (): Promise<InspectDeprotectResult> => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, code: 'NO_MAP_LOADED', message: 'No uncompressed map is open.' };
    }
    try {
      const { promise } = sendWorkerRequest<InspectDeprotectResult>({ type: 'inspectDeprotect' }, sendLog);
      return await promise;
    } catch (err) {
      const e = err as Error & { code?: string };
      return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
    }
  });
  ipcMain.handle('deprotect:run', async (_e, options?: DeprotectMapOptions): Promise<DeprotectMapResult> => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, code: 'NO_MAP_LOADED', message: 'No uncompressed map is open.' };
    }
    try {
      const { promise } = sendWorkerRequest<DeprotectMapResult>({ type: 'deprotectMap', options }, sendLog);
      const res = await promise;
      if (res.ok) {
        setOpenMapState(res.map);
        mainWindow?.webContents.send('map:updated', res.map);
        sendLog(
          'info',
          `Deprotected map: ${res.classesRepaired} class(es), ${res.scriptPathsRecovered} script path(s), ${res.heuristicPathsRenamed} renamed, ${res.bitmapsRepaired} bitmap(s), ${res.modelPartsRepaired} model part(s) repaired.`,
        );
      }
      return res;
    } catch (err) {
      const e = err as Error & { code?: string };
      sendLog('error', `Deprotect failed: ${e.message}`);
      return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
    }
  });
  ipcMain.handle('deprotect:spoofCrc32', async (_e, targetCrc32: number): Promise<SpoofMapCrc32Result> => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, code: 'NO_MAP_LOADED', message: 'No uncompressed map is open.' };
    }
    try {
      const { promise } = sendWorkerRequest<SpoofMapCrc32Result>(
        { type: 'spoofMapCrc32', targetCrc32: Number(targetCrc32) >>> 0 },
        sendLog,
      );
      const res = await promise;
      if (res.ok) {
        setOpenMapState(res.map);
        mainWindow?.webContents.send('map:updated', res.map);
        sendLog(
          'info',
          `Spoofed map CRC32 to 0x${(res.crc32 >>> 0).toString(16).toUpperCase().padStart(8, '0')} (tagFileChecksums = 0x${(res.compensationWord >>> 0).toString(16).toUpperCase().padStart(8, '0')}).`,
        );
      }
      return res;
    } catch (err) {
      const e = err as Error & { code?: string };
      sendLog('error', `CRC32 spoof failed: ${e.message}`);
      return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
    }
  });
  ipcMain.handle('3d:exportModel', (_e, modelTagId: number, lod: number | undefined, format: 'obj' | 'glb', outputPath: string) =>
    exportModel3dFlow(modelTagId, lod, format, outputPath),
  );
  ipcMain.handle('3d:exportBsp', (_e, bspIndex: number, format: 'obj' | 'glb', outputPath: string) =>
    exportBsp3dFlow(bspIndex, format, outputPath),
  );
  ipcMain.handle('hs:decompile', async () => {
    if (!currentMapPath) return { ok: false, message: 'No map is open.' };
    const { promise } = sendWorkerRequest<{
      ok: true;
      hscSource: string;
      scriptCount: number;
      globalCount: number;
      syntaxNodeCount: number;
      scenarioEntities: {
        objectNames: string[];
        triggerVolumes: string[];
        cutsceneCameraPoints: string[];
        cutsceneFlags: string[];
        encounters: string[];
        recordedAnimations: string[];
      };
      scripts?: Array<{ name: string; scriptType: string; returnType: string; rootNodeIndex: number; bodySource: string }>;
      globals?: Array<{ name: string; type: string; initNodeIndex: number; valueSource: string }>;
    } | { ok: false; message: string }>({ type: 'decompileHaloScript' }, sendLog);
    return promise;
  });
  ipcMain.handle('hs:compile', async (_e, hscSource: string) => {
    if (!currentMapPath) return { ok: false, message: 'No map is open.' };
    if (currentMapCompressed) return { ok: false, message: COMPRESSED_MAP_MESSAGE };
    const { promise } = sendWorkerRequest<{
      ok: true;
      compiledScripts: number;
      compiledGlobals: number;
      syntaxNodesUsed: number;
      diagnostics: Array<{ line: number; severity: 'error' | 'warning'; message: string }>;
    } | { ok: false; message: string; diagnostics?: Array<{ line: number; severity: 'error' | 'warning'; message: string }> }>(
      { type: 'compileHaloScript', hscSource },
      sendLog,
    );
    const res = await promise;
    if (res.ok) {
      currentMapModified = true;
      sendLog('info', `Compiled ${res.compiledScripts} HaloScript(s) and ${res.compiledGlobals} global(s) into scenario (${res.syntaxNodesUsed} syntax nodes). Use File > Save to write changes.`);
    }
    return res;
  });
  ipcMain.handle(
    'hs:setupEntities',
    async (
      _e,
      required: { objectNames?: string[]; triggerVolumes?: string[]; cameraPoints?: string[] },
    ) => {
      if (!currentMapPath) return { ok: false, message: 'No map is open.' };
      if (currentMapCompressed) return { ok: false, message: COMPRESSED_MAP_MESSAGE };
      const { promise } = sendWorkerRequest<{
        ok: true;
        addedObjectNames: string[];
        addedTriggerVolumes: string[];
        addedCameraPoints: string[];
      } | { ok: false; message: string }>({ type: 'setupScenarioScriptEntities', required }, sendLog);
      const res = await promise;
      if (res.ok) {
        currentMapModified = true;
        sendLog(
          'info',
          `Auto-configured scenario script entities (+${res.addedObjectNames.length} object names, +${res.addedTriggerVolumes.length} trigger volumes, +${res.addedCameraPoints.length} camera points).`,
        );
      }
      return res;
    },
  );
  ipcMain.handle('coll:extractWireframe', async (_e, collTagIndex: number) => {
    if (!currentMapPath) return { ok: false, message: 'No map is open.' };
    const { promise } = sendWorkerRequest<{
      ok: true;
      tagIndex: number;
      tagPath: string;
      vertexCount: number;
      edgeCount: number;
      surfaceCount: number;
      linePositions: number[];
      objText: string;
    } | { ok: false; message: string }>({ type: 'extractCollisionWireframe', collTagIndex }, sendLog);
    return promise;
  });
  ipcMain.handle('convert:collToGbxmodel', async (_e, collTagIndex: number, targetPath?: string) => {
    if (!currentMapPath) return { ok: false, message: 'No map is open.' };
    if (currentMapCompressed) return { ok: false, message: COMPRESSED_MAP_MESSAGE };
    const { promise } = sendWorkerRequest<{
      ok: true;
      createdTagIndex: number;
      createdTagPath: string;
      createdTagGroup: string;
      summary: string;
      tags: OpenMapSummary['tags'];
    } | { ok: false; message: string }>({ type: 'convertCollisionToGbxmodel', collTagIndex, targetPath }, sendLog);
    const res = await promise;
    if (res.ok) {
      currentMapModified = true;
      sendLog('info', res.summary);
    }
    return res;
  });
  ipcMain.handle('convert:sbspToScenery', async (_e, bspTagIndex?: number, targetPath?: string) => {
    if (!currentMapPath) return { ok: false, message: 'No map is open.' };
    if (currentMapCompressed) return { ok: false, message: COMPRESSED_MAP_MESSAGE };
    const { promise } = sendWorkerRequest<{
      ok: true;
      createdTagIndex: number;
      createdTagPath: string;
      createdTagGroup: string;
      summary: string;
      tags: OpenMapSummary['tags'];
    } | { ok: false; message: string }>({ type: 'convertSbspToScenery', bspTagIndex, targetPath }, sendLog);
    const res = await promise;
    if (res.ok) {
      currentMapModified = true;
      sendLog('info', res.summary);
    }
    return res;
  });
  ipcMain.handle('convert:objectTagClass', async (_e, sourceTagIndex: number, targetGroup: string, targetPath?: string) => {
    if (!currentMapPath) return { ok: false, message: 'No map is open.' };
    if (currentMapCompressed) return { ok: false, message: COMPRESSED_MAP_MESSAGE };
    const { promise } = sendWorkerRequest<{
      ok: true;
      createdTagIndex: number;
      createdTagPath: string;
      createdTagGroup: string;
      summary: string;
      tags: OpenMapSummary['tags'];
    } | { ok: false; message: string }>(
      { type: 'convertObjectTagClass', sourceTagIndex, targetGroup, targetPath },
      sendLog,
    );
    const res = await promise;
    if (res.ok) {
      currentMapModified = true;
      sendLog('info', res.summary);
    }
    return res;
  });
  ipcMain.handle('map:cleanOpenSauceYelo', async () => {
    if (!currentMapPath) return { ok: false, message: 'No map is open.' };
    if (currentMapCompressed) return { ok: false, message: COMPRESSED_MAP_MESSAGE };
    const { promise } = sendWorkerRequest<{
      ok: true;
      cleanedReferences: number;
      details: string[];
    } | { ok: false; message: string }>({ type: 'cleanOpenSauceYelo' }, sendLog);
    const res = await promise;
    if (res.ok && res.cleanedReferences > 0) {
      currentMapModified = true;
      sendLog('info', `Cleaned ${res.cleanedReferences} OpenSauce (.yelo / .gelo) reference(s).`);
    }
    return res;
  });
  ipcMain.handle('map:scanTagErrors', async () => {
    if (!currentMapPath) return { ok: false, message: 'No map is open.' };
    const { promise } = sendWorkerRequest<{
      ok: true;
      totalTagsScanned: number;
      errorCount: number;
      warningCount: number;
      findings: Array<{
        tagIndex: number;
        tagId: number;
        tagPath: string;
        tagGroup: string;
        fieldPath: string;
        severity: 'error' | 'warning';
        message: string;
      }>;
    } | { ok: false; message: string }>({ type: 'scanMapTagErrors' }, sendLog);
    return promise;
  });
  ipcMain.handle('map:globalReplaceTagReference', async (_e, fromTagId: number, toTagId: number) => {
    if (!currentMapPath) return { ok: false, message: 'No map is open.' };
    if (currentMapCompressed) return { ok: false, message: COMPRESSED_MAP_MESSAGE };
    const { promise } = sendWorkerRequest<{
      ok: true;
      replacedCount: number;
      affectedTags: Array<{ tagIndex: number; tagPath: string; tagGroup: string; fieldPath: string }>;
    } | { ok: false; message: string }>({ type: 'globalReplaceTagReference', fromTagId, toTagId }, sendLog);
    const res = await promise;
    if (res.ok && res.replacedCount > 0) {
      currentMapModified = true;
      sendLog('info', `Globally replaced ${res.replacedCount} tag reference(s) across the map.`);
    }
    return res;
  });

  ipcMain.handle(
    'mod:exportOpenCeModFolder',
    async (
      _e,
      options: {
        rootTagIndices: number[];
        modName: string;
        version?: string;
        author?: string;
        description?: string;
        includeDependencies?: boolean;
        replaceTargetTagIndex?: number;
      },
    ) => {
      if (!currentMapPath) return { ok: false, message: 'No map is open.' };
      if (currentMapCompressed) return { ok: false, message: COMPRESSED_MAP_MESSAGE };
      if (!mainWindow) return { ok: false, message: 'Main window unavailable.' };
      const pick = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Output Parent Directory for OpenCE Mod Folder (creates <mod_name>/mod.toml + tags/...)',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (pick.canceled || !pick.filePaths[0]) {
        return { ok: false, message: 'Cancelled.' };
      }
      const parentOutputDir = pick.filePaths[0];
      const settings = getSettings();
      const { promise } = sendWorkerRequest<
        | {
            ok: true;
            outputDir: string;
            modFolderName: string;
            tagCount: number;
            writtenFiles: string[];
          }
        | { ok: false; message: string }
      >(
        {
          type: 'exportOpenCeModFolder',
          rootTagIndices: options.rootTagIndices,
          modName: options.modName,
          version: options.version,
          author: options.author,
          description: options.description,
          includeDependencies: options.includeDependencies ?? false,
          replaceTargetTagIndex: options.replaceTargetTagIndex,
          parentOutputDir,
          bitmapsPath: settings.resourceMaps.bitmaps ?? undefined,
          soundsPath: settings.resourceMaps.sounds ?? undefined,
          locPath: settings.resourceMaps.loc ?? undefined,
        },
        sendLog,
      );
      const res = await promise;
      if (res.ok) {
        sendLog(
          'info',
          `Exported OpenCE mod folder "${res.modFolderName}" (${res.tagCount} loose tag files + mod.toml) to ${res.outputDir}`,
        );
      }
      return res;
    },
  );

  ipcMain.handle(
    'mod:importLegacyTags',
    async (_e, sourceMode: 'file' | 'folder', injectMode: 'add' | 'swap' = 'add') => {
      if (!currentMapPath) return { ok: false, message: 'No map is open.' };
      if (currentMapCompressed) return { ok: false, message: COMPRESSED_MAP_MESSAGE };
      if (!mainWindow) return { ok: false, message: 'Main window unavailable.' };

      let sourcePathLabel = '';
      let inputPaths: string[] = [];

      if (sourceMode === 'folder') {
        const pick = await dialog.showOpenDialog(mainWindow, {
          title: 'Select Legacy Tag Folder (legacy_tags, sample_mods, or HMT Extract folder)',
          properties: ['openDirectory'],
        });
        if (pick.canceled || !pick.filePaths[0]) {
          return { ok: false, message: 'Cancelled.' };
        }
        sourcePathLabel = pick.filePaths[0];
        inputPaths = pick.filePaths;
      } else {
        const pick = await dialog.showOpenDialog(mainWindow, {
          title: 'Select Legacy Tag File(s) (HEK loose tags or HMT .meta / .xml files)',
          properties: ['openFile', 'multiSelections'],
        });
        if (pick.canceled || pick.filePaths.length === 0) {
          return { ok: false, message: 'Cancelled.' };
        }
        sourcePathLabel = pick.filePaths[0];
        inputPaths = pick.filePaths;
      }

      const settings = getSettings();
      const { promise } = sendWorkerRequest<
        | {
            ok: true;
            formatDetected: 'hek_loose' | 'hmt_meta_xml';
            addedCount: number;
            swappedCount: number;
            reusedCount: number;
            importedPaths: string[];
            warnings: string[];
            map: OpenMapSummary;
          }
        | { ok: false; message: string }
      >(
        {
          type: 'importLegacyTags',
          inputPaths,
          mode: injectMode,
          bitmapsPath: settings.resourceMaps.bitmaps ?? undefined,
          soundsPath: settings.resourceMaps.sounds ?? undefined,
          locPath: settings.resourceMaps.loc ?? undefined,
        },
        sendLog,
      );
      const res = await promise;
      if (res.ok) {
        setOpenMapState(res.map);
        mainWindow?.webContents.send('map:updated', res.map);
        sendLog(
          'info',
          `Imported legacy tags (${res.formatDetected}): +${res.addedCount} added, ${res.swappedCount} swapped, ${res.reusedCount} reused from ${sourcePathLabel}.`,
        );
        return { ...res, sourcePath: sourcePathLabel };
      }
      return res;
    },
  );

  ipcMain.handle(
    'bitmap:replaceFromDataUrl',
    async (_e, tagIndex: number, imageIndex: number, pngDataUrl: string, targetFormat?: number) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, code: 'NO_MAP_LOADED', message: 'No uncompressed map is open.' };
      }
      try {
        const base64 = pngDataUrl.replace(/^data:image\/\w+;base64,/, '');
        const pngBytes = new Uint8Array(Buffer.from(base64, 'base64'));
        const settings = getSettings();
        const { promise } = sendWorkerRequest< { ok: true; map: OpenMapSummary } | { ok: false; code: string; message: string } >(
          {
            type: 'replaceBitmapFromPngBytes',
            tagIndex,
            imageIndex,
            pngBytes,
            targetFormat,
            bitmapsPath: settings.resourceMaps.bitmaps ?? undefined,
          },
          sendLog,
        );
        const res = await promise;
        if (res.ok) {
          setOpenMapState(res.map);
          mainWindow?.webContents.send('map:updated', res.map);
          sendLog('info', `Applied 3D painted texture to bitmap tag #${tagIndex} (image ${imageIndex}).`);
        }
        return res;
      } catch (err) {
        const e = err as Error & { code?: string };
        return { ok: false, code: e.code ?? 'BITMAP_REPLACE_ERROR', message: e.message };
      }
    },
  );

  const resolveCustomTexturesDirectory = (): string => {
    const baseDir = process.env.PORTABLE_EXECUTABLE_DIR
      ? process.env.PORTABLE_EXECUTABLE_DIR
      : app.isPackaged
        ? path.dirname(process.execPath)
        : process.cwd();
    const texturesDir = path.join(baseDir, 'textures');
    fs.mkdirSync(texturesDir, { recursive: true });

    // Seed starter PNG textures if folder has no PNG/JPG files yet
    try {
      const existing = fs.readdirSync(texturesDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
      if (existing.length === 0) {
        const presets: Array<{ name: string; fn: (x: number, y: number) => [number, number, number, number] }> = [
          {
            name: 'unsc_olive_armor.png',
            fn: (x, y) => {
              const n = ((x * 37 + y * 57) ^ (x * 13)) & 15;
              const seam = x % 32 === 0 || y % 32 === 0 ? -18 : 0;
              return [Math.max(0, 74 + n + seam), Math.max(0, 88 + n + seam), Math.max(0, 58 + n + seam), 255];
            },
          },
          {
            name: 'covenant_hex_plate.png',
            fn: (x, y) => {
              const hx = (x + ((y >> 3) & 1) * 8) % 16;
              const hy = y % 16;
              const edge = hx === 0 || hy === 0 ? 30 : 0;
              return [92 + edge, 52 + edge, 148 + edge, 255];
            },
          },
          {
            name: 'forerunner_circuit_panel.png',
            fn: (x, y) => {
              const grid = x % 16 === 0 || y % 16 === 0 || (x + y) % 32 === 0;
              return grid ? [56, 189, 248, 255] : [68, 78, 92, 255];
            },
          },
          {
            name: 'hazard_warning_stripes.png',
            fn: (x, y) => {
              const stripe = ((x + y) >> 4) & 1;
              return stripe ? [234, 179, 8, 255] : [30, 32, 36, 255];
            },
          },
          {
            name: 'weathered_steel_grunge.png',
            fn: (x, y) => {
              const scratch = ((x * 73 + y * 19) ^ (y * 29)) & 31;
              const v = 110 + scratch;
              return [v, v + 2, v + 6, 255];
            },
          },
          {
            name: 'desert_camo_plate.png',
            fn: (x, y) => {
              const cell = (((x >> 4) * 7 + (y >> 4) * 13) ^ ((x >> 3) + (y >> 3))) & 3;
              if (cell === 0) return [194, 168, 120, 255];
              if (cell === 1) return [156, 126, 84, 255];
              if (cell === 2) return [118, 96, 66, 255];
              return [176, 148, 102, 255];
            },
          },
        ];
        for (const p of presets) {
          const rgba = new Uint8Array(64 * 64 * 4);
          for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
              const [r, g, b, a] = p.fn(x, y);
              const idx = (y * 64 + x) * 4;
              rgba[idx] = r;
              rgba[idx + 1] = g;
              rgba[idx + 2] = b;
              rgba[idx + 3] = a;
            }
          }
          const png = encodeRgbaToPng(rgba, 64, 64);
          fs.writeFileSync(path.join(texturesDir, p.name), png);
        }
      }
    } catch {
      // best effort seed
    }
    return texturesDir;
  };

  ipcMain.handle('bitmap:getCustomBrushTextures', async () => {
    const texturesDir = resolveCustomTexturesDirectory();
    const textures: Array<{ name: string; filePath: string; dataUrl: string }> = [];
    try {
      const files = fs.readdirSync(texturesDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
      for (const file of files) {
        const fullPath = path.join(texturesDir, file);
        const ext = path.extname(file).toLowerCase();
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
        const buf = fs.readFileSync(fullPath);
        const cleanName = path.basename(file, ext).replace(/[_-]+/g, ' ');
        textures.push({
          name: cleanName,
          filePath: fullPath,
          dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        });
      }
    } catch {
      // ignore
    }
    return { ok: true as const, texturesDir, textures };
  });

  ipcMain.handle('bitmap:openCustomTexturesFolder', async () => {
    const texturesDir = resolveCustomTexturesDirectory();
    await shell.openPath(texturesDir);
    return { ok: true, texturesDir };
  });

  ipcMain.handle(
    'render:updateBspVertices',
    async (
      _e,
      bspIndex: number,
      submeshUpdates: Array<{
        submeshIndex: number;
        positions: Float32Array | number[];
        normals?: Float32Array | number[];
        uvs?: Float32Array | number[];
        shaderTagId?: number;
      }>,
    ) => {
      try {
        const { promise } = sendWorkerRequest<{
          ok: true;
          updatedVertices: number;
          updatedCollisionVertices: number;
          map: OpenMapSummary;
        }>(
          {
            type: 'updateBspVertices',
            bspIndex,
            submeshUpdates,
          },
          sendLog,
        );
        const res = await promise;
        if (res.ok) {
          setOpenMapState(res.map);
          mainWindow?.webContents.send('map:updated', res.map);
        }
        return res;
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'render:updateModelVertices',
    async (
      _e,
      modelTagId: number,
      submeshUpdates: Array<{
        submeshIndex: number;
        positions: Float32Array | number[];
        normals?: Float32Array | number[];
        uvs?: Float32Array | number[];
      }>,
      lod?: number,
    ) => {
      try {
        const { promise } = sendWorkerRequest<{
          ok: true;
          updatedVertices: number;
          map: OpenMapSummary;
        }>(
          {
            type: 'updateModelVertices',
            modelTagId,
            submeshUpdates,
            lod,
          },
          sendLog,
        );
        const res = await promise;
        if (res.ok) {
          setOpenMapState(res.map);
          mainWindow?.webContents.send('map:updated', res.map);
        }
        return res;
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );
  ipcMain.handle(SAVE_MAP_CHANNEL, () => runSaveMap());
  registerSaveMapAsIpc(ipcMain, saveMapAsDeps, afterSaveAs);
  ipcMain.handle('map:discard', () => discardChangesFlow());
  ipcMain.handle('map:convertPreflight', (_e, source: unknown, resourcePaths?: unknown) =>
    convertPreflightFlow(source, resourcePaths && typeof resourcePaths === 'object' ? (resourcePaths as ConvertResourcePaths) : undefined),
  );
  ipcMain.handle('map:convert', (_e, acknowledgeScripts: unknown, repairs: unknown, resourcePaths?: unknown) => runConvertMap(acknowledgeScripts, repairs, resourcePaths));
  ipcMain.handle('dialog:pickConvertResource', (_e, kind: 'bitmaps' | 'sounds' | 'loc') => pickConvertResourceFlow(kind));
  ipcMain.handle('app:openContainingFolder', (_e, filePath: string) => {
    if (typeof filePath === 'string' && filePath) shell.showItemInFolder(filePath);
  });
  ipcMain.handle('app:getSettings', () => getSettings());
  ipcMain.handle('app:version', () => getAppDisplayVersion());
  ipcMain.handle('app:recentMaps', () => getRecentMaps());
  ipcMain.on('app:notImplemented', (_e, feature: string) => sendLog('warn', `${feature} is not implemented yet (coming in a later milestone).`));
  ipcMain.handle('app:showAbout', () => showAboutDialog());

  // M12: OpenCE Tag Test IPC + Global In-Game Developer Toggles Hotkeys (F6-F10)
  let devOverlayWindow: BrowserWindow | null = null;
  const inGameHotkeysState = {
    overlayPinned: false,
    godMode: false,
    infiniteAmmo: false,
    wireframe: false,
    aiDebug: false,
    superJump: false,
    medusa: false,
    bumpPossession: false,
  };

  const registerTagTestGlobalHotkeys = () => {
    try {
      // F6 shortcut removed per user request so it never switches focus to the Mantle app window.
      // F7: Toggle God Mode in-game
      if (!globalShortcut.isRegistered('F7')) {
        globalShortcut.register('F7', () => {
          inGameHotkeysState.godMode = !inGameHotkeysState.godMode;
          const v = inGameHotkeysState.godMode ? 1 : 0;
          tagTestRunner.sendCommand(`cheat_deathless_player ${v}`);
          tagTestRunner.sendCommand(`sv_say "[OpenCE Dev] God Mode: ${v ? 'ON' : 'OFF'} (F7)"`);
          mainWindow?.webContents.send('tagTest:hotkeyAction', { action: 'godMode', value: inGameHotkeysState.godMode });
        });
      }
      // F8: Toggle Infinite Ammo & Bottomless Clip in-game
      if (!globalShortcut.isRegistered('F8')) {
        globalShortcut.register('F8', () => {
          inGameHotkeysState.infiniteAmmo = !inGameHotkeysState.infiniteAmmo;
          const v = inGameHotkeysState.infiniteAmmo ? 1 : 0;
          tagTestRunner.sendCommand(`cheat_infinite_ammo ${v}`);
          tagTestRunner.sendCommand(`cheat_bottomless_clip ${v}`);
          tagTestRunner.sendCommand(`sv_say "[OpenCE Dev] Infinite Ammo & Bottomless Clip: ${v ? 'ON' : 'OFF'} (F8)"`);
          mainWindow?.webContents.send('tagTest:hotkeyAction', { action: 'infiniteAmmo', value: inGameHotkeysState.infiniteAmmo });
        });
      }
      // F9: Toggle Wireframe & Portals Debug in-game
      if (!globalShortcut.isRegistered('F9')) {
        globalShortcut.register('F9', () => {
          inGameHotkeysState.wireframe = !inGameHotkeysState.wireframe;
          const v = inGameHotkeysState.wireframe ? 1 : 0;
          tagTestRunner.sendCommand(`rasterizer_wireframe ${v}`);
          tagTestRunner.sendCommand(`debug_portals ${v}`);
          tagTestRunner.sendCommand(`sv_say "[OpenCE Dev] Wireframe & BSP Portals: ${v ? 'ON' : 'OFF'} (F9)"`);
          mainWindow?.webContents.send('tagTest:hotkeyAction', { action: 'wireframe', value: inGameHotkeysState.wireframe });
        });
      }
      // F10: Toggle AI Perception & Object Collision Debug in-game
      if (!globalShortcut.isRegistered('F10')) {
        globalShortcut.register('F10', () => {
          inGameHotkeysState.aiDebug = !inGameHotkeysState.aiDebug;
          const v = inGameHotkeysState.aiDebug ? 1 : 0;
          tagTestRunner.sendCommand(`ai_render ${v}`);
          tagTestRunner.sendCommand(`debug_objects ${v}`);
          tagTestRunner.sendCommand(`sv_say "[OpenCE Dev] AI Perception & Object Bounds: ${v ? 'ON' : 'OFF'} (F10)"`);
          mainWindow?.webContents.send('tagTest:hotkeyAction', { action: 'aiDebug', value: inGameHotkeysState.aiDebug });
        });
      }
    } catch {
      /* best effort global shortcut registration */
    }
  };

  const unregisterTagTestGlobalHotkeys = () => {
    try {
      for (const key of ['F6', 'F7', 'F8', 'F9', 'F10']) {
        if (globalShortcut.isRegistered(key)) {
          globalShortcut.unregister(key);
        }
      }
      if (devOverlayWindow && !devOverlayWindow.isDestroyed()) {
        devOverlayWindow.close();
        devOverlayWindow = null;
      }
      inGameHotkeysState.overlayPinned = false;
    } catch {
      /* ignore */
    }
  };

  tagTestRunner.onStatusChange((status) => {
    mainWindow?.webContents.send('tagTest:status', status);
    if (status.state === 'running' || status.state === 'launching') {
      registerTagTestGlobalHotkeys();
    } else if (status.state === 'stopped') {
      unregisterTagTestGlobalHotkeys();
    }
  });
  tagTestRunner.onLog((entry) => {
    mainWindow?.webContents.send('tagTest:log', entry);
  });

  ipcMain.handle('tagTest:launch', (_e, options) => tagTestRunner.launch(options));
  ipcMain.handle('tagTest:stop', () => tagTestRunner.stop());
  ipcMain.handle('tagTest:sendCommand', (_e, cmd: string) => tagTestRunner.sendCommand(cmd));
  ipcMain.handle('tagTest:hotReload', () => tagTestRunner.hotReload());
  ipcMain.handle('tagTest:getStatus', () => tagTestRunner.getStatus());
  ipcMain.handle('tagTest:getConfig', () => tagTestRunner.getOpenCeConfig());
  ipcMain.handle('tagTest:setAlwaysOnTop', (_e, flag: boolean) => {
    tagTestRunner.setHaloAlwaysOnTop(flag);
    return tagTestRunner.isHaloAlwaysOnTop();
  });
  ipcMain.handle('tagTest:isAlwaysOnTop', () => tagTestRunner.isHaloAlwaysOnTop());
  ipcMain.handle('tagTest:triggerFlycam', () => {
    tagTestRunner.triggerFlycamToggle();
    return { ok: true };
  });
  ipcMain.handle('tagTest:setDir', (_e, dir: string | null) => {
    setOpenCeDirectory(dir);
    return { ok: true };
  });
  ipcMain.handle('tagTest:pickDir', async () => {
    if (!mainWindow) return { path: null };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select OpenCE Directory (containing halo.exe)',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return { path: null };
    const dir = res.filePaths[0];
    setOpenCeDirectory(dir);
    return { path: dir };
  });

  ipcMain.handle('window:setAlwaysOnTop', (_e, flag: boolean) => {
    mainWindow?.setAlwaysOnTop(flag, 'floating');
    return mainWindow?.isAlwaysOnTop() ?? false;
  });
  ipcMain.handle('window:isAlwaysOnTop', () => {
    return mainWindow?.isAlwaysOnTop() ?? false;
  });

  // Guilty Spark Item 1: Pick and parse a .wrl (VRML 1.0) error file or tool.exe log
  ipcMain.handle('wrl:pickAndParse', async () => {
    if (!mainWindow) return { ok: false, message: 'Main window unavailable.' };
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Load .WRL (VRML 1.0 Error Geometry) or tool.exe / debug.txt Build Log',
      filters: [
        { name: 'Halo WRL & Tool Logs (*.wrl, *.txt, *.log)', extensions: ['wrl', 'txt', 'log'] },
        { name: 'VRML 1.0 Error Geometry (*.wrl)', extensions: ['wrl'] },
        { name: 'Tool Log / debug.txt (*.txt, *.log)', extensions: ['txt', 'log'] },
      ],
      properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths[0]) {
      return { ok: false, cancelled: true, message: 'Cancelled.' };
    }
    const filePath = pick.filePaths[0];
    const fileName = path.basename(filePath);
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      if (filePath.toLowerCase().endsWith('.wrl') || text.trimStart().startsWith('#VRML')) {
        const wrl = parseHaloWrl(text);
        sendLog(
          'info',
          `Loaded WRL diagnostic "${fileName}": ${wrl.faces.length} error face(s), ${wrl.segments.length} error edge(s), ${wrl.points.length} vertex(es).`,
        );
        return { ok: true as const, kind: 'wrl' as const, fileName, wrl };
      } else {
        const logReview = analyzeHaloToolLog(text);
        sendLog(
          'info',
          `Analyzed tool.exe log "${fileName}": ${logReview.errorCount} error(s), ${logReview.warningCount} warning(s).`,
        );
        return { ok: true as const, kind: 'log' as const, fileName, logReview };
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  // Guilty Spark Item 7: Semantic Map Diffing against another .map file
  ipcMain.handle('map:compareWithAnother', async () => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first before comparing.' };
    }
    if (!mainWindow) return { ok: false, message: 'Main window unavailable.' };
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Second .map File to Compare Against Open Map',
      filters: [{ name: 'Halo Map (*.map, *.bak)', extensions: ['map', 'bak'] }],
      properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths[0]) {
      return { ok: false, cancelled: true, message: 'Cancelled.' };
    }
    const otherFilePath = pick.filePaths[0];
    const { promise } = sendWorkerRequest<
      | { ok: true; leftFileName: string; rightFileName: string; report: any }
      | { ok: false; message: string }
    >({ type: 'compareMaps', otherFilePath }, sendLog, (stage, percent) =>
      mainWindow?.webContents.send('map:progress', { taskId: 'compareMaps', stage, percent }),
    );
    const res = await promise;
    if (res.ok) {
      sendLog(
        'info',
        `Compared "${res.leftFileName}" vs "${res.rightFileName}": ${res.report.changedTags} changed, +${res.report.addedTags} added, -${res.report.removedTags} removed.`,
      );
    }
    return res;
  });

  // Guilty Spark Item 8: Steam MCC Mod Discovery & Transactional ModManifest.txt Deployment
  ipcMain.handle('mcc:discover', async () => {
    const info = discoverSteamMccInstallations();
    return {
      ok: true as const,
      mccInstallPaths: info.mccInstallPaths,
      defaultModManifestPath: info.defaultModManifestPath,
      manifestExists: info.manifestExists,
      registeredRoots: info.registeredRoots,
    };
  });

  ipcMain.handle(
    'mcc:deployMod',
    async (
      _e,
      options: {
        title: string;
        description?: string;
        author?: string;
        isMultiplayer?: boolean;
        registerInModManifest?: boolean;
      },
    ) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map before deploying to Steam MCC.' };
      }
      if (!mainWindow) return { ok: false, message: 'Main window unavailable.' };
      const pick = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Output Parent Directory for Steam MCC Mod Package',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (pick.canceled || !pick.filePaths[0]) {
        return { ok: false, cancelled: true, message: 'Cancelled.' };
      }
      const parentOutputDir = pick.filePaths[0];
      const { promise } = sendWorkerRequest<
        | {
            ok: true;
            modFolderPath: string;
            mapOutputPath: string;
            modInfoPath: string;
            manifestRegistered: boolean;
            manifestPath?: string;
          }
        | { ok: false; message: string }
      >(
        {
          type: 'deployMccMod',
          parentOutputDir,
          title: options.title,
          description: options.description,
          author: options.author,
          isMultiplayer: options.isMultiplayer,
          registerInModManifest: options.registerInModManifest,
        },
        sendLog,
        (stage, percent) =>
          mainWindow?.webContents.send('map:progress', { taskId: 'deployMccMod', stage, percent }),
      );
      const res = await promise;
      if (res.ok) {
        sendLog(
          'info',
          `Deployed Steam MCC Mod Package to ${res.modFolderPath}${res.manifestRegistered ? ` and registered in ${res.manifestPath}` : ''}.`,
        );
      }
      return res;
    },
  );

  ipcMain.handle(
    'map:globalReplaceTagFieldValue',
    async (
      _evt,
      options: { fieldNameQuery: string; tagGroupFilter?: string; matchValue?: string; newValue: string },
    ) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map first.' };
      }
      const { promise } = sendWorkerRequest<
        | {
            ok: true;
            replacedCount: number;
            affectedFields: Array<{
              tagIndex: number;
              tagPath: string;
              tagGroup: string;
              fieldPath: string;
              oldValue: string;
              newValue: string;
            }>;
          }
        | { ok: false; message: string }
      >(
        {
          type: 'globalReplaceTagFieldValue',
          fieldNameQuery: options.fieldNameQuery,
          tagGroupFilter: options.tagGroupFilter,
          matchValue: options.matchValue,
          newValue: options.newValue,
        },
        sendLog,
      );
      const res = await promise;
      if (res.ok && res.replacedCount > 0) {
        currentMapModified = true;
        sendLog('info', `Globally updated ${res.replacedCount} field(s) matching "${options.fieldNameQuery}" -> "${options.newValue}".`);
      }
      return res;
    },
  );

  ipcMain.handle(
    'map:compileJmaAnimation',
    async (_evt, targetAntrTagIndex: number, animName?: string) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map first.' };
      }
      if (!mainWindow) return { ok: false, message: 'Main window unavailable.' };
      const pick = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Halo CE Skeletal Animation (.jma / .jmm / .jmo / .jmr)',
        filters: [
          { name: 'Halo Animation Source (*.jma;*.jmm;*.jmo;*.jmr;*.jmw;*.jmz)', extensions: ['jma', 'jmm', 'jmo', 'jmr', 'jmw', 'jmz'] },
          { name: 'All Files (*.*)', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
      if (pick.canceled || !pick.filePaths[0]) {
        return { ok: false, cancelled: true, message: 'Cancelled.' };
      }
      const filePath = pick.filePaths[0];
      const fileName = path.basename(filePath);
      const inferredAnimName = animName?.trim() || path.basename(filePath, path.extname(filePath));
      const jmaText = fs.readFileSync(filePath, 'utf8');
      const { promise } = sendWorkerRequest<
        | {
            ok: true;
            animationName: string;
            frameCount: number;
            nodeCount: number;
            frameSize: number;
            replacedExisting: boolean;
          }
        | { ok: false; message: string }
      >(
        {
          type: 'compileJmaAnimation',
          targetAntrTagIndex,
          jmaText,
          animName: inferredAnimName,
        },
        sendLog,
      );
      const res = await promise;
      if (res.ok) {
        currentMapModified = true;
        sendLog(
          'info',
          `Compiled .JMA animation "${res.animationName}" (${res.frameCount} frames, ${res.nodeCount} nodes) into model_animations tag #${targetAntrTagIndex}.`,
        );
        return { ...res, fileName };
      }
      return res;
    },
  );

  ipcMain.handle(
    'map:compileJmsPhysics',
    async (_evt, targetPhysTagIndex: number, totalMass?: number) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map first.' };
      }
      if (!mainWindow) return { ok: false, message: 'Main window unavailable.' };
      const pick = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Halo CE .JMS File with Mass Points / Markers',
        filters: [
          { name: 'Halo CE JMS (*.jms)', extensions: ['jms'] },
          { name: 'All Files (*.*)', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
      if (pick.canceled || !pick.filePaths[0]) {
        return { ok: false, cancelled: true, message: 'Cancelled.' };
      }
      const filePath = pick.filePaths[0];
      const fileName = path.basename(filePath);
      const jmsText = fs.readFileSync(filePath, 'utf8');
      const { promise } = sendWorkerRequest<
        | {
            ok: true;
            massPointCount: number;
            totalMass: number;
            centerOfMass: [number, number, number];
            moments: [number, number, number];
          }
        | { ok: false; message: string }
      >(
        {
          type: 'compileJmsPhysics',
          targetPhysTagIndex,
          jmsText,
          totalMass,
        },
        sendLog,
      );
      const res = await promise;
      if (res.ok) {
        currentMapModified = true;
        sendLog(
          'info',
          `Compiled ${res.massPointCount} mass points (mass ${res.totalMass} kg) from ${fileName} into physics tag #${targetPhysTagIndex}.`,
        );
        return { ...res, fileName };
      }
      return res;
    },
  );

  ipcMain.handle(
    'map:decompileTagToSource',
    async (_evt, tagIndex: number, animationIndex?: number) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map first.' };
      }
      if (!mainWindow) return { ok: false, message: 'Main window unavailable.' };
      const { promise } = sendWorkerRequest<
        | {
            ok: true;
            kind: 'gbxmodel_jms' | 'animations_jma' | 'physics_jms';
            sourceText: string;
            defaultExt: 'jms' | 'jma';
            tagPath: string;
            animationName?: string;
            summary: string;
          }
        | { ok: false; message: string }
      >(
        {
          type: 'decompileTagToSource',
          tagIndex,
          animationIndex,
        },
        sendLog,
      );
      const res = await promise;
      if (!res.ok) return res;

      const leaf = (res.tagPath.split('\\').pop() || 'exported').replace(/[^a-zA-Z0-9_-]/g, '_');
      const suggestedName =
        res.kind === 'physics_jms'
          ? 'physics.jms'
          : res.kind === 'animations_jma'
            ? `${res.animationName || leaf}.jma`
            : `${leaf}.jms`;

      const save = await dialog.showSaveDialog(mainWindow, {
        title: `Save Decompiled Source File (${suggestedName})`,
        defaultPath: suggestedName,
        filters: [
          res.defaultExt === 'jma'
            ? { name: 'Halo Skeletal Animation (*.jma)', extensions: ['jma'] }
            : { name: 'Halo Jointed Model Skeleton (*.jms)', extensions: ['jms'] },
          { name: 'All Files (*.*)', extensions: ['*'] },
        ],
      });
      if (save.canceled || !save.filePath) {
        return { ok: false, cancelled: true, message: 'Save cancelled.' };
      }
      fs.writeFileSync(save.filePath, res.sourceText, 'utf8');
      sendLog('info', `Decompiled "${res.tagPath}" -> ${save.filePath} (${res.summary}).`);
      return {
        ok: true,
        outputPath: save.filePath,
        kind: res.kind,
        tagPath: res.tagPath,
        summary: res.summary,
      };
    },
  );

  ipcMain.handle(
    'map:compileStringsTag',
    async (_evt, targetTagIndex: number, textContent?: string) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map first.' };
      }
      let finalContent = textContent;
      let fileName: string | undefined;
      if (!finalContent || !finalContent.trim()) {
        if (!mainWindow) return { ok: false, message: 'Main window unavailable.' };
        const pick = await dialog.showOpenDialog(mainWindow, {
          title: 'Select Halo String Source File (.txt / .hmt)',
          filters: [
            { name: 'Halo String Source (*.txt;*.hmt)', extensions: ['txt', 'hmt'] },
            { name: 'All Files (*.*)', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });
        if (pick.canceled || !pick.filePaths[0]) {
          return { ok: false, cancelled: true, message: 'Cancelled.' };
        }
        const fp = pick.filePaths[0];
        fileName = path.basename(fp);
        const rawBuf = fs.readFileSync(fp);
        // Handle UTF-16LE BOM (0xFF 0xFE) which Halo CE tool.exe .txt files often use
        if (rawBuf.length >= 2 && rawBuf[0] === 0xff && rawBuf[1] === 0xfe) {
          finalContent = rawBuf.subarray(2).toString('utf16le');
        } else {
          finalContent = rawBuf.toString('utf8');
        }
      }
      const { promise } = sendWorkerRequest<
        | {
            ok: true;
            tagPath: string;
            tagGroup: string;
            entryCount: number;
            messageNames: string[];
          }
        | { ok: false; message: string }
      >(
        {
          type: 'compileStringsTag',
          targetTagIndex,
          textContent: finalContent,
        },
        sendLog,
      );
      const res = await promise;
      if (res.ok) {
        currentMapModified = true;
        sendLog(
          'info',
          `Compiled ${res.entryCount} string(s) into ${res.tagGroup} "${res.tagPath}".`,
        );
        return { ...res, fileName };
      }
      return res;
    },
  );

  ipcMain.handle('map:inspectMeterTag', async (_evt, meterTagIndex: number) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<
      | {
          ok: true;
          tagPath: string;
          width: number;
          height: number;
          interpolateColors: number;
          anchorColors: number;
          emptyColorHex: string;
          fullColorHex: string;
          unmaskDistance: number;
          maskDistance: number;
          encodedBytes: number;
          previewRgba: number[];
        }
      | { ok: false; message: string }
    >(
      {
        type: 'inspectMeterTag',
        meterTagIndex,
      },
      sendLog,
    );
    return promise;
  });

  ipcMain.handle(
    'map:compileFontFromGlyphAtlas',
    async (
      _evt,
      targetFontTagIndex: number,
      glyphSpec: {
        ascendingHeight: number;
        descendingHeight: number;
        leadingHeight: number;
        leadingWidth: number;
        glyphs: Array<{
          charCode: number;
          characterWidth: number;
          bitmapWidth: number;
          bitmapHeight: number;
          bitmapOriginX: number;
          bitmapOriginY: number;
          alphaPixels: number[];
        }>;
      },
    ) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map first.' };
      }
      const { promise } = sendWorkerRequest<
        | {
            ok: true;
            tagPath: string;
            glyphCount: number;
            totalPixelBytes: number;
          }
        | { ok: false; message: string }
      >(
        {
          type: 'compileFontFromGlyphAtlas',
          targetFontTagIndex,
          glyphSpec,
        },
        sendLog,
      );
      const res = await promise;
      if (res.ok) {
        currentMapModified = true;
        sendLog(
          'info',
          `Compiled ${res.glyphCount} glyphs (${res.totalPixelBytes} pixel bytes) into font tag "${res.tagPath}".`,
        );
      }
      return res;
    },
  );

  ipcMain.handle(
    'map:injectProceduralWorldBsp',
    async (
      _evt,
      options: {
        worldMesh: any;
        bspIndex?: number;
        shaderBindings?: Record<string, { tagId: number; path: string; classFourCC: string }>;
        collisionMode?: 'auto' | 'exact';
      },
    ) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map first.' };
      }
      const { promise } = sendWorkerRequest<any>(
        {
          type: 'injectProceduralWorldBsp',
          worldMesh: options.worldMesh,
          bspIndex: options.bspIndex,
          shaderBindings: options.shaderBindings,
          collisionMode: options.collisionMode,
        },
        sendLog,
      );
      const res = await promise;
      if (res.ok && res.map) {
        setOpenMapState(res.map);
        sendLog(
          'info',
          `Injected procedural world geometry into Structure BSP (+${res.addedTriangles} triangles, +${res.addedCollisionSurfaces} collision surfaces, +${res.addedSubmeshes} shader submeshes).`,
        );
      }
      return res;
    },
  );

  ipcMain.handle(
    'map:scaleCoupledPhysics',
    async (_evt, objectTagId: number, scaleFactor: number) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map first.' };
      }
      const { promise } = sendWorkerRequest<any>(
        {
          type: 'scaleCoupledPhysics',
          objectTagId,
          scaleFactor,
        },
        sendLog,
      );
      const res = await promise;
      if (res.ok && res.map) {
        setOpenMapState(res.map);
        const s = res.summary;
        sendLog(
          'info',
          `Coupled Physics Resizer (${s.scaleFactor.toFixed(2)}x) applied to "${s.objectPath}" (${s.objectClass}): ${s.scaledGbxmodelVertices} model verts, ${s.scaledCollisionVertices} collision verts, ${s.scaledPhysicsMassPoints} mass points, ${s.scaledVehicleSuspensions} suspensions.`,
        );
      }
      return res;
    },
  );

  ipcMain.handle('hud:inspectCatalog', async () => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'inspectLiveHudCatalog' },
      sendLog,
    );
    return promise;
  });

  ipcMain.handle('hud:applyEdit', async (_evt, request: any) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'applyLiveHudEdit', request },
      sendLog,
    );
    const res = await promise;
    if (res.ok) {
      if (res.memoryPatches) {
        tagTestRunner.writeMemoryPatches(res.memoryPatches);
      }
      if (res.map) {
        setOpenMapState(res.map);
        mainWindow?.webContents.send('map:updated', res.map);
      }
    }
    return res;
  });

  ipcMain.handle('hud:applyWeaponStatEdit', async (_evt, request: any) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'applyLiveWeaponStatEdit', request },
      sendLog,
    );
    const res = await promise;
    if (res.ok) {
      if (res.memoryPatches) {
        tagTestRunner.writeMemoryPatches(res.memoryPatches);
      }
      if (res.map) {
        setOpenMapState(res.map);
        mainWindow?.webContents.send('map:updated', res.map);
      }
    }
    return res;
  });

  ipcMain.handle('hud:blinkElement', async (_evt, offsetVirtualAddress: number, originalX: number) => {
    return tagTestRunner.blinkHudElement(offsetVirtualAddress, originalX);
  });

  ipcMain.handle('hud:equipWeapon', async (_evt, weaponTagId: number) => {
    return tagTestRunner.equipWeaponInGame(weaponTagId);
  });

  ipcMain.handle('hud:spawnVehicle', async (_evt, vehicleTagId: number) => {
    return tagTestRunner.spawnVehicleInGame(vehicleTagId);
  });

  ipcMain.handle('hud:spawnAllArsenal', async () => {
    return tagTestRunner.spawnAllArsenalInGame();
  });

  ipcMain.handle('hud:injectElementBitmap', async (_evt, request: any) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const settings = getSettings();
    const { promise } = sendWorkerRequest<any>(
      {
        type: 'injectHudElementBitmap',
        request,
        bitmapsPath: settings.resourceMaps.bitmaps ?? undefined,
      },
      sendLog,
    );
    const res = await promise;
    if (res.ok && res.map) {
      setOpenMapState(res.map);
      mainWindow?.webContents.send('map:updated', res.map);
      sendLog(
        'info',
        `Injected custom HUD bitmap (${res.width}×${res.height}) into map-local tag "${res.bitmapPath}". bitmaps.map was not modified.`,
      );
    }
    return res;
  });

  ipcMain.handle('ui:inspectWidgetCanvas', async (_evt, widgetTagIndex: number) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'inspectUiWidgetCanvas', widgetTagIndex },
      sendLog,
    );
    return promise;
  });

  ipcMain.handle('ui:updateWidgetPlacement', async (_evt, request: any) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'updateUiWidgetPlacement', request },
      sendLog,
    );
    const res = await promise;
    if (res.ok && res.map) {
      setOpenMapState(res.map);
      mainWindow?.webContents.send('map:updated', res.map);
    }
    return res;
  });

  ipcMain.handle('ui:saveUnicodeStringTable', async (_evt, ustrTagIndex: number, strings: string[]) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'saveUnicodeStringTable', ustrTagIndex, strings },
      sendLog,
    );
    const res = await promise;
    if (res.ok && res.map) {
      setOpenMapState(res.map);
      mainWindow?.webContents.send('map:updated', res.map);
      sendLog('info', `Saved ${res.entryCount} Unicode string(s) into ustr tag #${ustrTagIndex}.`);
    }
    return res;
  });

  ipcMain.handle('baboon:inspectContentExplorer', async (_evt, tagIndex: number) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'inspectContentExplorer', tagIndex },
      sendLog,
    );
    return promise;
  });

  ipcMain.handle('baboon:autoFixTagDependencies', async (_evt, tagIndices?: number[]) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'autoFixTagDependencies', tagIndices },
      sendLog,
    );
    const res = await promise;
    if (res.ok && res.map) {
      setOpenMapState(res.map);
      mainWindow?.webContents.send('map:updated', res.map);
      sendLog('info', `Auto-fixed ${res.report.fixedCount} broken tag reference(s) (${res.report.ambiguousCount} ambiguous, ${res.report.unresolvedCount} unresolved).`);
    }
    return res;
  });

  ipcMain.handle('baboon:refactorMoveFolderInMap', async (_evt, oldPrefix: string, newPrefix: string) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'refactorMoveFolderInMap', oldPrefix, newPrefix },
      sendLog,
    );
    const res = await promise;
    if (res.ok && res.map) {
      setOpenMapState(res.map);
      mainWindow?.webContents.send('map:updated', res.map);
      sendLog('info', `Refactored folder prefix "${oldPrefix}" -> "${newPrefix}" (${res.report.movedTags.length} tag(s) updated).`);
    }
    return res;
  });

  ipcMain.handle('baboon:reorganizeReflexiveBlock', async (_evt, request: any) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'reorganizeReflexiveBlock', request },
      sendLog,
    );
    const res = await promise;
    if (res.ok && res.map) {
      setOpenMapState(res.map);
      mainWindow?.webContents.send('map:updated', res.map);
      sendLog('info', `Committed staged block organizer changes to "${request.reflexivePath}" (${res.newCount} elements).`);
    }
    return res;
  });

  ipcMain.handle('baboon:exportReflexiveTsv', async (_evt, tagIndex: number, reflexivePath: string) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'exportReflexiveTsv', tagIndex, reflexivePath },
      sendLog,
    );
    return promise;
  });

  ipcMain.handle(
    'baboon:importReflexiveTsv',
    async (_evt, tagIndex: number, reflexivePath: string, tsvText: string) => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map first.' };
      }
      const { promise } = sendWorkerRequest<any>(
        { type: 'importReflexiveTsv', tagIndex, reflexivePath, tsvText },
        sendLog,
      );
      const res = await promise;
      if (res.ok && res.map) {
        setOpenMapState(res.map);
        mainWindow?.webContents.send('map:updated', res.map);
        sendLog('info', `Applied TSV spreadsheet paste to "${reflexivePath}" (${res.updatedCells} cells updated across ${res.rowCount} rows).`);
      }
      return res;
    },
  );

  ipcMain.handle('baboon:evaluateFunctionCurve', async (_evt, params: any, sampleCount?: number) => {
    return evaluateBlamFunctionCurve(params, sampleCount);
  });

  ipcMain.handle('baboon:analyzeHudMessageSafety', async (_evt, tagIndex: number) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'analyzeHudMessageSafety', tagIndex },
      sendLog,
    );
    return promise;
  });

  ipcMain.handle('baboon:exportStringsCsv', async (_evt, ustrTagIndex: number) => {
    if (!currentMapPath || currentMapCompressed) {
      return { ok: false, message: 'Open an uncompressed map first.' };
    }
    const { promise } = sendWorkerRequest<any>(
      { type: 'exportStringsCsv', ustrTagIndex },
      sendLog,
    );
    return promise;
  });

  ipcMain.handle(
    'baboon:previewStringsCsvImport',
    async (_evt, ustrTagIndex: number, csvText: string, mode: 'amend' | 'replace') => {
      if (!currentMapPath || currentMapCompressed) {
        return { ok: false, message: 'Open an uncompressed map first.' };
      }
      const { promise } = sendWorkerRequest<any>(
        { type: 'previewStringsCsvImport', ustrTagIndex, csvText, mode },
        sendLog,
      );
      return promise;
    },
  );

  const toUiLooseWorkspaceSnapshot = (raw: LooseTagsWorkspaceIndex) => {
    const entryKeys = new Set(raw.entries.map((e) => e.key));
    return {
      tagsRootDir: raw.tagsDir,
      totalFiles: raw.entries.length,
      brokenDependencyCount: raw.brokenDependencies.length,
      unreferencedTagCount: raw.unreferencedTagKeys.length,
      entries: raw.entries.map((e) => {
        const refs = e.dependencies.map((d) => ({
          fieldPath: d.fieldPath,
          group: d.group,
          path: d.path,
        }));
        const brokenReferences = e.dependencies
          .filter((d) => !entryKeys.has(d.targetKey))
          .map((d) => ({
            fieldPath: d.fieldPath,
            group: d.group,
            path: d.path,
          }));
        return {
          key: e.key,
          relativePath: e.tagPath,
          groupName: e.group,
          groupFourCC: e.groupFourCC,
          absolutePath: e.filePath,
          fileSize: e.size,
          mtimeMs: e.mtimeMs,
          headerFormat: e.headerFormat,
          references: refs,
          referencedByCount: raw.dependentsByTargetKey[e.key]?.length ?? 0,
          brokenReferences,
        };
      }),
    };
  };

  ipcMain.handle('baboon:openLooseTagsWorkspace', async (_evt, tagsRootDir?: string) => {
    try {
      let targetDir = tagsRootDir;
      if (!targetDir) {
        if (!mainWindow) return { ok: false, message: 'Main window unavailable.' };
        const pick = await dialog.showOpenDialog(mainWindow, {
          title: 'Select Standard Blam tags/ Folder Workspace...',
          properties: ['openDirectory'],
        });
        if (pick.canceled || !pick.filePaths[0]) {
          return { ok: false, cancelled: true, message: 'Cancelled.' };
        }
        targetDir = pick.filePaths[0];
      }
      const rawIndex = scanLooseTagsWorkspace(targetDir);
      const snapshot = toUiLooseWorkspaceSnapshot(rawIndex);
      sendLog(
        'info',
        `Indexed Loose Blam tags/ Workspace "${snapshot.tagsRootDir}": ${snapshot.totalFiles} tags (${snapshot.brokenDependencyCount} broken refs, ${snapshot.unreferencedTagCount} unreferenced).`,
      );
      return { ok: true, snapshot };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'baboon:readLooseTagFields',
    async (_evt, absolutePath: string, relativePath?: string) => {
      try {
        const buf = fs.readFileSync(absolutePath);
        const rel =
          relativePath ??
          path.basename(absolutePath, path.extname(absolutePath));
        const fields = readLooseBlamTagFields(buf, rel);
        return { ok: true, fields, groupName: fields.group };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'baboon:writeLooseTagField',
    async (_evt, absolutePath: string, relativePath: string, fieldPath: string, newValue: unknown) => {
      try {
        const buf = fs.readFileSync(absolutePath);
        const updated = writeLooseBlamTagFieldValue(buf, relativePath, fieldPath, newValue);
        fs.writeFileSync(absolutePath, updated.buffer);
        sendLog('info', `Saved loose Blam tag field "${fieldPath}" in ${relativePath}.${updated.fields.group}`);
        return { ok: true, fields: updated.fields };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('baboon:fixLooseWorkspaceDependencies', async (_evt, tagsRootDir: string) => {
    try {
      const rawReport = fixBrokenTagDependenciesInWorkspace(tagsRootDir);
      const report = {
        ...rawReport,
        fixedCount: rawReport.fixed.length,
        ambiguousCount: rawReport.ambiguous.length,
        unresolvedCount: rawReport.notFound.length,
      };
      const snapshot = toUiLooseWorkspaceSnapshot(scanLooseTagsWorkspace(tagsRootDir));
      sendLog('info', `Repaired ${report.fixedCount} broken dependency reference(s) across loose tags/ workspace.`);
      return { ok: true, report, snapshot };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'baboon:refactorMoveLooseTag',
    async (_evt, tagsRootDir: string, oldRelativePath: string, newRelativePath: string, groupName: string) => {
      try {
        const rawReport = refactorRenameOrMoveLooseTagOnDisk(
          tagsRootDir,
          oldRelativePath,
          groupName,
          newRelativePath,
        );
        const report = {
          ...rawReport,
          updatedReferenceSlots: rawReport.rewrittenReferencingFiles.length,
        };
        const snapshot = toUiLooseWorkspaceSnapshot(scanLooseTagsWorkspace(tagsRootDir));
        sendLog(
          'info',
          `Moved loose Blam tag "${oldRelativePath}.${groupName}" -> "${newRelativePath}.${groupName}" and updated ${report.updatedReferenceSlots} referencing tag file(s).`,
        );
        return { ok: true, report, snapshot };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('baboon:inspectGitTagsWorkspace', async (_evt, tagsRootDir: string) => {
    try {
      let isGitRepo = false;
      let branch = '';
      const statusEntries: Array<{ status: string; relativePath: string; groupName: string; absolutePath: string }> = [];
      const recentCommits: Array<{ hash: string; shortHash: string; author: string; date: string; subject: string }> = [];

      try {
        branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: tagsRootDir,
          encoding: 'utf8',
          timeout: 4000,
        }).trim();
        isGitRepo = true;
      } catch {
        return { ok: true, isGitRepo: false, branch: '', statusEntries: [], recentCommits: [] };
      }

      const porcelain = execFileSync('git', ['status', '--porcelain', '.'], {
        cwd: tagsRootDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      for (const line of porcelain.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const status = line.slice(0, 2).trim();
        const fileRel = line.slice(3).trim().replace(/^"|"$/g, '');
        const abs = path.resolve(tagsRootDir, fileRel);
        const ext = path.extname(fileRel).replace(/^\./, '').toLowerCase();
        const relWithoutExt = fileRel.slice(0, fileRel.length - path.extname(fileRel).length).replace(/\//g, '\\');
        statusEntries.push({
          status,
          relativePath: relWithoutExt,
          groupName: ext,
          absolutePath: abs,
        });
      }

      try {
        const logOut = execFileSync(
          'git',
          ['log', '-n', '20', '--pretty=format:%H|%h|%an|%ad|%s', '--date=short', '.'],
          { cwd: tagsRootDir, encoding: 'utf8', timeout: 5000 },
        );
        for (const line of logOut.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const [hash, shortHash, author, date, ...subjParts] = line.split('|');
          recentCommits.push({
            hash: hash ?? '',
            shortHash: shortHash ?? '',
            author: author ?? '',
            date: date ?? '',
            subject: subjParts.join('|'),
          });
        }
      } catch {
        /* ignore empty commit log */
      }

      return { ok: true, isGitRepo, branch, statusEntries, recentCommits };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'baboon:diffGitLooseTag',
    async (_evt, tagsRootDir: string, absolutePath: string, gitRef = 'HEAD') => {
      try {
        const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: tagsRootDir,
          encoding: 'utf8',
          timeout: 4000,
        }).trim();
        const relToRepo = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
        const oldBuf = execFileSync('git', ['show', `${gitRef}:${relToRepo}`], {
          cwd: repoRoot,
          maxBuffer: 64 * 1024 * 1024,
          timeout: 5000,
        });
        const newBuf = fs.readFileSync(absolutePath);
        const groupName = path.extname(absolutePath).replace(/^\./, '').toLowerCase();
        const relTagPath = path
          .relative(tagsRootDir, absolutePath)
          .replace(/\.[^.]+$/, '')
          .replace(/\//g, '\\');
        const rows = compareBlamLooseTagBuffers(oldBuf, newBuf, relTagPath);
        return {
          ok: true,
          relativePath: relTagPath,
          groupName,
          changedFieldsCount: rows.length,
          fields: rows.map((r) => ({
            fieldPath: r.property,
            status: r.status,
            leftValue: r.before,
            rightValue: r.after,
          })),
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('baboon:queryHaloScriptCatalog', async (_evt, query: string, engineFilter?: string) => {
    return queryHaloScriptDocs(query, engineFilter).map((doc) => ({
      ...doc,
      usage: doc.signature,
    }));
  });

  ipcMain.handle('baboon:getToolCommands', async (_evt, engineFilter?: string) => {
    return getToolCommandCatalog(engineFilter).map((cmd) => ({
      ...cmd,
      verb: cmd.name,
      args: (cmd.args ?? []).map((a) => ({
        ...a,
        options: a.values,
      })),
    }));
  });

  ipcMain.handle(
    'baboon:runToolExeCommand',
    async (
      _evt,
      options: {
        mode?: 'native' | 'external_exe';
        toolExePath?: string;
        workingDir: string;
        verb: string;
        args: string[];
      },
    ) => {
      try {
        const effectiveMode = options.mode ?? 'native';
        // Resolve HEK root workingDir: if user pointed at `.../tags`, step up to its parent directory containing `data/` and `tags/`
        let resolvedWorkDir = options.workingDir || getSettings().openCeDirectory || process.cwd();
        if (path.basename(resolvedWorkDir).toLowerCase() === 'tags') {
          resolvedWorkDir = path.dirname(resolvedWorkDir);
        }

        if (effectiveMode === 'native') {
          const cleanArgs = options.args.filter((a) => a.trim().length > 0);
          sendLog(
            'info',
            `Running Built-In Native Mantle Tool Compiler: tool ${options.verb} ${cleanArgs.join(' ')} (cwd: ${resolvedWorkDir})`,
          );
          const nativeRes = await runNativeToolCommand({
            workingDir: resolvedWorkDir,
            command: options.verb as NativeToolCommandType,
            args: cleanArgs,
          });
          if (nativeRes.ok) {
            sendLog('info', nativeRes.stdout);
          } else {
            sendLog('warn', nativeRes.stderr);
          }
          return {
            ok: nativeRes.ok,
            exitCode: nativeRes.exitCode,
            stdout: nativeRes.stdout,
            stderr: nativeRes.stderr,
            writtenTagPaths: nativeRes.writtenTagPaths,
            writtenMapPath: nativeRes.writtenMapPath,
            wrlErrors: nativeRes.wrlErrors,
            wrlPath: nativeRes.wrlPath,
            executionEngine: 'native' as const,
            message: nativeRes.ok ? undefined : nativeRes.stderr,
          };
        }

        let toolExe = options.toolExePath;
        if (!toolExe || !fs.existsSync(toolExe)) {
          const candidates = [
            path.join(resolvedWorkDir, 'tool.exe'),
            path.join(resolvedWorkDir, 'tool_pro.exe'),
            getSettings().openCeDirectory ? path.join(getSettings().openCeDirectory!, 'tool.exe') : '',
          ].filter((p) => p && fs.existsSync(p));
          toolExe = candidates[0];
        }
        if (!toolExe || !fs.existsSync(toolExe)) {
          if (!mainWindow) return { ok: false, message: 'tool.exe not found.' };
          const pick = await dialog.showOpenDialog(mainWindow, {
            title: 'Locate Halo Editing Kit tool.exe...',
            filters: [{ name: 'Executable (*.exe)', extensions: ['exe'] }],
            properties: ['openFile'],
          });
          if (pick.canceled || !pick.filePaths[0]) {
            return { ok: false, message: 'Cancelled locating tool.exe.' };
          }
          toolExe = pick.filePaths[0];
        }

        const fullArgs = [options.verb, ...options.args.filter((a) => a.trim().length > 0)];
        sendLog('info', `Running external tool.exe: "${toolExe}" ${fullArgs.join(' ')}`);

        return await new Promise<{
          ok: boolean;
          exitCode: number | null;
          stdout: string;
          stderr: string;
          debugTxtTail?: string;
          message?: string;
          executionEngine: 'external_exe';
        }>((resolve) => {
          const child = spawn(toolExe!, fullArgs, {
            cwd: resolvedWorkDir || path.dirname(toolExe!),
            windowsHide: true,
          });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
          });
          child.on('error', (err) => {
            resolve({ ok: false, exitCode: null, stdout, stderr, message: err.message, executionEngine: 'external_exe' });
          });
          child.on('close', (code) => {
            let debugTxtTail: string | undefined;
            const debugTxtPath = path.join(resolvedWorkDir || path.dirname(toolExe!), 'debug.txt');
            if (fs.existsSync(debugTxtPath)) {
              try {
                const raw = fs.readFileSync(debugTxtPath, 'utf8');
                debugTxtTail = raw.slice(-4096);
              } catch {
                /* ignore */
              }
            }
            resolve({
              ok: code === 0,
              exitCode: code,
              stdout,
              stderr,
              debugTxtTail,
              executionEngine: 'external_exe',
            });
          });
        });
      } catch (err) {
        return {
          ok: false,
          exitCode: null,
          stdout: '',
          stderr: '',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle('baboon:dropTagToExternalWindow', async (_evt, absoluteTagPath: string) => {
    try {
      if (!fs.existsSync(absoluteTagPath)) {
        return { ok: false, message: `Tag file does not exist on disk: ${absoluteTagPath}` };
      }
      // Copy path to clipboard and invoke Guerilla/Sapien open or Shell reveal so user can immediately open/drop into Sapien/Guerilla
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$sc = New-Object System.Collections.Specialized.StringCollection
$sc.Add('${absoluteTagPath.replace(/'/g, "''")}')
[System.Windows.Forms.Clipboard]::SetFileDropList($sc)
$proc = Get-Process | Where-Object { $_.ProcessName -match 'sapien|guerilla|mek|mozzarilla|baboon' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
  $sig = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);'
  $t = Add-Type -MemberDefinition $sig -Name Win32Fg -Namespace OpenCEMantle -PassThru
  $t::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  Write-Output $proc.MainWindowTitle
} else {
  Write-Output "CLIPBOARD_ONLY"
}
`;
      const out = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', psScript], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      const targetWindowTitle = out === 'CLIPBOARD_ONLY' ? 'Clipboard FileDropList (Sapien/Guerilla ready for Ctrl+V)' : out;
      sendLog('info', `Prepared CF_HDROP file drop for "${path.basename(absoluteTagPath)}" -> ${targetWindowTitle}`);
      return { ok: true, targetWindowTitle };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('app:checkForUpdates', async () => {
    const curVer = getAppDisplayVersion();
    const res = await checkForGitHubUpdates(curVer);
    if (res.ok && res.updateAvailable) {
      sendLog(
        'info',
        `Update available: OpenCE Mantle v${res.latestVersion} (current: v${res.currentVersion}).`,
      );
    }
    return res;
  });

  ipcMain.handle('app:setCheckForUpdatesOnLaunch', (_evt, enabled: boolean) => {
    const val = Boolean(enabled);
    setCheckForUpdatesOnLaunch(val);
    return { ok: true, checkForUpdatesOnLaunch: val };
  });

  ipcMain.handle('app:setAutoDownloadUpdates', (_evt, enabled: boolean) => {
    const val = Boolean(enabled);
    setAutoDownloadUpdates(val);
    return { ok: true, autoDownloadUpdates: val };
  });

  ipcMain.handle('app:setSkippedUpdateVersion', (_evt, version: string | null) => {
    const val = version ? String(version).trim() : null;
    setSkippedUpdateVersion(val);
    return { ok: true, skippedUpdateVersion: val };
  });

  ipcMain.handle(
    'app:downloadUpdate',
    async (
      _evt,
      options?: {
        mode?: 'auto' | 'installer' | 'portable';
        assetUrl?: string;
        assetName?: string;
        version?: string;
      },
    ) => {
      const curVer = getAppDisplayVersion();
      sendLog('info', `Downloading OpenCE Mantle update in background...`);
      const res = await downloadUpdateAsset(curVer, options, (progress) => {
        mainWindow?.webContents.send('app:updateDownloadProgress', progress);
      });
      if (res.ok) {
        sendLog(
          'info',
          `Update downloaded and ready (${res.assetName}, ${(res.sizeBytes / (1024 * 1024)).toFixed(1)} MB). Click "Restart to Apply" to install.`,
        );
      } else {
        sendLog('warn', `Update download failed: ${res.error}`);
      }
      return res;
    },
  );

  ipcMain.handle(
    'app:applyUpdateAndRestart',
    async (_evt, downloadedFilePath?: string, installMode?: 'installer' | 'portable') => {
      if (!(await confirmUnsavedChanges(unsavedChangesDeps))) {
        return { ok: false, message: 'Cancelled by user.' };
      }
      const spawned = spawnUpdateApplyScript(downloadedFilePath, installMode);
      if (!spawned.ok) {
        return spawned;
      }
      currentMapModified = false; // prevent duplicate close prompt
      setTimeout(() => {
        app.quit();
      }, 150);
      return { ok: true };
    },
  );

  ipcMain.handle('app:openExternalUrl', async (_evt, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      return { ok: false, message: 'Only HTTPS URLs are permitted.' };
    }
    try {
      const parsed = new URL(url);
      const allowedHosts = new Set([
        'github.com',
        'objects.githubusercontent.com',
        'release-assets.githubusercontent.com',
        'discord.com',
        'discord.gg',
        'halostats.cc',
        'www.halostats.cc',
      ]);
      if (!allowedHosts.has(parsed.hostname)) {
        return { ok: false, message: `Host ${parsed.hostname} is not in the allowed release domain list.` };
      }
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  // --- v0.6.9 Frameless Window Controls, Theme Engine, Recent Map Cards & Multi-Monitor Tab Tear-Off ---
  ipcMain.handle('window:minimize', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender) ?? mainWindow;
    win?.minimize();
  });

  ipcMain.handle('window:toggleMaximize', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender) ?? mainWindow;
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return win.isMaximized();
  });

  ipcMain.handle('window:close', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender) ?? mainWindow;
    win?.close();
  });

  ipcMain.handle('window:isMaximized', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender) ?? mainWindow;
    return win?.isMaximized() ?? false;
  });

  ipcMain.handle('settings:getTheme', () => {
    return getSettings().theme ?? 'dark';
  });

  ipcMain.handle('settings:setTheme', (_evt, theme: AppThemeId) => {
    setAppTheme(theme);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('settings:themeChanged', theme);
      }
    }
    return { ok: true as const, theme };
  });

  ipcMain.handle('recentMaps:getCards', () => {
    return getRecentMapCards();
  });

  ipcMain.handle('recentMaps:togglePin', (_evt, filePath: string) => {
    return togglePinRecentMap(filePath);
  });

  ipcMain.handle('recentMaps:remove', (_evt, filePath: string) => {
    return removeRecentMapEntry(filePath);
  });

  ipcMain.handle('recentMaps:revealInExplorer', (_evt, filePath: string) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(path.resolve(filePath));
    }
  });

  ipcMain.handle('map:listOpenSessions', () => {
    return {
      activeSessionId: activeMapSessionId,
      sessions: Array.from(openMapSessions.values()),
    };
  });

  ipcMain.handle('map:switchActiveSession', (_evt, sessionId: string) => {
    return switchActiveMapSessionFlow(sessionId);
  });

  ipcMain.handle('map:closeSession', (_evt, sessionId: string) => {
    return closeMapSessionFlow(sessionId);
  });

  ipcMain.handle(
    'window:detachMapTab',
    async (_evt, sessionId: string, coords?: { screenX?: number; screenY?: number }) => {
      const session = openMapSessions.get(sessionId);
      if (!session) return { ok: false };
      const existingWin = detachedWindows.get(sessionId);
      if (existingWin && !existingWin.isDestroyed()) {
        existingWin.focus();
        return { ok: true, windowId: existingWin.id };
      }
      const detWin = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 860,
        minHeight: 540,
        x: typeof coords?.screenX === 'number' ? Math.max(0, Math.round(coords.screenX - 240)) : undefined,
        y: typeof coords?.screenY === 'number' ? Math.max(0, Math.round(coords.screenY - 24)) : undefined,
        frame: false,
        autoHideMenuBar: true,
        backgroundColor: '#0d1117',
        icon: getAppIconPath(),
        title: `${session.fileName} - OpenCE Mantle (Detached Window)`,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      detWin.setMenuBarVisibility(false);
      detWin.on('maximize', () => {
        if (!detWin.isDestroyed()) detWin.webContents.send('window:maximizedChanged', true);
      });
      detWin.on('unmaximize', () => {
        if (!detWin.isDestroyed()) detWin.webContents.send('window:maximizedChanged', false);
      });
      detachedWindows.set(sessionId, detWin);
      session.detachedWindowId = detWin.id;
      openMapSessions.set(sessionId, session);
      broadcastOpenMapSessions();

      detWin.on('closed', () => {
        detachedWindows.delete(sessionId);
        const cur = openMapSessions.get(sessionId);
        if (cur) {
          cur.detachedWindowId = null;
          openMapSessions.set(sessionId, cur);
        }
        broadcastOpenMapSessions();
      });

      if (isDev) {
        await detWin.loadURL(`http://localhost:5173/?detachedSessionId=${encodeURIComponent(sessionId)}`);
      } else {
        await detWin.loadFile(path.join(__dirname, '../dist/index.html'), {
          query: { detachedSessionId: sessionId },
        });
      }
      return { ok: true, windowId: detWin.id };
    },
  );

  ipcMain.handle('window:redockMapTab', async (_evt, sessionId: string) => {
    const detWin = detachedWindows.get(sessionId);
    if (detWin && !detWin.isDestroyed()) {
      detWin.close();
    }
    detachedWindows.delete(sessionId);
    const cur = openMapSessions.get(sessionId);
    if (cur) {
      cur.detachedWindowId = null;
      openMapSessions.set(sessionId, cur);
    }
    await switchActiveMapSessionFlow(sessionId);
    mainWindow?.focus();
    return { ok: true };
  });

  // Ensure any previous uncleaned init.txt from crashes is restored to normal
  try {
    tagTestRunner.restoreInitBackupIfPresent();
  } catch {
    /* best effort */
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  tagTestRunner.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Drag-and-drop of a .map file onto the window dock/taskbar icon (macOS/Windows "open with").
app.on('open-file', (_event, filePath) => {
  if (fs.existsSync(filePath)) {
    openMapGuarded(filePath).then((r) => r && mainWindow?.webContents.send('map:loaded', r));
  }
});

"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/main.ts
var import_electron2 = require("electron");
var path3 = __toESM(require("path"));
var fs2 = __toESM(require("fs"));

// electron/recent-maps.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_electron = require("electron");
var MAX_RECENT = 10;
function storePath() {
  return path.join(import_electron.app.getPath("userData"), "recent-maps.json");
}
function getRecentMaps() {
  try {
    const raw = fs.readFileSync(storePath(), "utf-8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => typeof p === "string" && fs.existsSync(p)) : [];
  } catch {
    return [];
  }
}
function addRecentMap(filePath) {
  const current = getRecentMaps().filter((p) => p !== filePath);
  const updated = [filePath, ...current].slice(0, MAX_RECENT);
  try {
    fs.writeFileSync(storePath(), JSON.stringify(updated, null, 2));
  } catch {
  }
  return updated;
}

// electron/worker-task.ts
var import_worker_threads = require("worker_threads");
var path2 = __toESM(require("path"));
var import_crypto = require("crypto");
function runMapWorkerTask(task, onProgress) {
  const taskId = (0, import_crypto.randomUUID)();
  const worker = new import_worker_threads.Worker(path2.join(__dirname, "map-worker.js"));
  return new Promise((resolve, reject) => {
    worker.on("message", (msg) => {
      if (msg.taskId !== taskId) return;
      if (msg.type === "progress") {
        onProgress(msg.stage, msg.percent);
      } else if (msg.type === "result") {
        resolve(msg.payload);
        worker.terminate();
      } else if (msg.type === "error") {
        reject(new Error(msg.message));
        worker.terminate();
      }
    });
    worker.on("error", (err) => {
      reject(err);
      worker.terminate();
    });
    worker.postMessage({ ...task, taskId });
  });
}

// electron/main.ts
var mainWindow = null;
var currentMapPath = null;
var currentMapCompressed = false;
var isDev = !import_electron2.app.isPackaged;
function sendLog(level, message) {
  mainWindow?.webContents.send("app:log", { level, message, timestamp: Date.now() });
}
function createWindow() {
  mainWindow = new import_electron2.BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#15171c",
    webPreferences: {
      preload: path3.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path3.join(__dirname, "../dist/index.html"));
  }
  buildMenu();
}
async function loadMapAtPath(filePath) {
  sendLog("info", `Opening ${filePath}`);
  try {
    const result = await runMapWorkerTask({ type: "inspect", filePath }, (stage, percent) => {
      mainWindow?.webContents.send("map:progress", { taskId: "load", stage, percent });
    });
    if (result.status === "ok") {
      currentMapPath = filePath;
      currentMapCompressed = false;
      addRecentMap(filePath);
      buildMenu();
      sendLog("info", `Parsed "${result.header.scenarioName}" - ${result.tags.length} tags`);
    } else if (result.status === "compressed") {
      currentMapPath = filePath;
      currentMapCompressed = true;
      addRecentMap(filePath);
      buildMenu();
      sendLog("warn", "This map is compressed - decompress it to browse tags.");
    } else if (result.status === "unsupported") {
      currentMapPath = null;
      sendLog("error", result.message);
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendLog("error", `Failed to open map: ${message}`);
    return { status: "error", message };
  }
}
async function openMapFlow() {
  if (!mainWindow) return;
  const { canceled, filePaths } = await import_electron2.dialog.showOpenDialog(mainWindow, {
    title: "Open Halo CE Map",
    filters: [{ name: "Halo CE Map", extensions: ["map"] }],
    properties: ["openFile"]
  });
  if (canceled || filePaths.length === 0) return;
  const result = await loadMapAtPath(filePaths[0]);
  mainWindow.webContents.send("map:loaded", result);
}
async function decompressFlow() {
  if (!mainWindow || !currentMapPath) return;
  const defaultPath = currentMapPath.replace(/\.map$/i, "_decompressed.map");
  const { canceled, filePath } = await import_electron2.dialog.showSaveDialog(mainWindow, {
    title: "Save decompressed map as",
    defaultPath,
    filters: [{ name: "Halo CE Map", extensions: ["map"] }]
  });
  if (canceled || !filePath) return null;
  sendLog("info", `Decompressing ${currentMapPath} -> ${filePath}`);
  const result = await runMapWorkerTask(
    { type: "decompress", filePath: currentMapPath, outputPath: filePath },
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "decompress", stage, percent })
  );
  sendLog("info", `Decompressed: ${result.originalSize} -> ${result.newSize} bytes`);
  return result;
}
async function recompressFlow() {
  if (!mainWindow || !currentMapPath) return;
  const defaultPath = currentMapPath.replace(/\.map$/i, "_compressed.map");
  const { canceled, filePath } = await import_electron2.dialog.showSaveDialog(mainWindow, {
    title: "Save recompressed map as",
    defaultPath,
    filters: [{ name: "Halo CE Map", extensions: ["map"] }]
  });
  if (canceled || !filePath) return null;
  sendLog("info", `Compressing ${currentMapPath} -> ${filePath}`);
  const result = await runMapWorkerTask(
    { type: "compress", filePath: currentMapPath, outputPath: filePath },
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "compress", stage, percent })
  );
  sendLog("info", `Compressed: ${result.originalSize} -> ${result.newSize} bytes`);
  return result;
}
function buildMenu() {
  const recents = getRecentMaps();
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Open Map...", accelerator: "CmdOrCtrl+O", click: () => openMapFlow() },
        { label: "Save As...", click: () => mainWindow?.webContents.send("menu:action", "save-as-stub") },
        {
          label: "Recent Maps",
          submenu: recents.length > 0 ? recents.map((p) => ({ label: p, click: () => loadMapAtPath(p).then((r) => mainWindow?.webContents.send("map:loaded", r)) })) : [{ label: "(none yet)", enabled: false }]
        },
        { type: "separator" },
        { label: "Exit", role: "quit" }
      ]
    },
    {
      label: "Tools",
      submenu: [
        { label: "Decompress Map", click: () => decompressFlow() },
        { label: "Recompress Map", click: () => recompressFlow() },
        { type: "separator" },
        { label: "Extract Tags...", click: () => mainWindow?.webContents.send("menu:action", "extract-stub") },
        { label: "Inject Tags...", click: () => mainWindow?.webContents.send("menu:action", "inject-stub") }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About OpenCE Modding Tool",
          click: () => import_electron2.dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "About",
            message: `OpenCE Modding Tool v${import_electron2.app.getVersion()}`,
            detail: "A free, non-commercial GUI tool for modding Halo: Custom Edition (PC, version 609) maps.\n\nFormat references (GPL, not bundled): Invader, Reclaimer, Refinery, Mozzarilla, supyr_struct.\nCompression reference: Chimera.\nTarget runtime: OpenCE (OpenCommunityEdition/OpenCE).\n\nNo Bungie/Microsoft assets are bundled; this tool only operates on files you supply."
          })
        },
        {
          label: "View format references",
          click: () => import_electron2.shell.openExternal("https://github.com/SnowyMouse/invader/wiki")
        }
      ]
    }
  ];
  import_electron2.Menu.setApplicationMenu(import_electron2.Menu.buildFromTemplate(template));
}
import_electron2.app.whenReady().then(() => {
  import_electron2.ipcMain.handle("dialog:openMap", async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await import_electron2.dialog.showOpenDialog(mainWindow, {
      title: "Open Halo CE Map",
      filters: [{ name: "Halo CE Map", extensions: ["map"] }],
      properties: ["openFile"]
    });
    if (canceled || filePaths.length === 0) return null;
    return loadMapAtPath(filePaths[0]);
  });
  import_electron2.ipcMain.handle("map:load", (_e, filePath) => loadMapAtPath(filePath));
  import_electron2.ipcMain.handle("map:decompress", () => decompressFlow());
  import_electron2.ipcMain.handle("map:recompress", () => recompressFlow());
  import_electron2.ipcMain.handle("app:version", () => import_electron2.app.getVersion());
  import_electron2.ipcMain.handle("app:recentMaps", () => getRecentMaps());
  import_electron2.ipcMain.on("app:notImplemented", (_e, feature) => sendLog("warn", `${feature} is not implemented yet (coming in a later milestone).`));
  createWindow();
  import_electron2.app.on("activate", () => {
    if (import_electron2.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
import_electron2.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron2.app.quit();
});
import_electron2.app.on("open-file", (_event, filePath) => {
  if (fs2.existsSync(filePath)) {
    loadMapAtPath(filePath).then((r) => mainWindow?.webContents.send("map:loaded", r));
  }
});
//# sourceMappingURL=main.js.map

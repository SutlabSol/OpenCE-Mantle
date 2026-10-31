import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';
import type {
  TagTestStatus,
  TagTestLaunchOptions,
  TagTestLogEntry,
  StageTagTestMapResult,
  LiveMemoryPatch,
  LiveHudSessionSetupInfo,
} from './shared-types';
import { getSettings, detectOpenCeDirectory } from './settings';
import { sendWorkerRequest } from './worker-manager';

export class TagTestRunner {
  private child: ChildProcess | null = null;
  private memBridgeProc: ChildProcess | null = null;
  private telnetSocket: net.Socket | null = null;
  private telnetConnected = false;
  private statusState: TagTestStatus['state'] = 'stopped';
  private lastError: string | undefined;
  private stagedMapIndex = 0; // Ping-pong 0 = a, 1 = b
  private currentMapName: string | undefined;
  private activeOpenCeDir: string | null = null;
  private debugTxtWatcher: NodeJS.Timeout | null = null;
  private debugTxtLastSize = 0;
  private haloAlwaysOnTop = false;
  private liveHudMode = false;
  private liveHudSetup: LiveHudSessionSetupInfo | null = null;
  private arsenalSpawnedForCurrentLoad = false;
  private unitSpawned = false;
  private heldWeaponTagId: number | null = null;
  private drivenVehicleTagId: number | null = null;
  private haloWindowRect: { left: number; top: number; width: number; height: number } | null = null;
  private stagedMapLoading = false;
  private stagedMapLoaded = false;
  private mainMenuMusicStarted = false;
  private launchTimeMs = 0;
  private initRestoreTimer: NodeJS.Timeout | null = null;

  public setHaloAlwaysOnTop(topmost: boolean): void {
    this.haloAlwaysOnTop = topmost;
    const flag = topmost ? '-1' : '-2';
    const script = `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
  }
"@ -ErrorAction SilentlyContinue
$procs = Get-Process -Name 'halo' -ErrorAction SilentlyContinue
foreach ($p in $procs) {
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    [Win32]::SetWindowPos($p.MainWindowHandle, [IntPtr](${flag}), 0, 0, 0, 0, 0x0053)
  }
}
`;
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  public isHaloAlwaysOnTop(): boolean {
    return this.haloAlwaysOnTop;
  }

  public triggerFlycamToggle(): void {
    // In Halo CE devmode, Backspace cycles First Person -> Orbiting -> Free Flying Camera
    const script = `
$wshell = New-Object -ComObject wscript.shell
if ($wshell.AppActivate('Halo')) {
  Start-Sleep -Milliseconds 50
  $wshell.SendKeys('{BACKSPACE}')
}
`;
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  private statusListeners: Array<(status: TagTestStatus) => void> = [];
  private logListeners: Array<(entry: TagTestLogEntry) => void> = [];

  public onStatusChange(cb: (status: TagTestStatus) => void): () => void {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== cb);
    };
  }

  public onLog(cb: (entry: TagTestLogEntry) => void): () => void {
    this.logListeners.push(cb);
    return () => {
      this.logListeners = this.logListeners.filter((l) => l !== cb);
    };
  }

  public getStatus(): TagTestStatus {
    return {
      state: this.statusState,
      pid: this.child?.pid,
      telnetConnected: this.telnetConnected,
      error: this.lastError,
      mapName: this.currentMapName,
      liveHudMode: this.liveHudMode,
      heldWeaponTagId: this.heldWeaponTagId,
      drivenVehicleTagId: this.drivenVehicleTagId,
      haloWindowRect: this.haloWindowRect,
    };
  }

  private emitStatus(): void {
    const s = this.getStatus();
    for (const cb of this.statusListeners) {
      try {
        cb(s);
      } catch {
        /* ignore listener error */
      }
    }
  }

  private emitLog(source: TagTestLogEntry['source'], text: string): void {
    if (!text || !text.trim()) return;
    const entry: TagTestLogEntry = {
      source,
      text: text.trimEnd(),
      timestamp: Date.now(),
    };

    // Regex check for tag link (e.g. "tag 2569", or "weapons\assault rifle\assault rifle")
    const tagMatch = text.match(/\(tag\s+(\d+)/i);
    if (tagMatch) {
      entry.tagIndexLink = parseInt(tagMatch[1], 10);
    }
    const tagRegex = /(?:'([^']+)'|((?:weapons|vehicles|levels|scenery|sound|characters|ui|globals|devices|items|effects)\\[a-zA-Z0-9_\-\\ ]+?))(?=\s+(?:names|has|is|was|cannot|could|failed|lies|error|checked)|\s*$|['",])/i;
    const pathMatch = text.match(tagRegex);
    if (pathMatch) {
      const candidate = (pathMatch[1] ?? pathMatch[2] ?? '').trim();
      if (candidate && !candidate.startsWith('d:\\') && !candidate.startsWith('custom_maps\\') && candidate.includes('\\')) {
        entry.tagPathLink = candidate;
      }
    }

    for (const cb of this.logListeners) {
      try {
        cb(entry);
      } catch {
        /* ignore listener error */
      }
    }

    // Track when the staged map starts and finishes loading in Single Player Dev Mode
    if (
      text.includes("loading 'd:\\custom_maps\\_opence_tag_test") ||
      text.includes("init: map_name") ||
      text.includes("starting precaching of map custom_maps\\_opence_tag_test")
    ) {
      this.stagedMapLoading = true;
      if (this.activeOpenCeDir) {
        this.restoreInitForDir(this.activeOpenCeDir);
      }
    }
    if (
      this.stagedMapLoading &&
      ((text.includes("structure culling:") && !text.includes("for 0 surfaces")) ||
        text.includes("the saved game is not taken:") ||
        text.includes("custom edition: the structure BSP") ||
        text.includes("loaded ") && text.includes(" tags cleanly"))
    ) {
      this.stagedMapLoaded = true;
    }

    // Fallback: if ui.map finished initial boot ("starting main menu music") and the staged map hasn't started loading yet,
    // immediately trigger `map_name custom_maps\<slot>` over Telnet so OpenCE boots straight into Single Player Dev Mode.
    if (
      !this.stagedMapLoaded &&
      !this.stagedMapLoading &&
      text.includes("starting main menu music")
    ) {
      this.mainMenuMusicStarted = true;
      setTimeout(() => {
        if (!this.stagedMapLoaded && !this.stagedMapLoading) {
          this.triggerBootMapLoad();
        }
      }, 150);
      return;
    }

    // Auto-close tag test ONLY when the player quits back to main menu AFTER the staged map has already loaded
    if (
      this.statusState === 'running' &&
      this.stagedMapLoaded &&
      Date.now() - this.launchTimeMs > 4000 &&
      (text.includes("loading 'd:\\ui.map'") ||
        text.includes("this is 'levels\\ui\\ui'") ||
        text.includes("game_dispose") ||
        text.includes("stop_game") ||
        text.includes("starting main menu music"))
    ) {
      setTimeout(() => {
        if (this.statusState === 'running') {
          void this.stop();
        }
      }, 300);
    }
  }

  private triggerBootMapLoad(): void {
    if (!this.telnetConnected || !this.currentMapName || this.stagedMapLoading || this.stagedMapLoaded) return;
    this.stagedMapLoading = true;
    const hsCmd = `map_name custom_maps\\${this.currentMapName}`;
    this.emitLog('stdout', `[TagTest] Launching Single-Player Dev Mode via Telnet: ${hsCmd}`);
    this.sendCommand(hsCmd);
  }

  public getOpenCeConfig(): { directory: string | null; executable: string | null; exists: boolean } {
    const settings = getSettings();
    let dir = settings.openCeDirectory;
    if (!dir) {
      dir = detectOpenCeDirectory();
    }
    if (!dir) {
      return { directory: null, executable: null, exists: false };
    }
    let exe = path.join(dir, 'halo.exe');
    if (!fs.existsSync(exe)) {
      const faberExe = path.join(dir, 'OpenCE - Faber.exe');
      if (fs.existsSync(faberExe)) {
        exe = faberExe;
      }
    }
    const exists = fs.existsSync(exe);
    return { directory: dir, executable: exe, exists };
  }

  private restoreInitForDir(dir: string): void {
    if (this.initRestoreTimer) {
      clearTimeout(this.initRestoreTimer);
      this.initRestoreTimer = null;
    }
    const scriptPath = path.join(dir, '_opence_tag_test.txt');
    try {
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }
    } catch {
      /* best effort */
    }

    const initPath = path.join(dir, 'init.txt');
    const backupPath = path.join(dir, 'init.txt.opence_backup');
    try {
      if (fs.existsSync(backupPath)) {
        const backupContent = fs.readFileSync(backupPath, 'utf-8');
        if (!backupContent.includes('_opence_tag_test')) {
          fs.copyFileSync(backupPath, initPath);
        } else if (fs.existsSync(initPath)) {
          fs.unlinkSync(initPath);
        }
        fs.unlinkSync(backupPath);
      } else if (fs.existsSync(initPath)) {
        const content = fs.readFileSync(initPath, 'utf-8');
        if (
          content.includes('_opence_tag_test') ||
          (content.includes('game_console_log all') && content.includes('display_framerate true'))
        ) {
          fs.unlinkSync(initPath);
        }
      }
    } catch {
      /* best effort */
    }
  }

  public restoreInitBackupIfPresent(): void {
    const dirs = new Set<string>();
    if (this.activeOpenCeDir) dirs.add(this.activeOpenCeDir);
    const cfg = this.getOpenCeConfig();
    if (cfg.directory) dirs.add(cfg.directory);
    for (const candidate of [
      'C:\\Users\\LeviB\\Desktop\\Halo CE Related\\OpenCE',
      'C:\\Users\\LeviB\\Desktop\\Halo CE Related\\Halo CE',
      'C:\\Users\\LeviB\\Desktop\\Halo CE Related\\Halo CE - OpenCE',
      'C:\\Users\\LeviB\\Desktop\\Halo CE Related\\CoreCE',
    ]) {
      if (fs.existsSync(candidate)) dirs.add(candidate);
    }
    for (const dir of dirs) {
      this.restoreInitForDir(dir);
    }
  }

  public async launch(options: TagTestLaunchOptions = {}): Promise<{ ok: boolean; error?: string }> {
    if (this.statusState === 'running') {
      if (options.liveHudMode && !this.liveHudMode) {
        this.liveHudMode = true;
        return this.hotReload();
      }
      if (options.liveHudMode && this.liveHudMode) {
        return { ok: true };
      }
      return { ok: false, error: 'OpenCE is already running.' };
    }
    if (this.statusState === 'launching') {
      return { ok: false, error: 'OpenCE is currently launching.' };
    }

    const cfg = this.getOpenCeConfig();
    if (!cfg.exists || !cfg.directory || !cfg.executable) {
      const err = 'OpenCE installation not found (halo.exe missing). Please set the OpenCE directory in Settings.';
      this.lastError = err;
      this.emitStatus();
      return { ok: false, error: err };
    }

    const openCeDir = cfg.directory;
    const haloExe = cfg.executable;
    this.activeOpenCeDir = openCeDir;
    this.liveHudMode = Boolean(options.liveHudMode);
    this.arsenalSpawnedForCurrentLoad = false;
    this.unitSpawned = false;
    this.stagedMapLoading = false;
    this.stagedMapLoaded = false;
    this.mainMenuMusicStarted = false;
    this.launchTimeMs = Date.now();
    if (this.initRestoreTimer) {
      clearTimeout(this.initRestoreTimer);
      this.initRestoreTimer = null;
    }
    this.heldWeaponTagId = null;
    this.drivenVehicleTagId = null;
    this.statusState = 'launching';
    this.lastError = undefined;
    this.emitStatus();

    try {
      // 1. Stage in-memory map to custom_maps\_opence_tag_test_a.map
      const mapSlot = this.stagedMapIndex === 0 ? '_opence_tag_test_a' : '_opence_tag_test_b';
      const stagedMapPath = path.join(openCeDir, 'custom_maps', `${mapSlot}.map`);
      this.currentMapName = mapSlot;

      this.emitLog('stdout', `[TagTest] Staging in-memory map to ${mapSlot}.map${this.liveHudMode ? ' (Live HUD Arsenal enabled)' : ''}...`);
      const settings = getSettings();
      const stageResult = await sendWorkerRequest<StageTagTestMapResult>(
        {
          type: 'stageTagTestMap',
          targetPath: stagedMapPath,
          bitmapsPath: settings.resourceMaps.bitmaps ?? undefined,
          soundsPath: settings.resourceMaps.sounds ?? undefined,
          liveHudMode: this.liveHudMode,
        },
        (_level, msg) => this.emitLog('stdout', `[Worker] ${msg}`),
      ).promise;

      if (!stageResult || !stageResult.ok) {
        throw new Error('Failed to stage map for OpenCE.');
      }
      this.liveHudSetup = stageResult.liveHudSetup ?? null;
      this.emitLog('stdout', `[TagTest] Map staged successfully (CRC32 0x${(stageResult.crc32 >>> 0).toString(16).padStart(8, '0')}).`);

      // 2. Prepare init.txt for boot map loading
      // Halo CE does NOT support -exec from command line; it strictly executes init.txt on boot.
      this.restoreInitBackupIfPresent();
      const initPath = path.join(openCeDir, 'init.txt');
      const backupPath = path.join(openCeDir, 'init.txt.opence_backup');
      if (fs.existsSync(initPath)) {
        try {
          const existing = fs.readFileSync(initPath, 'utf-8');
          if (!existing.includes('_opence_tag_test')) {
            fs.copyFileSync(initPath, backupPath);
          }
        } catch {
          /* best effort */
        }
      }
      const initContent = `display_framerate true\r\nmap_name custom_maps\\${mapSlot}\r\n`;
      fs.writeFileSync(initPath, initContent, 'utf-8');

      // 3. Track debug.txt size so we only report new logs
      const debugTxtPath = path.join(openCeDir, 'debug.txt');
      if (fs.existsSync(debugTxtPath)) {
        this.debugTxtLastSize = fs.statSync(debugTxtPath).size;
      } else {
        this.debugTxtLastSize = 0;
      }

      // 4. Spawn halo.exe
      const env = {
        ...process.env,
        HALO_TELNET_CONSOLE: '1',
        HALO_TELNET_CONSOLE_PORT: '2323',
        HALO_CONSOLE_LOG: 'all',
        HALO_DISPLAY_MODE: options.windowed !== false ? 'windowed' : 'fullscreen',
        HALO_WINDOW_SIZE: '1280x960',
        HALO_UPDATE_ANSWER: 'no',
      };

      const spawnArgs = ['-window', '-vidmode', '1280,960', '-console', '-devmode'];
      this.emitLog('stdout', `[TagTest] Spawning ${haloExe} ${spawnArgs.join(' ')}...`);
      const child = spawn(haloExe, spawnArgs, {
        cwd: openCeDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      if (child.pid) {
        try {
          this.startMemoryBridge(child.pid);
        } catch (bridgeErr) {
          const bMsg = bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr);
          this.emitLog('stdout', `[TagTest Warning] Memory bridge failed to start: ${bMsg}`);
        }
      }

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          if (line.trim()) this.emitLog('stdout', line);
        }
      });

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          if (line.trim()) this.emitLog('stdout', `[stderr] ${line}`);
        }
      });

      child.on('error', (err) => {
        this.emitLog('stdout', `[TagTest Error] Process error: ${err.message}`);
        this.lastError = err.message;
        this.cleanup();
      });

      child.on('exit', (code) => {
        this.emitLog('stdout', `[TagTest] OpenCE exited with code ${code ?? 0}.`);
        this.cleanup();
      });

      // 5. Start debug.txt watcher
      this.startDebugWatcher(debugTxtPath);

      // 6. Connect to Telnet socket (port 2323) with retries
      this.connectTelnet('127.0.0.1', 2323);

      // 7. If Stay on Top is enabled, make halo.exe window topmost once created
      setTimeout(() => {
        if (this.child && this.haloAlwaysOnTop) {
          this.setHaloAlwaysOnTop(true);
        }
      }, 1200);

      // 8. Safety fallback: restore/remove temporary init.txt after 60s if debug.txt didn't already trigger cleanup
      this.initRestoreTimer = setTimeout(() => {
        this.restoreInitForDir(openCeDir);
      }, 60000);

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.cleanup();
      return { ok: false, error: msg };
    }
  }

  private connectTelnet(host: string, port: number): void {
    let attempts = 0;
    const maxAttempts = 50; // Try for up to 15 seconds (every 300ms)
    let connected = false;

    const tryConnect = () => {
      if (this.child === null || connected) return;
      attempts++;

      const sock = new net.Socket();
      sock.setTimeout(1000);

      sock.on('connect', () => {
        connected = true;
        this.telnetSocket = sock;
        this.telnetConnected = true;
        this.statusState = 'running';
        this.emitStatus();
        this.emitLog('telnet', '[Telnet Bridge] Connected to OpenCE telnet console on port 2323.');
        // Note: Do NOT delete init.txt or spam map_name here!
        // telnet_console_initialize() binds port 2323 inside game_initialize() BEFORE console_startup() reads init.txt,
        // and TELNET_CLIENT_BUFFER_SIZE is 128 bytes. Let console_startup() -> main_setup_connection() load init.txt natively.
        if (this.mainMenuMusicStarted && !this.stagedMapLoaded && !this.stagedMapLoading) {
          this.triggerBootMapLoad();
        }
        if (this.liveHudMode) {
          this.maybeAutoSpawnLiveHudArsenal();
        }
      });

      let buffer = '';
      sock.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) this.emitLog('telnet', line);
        }
      });

      sock.on('error', () => {
        sock.destroy();
        if (!connected && attempts < maxAttempts && this.child !== null) {
          setTimeout(tryConnect, 300);
        }
      });

      sock.on('close', () => {
        if (this.telnetSocket === sock) {
          this.telnetConnected = false;
          this.telnetSocket = null;
          this.emitStatus();
        }
      });

      sock.connect(port, host);
    };

    setTimeout(tryConnect, 600);
  }

  private startDebugWatcher(debugTxtPath: string): void {
    this.stopDebugWatcher();
    this.debugTxtWatcher = setInterval(() => {
      try {
        if (!fs.existsSync(debugTxtPath)) return;
        const stat = fs.statSync(debugTxtPath);
        if (stat.size > this.debugTxtLastSize) {
          const stream = fs.createReadStream(debugTxtPath, {
            start: this.debugTxtLastSize,
            end: stat.size,
            encoding: 'utf-8',
          });
          this.debugTxtLastSize = stat.size;
          let content = '';
          stream.on('data', (d) => (content += d));
          stream.on('end', () => {
            const lines = content.split(/\r?\n/);
            for (const line of lines) {
              if (line.trim()) {
                this.emitLog('debug_txt', line);
              }
            }
          });
        } else if (stat.size < this.debugTxtLastSize) {
          // File was truncated or rotated
          this.debugTxtLastSize = stat.size;
        }
      } catch {
        /* best effort polling */
      }
    }, 500);
  }

  private stopDebugWatcher(): void {
    if (this.debugTxtWatcher) {
      clearInterval(this.debugTxtWatcher);
      this.debugTxtWatcher = null;
    }
  }

  public async hotReload(): Promise<{ ok: boolean; error?: string }> {
    if (this.statusState !== 'running' || !this.activeOpenCeDir) {
      return { ok: false, error: 'OpenCE is not running.' };
    }

    try {
      // Toggle ping-pong index: 0 -> 1 -> 0
      this.stagedMapIndex = this.stagedMapIndex === 0 ? 1 : 0;
      const nextSlot = this.stagedMapIndex === 0 ? '_opence_tag_test_a' : '_opence_tag_test_b';
      const targetPath = path.join(this.activeOpenCeDir, 'custom_maps', `${nextSlot}.map`);

      this.emitLog('stdout', `[TagTest] Hot-reloading map to ${nextSlot}.map...`);
      const settings = getSettings();
      const stageResult = await sendWorkerRequest<StageTagTestMapResult>(
        {
          type: 'stageTagTestMap',
          targetPath,
          bitmapsPath: settings.resourceMaps.bitmaps ?? undefined,
          soundsPath: settings.resourceMaps.sounds ?? undefined,
          liveHudMode: this.liveHudMode,
        },
        (_level, msg) => this.emitLog('stdout', `[Worker] ${msg}`),
      ).promise;

      if (!stageResult || !stageResult.ok) {
        throw new Error('Failed to stage updated map.');
      }

      this.liveHudSetup = stageResult.liveHudSetup ?? null;
      this.arsenalSpawnedForCurrentLoad = false;
      this.unitSpawned = false;
      this.stagedMapLoading = true;
      this.stagedMapLoaded = false;
      this.launchTimeMs = Date.now();
      this.currentMapName = nextSlot;
      // Send map_name command over telnet
      const hsCmd = `map_name custom_maps\\${nextSlot}`;
      this.emitLog('stdout', `[TagTest] Switching map in OpenCE via Telnet: ${hsCmd}`);
      const cmdRes = this.sendCommand(hsCmd);
      if (this.liveHudMode) {
        setTimeout(() => {
          this.maybeAutoSpawnLiveHudArsenal();
        }, 1200);
      }
      return cmdRes;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog('stdout', `[TagTest Hot-Reload Error] ${msg}`);
      return { ok: false, error: msg };
    }
  }

  /**
   * Starts a persistent C# P/Invoke bridge process (`HaloMemBridge`) attached to `halo.exe`:
   * - Auto-detects `GAME_STATE_BASE` (`0x81A00000` in unedited OpenCE or `0x87E00000` in Faber).
   * - Polls Player 0's held weapon `tagId`, driven vehicle `tagId`, and client screen bounds at ~8 Hz.
   * - Executes `<1ms` `WriteProcessMemory` patches (`0x40440000`-based) for 60 FPS live HUD & weapon stat edits.
   * - Blinks captured HUD elements in-game (`+4000` X offset for 1.2s).
   * - Writes full `TagReference` lists for all holdable weapons & vehicles into high tag-cache RAM (`0x41B00000` / `0x41B01000`)
   *   and equips/spawns weapons and vehicles on demand.
   */
  private startMemoryBridge(pid: number): void {
    this.stopMemoryBridge();

    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

public class HaloMemBridge {
  [DllImport("kernel32.dll")]
  public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
  [DllImport("kernel32.dll")]
  public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, int dwSize, out int lpNumberOfBytesRead);
  [DllImport("kernel32.dll")]
  public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, int nSize, out int lpNumberOfBytesWritten);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr hObject);
  [DllImport("user32.dll")]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }

  private static IntPtr hProc = IntPtr.Zero;
  private static int targetPid = 0;
  private static uint gameStateBase = 0;
  private static int blinkSeq = 0;
  private static readonly object ioLock = new object();

  private static int ReadInt32(uint addr) {
    byte[] buf = new byte[4];
    int r = 0;
    if (!ReadProcessMemory(hProc, (IntPtr)unchecked((int)addr), buf, 4, out r) || r != 4) return -1;
    return BitConverter.ToInt32(buf, 0);
  }

  private static uint ReadUInt32(uint addr) {
    byte[] buf = new byte[4];
    int r = 0;
    if (!ReadProcessMemory(hProc, (IntPtr)unchecked((int)addr), buf, 4, out r) || r != 4) return 0;
    return BitConverter.ToUInt32(buf, 0);
  }

  private static short ReadInt16(uint addr) {
    byte[] buf = new byte[2];
    int r = 0;
    if (!ReadProcessMemory(hProc, (IntPtr)unchecked((int)addr), buf, 2, out r) || r != 2) return -1;
    return BitConverter.ToInt16(buf, 0);
  }

  private static void WriteBytes(uint addr, byte[] data) {
    int w = 0;
    WriteProcessMemory(hProc, (IntPtr)unchecked((int)addr), data, data.Length, out w);
  }

  private static void WriteInt32(uint addr, int val) {
    WriteBytes(addr, BitConverter.GetBytes(val));
  }

  private static void WriteUInt32(uint addr, uint val) {
    WriteBytes(addr, BitConverter.GetBytes(val));
  }

  private static void WriteInt16(uint addr, short val) {
    WriteBytes(addr, BitConverter.GetBytes(val));
  }

  private static bool DetectGameStateBase() {
    uint[] candidates = new uint[] { 0x81A00000u, 0x87E00000u };
    byte[] sig = new byte[6];
    int r = 0;
    foreach (uint cand in candidates) {
      if (ReadProcessMemory(hProc, (IntPtr)unchecked((int)(cand + 0x116670u)), sig, 6, out r) && r == 6) {
        if (sig[0] == (byte)'o' && sig[1] == (byte)'b' && sig[2] == (byte)'j' &&
            sig[3] == (byte)'e' && sig[4] == (byte)'c' && sig[5] == (byte)'t') {
          gameStateBase = cand;
          return true;
        }
      }
    }
    return false;
  }

  private static uint GetObjectDatumPtr(int datumIndex) {
    if (datumIndex == -1 || datumIndex == 0 || gameStateBase == 0) return 0;
    uint dataPtr = ReadUInt32(gameStateBase + 0x116670u + 0x34u);
    if (dataPtr == 0) return 0;
    uint idx = (uint)(datumIndex & 0xFFFF);
    return ReadUInt32(dataPtr + idx * 12u + 8u);
  }

  private static void EmitLine(string line) {
    lock (ioLock) {
      Console.WriteLine(line);
      Console.Out.Flush();
    }
  }

  public static void Run(int pid) {
    targetPid = pid;
    // PROCESS_VM_OPERATION (0x08) | PROCESS_VM_READ (0x10) | PROCESS_VM_WRITE (0x20) | PROCESS_QUERY_INFORMATION (0x0400)
    hProc = OpenProcess(0x0438u, false, pid);
    if (hProc == IntPtr.Zero) return;

    Task.Run(() => {
      string lastJson = "";
      int[] watchedVKeys = new int[] { 0xDC, 0x26, 0x28, 0x25, 0x27, 0x0D, 0x08 };
      string[] watchedNames = new string[] { "Backslash", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Backspace" };
      bool[] prevDown = new bool[7];
      while (true) {
        try {
          Process p = Process.GetProcessById(targetPid);
          if (p == null || p.HasExited) break;

          if (gameStateBase == 0) {
            DetectGameStateBase();
          }

          bool unitSpawned = false;
          int weapTagId = -1;
          int vehTagId = -1;

          if (gameStateBase != 0) {
            int unitIdx = ReadInt32(gameStateBase + 0x2F18u + 0x04u);
            int fpWeapIdx = ReadInt32(gameStateBase + 0x2F18u + 0x08u);
            if (unitIdx != -1 && unitIdx != 0) {
              uint unitPtr = GetObjectDatumPtr(unitIdx);
              if (unitPtr != 0) {
                unitSpawned = true;
                short unitType = ReadInt16(unitPtr + 0x64u);
                int parentIdx = ReadInt32(unitPtr + 0x11Cu);
                if (unitType == 1) {
                  vehTagId = ReadInt32(unitPtr + 0x00u);
                } else if (parentIdx != -1 && parentIdx != 0) {
                  uint parentPtr = GetObjectDatumPtr(parentIdx);
                  if (parentPtr != 0) {
                    vehTagId = ReadInt32(parentPtr + 0x00u);
                  }
                }
                if (fpWeapIdx == -1 || fpWeapIdx == 0) {
                  short curSlot = ReadInt16(unitPtr + 0x2E6u);
                  if (curSlot >= 0 && curSlot < 4) {
                    fpWeapIdx = ReadInt32(unitPtr + 0x2ECu + (uint)(curSlot * 4));
                  }
                }
              }
            }
            if (fpWeapIdx != -1 && fpWeapIdx != 0) {
              uint weapPtr = GetObjectDatumPtr(fpWeapIdx);
              if (weapPtr != 0) {
                weapTagId = ReadInt32(weapPtr + 0x00u);
              }
            }
          }

          int left = 0, top = 0, width = 0, height = 0;
          IntPtr hWnd = p.MainWindowHandle;
          if (hWnd != IntPtr.Zero) {
            RECT rc;
            if (GetClientRect(hWnd, out rc)) {
              POINT pt = new POINT { X = rc.Left, Y = rc.Top };
              ClientToScreen(hWnd, ref pt);
              left = pt.X;
              top = pt.Y;
              width = Math.Max(0, rc.Right - rc.Left);
              height = Math.Max(0, rc.Bottom - rc.Top);
            }
            if (GetForegroundWindow() == hWnd) {
              for (int ki = 0; ki < watchedVKeys.Length; ki++) {
                bool isDown = (GetAsyncKeyState(watchedVKeys[ki]) & 0x8000) != 0;
                if (isDown && !prevDown[ki]) {
                  EmitLine("HUDKEY " + watchedNames[ki]);
                }
                prevDown[ki] = isDown;
              }
            } else {
              for (int ki = 0; ki < watchedVKeys.Length; ki++) prevDown[ki] = false;
            }
          }

          string json = string.Format(
            "{{\\"unitSpawned\\":{0},\\"weaponTagId\\":{1},\\"vehicleTagId\\":{2},\\"rect\\":{{\\"left\\":{3},\\"top\\":{4},\\"width\\":{5},\\"height\\":{6}}}}}",
            unitSpawned ? "true" : "false",
            weapTagId,
            vehTagId,
            left,
            top,
            width,
            height
          );
          if (json != lastJson) {
            lastJson = json;
            EmitLine("STATE " + json);
          }
        } catch {
          break;
        }
        Thread.Sleep(110);
      }
    });

    string line;
    while ((line = Console.ReadLine()) != null) {
      try {
        string trimmed = line.Trim();
        if (trimmed.Length == 0) continue;
        string[] parts = trimmed.Split(' ');
        string cmd = parts[0];

        if (cmd == "WRITE" && parts.Length >= 3) {
          uint addr = Convert.ToUInt32(parts[1], 16);
          byte[] data = Convert.FromBase64String(parts[2]);
          WriteBytes(addr, data);
        } else if (cmd == "BLINK" && parts.Length >= 3) {
          uint addr = Convert.ToUInt32(parts[1], 16);
          short origX = Convert.ToInt16(parts[2]);
          short blinkX = (short)Math.Min(short.MaxValue, origX + 4000);
          int mySeq = Interlocked.Increment(ref blinkSeq);
          WriteInt16(addr, blinkX);
          Task.Run(() => {
            Thread.Sleep(1200);
            if (blinkSeq == mySeq) {
              short cur = ReadInt16(addr);
              if (cur == blinkX) {
                WriteInt16(addr, origX);
              }
            }
          });
        } else if (cmd == "SETUP_ARSENAL" && parts.Length >= 4) {
          uint matgAddr = Convert.ToUInt32(parts[1], 16);
          string weapCsv = parts[2];
          string vehCsv = parts[3];
          if (matgAddr >= 0x40440000u) {
            if (weapCsv != "NONE" && weapCsv.Length > 0) {
              string[] wTokens = weapCsv.Split(',');
              uint weapScratch = 0x41B00000u;
              int wCount = 0;
              foreach (string wt in wTokens) {
                int wId;
                if (int.TryParse(wt, out wId)) {
                  uint entryAddr = weapScratch + (uint)(wCount * 16);
                  WriteUInt32(entryAddr + 0u, 0x77656170u); // 'weap'
                  WriteUInt32(entryAddr + 4u, 0u);
                  WriteUInt32(entryAddr + 8u, 0u);
                  WriteInt32(entryAddr + 12u, wId);
                  wCount++;
                }
              }
              if (wCount > 0) {
                WriteInt32(matgAddr + 0x14Cu, wCount);
                WriteUInt32(matgAddr + 0x150u, weapScratch);
              }
            }
            if (vehCsv != "NONE" && vehCsv.Length > 0) {
              string[] vTokens = vehCsv.Split(',');
              uint vehScratch = 0x41B01000u;
              int vCount = 0;
              foreach (string vt in vTokens) {
                int vId;
                if (int.TryParse(vt, out vId)) {
                  uint entryAddr = vehScratch + (uint)(vCount * 16);
                  WriteUInt32(entryAddr + 0u, 0x76656869u); // 'vehi'
                  WriteUInt32(entryAddr + 4u, 0u);
                  WriteUInt32(entryAddr + 8u, 0u);
                  WriteInt32(entryAddr + 12u, vId);
                  vCount++;
                }
              }
              if (vCount > 0) {
                int mpCount = ReadInt32(matgAddr + 0x164u);
                uint mpAddr = ReadUInt32(matgAddr + 0x168u);
                if (mpCount <= 0 || mpAddr < 0x40440000u) {
                  mpAddr = 0x41B00F00u;
                  WriteBytes(mpAddr, new byte[160]);
                  WriteInt32(matgAddr + 0x164u, 1);
                  WriteUInt32(matgAddr + 0x168u, mpAddr);
                }
                WriteInt32(mpAddr + 0x20u, vCount);
                WriteUInt32(mpAddr + 0x24u, vehScratch);
              }
            }
            EmitLine("ARSENAL_READY");
          }
        } else if (cmd == "PREPARE_EQUIP_WEAPON" && parts.Length >= 3) {
          uint matgAddr = Convert.ToUInt32(parts[1], 16);
          int targetWeapTagId = Convert.ToInt32(parts[2]);
          if (gameStateBase == 0) DetectGameStateBase();
          int unitIdx = gameStateBase != 0 ? ReadInt32(gameStateBase + 0x2F18u + 0x04u) : -1;
          uint unitPtr = GetObjectDatumPtr(unitIdx);
          if (unitPtr != 0) {
            int foundSlot = -1;
            int foundObjIdx = -1;
            int freeSlot = -1;
            for (int s = 0; s < 4; s++) {
              int wObjIdx = ReadInt32(unitPtr + 0x2ECu + (uint)(s * 4));
              if (wObjIdx == -1 || wObjIdx == 0) {
                if (freeSlot == -1) freeSlot = s;
              } else {
                uint wPtr = GetObjectDatumPtr(wObjIdx);
                if (wPtr != 0 && ReadInt32(wPtr + 0x00u) == targetWeapTagId) {
                  foundSlot = s;
                  foundObjIdx = wObjIdx;
                  break;
                }
              }
            }
            if (foundSlot != -1) {
              WriteInt16(unitPtr + 0x2E8u, (short)foundSlot);
              WriteInt16(unitPtr + 0x2E6u, (short)foundSlot);
              if (foundObjIdx != -1) {
                WriteInt32(gameStateBase + 0x2F18u + 0x08u, foundObjIdx);
              }
              EmitLine("EQUIP_ALREADY_HELD " + foundSlot);
            } else if (matgAddr >= 0x40440000u) {
              if (freeSlot == -1) {
                short curSlot = ReadInt16(unitPtr + 0x2E6u);
                freeSlot = (curSlot == 3) ? 2 : 3;
                WriteInt32(unitPtr + 0x2ECu + (uint)(freeSlot * 4), -1);
              }
              uint singleWeapScratch = 0x41B00800u;
              WriteUInt32(singleWeapScratch + 0u, 0x77656170u); // 'weap'
              WriteUInt32(singleWeapScratch + 4u, 0u);
              WriteUInt32(singleWeapScratch + 8u, 0u);
              WriteInt32(singleWeapScratch + 12u, targetWeapTagId);
              WriteInt32(matgAddr + 0x14Cu, 1);
              WriteUInt32(matgAddr + 0x150u, singleWeapScratch);
              EmitLine("EQUIP_SPAWN_NEEDED " + freeSlot);
            }
          }
        } else if (cmd == "SELECT_WEAPON_SLOT" && parts.Length >= 2) {
          short slot = Convert.ToInt16(parts[1]);
          if (gameStateBase != 0) {
            int unitIdx = ReadInt32(gameStateBase + 0x2F18u + 0x04u);
            uint unitPtr = GetObjectDatumPtr(unitIdx);
            if (unitPtr != 0 && slot >= 0 && slot < 4) {
              int wObjIdx = ReadInt32(unitPtr + 0x2ECu + (uint)(slot * 4));
              WriteInt16(unitPtr + 0x2E8u, slot);
              WriteInt16(unitPtr + 0x2E6u, slot);
              if (wObjIdx != -1 && wObjIdx != 0) {
                WriteInt32(gameStateBase + 0x2F18u + 0x08u, wObjIdx);
              }
            }
          }
        } else if (cmd == "PREPARE_SPAWN_VEHICLE" && parts.Length >= 3) {
          uint matgAddr = Convert.ToUInt32(parts[1], 16);
          int targetVehTagId = Convert.ToInt32(parts[2]);
          if (matgAddr >= 0x40440000u) {
            uint singleVehScratch = 0x41B01800u;
            WriteUInt32(singleVehScratch + 0u, 0x76656869u); // 'vehi'
            WriteUInt32(singleVehScratch + 4u, 0u);
            WriteUInt32(singleVehScratch + 8u, 0u);
            WriteInt32(singleVehScratch + 12u, targetVehTagId);
            int mpCount = ReadInt32(matgAddr + 0x164u);
            uint mpAddr = ReadUInt32(matgAddr + 0x168u);
            if (mpCount <= 0 || mpAddr < 0x40440000u) {
              mpAddr = 0x41B00F00u;
              WriteBytes(mpAddr, new byte[160]);
              WriteInt32(matgAddr + 0x164u, 1);
              WriteUInt32(matgAddr + 0x168u, mpAddr);
            }
            WriteInt32(mpAddr + 0x20u, 1);
            WriteUInt32(mpAddr + 0x24u, singleVehScratch);
            EmitLine("VEHICLE_SPAWN_READY");
          }
        }
      } catch {
        // Ignore malformed command
      }
    }
    CloseHandle(hProc);
  }
}
"@
[HaloMemBridge]::Run(${pid})
`;

    const scriptPath = path.join(os.tmpdir(), `_opence_mem_bridge_${pid}.ps1`);
    try {
      fs.writeFileSync(scriptPath, psScript, 'utf-8');
    } catch (writeErr) {
      const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      this.emitLog('stdout', `[MemBridge Warning] Could not write bridge script: ${msg}`);
      return;
    }

    const proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    this.memBridgeProc = proc;

    proc.on('error', (err) => {
      this.emitLog('stdout', `[MemBridge Warning] Process error: ${err.message}`);
    });

    let stdoutBuf = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('STATE ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const wasSpawned = this.unitSpawned;
            this.unitSpawned = Boolean(parsed.unitSpawned);
            if (this.unitSpawned) {
              this.stagedMapLoading = true;
              this.stagedMapLoaded = true;
              if (this.activeOpenCeDir) {
                this.restoreInitForDir(this.activeOpenCeDir);
              }
            }
            const nextWeap = typeof parsed.weaponTagId === 'number' && parsed.weaponTagId >= 0 ? parsed.weaponTagId : null;
            const nextVeh = typeof parsed.vehicleTagId === 'number' && parsed.vehicleTagId >= 0 ? parsed.vehicleTagId : null;
            const nextRect =
              parsed.rect && parsed.rect.width > 0 && parsed.rect.height > 0
                ? {
                    left: Number(parsed.rect.left) || 0,
                    top: Number(parsed.rect.top) || 0,
                    width: Number(parsed.rect.width) || 0,
                    height: Number(parsed.rect.height) || 0,
                  }
                : null;
            this.heldWeaponTagId = nextWeap;
            this.drivenVehicleTagId = nextVeh;
            this.haloWindowRect = nextRect;
            this.emitStatus();
            if (!wasSpawned && this.unitSpawned && this.liveHudMode) {
              this.maybeAutoSpawnLiveHudArsenal();
            }
          } catch {
            // ignore JSON error
          }
        } else if (trimmed.startsWith('HUDKEY ')) {
          const keyName = trimmed.slice(7).trim();
          if (keyName) {
            this.emitLog('stdout', `[HUDKEY] ${keyName}`);
          }
        } else if (trimmed === 'ARSENAL_READY') {
          this.sendCommand('cheat_deathless_player 1');
          this.sendCommand('cheat_infinite_ammo 1');
          if ((this.liveHudSetup?.holdableWeaponTagIds.length ?? 0) > 0) {
            this.sendCommand('cheat_all_weapons');
          }
          if ((this.liveHudSetup?.vehicleTagIds.length ?? 0) > 0) {
            this.sendCommand('cheat_all_vehicles');
          }
          this.emitLog(
            'stdout',
            `[LiveHUD] Spawned ${this.liveHudSetup?.holdableWeaponTagIds.length ?? 0} Spartan-holdable weapons and ${this.liveHudSetup?.vehicleTagIds.length ?? 0} vehicles near player.`,
          );
        } else if (trimmed.startsWith('EQUIP_SPAWN_NEEDED ')) {
          const slot = parseInt(trimmed.split(' ')[1] ?? '3', 10);
          this.sendCommand('cheat_all_weapons');
          setTimeout(() => {
            this.sendBridgeLine(`SELECT_WEAPON_SLOT ${slot}`);
          }, 140);
        } else if (trimmed === 'VEHICLE_SPAWN_READY') {
          this.sendCommand('cheat_all_vehicles');
        }
      }
    });

    proc.on('exit', () => {
      try {
        if (fs.existsSync(scriptPath)) {
          fs.unlinkSync(scriptPath);
        }
      } catch {
        // ignore temp script cleanup error
      }
      if (this.memBridgeProc === proc) {
        this.memBridgeProc = null;
      }
    });
  }

  private sendBridgeLine(line: string): boolean {
    if (!this.memBridgeProc || !this.memBridgeProc.stdin || this.memBridgeProc.stdin.destroyed) {
      return false;
    }
    try {
      this.memBridgeProc.stdin.write(line + '\n');
      return true;
    } catch {
      return false;
    }
  }

  private stopMemoryBridge(): void {
    if (this.memBridgeProc) {
      try {
        this.memBridgeProc.kill();
      } catch {
        // ignore
      }
      this.memBridgeProc = null;
    }
  }

  private maybeAutoSpawnLiveHudArsenal(): void {
    if (
      !this.liveHudMode ||
      this.arsenalSpawnedForCurrentLoad ||
      !this.telnetConnected ||
      !this.unitSpawned ||
      !this.liveHudSetup ||
      this.liveHudSetup.matgVirtualAddress < 0x40440000
    ) {
      return;
    }
    this.arsenalSpawnedForCurrentLoad = true;
    void this.spawnAllArsenalInGame();
  }

  public writeMemoryPatches(patches?: LiveMemoryPatch[]): void {
    if (!patches || patches.length === 0) return;
    for (const p of patches) {
      if (p.address >= 0x40440000 && p.dataBase64) {
        this.sendBridgeLine(`WRITE ${(p.address >>> 0).toString(16)} ${p.dataBase64}`);
      }
    }
  }

  public blinkHudElement(offsetVirtualAddress: number, originalX: number): { ok: boolean } {
    if (!offsetVirtualAddress || offsetVirtualAddress < 0x40440000) {
      return { ok: false };
    }
    const sent = this.sendBridgeLine(`BLINK ${(offsetVirtualAddress >>> 0).toString(16)} ${Math.round(originalX)}`);
    return { ok: sent };
  }

  public equipWeaponInGame(weaponTagId: number): { ok: boolean; message?: string } {
    if (this.statusState !== 'running') {
      return { ok: false, message: 'OpenCE is not currently running.' };
    }
    const matgHex = ((this.liveHudSetup?.matgVirtualAddress ?? 0) >>> 0).toString(16);
    const sent = this.sendBridgeLine(`PREPARE_EQUIP_WEAPON ${matgHex} ${weaponTagId}`);
    return { ok: sent };
  }

  public spawnVehicleInGame(vehicleTagId: number): { ok: boolean; message?: string } {
    if (this.statusState !== 'running') {
      return { ok: false, message: 'OpenCE is not currently running.' };
    }
    const matgHex = ((this.liveHudSetup?.matgVirtualAddress ?? 0) >>> 0).toString(16);
    const sent = this.sendBridgeLine(`PREPARE_SPAWN_VEHICLE ${matgHex} ${vehicleTagId}`);
    return { ok: sent };
  }

  public spawnAllArsenalInGame(): { ok: boolean; message?: string } {
    if (this.statusState !== 'running' || !this.liveHudSetup || this.liveHudSetup.matgVirtualAddress < 0x40440000) {
      return { ok: false, message: 'OpenCE Live HUD session is not ready.' };
    }
    const matgHex = (this.liveHudSetup.matgVirtualAddress >>> 0).toString(16);
    const weapCsv =
      this.liveHudSetup.holdableWeaponTagIds.length > 0
        ? this.liveHudSetup.holdableWeaponTagIds.join(',')
        : 'NONE';
    const vehCsv =
      this.liveHudSetup.vehicleTagIds.length > 0
        ? this.liveHudSetup.vehicleTagIds.join(',')
        : 'NONE';
    const sent = this.sendBridgeLine(`SETUP_ARSENAL ${matgHex} ${weapCsv} ${vehCsv}`);
    return { ok: sent };
  }

  public sendCommand(cmd: string): { ok: boolean; error?: string } {
    if (!this.telnetConnected || !this.telnetSocket) {
      return { ok: false, error: 'Telnet console is not connected to OpenCE.' };
    }
    const trimmed = cmd.trim();
    if (!trimmed) return { ok: true };

    // Telnet buffer is 128 bytes max
    const safeCmd = trimmed.length > 120 ? trimmed.substring(0, 120) : trimmed;
    try {
      this.telnetSocket.write(safeCmd + '\r\n');
      this.emitLog('telnet', `> ${safeCmd}`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  public stop(): Promise<{ ok: boolean; error?: string }> {
    // Always restore/remove init.txt synchronously first so quitting the app never leaves init.txt behind
    this.restoreInitBackupIfPresent();

    if (this.child === null) {
      this.cleanup();
      return Promise.resolve({ ok: true });
    }

    return new Promise((resolve) => {
      // Try polite quit via telnet first
      if (this.telnetConnected && this.telnetSocket) {
        try {
          this.telnetSocket.write('quit\r\n');
        } catch {
          /* best effort */
        }
      }

      // Allow 600ms for clean exit before killing
      setTimeout(() => {
        if (this.child !== null) {
          try {
            this.child.kill();
          } catch {
            /* ignore */
          }
        }
        this.cleanup();
        resolve({ ok: true });
      }, 600);
    });
  }

  private cleanup(): void {
    this.statusState = 'stopped';
    this.telnetConnected = false;

    if (this.telnetSocket) {
      try {
        this.telnetSocket.destroy();
      } catch {
        /* ignore */
      }
      this.telnetSocket = null;
    }

    this.child = null;
    this.stopDebugWatcher();
    this.stopMemoryBridge();
    this.liveHudMode = false;
    this.arsenalSpawnedForCurrentLoad = false;
    this.unitSpawned = false;
    this.heldWeaponTagId = null;
    this.drivenVehicleTagId = null;
    this.haloWindowRect = null;

    // Clean up _opence_tag_test.txt and restore/remove any temporary init.txt
    this.restoreInitBackupIfPresent();
    this.activeOpenCeDir = null;

    this.emitStatus();
  }
}

// Global runner singleton for the Electron main process
export const tagTestRunner = new TagTestRunner();
process.on('exit', () => {
  try {
    tagTestRunner.restoreInitBackupIfPresent();
  } catch {
    /* best effort */
  }
});

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';
import type {
  TagTestStatus,
  TagTestLaunchOptions,
  TagTestLogEntry,
  StageTagTestMapResult,
} from './shared-types';
import { getSettings, detectOpenCeDirectory } from './settings';
import { sendWorkerRequest } from './worker-manager';

export class TagTestRunner {
  private child: ChildProcess | null = null;
  private telnetSocket: net.Socket | null = null;
  private telnetConnected = false;
  private statusState: TagTestStatus['state'] = 'stopped';
  private lastError: string | undefined;
  private stagedMapIndex = 0; // Ping-pong 0 = a, 1 = b
  private currentMapName: string | undefined;
  private initBackupPath: string | null = null;
  private activeOpenCeDir: string | null = null;
  private debugTxtWatcher: NodeJS.Timeout | null = null;
  private debugTxtLastSize = 0;

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
    const exe = path.join(dir, 'halo.exe');
    const exists = fs.existsSync(exe);
    return { directory: dir, executable: exe, exists };
  }

  public restoreInitBackupIfPresent(): void {
    const cfg = this.getOpenCeConfig();
    if (cfg.directory) {
      const initPath = path.join(cfg.directory, 'init.txt');
      const backupPath = path.join(cfg.directory, 'init.txt.opence_backup');
      try {
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, initPath);
          fs.unlinkSync(backupPath);
        }
      } catch {
        /* best effort */
      }
    }
  }

  public async launch(options: TagTestLaunchOptions = {}): Promise<{ ok: boolean; error?: string }> {
    if (this.statusState === 'running' || this.statusState === 'launching') {
      return { ok: false, error: 'OpenCE is already running.' };
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
    this.statusState = 'launching';
    this.lastError = undefined;
    this.emitStatus();

    try {
      // 1. Stage in-memory map to custom_maps\_opence_tag_test_a.map
      const mapSlot = this.stagedMapIndex === 0 ? '_opence_tag_test_a' : '_opence_tag_test_b';
      const stagedMapPath = path.join(openCeDir, 'custom_maps', `${mapSlot}.map`);
      this.currentMapName = mapSlot;

      this.emitLog('stdout', `[TagTest] Staging in-memory map to ${mapSlot}.map...`);
      const stageResult = await sendWorkerRequest<StageTagTestMapResult>(
        { type: 'stageTagTestMap', targetPath: stagedMapPath },
        (level, msg) => this.emitLog('stdout', `[Worker] ${msg}`),
      ).promise;

      if (!stageResult || !stageResult.ok) {
        throw new Error('Failed to stage map for OpenCE.');
      }
      this.emitLog('stdout', `[TagTest] Map staged successfully (CRC32 0x${(stageResult.crc32 >>> 0).toString(16).padStart(8, '0')}).`);

      // 2. Backup and prepare init.txt
      const initPath = path.join(openCeDir, 'init.txt');
      const backupPath = path.join(openCeDir, 'init.txt.opence_backup');
      if (fs.existsSync(initPath) && !fs.existsSync(backupPath)) {
        try {
          fs.copyFileSync(initPath, backupPath);
          this.initBackupPath = backupPath;
        } catch {
          /* best effort */
        }
      }

      // Write tailored init.txt
      const initContent = `game_console_log all\r\ndisplay_framerate true\r\nmap_name custom_maps\\${mapSlot}\r\n`;
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
      const stageResult = await sendWorkerRequest<StageTagTestMapResult>(
        { type: 'stageTagTestMap', targetPath },
        (level, msg) => this.emitLog('stdout', `[Worker] ${msg}`),
      ).promise;

      if (!stageResult || !stageResult.ok) {
        throw new Error('Failed to stage updated map.');
      }

      this.currentMapName = nextSlot;
      // Send map_name command over telnet
      const hsCmd = `map_name custom_maps\\${nextSlot}`;
      this.emitLog('stdout', `[TagTest] Switching map in OpenCE via Telnet: ${hsCmd}`);
      return this.sendCommand(hsCmd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog('stdout', `[TagTest Hot-Reload Error] ${msg}`);
      return { ok: false, error: msg };
    }
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

    // Restore init.txt from backup if needed, or remove temporary init.txt
    if (this.activeOpenCeDir) {
      const initPath = path.join(this.activeOpenCeDir, 'init.txt');
      const backupPath = path.join(this.activeOpenCeDir, 'init.txt.opence_backup');
      try {
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, initPath);
          fs.unlinkSync(backupPath);
        } else if (fs.existsSync(initPath)) {
          // No original init.txt existed; remove temporary file so normal launches aren't affected
          fs.unlinkSync(initPath);
        }
      } catch {
        /* best effort */
      }
      this.activeOpenCeDir = null;
    }

    this.emitStatus();
  }
}

// Global runner singleton for the Electron main process
export const tagTestRunner = new TagTestRunner();

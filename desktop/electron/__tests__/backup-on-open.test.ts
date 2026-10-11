// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { backupOnOpenFlow, isBackedUp, type BackupDeps } from '../backup-on-open';

/** Real files in a temp folder (any bytes: the backup is a plain copy, so no sample map is needed). */
let dir: string;
let mapPath: string;
let bakPath: string;
let mapBytes: Buffer;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-backup-'));
  mapPath = path.join(dir, 'bloodgulch.map');
  bakPath = `${mapPath}.bak`;
  mapBytes = randomBytes(256 * 1024);
  fs.writeFileSync(mapPath, mapBytes);
});
afterEach(() => {
  try {
    for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o666);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* temp cleanup only */
  }
});

function deps(create: 'create' | 'skip', existing: 'keep' | 'replace' | 'skip' = 'keep', overrides: Partial<BackupDeps> = {}) {
  const logs: { level: string; message: string }[] = [];
  const d: BackupDeps = {
    askCreateBackup: vi.fn(async () => create),
    askExistingBackup: vi.fn(async () => existing),
    showError: vi.fn(async () => {}),
    log: (level, message) => logs.push({ level, message }),
    ...overrides,
  };
  return { d, logs };
}
const tempFiles = () => fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));

describe('backup prompt on open', () => {
  it('Create backup: <name>.map.bak is a byte-identical copy in the same folder, no temp file left, result logged', async () => {
    const { d, logs } = deps('create');
    expect(await backupOnOpenFlow(mapPath, d)).toBe('created');
    expect(d.askCreateBackup).toHaveBeenCalledWith('bloodgulch.map', 'bloodgulch.map.bak');
    expect(fs.readFileSync(bakPath).equals(mapBytes)).toBe(true);
    expect(tempFiles()).toEqual([]);
    expect(logs.some((l) => l.message.startsWith('Created backup'))).toBe(true);
  });

  it('Skip: no .bak, logged, and counts as "not backed up" (Save will ask)', async () => {
    const { d, logs } = deps('skip');
    const outcome = await backupOnOpenFlow(mapPath, d);
    expect(outcome).toBe('skipped');
    expect(isBackedUp(outcome)).toBe(false);
    expect(fs.existsSync(bakPath)).toBe(false);
    expect(logs.some((l) => l.level === 'warn' && /Backup skipped/.test(l.message))).toBe(true);
  });

  it('an existing byte-identical .bak: nothing is asked, "backup already up to date" is logged', async () => {
    fs.writeFileSync(bakPath, mapBytes);
    const { d, logs } = deps('create');
    expect(await backupOnOpenFlow(mapPath, d)).toBe('up-to-date');
    expect(d.askCreateBackup).not.toHaveBeenCalled();
    expect(d.askExistingBackup).not.toHaveBeenCalled();
    expect(logs.some((l) => /Backup already up to date/.test(l.message))).toBe(true);
  });

  it('an existing different .bak is never overwritten without a choice: Keep existing and Skip leave it unchanged', async () => {
    const old = randomBytes(1000);
    for (const choice of ['keep', 'skip'] as const) {
      fs.writeFileSync(bakPath, old);
      const mtime = fs.statSync(bakPath).mtimeMs;
      const { d } = deps('create', choice);
      expect(await backupOnOpenFlow(mapPath, d)).toBe(choice === 'keep' ? 'kept-existing' : 'skipped');
      expect(d.askExistingBackup).toHaveBeenCalledWith('bloodgulch.map.bak');
      expect(fs.readFileSync(bakPath).equals(old)).toBe(true);
      expect(fs.statSync(bakPath).mtimeMs).toBe(mtime);
    }
  });

  it('an existing different .bak: Replace overwrites it with a byte-identical copy', async () => {
    fs.writeFileSync(bakPath, randomBytes(1000));
    const { d } = deps('create', 'replace');
    expect(await backupOnOpenFlow(mapPath, d)).toBe('replaced');
    expect(fs.readFileSync(bakPath).equals(mapBytes)).toBe(true);
    expect(tempFiles()).toEqual([]);
  });

  it('a map opened from a .bak file: no prompt at all', async () => {
    fs.writeFileSync(bakPath, mapBytes);
    const { d } = deps('create');
    expect(await backupOnOpenFlow(bakPath, d)).toBe('not-applicable');
    expect(d.askCreateBackup).not.toHaveBeenCalled();
    expect(fs.readdirSync(dir).sort()).toEqual(['bloodgulch.map', 'bloodgulch.map.bak']);
  });

  it('a failed copy (read-only folder): plain message (no stack trace), no temp file, no .bak, map untouched', async () => {
    const eacces = () => {
      throw Object.assign(new Error("EACCES: permission denied, copyfile 'x'"), { code: 'EACCES' });
    };
    const { d, logs } = deps('create', 'keep', { fs: { ...fs, copyFileSync: eacces } as never });
    expect(await backupOnOpenFlow(mapPath, d)).toBe('failed');
    const [message, detail] = (d.showError as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toBe('The backup copy could not be created.');
    expect(detail).toMatch(/read-only/);
    expect(detail).not.toMatch(/\n\s+at /);
    expect(logs.some((l) => l.level === 'error')).toBe(true);
    expect(fs.existsSync(bakPath)).toBe(false);
    expect(tempFiles()).toEqual([]);
    expect(fs.readFileSync(mapPath).equals(mapBytes)).toBe(true);
  });

  it('a short copy (size mismatch) is not renamed into place: temp file removed, no .bak', async () => {
    const shortCopy = (_from: string, to: string) => fs.writeFileSync(to, mapBytes.subarray(0, 100));
    const { d } = deps('create', 'keep', { fs: { ...fs, copyFileSync: shortCopy } as never });
    expect(await backupOnOpenFlow(mapPath, d)).toBe('failed');
    expect(fs.existsSync(bakPath)).toBe(false);
    expect(tempFiles()).toEqual([]);
  });

  it.skipIf(process.platform !== 'win32')('Replace onto a real read-only .bak (Windows): fails with a plain message, the old .bak and the map are intact', async () => {
    const old = randomBytes(1000);
    fs.writeFileSync(bakPath, old);
    fs.chmodSync(bakPath, 0o444);
    const { d } = deps('create', 'replace');
    expect(await backupOnOpenFlow(mapPath, d)).toBe('failed');
    expect(fs.readFileSync(bakPath).equals(old)).toBe(true);
    expect(tempFiles()).toEqual([]);
  });
});

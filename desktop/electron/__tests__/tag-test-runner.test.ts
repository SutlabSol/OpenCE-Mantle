// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TagTestRunner } from '../tag-test-runner';
import { __setCurrentMapForTest, __setSinkForTest, runStageTagTestMap, type LoadedMap } from '../map-worker';
import { inspectCustomEditionMap } from '../../../core/src/index';
import { randomUUID } from 'crypto';

const SAMPLE_MAPS_DIR = process.env.SAMPLE_MAPS_DIR
  ? path.resolve(process.env.SAMPLE_MAPS_DIR)
  : path.resolve(__dirname, '../../../sample_maps');
const bloodgulchPath = path.join(SAMPLE_MAPS_DIR, 'bloodgulch.map');
const haveBloodgulch = fs.existsSync(bloodgulchPath);

describe('TagTestRunner Unit Tests', () => {
  let runner: TagTestRunner;
  let tmpDir: string;

  beforeEach(() => {
    runner = new TagTestRunner();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-test-runner-'));
  });

  afterEach(async () => {
    await runner.stop();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('starts in stopped state with telnet disconnected', () => {
    const s = runner.getStatus();
    expect(s.state).toBe('stopped');
    expect(s.telnetConnected).toBe(false);
    expect(s.pid).toBeUndefined();
  });

  it('subscribes to status changes and notifies listeners', () => {
    const statuses: any[] = [];
    const unsub = runner.onStatusChange((st) => statuses.push(st));

    // Internal status check
    expect(statuses).toEqual([]);
    unsub();
  });

  it('subscribes to log events and parses tag path / index links', () => {
    const logs: any[] = [];
    runner.onLog((entry) => logs.push(entry));

    // Simulate emitting logs internally by calling private emitLog via prototype
    (runner as any).emitLog('debug_txt', 'custom edition: loading tags (tag 2569, 0x04DE3F0E)');
    (runner as any).emitLog('debug_txt', 'weapons\\assault rifle\\assault rifle names invalid');

    expect(logs.length).toBe(2);
    expect(logs[0].source).toBe('debug_txt');
    expect(logs[0].tagIndexLink).toBe(2569);
    expect(logs[1].tagPathLink).toBe('weapons\\assault rifle\\assault rifle');
  });

  it('sendCommand fails gracefully when telnet is not connected', () => {
    const res = runner.sendCommand('cheat_deathless_player 1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Telnet console is not connected');
  });

  it('launch refuses when OpenCE folder does not exist or has no halo.exe', async () => {
    vi.spyOn(runner, 'getOpenCeConfig').mockReturnValue({
      directory: 'C:\\Nonexistent\\Path',
      executable: 'C:\\Nonexistent\\Path\\halo.exe',
      exists: false,
    });

    const res = await runner.launch();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('OpenCE installation not found');
    expect(runner.getStatus().state).toBe('stopped');
  });
});

describe.skipIf(!haveBloodgulch)('Worker stageTagTestMap Test', () => {
  let loadedMap: LoadedMap;
  let outDir: string;

  beforeEach(() => {
    const buffer = fs.readFileSync(bloodgulchPath);
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('sample map did not parse');
    loadedMap = {
      filePath: bloodgulchPath,
      buffer,
      header: inspected.header,
      tagIndex: inspected.tagIndex,
    };
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-stage-test-'));
  });

  afterEach(() => {
    __setCurrentMapForTest(null);
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('runStageTagTestMap exports finalized buffer copy without modifying held map state', () => {
    __setCurrentMapForTest(loadedMap);
    const messages: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages.push(msg));

    const requestId = randomUUID();
    const stageTarget = path.join(outDir, 'custom_maps', '_opence_tag_test_a.map');

    runStageTagTestMap({
      requestId,
      targetPath: stageTarget,
    });

    const resultMsg = messages.find((m) => m.type === 'result') as
      | { type: string; payload: { ok: boolean; targetPath: string; crc32: number; scenarioName: string } }
      | undefined;
    expect(resultMsg?.payload.ok).toBe(true);
    expect(resultMsg?.payload.targetPath).toBe(stageTarget);
    expect(fs.existsSync(stageTarget)).toBe(true);

    // Verify file size matches expected header map length
    const stat = fs.statSync(stageTarget);
    expect(stat.size).toBeGreaterThan(100000);
    // Open map path must remain the original
    expect(loadedMap.filePath).toBe(bloodgulchPath);
  });
});

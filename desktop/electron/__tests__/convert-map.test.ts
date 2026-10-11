import { describe, expect, it, vi } from 'vitest';
import { convertMapFlow, defaultConvertOutputPath, type ConvertMapDeps } from '../convert-map';
import type { ConvertMapResult, OpenMapSummary } from '../shared-types';

const SOURCE = 'C:\\HaloMD\\maps\\heh_2.map';
const SUMMARY: OpenMapSummary = {
  status: 'ok',
  filePath: 'C:\\HaloCE\\maps\\heh_2.map',
  modified: false,
  header: { scenarioName: 'heh_2', buildString: '01.00.00.0609', mapType: 1, crc32: 0xd1c331e9, tagDataOffset: 0, tagDataSize: 0, decompressedFileSize: 0, fileSizeOnDisk: 0, tagCount: 2410 },
  tags: [],
};

function makeDeps(chosenPath: string | null, overrides: Partial<ConvertMapDeps> = {}) {
  const logs: { level: string; message: string }[] = [];
  const deps: ConvertMapDeps = {
    getSourcePath: () => SOURCE,
    getOpenMapPath: () => null,
    confirmUnsavedChanges: vi.fn(async () => true),
    showSaveDialog: vi.fn(async () => chosenPath),
    confirmOverwrite: vi.fn(async () => true),
    confirmScenarioName: vi.fn(async () => true),
    showError: vi.fn(async () => {}),
    runWorkerConvert: vi.fn(
      async (sourcePath: string, outputPath: string): Promise<ConvertMapResult> => ({
        ok: true,
        sourcePath,
        outputPath,
        scenarioName: 'heh_2',
        previousScenarioName: 'heh_2',
        crc32: 0xd1c331e9,
        previousCrc32: 0,
        warnings: [],
        staleChecksumWarning: 'tag-file checksum not recalculated',
        map: { ...SUMMARY, filePath: outputPath },
      }),
    ),
    log: (level, message) => logs.push({ level, message }),
    fileExists: () => false,
    ...overrides,
  };
  return { deps, logs };
}

describe('Convert to Custom Edition (main-process flow)', () => {
  it('suggests <name>_ce.map next to the source, never the source itself', () => {
    expect(defaultConvertOutputPath(SOURCE)).toMatch(/heh_2_ce\.map$/);
    expect(defaultConvertOutputPath(SOURCE).toLowerCase()).not.toBe(SOURCE.toLowerCase());
  });

  it('refuses the source path (case-insensitive) and never reaches the worker', async () => {
    const { deps } = makeDeps('c:\\halomd\\MAPS\\HEH_2.map');
    expect(await convertMapFlow(deps, false)).toMatchObject({ ok: false, code: 'REFUSED_SOURCE_PATH' });
    expect(deps.runWorkerConvert).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalled();
  });

  it('refuses the map that is open in the app', async () => {
    const { deps } = makeDeps('C:\\HaloCE\\maps\\bloodgulch.map', { getOpenMapPath: () => 'C:\\HaloCE\\maps\\bloodgulch.map' });
    expect(await convertMapFlow(deps, false)).toMatchObject({ ok: false, code: 'REFUSED_OPEN_MAP' });
    expect(deps.runWorkerConvert).not.toHaveBeenCalled();
  });

  it('refuses a .bak output name', async () => {
    const { deps } = makeDeps('C:\\HaloCE\\maps\\heh_2.map.bak');
    expect(await convertMapFlow(deps, false)).toMatchObject({ ok: false, code: 'REFUSED_BACKUP_FILE' });
    expect(deps.runWorkerConvert).not.toHaveBeenCalled();
  });

  it('stops without writing when the unsaved-changes prompt is cancelled (no Save dialog)', async () => {
    const { deps } = makeDeps('C:\\HaloCE\\maps\\heh_2.map', { confirmUnsavedChanges: vi.fn(async () => false) });
    expect(await convertMapFlow(deps, false)).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(deps.showSaveDialog).not.toHaveBeenCalled();
    expect(deps.runWorkerConvert).not.toHaveBeenCalled();
  });

  it('cancelling the Save dialog, the overwrite prompt or the name warning writes nothing', async () => {
    const a = makeDeps(null);
    expect(await convertMapFlow(a.deps, false)).toMatchObject({ code: 'CANCELLED' });
    const b = makeDeps('C:\\HaloCE\\maps\\heh_2.map', { fileExists: () => true, confirmOverwrite: vi.fn(async () => false) });
    expect(await convertMapFlow(b.deps, false)).toMatchObject({ code: 'CANCELLED' });
    const c = makeDeps('C:\\HaloCE\\maps\\a_name_that_is_much_longer_than_31_chars.map', { confirmScenarioName: vi.fn(async () => false) });
    expect(await convertMapFlow(c.deps, false)).toMatchObject({ code: 'CANCELLED' });
    for (const { deps } of [a, b, c]) expect(deps.runWorkerConvert).not.toHaveBeenCalled();
  });

  it('runs the name-truncation warning before converting, and passes the source, output and acknowledgement to the worker', async () => {
    const { deps, logs } = makeDeps('C:\\HaloCE\\maps\\heh_2.map');
    const result = await convertMapFlow(deps, true);
    expect(result).toMatchObject({ ok: true, outputPath: 'C:\\HaloCE\\maps\\heh_2.map' });
    expect(deps.confirmScenarioName).toHaveBeenCalledWith('C:\\HaloCE\\maps\\heh_2.map');
    expect(deps.runWorkerConvert).toHaveBeenCalledWith(SOURCE, 'C:\\HaloCE\\maps\\heh_2.map', true);
    expect(logs.some((l) => l.message.includes('0x00000000 -> 0xD1C331E9') && l.message.includes('heh_2.map was not changed'))).toBe(true);
  });

  it('without a pre-flight source it does nothing', async () => {
    const { deps } = makeDeps('C:\\HaloCE\\maps\\heh_2.map', { getSourcePath: () => null });
    expect(await convertMapFlow(deps, false)).toMatchObject({ ok: false, code: 'NO_SOURCE' });
    expect(deps.showSaveDialog).not.toHaveBeenCalled();
  });
});

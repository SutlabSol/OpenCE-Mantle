import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BatchExtractDialog from '../BatchExtractDialog';
import type {
  BatchExtractPreflightResult,
  ProgressEvent,
  GetReferencingTagsResult,
} from '../../../electron/shared-types';

describe('BatchExtractDialog', () => {
  let progressListeners: Set<(e: ProgressEvent) => void>;

  const defaultPreflight: BatchExtractPreflightResult = {
    ok: true,
    mapName: 'bloodgulch',
    scenarioName: 'levels\\test\\bloodgulch\\bloodgulch',
    parentDir: 'C:\\Exports',
    targetDir: 'C:\\Exports\\bloodgulch',
    totalTags: 2455,
    extractableCount: 2345,
    externalCount: 108,
    blockedCount: 2,
    estimatedTotalBytes: 19_398_656, // ~18.5 MB
    freeSpaceBytes: 107_374_182_400, // 100 GB
    existingFileCount: 0,
  };

  beforeEach(() => {
    progressListeners = new Set();
    (window as any).opence = {
      openMapDialog: vi.fn(),
      loadMap: vi.fn(),
      decompressMap: vi.fn(),
      recompressMap: vi.fn(),
      getDependencies: vi.fn(),
      extractTags: vi.fn(),
      cancelExtraction: vi.fn(),
      batchExtractPreflight: vi.fn(),
      startBatchExtract: vi.fn(),
      cancelBatchExtract: vi.fn(),
      finalizeBatchExtract: vi.fn(async () => ({ ok: true })),
      pickResourceMap: vi.fn(),
      getResourceMapStatuses: vi.fn(),
      pickInjectContainer: vi.fn(),
      planInject: vi.fn(),
      applyInject: vi.fn(),
      saveMap: vi.fn(),
      saveMapAs: vi.fn(),
      discardChanges: vi.fn(),
      verifyEmbeddedData: vi.fn(),
      getTagFields: vi.fn(),
      updateTagField: vi.fn(),
      getDependencySlots: vi.fn(),
      setDependencySlot: vi.fn(),
      getReferencingTags: vi.fn(async (): Promise<GetReferencingTagsResult> => ({ ok: true, referencingTags: [] })),
      getUnicodeStrings: vi.fn(),
      setUnicodeString: vi.fn(),
      renameTag: vi.fn(),
      duplicateTag: vi.fn(),
      pickBspSourceMap: vi.fn(async () => ({ path: null })),
      bspSwapPreflight: vi.fn(async () => ({ ok: false, sourceBsps: [] as any, targetBsps: [] as any, selectedSourceBsp: null, selectedTargetBsp: null, sizeDelta: 0, estimatedNewSize: 0, warnings: [] as any })),
      performBspSwap: vi.fn(async () => ({ ok: false, buffer: Buffer.alloc(0), summary: { sourceBspName: '', targetBspName: '', oldSize: 0, newSize: 0, delta: 0, strippedDobc: false, strippedDecals: false, relocatedSpawns: 0 } })),
      getBspRenderMesh: vi.fn(),
      getBitmapTexture: vi.fn(),
      getScenarioObjects: vi.fn(),
      getModelGeometry: vi.fn(),
      updateScenarioPlacement: vi.fn(),
      duplicateScenarioPlacement: vi.fn(),
      addScenarioPlacement: vi.fn(),
      swapScenarioPlacement: vi.fn(),
      deleteScenarioPlacement: vi.fn(),
      identifyResourceMap: vi.fn(async () => ({ ok: false, filePath: '', fileSizeBytes: 0, entryCount: 0, tableOffset: 0, detectedVersion: 'unknown' as const, versionMatchConfidence: 'mismatch' as const, entries: [] })),
      setResourceMapPath: vi.fn(async () => ({ ok: true })),
      detectDefaultResourceMapPaths: vi.fn(async () => ({ halomd: null, ce: null, pc: null, demo: null, mcc: null })),
      convertPreflight: vi.fn(),
      convertMap: vi.fn(),
      pickConvertResource: vi.fn(),
      openContainingFolder: vi.fn(),
      getSettings: vi.fn(async () => ({ lastExtractDir: null, resourceMaps: { bitmaps: null, sounds: null, loc: null } })),
      notImplemented: vi.fn(),
      showAbout: vi.fn(),
      getAppVersion: vi.fn(async () => '0.1.0'),
      getRecentMaps: vi.fn(async () => []),
      onProgress: (cb: any) => {
        progressListeners.add(cb);
        return () => progressListeners.delete(cb);
      },
      onLog: vi.fn(() => () => {}),
      onMenuAction: vi.fn(() => () => {}),
      onMapLoaded: vi.fn(() => () => {}),
      onMapUpdated: vi.fn(() => () => {}),
      getPathForFile: vi.fn(() => 'C:\\mock.map'),
    };
  });

  it('renders preflight breakdown and calls startBatchExtract with chosen options', async () => {
    const onClose = vi.fn();
    const startBatchExtractMock = vi.fn(async () => ({
      ok: true as const,
      summary: {
        mapName: 'bloodgulch',
        targetDir: 'C:\\Exports\\bloodgulch',
        totalTagsInMap: 2455,
        extractedCount: 2345,
        skippedCount: 0,
        blockedCount: 2,
        externalCount: 108,
        failedCount: 0,
        totalBytesWritten: 19_398_656,
        elapsedMs: 3400,
        tags: [],
        manifestPath: 'C:\\Exports\\bloodgulch\\manifest.json',
        reportPath: 'C:\\Exports\\bloodgulch\\batch-extract-report.txt',
      },
    }));
    window.opence.startBatchExtract = startBatchExtractMock;

    render(<BatchExtractDialog open={true} onClose={onClose} preflight={defaultPreflight} />);

    expect(screen.getByText('Batch Extract Whole Map')).toBeInTheDocument();
    expect(screen.getByText('C:\\Exports\\bloodgulch')).toBeInTheDocument();
    expect(screen.getByText('2,345')).toBeInTheDocument();
    expect(screen.getByText('18.50 MB')).toBeInTheDocument();

    const startButton = screen.getByTestId('batch-start-button');
    await userEvent.click(startButton);

    expect(startBatchExtractMock).toHaveBeenCalledWith({
      parentDir: 'C:\\Exports',
      mode: 'skip',
    });

    await waitFor(() => {
      expect(screen.getByText('Batch Extraction Complete')).toBeInTheDocument();
    });

    expect(screen.getByText('2,345 files (18.50 MB)')).toBeInTheDocument();

    const openFolderBtn = screen.getByTestId('batch-open-folder-button');
    await userEvent.click(openFolderBtn);
    expect(window.opence.openContainingFolder).toHaveBeenCalledWith('C:\\Exports\\bloodgulch');

    const closeBtn = screen.getByTestId('batch-close-button');
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('offers skip vs replace when existing files are detected', async () => {
    const onClose = vi.fn();
    const startBatchExtractMock = vi.fn(async () => ({
      ok: true as const,
      summary: {
        mapName: 'bloodgulch',
        targetDir: 'C:\\Exports\\bloodgulch',
        totalTagsInMap: 2455,
        extractedCount: 2345,
        skippedCount: 0,
        blockedCount: 2,
        externalCount: 108,
        failedCount: 0,
        totalBytesWritten: 19_398_656,
        elapsedMs: 3400,
        tags: [],
      },
    }));
    window.opence.startBatchExtract = startBatchExtractMock;

    const preflightWithExisting: BatchExtractPreflightResult = {
      ...defaultPreflight,
      existingFileCount: 42,
    };

    render(<BatchExtractDialog open={true} onClose={onClose} preflight={preflightWithExisting} />);

    expect(screen.getByText('Existing Files Detected (42 tag container(s))')).toBeInTheDocument();

    const replaceRadio = screen.getByDisplayValue('replace');
    await userEvent.click(replaceRadio);

    const startButton = screen.getByTestId('batch-start-button');
    await userEvent.click(startButton);

    expect(startBatchExtractMock).toHaveBeenCalledWith({
      parentDir: 'C:\\Exports',
      mode: 'replace',
    });
  });

  it('handles user cancellation with Keep or Delete prompt', async () => {
    const onClose = vi.fn();
    let resolveExtract: (val: any) => void;
    const extractPromise = new Promise((r) => {
      resolveExtract = r;
    });

    window.opence.startBatchExtract = vi.fn(() => extractPromise as any);

    render(<BatchExtractDialog open={true} onClose={onClose} preflight={defaultPreflight} />);

    await userEvent.click(screen.getByTestId('batch-start-button'));

    expect(screen.getByText('Extracting map tags...')).toBeInTheDocument();

    // Trigger a progress event
    act(() => {
      progressListeners.forEach((cb) => cb({ taskId: 'batchExtract', stage: 'Extracting 500 of 2345: weapons\\ar', percent: 21 }));
    });

    await waitFor(() => {
      expect(screen.getByText('Extracting 500 of 2345: weapons\\ar')).toBeInTheDocument();
      expect(screen.getByText('21%')).toBeInTheDocument();
    });

    // Click Cancel
    await userEvent.click(screen.getByTestId('batch-abort-button'));
    expect(window.opence.cancelBatchExtract).toHaveBeenCalled();

    // Worker returns CANCELLED with staging info
    act(() => {
      resolveExtract!({
        ok: false,
        code: 'CANCELLED',
        message: 'Extraction was cancelled.',
        stagingDir: 'C:\\Exports\\bloodgulch\\.staging-123',
        targetDir: 'C:\\Exports\\bloodgulch',
        partialSummary: {
          mapName: 'bloodgulch',
          targetDir: 'C:\\Exports\\bloodgulch',
          totalTagsInMap: 2455,
          extractedCount: 500,
          skippedCount: 0,
          blockedCount: 2,
          externalCount: 108,
          failedCount: 0,
          totalBytesWritten: 4_000_000,
          elapsedMs: 1500,
          tags: [],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Extraction Cancelled')).toBeInTheDocument();
      expect(screen.getByText('500')).toBeInTheDocument();
    });

    // Choose Keep
    await userEvent.click(screen.getByTestId('batch-keep-cancel-button'));
    expect(window.opence.finalizeBatchExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'keep',
        stagingDir: 'C:\\Exports\\bloodgulch\\.staging-123',
        targetDir: 'C:\\Exports\\bloodgulch',
      }),
    );

    await waitFor(() => {
      expect(screen.getByText('Batch Extraction Complete')).toBeInTheDocument();
      expect(screen.getByText('500 files (3.81 MB)')).toBeInTheDocument();
    });
  });
});

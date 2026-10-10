import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from '../App';
import type { OpenceApi, LoadMapResult, SaveMapAsResult } from '../../electron/shared-types';

const OK_MAP: LoadMapResult = {
  status: 'ok',
  filePath: 'C:\\HaloCE\\maps\\test.map',
  header: { scenarioName: 'test', buildString: '01.00.00.0609', mapType: 1, crc32: 0, tagDataOffset: 0, tagDataSize: 0, decompressedFileSize: 0, fileSizeOnDisk: 0, tagCount: 0 },
  tags: [],
};

function installMockOpence() {
  const saveMapAs = vi.fn(
    async (): Promise<SaveMapAsResult> => ({ ok: true, outputPath: 'C:\\HaloCE\\maps\\test_copy.map', scenarioName: 'test_copy', crc32: 0x1234abcd, warnings: [], staleChecksumWarning: 'stale' }),
  );
  const notImplemented = vi.fn();
  const api: OpenceApi = {
    openMapDialog: vi.fn(async () => OK_MAP),
    loadMap: vi.fn(),
    decompressMap: vi.fn(),
    recompressMap: vi.fn(),
    getDependencies: vi.fn(),
    extractTags: vi.fn(),
    cancelExtraction: vi.fn(),
    pickResourceMap: vi.fn(async () => ({ ok: false, code: 'CANCELLED' }) as const),
    getResourceMapStatuses: vi.fn(async () => ({ bitmaps: { state: 'not-configured' }, sounds: { state: 'not-configured' }, loc: { state: 'not-configured' } }) as const),
    pickInjectContainer: vi.fn(async () => null),
    planInject: vi.fn(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'mock' }) as const),
    applyInject: vi.fn(async () => ({ ok: false, code: 'NO_PLAN', message: 'mock' }) as const),
    saveMapAs,
    verifyEmbeddedData: vi.fn(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'mock' }) as const),
    openContainingFolder: vi.fn(async () => {}),
    getSettings: vi.fn(async () => ({ lastExtractDir: null, resourceMaps: { bitmaps: null, sounds: null, loc: null } })),
    notImplemented,
    showAbout: vi.fn(async () => {}),
    getAppVersion: vi.fn(async () => '0.1.0-test'),
    getRecentMaps: vi.fn(async () => []),
    onProgress: () => () => {},
    onLog: () => () => {},
    onMenuAction: () => () => {},
    onMapLoaded: () => () => {},
    getPathForFile: () => '',
  };
  (window as unknown as { opence: OpenceApi }).opence = api;
  return { saveMapAs, notImplemented };
}

describe('App File > Save As', () => {
  it('is disabled until a map is open, then calls window.opence.saveMapAs and never notImplemented', async () => {
    const { saveMapAs, notImplemented } = installMockOpence();
    render(<App />);

    fireEvent.click(screen.getByTestId('menu-file'));
    expect(screen.getByTestId('menu-item-file-save-as')).toBeDisabled();
    fireEvent.click(screen.getByTestId('menu-item-file-open-map'));
    await waitFor(() => expect(window.opence.openMapDialog).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('menu-file'));
    const saveAs = screen.getByTestId('menu-item-file-save-as');
    await waitFor(() => expect(saveAs).toBeEnabled());
    fireEvent.click(saveAs);

    expect(saveMapAs).toHaveBeenCalledTimes(1);
    expect(saveMapAs).toHaveBeenCalledWith(); // no path from the renderer; main owns the dialog
    expect(notImplemented).not.toHaveBeenCalled();
  });
});

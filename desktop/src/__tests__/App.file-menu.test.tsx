import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import App from '../App';
import type { OpenceApi, LoadMapResult, SaveMapResult, OpenMapSummary } from '../../electron/shared-types';

const OK_MAP: OpenMapSummary = {
  status: 'ok',
  filePath: 'C:\\HaloCE\\maps\\test.map',
  header: { scenarioName: 'test', buildString: '01.00.00.0609', mapType: 1, crc32: 0, tagDataOffset: 0, tagDataSize: 0, decompressedFileSize: 0, fileSizeOnDisk: 0, tagCount: 0 },
  tags: [],
};
const MODIFIED: OpenMapSummary = { ...OK_MAP, modified: true, header: { ...OK_MAP.header, tagCount: 2 } };

function installMockOpence(openResult: LoadMapResult = OK_MAP) {
  const saved = (filePath: string): SaveMapResult => ({
    ok: true,
    outputPath: filePath,
    scenarioName: 'test',
    previousScenarioName: 'test',
    crc32: 0x1234abcd,
    warnings: [],
    staleChecksumWarning: 'stale',
    map: { ...OK_MAP, filePath, modified: false },
  });
  const saveMap = vi.fn(async (): Promise<SaveMapResult> => saved(OK_MAP.filePath));
  const saveMapAs = vi.fn(async (): Promise<SaveMapResult> => saved('C:\\HaloCE\\maps\\test_copy.map'));
  const discardChanges = vi.fn(async () => ({ ok: true as const, map: OK_MAP as LoadMapResult }));
  const notImplemented = vi.fn();
  const updated = new Set<(m: OpenMapSummary) => void>();
  const api: OpenceApi = {
    openMapDialog: vi.fn(async () => openResult),
    loadMap: vi.fn(async () => null),
    decompressMap: vi.fn(),
    recompressMap: vi.fn(),
    getDependencies: vi.fn(),
    extractTags: vi.fn(),
    cancelExtraction: vi.fn(),
    batchExtractPreflight: vi.fn(async () => null),
    startBatchExtract: vi.fn(),
    cancelBatchExtract: vi.fn(),
    finalizeBatchExtract: vi.fn(async () => ({ ok: true })),
    pickResourceMap: vi.fn(async () => ({ ok: false, code: 'CANCELLED' }) as const),
    getResourceMapStatuses: vi.fn(async () => ({ bitmaps: { state: 'not-configured' }, sounds: { state: 'not-configured' }, loc: { state: 'not-configured' } }) as const),
    pickConvertResource: vi.fn(async () => null),
    pickInjectContainer: vi.fn(async () => null),
    planInject: vi.fn(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'mock' }) as const),
    applyInject: vi.fn(async () => ({ ok: false, code: 'NO_PLAN', message: 'mock' }) as const),
    saveMap,
    saveMapAs,
    discardChanges,
    convertPreflight: vi.fn(async () => null),
    convertMap: vi.fn(async () => ({ ok: false, code: 'NO_SOURCE', message: 'mock' }) as const),
    verifyEmbeddedData: vi.fn(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'mock' }) as const),
    getTagFields: vi.fn(async () => ({ ok: false, code: 'NOT_IMPLEMENTED', message: 'mock' }) as const),
    updateTagField: vi.fn(async () => ({ ok: false, code: 'NOT_IMPLEMENTED', message: 'mock' }) as const),
    getDependencySlots: vi.fn(async () => ({ ok: false, code: 'NOT_IMPLEMENTED', message: 'mock' }) as const),
    setDependencySlot: vi.fn(async () => ({ ok: false, code: 'NOT_IMPLEMENTED', message: 'mock' }) as const),
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
    onMapUpdated: (cb) => {
      updated.add(cb);
      return () => updated.delete(cb);
    },
    getPathForFile: () => '',
  };
  (window as unknown as { opence: OpenceApi }).opence = api;
  /** What main sends after Inject (modified) or Save (not modified). */
  const sendUpdated = (m: OpenMapSummary) => act(() => updated.forEach((cb) => cb(m)));
  return { saveMap, saveMapAs, discardChanges, notImplemented, sendUpdated };
}

function menuItem(id: string) {
  fireEvent.click(screen.getByTestId('menu-file'));
  return screen.getByTestId(`menu-item-file-${id}`);
}

async function openMap() {
  fireEvent.click(screen.getByTestId('menu-file'));
  fireEvent.click(screen.getByTestId('menu-item-file-open-map'));
  await waitFor(() => expect(screen.getByTestId('status-bar-tag-count')).toBeInTheDocument());
}

describe('App File menu: Save / Save As / Discard Changes', () => {
  it('Save As is disabled until a map is open, then calls window.opence.saveMapAs and never notImplemented', async () => {
    const { saveMapAs, notImplemented } = installMockOpence();
    render(<App />);
    expect(menuItem('save-as')).toBeDisabled();
    fireEvent.click(screen.getByTestId('menu-file'));
    await openMap();

    const saveAs = menuItem('save-as');
    await waitFor(() => expect(saveAs).toBeEnabled());
    fireEvent.click(saveAs);
    expect(saveMapAs).toHaveBeenCalledTimes(1);
    expect(saveMapAs).toHaveBeenCalledWith(); // no path from the renderer; main owns the dialog
    expect(notImplemented).not.toHaveBeenCalled();
  });

  it('Save and Discard are disabled until Inject modifies the map; then the marker shows, Save calls saveMap (never notImplemented), and a saved map clears the marker', async () => {
    const { saveMap, notImplemented, sendUpdated } = installMockOpence();
    render(<App />);
    await openMap();
    expect(menuItem('save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('menu-file'));
    expect(menuItem('discard-changes')).toBeDisabled();
    fireEvent.click(screen.getByTestId('menu-file'));
    expect(screen.queryByTestId('status-bar-modified')).not.toBeInTheDocument();

    sendUpdated(MODIFIED);
    expect(screen.getByTestId('status-bar-modified')).toHaveTextContent('Modified');
    expect(screen.getByTestId('status-bar-tag-count')).toHaveTextContent('2 tags'); // refreshed from the in-memory map

    const save = menuItem('save');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(saveMap).toHaveBeenCalledTimes(1);
    expect(saveMap).toHaveBeenCalledWith();
    expect(notImplemented).not.toHaveBeenCalled();

    sendUpdated({ ...MODIFIED, modified: false });
    expect(screen.queryByTestId('status-bar-modified')).not.toBeInTheDocument();
    expect(menuItem('save')).toBeDisabled();
  });

  it('Ctrl+S saves only while modified', async () => {
    const { saveMap, sendUpdated } = installMockOpence();
    render(<App />);
    await openMap();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(saveMap).not.toHaveBeenCalled();
    sendUpdated(MODIFIED);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(saveMap).toHaveBeenCalledTimes(1);
  });

  it('a map opened from a .bak file: Save stays disabled even when modified (Save As only)', async () => {
    const bak: OpenMapSummary = { ...OK_MAP, filePath: 'C:\\HaloCE\\maps\\test.map.bak' };
    const { saveMap, sendUpdated } = installMockOpence(bak);
    render(<App />);
    await openMap();
    expect(screen.getByTestId('status-bar-backup-file')).toBeInTheDocument();
    sendUpdated({ ...bak, modified: true });
    expect(menuItem('save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('menu-file'));
    expect(menuItem('save-as')).toBeEnabled();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(saveMap).not.toHaveBeenCalled();
  });

  it('Discard Changes calls window.opence.discardChanges and shows the reopened map', async () => {
    const { discardChanges, notImplemented, sendUpdated } = installMockOpence();
    render(<App />);
    await openMap();
    sendUpdated(MODIFIED);
    fireEvent.click(menuItem('discard-changes'));
    await waitFor(() => expect(discardChanges).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('status-bar-modified')).not.toBeInTheDocument());
    expect(screen.getByTestId('status-bar-tag-count')).toHaveTextContent('0 tags');
    expect(notImplemented).not.toHaveBeenCalled();
  });
});

describe('App: Convert to Custom Edition entry points', () => {
  const RETAIL: LoadMapResult = { status: 'unsupported', filePath: 'C:\HaloMD\heh_2.map', message: 'This is a retail-layout map (cache version 7).', layout: 'retail', convertible: true };
  const DEMO: LoadMapResult = { status: 'unsupported', filePath: 'C:\HaloMD\bloodgulch.map', message: 'This is an original Halo demo map (true demo layout, cache version 6). It can be converted to a Custom Edition (609) map with "Convert to Custom Edition...".', layout: 'demo', convertible: true };

  async function openUnsupported() {
    fireEvent.click(screen.getByTestId('menu-file'));
    fireEvent.click(screen.getByTestId('menu-item-file-open-map'));
    await waitFor(() => expect(screen.getByTestId('unsupported-banner')).toBeInTheDocument());
  }

  it('a version 7 map shows Convert in the banner; it opens the dialog on the open map', async () => {
    installMockOpence(RETAIL);
    render(<App />);
    await openUnsupported();
    fireEvent.click(screen.getByTestId('unsupported-banner-convert'));
    await waitFor(() => expect(screen.getByTestId('convert-dialog')).toBeInTheDocument());
    expect(window.opence.convertPreflight).toHaveBeenCalledWith('open');
  });

  it('a true demo map shows Convert in the banner; it opens the dialog on the open map', async () => {
    installMockOpence(DEMO);
    render(<App />);
    await openUnsupported();
    fireEvent.click(screen.getByTestId('unsupported-banner-convert'));
    await waitFor(() => expect(screen.getByTestId('convert-dialog')).toBeInTheDocument());
    expect(window.opence.convertPreflight).toHaveBeenCalledWith('open');
  });

  it('File > Convert to Custom Edition... is always available and asks for a file', async () => {
    installMockOpence();
    render(<App />);
    fireEvent.click(menuItem('convert-to-custom-edition'));
    await waitFor(() => expect(window.opence.convertPreflight).toHaveBeenCalledWith('pick'));
  });
});

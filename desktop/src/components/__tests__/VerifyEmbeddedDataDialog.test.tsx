import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VerifyEmbeddedDataDialog from '../VerifyEmbeddedDataDialog';
import type { OpenceApi, VerifyEmbeddedDataResult } from '../../../electron/shared-types';

function installMockOpence(verifyEmbeddedData: () => Promise<VerifyEmbeddedDataResult>) {
  const api: OpenceApi = {
    openMapDialog: vi.fn(),
    loadMap: vi.fn(),
    decompressMap: vi.fn(),
    recompressMap: vi.fn(),
    getDependencies: vi.fn(),
    extractTags: vi.fn(),
    cancelExtraction: vi.fn(),
    pickResourceMap: vi.fn(async () => ({ ok: false, code: 'CANCELLED' }) as const),
    getResourceMapStatuses: vi.fn(async () => ({ bitmaps: { state: 'not-configured' }, sounds: { state: 'not-configured' }, loc: { state: 'not-configured' } }) as const),
    pickConvertResource: vi.fn(async () => null),
    pickInjectContainer: vi.fn(async () => null),
    planInject: vi.fn(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'mock' }) as const),
    applyInject: vi.fn(async () => ({ ok: false, code: 'NO_PLAN', message: 'mock' }) as const),
    saveMapAs: vi.fn(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'mock' }) as const),
    saveMap: vi.fn(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'mock' }) as const),
    discardChanges: vi.fn(async () => null),
    convertPreflight: vi.fn(async () => null),
    convertMap: vi.fn(async () => ({ ok: false, code: 'NO_SOURCE', message: 'mock' }) as const),
    verifyEmbeddedData: vi.fn(verifyEmbeddedData),
    openContainingFolder: vi.fn(async () => {}),
    getSettings: vi.fn(async () => ({ lastExtractDir: null, resourceMaps: { bitmaps: null, sounds: null, loc: null } })),
    notImplemented: vi.fn(),
    showAbout: vi.fn(async () => {}),
    getAppVersion: vi.fn(async () => '0.1.0-test'),
    getRecentMaps: vi.fn(async () => []),
    onProgress: () => () => {},
    onLog: () => () => {},
    onMenuAction: () => () => {},
    onMapLoaded: () => () => {},
    onMapUpdated: () => () => {},
    getPathForFile: () => '',
  };
  (window as unknown as { opence: OpenceApi }).opence = api;
}

const log = vi.fn();

describe('VerifyEmbeddedDataDialog', () => {
  it('shows a loading state, then the summary line and full report text for a clean map', async () => {
    installMockOpence(async () => ({
      ok: true,
      mapLabel: 'ui',
      totalBitmapSoundTags: 251,
      checkedTags: 251,
      counts: { embedded: 0, external: 575, embeddedInBounds: 0, embeddedOutOfBounds: 0, overlapping: 0, unreadable: 0, blockedTags: 0 },
      reportText: 'Embedded data verification - "ui"\nNo embedded (external=0) bitmap/sound data in this map - everything routes through bitmaps.map/sounds.map.',
    }));
    render(<VerifyEmbeddedDataDialog onClose={vi.fn()} log={log} />);
    expect(screen.getByTestId('verify-embedded-dialog-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('verify-embedded-dialog-summary')).toBeInTheDocument());
    expect(screen.getByTestId('verify-embedded-dialog-summary').textContent).toContain('"ui": 251 bitmap/sound tag(s), 251 checked - 0 embedded, 575 external, 0 blocked');
    expect(screen.getByTestId('verify-embedded-dialog-report-text').textContent).toContain('No embedded (external=0) bitmap/sound data');
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('0 embedded, 575 external, 0 blocked'));
  });

  it('surfaces blocked tags and problem counts in the summary and report text', async () => {
    installMockOpence(async () => ({
      ok: true,
      mapLabel: 'custom',
      totalBitmapSoundTags: 3,
      checkedTags: 2,
      counts: { embedded: 2, external: 0, embeddedInBounds: 1, embeddedOutOfBounds: 1, overlapping: 0, unreadable: 0, blockedTags: 1 },
      reportText: 'BLOCKED (unrecognized layout - not guessed):\n  "weapons\\x" (bitmap) - Unrecognized tag class. Not guessed.\n\nPROBLEMS FOUND:\n  "a\\bitmap" field (embedded, offset 999999, 10 bytes) - OUT OF BOUNDS',
    }));
    render(<VerifyEmbeddedDataDialog onClose={vi.fn()} log={log} />);
    await waitFor(() => expect(screen.getByTestId('verify-embedded-dialog-summary')).toBeInTheDocument());
    expect(screen.getByTestId('verify-embedded-dialog-summary').textContent).toContain('1 blocked');
    expect(screen.getByTestId('verify-embedded-dialog-report-text').textContent).toContain('Unrecognized tag class. Not guessed.');
    expect(screen.getByTestId('verify-embedded-dialog-report-text').textContent).toContain('OUT OF BOUNDS');
  });

  it('shows an error message when no map is loaded, with no crash', async () => {
    installMockOpence(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'Open and decompress a map before verifying embedded data.' }));
    render(<VerifyEmbeddedDataDialog onClose={vi.fn()} log={log} />);
    await waitFor(() => expect(screen.getByTestId('verify-embedded-dialog-error')).toBeInTheDocument());
    expect(screen.getByTestId('verify-embedded-dialog-error').textContent).toContain('Open and decompress a map before verifying embedded data.');
  });

  it('copies the report text to the clipboard when "Copy report" is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    installMockOpence(async () => ({
      ok: true,
      mapLabel: 'ui',
      totalBitmapSoundTags: 1,
      checkedTags: 1,
      counts: { embedded: 0, external: 1, embeddedInBounds: 0, embeddedOutOfBounds: 0, overlapping: 0, unreadable: 0, blockedTags: 0 },
      reportText: 'THE FULL REPORT TEXT',
    }));
    render(<VerifyEmbeddedDataDialog onClose={vi.fn()} log={log} />);
    await waitFor(() => expect(screen.getByTestId('verify-embedded-copy-report-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('verify-embedded-copy-report-button'));
    expect(writeText).toHaveBeenCalledWith('THE FULL REPORT TEXT');
  });

  it('calls onClose when the Done button or close (×) button is clicked', async () => {
    installMockOpence(async () => ({
      ok: true,
      mapLabel: 'ui',
      totalBitmapSoundTags: 0,
      checkedTags: 0,
      counts: { embedded: 0, external: 0, embeddedInBounds: 0, embeddedOutOfBounds: 0, overlapping: 0, unreadable: 0, blockedTags: 0 },
      reportText: 'nothing to check',
    }));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<VerifyEmbeddedDataDialog onClose={onClose} log={log} />);
    await waitFor(() => expect(screen.getByTestId('verify-embedded-dialog-done')).toBeInTheDocument());
    await user.click(screen.getByTestId('verify-embedded-dialog-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

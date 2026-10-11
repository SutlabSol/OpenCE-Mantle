import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import InjectDialog from '../InjectDialog';
import type { OpenceApi, InjectPlanSummary, ApplyInjectResult, OpenMapSummary } from '../../../electron/shared-types';

const PLAN: InjectPlanSummary = {
  mode: 'add',
  containerPath: 'C:\\tags\\halo_logo.ocetags',
  sourceMapName: 'ui',
  counts: { totalInClosure: 2, reused: 0, swapped: 0, added: 2, blockedEmbedded: 0, blockedOther: 0, externalReferenced: 0 },
  toAdd: [
    { path: 'ui\\shell\\main_menu\\halo_logo', group: 'ui_widget_definition' },
    { path: 'ui\\shell\\bitmaps\\halo_logo', group: 'bitmap' },
  ],
  toSwap: [],
  reused: [],
  blockedEmbedded: [],
  blockedOther: [],
  externalRefStatuses: [],
  refusedRoots: [],
};
const MAP: OpenMapSummary = {
  status: 'ok',
  filePath: 'C:\\HaloCE\\maps\\bloodgulch.map',
  modified: true,
  header: { scenarioName: 'bloodgulch', buildString: '01.00.00.0609', mapType: 1, crc32: 0, tagDataOffset: 0, tagDataSize: 0, decompressedFileSize: 0, fileSizeOnDisk: 0, tagCount: 2457 },
  tags: [],
};

function installMockOpence(applyInject: () => Promise<ApplyInjectResult>) {
  const api = {
    pickInjectContainer: vi.fn(async () => ({ path: PLAN.containerPath })),
    planInject: vi.fn(async () => ({ ok: true as const, plan: PLAN })),
    applyInject: vi.fn(applyInject),
    saveMap: vi.fn(),
    saveMapAs: vi.fn(),
    openContainingFolder: vi.fn(async () => {}),
    notImplemented: vi.fn(),
  };
  (window as unknown as { opence: Partial<OpenceApi> }).opence = api;
  return api;
}

async function reviewAndConfirm() {
  fireEvent.click(screen.getByTestId('inject-mode-add'));
  await waitFor(() => expect(screen.getByTestId('inject-dialog-summary')).toBeInTheDocument());
  expect(screen.getByTestId('inject-copy-warning-report-button')).toBeInTheDocument(); // plan review + warning report kept
  const confirm = screen.getByTestId('inject-confirm-button');
  expect(confirm).toHaveTextContent('Inject into open map');
  fireEvent.click(confirm);
}

describe('InjectDialog (in-memory inject)', () => {
  it('applies to the open map without asking for an output file, and says nothing is written until Save / Save As', async () => {
    const api = installMockOpence(async () => ({ ok: true, addedCount: 2, reusedCount: 0, swappedCount: 0, map: MAP }));
    const log = vi.fn();
    render(<InjectDialog onClose={() => {}} log={log} />);
    await reviewAndConfirm();

    await waitFor(() => expect(screen.getByTestId('inject-result-in-memory')).toBeInTheDocument());
    expect(api.applyInject).toHaveBeenCalledWith(); // no output path
    expect(screen.getByTestId('inject-result-in-memory')).toHaveTextContent('2,457 tags');
    expect(screen.getByTestId('inject-result-in-memory')).toHaveTextContent('nothing has been written to disk yet');
    expect(screen.queryByTestId('inject-result-open-folder')).not.toBeInTheDocument();
    expect(api.openContainingFolder).not.toHaveBeenCalled();
    expect(api.saveMap).not.toHaveBeenCalled();
    expect(api.saveMapAs).not.toHaveBeenCalled();
    expect(api.notImplemented).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('in memory, not saved yet'));
  });

  it('a failed apply says the open map is unchanged', async () => {
    installMockOpence(async () => ({ ok: false, code: 'UNEXPECTED_ERROR', message: 'boom' }));
    render(<InjectDialog onClose={() => {}} log={vi.fn()} />);
    await reviewAndConfirm();
    await waitFor(() => expect(screen.getByTestId('inject-apply-error')).toHaveTextContent('the open map is unchanged'));
  });
});

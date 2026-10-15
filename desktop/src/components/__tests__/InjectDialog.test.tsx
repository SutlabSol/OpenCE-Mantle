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

type PickInjectContainerResult = Awaited<ReturnType<OpenceApi['pickInjectContainer']>>;

function installMockOpence(applyInject: () => Promise<ApplyInjectResult>, pickResult?: Exclude<PickInjectContainerResult, null>) {
  const api = {
    pickInjectContainer: vi.fn(async () => pickResult ?? { path: PLAN.containerPath, paths: [PLAN.containerPath] }),
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

  it('applies multiple .ocetags containers sequentially and reports the batched totals at the end', async () => {
    const pathA = 'C:\\tags\\first.ocetags';
    const pathB = 'C:\\tags\\second.ocetags';
    const planA: InjectPlanSummary = { ...PLAN, containerPath: pathA, sourceMapName: 'ui', counts: { ...PLAN.counts, totalInClosure: 2, added: 2, swapped: 0, reused: 0 } };
    // Second container has a mix: one tag already matches (reused), one needs adding, one needs swapping.
    const planB: InjectPlanSummary = {
      ...PLAN,
      containerPath: pathB,
      sourceMapName: 'levels\\custom',
      counts: { ...PLAN.counts, totalInClosure: 3, added: 1, swapped: 1, reused: 1 },
      toAdd: [{ path: 'levels\\custom\\extra', group: 'bitmap' }],
      toSwap: [{ path: 'levels\\custom\\existing\\widget', group: 'ui_widget_definition' }],
      reused: [{ path: 'levels\\custom\\shared\\bitmap', group: 'bitmap' }],
    };

    const api = {
      pickInjectContainer: vi.fn(async () => ({ path: pathA, paths: [pathA, pathB] })),
      planInject: vi.fn(async (p: string) => (p === pathA ? { ok: true as const, plan: planA } : { ok: true as const, plan: planB })),
      applyInject: vi.fn(),
      saveMap: vi.fn(),
      saveMapAs: vi.fn(),
      openContainingFolder: vi.fn(async () => {}),
      notImplemented: vi.fn(),
    };
    // First apply succeeds; second apply succeeds too.
    api.applyInject.mockImplementation(async () => {
      if ((api.applyInject as unknown as { mock: { calls: unknown[][] } }).mock.calls.length <= 1) {
        return { ok: true, addedCount: 2, swappedCount: 0, reusedCount: 0, map: MAP };
      }
      return { ok: true, addedCount: 1, swappedCount: 1, reusedCount: 1, map: { ...MAP, header: { ...MAP.header, tagCount: 2460 } } };
    });
    (window as unknown as { opence: Partial<OpenceApi> }).opence = api as unknown as Partial<OpenceApi>;

    const log = vi.fn();
    render(<InjectDialog onClose={() => {}} log={log} />);

    // Pick mode -> first container plans against planA, with the batch progress indicator in the review.
    fireEvent.click(screen.getByTestId('inject-mode-add'));
    await waitFor(() => expect(screen.getByTestId('inject-dialog-summary')).toBeInTheDocument());

    // Step indicator shows "Container 1 of 2" for the first container.
    expect(screen.getByTestId('inject-container-step')).toHaveTextContent('Container 1 of 2');
    expect(screen.getByTestId('inject-container-step')).toHaveTextContent('first.ocetags');

    // The confirm button advertises that more containers remain in the queue.
    const confirmA = screen.getByTestId('inject-confirm-button');
    expect(confirmA).toHaveTextContent('Inject and next…');
    fireEvent.click(confirmA);

    // Container 2 is planned against the already-modified in-memory state and shows "Container 2 of 2".
    await waitFor(() => expect(screen.getByTestId('inject-container-step')).toHaveTextContent('Container 2 of 2'));
    expect(screen.getByTestId('inject-container-step')).toHaveTextContent('second.ocetags');

    // On the final container, the button goes back to the plain label.
    const confirmB = await screen.findByTestId('inject-confirm-button');
    expect(confirmB).toHaveTextContent('Inject into open map');
    fireEvent.click(confirmB);

    // Wait for the final result panel (only rendered when the whole queue is done).
    await waitFor(() => expect(screen.getByTestId('inject-result-in-memory')).toBeInTheDocument());

    // Both applies happened in memory.
    expect(api.applyInject).toHaveBeenCalledTimes(2);
    expect(api.applyInject).toHaveBeenCalledWith();

    // planInject was called once per container, in order.
    expect(api.planInject).toHaveBeenCalledTimes(2);
    expect(api.planInject.mock.calls[0][0]).toBe(pathA);
    expect(api.planInject.mock.calls[1][0]).toBe(pathB);

    // The final result roll-up sums across containers (2 add + 1 add, 0 swap + 1 swap, 0 reused + 1 reused).
    const result = screen.getByTestId('inject-result');
    expect(result).toHaveTextContent('Injected 2 containers');
    expect(result).toHaveTextContent('3 added');
    expect(result).toHaveTextContent('1 swapped');
    expect(result).toHaveTextContent('1 reused');

    // The final apply result drives the on-disk tag count line.
    expect(screen.getByTestId('inject-result-in-memory')).toHaveTextContent('2,460 tags');

    // Per-container progress log and final batch log are both written.
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Injected container 1 of 2'));
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Injected container 2 of 2'));
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Injected 2 containers into the open map (in memory, not saved yet).'));
  });
});

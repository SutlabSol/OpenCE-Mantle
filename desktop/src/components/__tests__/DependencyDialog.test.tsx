import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DependencyDialog from '../DependencyDialog';
import { buildMockSummary, type MockScenario } from '../../test-fixtures/dependency-fixtures';
import type { OpenceApi, ProgressEvent, GetDependenciesResult, ExtractTagsResult, DependencyWarningInfo, DependencyWarningKind } from '../../../electron/shared-types';
import { WARNING_KINDS } from '../../../../core/src/map/dependency-walker';

function okDeps(scenario: MockScenario): () => Promise<GetDependenciesResult> {
  return () => Promise.resolve({ ok: true, summary: buildMockSummary(scenario) });
}

function installMockOpence(overrides: Partial<OpenceApi> = {}): { progressListeners: Set<(e: ProgressEvent) => void> } {
  const progressListeners = new Set<(e: ProgressEvent) => void>();
  const api: OpenceApi = {
    openMapDialog: vi.fn(),
    loadMap: vi.fn(),
    decompressMap: vi.fn(),
    recompressMap: vi.fn(),
    getDependencies: vi.fn(okDeps('clean')),
    extractTags: vi.fn(
      (): Promise<ExtractTagsResult> => Promise.resolve({ ok: true, outputPath: 'C:\\out\\extracted.ocetags', tagCount: 1, fileSizeBytes: 100, carriedOverWarnings: [] }),
    ),
    cancelExtraction: vi.fn(),
    pickResourceMap: vi.fn(async () => ({ ok: false, code: 'CANCELLED' }) as const),
    getResourceMapStatuses: vi.fn(async () => ({ bitmaps: { state: 'not-configured' }, sounds: { state: 'not-configured' }, loc: { state: 'not-configured' } }) as const),
    pickInjectContainer: vi.fn(async () => null),
    planInject: vi.fn(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'mock' }) as const),
    applyInject: vi.fn(async () => ({ ok: false, code: 'NO_PLAN', message: 'mock' }) as const),
    saveMapAs: vi.fn(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'mock' }) as const),
    verifyEmbeddedData: vi.fn(async () => ({ ok: false, code: 'NO_MAP_LOADED', message: 'mock' }) as const),
    openContainingFolder: vi.fn(async () => {}),
    getSettings: vi.fn(async () => ({ lastExtractDir: null, resourceMaps: { bitmaps: null, sounds: null, loc: null } })),
    notImplemented: vi.fn(),
    showAbout: vi.fn(async () => {}),
    getAppVersion: vi.fn(async () => '0.1.0-test'),
    getRecentMaps: vi.fn(async () => []),
    onProgress: (cb) => {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
    onLog: () => () => {},
    onMenuAction: () => () => {},
    onMapLoaded: () => () => {},
    getPathForFile: () => '',
    ...overrides,
  };
  (window as unknown as { opence: OpenceApi }).opence = api;
  return { progressListeners };
}

const log = vi.fn();

beforeEach(() => {
  log.mockClear();
});

describe('DependencyDialog', () => {
  it('clean extraction: lists tags with no warnings, confirm enabled, extraction succeeds', async () => {
    installMockOpence({ getDependencies: vi.fn(okDeps('clean')) });
    render(<DependencyDialog selectedIndices={[4]} onClose={vi.fn()} log={log} />);

    await waitFor(() => expect(screen.getByTestId('dependency-dialog-summary')).toBeInTheDocument());
    expect(screen.queryByTestId('dependency-understand-checkbox')).not.toBeInTheDocument();
    const confirm = screen.getByTestId('dependency-confirm-button');
    expect(confirm).not.toBeDisabled();

    await userEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId('dependency-result')).toBeInTheDocument());
    expect(screen.getByText(/extracted\.ocetags/)).toBeInTheDocument();
  });

  it('scenario with BSP: shows "Not extracted" group and gates confirm on the checkbox', async () => {
    installMockOpence({ getDependencies: vi.fn(okDeps('scenario-bsp')) });
    render(<DependencyDialog selectedIndices={[0]} onClose={vi.fn()} log={log} />);

    await waitFor(() => expect(screen.getByTestId('warning-group-not-extracted')).toBeInTheDocument());
    const confirm = screen.getByTestId('dependency-confirm-button');
    expect(confirm).toBeDisabled();

    await userEvent.click(screen.getByTestId('dependency-understand-checkbox'));
    expect(confirm).not.toBeDisabled();
  });

  it('external sound/bitmap data: warnings appear under "External data"', async () => {
    installMockOpence({ getDependencies: vi.fn(okDeps('external-data')) });
    render(<DependencyDialog selectedIndices={[5]} onClose={vi.fn()} log={log} />);

    await waitFor(() => expect(screen.getByTestId('warning-group-external-data')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('warning-group-toggle-external-data'));
    expect(screen.getByTestId('warning-group-items-external-data').textContent).toContain('cloud mask');
  });

  it('spheroid/uncertain group: warning appears under a BLOCKING "Undefined/uncertain groups (blocked for injection)" group', async () => {
    installMockOpence({ getDependencies: vi.fn(okDeps('spheroid')) });
    render(<DependencyDialog selectedIndices={[20]} onClose={vi.fn()} log={log} />);
    const slug = 'undefined-uncertain-groups-blocked-for-injection';
    await waitFor(() => expect(screen.getByTestId(`warning-group-${slug}`)).toBeInTheDocument());
    // uncertainGroup now blocks ADD/SWAP in core, so the group must be labelled and styled as blocking.
    expect(screen.getByTestId(`warning-group-${slug}`).textContent).toContain('NEEDS ATTENTION');
    expect(screen.getByTestId(`warning-group-toggle-${slug}`).textContent).toContain('blocked for injection');
  });

  it('uncaptured/embedded/invalid-layout warnings each get their own blocking group, and gate confirm on the checkbox', async () => {
    installMockOpence({ getDependencies: vi.fn(okDeps('blocked-data')) });
    render(<DependencyDialog selectedIndices={[30]} onClose={vi.fn()} log={log} />);

    await waitFor(() => expect(screen.getByTestId('warning-group-cannot-be-captured-blocked-for-injection')).toBeInTheDocument());
    for (const [slug, fragment] of [
      ['cannot-be-captured-blocked-for-injection', 'model geometry part(s)'],
      ['embedded-data-injection-blocked-while-embedded-relocation-is-disabled', 'embedded in this map'],
      ['invalid-corrupt-layout-not-walked-blocked-for-injection', 'resolves outside this file'],
    ]) {
      expect(screen.getByTestId(`warning-group-${slug}`).textContent).toContain('NEEDS ATTENTION');
      await userEvent.click(screen.getByTestId(`warning-group-toggle-${slug}`));
      expect(screen.getByTestId(`warning-group-items-${slug}`).textContent).toContain(fragment);
    }
    expect(screen.queryByTestId('warning-group-other-warnings')).not.toBeInTheDocument();
    // invalidReflexive now blocks ADD/SWAP in core, so its group title must say so.
    expect(screen.getByTestId('warning-group-toggle-invalid-corrupt-layout-not-walked-blocked-for-injection').textContent).toContain('blocked for injection');

    const confirm = screen.getByTestId('dependency-confirm-button');
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByTestId('dependency-understand-checkbox'));
    expect(confirm).not.toBeDisabled();
  });

  it('embeddedRawData as the only warning group: confirm works after "I understand" and extractTags is called', async () => {
    const base = buildMockSummary('blocked-data');
    const summary = { ...base, warnings: base.warnings.filter((w) => w.kind === 'embeddedRawData') };
    expect(summary.warnings).toHaveLength(1);
    const extractTags = vi.fn(
      (): Promise<ExtractTagsResult> => Promise.resolve({ ok: true, outputPath: 'C:\\out\\scope.ocetags', tagCount: 3, fileSizeBytes: 100, carriedOverWarnings: summary.warnings }),
    );
    installMockOpence({ getDependencies: vi.fn(() => Promise.resolve({ ok: true as const, summary })), extractTags });
    render(<DependencyDialog selectedIndices={[30]} onClose={vi.fn()} log={log} />);

    await waitFor(() => expect(screen.getByTestId('warning-group-embedded-data-injection-blocked-while-embedded-relocation-is-disabled')).toBeInTheDocument());
    expect(screen.getAllByTestId(/^warning-group-toggle-/)).toHaveLength(1);

    const confirm = screen.getByTestId('dependency-confirm-button');
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByTestId('dependency-understand-checkbox'));
    expect(confirm).not.toBeDisabled();
    await userEvent.click(confirm);

    await waitFor(() => expect(screen.getByTestId('dependency-result')).toBeInTheDocument());
    expect(extractTags).toHaveBeenCalledTimes(1);
    expect(extractTags).toHaveBeenCalledWith(expect.objectContaining({ originalIndices: [30] }));
  });

  it('drift guard: every core WARNING_KINDS kind shows its message in a named (non-"Other") group; unknown kinds fall back to "Other warnings"', async () => {
    const warnings: DependencyWarningInfo[] = WARNING_KINDS.map((kind, i) => ({ originalIndex: i, path: `p${i}`, group: '', kind, message: `drift-check message for ${kind}` }));
    warnings.push({ originalIndex: 99, path: 'p99', group: '', kind: 'someFutureKind' as DependencyWarningKind, message: 'drift-check message for someFutureKind' });
    const summary = { ...buildMockSummary('clean'), warnings };
    installMockOpence({ getDependencies: vi.fn(() => Promise.resolve({ ok: true as const, summary })) });
    render(<DependencyDialog selectedIndices={[4]} onClose={vi.fn()} log={log} />);

    await waitFor(() => expect(screen.getByTestId('dependency-dialog-summary')).toBeInTheDocument());
    for (const toggle of screen.getAllByTestId(/^warning-group-toggle-/)) await userEvent.click(toggle);

    for (const kind of WARNING_KINDS) {
      const item = screen.getByText(`drift-check message for ${kind}`);
      const group = item.closest('[data-testid^="warning-group-items-"]');
      expect(group, `kind "${kind}" has no visible message in any warning group`).not.toBeNull();
      expect(group!.getAttribute('data-testid'), `kind "${kind}" fell through to "Other warnings" - map it in DependencyDialog's GROUP_BY_KIND`).not.toBe('warning-group-items-other-warnings');
    }
    expect(screen.getByTestId('warning-group-items-other-warnings').textContent).toContain('drift-check message for someFutureKind');
  });

  it('BSP-only selection: confirm is disabled with a stated reason and no checkbox is shown', async () => {
    installMockOpence({ getDependencies: vi.fn(okDeps('bsp-only')) });
    render(<DependencyDialog selectedIndices={[1]} onClose={vi.fn()} log={log} />);

    await waitFor(() => expect(screen.getByTestId('dependency-confirm-button')).toBeInTheDocument());
    expect(screen.getByTestId('dependency-confirm-button')).toBeDisabled();
    expect(screen.queryByTestId('dependency-understand-checkbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('dependency-confirm-disabled-reason').textContent).toMatch(/scenario_structure_bsp/);
  });

  it('progress and cancel: shows live progress and calls cancelExtraction on Cancel', async () => {
    let resolveExtract: (v: ExtractTagsResult) => void = () => {};
    const extractPromise = new Promise<ExtractTagsResult>((resolve) => {
      resolveExtract = resolve;
    });
    const { progressListeners } = installMockOpence({
      getDependencies: vi.fn(okDeps('clean')),
      extractTags: vi.fn(() => extractPromise),
    });
    render(<DependencyDialog selectedIndices={[4]} onClose={vi.fn()} log={log} />);

    await waitFor(() => expect(screen.getByTestId('dependency-confirm-button')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('dependency-confirm-button'));
    await waitFor(() => expect(screen.getByTestId('dependency-progress')).toBeInTheDocument());

    act(() => {
      progressListeners.forEach((cb) => cb({ taskId: 'extract', stage: 'Extracting tag 1 of 1', percent: 42 }));
    });
    await waitFor(() => expect(screen.getByText('Extracting tag 1 of 1')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('dependency-cancel-button'));
    expect(window.opence.cancelExtraction).toHaveBeenCalled();

    resolveExtract({ ok: false, code: 'CANCELLED', message: 'Extraction was cancelled.' });
    await waitFor(() => expect(screen.getByTestId('dependency-confirm-button')).toBeInTheDocument());
  });

  it('error rendering: a structured getDependencies error shows a friendly message', async () => {
    installMockOpence({ getDependencies: vi.fn((): Promise<GetDependenciesResult> => Promise.resolve({ ok: false, code: 'UNEXPECTED_ERROR', message: 'Simulated failure for testing.' })) });
    render(<DependencyDialog selectedIndices={[4]} onClose={vi.fn()} log={log} />);

    await waitFor(() => expect(screen.getByTestId('dependency-dialog-error')).toBeInTheDocument());
    expect(screen.getByText('Simulated failure for testing.')).toBeInTheDocument();
  });

  it('escape closes the dialog', async () => {
    const onClose = vi.fn();
    installMockOpence({ getDependencies: vi.fn(okDeps('clean')) });
    render(<DependencyDialog selectedIndices={[4]} onClose={onClose} log={log} />);
    await waitFor(() => expect(screen.getByTestId('dependency-dialog')).toBeInTheDocument());
    fireEvent.keyDown(screen.getByTestId('dependency-dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

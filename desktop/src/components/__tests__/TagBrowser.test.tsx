import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TagBrowser from '../TagBrowser';
import type { TagEntrySummary } from '../../../electron/shared-types';

const TAGS: TagEntrySummary[] = [
  { index: 0, tagId: 1, primaryClassName: 'scenario', path: 'levels\\test\\bloodgulch\\bloodgulch', isExternal: false, estimatedSize: 215040 },
  { index: 4, tagId: 2, primaryClassName: 'vehicle', path: 'vehicles\\warthog\\warthog', isExternal: false, estimatedSize: 12044 },
  { index: 5, tagId: 3, primaryClassName: 'vehicle', path: 'vehicles\\banshee\\banshee', isExternal: false, estimatedSize: 9000 },
];

const OTHER_MAP_TAGS: TagEntrySummary[] = [
  { index: 0, tagId: 9, primaryClassName: 'scenario', path: 'levels\\test\\deathisland\\deathisland', isExternal: false, estimatedSize: 100000 },
];

function renderBrowser(overrides: Partial<React.ComponentProps<typeof TagBrowser>> = {}) {
  const onFocusTag = vi.fn();
  const onSelectedChange = vi.fn();
  const onExtractRequested = vi.fn();
  const props = {
    tags: TAGS,
    onFocusTag,
    selected: new Set<number>(),
    onSelectedChange,
    onExtractRequested,
    extractDisabledReason: 'Select at least one tag first.' as string | null,
    ...overrides,
  };
  const view = render(<TagBrowser {...props} />);
  return { onFocusTag, onSelectedChange, onExtractRequested, props, ...view };
}

describe('TagBrowser group expansion', () => {
  it('all groups are collapsed by default when a map loads', () => {
    renderBrowser();
    expect(screen.getByTestId('tag-group-vehicle')).toBeInTheDocument();
    expect(screen.queryByTestId('tag-row-4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tag-row-0')).not.toBeInTheDocument();
  });

  it('expansion state resets to fully collapsed when a different map is opened', async () => {
    const { rerender, props } = renderBrowser();
    await userEvent.click(screen.getByTestId('expand-all-button'));
    expect(screen.getByTestId('tag-row-4')).toBeInTheDocument();

    rerender(<TagBrowser {...props} tags={OTHER_MAP_TAGS} />);
    expect(screen.queryByTestId('tag-row-0')).not.toBeInTheDocument();
  });

  it('Expand all opens every group, Collapse all closes every group', async () => {
    renderBrowser();
    await userEvent.click(screen.getByTestId('expand-all-button'));
    expect(screen.getByTestId('tag-row-4')).toBeInTheDocument();
    expect(screen.getByTestId('tag-row-0')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('collapse-all-button'));
    expect(screen.queryByTestId('tag-row-4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tag-row-0')).not.toBeInTheDocument();
  });

  it('searching auto-expands only groups with matches, and clearing search restores the prior state', async () => {
    renderBrowser();
    // Manually expand the "scenario" group before searching, leave "vehicle" collapsed.
    await userEvent.click(screen.getByTestId('tag-group-scenario'));
    expect(screen.getByTestId('tag-row-0')).toBeInTheDocument();
    expect(screen.queryByTestId('tag-row-4')).not.toBeInTheDocument();

    await userEvent.type(screen.getByTestId('tag-search-input'), 'warthog');
    expect(screen.getByTestId('tag-row-4')).toBeInTheDocument(); // match auto-expanded
    expect(screen.queryByTestId('tag-row-0')).not.toBeInTheDocument(); // no longer matches, not shown at all

    await userEvent.clear(screen.getByTestId('tag-search-input'));
    expect(screen.getByTestId('tag-row-0')).toBeInTheDocument(); // restored: scenario was manually open
    expect(screen.queryByTestId('tag-row-4')).not.toBeInTheDocument(); // restored: vehicle was still collapsed
  });

  it('selecting a collapsed group header checkbox still selects every tag beneath it', async () => {
    const { onSelectedChange } = renderBrowser({ selected: new Set() });
    expect(screen.queryByTestId('tag-row-4')).not.toBeInTheDocument(); // group is collapsed
    await userEvent.click(screen.getByTestId('tag-group-select-vehicle'));
    expect(onSelectedChange).toHaveBeenCalledWith(new Set([4, 5]));
  });
});

describe('TagBrowser extract trigger', () => {
  it('is disabled with no selection', () => {
    renderBrowser({ selected: new Set(), extractDisabledReason: 'Select at least one tag first.' });
    expect(screen.getByTestId('extract-selected-button')).toBeDisabled();
  });

  it('is enabled with a selection and calls onExtractRequested with exactly those IDs', async () => {
    const { onExtractRequested } = renderBrowser({ selected: new Set([4, 5]), extractDisabledReason: null });
    const button = screen.getByTestId('extract-selected-button');
    expect(button).not.toBeDisabled();
    await userEvent.click(button);
    expect(onExtractRequested).toHaveBeenCalledWith(expect.arrayContaining([4, 5]));
    expect(onExtractRequested.mock.calls[0][0]).toHaveLength(2);
  });

  it('right-clicking an unselected row selects it first', async () => {
    const { onSelectedChange } = renderBrowser({ selected: new Set(), extractDisabledReason: null });
    await userEvent.click(screen.getByTestId('expand-all-button'));
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.contextMenu(screen.getByTestId('tag-row-4'));
    expect(onSelectedChange).toHaveBeenCalledWith(new Set([4]));
  });

  it('the context menu "Extract (with dependencies)..." action extracts the current selection', async () => {
    const { onExtractRequested } = renderBrowser({ selected: new Set([4]), extractDisabledReason: null });
    await userEvent.click(screen.getByTestId('expand-all-button'));
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.contextMenu(screen.getByTestId('tag-row-4'));
    await userEvent.click(screen.getByTestId('tag-row-context-extract'));
    expect(onExtractRequested).toHaveBeenCalledWith([4]);
  });

  it('selecting a group header checkbox expands to all its child tags', async () => {
    const { onSelectedChange } = renderBrowser({ selected: new Set(), extractDisabledReason: null });
    await userEvent.click(within(screen.getByTestId('tag-group-vehicle')).getByTestId('tag-group-select-vehicle'));
    expect(onSelectedChange).toHaveBeenCalledWith(new Set([4, 5]));
  });

  it('is disabled while a walk or extraction is already running, even with a selection', () => {
    renderBrowser({ selected: new Set([4]), extractDisabledReason: 'A dependency walk or extraction is already running.' });
    expect(screen.getByTestId('extract-selected-button')).toBeDisabled();
  });
});

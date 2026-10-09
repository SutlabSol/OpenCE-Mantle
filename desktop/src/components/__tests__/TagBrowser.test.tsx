import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TagBrowser from '../TagBrowser';
import type { TagEntrySummary } from '../../../electron/shared-types';

const TAGS: TagEntrySummary[] = [
  { index: 0, tagId: 1, primaryClassName: 'scenario', path: 'levels\\test\\bloodgulch\\bloodgulch', isExternal: false, estimatedSize: 215040 },
  { index: 4, tagId: 2, primaryClassName: 'vehicle', path: 'vehicles\\warthog\\warthog', isExternal: false, estimatedSize: 12044 },
  { index: 5, tagId: 3, primaryClassName: 'vehicle', path: 'vehicles\\banshee\\banshee', isExternal: false, estimatedSize: 9000 },
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
  render(<TagBrowser {...props} />);
  return { onFocusTag, onSelectedChange, onExtractRequested, props };
}

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
    fireEvent.contextMenu(screen.getByTestId('tag-row-4'));
    expect(onSelectedChange).toHaveBeenCalledWith(new Set([4]));
  });

  it('the context menu "Extract (with dependencies)..." action extracts the current selection', async () => {
    const { onExtractRequested } = renderBrowser({ selected: new Set([4]), extractDisabledReason: null });
    fireEvent.contextMenu(screen.getByTestId('tag-row-4'));
    await userEvent.click(screen.getByTestId('tag-row-context-extract'));
    expect(onExtractRequested).toHaveBeenCalledWith([4]);
  });

  it('selecting a group header checkbox expands to all its child tags', async () => {
    const { onSelectedChange } = renderBrowser({ selected: new Set(), extractDisabledReason: null });
    await userEvent.click(screen.getByTestId('tag-group-select-vehicle'));
    expect(onSelectedChange).toHaveBeenCalledWith(new Set([4, 5]));
  });

  it('is disabled while a walk or extraction is already running, even with a selection', () => {
    renderBrowser({ selected: new Set([4]), extractDisabledReason: 'A dependency walk or extraction is already running.' });
    expect(screen.getByTestId('extract-selected-button')).toBeDisabled();
  });
});

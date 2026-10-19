import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnicodeStringEditorPanel from '../UnicodeStringEditorPanel';
import TagActionDialog from '../TagActionDialog';
import TagEditorDialog from '../TagEditorDialog';
import type { TagEntrySummary, UnicodeStringListResult } from '../../../electron/shared-types';

const SAMPLE_USTR_TAG: TagEntrySummary = {
  index: 42,
  tagId: 0xe1740042,
  primaryClassName: 'unicode_string_list',
  path: 'ui\\multiplayer_strings',
  isExternal: false,
  estimatedSize: 2048,
};

const SAMPLE_EXTERNAL_USTR_TAG: TagEntrySummary = {
  index: 43,
  tagId: 0xe1740043,
  primaryClassName: 'unicode_string_list',
  path: 'ui\\loc_strings',
  isExternal: true,
  estimatedSize: 2048,
};

const MOCK_USTR_DATA: UnicodeStringListResult = {
  tagIndex: 42,
  tagId: 0xe1740042,
  tagPath: 'ui\\multiplayer_strings',
  strings: [
    {
      index: 0,
      text: 'Slayer',
      allocatedBytes: 64,
      byteLength: 12,
      maxChars: 31,
      fileOffset: 0,
      pointer: 0,
    },
    {
      index: 1,
      text: 'Capture The Flag',
      allocatedBytes: 128,
      byteLength: 32,
      maxChars: 63,
      fileOffset: 0,
      pointer: 0,
    },
  ],
};

describe('Milestone 9 Desktop Components', () => {
  beforeEach(() => {
    window.opence = {
      getUnicodeStrings: vi.fn().mockResolvedValue({
        ok: true,
        result: MOCK_USTR_DATA,
      }),
      setUnicodeString: vi.fn().mockResolvedValue({
        ok: true,
        tagIndex: 42,
        stringIndex: 0,
        text: 'Team Slayer',
        map: { filePath: 'test.map', modified: true } as any,
      }),
      renameTag: vi.fn().mockResolvedValue({
        ok: true,
        path: 'ui\\renamed_strings',
        map: { filePath: 'test.map', modified: true } as any,
      }),
      duplicateTag: vi.fn().mockResolvedValue({
        ok: true,
        newTagIndex: 99,
        newTagId: 0xe1740099,
        path: 'ui\\multiplayer_strings_copy',
        map: { filePath: 'test.map', modified: true } as any,
      }),
      getTagFields: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          tagIndex: 42,
          tagId: 0xe1740042,
          tagPath: 'ui\\multiplayer_strings',
          group: 'ustr',
          structName: 'UnicodeStringList',
          fields: [],
        },
      }),
    } as any;
  });

  describe('UnicodeStringEditorPanel', () => {
    it('loads and displays unicode strings table', async () => {
      render(<UnicodeStringEditorPanel tag={SAMPLE_USTR_TAG} />);

      expect(window.opence.getUnicodeStrings).toHaveBeenCalledWith(42);
      await waitFor(() => {
        expect(screen.getByTestId('unicode-input-0')).toHaveValue('Slayer');
        expect(screen.getByTestId('unicode-input-1')).toHaveValue('Capture The Flag');
      });
    });

    it('filters strings by search query', async () => {
      render(<UnicodeStringEditorPanel tag={SAMPLE_USTR_TAG} />);

      await waitFor(() => {
        expect(screen.getByTestId('unicode-input-0')).toBeInTheDocument();
      });

      await userEvent.type(screen.getByTestId('unicode-string-search'), 'Flag');
      expect(screen.queryByTestId('unicode-input-0')).not.toBeInTheDocument();
      expect(screen.getByTestId('unicode-input-1')).toBeInTheDocument();
    });

    it('edits string and saves via Enter key', async () => {
      render(<UnicodeStringEditorPanel tag={SAMPLE_USTR_TAG} />);

      await waitFor(() => {
        expect(screen.getByTestId('unicode-input-0')).toBeInTheDocument();
      });

      const input = screen.getByTestId('unicode-input-0');
      await userEvent.clear(input);
      await userEvent.type(input, 'Team Slayer{enter}');

      expect(window.opence.setUnicodeString).toHaveBeenCalledWith(42, 0, 'Team Slayer');
      await waitFor(() => {
        expect(screen.getByTestId('status-tag-0')).toHaveTextContent('Saved');
      });
    });

    it('shows external warning for loc.map ustr tags', async () => {
      (window.opence.getUnicodeStrings as any).mockResolvedValueOnce({
        ok: true,
        result: {
          ...MOCK_USTR_DATA,
          isExternal: true,
          externalNote: 'This unicode_string_list references external strings in loc.map.',
        },
      });

      render(<UnicodeStringEditorPanel tag={SAMPLE_EXTERNAL_USTR_TAG} />);

      await waitFor(() => {
        expect(screen.getByTestId('unicode-string-external-note')).toBeInTheDocument();
        expect(screen.getByText(/references external strings in loc.map/)).toBeInTheDocument();
      });
    });
  });

  describe('TagActionDialog', () => {
    it('renames a tag successfully', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <TagActionDialog
          action="rename"
          tag={SAMPLE_USTR_TAG}
          onClose={onClose}
          onSuccess={onSuccess}
        />,
      );

      expect(screen.getByTestId('rename-tag-dialog')).toBeInTheDocument();
      const input = screen.getByTestId('rename-tag-input');
      expect(input).toHaveValue('ui\\multiplayer_strings');

      await userEvent.clear(input);
      await userEvent.type(input, 'ui\\renamed_strings');
      await userEvent.click(screen.getByTestId('rename-tag-submit'));

      expect(window.opence.renameTag).toHaveBeenCalledWith(42, 'ui\\renamed_strings');
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(42);
      });
    });

    it('duplicates a tag successfully', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <TagActionDialog
          action="duplicate"
          tag={SAMPLE_USTR_TAG}
          onClose={onClose}
          onSuccess={onSuccess}
        />,
      );

      expect(screen.getByTestId('duplicate-tag-dialog')).toBeInTheDocument();
      const input = screen.getByTestId('duplicate-tag-input');
      expect(input).toHaveValue('ui\\multiplayer_strings_copy');

      await userEvent.click(screen.getByTestId('duplicate-tag-submit'));

      expect(window.opence.duplicateTag).toHaveBeenCalledWith(42, 'ui\\multiplayer_strings_copy');
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(99);
      });
    });

    it('displays error if rename fails', async () => {
      (window.opence.renameTag as any).mockResolvedValueOnce({
        ok: false,
        code: 'TAG_EXISTS',
        message: 'A tag with this path already exists.',
      });

      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <TagActionDialog
          action="rename"
          tag={SAMPLE_USTR_TAG}
          onClose={onClose}
          onSuccess={onSuccess}
        />,
      );

      const input = screen.getByTestId('rename-tag-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'ui\\already_exists');
      await userEvent.click(screen.getByTestId('rename-tag-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('rename-tag-error')).toHaveTextContent('A tag with this path already exists.');
        expect(onSuccess).not.toHaveBeenCalled();
      });
    });
  });

  describe('TagEditorDialog for unicode_string_list', () => {
    it('shows Unicode Strings tab by default and switches to Raw Fields', async () => {
      render(
        <TagEditorDialog
          tag={SAMPLE_USTR_TAG}
          allTags={[SAMPLE_USTR_TAG]}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByTestId('tag-editor-tab-strings')).toBeInTheDocument();
      expect(screen.getByTestId('tag-editor-tab-fields')).toBeInTheDocument();
      expect(screen.getByTestId('unicode-string-editor-panel')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('tag-editor-tab-fields'));
      await waitFor(() => {
        expect(screen.getByTestId('properties-palette-fields')).toBeInTheDocument();
      });
    });
  });
});

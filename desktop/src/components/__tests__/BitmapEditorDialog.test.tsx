import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BitmapEditorDialog from '../BitmapEditorDialog';
import type { TagEntrySummary, GetBitmapInfoResult, GetBitmapRgbaResult } from '../../../electron/shared-types';

const MOCK_BITMAP_TAG: TagEntrySummary = {
  index: 12,
  tagId: 0xe174000c,
  primaryClassName: 'bitmap',
  path: 'ui\\shell\\bitmaps\\halo_logo',
  isExternal: false,
  estimatedSize: 65536,
};

const MOCK_INFO_RESULT: GetBitmapInfoResult = {
  ok: true,
  summary: {
    tagId: 0xe174000c,
    tagIndex: 12,
    path: 'ui\\shell\\bitmaps\\halo_logo',
    type: 0,
    typeName: '2D Textures',
    format: 0,
    formatName: 'Color-Key 4-bit (DXT1)',
    usage: 0,
    usageName: 'Default',
    isExternal: false,
    imageCount: 2,
    images: [
      {
        index: 0,
        width: 256,
        height: 128,
        depth: 1,
        type: 0,
        typeName: '2D Texture',
        format: 0,
        formatName: 'DXT1',
        flags: 0,
        mipmapCount: 1,
        pixelDataOffset: 1024,
        pixelDataSize: 16384,
        isExternal: false,
      },
      {
        index: 1,
        width: 128,
        height: 64,
        depth: 1,
        type: 0,
        typeName: '2D Texture',
        format: 0,
        formatName: 'DXT1',
        flags: 0,
        mipmapCount: 1,
        pixelDataOffset: 17408,
        pixelDataSize: 4096,
        isExternal: false,
      },
    ],
    sequences: [
      {
        name: 'main',
        firstSubImageIndex: 0,
        subImageCount: 2,
      },
    ],
  },
};

const MOCK_RGBA_RESULT: GetBitmapRgbaResult = {
  ok: true,
  width: 256,
  height: 128,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
};

describe('BitmapEditorDialog', () => {
  let mockGetBitmapInfo: any;
  let mockGetBitmapRgba: any;
  let mockPickExportBitmapPath: any;
  let mockExportBitmapImage: any;
  let mockPickImportBitmapPath: any;
  let mockReplaceBitmapImage: any;

  beforeEach(() => {
    mockGetBitmapInfo = vi.fn().mockResolvedValue(MOCK_INFO_RESULT);
    mockGetBitmapRgba = vi.fn().mockResolvedValue(MOCK_RGBA_RESULT);
    mockPickExportBitmapPath = vi.fn().mockResolvedValue({ path: 'C:\\exports\\halo_logo.png' });
    mockExportBitmapImage = vi.fn().mockResolvedValue({ ok: true, filePath: 'C:\\exports\\halo_logo.png' });
    mockPickImportBitmapPath = vi.fn().mockResolvedValue({ path: 'C:\\imports\\new_logo.png' });
    mockReplaceBitmapImage = vi.fn().mockResolvedValue({ ok: true, map: { modified: true } });

    (window as any).opence = {
      getBitmapInfo: mockGetBitmapInfo,
      getBitmapRgba: mockGetBitmapRgba,
      pickExportBitmapPath: mockPickExportBitmapPath,
      exportBitmapImage: mockExportBitmapImage,
      pickImportBitmapPath: mockPickImportBitmapPath,
      replaceBitmapImage: mockReplaceBitmapImage,
    };
  });

  it('renders the bitmap dialog with tag path and plate specifications', async () => {
    render(<BitmapEditorDialog tag={MOCK_BITMAP_TAG} onClose={() => {}} />);

    expect(screen.getByText('Bitmap Editor')).toBeInTheDocument();
    expect(screen.getByText('bitm')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/256 × 128 px/)).toBeInTheDocument();
      expect(screen.getByText('INTERNAL')).toBeInTheDocument();
    });
  });

  it('triggers PNG export flow when clicking Export PNG button', async () => {
    const user = userEvent.setup();
    render(<BitmapEditorDialog tag={MOCK_BITMAP_TAG} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('bitmap-export-png')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('bitmap-export-png'));

    expect(mockPickExportBitmapPath).toHaveBeenCalledWith(expect.stringContaining('halo_logo'), 'png');
    expect(mockExportBitmapImage).toHaveBeenCalledWith(12, 0, 'png', 'C:\\exports\\halo_logo.png');
  });

  it('triggers import and replace flow when clicking Import & Replace button', async () => {
    const user = userEvent.setup();
    render(<BitmapEditorDialog tag={MOCK_BITMAP_TAG} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('bitmap-import-replace')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('bitmap-import-replace'));

    expect(mockPickImportBitmapPath).toHaveBeenCalled();
    expect(mockReplaceBitmapImage).toHaveBeenCalledWith(12, 0, 'C:\\imports\\new_logo.png');
  });

  it('closes dialog when Close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<BitmapEditorDialog tag={MOCK_BITMAP_TAG} onClose={onClose} />);

    await user.click(screen.getByTestId('bitmap-editor-close'));
    expect(onClose).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import IdentifyBitmapsDialog from '../IdentifyBitmapsDialog';
import type { BitmapIdentificationResult } from '../../../electron/shared-types';

describe('IdentifyBitmapsDialog', () => {
  const mockOnClose = vi.fn();

  const mockCeResult: BitmapIdentificationResult = {
    ok: true,
    filePath: 'C:\\HaloCE\\maps\\bitmaps.map',
    fileSizeBytes: 34_369_536,
    entryCount: 1568,
    tableOffset: 0x01e42000,
    detectedVersion: 'ce',
    versionMatchConfidence: 'exact',
    entries: [
      { index: 0, name: 'ui/hud/bitmaps/hud_numbers', dataOffset: 0x10, size: 4096 },
      { index: 1, name: 'characters/cyborg/bitmaps/cyborg', dataOffset: 0x1010, size: 65536 },
      { index: 2, name: 'vehicles/warthog/bitmaps/warthog', dataOffset: 0x11010, size: 131072 },
    ],
  };

  const mockHalomdResult: BitmapIdentificationResult = {
    ok: true,
    filePath: 'C:\\HaloMD\\maps\\bitmaps.map',
    fileSizeBytes: 332_400_000,
    entryCount: 2450,
    tableOffset: 0x02100000,
    detectedVersion: 'halomd',
    versionMatchConfidence: 'exact',
    entries: [
      { index: 0, name: 'ui/hud/bitmaps/hud_numbers', dataOffset: 0x10, size: 4096 },
      { index: 1, name: 'halomd/textures/hd_water', dataOffset: 0x2000, size: 262144 },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).opence = {
      getSettings: vi.fn().mockResolvedValue({
        lastExtractDir: null,
        resourceMaps: { bitmaps: 'C:\\HaloCE\\maps\\bitmaps.map', sounds: null, loc: null },
      }),
      detectDefaultResourceMapPaths: vi.fn().mockResolvedValue({
        halomd: 'C:\\HaloMD\\maps\\bitmaps.map',
        ce: 'C:\\Program Files (x86)\\Microsoft Games\\Halo Custom Edition\\maps\\bitmaps.map',
        pc: 'C:\\Program Files (x86)\\Microsoft Games\\Halo\\maps\\bitmaps.map',
        demo: 'C:\\Program Files (x86)\\Microsoft Games\\Halo Demo\\maps\\bitmaps.map',
        mcc: 'C:\\HaloMCC\\maps\\bitmaps.map',
      }),
      identifyResourceMap: vi.fn().mockImplementation((path: string, ver?: string) => {
        if (ver === 'halomd') return Promise.resolve(mockHalomdResult);
        return Promise.resolve(mockCeResult);
      }),
      setResourceMapPath: vi.fn().mockResolvedValue({ ok: true }),
      pickConvertResource: vi.fn().mockResolvedValue({ path: 'C:\\Selected\\bitmaps.map' }),
    };
  });

  it('renders with initial version and displays analysis results', async () => {
    render(
      <IdentifyBitmapsDialog
        isOpen={true}
        initialVersion="ce"
        onClose={mockOnClose}
        openMapScenarioName="bloodgulch"
      />,
    );

    expect(screen.getByTestId('identify-bitmaps-dialog')).toBeInTheDocument();
    expect(screen.getByText('Halo Custom Edition (PC CE) Specification')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('identify-bitmaps-result-card')).toBeInTheDocument();
    });

    expect(screen.getByText('Valid Halo Bitmaps Resource Map')).toBeInTheDocument();
    expect(screen.getByText('1,568 bitmaps')).toBeInTheDocument();
    expect(screen.getByText('32.78 MB')).toBeInTheDocument();
    expect(screen.getByText('0x1E42000')).toBeInTheDocument();
    expect(screen.getByText(/bloodgulch/)).toBeInTheDocument();
  });

  it('switches edition tabs when clicked', async () => {
    render(
      <IdentifyBitmapsDialog
        isOpen={true}
        initialVersion="ce"
        onClose={mockOnClose}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('identify-tab-halomd')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('identify-tab-halomd'));

    expect(screen.getByText('HaloMD (Mac OS X) Specification')).toBeInTheDocument();
    expect(window.opence.identifyResourceMap).toHaveBeenCalledWith(expect.any(String), 'halomd');

    fireEvent.click(screen.getByTestId('identify-tab-mcc'));
    expect(screen.getByText('Halo MCC (Master Chief Collection) Specification')).toBeInTheDocument();
    expect(window.opence.identifyResourceMap).toHaveBeenCalledWith(expect.any(String), 'mcc');
  });

  it('filters entries using search filter input', async () => {
    render(
      <IdentifyBitmapsDialog
        isOpen={true}
        initialVersion="ce"
        onClose={mockOnClose}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('identify-bitmaps-search-input')).toBeInTheDocument();
    });

    expect(screen.getByText('vehicles/warthog/bitmaps/warthog')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('identify-bitmaps-search-input'), {
      target: { value: 'cyborg' },
    });

    expect(screen.getByText('characters/cyborg/bitmaps/cyborg')).toBeInTheDocument();
    expect(screen.queryByText('vehicles/warthog/bitmaps/warthog')).not.toBeInTheDocument();
  });

  it('allows picking a new file path via Browse button', async () => {
    render(
      <IdentifyBitmapsDialog
        isOpen={true}
        initialVersion="ce"
        onClose={mockOnClose}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('identify-bitmaps-browse-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('identify-bitmaps-browse-btn'));

    await waitFor(() => {
      expect(window.opence.pickConvertResource).toHaveBeenCalledWith('bitmaps');
    });
  });

  it('allows setting as active resource map', async () => {
    (window.opence.getSettings as any).mockResolvedValueOnce({
      lastExtractDir: null,
      resourceMaps: { bitmaps: 'C:\\Other\\bitmaps.map', sounds: null, loc: null },
    });

    render(
      <IdentifyBitmapsDialog
        isOpen={true}
        initialVersion="ce"
        onClose={mockOnClose}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('identify-bitmaps-set-active-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('identify-bitmaps-set-active-btn'));

    await waitFor(() => {
      expect(window.opence.setResourceMapPath).toHaveBeenCalledWith('bitmaps', expect.any(String));
      expect(screen.getByText(/Configured as Active bitmaps\.map/)).toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    render(
      <IdentifyBitmapsDialog
        isOpen={true}
        initialVersion="ce"
        onClose={mockOnClose}
      />,
    );

    fireEvent.click(screen.getByTestId('identify-bitmaps-close-btn'));
    expect(mockOnClose).toHaveBeenCalled();
  });
});

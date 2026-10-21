import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OpenCeForgeExportDialog from '../OpenCeForgeExportDialog';
import type { TagEntrySummary } from '../../../electron/shared-types';

describe('OpenCeForgeExportDialog', () => {
  const mockTags: TagEntrySummary[] = [
    {
      index: 0,
      path: 'vehicles\\warthog\\mp_warthog',
      primaryClassName: 'vehicle',
      tagId: 0xe0000001,
      isExternal: false,
    },
    {
      index: 1,
      path: 'weapons\\sniper rifle\\sniper rifle',
      primaryClassName: 'weapon',
      tagId: 0xe0000002,
      isExternal: false,
    },
    {
      index: 2,
      path: 'powerups\\active camouflage',
      primaryClassName: 'equipment',
      tagId: 0xe0000003,
      isExternal: false,
    },
    {
      index: 3,
      path: 'scenery\\rocks\\boulder',
      primaryClassName: 'scenery',
      tagId: 0xe0000004,
      isExternal: false,
    },
    {
      index: 4,
      path: 'levels\\a30\\doors\\bulkhead',
      primaryClassName: 'device_machine',
      tagId: 0xe0000005,
      isExternal: false,
    },
  ];

  beforeEach(() => {
    (window as any).opence = {
      extractTags: vi.fn().mockResolvedValue({
        ok: true,
        outputPath: 'C:\\Forge\\warthog.ocetags',
        tagCount: 1,
        fileSizeBytes: 204800,
        carriedOverWarnings: [],
      }),
      onProgress: vi.fn().mockReturnValue(() => {}),
    };
  });

  it('renders category tabs and filters tags accordingly', () => {
    render(
      <OpenCeForgeExportDialog
        open={true}
        onClose={vi.fn()}
        allTags={mockTags}
        log={vi.fn()}
      />
    );

    // Initial tab is Vehicles
    expect(screen.getByText('vehicles\\warthog\\mp_warthog')).toBeInTheDocument();
    expect(screen.queryByText('weapons\\sniper rifle\\sniper rifle')).not.toBeInTheDocument();

    // Switch to Weapons tab
    fireEvent.click(screen.getByText('Weapons'));
    expect(screen.getByText('weapons\\sniper rifle\\sniper rifle')).toBeInTheDocument();

    // Switch to Equipment tab
    fireEvent.click(screen.getByText('Equipment'));
    expect(screen.getByText('powerups\\active camouflage')).toBeInTheDocument();

    // Switch to Scenery tab
    fireEvent.click(screen.getByText('Scenery'));
    expect(screen.getByText('scenery\\rocks\\boulder')).toBeInTheDocument();

    // Switch to Devices & Lights tab
    fireEvent.click(screen.getByText('Devices & Lights'));
    expect(screen.getByText('levels\\a30\\doors\\bulkhead')).toBeInTheDocument();
  });

  it('allows selecting an item and editing its In-Forge name with live preview', async () => {
    const mockLog = vi.fn();
    render(
      <OpenCeForgeExportDialog
        open={true}
        onClose={vi.fn()}
        allTags={mockTags}
        log={mockLog}
      />
    );

    // Select the warthog
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // In Forge name input should appear with default formatted name "Warthog"
    const nameInput = screen.getByPlaceholderText('In Forge Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Warthog');
    expect(screen.getByText('[C] WARTHOG')).toBeInTheDocument();

    // Edit the name to "Gauss Hog"
    fireEvent.change(nameInput, { target: { value: 'Gauss Hog' } });
    expect(screen.getByText('[C] GAUSS HOG')).toBeInTheDocument();

    // Click Export
    const exportBtn = screen.getByText(/Export to OpenCE Forge/);
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect((window as any).opence.extractTags).toHaveBeenCalledWith(
        expect.objectContaining({
          originalIndices: [0],
          itemName: 'Gauss Hog',
          captureGbxmodelRawData: true,
        })
      );
    });

    expect(screen.getByText('Exported Successfully for OpenCE Forge!')).toBeInTheDocument();
  });
});

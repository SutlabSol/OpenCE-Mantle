import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConfigureResourcesPromptDialog from '../ConfigureResourcesPromptDialog';

describe('ConfigureResourcesPromptDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).opence = {
      getVersionSettings: vi.fn().mockResolvedValue({
        pc: { bitmaps: null, sounds: null },
      }),
      setVersionSettings: vi.fn().mockResolvedValue({ ok: true }),
      setResourceMapPath: vi.fn().mockResolvedValue({ ok: true }),
      detectDefaultResourceMapPaths: vi.fn().mockResolvedValue({
        halomd: null,
        ce: 'C:\\HaloCE\\maps\\bitmaps.map',
        pc: 'C:\\HaloPC\\maps\\bitmaps.map',
        demo: null,
        mcc: 'C:\\MCC\\halo1\\maps\\bitmaps.map',
      }),
      pickConvertResource: vi.fn().mockImplementation((kind: string) => {
        return Promise.resolve({ path: `C:\\Custom\\${kind}.map` });
      }),
    };
  });

  it('renders correctly with map edition and scenario name', async () => {
    render(
      <ConfigureResourcesPromptDialog
        isOpen={true}
        mapEdition="pc"
        mapScenarioName="beavercreek"
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    );

    expect(screen.getByTestId('configure-resources-prompt-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Configure Resource Maps/i)).toBeInTheDocument();
    expect(screen.getByText(/beavercreek/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Halo PC Retail/i).length).toBeGreaterThan(0);
  });

  it('allows clicking Skip to trigger onClose', () => {
    render(
      <ConfigureResourcesPromptDialog
        isOpen={true}
        mapEdition="pc"
        mapScenarioName="beavercreek"
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    );

    const skipBtn = screen.getByTestId('configure-resources-skip-btn');
    fireEvent.click(skipBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnSaved).not.toHaveBeenCalled();
  });

  it('allows applying detected defaults and saving', async () => {
    render(
      <ConfigureResourcesPromptDialog
        isOpen={true}
        mapEdition="pc"
        mapScenarioName="beavercreek"
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('configure-resources-use-default-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('configure-resources-use-default-btn'));

    const bitmapsInput = screen.getByTestId('configure-resources-bitmaps-input') as HTMLInputElement;
    const soundsInput = screen.getByTestId('configure-resources-sounds-input') as HTMLInputElement;

    expect(bitmapsInput.value).toBe('C:\\HaloPC\\maps\\bitmaps.map');
    expect(soundsInput.value).toBe('C:\\HaloPC\\maps\\sounds.map');

    fireEvent.click(screen.getByTestId('configure-resources-save-btn'));

    await waitFor(() => {
      expect(window.opence.setVersionSettings).toHaveBeenCalledWith('pc', {
        bitmaps: 'C:\\HaloPC\\maps\\bitmaps.map',
        sounds: 'C:\\HaloPC\\maps\\sounds.map',
      });
      expect(window.opence.setResourceMapPath).toHaveBeenCalledWith('bitmaps', 'C:\\HaloPC\\maps\\bitmaps.map');
      expect(window.opence.setResourceMapPath).toHaveBeenCalledWith('sounds', 'C:\\HaloPC\\maps\\sounds.map');
      expect(mockOnSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('allows browsing for custom files and saving', async () => {
    render(
      <ConfigureResourcesPromptDialog
        isOpen={true}
        mapEdition="pc"
        mapScenarioName="beavercreek"
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    );

    fireEvent.click(screen.getByTestId('configure-resources-pick-bitmaps-btn'));
    await waitFor(() => {
      expect((screen.getByTestId('configure-resources-bitmaps-input') as HTMLInputElement).value).toBe('C:\\Custom\\bitmaps.map');
    });

    fireEvent.click(screen.getByTestId('configure-resources-pick-sounds-btn'));
    await waitFor(() => {
      expect((screen.getByTestId('configure-resources-sounds-input') as HTMLInputElement).value).toBe('C:\\Custom\\sounds.map');
    });

    fireEvent.click(screen.getByTestId('configure-resources-save-btn'));
    await waitFor(() => {
      expect(window.opence.setVersionSettings).toHaveBeenCalledWith('pc', {
        bitmaps: 'C:\\Custom\\bitmaps.map',
        sounds: 'C:\\Custom\\sounds.map',
      });
      expect(mockOnSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('renders correctly for MCC maps', async () => {
    render(
      <ConfigureResourcesPromptDialog
        isOpen={true}
        mapEdition="mcc"
        mapScenarioName="bloodgulch"
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    );

    expect(screen.getByTestId('configure-resources-prompt-dialog')).toBeInTheDocument();
    expect(screen.getAllByText(/Halo: Master Chief Collection \(MCC\)/i).length).toBeGreaterThan(0);
  });
});

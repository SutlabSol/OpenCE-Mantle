import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import TagTestPanel from '../TagTestPanel';
import type { TagTestStatus, TagTestLogEntry } from '../../../electron/shared-types';

describe('TagTestPanel Component', () => {
  let statusListener: ((status: TagTestStatus) => void) | null = null;
  let logListener: ((entry: TagTestLogEntry) => void) | null = null;

  beforeEach(() => {
    statusListener = null;
    logListener = null;

    window.opence = {
      tagTestGetStatus: vi.fn().mockResolvedValue({ state: 'stopped', telnetConnected: false } as TagTestStatus),
      getOpenCeConfig: vi.fn().mockResolvedValue({
        directory: 'C:\\Games\\OpenCE',
        executable: 'C:\\Games\\OpenCE\\halo.exe',
        exists: true,
      }),
      onTagTestStatusChange: vi.fn().mockImplementation((cb) => {
        statusListener = cb;
        return () => {
          statusListener = null;
        };
      }),
      onTagTestLog: vi.fn().mockImplementation((cb) => {
        logListener = cb;
        return () => {
          logListener = null;
        };
      }),
      tagTestLaunch: vi.fn().mockResolvedValue({ ok: true }),
      tagTestStop: vi.fn().mockResolvedValue({ ok: true }),
      tagTestSendCommand: vi.fn().mockResolvedValue({ ok: true }),
      tagTestHotReload: vi.fn().mockResolvedValue({ ok: true }),
      pickOpenCeDirectory: vi.fn().mockResolvedValue({ path: 'C:\\NewPath\\OpenCE' }),
      setOpenCeDirectory: vi.fn().mockResolvedValue({ ok: true }),
    } as any;
  });

  it('renders offline status by default and allows launching', async () => {
    render(<TagTestPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-status-badge')).toHaveTextContent('OFFLINE');
    });

    const launchBtn = screen.getByTestId('tag-test-launch-button');
    expect(launchBtn).toBeInTheDocument();

    fireEvent.click(launchBtn);
    expect(window.opence.tagTestLaunch).toHaveBeenCalledWith({ windowed: true });
  });

  it('updates UI when engine connects to telnet and enables live controls', async () => {
    render(<TagTestPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-status-badge')).toHaveTextContent('OFFLINE');
    });

    act(() => {
      statusListener?.({
        state: 'running',
        telnetConnected: true,
        mapName: '_opence_tag_test_a',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-status-badge')).toHaveTextContent('LIVE • TELNET CONNECTED');
    });

    const reloadBtn = screen.getByTestId('tag-test-hot-reload-button');
    expect(reloadBtn).toBeInTheDocument();
    fireEvent.click(reloadBtn);
    expect(window.opence.tagTestHotReload).toHaveBeenCalled();
  });

  it('toggles cheats and sends HaloScript commands over telnet', async () => {
    render(<TagTestPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-status-badge')).toHaveTextContent('OFFLINE');
    });

    act(() => {
      statusListener?.({
        state: 'running',
        telnetConnected: true,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-cheat-god')).toBeInTheDocument();
    });

    const godCheckbox = screen.getByTestId('tag-test-cheat-god').querySelector('input')!;
    fireEvent.click(godCheckbox);

    expect(window.opence.tagTestSendCommand).toHaveBeenCalledWith('cheat_deathless_player 1');

    fireEvent.click(godCheckbox);
    expect(window.opence.tagTestSendCommand).toHaveBeenCalledWith('cheat_deathless_player 0');
  });

  it('sends spawn commands when spawn buttons are clicked', async () => {
    render(<TagTestPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-status-badge')).toHaveTextContent('OFFLINE');
    });

    act(() => {
      statusListener?.({ state: 'running', telnetConnected: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-all-weapons')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('tag-test-teleport-cam'));
    expect(window.opence.tagTestSendCommand).toHaveBeenCalledWith('cheat_teleport_to_camera');

    fireEvent.click(screen.getByTestId('tag-test-all-weapons'));
    expect(window.opence.tagTestSendCommand).toHaveBeenCalledWith('cheat_all_weapons');
  });

  it('adjusts game speed slider and sends game_speed command', async () => {
    render(<TagTestPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-status-badge')).toHaveTextContent('OFFLINE');
    });

    act(() => {
      statusListener?.({ state: 'running', telnetConnected: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-speed-slider')).not.toBeDisabled();
    });

    const slider = screen.getByTestId('tag-test-speed-slider');
    fireEvent.change(slider, { target: { value: '2.5' } });

    expect(window.opence.tagTestSendCommand).toHaveBeenCalledWith('game_speed 2.5');
  });

  it('submits manual HaloScript expressions via terminal input', async () => {
    render(<TagTestPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-status-badge')).toHaveTextContent('OFFLINE');
    });

    act(() => {
      statusListener?.({ state: 'running', telnetConnected: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-hs-input')).not.toBeDisabled();
    });

    const input = screen.getByTestId('tag-test-hs-input');
    fireEvent.change(input, { target: { value: 'display_framerate 1' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(window.opence.tagTestSendCommand).toHaveBeenCalledWith('display_framerate 1');
  });

  it('renders log stream and allows inspecting referenced tags', async () => {
    const mockInspect = vi.fn();
    render(<TagTestPanel onOpenTagEditor={mockInspect} />);

    await waitFor(() => {
      expect(screen.getByTestId('tag-test-status-badge')).toBeInTheDocument();
    });

    act(() => {
      logListener?.({
        source: 'debug_txt',
        text: 'custom edition: error in weapons\\plasma rifle\\plasma rifle',
        timestamp: Date.now(),
        tagPathLink: 'weapons\\plasma rifle\\plasma rifle',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('tag-link')).toBeInTheDocument();
    });

    const linkBtn = screen.getByTestId('tag-link');
    fireEvent.click(linkBtn);

    expect(mockInspect).toHaveBeenCalledWith('weapons\\plasma rifle\\plasma rifle');
  });
});

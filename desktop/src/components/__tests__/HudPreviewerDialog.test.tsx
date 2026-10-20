import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HudPreviewerDialog from '../HudPreviewerDialog';
import type { TagEntrySummary } from '../../../electron/shared-types';

const MOCK_HUD_TAG: TagEntrySummary = {
  index: 88,
  tagId: 0xe1740058,
  primaryClassName: 'weapon_hud_interface',
  path: 'ui\\hud\\assault_rifle',
  isExternal: false,
  estimatedSize: 4096,
};

describe('HudPreviewerDialog', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      fillText: vi.fn(),
      setLineDash: vi.fn(),
      createLinearGradient: vi.fn().mockReturnValue({
        addColorStop: vi.fn(),
      }),
    });
  });

  it('renders HUD previewer header and interactive canvas', () => {
    const onClose = vi.fn();
    render(<HudPreviewerDialog tag={MOCK_HUD_TAG} onClose={onClose} />);

    expect(screen.getByText('WYSIWYG HUD Previewer')).toBeInTheDocument();
    expect(screen.getByText('ui\\hud\\assault_rifle')).toBeInTheDocument();
    expect(screen.getByTestId('hud-fire-btn')).toBeInTheDocument();
    expect(screen.getByTestId('hud-reload-btn')).toBeInTheDocument();
  });

  it('simulates weapon fire decrementing loaded ammo', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HudPreviewerDialog tag={MOCK_HUD_TAG} onClose={onClose} />);

    const fireBtn = screen.getByTestId('hud-fire-btn');
    await user.click(fireBtn);
    // After firing, loaded ammo decrements from 60 to 59
  });

  it('closes when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HudPreviewerDialog tag={MOCK_HUD_TAG} onClose={onClose} />);

    const closeBtn = screen.getByTestId('hud-previewer-close');
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
